import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { startServer, stopServer } from "../server/server";
import fs from "fs";
import path from "path";
import os from "os";

const DATA_DIR = path.join(os.homedir(), ".ai-disec-pdf");
const SETTINGS_FILE = path.join(DATA_DIR, "settings.json");
const savedSettings = fs.existsSync(SETTINGS_FILE) ? fs.readFileSync(SETTINGS_FILE, "utf8") : null;

describe("Servidor de Extração (API)", () => {
  const PORT = 3002;
  const BASE_URL = `http://localhost:${PORT}`;
  let testPdfBase64: string;

  beforeAll(async () => {
    await startServer(PORT, false);
    const fixturePath = path.join(__dirname, "fixtures", "text.pdf");
    const pdfBuffer = fs.readFileSync(fixturePath);
    testPdfBase64 = pdfBuffer.toString("base64");
    await new Promise(r => setTimeout(r, 1000));
  });

  afterAll(() => {
    stopServer();
  });

  it("deve retornar erro quando pdfBase64 não for fornecido", async () => {
    const response = await fetch(`${BASE_URL}/api/extract`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toContain("Faltando dados do PDF");
  });

  it("deve converter PDF e enviar para API NVIDIA", async () => {
    const response = await fetch(`${BASE_URL}/api/extract`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        pdfBase64: testPdfBase64,
        originalName: "teste.pdf",
        pageIndex: 0,
      }),
    });

    console.log(`Status da requisição: ${response.status}`);
    const data = await response.json();
    console.log(`Resposta: ${JSON.stringify(data, null, 2)}`);

    if (response.status === 500) {
      expect(data.error).not.toContain("Falha ao converter PDF");
    }
  });
});

describe("Mock dos provedores de IA (catálogo externalizado)", () => {
  const PORT = 3003;
  const BASE_URL = `http://localhost:${PORT}`;
  let testPdfBase64: string;
  let originalFetch: typeof globalThis.fetch;

  const providers = [
    "GOOGLE", "NVIDIA", "OPENAI", "ANTHROPIC",
    "MISTRAL", "OPENROUTER", "GROQ",
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

  it.each(providers)("deve processar com provider %s", async (provider) => {
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify({ provider, apiKey: "mock-key" }));

    vi.spyOn(globalThis as any, "fetch").mockImplementation(
      (url: string | URL, init?: any) => {
        const urlStr = url.toString();
        if (urlStr.includes(`localhost:${PORT}`) || urlStr.includes(`127.0.0.1:${PORT}`)) {
          return originalFetch(url, init);
        }
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
  });
});
