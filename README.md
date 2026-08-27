<div align="center">

# AI Disec PDF

**Separador Inteligente de PDF com IA**

[![GitHub Release](https://img.shields.io/github/v/release/Joao-Aschenbrenner/ai-disec-pdf?style=for-the-badge&label=Download&color=6d28d9)](https://github.com/Joao-Aschenbrenner/ai-disec-pdf/releases/latest)
[![License: MIT](https://img.shields.io/badge/License-MIT-6d28d9?style=for-the-badge)](LICENSE)
![Version](https://img.shields.io/badge/version-1.4.11-6d28d9?style=for-the-badge)

</div>

Aplicação desktop (Electron + React) que divide PDFs contendo múltiplos documentos (notas fiscais, DARFs, holerites, extratos, boletos) em arquivos individuais, renomeados automaticamente com base no conteúdo de cada página via IA.

---

## Funcionalidades

- **Divisão inteligente** — extrai cada página de um PDF multifolha como arquivo independente
- **Renomeação automática** — IA identifica o tipo de documento (NF-e, DARF, holerite, extrato, imposto) e nomeia cada arquivo com dados relevantes (empresa, valor, número da nota, funcionário)
- **9 provedores de IA** — Google Gemini, OpenAI GPT-4o, Anthropic Claude, NVIDIA Llama Vision, Mistral OCR, OpenRouter, Ollama (local e cloud) e Codex
- **Editor manual** — corrija ou preencha metadados extraídos; o nome do arquivo é recalculado automaticamente
- **Preview interativo** — visualização lado a lado de cada página com seus dados extraídos
- **Download em ZIP** — pacote organizado com todos os documentos processados
- **Atualização automática** — auto-update via GitHub Releases
- **Configuração flexível** — escolha quais componentes entram no nome do arquivo (tipo, número, empresa, valor, funcionário)

## Provedores de IA

| Provedor | Modelo | Imagens |
|---|---|---|
| Google | Gemini 2.5 Flash | Sim |
| NVIDIA | Llama 3.2 11B Vision | Sim |
| OpenAI | GPT-4o | Sim |
| Anthropic | Claude Sonnet 4 | Sim |
| Mistral | Mistral OCR | Sim |
| OpenRouter | Gemma 4 26B (FREE) | Sim |
| Ollama Cloud | Llama Vision | Sim |
| Ollama Local | Llama 3.2 Vision 11B | Sim |
| Codex | GPT-4o | Sim |


## Download

Baixe o instalador mais recente na [página de Releases](https://github.com/Joao-Aschenbrenner/ai-disec-pdf/releases/latest):

```
AI-Disec-PDF-Setup-1.4.11.exe
```

## Como usar

1. **Instalar** — execute o instalador baixado
2. **Abrir** — atalho no Desktop ou Menu Iniciar
3. **Configurar chave** — clique em ⚙️, escolha um provedor e cole sua chave de API
4. **Processar** — arraste ou selecione um PDF, clique em "Identificar & Organizar Páginas"
5. **Baixar** — clique em "Baixar ZIP Processado"

O app verifica atualizações automaticamente toda vez que inicia.

## Stack

| Camada | Tecnologia |
|---|---|
| Frontend | React 19 + TypeScript + Tailwind CSS 4 |
| Backend | Express + TypeScript (executado no Electron) |
| Desktop | Electron 34 + electron-builder |
| IA | Google Gemini / OpenAI / Anthropic / NVIDIA / Mistral / OpenRouter / Ollama / Codex |
| PDF | pdf-lib + pdfjs-dist + sharp |
| Testes | Vitest (442 testes) |
| Build | Vite 6 + esbuild |

## Estrutura do projeto

```
ai-disec-pdf/
├── assets/          # Ícones (SVG, PNG, ICO)
├── electron/        # main.cjs, preload.cjs (auto-update, power save)
├── legal/           # Termos de uso, privacidade, LGPD
├── server/          # Express + integração com 8 provedores de IA
├── src/             # React + Tailwind (interface)
│   ├── utils/       # Helpers (fileHelpers, pdfToImage)
│   ├── App.tsx      # Componente principal
│   ├── types.ts     # Tipos TypeScript (metadados, opções)
│   ├── main.tsx     # Entry point
│   └── index.css    # Estilos globais
├── tests/           # 386 testes (Vitest)
├── scripts/         # Scripts de release
├── dist/            # Build de produção
└── release/         # Instaladores gerados
```

## Desenvolvimento

```bash
git clone https://github.com/Joao-Aschenbrenner/ai-disec-pdf.git
cd ai-disec-pdf
npm install

# Servidor web (Vite dev server + Express)
npm run dev

# Electron + servidor
npm run electron:dev

# Testes
npm run test

# Build produção
npm run build

# Gerar instalador
npm run electron:build
```

### Variáveis de ambiente

```bash
PORT=3001                    # porta do servidor (opcional, padrão 3001)
APP_URL="http://localhost:3001"
```

### Publicar atualização

```bash
# 1. Altere a versão em package.json
# 2. Defina o token
$env:GH_TOKEN = "ghp_seu_token"

# 3. Publique
npm run release

# Usuários existentes recebem a atualização ao abrir o app
```

## Licença

Distribuído sob licença **MIT**. Veja [LICENSE](LICENSE) para mais informações.

Documentos legais adicionais em [`legal/`](legal/):
- [Termos de Uso](legal/TERMS.md)
- [Política de Privacidade](legal/PRIVACY_POLICY.md)
- [Aviso LGPD](legal/LGPD_NOTICE.md)

---

<div align="center">
  <sub>Feito por <a href="https://github.com/Joao-Aschenbrenner">João Aschenbrenner</a></sub>
</div>
