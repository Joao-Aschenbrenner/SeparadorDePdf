import express from "express";
import path from "path";
import fs from "fs";
import os from "os";
import dotenv from "dotenv";

dotenv.config();

const DEFAULT_PORT = 3001;
const DATA_DIR = path.join(os.homedir(), ".ai-disec-pdf");
const SETTINGS_FILE = path.join(DATA_DIR, "settings.json");

// Catálogo de modelos: lê server/models.json (atualizado mensalmente via CI).
// Fallback hardcoded caso o arquivo não exista ou esteja corrompido.
const FALLBACK_MODELS: Record<string, { baseUrl: string; model: string }> = {
  NVIDIA: { baseUrl: "https://integrate.api.nvidia.com", model: "meta/llama-3.2-90b-vision-instruct" },
  GOOGLE: { baseUrl: "https://generativelanguage.googleapis.com", model: "gemini-2.5-flash" },
  OPENAI: { baseUrl: "https://api.openai.com", model: "gpt-4o" },
  ANTHROPIC: { baseUrl: "https://api.anthropic.com", model: "claude-sonnet-4-20250514" },
  MISTRAL: { baseUrl: "https://api.mistral.ai", model: "pixtral-12b-2409" },
  OPENROUTER: { baseUrl: "https://openrouter.ai/api", model: "google/gemini-2.5-flash" },
  GROQ: { baseUrl: "https://api.groq.com/openai", model: "meta-llama/llama-4-scout-17b-16e-instruct" },
  LOCAL_OLLAMA: { baseUrl: "http://localhost:11434", model: "llama3.2-vision:11b" },
  OLLAMA_CLOUD: { baseUrl: "https://chat.api.ollama.ai", model: "llama3.2-vision:11b" },
  CODEX: { baseUrl: "https://api.codex.ai", model: "gpt-4o" },
};

interface ModelsCatalog {
  _updated?: string;
  providers: Record<string, {
    baseUrl: string;
    models: string[];
    modelsEndpoint?: string;
    visionKeywords?: string[];
    preferred?: string[];
    local?: boolean;
    downloadSizes?: Record<string, string>;
    minRamGB?: Record<string, number>;
  }>;
}

let cachedCatalog: ModelsCatalog | null = null;

function loadModelsCatalog(): ModelsCatalog {
  if (cachedCatalog) return cachedCatalog;
  // Resolve models.json em múltiplos caminhos candidatos (dev tsx, bundle dist/, Electron asar)
  const candidates = [
    path.join(__dirname, "models.json"),
    path.join(__dirname, "..", "server", "models.json"),
    path.join(process.cwd(), "server", "models.json"),
    path.join(process.cwd(), "models.json"),
  ];
  for (const catalogPath of candidates) {
    try {
      if (fs.existsSync(catalogPath)) {
        const raw = fs.readFileSync(catalogPath, "utf8");
        const parsed = JSON.parse(raw);
        if (parsed && parsed.providers && typeof parsed.providers === "object") {
          cachedCatalog = parsed;
          console.log(`[models] Catálogo carregado de ${catalogPath}`);
          return parsed;
        }
      }
    } catch (e) {
      // tenta próximo candidato
    }
  }
  console.warn("[models] models.json não encontrado em nenhum candidato, usando fallback hardcoded.");
  const fallback: ModelsCatalog = {
    providers: Object.fromEntries(
      Object.entries(FALLBACK_MODELS).map(([k, v]) => [k, { baseUrl: v.baseUrl, models: [v.model], preferred: [v.model] }])
    ),
  };
  cachedCatalog = fallback;
  return fallback;
}

function getProviderConfig(provider: string): { baseUrl: string; model: string } {
  const catalog = loadModelsCatalog();
  const entry = catalog.providers[provider];
  if (entry && entry.models && entry.models.length > 0) {
    const preferred = entry.preferred && entry.preferred.length > 0 ? entry.preferred[0] : entry.models[0];
    const chosen = entry.models.includes(preferred) ? preferred : entry.models[0];
    return { baseUrl: entry.baseUrl, model: chosen };
  }
  const fb = FALLBACK_MODELS[provider];
  if (fb) return fb;
  return FALLBACK_MODELS.NVIDIA;
}

export { loadModelsCatalog, getProviderConfig, FALLBACK_MODELS };

let serverInstance: any = null;

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

// Função auxiliar para registrar logs em arquivo
async function logError(message: string, error?: any) {
  ensureDataDir();
  const logPath = path.join(DATA_DIR, "ocr.log");
  const timestamp = new Date().toISOString();
  let entry = `[${timestamp}] ${message}`;
  if (error) {
    const errMsg = error instanceof Error ? error.message : JSON.stringify(error);
    entry += ` – ${errMsg}`;
  }
  entry += "\n";
  try {
    await fs.promises.appendFile(logPath, entry, { encoding: "utf8" });
  } catch (e) {
    console.error("Failed to write log file", e);
  }
}

async function logUpload(originalName: string, pageIndex: number, status: string, provider: string, detail: string, metadata?: any) {
  ensureDataDir();
  const logPath = path.join(DATA_DIR, "uploads.log");
  const entry = JSON.stringify({
    timestamp: new Date().toISOString(),
    originalName,
    pageIndex,
    status,
    provider,
    detail,
    metadata
  }) + "\n";
  try {
    await fs.promises.appendFile(logPath, entry, { encoding: "utf8" });
  } catch (e) {
    console.error("Failed to write upload log", e);
  }
}

function extractAIError(status: number, body: string): { userMessage: string; retryAfter?: string } {
  try {
    const parsed = JSON.parse(body);
    // Normaliza mensagem de erro de qualquer provider
    const msg = parsed.error?.message || parsed.error?.error?.message || parsed.detail || parsed.error || "";
    if (typeof msg === "object") {
      return { userMessage: JSON.stringify(msg).substring(0, 200) };
    }
    const msgStr = String(msg);
    if (status === 429 || msgStr.includes("quota") || msgStr.includes("rate limit")) {
      return { userMessage: "Cota da API excedida. Aguarde alguns minutos ou faça upgrade no plano.", retryAfter: msgStr.match(/([\d.]+)\s*s(?:ec)?/)?.at(1) + "s" || "60s" };
    }
    if (msgStr.includes("does not support image") || msgStr.includes("not support image input")) {
      return { userMessage: "Este modelo de IA não suporta análise de imagens. Vá em Configurações e escolha outro provedor compatível." };
    }
    if (msgStr.includes("does not support pdf") || msgStr.includes("not support pdf input") || msgStr.includes("Cannot read")) {
      return { userMessage: "O provedor de IA não conseguiu processar esta página (formato de imagem inválido). Tente reprocessar ou trocar de provedor nas Configurações." };
    }
    if (msgStr.includes("API key") || msgStr.includes("invalid") || msgStr.includes("unauthorized") || status === 401 || status === 403) {
      return { userMessage: "Chave de API inválida ou sem acesso ao modelo. Verifique suas configurações." };
    }
    return { userMessage: msgStr.length > 200 ? msgStr.slice(0, 200) + "…" : msgStr };
  } catch {}
  if (status === 429) {
    return { userMessage: "Muitas requisições. Aguarde um momento e tente novamente.", retryAfter: "60s" };
  }
  if (status === 401 || status === 403) {
    return { userMessage: "Chave de API inválida ou sem acesso ao modelo. Verifique suas configurações." };
  }
  if (status >= 500) {
    return { userMessage: "Serviço temporariamente indisponível. Tente novamente mais tarde." };
  }
  return { userMessage: body.length > 200 ? body.slice(0, 200) + "…" : body };
}

// Tenta corrigir JSON mal formatado retornado pela IA
function fixJSON(raw: string): string {
  let s = raw.trim();
  s = s.replace(/'/g, '"');
  s = s.replace(/(\{|,)\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g, '$1"$2":');
  s = s.replace(/,\s*([}\]])/g, '$1');
  s = s.replace(/,+/g, ',');
  s = s.replace(/,\s*$/, '');
  s = s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  // Fix Brazilian number format: 1.234,56 -> 1234.56
  s = s.replace(/(\d+)\.(\d{3}),(\d{2})(?=[,}\]])/g, '$1$2.$3');
  return s;
}

export { fixJSON };
export async function startServer(port: number = DEFAULT_PORT, isDev: boolean = false) {
  const app = express();
  const PORT = port;

  app.use(express.json({ limit: "50mb" }));

  app.post("/api/extract", async (req, res) => {
    try {
      const { pdfBase64, originalName, pageIndex, correction } = req.body;

      if (!pdfBase64) {
        return res.status(400).json({ error: "Faltando dados do PDF (pdfBase64)." });
      }

      const settings = getSettings();
      const apiKey = settings.apiKey || "";
      if (!apiKey) {
        return res.status(500).json({
          error: "Nenhuma chave de API configurada. Vá em Configurações e adicione sua chave."
        });
      }

       console.log(`[AI OCR] Processando página ${pageIndex + 1} de ${originalName}...`);
       console.log(`[AI OCR] Tamanho do base64: ${pdfBase64.length} caracteres`);

      // O cliente já converteu o PDF em JPEG (ou PNG) base64; usamos diretamente
      const imageBase64 = pdfBase64;
       console.log(`[AI OCR] Usando imagem base64 enviada pelo cliente (${imageBase64.length} caracteres)`);

      // Aviso se os dados não parecem JPEG (debug)
      try {
        const head = Buffer.from(imageBase64.substring(0, 4), 'base64');
        if (head.length >= 3 && !(head[0] === 0xFF && head[1] === 0xD8 && head[2] === 0xFF)) {
          console.warn(`[AI OCR] Dados não iniciam com magic bytes JPEG: ${head.toString('hex')}`);
        }
      } catch (e) { /* ignora erro de validação */ }

      const prompt = `Analise este documento PDF (uma única página) e retorne SOMENTE um JSON.

REGRAS:
- Se for NOTA FISCAL (fatura, NF-e, NFS-e, cupom, CT-e, recibo): {"isNotaFiscal":true, "notaNumber":"NUMERO", "companyName":"EMPRESA", "valor":NUMERO, "pessoaNome":null, "documentType":"nota_fiscal"}
  IMPORTANTE para NFS-e: NFS-e tem DOIS campos de razão social — "Prestador do Serviço" (emitente) e "Tomador do Serviço" (cliente). companyName DEVE ser a RAZÃO SOCIAL do PRESTADOR (emitente), NUNCA do tomador. Procure "Prestador", "Emitente", "Dados do Prestador". Ignore "Tomador", "Cliente", "Contratante", "Dados do Tomador". NUNCA use "Secretaria da Fazenda", "Sefaz", "Prefeitura Municipal" ou nome de órgão público/sistema como companyName.
- Se for EXTRATO BANCÁRIO: {"isNotaFiscal":false, "notaNumber":null, "companyName":"BANCO", "valor":NUMERO, "pessoaNome":null, "documentType":"extrato"}
- Se for DARF: {"isNotaFiscal":false, "notaNumber":null, "companyName":"darf", "valor":NUMERO, "pessoaNome":null, "documentType":"darf"}
- Se for FOLHA DE PAGAMENTO / HOLERITE / CONTRA-CHEQUE / FOLHA MENSAL / FICHA FINANCEIRA: {"isNotaFiscal":false, "notaNumber":null, "companyName":"EMPRESA", "valor":null, "pessoaNome":"NOME DO FUNCIONARIO", "documentType":"folha_pagamento"}

  REGRAS OBRIGATÓRIAS para holerites/folha de pagamento (SIGA ESTRITAMENTE):

  ═══ REGRA 1: IDENTIFICAÇÃO ═══
  Para classificar como folha_pagamento, o documento deve conter 3+ destes termos:
  "Vencimentos", "Descontos", "Salário Base", "Base Calc. FGTS", "Base Cálc. IRRF", "F.G.T.S", "INSS",
  "IMPOSTO DE RENDA", "Demonstrativo de Pagamento", "Recibo de Salário", "Contra-Cheque",
  "Funcionário:", "Empregador:", "Admissão", "Departamento", "MENSALISTA".
  Se sim → documentType="folha_pagamento".

  ═══ REGRA 2: MULTIPLICIDADE — 2 HOLERITES NA MESMA PÁGINA ═══
  MUITO IMPORTANTE: Cada folha PODE conter DOIS holerites completos e independentes,
  geralmente divididos horizontalmente (um superior e um inferior na mesma página).
  Cada holerite pertence a um FUNCIONÁRIO DIFERENTE.
  - Se houver 2 holerites → retorne ARRAY com 2 objetos: [{...func1...}, {...func2...}]
  - Cada objeto deve ter seu próprio pessoaNome e companyName.
  - NÃO misture dados dos dois holerites. Holerite superior = funcionário 1, Holerite inferior = funcionário 2.
  - NÃO trate a página inteira como um único holerite. Verifique SEMPRE se há 2 fichas.

  ═══ REGRA 3: EXCLUSÃO DE CARIMBO — PREFEITURA / ÓRGÃO PÚBLICO ═══
  REGRA ABSOLUTA: IGNORE completamente qualquer carimbo, selo ou estampa sobreposta no documento.
  Carimbos comuns: "PREFEITURA MUNICIPAL DE ...", "Pago com Recurso do Termo de Colaboração",
  "DEPARTAMENTO DE ...", qualquer texto carimbado por cima da tabela.
  - O carimbo NÃO é o empregador. NÃO é o companyName.
  - O carimbo NÃO altera o tipo do documento. NÃO é imposto, NÃO é nota fiscal.
  - companyName (EMPREGADOR) = SEMPRE o nome impresso no CABEÇALHO/TOPO ESQUERDO do holerite.
    Exemplo: se o cabeçalho diz "SANTA CASA DE MISERICORDIA DE TAQUARITUBA" e há carimbo da
    "PREFEITURA MUNICIPAL", companyName = "SANTA CASA DE MISERICORDIA DE TAQUARITUBA".
  - Se o ÚNICO nome legível for o do carimbo (nenhum outro nome no cabeçalho) →
    companyName="CARIMBO", documentType="nao_identificado"
  - Se identificar o tipo de documento mas o carimbo é o ÚNICO nome legível →
    retorne o documento normal mas com companyName="CARIMBO"

  ═══ REGRA 4: valor SEMPRE null ═══
  Para holerites, o campo "valor" deve ser SEMPRE null. NÃO tente extrair Valor Líquido,
  Salário Base ou qualquer valor numérico. Apenas identifique o pessoaNome e companyName.
- Se for PLANILHA/TABELA: {"isNotaFiscal":false, "notaNumber":null, "companyName":"DESCRICAO", "valor":null, "pessoaNome":null, "documentType":"planilha"}
- Se for outro imposto/guia/boleto/taxa: {"isNotaFiscal":false, "notaNumber":null, "companyName":"TRIBUTO", "valor":NUMERO, "pessoaNome":null, "documentType":"imposto"}
- Se tiver APENAS carimbo/logo de PREFEITURA ou órgão público e NÃO conseguir identificar o tipo do documento (nenhum holerite, nenhuma NF, nenhum extrato visível): {"isNotaFiscal":false, "notaNumber":null, "companyName":"CARIMBO", "valor":null, "pessoaNome":null, "documentType":"nao_identificado"}
- Se o documento for holerite mas o ÚNICO nome legível for de carimbo (sem cabeçalho de empresa): {"isNotaFiscal":false, "notaNumber":null, "companyName":"CARIMBO", "valor":null, "pessoaNome":"NOME", "documentType":"folha_pagamento"}
- Se não encaixar em nada acima: {"isNotaFiscal":false, "notaNumber":null, "companyName":"DESCRICAO", "valor":null, "pessoaNome":null, "documentType":"outros"}

IMPORTANTE: Se a página contiver MAIS DE UM documento (ex: 2 holerites lado a lado, ou um holerite em cima e outro embaixo), retorne um ARRAY de objetos: [{...documento1...}, {...documento2...}].

Se não encontrar valor, coloque null. Não invente números.
NÃO escreva NADA antes ou depois do JSON. NÃO use markdown. NÃO use **. A resposta deve COMEÇAR com { ou [ e TERMINAR com } ou ].

${correction ? `OBSERVAÇÃO DO USUÁRIO: ${correction}. Reavalie o documento com atenção especial nestes campos.\n` : ""}`;

// Seleciona provedor de IA
       const provider = settings.provider || "GOOGLE";
       let aiResponse;
       try {
         // Helper for OpenAI-compatible providers (OpenRouter, Groq, NVIDIA)
         interface OpenAICompatConfig { baseUrl: string; model: string; apiKey: string; }
         const callOpenAICompatible = (config: OpenAICompatConfig, image: string, promptText: string) => {
           return fetch(`${config.baseUrl}/v1/chat/completions`, {
             method: "POST",
             headers: { "Content-Type": "application/json", "Authorization": `Bearer ${config.apiKey}` },
             body: JSON.stringify({
               model: config.model,
               messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: `data:image/jpeg;base64,${image}`, detail: "high" } }, { type: "text", text: promptText }] }],
               temperature: 0.1,
               max_tokens: 1024,
             }),
           });
         };

          if (provider === "GOOGLE") {
            if (!apiKey) throw new Error("Chave de API Google não configurada.");
            const googleModel = getProviderConfig("GOOGLE").model;
            const googleUrl = `https://generativelanguage.googleapis.com/v1beta/models/${googleModel}:generateContent?key=${apiKey}`;
            console.log(`[AI] Enviando para Google Gemini (${googleModel})...`);
            aiResponse = await fetch(googleUrl, {
             method: "POST",
             headers: { "Content-Type": "application/json" },
             body: JSON.stringify({
               contents: [{ role: "user", parts: [{ inlineData: { mimeType: "image/jpeg", data: imageBase64 } }, { text: prompt }] }]
             })
           });
          } else if (provider === "OPENAI") {
            if (!apiKey) throw new Error("Chave de API OpenAI não configurada.");
            const openaiModel = getProviderConfig("OPENAI").model;
            console.log(`[AI] Enviando para OpenAI (${openaiModel})...`);
            aiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
              method: "POST",
              headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
              body: JSON.stringify({
                model: openaiModel,
               messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: `data:image/jpeg;base64,${imageBase64}`, detail: "high" } }, { type: "text", text: prompt }] }],
               temperature: 0.1,
               max_tokens: 1024,
               top_p: 0.9
             })
           });
          } else if (provider === "ANTHROPIC") {
            if (!apiKey) throw new Error("Chave de API Anthropic não configurada.");
            const anthropicModel = getProviderConfig("ANTHROPIC").model;
            console.log(`[AI] Enviando para Anthropic Claude (${anthropicModel})...`);
            aiResponse = await fetch("https://api.anthropic.com/v1/messages", {
              method: "POST",
              headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
              body: JSON.stringify({
                model: anthropicModel,
               max_tokens: 1024,
               messages: [{ role: "user", content: [{ type: "image", source: { type: "base64", media_type: "image/jpeg", data: imageBase64 } }, { type: "text", text: prompt }] }]
             })
           });
          } else if (provider === "MISTRAL") {
            if (!apiKey) throw new Error("Chave de API Mistral não configurada.");
            const mistralModel = getProviderConfig("MISTRAL").model;
            console.log(`[AI] Enviando para Mistral (${mistralModel})...`);
            aiResponse = await fetch("https://api.mistral.ai/v1/chat/completions", {
              method: "POST",
              headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
              body: JSON.stringify({
                model: mistralModel,
               messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: `data:image/jpeg;base64,${imageBase64}`, detail: "high" } }, { type: "text", text: prompt }] }],
               temperature: 0.1,
               max_tokens: 1024,
               top_p: 0.9
             })
           });
            } else if (provider === "OPENROUTER") {
              if (!apiKey) throw new Error("Chave de API OpenRouter não configurada.");
              const openrouterModel = getProviderConfig("OPENROUTER").model;
              console.log(`[AI] Enviando para OpenRouter (${openrouterModel})...`);
              aiResponse = await callOpenAICompatible({ baseUrl: "https://openrouter.ai/api", model: openrouterModel, apiKey }, imageBase64, prompt);
            } else if (provider === "GROQ") {
              if (!apiKey) throw new Error("Chave de API Groq não configurada.");
              const groqModel = getProviderConfig("GROQ").model;
              console.log(`[AI] Enviando para Groq (${groqModel})...`);
              aiResponse = await callOpenAICompatible({ baseUrl: "https://api.groq.com/openai", model: groqModel, apiKey }, imageBase64, prompt);
            } else if (provider === "LOCAL_OLLAMA") {
              // Ollama local — sem chave de API. Endpoint /api/chat (não /v1/chat/completions).
              const ollamaConfig = getProviderConfig("LOCAL_OLLAMA");
              console.log(`[AI] Enviando para Ollama local (${ollamaConfig.model})...`);
              aiResponse = await fetch(`${ollamaConfig.baseUrl}/api/chat`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  model: ollamaConfig.model,
                  messages: [{ role: "user", content: prompt }],
                  images: [imageBase64],
                  stream: false,
                  options: { temperature: 0.1 }
                }),
              });
            } else if (provider === "OLLAMA_CLOUD") {
              if (!apiKey) throw new Error("Token Ollama Cloud não configurado. Obtenha em https://ollama.com/signup.");
              const ollamaCloudModel = getProviderConfig("OLLAMA_CLOUD").model;
              console.log(`[AI] Enviando para Ollama Cloud (${ollamaCloudModel})...`);
              aiResponse = await callOpenAICompatible({ baseUrl: "https://chat.api.ollama.ai", model: ollamaCloudModel, apiKey }, imageBase64, prompt);
            } else if (provider === "CODEX") {
              if (!apiKey) throw new Error("Login Codex necessário. Use o botão de login no app para autenticar.");
              const codexModel = getProviderConfig("CODEX").model;
              console.log(`[AI] Enviando para Codex (${codexModel})...`);
              aiResponse = await callOpenAICompatible({ baseUrl: "https://api.codex.ai", model: codexModel, apiKey }, imageBase64, prompt);
            } else {
              // NVIDIA (padrão)
              const nvidiaModel = getProviderConfig("NVIDIA").model;
              console.log(`[AI] Enviando para NVIDIA (${nvidiaModel})...`);
              aiResponse = await callOpenAICompatible({ baseUrl: "https://integrate.api.nvidia.com", model: nvidiaModel, apiKey }, imageBase64, prompt);
            }
} catch (aiErr) {
          await logError("Falha ao chamar o provedor de IA", aiErr);
          throw aiErr;
        }

       if (!aiResponse.ok) {
         const errBody = await aiResponse.text();
         console.error("[AI API Error]:", aiResponse.status, errBody);
         const { userMessage, retryAfter } = extractAIError(aiResponse.status, errBody);
         return res.status(aiResponse.status).json({ error: userMessage, retryAfter });
       }

       const data = await aiResponse.json();
       let responseText = "";
       if (provider === "GOOGLE") {
         const candidates = data.candidates?.[0]?.content?.parts;
         responseText = candidates?.map((p: any) => p.text).filter(Boolean).join("") || "";
        } else if (provider === "ANTHROPIC") {
          responseText = data.content?.[0]?.text || "";
        } else if (provider === "LOCAL_OLLAMA") {
          // Ollama /api/chat retorna { message: { content: "..." } }
          responseText = data.message?.content || data.response || "";
        } else {
          responseText = data.choices?.[0]?.message?.content || "";
        }

        console.log("[AI OCR] Resposta recebida:", responseText?.substring(0, 200));

      if (!responseText) {
        throw new Error("O modelo de IA retornou uma resposta vazia.");
      }

      const cleaned = responseText
        .replace(/```(?:json)?\s*\n?/gi, "")
        .replace(/\n?```\s*$/g, "")
        // Remove ALL asterisks (markdown bold/italic) — * is meaningless in JSON
        .replace(/\*+/g, "")
        .trim();

      // Extract JSON from response: find first [ or { and matching closing bracket
      const trimmed = cleaned;
      let jsonStr: string;
      if (trimmed.startsWith("[")) {
        const arrEnd = trimmed.lastIndexOf("]");
        if (arrEnd === -1) throw new Error("Array JSON não tem fechamento ]");
        jsonStr = trimmed.substring(0, arrEnd + 1);
      } else {
        const jsonStart = trimmed.indexOf("{");
        const jsonEnd = trimmed.lastIndexOf("}");
        if (jsonStart === -1 || jsonEnd === -1) {
          await logUpload(originalName, pageIndex, "error", provider, `Sem JSON na resposta: ${responseText.substring(0, 200)}`);
          throw new Error(`Resposta da IA não contém JSON válido: ${responseText.substring(0, 200)}`);
        }
        jsonStr = trimmed.substring(jsonStart, jsonEnd + 1);
      }

      // Try to parse; if fails, attempt to fix common JSON errors
      let extractedData: any;
      let parseSucceeded = false;
      for (const attempt of [jsonStr, fixJSON(jsonStr)]) {
        try {
          extractedData = JSON.parse(attempt);
          parseSucceeded = true;
          break;
        } catch {}
      }
      if (!parseSucceeded) {
        await logUpload(originalName, pageIndex, "error", provider, `JSON inválido: ${jsonStr.substring(0, 500)}`);
        throw new Error(`Erro ao interpretar resposta da IA. JSON bruto: ${responseText.substring(0, 300)}`);
      }

      // If the response is an array (multiple documents per page), handle each
      if (Array.isArray(extractedData)) {
        await logUpload(originalName, pageIndex, "success", provider, `Array com ${extractedData.length} documentos`, extractedData);
        return res.json({ _multiple: true, documents: extractedData });
      }

      await logUpload(originalName, pageIndex, "success", provider, "OK", extractedData);
      return res.json(extractedData);

    } catch (error: any) {
       await logError("Unhandled exception in /api/extract", error);
       await logUpload(req.body?.originalName || "unknown", req.body?.pageIndex ?? -1, "error", "unknown", error.message || "Erro desconhecido");
       console.error("[AI OCR Error]:", error);
       return res.status(500).json({
         error: error.message || "Erro desconhecido ao processar documento."
       });
     }
  });

// ─── Settings API ──────────────────────────────────
app.get("/api/settings", (req, res) => {
  try {
    ensureDataDir();
    if (fs.existsSync(SETTINGS_FILE)) {
      const data = JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8"));
      return res.json(data);
    }
    return res.json({ provider: "NVIDIA", apiKey: "" });
  } catch {
    return res.json({ provider: "NVIDIA", apiKey: "" });
  }
});

app.post("/api/settings", (req, res) => {
  try {
    ensureDataDir();
    const { provider, apiKey } = req.body;
    if (!provider || apiKey === undefined) {
      return res.status(400).json({ error: "Provider e apiKey são obrigatórios." });
    }
    const settings = { provider: provider.toUpperCase(), apiKey };
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), "utf8");
    console.log(`[settings] Saved: provider=${settings.provider}`);
    return res.json({ success: true });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// Helper para ler settings (usado no /api/extract)
function getSettings() {
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      return JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8"));
    }
  } catch {}
  return { provider: "NVIDIA", apiKey: "" };
}

// ─── Upload Logs API ──────────────────────────────────
app.get("/api/logs", (req, res) => {
  try {
    ensureDataDir();
    const logPath = path.join(DATA_DIR, "uploads.log");
    if (!fs.existsSync(logPath)) {
      return res.json({ entries: [] });
    }
    const lines = fs.readFileSync(logPath, "utf8").split("\n").filter(Boolean);
    const entries = lines.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    // Return last 100 entries, newest first
    return res.json({ entries: entries.reverse().slice(0, 100) });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// ─── Vite / Static ─────────────────────────────────
  if (isDev) {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  return new Promise<void>((resolve) => {
    serverInstance = app.listen(PORT, "0.0.0.0", () => {
      console.log(`Server running on http://localhost:${PORT}`);
      resolve();
    });
  });
}

export function stopServer() {
  if (serverInstance) {
    serverInstance.close();
    serverInstance = null;
  }
}
