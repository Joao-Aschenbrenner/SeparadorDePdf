import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll, vi } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { startServer, stopServer } from "../server/server";

// Importamos após preparar/stub do models.json quando necessário.
// Como loadModelsCatalog cacheia, precisamos isolar o módulo por teste.

const DATA_DIR = path.join(os.homedir(), ".ai-disec-pdf");
const SETTINGS_FILE = path.join(DATA_DIR, "settings.json");
const savedSettings = fs.existsSync(SETTINGS_FILE) ? fs.readFileSync(SETTINGS_FILE, "utf8") : null;

describe("Catálogo de modelos (server/models.json)", () => {
  it("catálogo existe e tem a estrutura esperada", () => {
    const catalogPath = path.join(__dirname, "..", "server", "models.json");
    expect(fs.existsSync(catalogPath)).toBe(true);
    const catalog = JSON.parse(fs.readFileSync(catalogPath, "utf8"));
    expect(catalog.providers).toBeTypeOf("object");
    const expected = ["NVIDIA", "GOOGLE", "OPENAI", "ANTHROPIC", "MISTRAL", "OPENROUTER"];
    for (const p of expected) {
      expect(catalog.providers[p], `provider ${p} ausente`).toBeDefined();
      expect(catalog.providers[p].baseUrl).toBeTypeOf("string");
      expect(Array.isArray(catalog.providers[p].models)).toBe(true);
      expect(catalog.providers[p].models.length, `${p}: sem modelos`).toBeGreaterThan(0);
      expect(Array.isArray(catalog.providers[p].preferred)).toBe(true);
    }
  });

  it("todos os modelos listados são strings não vazias", () => {
    const catalog = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "server", "models.json"), "utf8"));
    for (const [name, entry] of Object.entries(catalog.providers) as [string, { models: string[] }][]) {
      for (const m of entry.models) {
        expect(typeof m, `${name}: modelo ${m}`).toBe("string");
        expect(m.length, `${name}: modelo vazio`).toBeGreaterThan(0);
      }
    }
  });

  it("catálogo cobre os 9 providers (6 cloud + 3 novos)", () => {
    const catalog = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "server", "models.json"), "utf8"));
    const expected = ["NVIDIA", "GOOGLE", "OPENAI", "ANTHROPIC", "MISTRAL", "OPENROUTER", "LOCAL_OLLAMA", "OLLAMA_CLOUD", "CODEX"];
    for (const p of expected) {
      expect(catalog.providers[p], `${p} ausente do catálogo`).toBeDefined();
    }
  });

  it("MISTRAL marcado como ocrOnly (OCR + classificação)", () => {
    const catalog = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "server", "models.json"), "utf8"));
    expect(catalog.providers.MISTRAL.ocrOnly).toBe(true);
  });

  it("OPENROUTER usa modelos free", () => {
    const catalog = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "server", "models.json"), "utf8"));
    expect(catalog.providers.OPENROUTER.models.some(m => m.includes(":free"))).toBe(true);
  });

  it("LOCAL_OLLAMA tem flag local=true e downloadSizes/minRamGB", () => {
    const catalog = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "server", "models.json"), "utf8"));
    const local = catalog.providers.LOCAL_OLLAMA;
    expect(local.local).toBe(true);
    expect(local.downloadSizes).toBeDefined();
    expect(local.minRamGB).toBeDefined();
    expect(local.baseUrl).toBe("http://localhost:11434");
  });
});

describe("getProviderConfig (catálogo e fallback)", () => {
  it("FALLBACK_MODELS exportado cobre os 7 providers", async () => {
    const { FALLBACK_MODELS } = await import("../server/server");
    const expected = ["NVIDIA", "GOOGLE", "OPENAI", "ANTHROPIC", "MISTRAL", "OPENROUTER", "LOCAL_OLLAMA", "OLLAMA_CLOUD", "CODEX"];
    for (const p of expected) {
      expect(FALLBACK_MODELS[p], `${p} ausente do fallback`).toBeDefined();
      if (p !== "LOCAL_OLLAMA") {
        expect(FALLBACK_MODELS[p].baseUrl.startsWith("https://"), `${p}: baseUrl`).toBe(true);
      }
      expect(FALLBACK_MODELS[p].model.length, `${p}: model vazio`).toBeGreaterThan(0);
    }
  });

  it("lê catálogo real e retorna modelo preferred", async () => {
    const { getProviderConfig } = await import("../server/server");
    const cfg = getProviderConfig("NVIDIA");
    expect(cfg.baseUrl).toBe("https://integrate.api.nvidia.com");
    expect(cfg.model).toBeTypeOf("string");
    expect(cfg.model.length).toBeGreaterThan(0);
  });

  it("todos os providers com visão têm config válida via catálogo", async () => {
    const { getProviderConfig } = await import("../server/server");
    const providers = ["NVIDIA", "GOOGLE", "OPENAI", "ANTHROPIC", "MISTRAL", "OPENROUTER", "LOCAL_OLLAMA", "OLLAMA_CLOUD", "CODEX"];
    for (const p of providers) {
      const cfg = getProviderConfig(p);
      expect(cfg.baseUrl, `${p}: baseUrl`).toBeTypeOf("string");
      if (p !== "MISTRAL" && p !== "LOCAL_OLLAMA") {
        expect(cfg.baseUrl.startsWith("https://"), `${p}: baseUrl não é https`).toBe(true);
      }
      expect(cfg.model, `${p}: model vazio`).not.toBe("");
    }
  });

  it("modelos do catálogo não são os antigos descontinuados", async () => {
    const { getProviderConfig } = await import("../server/server");
    // Modelos que sabemos que foram descontinuados/lentos e não devem ser o default
    expect(getProviderConfig("ANTHROPIC").model).not.toBe("claude-3-sonnet-20240229");
    expect(getProviderConfig("MISTRAL").model).not.toBe("open-mistral-vision");
    // NVIDIA default agora é llama-3.2-11b-vision (nano-8b entrou em EOL em 2026-08-26)
    expect(getProviderConfig("NVIDIA").model).not.toBe("meta/llama-3.2-90b-vision-instruct");
    expect(getProviderConfig("NVIDIA").model).toBe("meta/llama-3.2-11b-vision-instruct");
    expect(getProviderConfig("OPENROUTER").model).toBe("google/gemma-4-26b-a4b-it:free");
  });
});

describe("Mock dos 8 provedores de IA", () => {
  const PORT = 3013;
  const BASE_URL = `http://localhost:${PORT}`;
  let testPdfBase64: string;
  let originalFetch: typeof globalThis.fetch;

  const providers = [
    "GOOGLE", "NVIDIA", "OPENAI", "ANTHROPIC",
    "MISTRAL", "OPENROUTER",
  ] as const;

  function mockResponseForProvider(provider: string) {
    const json = '{"isNotaFiscal":false,"companyName":"Mock","valor":100.50,"documentType":"outros"}';
    if (provider === "GOOGLE") {
      return { candidates: [{ content: { parts: [{ text: json }] } }] };
    }
    if (provider === "ANTHROPIC") {
      return { content: [{ text: json }] };
    }
    return { choices: [{ message: { content: json } }] };
  }

  beforeAll(async () => {
    originalFetch = globalThis.fetch;
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    await startServer(PORT, false);
    const fixturePath = path.join(__dirname, "fixtures", "text.pdf");
    testPdfBase64 = fs.readFileSync(fixturePath).toString("base64");
    await new Promise(r => setTimeout(r, 500));
  });

  afterAll(() => {
    stopServer();
    if (savedSettings) {
      fs.writeFileSync(SETTINGS_FILE, savedSettings, "utf8");
    } else if (fs.existsSync(SETTINGS_FILE)) {
      fs.unlinkSync(SETTINGS_FILE);
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each(providers)("deve processar com provider %s usando catálogo externalizado", async (provider) => {
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify({ provider, apiKey: "mock-key" }));

    let capturedUrl = "";
    let capturedBody: any;
    vi.spyOn(globalThis as any, "fetch").mockImplementation(
      (url: string | URL, init?: any) => {
        const urlStr = url.toString();
        if (urlStr.includes(`localhost:${PORT}`) || urlStr.includes(`127.0.0.1:${PORT}`)) {
          return originalFetch(url, init);
        }
        capturedUrl = urlStr;
        capturedBody = init?.body ? JSON.parse(init.body) : undefined;
        const body = mockResponseForProvider(provider);
        return Promise.resolve(new Response(JSON.stringify(body), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }));
      }
    );

    const response = await fetch(`${BASE_URL}/api/extract`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pdfBase64: testPdfBase64, originalName: "test.pdf", pageIndex: 0 }),
    });

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.companyName).toBe("Mock");
    // Valida que o modelo veio do catálogo (não é mais o hardcoded antigo descontinuado)
    if (provider === "ANTHROPIC" && capturedBody) {
      expect(capturedBody.model).not.toBe("claude-3-sonnet-20240229");
    }
    if (provider === "MISTRAL" && capturedBody) {
      expect(capturedBody.model).not.toBe("open-mistral-vision");
    }
  });
});