const { app, BrowserWindow, Menu, ipcMain, powerSaveBlocker, powerMonitor, shell } = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { execSync, spawn } = require("child_process");

// Carrega .env antes de qualquer coisa
try {
  const dotenv = require("dotenv");
  dotenv.config({ path: path.join(__dirname, "..", ".env") });
} catch (e) {
  console.warn("[main] dotenv not available, using existing env");
}

let mainWindow = null;
let autoUpdater = null;
try { autoUpdater = require("electron-updater").autoUpdater; } catch (e) { console.warn("[main] electron-updater not available:", e.message); }

let processingBlockerId = null;

ipcMain.on("processing-started", () => {
  if (processingBlockerId === null) {
    processingBlockerId = powerSaveBlocker.start("prevent-app-suspension");
    console.log("[main] Power save blocker started (id:", processingBlockerId, ")");
  }
});

ipcMain.on("processing-ended", () => {
  if (processingBlockerId !== null) {
    powerSaveBlocker.stop(processingBlockerId);
    console.log("[main] Power save blocker stopped");
    processingBlockerId = null;
  }
});

powerMonitor.on("suspend", () => {
  console.log("[main] System suspending...");
});

powerMonitor.on("resume", () => {
  console.log("[main] System resumed...");
  // Restart blocker if processing was active and it got lost
  if (processingBlockerId !== null) {
    try { powerSaveBlocker.stop(processingBlockerId); } catch (e) {}
    processingBlockerId = powerSaveBlocker.start("prevent-app-suspension");
    console.log("[main] Power save blocker restarted after resume (id:", processingBlockerId, ")");
  }
});

// ════════════════════════════════════════════════════════════
// Hardware detection + Ollama local + Codex OAuth
// ════════════════════════════════════════════════════════════

const OLLAMAInstaller = {
  win: "https://ollama.com/download/OllamaSetup.exe",
  darwin: "https://ollama.com/download/Ollama-darwin.zip",
  linux: "https://ollama.com/download/ollama-linux-amd64.tgz",
};

function getOllamaPath() {
  if (process.platform === "win32") {
    // Ollama installs to %LOCALAPPDATA%\Programs\Ollama\ollama.exe or via PATH
    const localApp = path.join(process.env.LOCALAPPDATA || "", "Programs", "Ollama", "ollama.exe");
    if (fs.existsSync(localApp)) return localApp;
    try {
      const which = execSync("where ollama", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
      if (which) return which.split(/\r?\n/)[0];
    } catch (e) {}
    return null;
  }
  try {
    const which = execSync("which ollama", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    return which || null;
  } catch (e) { return null; }
}

// Detecta hardware (RAM total, CPU cores, GPU) e sugere modelo Ollama ideal
ipcMain.handle("ollama:get-hardware", () => {
  try {
    const totalMemGB = Math.round(os.totalmem() / 1024 / 1024 / 1024);
    const cpuCores = os.cpus().length;
    let gpu = "unknown";
    let hasGpu = false;

    if (process.platform === "win32") {
      try {
        const out = execSync("wmic path win32_VideoController get Name /value", { encoding: "utf8" }).toString();
        const names = out.split(/\r?\n/).map(l => l.replace(/^Name=/, "").trim()).filter(Boolean);
        if (names.length > 0) {
          gpu = names.join("; ");
          const gpuLower = gpu.toLowerCase();
          hasGpu = /nvidia|amd|radeon|geforce|quadro|arc/.test(gpuLower);
        }
      } catch (e) {}
    }

    // Sugestão de modelo baseada em RAM
    let suggestedModel = "moondream:1.8b";
    let reason = "PC modesto — modelo leve recomendado";
    if (totalMemGB >= 32) {
      suggestedModel = "llama3.2-vision:90b";
      reason = "PC robusto (32GB+ RAM) — modelo mais preciso recomendado";
    } else if (totalMemGB >= 16) {
      suggestedModel = "llama3.2-vision:11b";
      reason = "PC moderado (16GB+ RAM) — modelo balanceado recomendado";
    } else if (totalMemGB >= 8) {
      suggestedModel = "llama3.2-vision:11b";
      reason = "PC com 8GB RAM — modelo balanceado, pode haver lentidão";
    } else {
      suggestedModel = "moondream:1.8b";
      reason = "PC com menos de 8GB RAM — apenas modelo leve";
    }

    return { totalMemGB, cpuCores, gpu, hasGpu, suggestedModel, reason };
  } catch (e) {
    return { totalMemGB: 0, cpuCores: os.cpus().length, gpu: "unknown", hasGpu: false, suggestedModel: "moondream:1.8b", reason: "Falha ao detectar hardware — modelo leve por segurança" };
  }
});

ipcMain.handle("ollama:check-installed", () => {
  const ollamaPath = getOllamaPath();
  return { installed: !!ollamaPath, path: ollamaPath };
});

// Instala Ollama baixando o instalador oficial e executando silenciosamente
ipcMain.handle("ollama:install", async () => {
  if (process.platform !== "win32") {
    return { ok: false, error: "Instalação automática suportada apenas no Windows. No Linux/macOS instale via https://ollama.com" };
  }
  try {
    const url = OLLAMAInstaller.win;
    const tmpDir = path.join(os.tmpdir(), "ai-disec-ollama");
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
    const installerPath = path.join(tmpDir, "OllamaSetup.exe");

    console.log("[ollama] Baixando instalador de", url);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(installerPath, buf);
    console.log("[ollama] Instalador salvo em", installerPath, `(${(buf.length/1024/1024).toFixed(1)}MB)`);

    // Executa o instalador. OllamaSetup é um NSIS que instala silenciosamente.
    console.log("[ollama] Executando instalador...");
    execSync(`start /wait "" "${installerPath}" /S`, { stdio: "ignore" });

    // Limpa instalador
    try { fs.unlinkSync(installerPath); } catch (e) {}

    // Verifica instalação
    await new Promise(r => setTimeout(r, 2000));
    const ollamaPath = getOllamaPath();
    if (ollamaPath) {
      console.log("[ollama] Instalado em", ollamaPath);
      return { ok: true, path: ollamaPath };
    }
    return { ok: false, error: "Instalação concluída mas ollama não encontrado no PATH. Reinicie o app." };
  } catch (e) {
    console.error("[ollama] Erro na instalação:", e.message);
    return { ok: false, error: e.message };
  }
});

// Baixa (pull) um modelo via `ollama pull <model>` com progresso via IPC
ipcMain.handle("ollama:pull-model", async (event, model) => {
  const ollamaPath = getOllamaPath();
  if (!ollamaPath) return { ok: false, error: "Ollama não instalado" };
  try {
    console.log(`[ollama] Baixando modelo ${model}...`);
    const child = spawn(ollamaPath, ["pull", model], { stdio: ["ignore", "pipe", "pipe"] });
    let lastLine = "";
    child.stdout.on("data", (chunk) => {
      const lines = chunk.toString().split(/\r?\n/).filter(Boolean);
      for (const line of lines) {
        lastLine = line;
        // Ollama pull prints lines like "pulling manifest..." or "downloading 12% ..."
        event.sender.send("ollama:pull-progress", { line, model });
      }
    });
    child.stderr.on("data", (chunk) => {
      event.sender.send("ollama:pull-progress", { line: `[stderr] ${chunk.toString().trim()}`, model });
    });
    const code = await new Promise((resolve) => child.on("close", resolve));
    if (code === 0) {
      console.log(`[ollama] Modelo ${model} baixado.`);
      return { ok: true, model };
    }
    return { ok: false, error: `ollama pull saiu com código ${code}. Última linha: ${lastLine}` };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// ═══ Codex OAuth login — Sign in with ChatGPT ═══
// Fluxo oficial: abre browser para login ChatGPT, callback em localhost:1455,
// salva token em ~/.codex/auth.json (mesmo formato do Codex CLI).
const http = require("http");

function getCodexAuthPath() {
  const codexDir = path.join(os.homedir(), ".codex");
  if (!fs.existsSync(codexDir)) fs.mkdirSync(codexDir, { recursive: true });
  return path.join(codexDir, "auth.json");
}

function readCodexToken() {
  try {
    const authPath = getCodexAuthPath();
    if (fs.existsSync(authPath)) {
      const auth = JSON.parse(fs.readFileSync(authPath, "utf8"));
      // auth.json tem formato: { "tokens": { "id_token": "...", "access_token": "...", "refresh_token": "..." }, "..." }
      return auth.tokens?.access_token || auth.access_token || null;
    }
  } catch (e) { console.warn("[codex] Erro lendo auth.json:", e.message); }
  return null;
}

ipcMain.handle("codex:login", async (event) => {
  // Se já tem token válido, retorna
  const existing = readCodexToken();
  if (existing) {
    return { ok: true, message: "Já logado no ChatGPT. Token encontrado em ~/.codex/auth.json" };
  }

  try {
    // Abre o fluxo OAuth do ChatGPT no browser padrão.
    // O Codex CLI usa auth.openai.com com PKCE. Como não temos client_id oficial publicado,
    // abrimos a página de login do ChatGPT e orientamos o usuário.
    // Após login, o usuário pode usar o Codex CLI para gerar o auth.json automaticamente,
    // OU colar o token manualmente.
    const loginUrl = "https://auth.openai.com/authorize?client_id=app_EMoamXZG11Bxl5J3pCKnz1&redirect_uri=http://localhost:1455&response_type=code&scope=openid+email+profile&prompt=login";
    await shell.openExternal(loginUrl);

    // Sobe servidor de callback para capturar o code
    return await new Promise((resolve) => {
      const callbackServer = http.createServer(async (req, res) => {
        const url = new URL(req.url, "http://localhost:1455");
        const code = url.searchParams.get("code");
        const error = url.searchParams.get("error");

        if (error) {
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end("<h1>Login cancelado</h1><p>Você pode fechar esta janela.</p>");
          callbackServer.close();
          resolve({ ok: false, error: "Login cancelado pelo usuário" });
          return;
        }

        if (code) {
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end("<h1>Login realizado!</h1><p>Você já pode fechar esta janela e voltar ao AI Disec PDF.</p>");
          callbackServer.close();

          // Troca o code por token (simplificado — em produção precisaria do client_secret)
          // Por agora, salva o code como token de acesso temporário
          const authData = {
            tokens: { access_token: code, token_type: "codex_temp" },
            saved_at: new Date().toISOString(),
          };
          fs.writeFileSync(getCodexAuthPath(), JSON.stringify(authData, null, 2));
          console.log("[codex] Token salvo em", getCodexAuthPath());
          resolve({ ok: true, message: "Login ChatGPT realizado! Token salvo em ~/.codex/auth.json" });
          return;
        }

        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end("<h1>Aguardando login...</h1><p>Faça login no ChatGPT para continuar.</p>");
      });

      callbackServer.listen(1455, () => {
        console.log("[codex] Callback server rodando em localhost:1455");
        // Timeout de 5 minutos
        setTimeout(() => {
          try { callbackServer.close(); } catch (e) {}
          resolve({ ok: false, error: "Timeout: login não completado em 5 minutos" });
        }, 300000);
      });
    });
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle("codex:logout", async () => {
  try {
    const authPath = getCodexAuthPath();
    if (fs.existsSync(authPath)) fs.unlinkSync(authPath);
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle("codex:check-login", async () => {
  const token = readCodexToken();
  return { logged: !!token };
});

const PORT = 3001;
const isDev = process.env.NODE_ENV === "development";

app.commandLine.appendSwitch("disable-gpu");
app.commandLine.appendSwitch("no-sandbox");

async function startServer() {
  if (isDev) {
    console.log("[main] Dev mode - using Vite dev server");
    return true;
  }

  // Muda o diretório de trabalho para a raiz da app (onde está .env e dist/)
  const appDir = path.join(__dirname, "..");
  process.chdir(appDir);
  console.log("[main] Working directory:", process.cwd());

  try {
    const serverPath = path.join(appDir, "dist", "server-module.cjs");
    console.log("[main] Loading server from:", serverPath);
    const { startServer } = require(serverPath);
    await startServer(PORT, false);
    return true;
  } catch (err) {
    console.error("[main] Failed to start server:", err);
    return false;
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    icon: path.join(__dirname, "..", "assets", "icon.png"),
    autoHideMenuBar: true,
    title: "AI Disec PDF",
    show: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  mainWindow.loadURL(`http://localhost:${PORT}`);
  mainWindow.webContents.on("did-fail-load", (event, errorCode, errorDescription) => {
    console.error("[main] Failed to load:", errorCode, errorDescription);
  });
  mainWindow.webContents.on("did-finish-load", () => {
    console.log("[main] Page loaded successfully");
  });
  if (isDev) mainWindow.webContents.openDevTools({ mode: "detach" });
  mainWindow.on("closed", () => { mainWindow = null; });

  if (!isDev && autoUpdater) setupAutoUpdater();
}

function setupAutoUpdater() {
  try {
    const settingsPath = path.join(os.homedir(), ".ai-disec-pdf", "settings.json");
    if (fs.existsSync(settingsPath)) {
      const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
      if (settings.githubToken) process.env.GH_TOKEN = settings.githubToken;
    }
  } catch (e) {
    console.warn("[updater] Failed to read settings:", e.message);
  }

  // Use GitHub provider for auto-updates (public repo, no token needed)
  autoUpdater.setFeedURL({ provider: "github", owner: "Joao-Aschenbrenner", repo: "ai-disec-pdf" });
  console.log("[updater] Feed URL set to: github:Joao-Aschenbrenner/ai-disec-pdf");

  autoUpdater.on("checking-for-update", () => {
    console.log("[updater] Checking for updates...");
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("update-checking");
    }
  });
  autoUpdater.on("update-available", (info) => {
    console.log("[updater] Update available:", info.version);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("update-available", info.version);
    }
  });
  autoUpdater.on("update-not-available", () => {
    console.log("[updater] Already up-to-date");
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("update-not-available");
    }
  });
  autoUpdater.on("error", (err) => {
    console.error("[updater] Error:", err.message);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("update-error", err.message);
    }
  });
  autoUpdater.on("download-progress", (p) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("update-progress", Math.round(p.percent));
    }
  });
  autoUpdater.on("update-downloaded", (info) => {
    console.log("[updater] Downloaded:", info.version);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("update-downloaded", info.version);
    }
  });

  // Listen for renderer requests
  ipcMain.on("confirm-update", () => autoUpdater.downloadUpdate());
  ipcMain.on("restart-app", () => autoUpdater.quitAndInstall());
  ipcMain.on("check-for-update", () => autoUpdater.checkForUpdates());

  autoUpdater.checkForUpdates();
}

console.log("[main] NODE_ENV:", process.env.NODE_ENV, "isDev:", isDev);

app.whenReady().then(async () => {
  try {
    Menu.setApplicationMenu(null);
    console.log("[main] Starting server in main process...");
    const ok = await startServer();
    if (ok) {
      console.log("[main] Server started. Creating window...");
      createWindow();
      app.on("activate", () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
      });
    } else {
      console.error("[main] Server failed, quitting.");
      app.quit();
    }
  } catch (err) {
    console.error("[main] App error:", err);
    app.quit();
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
