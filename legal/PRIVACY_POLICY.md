# Política de Privacidade — AI Disec PDF

**Versão:** 1.0.0  
**Data de vigência:** Junho de 2026

## 1. Coleta de Dados

O AI Disec PDF opera integralmente no ambiente local do usuário. Nenhum dado pessoal é coletado, armazenado ou transmitido para servidores controlados pelo autor.

## 2. Processamento Local

- O aplicativo e o servidor interno rodam exclusivamente em sua máquina.
- Os arquivos PDF Processados permanecem em seu sistema de arquivos local.
- Nenhuma telemetria, analytics ou rastreamento está embutido no Software.

## 3. Dados Compartilhados com Provedores de IA

Para realizar a extração de metadados, as imagens das páginas dos PDFs são enviadas ao provedor de IA selecionado pelo usuário. Recomendamos consultar a política de privacidade de cada provedor:

| Provedor    | Política de Privacidade                                       |
|-------------|---------------------------------------------------------------|
| OpenAI      | https://openai.com/policies/privacy-policy                    |
| Google      | https://policies.google.com/privacy                           |
| Anthropic   | https://www.anthropic.com/legal/privacy                       |
| Mistral     | https://mistral.ai/terms/#privacy-policy                      |
| NVIDIA      | https://www.nvidia.com/en-us/privacy-policy/                  |
| OpenRouter  | https://openrouter.ai/privacy                                 |
| Ollama      | https://ollama.com/privacy                                    |

## 4. Segurança

- As chaves de API fornecidas pelo usuário são armazenadas apenas no arquivo `.env` local e nunca são transmitidas a terceiros além do provedor de IA correspondente.
- Recomenda-se manter o arquivo `.env` fora do controle de versão (já configurado via `.gitignore`).

## 5. Direitos do Usuário (LGPD)

Você tem o direito de:
- Saber quais dados são processados (apenas os PDFs que você mesmo seleciona);
- Solicitar a exclusão de qualquer dado processado (basta remover os arquivos gerados);
- Revogar o consentimento a qualquer momento (deixando de usar o Software).

## 6. Contato

João Aschenbrenner  
https://github.com/Joao-Aschenbrenner

---

*Esta política é fornecida como modelo informativo e não substitui aconselhamento jurídico especializado.*
