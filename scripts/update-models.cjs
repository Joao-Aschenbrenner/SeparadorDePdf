#!/usr/bin/env node
// scripts/update-models.cjs
// Atualiza server/models.json consultando /v1/models (ou equivalente) de cada provider.
// Roda localmente (npm run update-models) e mensalmente via .github/workflows/update-models.yml.
// Requer as chaves das APIs em variáveis de ambiente:
//   NVIDIA_API_KEY, GOOGLE_API_KEY, OPENAI_API_KEY, ANTHROPIC_API_KEY,
//   MISTRAL_API_KEY, OPENROUTER_API_KEY, GROQ_API_KEY
// Providers sem chave são pulados (mantêm os modelos atuais do catálogo).

const fs = require("fs");
const path = require("path");

const CATALOG_PATH = path.join(__dirname, "..", "server", "models.json");

// Providers com schema OpenAI-compatível (data[].id) — exceto Google e Anthropic.
const OPENAI_COMPAT = {
  NVIDIA: { url: "https://integrate.api.nvidia.com/v1/models", envKey: "NVIDIA_API_KEY", keywords: ["vision", "vl", "image", "multimodal", "scout", "nemotron-vision", "pixtral"] },
  OPENAI: { url: "https://api.openai.com/v1/models", envKey: "OPENAI_API_KEY", keywords: ["gpt-4o", "vision"] },
  MISTRAL: { url: "https://api.mistral.ai/v1/models", envKey: "MISTRAL_API_KEY", keywords: ["pixtral", "vision"] },
  OPENROUTER: { url: "https://openrouter.ai/api/v1/models", envKey: "OPENROUTER_API_KEY", keywords: ["gemini", "vision", "vl", "pixtral", "llama-4"], filterPrefix: "google/" },
  GROQ: { url: "https://api.groq.com/openai/v1/models", envKey: "GROQ_API_KEY", keywords: ["vision", "vl", "scout", "llama-4"] },
};

const GOOGLE = {
  url: (key) => `https://generativelanguage.googleapis.com/v1beta/models?key=${key}`,
  envKey: "GOOGLE_API_KEY",
  // Google lista modelos que suportam generateContent; filtramos por Gemini e por suporte a imagem.
  parseModels: (data) => (Array.isArray(data.models) ? data.models.map((m) => m.name.replace(/^models\//, "")) : []),
  keywords: ["gemini"],
};

const ANTHROPIC = {
  url: "https://api.anthropic.com/v1/models",
  envKey: "ANTHROPIC_API_KEY",
  extraHeaders: { "anthropic-version": "2023-06-01" },
  keywords: ["claude", "sonnet", "opus"],
};

function log(msg) { console.log(`[update-models] ${msg}`); }
function warn(msg) { console.warn(`[update-models] WARN: ${msg}`); }

function isVisionModel(name, keywords) {
  const lower = String(name).toLowerCase();
  return keywords.some((k) => lower.includes(k.toLowerCase()));
}

function pickPreferred(models, preferredList, keywords) {
  // Filtra apenas modelos que parecem suportar visão (por keywords) e existem na lista.
  const visionModels = models.filter((m) => isVisionModel(m, keywords));
  if (visionModels.length === 0) {
    warn(`Nenhum modelo de visão encontrado por keywords=${JSON.stringify(keywords)}; mantendo lista completa.`);
    return models;
  }
  // Usa a ordem de preferred: primeiro modelo de preferred que apareça nos visionModels.
  const ordered = [];
  for (const p of preferredList || []) {
    if (visionModels.includes(p) && !ordered.includes(p)) ordered.push(p);
  }
  // Completa com os demais visionModels (preservando ordem da API).
  for (const m of visionModels) {
    if (!ordered.includes(m)) ordered.push(m);
  }
  return ordered;
}

async function fetchJson(url, headers) {
  const res = await fetch(url, { headers });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

function extractOpenAICompatModels(data) {
  if (Array.isArray(data.data)) return data.data.map((m) => m.id).filter(Boolean);
  if (Array.isArray(data.models)) return data.models.map((m) => (typeof m === "string" ? m : m.id || m.name)).filter(Boolean);
  return [];
}

async function updateProvider(catalog, providerName) {
  const entry = catalog.providers[providerName];
  if (!entry) { warn(`Provider ${providerName} não está no catálogo, pulando.`); return false; }

  if (providerName === "GOOGLE") {
    const key = process.env[GOOGLE.envKey];
    if (!key) { warn(`${GOOGLE.envKey} não definida, mantendo modelos atuais de GOOGLE.`); return false; }
    try {
      const data = await fetchJson(GOOGLE.url(key), {});
      let models = GOOGLE.parseModels(data);
      // Filtra apenas gemini (ignora embedding, etc.) e que suportam generateContent.
      if (Array.isArray(data.models)) {
        models = data.models
          .filter((m) => Array.isArray(m.supportedGenerationMethods) && m.supportedGenerationMethods.includes("generateContent"))
          .map((m) => m.name.replace(/^models\//, ""));
      }
      models = pickPreferred(models, entry.preferred, GOOGLE.keywords);
      if (models.length === 0) { warn("Google retornou 0 modelos de visão, mantendo atuais."); return false; }
      entry.models = models;
      log(`GOOGLE: ${models.length} modelos. Primeiro: ${models[0]}`);
      return true;
    } catch (e) { warn(`Falha GOOGLE: ${e.message}`); return false; }
  }

  if (providerName === "ANTHROPIC") {
    const key = process.env[ANTHROPIC.envKey];
    if (!key) { warn(`${ANTHROPIC.envKey} não definida, mantendo modelos atuais de ANTHROPIC.`); return false; }
    try {
      const data = await fetchJson(ANTHROPIC.url, { "x-api-key": key, ...ANTHROPIC.extraHeaders });
      let models = extractOpenAICompatModels(data);
      models = pickPreferred(models, entry.preferred, ANTHROPIC.keywords);
      if (models.length === 0) { warn("Anthropic retornou 0 modelos, mantendo atuais."); return false; }
      entry.models = models;
      log(`ANTHROPIC: ${models.length} modelos. Primeiro: ${models[0]}`);
      return true;
    } catch (e) { warn(`Falha ANTHROPIC: ${e.message}`); return false; }
  }

  const cfg = OPENAI_COMPAT[providerName];
  if (!cfg) { warn(`Provider ${providerName} sem configuração de fetch, pulando.`); return false; }
  const key = process.env[cfg.envKey];
  if (!key) { warn(`${cfg.envKey} não definida, mantendo modelos atuais de ${providerName}.`); return false; }
  try {
    const data = await fetchJson(cfg.url, { Authorization: `Bearer ${key}` });
    let models = extractOpenAICompatModels(data);
    if (cfg.filterPrefix) models = models.filter((m) => m.startsWith(cfg.filterPrefix));
    models = pickPreferred(models, entry.preferred, cfg.keywords);
    if (models.length === 0) { warn(`${providerName} retornou 0 modelos de visão, mantendo atuais.`); return false; }
    entry.models = models;
    log(`${providerName}: ${models.length} modelos. Primeiro: ${models[0]}`);
    return true;
  } catch (e) { warn(`Falha ${providerName}: ${e.message}`); return false; }
}

async function main() {
  if (!fs.existsSync(CATALOG_PATH)) { console.error(`[update-models] Catálogo não encontrado: ${CATALOG_PATH}`); process.exit(1); }
  const catalog = JSON.parse(fs.readFileSync(CATALOG_PATH, "utf8"));
  const providers = Object.keys(catalog.providers);
  log(`Atualizando ${providers.length} providers: ${providers.join(", ")}`);

  let anyChanged = false;
  for (const p of providers) {
    const changed = await updateProvider(catalog, p);
    if (changed) anyChanged = true;
  }

  if (!anyChanged) {
    log("Nenhum provider foi atualizado (faltam chaves ou todas falharam). Mantendo catálogo atual.");
    process.exit(0);
  }

  catalog._updated = new Date().toISOString().slice(0, 10);
  fs.writeFileSync(CATALOG_PATH, JSON.stringify(catalog, null, 2) + "\n", "utf8");
  log(`Catálogo atualizado em ${CATALOG_PATH} (_updated=${catalog._updated}).`);
}

main().catch((e) => { console.error("[update-models] Erro fatal:", e); process.exit(2); });