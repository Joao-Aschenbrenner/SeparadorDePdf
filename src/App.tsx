import { useState, useRef, useEffect, ChangeEvent, DragEvent } from "react";
import { PDFDocument } from "pdf-lib";
import JSZip from "jszip";
import { 
  UploadCloud, 
  FileText, 
  Loader2, 
  CheckCircle, 
  AlertCircle, 
  Download, 
  RefreshCw, 
  Trash2, 
  Check, 
  ChevronRight, 
  Eye,
  EyeOff,
  FileCheck, 
  Sparkles,
  Info,
  DollarSign,
  Briefcase,
  Hash,
  X,
  FileDown,
  FileCode,
  Settings,
  Cog,
  Cpu,
  HardDrive,
  Zap,
  LogIn,
  Cloud
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

import { ExtractedMetadata, SplitPage, FilenameOptions, DEFAULT_FILENAME_OPTIONS } from "./types";

declare global {
  interface Window {
    electronAPI?: {
      platform: string;
      startProcessing: () => void;
      endProcessing: () => void;
      onUpdateChecking: (fn: () => void) => () => void;
      onUpdateAvailable: (fn: (version: string) => void) => () => void;
      onUpdateNotAvailable: (fn: () => void) => () => void;
      onUpdateProgress: (fn: (percent: number) => void) => () => void;
      onUpdateDownloaded: (fn: (version: string) => void) => () => void;
      onUpdateError: (fn: (message: string) => void) => () => void;
      confirmDownload: () => void;
      restartApp: () => void;
      checkForUpdate: () => void;
      // Ollama local
      getHardware: () => Promise<{ totalMemGB: number; cpuCores: number; gpu: string; hasGpu: boolean; suggestedModel: string; reason: string }>;
      checkInstalled: () => Promise<{ installed: boolean; path: string | null }>;
      install: () => Promise<{ ok: boolean; error?: string; path?: string }>;
      pullModel: (model: string) => Promise<{ ok: boolean; model?: string; error?: string }>;
      onPullProgress: (fn: (p: { line: string; model: string }) => void) => () => void;
      // Codex OAuth
      codexLogin: () => Promise<{ ok: boolean; message?: string; error?: string }>;
      codexLogout: () => Promise<{ ok: boolean; error?: string }>;
      codexCheckLogin: () => Promise<{ logged: boolean }>;
    };
  }
}
import { sanitizeFilename, generatePageFilename, generateCombinedFilename } from "./utils/fileHelpers";
import { pdfBase64ToJpeg } from "./utils/pdfToImage";
import { version as appVersion } from "../package.json";

const MAX_CONCURRENT_REQUESTS = 10;

let pageIdCounter = 0;
function nextPageId(): string {
  return `p${pageIdCounter++}`;
}

// ════════════════════════════════════════════════════════════
// Ollama Local Setup — detecta hardware, 3 opções de modelo, detecta instalados
// ════════════════════════════════════════════════════════════
const OLLAMA_MODELS = [
  { id: "moondream:1.8b", label: "Moondream 1.8B", size: "1.3 GB", minRam: 4, desc: "Leve — PCs fracos (4GB+ RAM)" },
  { id: "llama3.2-vision:11b", label: "Llama 3.2 Vision 11B", size: "7.8 GB", minRam: 8, desc: "Balanceado — PCs moderados (8GB+ RAM)" },
  { id: "llama3.2-vision:90b", label: "Llama 3.2 Vision 90B", size: "55 GB", minRam: 32, desc: "Preciso — PCs robustos (32GB+ RAM)" },
];

function OllamaLocalSetup({ model, onModelChange }: { model: string; onModelChange: (m: string) => void }) {
  const [hw, setHw] = useState<{ totalMemGB: number; cpuCores: number; gpu: string; hasGpu: boolean; suggestedModel: string; reason: string } | null>(null);
  const [installState, setInstallState] = useState<"idle" | "checking" | "downloading" | "installing" | "pulling" | "done" | "error">("idle");
  const [progress, setProgress] = useState<string>("");
  const [errorMsg, setErrorMsg] = useState("");
  const [installedModels, setInstalledModels] = useState<string[]>([]);
  const api = window.electronAPI;
  // Refs para uso no efeito de montagem sem recriar o efeito a cada render
  const modelRef = useRef(model);
  modelRef.current = model;
  const onModelChangeRef = useRef(onModelChange);
  onModelChangeRef.current = onModelChange;

  useEffect(() => {
    if (api?.getHardware) {
      api.getHardware().then(h => {
        setHw(h);
        // Só sugere modelo se o usuário ainda não salvou uma escolha
        if (!modelRef.current) onModelChangeRef.current(h.suggestedModel);
      }).catch(() => {});
    }
    if (api?.onPullProgress) {
      const clean = api.onPullProgress((p: { line: string; model: string }) => {
        setProgress(p.line);
      });
      return clean;
    }
  }, []);

  // Detectar modelos já baixados via /api/tags do Ollama
  useEffect(() => {
    fetch("http://localhost:11434/api/tags")
      .then(r => r.json())
      .then(d => setInstalledModels((d.models || []).map((m: any) => m.name || m.model)))
      .catch(() => setInstalledModels([]));
  }, [installState]);

  const handleSetup = async () => {
    if (!api) { setErrorMsg("Electron API não disponível."); return; }
    if (!model) { setErrorMsg("Selecione um modelo primeiro."); return; }
    setErrorMsg("");
    try {
      setInstallState("checking");
      const check = await api.checkInstalled();
      if (!check.installed) {
        setInstallState("downloading");
        setProgress("Baixando instalador do Ollama...");
        const inst = await api.install();
        if (!inst.ok) { setErrorMsg(inst.error || "Falha ao instalar"); setInstallState("error"); return; }
      }
      setInstallState("pulling");
      setProgress(`Baixando modelo ${model}...`);
      const pull = await api.pullModel(model);
      if (!pull.ok) { setErrorMsg(pull.error || "Falha ao baixar modelo"); setInstallState("error"); return; }
      setInstallState("done");
      setProgress(`Modelo ${model} pronto! Salve as configurações.`);
    } catch (e: any) {
      setErrorMsg(e.message || "Erro inesperado");
      setInstallState("error");
    }
  };

  return (
    <div className="space-y-3">
      {hw && (
        <div className="p-3 bg-slate-950/60 rounded-xl border border-slate-800">
          <div className="flex items-center gap-2 mb-2">
            <Cpu className="w-4 h-4 text-cyan-400" />
            <span className="text-xs font-bold text-slate-200">Hardware detectado</span>
          </div>
          <div className="grid grid-cols-2 gap-2 text-[11px] text-slate-400">
            <div className="flex items-center gap-1.5"><HardDrive className="w-3 h-3" /> RAM: <strong className="text-slate-200">{hw.totalMemGB} GB</strong></div>
            <div className="flex items-center gap-1.5"><Cpu className="w-3 h-3" /> Cores: <strong className="text-slate-200">{hw.cpuCores}</strong></div>
            <div className="flex items-center gap-1.5 col-span-2"><Zap className="w-3 h-3" /> GPU: <strong className="text-slate-200">{hw.gpu}</strong></div>
          </div>
          <p className="text-[11px] text-cyan-300 mt-2">{hw.reason}</p>
        </div>
      )}

      <div>
        <label className="block text-xs font-semibold text-slate-300 mb-1.5">Escolha o modelo local</label>
        <div className="space-y-2">
          {OLLAMA_MODELS.map(m => {
            const isInstalled = installedModels.includes(m.id);
            const isSuggested = hw?.suggestedModel === m.id;
            const ramOk = hw ? hw.totalMemGB >= m.minRam : true;
            return (
              <label key={m.id} className={`flex items-start gap-2.5 p-2.5 rounded-xl border cursor-pointer transition-all ${model === m.id ? "border-emerald-600 bg-emerald-950/30" : "border-slate-800 bg-slate-950/40 hover:border-slate-700"}`}>
                <input
                  type="radio"
                  name="ollama-model"
                  value={m.id}
                  checked={model === m.id}
                  onChange={e => onModelChange(e.target.value)}
                  className="mt-0.5 accent-emerald-500"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-bold text-slate-200">{m.label}</span>
                    {isSuggested && <span className="text-[10px] text-cyan-300 bg-cyan-950/40 px-1.5 py-0.5 rounded">sugerido</span>}
                    {isInstalled && <span className="text-[10px] text-emerald-300 bg-emerald-950/40 px-1.5 py-0.5 rounded flex items-center gap-0.5"><CheckCircle className="w-2.5 h-2.5" /> instalado</span>}
                    {!ramOk && <span className="text-[10px] text-amber-300 bg-amber-950/40 px-1.5 py-0.5 rounded">RAM insuficiente</span>}
                  </div>
                  <p className="text-[11px] text-slate-500 mt-0.5">{m.desc} • {m.size}</p>
                </div>
              </label>
            );
          })}
        </div>
      </div>

      {installedModels.length > 0 && (
        <p className="text-[11px] text-emerald-400 flex items-center gap-1.5">
          <CheckCircle className="w-3.5 h-3.5" />
          {installedModels.length} modelo(s) já baixado(s): {installedModels.join(", ")}
        </p>
      )}

      {installState !== "idle" && installState !== "done" && progress && (
        <div className="p-2 bg-slate-950 rounded-xl border border-slate-800 text-[11px] text-slate-400 font-mono break-all max-h-24 overflow-y-auto">
          {progress}
        </div>
      )}
      {errorMsg && <p className="text-[11px] text-rose-400">{errorMsg}</p>}
      {installState === "done" && (
        <p className="text-[11px] text-emerald-400 flex items-center gap-1.5"><CheckCircle className="w-3.5 h-3.5" /> Pronto! Clique em Salvar.</p>
      )}

      <button
        onClick={handleSetup}
        disabled={installState === "downloading" || installState === "installing" || installState === "pulling"}
        className="w-full px-4 py-2.5 text-sm font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl transition-all disabled:opacity-50 cursor-pointer flex items-center justify-center gap-2"
      >
        {(installState === "downloading" || installState === "installing" || installState === "pulling") ? (
          <><Loader2 className="w-4 h-4 animate-spin" /> {installState === "downloading" ? "Baixando Ollama..." : installState === "pulling" ? "Baixando modelo..." : "Instalando..."}</>
        ) : installedModels.includes(model) ? (
          <><Check className="w-4 h-4" /> Modelo pronto — salvar e usar</>
        ) : (
          <><Download className="w-4 h-4" /> Baixar {model}</>
        )}
      </button>
    </div>
  );
}

// ════════════════════════════════════════════════════════════
// Codex Login — OAuth flow + token manual
// ════════════════════════════════════════════════════════════
function CodexLogin({ apiKey, setApiKey }: { apiKey: string; setApiKey: (v: string) => void }) {
  const [logging, setLogging] = useState(false);
  const [logged, setLogged] = useState(false);
  const [statusMsg, setStatusMsg] = useState("");
  const api = window.electronAPI;

  useEffect(() => {
    api?.codexCheckLogin?.().then(r => setLogged(r.logged)).catch(() => {});
  }, []);

  const handleLogin = async () => {
    if (!api?.codexLogin) return;
    setLogging(true);
    setStatusMsg("");
    try {
      const r = await api.codexLogin();
      if (r.ok) {
        setLogged(true);
        setStatusMsg(r.message || "Login realizado!");
      } else {
        setStatusMsg(r.error || "Falha no login");
      }
    } catch (e: any) {
      setStatusMsg(e.message);
    } finally {
      setLogging(false);
    }
  };

  const handleLogout = async () => {
    if (!api?.codexLogout) return;
    await api.codexLogout();
    setLogged(false);
    setApiKey("");
    setStatusMsg("Logout realizado.");
  };

  return (
    <div className="space-y-3">
      <div className="p-3 bg-slate-950/60 rounded-xl border border-slate-800">
        <div className="flex items-center gap-2 mb-1.5">
          <LogIn className="w-4 h-4 text-indigo-400" />
          <span className="text-xs font-bold text-slate-200">Codex Pro (OpenAI)</span>
          <Cloud className="w-3.5 h-3.5 text-slate-500" />
        </div>
        <p className="text-[11px] text-slate-400 leading-relaxed">
          Use seu plano ChatGPT Pro/Plus/Business. Login oficial via "Sign in with ChatGPT"
          — abre o browser para autenticar com sua conta OpenAI. Token salvo em ~/.codex/auth.json.
        </p>
      </div>

      {logged ? (
        <div className="p-3 bg-emerald-950/30 rounded-xl border border-emerald-800/30 flex items-center gap-2">
          <CheckCircle className="w-4 h-4 text-emerald-400" />
          <span className="text-xs text-emerald-300 flex-1">Logado no ChatGPT</span>
          <button onClick={handleLogout} className="text-[11px] text-rose-400 hover:text-rose-300 cursor-pointer">Logout</button>
        </div>
      ) : (
        <button
          onClick={handleLogin}
          disabled={logging}
          className="w-full px-4 py-2.5 text-sm font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl transition-all disabled:opacity-50 cursor-pointer flex items-center justify-center gap-2"
        >
          {logging ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogIn className="w-4 h-4" />}
          {logging ? "Aguardando login no browser..." : "Sign in with ChatGPT"}
        </button>
      )}

      {statusMsg && <p className="text-[11px] text-slate-400">{statusMsg}</p>}

      <div className="border-t border-slate-800 pt-3">
        <label className="block text-xs font-semibold text-slate-300 mb-1.5">Ou cole sua API key da OpenAI</label>
        <input
          type="password"
          value={apiKey}
          onChange={e => setApiKey(e.target.value)}
          placeholder="sk-... (alternativa ao login)"
          className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
        />
        <p className="text-[11px] text-slate-500 mt-1.5">
          {apiKey ? "Chave salva em ~/.ai-disec-pdf/settings.json" : "Para uso sem ChatGPT Pro (cobrança por uso via API)"}
        </p>
      </div>
    </div>
  );
}

export default function App() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [splitPages, setSplitPages] = useState<SplitPage[]>([]);
  const [isSplitting, setIsSplitting] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [activePreviewUrl, setActivePreviewUrl] = useState<string | null>(null);
  const [activePreviewIndex, setActivePreviewIndex] = useState<number | null>(null);
  
  // Custom user parameters to adjust original filename prefixing
  const [removeOriginalName, setRemoveOriginalName] = useState(false);

  // Filename construction options + localStorage persistence
  const [filenameOptions, setFilenameOptions] = useState<FilenameOptions>(() => {
    try {
      const saved = localStorage.getItem("filenameOptions");
      return saved ? JSON.parse(saved) : DEFAULT_FILENAME_OPTIONS;
    } catch { return DEFAULT_FILENAME_OPTIONS; }
  });
  useEffect(() => { localStorage.setItem("filenameOptions", JSON.stringify(filenameOptions)); }, [filenameOptions]);

  // Modal states
  const [showSettings, setShowSettings] = useState(false);
  const [showDocModal, setShowDocModal] = useState(false);
  const [settingsProvider, setSettingsProvider] = useState("NVIDIA");
  const [settingsApiKey, setSettingsApiKey] = useState("");
  const [settingsLocalModel, setSettingsLocalModel] = useState("");
  const [currentProvider, setCurrentProvider] = useState("NVIDIA");
  const [savingSettings, setSavingSettings] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);
  const [showFirstTimeWarning, setShowFirstTimeWarning] = useState(false);

  // Reprocess correction dialog
  const [showCorrection, setShowCorrection] = useState(false);
  const [correctionPageId, setCorrectionPageId] = useState<string | null>(null);
  const [correctionFields, setCorrectionFields] = useState<Record<string, boolean>>({});

  // Carrega settings ao montar
  useEffect(() => {
    fetch("/api/settings").then(r => r.json()).then(s => {
      if (s.provider) setCurrentProvider(s.provider);
      if (s.provider) setSettingsProvider(s.provider);
      if (s.apiKey) setSettingsApiKey(s.apiKey);
      if (s.model) setSettingsLocalModel(s.model);
      if (!s.apiKey) {
        setTimeout(() => setShowFirstTimeWarning(true), 800);
      }
    }).catch(() => {
      setTimeout(() => setShowFirstTimeWarning(true), 800);
    });
  }, []);

  // Update overlay
  const [updateState, setUpdateState] = useState<"idle" | "checking" | "available" | "downloading" | "downloaded" | "error">("idle");
  const [updateVersion, setUpdateVersion] = useState("");
  const [updateProgress, setUpdateProgress] = useState(0);
  const [updateError, setUpdateError] = useState("");

  useEffect(() => {
    const api = window.electronAPI;
    if (!api) return;
    const cleanups: (() => void)[] = [];
    cleanups.push(api.onUpdateChecking(() => {
      setUpdateState("checking");
      setUpdateError("");
    }));
    cleanups.push(api.onUpdateAvailable((version) => {
      setUpdateVersion(version);
      setUpdateState("available");
      setUpdateProgress(0);
      setUpdateError("");
    }));
    cleanups.push(api.onUpdateNotAvailable(() => {
      setUpdateState("idle");
      setUpdateError("");
    }));
    cleanups.push(api.onUpdateProgress((p) => {
      setUpdateProgress(p);
      setUpdateState("downloading");
    }));
    cleanups.push(api.onUpdateDownloaded((version) => {
      setUpdateVersion(version);
      setUpdateState("downloaded");
      setUpdateProgress(100);
    }));
    cleanups.push(api.onUpdateError((msg) => {
      setUpdateError(msg);
      setUpdateState("error");
    }));
    return () => cleanups.forEach((fn) => fn());
  }, []);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const blobUrlsRef = useRef<string[]>([]);

  const revokeAllBlobUrls = () => {
    blobUrlsRef.current.forEach(url => URL.revokeObjectURL(url));
    blobUrlsRef.current = [];
  };

  useEffect(() => {
    return () => revokeAllBlobUrls();
  }, []);

  // Drag and drop events
  const [dragActive, setDragActive] = useState(false);

  const handleDrag = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = async (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0];
      if (file.type === "application/pdf") {
        await selectPdfFile(file);
      } else {
        alert("Por favor, selecione apenas arquivos do formato PDF.");
      }
    }
  };

  const handleFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      await selectPdfFile(file);
    }
  };

  // Load PDF and split pages in the browser
  const selectPdfFile = async (file: File) => {
    revokeAllBlobUrls();
    setSelectedFile(file);
    setIsSplitting(true);
    setSplitPages([]);
    setActivePreviewUrl(null);
    setActivePreviewIndex(null);

    try {
      const arrayBuffer = await file.arrayBuffer();
      const mainPdfDoc = await PDFDocument.load(arrayBuffer);
      const pageCount = mainPdfDoc.getPageCount();

      const pages: SplitPage[] = [];

      for (let i = 0; i < pageCount; i++) {
        // Create single page PDF
        const newDoc = await PDFDocument.create();
        const [copiedPage] = await newDoc.copyPages(mainPdfDoc, [i]);
        newDoc.addPage(copiedPage);

        // Export bytes
        const pdfBytes = await newDoc.save();

        // Blob for local display
        const blob = new Blob([pdfBytes], { type: "application/pdf" });
        const blobUrl = URL.createObjectURL(blob);
        blobUrlsRef.current.push(blobUrl);

        // Convert base64
        const reader = new FileReader();
        const base64Promise = new Promise<string>((resolve) => {
          reader.onloadend = () => {
            const base64Str = (reader.result as string).split(",")[1];
            resolve(base64Str);
          };
          reader.readAsDataURL(blob);
        });

        const base64 = await base64Promise;

        // Default initial filename: [OriginalName]_pagina_[i+1].pdf
        const cleanBaseOrig = file.name.replace(/\.pdf$/i, "");
        const customFilename = `${cleanBaseOrig}_pag${i + 1}.pdf`;

        pages.push({
          id: nextPageId(),
          index: i,
          base64,
          blobUrl,
          originalFileName: file.name,
          customFilename,
          status: "pending",
        });
      }

      setSplitPages(pages);
      
      // Auto-open the preview of the first page
      if (pages.length > 0) {
        setActivePreviewUrl(pages[0].blobUrl);
        setActivePreviewIndex(0);
      }
    } catch (err: any) {
      console.error(err);
      alert("Falha ao ler e abrir o documento PDF. Verifique se o arquivo está corrompido.");
    } finally {
      setIsSplitting(false);
    }
  };

  // Callback to trigger backend OCR on page index
  const processSinglePage = async (id: string, page: SplitPage, correction?: string): Promise<SplitPage> => {
    try {
      const imageBase64 = await pdfBase64ToJpeg(page.base64);
      const response = await fetch("/api/extract", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          pdfBase64: imageBase64,
          originalName: page.originalFileName,
          pageIndex: page.index,
          ...(correction ? { correction } : {}),
        }),
      });

      if (!response.ok) {
        const errJson = await response.json();
        const err = new Error(errJson.error || "Erro de requisição.") as any;
        err.retryAfter = errJson.retryAfter;
        throw err;
      }

      const result = await response.json();

      // Handle multiple documents per page (array response) → combined entry
      if (result._multiple && Array.isArray(result.documents)) {
        const docs = result.documents as ExtractedMetadata[];
        const firstMeta = docs[0];
        let customFilename = generateCombinedFilename(docs, page.index, filenameOptions);
        if (removeOriginalName) {
          customFilename = customFilename.substring(customFilename.indexOf("_pag") + 1);
        }
        return {
          id,
          ...page,
          status: "success",
          metadata: firstMeta,
          metadataList: docs,
          customFilename,
        };
      }

      const metadata = result as ExtractedMetadata;
      let customFilename = generatePageFilename(page.originalFileName, page.index, metadata, filenameOptions);
      if (removeOriginalName) {
        customFilename = customFilename.substring(customFilename.indexOf("_pag") + 1);
      }

      return {
        id,
        ...page,
        status: "success",
        metadata,
        customFilename,
      };
    } catch (err: any) {
      console.error(`Page ${page.index + 1} processing failed:`, err);
      return {
        id,
        ...page,
        status: "failed",
        error: err.message || "Erro de processamento",
        retryAfter: err.retryAfter,
      };
    }
  };

  // Run bulk or sequential processing of all pages
  const processAllPages = async () => {
    if (splitPages.length === 0 || isProcessing) return;
    setIsProcessing(true);
    window.electronAPI?.startProcessing();

    // Deep clone to reset state for processing
    const updatedPages = splitPages.map(p => ({
      ...p,
      status: (p.status === "success" ? "success" : "pending") as "success" | "pending",
      error: undefined,
      retryAfter: undefined,
    }));
    setSplitPages(updatedPages);

    // Process queued items with a concurrency control limit
    const queue = updatedPages.filter(p => p.status !== "success");
    // Track retry count per page id
    const retries: Record<string, number> = {};
    
    // Simple async pool loop
    const activePromises: Promise<void>[] = [];
    
    while (queue.length > 0 || activePromises.length > 0) {
      // Fill pool up to the limit
      while (queue.length > 0 && activePromises.length < MAX_CONCURRENT_REQUESTS) {
        const page = queue.shift()!;
        
        // Update item status in UI to 'processing'
        setSplitPages(prev => prev.map(p => p.id === page.id ? { ...p, status: "processing" } : p));

        const process = async () => {
          const result = await processSinglePage(page.id, page);

          // Auto-retry failed pages with backoff
          if (result.status === "failed") {
            const attempt = (retries[page.id] || 0) + 1;
            retries[page.id] = attempt;
            
            if (attempt < 3) {
              let delayMs = 2000 * attempt; // 2s, 4s, 6s
              if (result.retryAfter) {
                const match = result.retryAfter.match(/(\d+)/);
                if (match) delayMs = parseInt(match[1]) * 1000;
              }
              console.log(`[retry] ${page.id} tentativa ${attempt + 1} em ${delayMs}ms`);
              await new Promise(r => setTimeout(r, delayMs));
              // Re-process
              const retryResult = await processSinglePage(page.id, page);
              setSplitPages(prev => prev.map(p => p.id === page.id ? retryResult : p));
            } else {
              setSplitPages(prev => prev.map(p => p.id === page.id ? result : p));
            }
          } else {
            setSplitPages(prev => prev.map(p => p.id === page.id ? result : p));
          }

          // Remove self from active list
          const idx = activePromises.indexOf(promise);
          if (idx !== -1) activePromises.splice(idx, 1);
        };

        const promise = process();
        activePromises.push(promise);
      }

      if (activePromises.length > 0) {
        await Promise.race(activePromises);
      }
    }

    setIsProcessing(false);
    window.electronAPI?.endProcessing();
  };

  // Clear / Reset App
  const resetApp = () => {
    revokeAllBlobUrls();
    setSelectedFile(null);
    setSplitPages([]);
    setActivePreviewUrl(null);
    setActivePreviewIndex(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  // Download single specific page locally
  const downloadSinglePage = (page: SplitPage) => {
    const link = document.createElement("a");
    link.href = page.blobUrl;
    link.download = page.customFilename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Create ZIP and trigger browser download
  const downloadAllAsZip = async () => {
    if (splitPages.length === 0) return;
    
    const zip = new JSZip();
    const cleanOriginalName = sanitizeFilename(selectedFile?.name.replace(/\.pdf$/i, "") || "documentos");
    
    let addedCount = 0;
    
    for (const page of splitPages) {
      // Decode base64 to binary ArrayBuffer/Uint8Array
      const binaryString = window.atob(page.base64);
      const len = binaryString.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      
      zip.file(page.customFilename, bytes);
      addedCount++;
    }

    if (addedCount === 0) {
      alert("Nenhum arquivo válido encontrado para criar o pacote ZIP.");
      return;
    }

    const content = await zip.generateAsync({ type: "blob" });
    const blobUrl = URL.createObjectURL(content);

    const link = document.createElement("a");
    link.href = blobUrl;
    link.download = `${cleanOriginalName}_separado_organizado.zip`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(blobUrl);
  };

  // Update specific metadata field value manually to re-trigger filename generation
  const handleManualMetadataEdit = (
    index: number,
    field: keyof ExtractedMetadata,
    value: string | boolean | number | null
  ) => {
    setSplitPages(prev => {
      const next = [...prev];
      const page = next[index];
      
      if (!page.metadata) return prev;

      const updatedMetadata = {
        ...page.metadata,
        [field]: value
      };

      // Re-trigger filename calculation
      let customFilename = generatePageFilename(page.originalFileName, index, updatedMetadata, filenameOptions);
      if (removeOriginalName) {
        customFilename = customFilename.substring(customFilename.indexOf("_pag") + 1);
      }

      next[index] = {
        ...page,
        metadata: updatedMetadata,
        customFilename,
      };

      return next;
    });
  };

  const handleManualFilenameDirectEdit = (index: number, filename: string) => {
    setSplitPages(prev => {
      const next = [...prev];
      next[index] = {
        ...next[index],
        customFilename: filename.endsWith(".pdf") ? filename : `${filename}.pdf`
      };
      return next;
    });
  };

  // Re-run naming rule calculations after user toggles setting configurations
  const handleToggleOriginalNamePrefix = (remove: boolean) => {
    setRemoveOriginalName(remove);
    setSplitPages(prev => {
      return prev.map((page, idx) => {
        if (!page.metadata) return page;
        let customFilename = generatePageFilename(page.originalFileName, idx, page.metadata, filenameOptions);
        if (remove) {
          customFilename = customFilename.substring(customFilename.indexOf("_pag") + 1);
        }
        return {
          ...page,
          customFilename
        };
      });
    });
  };

  // Edit specific field for a specific doc in combined documents
  const handleCombinedMetadataEdit = (
    index: number,
    docIdx: number,
    field: keyof ExtractedMetadata,
    value: string | boolean | number | null
  ) => {
    setSplitPages(prev => {
      const next = [...prev];
      const page = next[index];
      if (!page.metadataList) return prev;
      const updatedList = page.metadataList.map((d, i) =>
        i === docIdx ? { ...d, [field]: value } : d
      );
      let customFilename = generateCombinedFilename(updatedList, index, filenameOptions);
      if (removeOriginalName) {
        customFilename = customFilename.substring(customFilename.indexOf("_pag") + 1);
      }
      next[index] = { ...page, metadataList: updatedList, customFilename };
      return next;
    });
  };

  // Save settings to server
  const saveSettings = async () => {
    setSavingSettings(true);
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: settingsProvider, apiKey: settingsApiKey, model: settingsLocalModel }),
      });
      if (res.ok) {
        setCurrentProvider(settingsProvider);
        setShowSettings(false);
      } else {
        const err = await res.json();
        alert("Erro ao salvar: " + (err.error || "desconhecido"));
      }
    } catch (e: any) {
      alert("Erro de conexão: " + e.message);
    } finally {
      setSavingSettings(false);
    }
  };

  // Statistical calculations
  const totalPages = splitPages.length;
  const processedCount = splitPages.filter(p => p.status === "success").length;
  const failedCount = splitPages.filter(p => p.status === "failed").length;
  const pendingCount = splitPages.filter(p => p.status === "pending" || p.status === "processing" || p.status === "failed").length;
  
  const notaFiscalCount = splitPages.filter(p => p.metadata?.documentType === "nota_fiscal").length;
  const impostoCount = splitPages.filter(p => p.metadata?.documentType === "imposto").length;
  const darfCount = splitPages.filter(p => p.metadata?.documentType === "darf").length;
  const extratoCount = splitPages.filter(p => p.metadata?.documentType === "extrato").length;
  const folhaPagamentoCount = splitPages.filter(p => p.metadata?.documentType === "folha_pagamento").length;
  const outrosCount = splitPages.filter(p => p.metadata?.documentType === "outros" || p.metadata?.documentType === "planilha" || p.metadata?.documentType === "nao_identificado").length;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 antialiased font-sans flex flex-col selection:bg-indigo-500/30 selection:text-indigo-200">
      {/* Bento-styled Sticky Header */}
      <div className="sticky top-0 z-40 pt-3 pb-1 px-3 md:px-6">
        <header className="bg-slate-900/80 backdrop-blur-md border border-slate-800/80 py-4.5 px-6 md:px-10 rounded-2xl flex justify-between items-center shadow-2xl shadow-indigo-950/20 transition-all">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-indigo-600 text-white rounded-xl shadow-lg shadow-indigo-500/20">
            <FileCheck className="w-5.5 h-5.5" id="logo-icon" />
          </div>
          <div>
            <h1 className="text-lg font-bold tracking-tight text-white flex items-center gap-1.5" id="app-title">
              AI Disec PDF
            </h1>
            <p className="text-xs text-slate-400 font-medium hidden sm:block mt-0.5">
              Separador Inteligente de Notas e Impostos
            </p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="flex flex-col items-end hidden md:flex">
            <span className="text-[9px] uppercase tracking-widest text-slate-500 font-bold">Motor Inteligente</span>
              {currentProvider === "LOCAL_OLLAMA" ? (
                <span className="text-xs font-semibold flex items-center gap-1.5 mt-0.5 text-emerald-400">
                  <span className="w-2.5 h-2.5 rounded-full animate-pulse bg-emerald-500"></span> Ollama Local ativo
                </span>
              ) : settingsApiKey ? (
                <span className="text-xs font-semibold flex items-center gap-1.5 mt-0.5 text-emerald-400">
                  <span className="w-2.5 h-2.5 rounded-full animate-pulse bg-emerald-500"></span> {currentProvider} ativo
                </span>
              ) : (
                <span className="text-xs font-semibold flex items-center gap-1.5 mt-0.5 text-rose-400">
                  <span className="w-2.5 h-2.5 rounded-full animate-pulse bg-rose-500"></span> Configure a chave de API
                  <span className="group relative">
                    <Info className="w-3.5 h-3.5 text-rose-400 cursor-help" />
                    <span className="absolute right-0 top-6 w-56 bg-slate-800 text-slate-300 text-[10px] leading-relaxed p-2 rounded-lg border border-slate-700 shadow-xl opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50">
                      Va em Configuracoes (engrenagem) para adicionar uma chave de API. Ollama Local funciona sem chave.
                    </span>
                  </span>
                </span>
              )}
          </div>

          <button
            onClick={() => setShowDocModal(true)}
            className="p-2 text-slate-400 hover:text-indigo-400 hover:bg-indigo-950/30 rounded-lg transition-all border border-transparent hover:border-indigo-900/30 cursor-pointer"
            title="Ajuda e Documentação"
          >
            <Info className="w-4.5 h-4.5" />
          </button>

          <button
            onClick={() => { setSettingsProvider(currentProvider); setShowSettings(true); }}
            className="p-2 text-slate-400 hover:text-indigo-400 hover:bg-indigo-950/30 rounded-lg transition-all border border-transparent hover:border-indigo-900/30 cursor-pointer"
            title="Configurações de API"
          >
            <Cog className="w-4.5 h-4.5" />
          </button>

          {selectedFile && (
            <button 
              onClick={resetApp}
              className="px-3.5 py-1.5 flex items-center gap-2 text-xs font-bold text-rose-400 hover:bg-rose-950/30 rounded-lg transition-all border border-rose-900/30 cursor-pointer"
              id="btn-restart"
            >
              <Trash2 className="w-4 h-4" />
              Limpar Arquivo
            </button>
          )}
        </div>
      </header>
      </div>

      {showFirstTimeWarning && !settingsApiKey && currentProvider !== "LOCAL_OLLAMA" && (
        <div className="max-w-[1600px] w-full mx-auto px-4 md:px-8 pt-2">
          <div className="bg-rose-950/30 border border-rose-800/40 rounded-xl px-5 py-3 flex items-start gap-3 animate-fadeIn">
            <AlertCircle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm font-semibold text-rose-200">Configure o Motor Inteligente</p>
              <p className="text-xs text-rose-300/80 mt-0.5">
                Adicione uma chave de API nas Configuracoes (engrenagem) para ativar a identificacao automatica de documentos.
              </p>
            </div>
            <button
              onClick={() => { setSettingsProvider(currentProvider); setShowSettings(true); setShowFirstTimeWarning(false); }}
              className="text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 px-3 py-1.5 rounded-lg transition-all cursor-pointer shrink-0"
            >
              Configurar
            </button>
            <button
              onClick={() => setShowFirstTimeWarning(false)}
              className="text-rose-400 hover:text-rose-300 p-1 cursor-pointer shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      <main className="max-w-[1600px] w-full mx-auto p-4 md:p-8 grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        
        {/* LEFT COLUMN: Upload, Settings and Side PDF display (Bento Grid columns) */}
        <section className="col-span-1 lg:col-span-12 xl:col-span-5 flex flex-col gap-6 h-full">
          
          {/* Bento Block 1: Ingestion Area / Source File */}
          {!selectedFile ? (
            <div 
              onDragEnter={handleDrag}
              onDragLeave={handleDrag}
              onDragOver={handleDrag}
              onDrop={handleDrop}
              className={`border border-slate-800 rounded-3xl p-8 text-center transition-all flex flex-col items-center justify-center min-h-[350px] cursor-pointer bg-slate-900/60 relative group ${
                dragActive ? "border-indigo-500 bg-indigo-950/25 scale-102" : "hover:border-slate-700 hover:bg-slate-900/80"
              }`}
              onClick={() => fileInputRef.current?.click()}
              id="dropzone"
            >
              <input 
                ref={fileInputRef}
                type="file"
                accept="application/pdf"
                className="hidden"
                onChange={handleFileChange}
              />
              <div className="p-4 bg-slate-950 text-indigo-400 border border-slate-800 rounded-2xl mb-4 group-hover:scale-110 transition-transform shadow-md">
                <UploadCloud className="w-10 h-10" />
              </div>
              <h2 className="text-base font-bold text-slate-100 mb-1">
                Arraste seu PDF unificado aqui
              </h2>
              <p className="text-sm text-slate-400 max-w-sm mb-6 leading-relaxed">
                Nós iremos fatiar o PDF automaticamente em páginas individuais e usar o Gemini para renomear cada uma de forma inteligente.
              </p>
              <button 
                type="button" 
                className="px-5 py-2.5 bg-indigo-600 text-white rounded-xl text-xs font-extrabold tracking-wide uppercase hover:bg-indigo-700 transition-all shadow-lg hover:shadow-indigo-500/20 cursor-pointer"
                id="btn-select-file"
              >
                Selecionar PDF no Computador
              </button>
              <div className="mt-8 text-[11px] text-slate-500 font-mono tracking-wide flex items-center gap-1.5 justify-center">
                <Info className="w-3.5 h-3.5 text-slate-500" />
                Limite recomendado de até 50 páginas por vez.
              </div>
            </div>
          ) : (
            <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 flex flex-col gap-4 shadow-xl shadow-black/30">
              <div className="flex items-start gap-4 p-4 bg-slate-950 rounded-xl border border-slate-800/80">
                <div className="p-2.5 bg-slate-900 text-indigo-400 border border-slate-800 rounded-lg">
                  <FileText className="w-6 h-6" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] text-indigo-400 font-mono font-bold uppercase tracking-widest">Arquivo carregado</p>
                  <p className="text-sm font-bold text-slate-100 truncate mt-0.5" title={selectedFile.name}>
                    {selectedFile.name}
                  </p>
                  <p className="text-xs text-slate-400 font-medium mt-1">
                    {(selectedFile.size / (1024 * 1024)).toFixed(2)} MB • {totalPages} páginas detectadas
                  </p>
                </div>
              </div>

              {/* Progress and core processing controller */}
              <div className="flex flex-col gap-3 mt-1">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-400">Progresso do processamento</span>
                  <span className="text-xs font-mono font-bold text-slate-100 bg-slate-950 border border-slate-800 px-2.5 py-0.5 rounded-md">
                    {processedCount} / {totalPages} concluidos
                  </span>
                </div>
                
                {/* Visual loading/progress indicator */}
                <div className="w-full h-2.5 bg-slate-950 border border-slate-800 rounded-full overflow-hidden p-0.5">
                  <div 
                    className="h-full bg-gradient-to-r from-indigo-500 to-violet-600 transition-all duration-300 rounded-full"
                    style={{ width: `${totalPages > 0 ? (processedCount / totalPages) * 100 : 0}%` }}
                  />
                </div>

                <div className="grid grid-cols-3 gap-3 mt-3">
                  <button
                    onClick={processAllPages}
                    disabled={isProcessing || pendingCount === 0}
                    className="col-span-2 py-3 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-800 disabled:border-slate-800/80 disabled:text-slate-500 disabled:cursor-not-allowed text-white font-bold rounded-xl text-sm transition-all shadow-lg hover:shadow-indigo-500/20 active:scale-98 flex items-center justify-center gap-2 cursor-pointer"
                    id="btn-process"
                  >
                    {isProcessing ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Examinando com Inteligência Artificial...
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-4 h-4 text-amber-400" />
                        {failedCount > 0 ? `Re-processar (${failedCount} falhas)` : "Identificar & Organizar Páginas"}
                      </>
                    )}
                  </button>
                  {failedCount > 0 && !isProcessing && (
                    <button
                      onClick={async () => {
                        setIsProcessing(true);
                        window.electronAPI?.startProcessing();
                        const failed = splitPages.filter(p => p.status === "failed");
                        for (const page of failed) {
                          setSplitPages(prev => prev.map(p => p.id === page.id ? { ...p, status: "processing" } : p));
                          const res = await processSinglePage(page.id, page);
                          setSplitPages(prev => prev.map(p => p.id === page.id ? res : p));
                        }
                        setIsProcessing(false);
                        window.electronAPI?.endProcessing();
                      }}
                      className="py-3 bg-rose-600 hover:bg-rose-700 text-white font-bold rounded-xl text-sm transition-all shadow-lg active:scale-98 flex items-center justify-center gap-2 cursor-pointer"
                    >
                      <RefreshCw className="w-4 h-4" />
                      Re-tentar {failedCount}
                    </button>
                  )}
                </div>
              </div>

              {/* Configurações do Layout */}
              <div className="border-t border-slate-800 pt-4 mt-2">
                <span className="text-[10px] font-bold text-slate-500 tracking-wider uppercase block mb-3">Componentes do Nome do Arquivo</span>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                  {[
                    { key: 'showPageNumber' as const, label: 'Número da página', desc: 'pag1_, pag2_...' },
                    { key: 'showType' as const, label: 'Tipo do documento', desc: 'NF, FOPAG, extrato...' },
                    { key: 'showNotaNumber' as const, label: 'Número da nota', desc: 'NF123 — só NF-e' },
                    { key: 'showCompanyName' as const, label: 'Nome empresa/pessoa', desc: 'João_Silva' },
                    { key: 'showPessoaNome' as const, label: 'Nome do funcionário', desc: 'holerite/FOPAG' },
                    { key: 'showValor' as const, label: 'Valor', desc: '3500.00' },
                  ].map(opt => (
                    <label key={opt.key} className="flex items-start gap-2 cursor-pointer select-none p-1.5">
                      <input
                        type="checkbox"
                        checked={filenameOptions[opt.key]}
                        onChange={() => {
                          const newOpts = { ...filenameOptions, [opt.key]: !filenameOptions[opt.key] };
                          setFilenameOptions(newOpts);
                          setSplitPages(prev => prev.map((page, idx) => {
                            if (!page.metadata) return page;
                            let f = generatePageFilename(page.originalFileName, idx, page.metadata, newOpts);
                            if (removeOriginalName) f = f.substring(f.indexOf("_pag") + 1);
                            return { ...page, customFilename: f };
                          }));
                        }}
                        className="w-4 h-4 mt-0.5 accent-indigo-500 bg-slate-950 border-slate-800 text-indigo-600 rounded-md focus:ring-indigo-500"
                      />
                      <div className="text-[11px] leading-tight">
                        <p className="font-bold text-slate-200">{opt.label}</p>
                        <p className="text-slate-400 mt-0.5">{opt.desc}</p>
                      </div>
                    </label>
                  ))}
                </div>
                <label className="flex items-start gap-2 cursor-pointer select-none p-1.5 mt-1 border-t border-slate-800 pt-3">
                  <input
                    type="checkbox"
                    checked={removeOriginalName}
                    onChange={(e) => handleToggleOriginalNamePrefix(e.target.checked)}
                    className="w-4 h-4 mt-0.5 accent-indigo-500 bg-slate-950 border-slate-800 text-indigo-600 rounded-md focus:ring-indigo-500"
                  />
                  <div className="text-[11px] leading-tight">
                    <p className="font-bold text-slate-200">Omitir prefixo original</p>
                    <p className="text-slate-400 mt-0.5">Remove o nome do arquivo fonte do início do nome gerado</p>
                  </div>
                </label>
              </div>
            </div>
          )}

          {/* Bento Block 2: Quick Real-time PDF Live Preview */}
          {selectedFile && activePreviewUrl && (
            <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 flex flex-col gap-3 flex-1 min-h-[480px] shadow-xl shadow-black/30">
              <div className="flex justify-between items-center border-b border-slate-800 pb-3">
                <span className="text-xs font-bold text-slate-300 uppercase tracking-widest flex items-center gap-2">
                  <Eye className="w-4 h-4 text-indigo-400" />
                  Live Document Preview
                </span>
                
                <span className="px-2.5 py-1 bg-slate-950 border border-slate-800 text-slate-400 font-mono text-[10px] rounded-md font-bold">
                  PÁG {activePreviewIndex !== null ? activePreviewIndex + 1 : ""} OF {totalPages}
                </span>
              </div>

              <div className="bg-slate-950 rounded-2xl overflow-hidden flex-1 border border-slate-800 relative min-h-[380px] shadow-inner">
                <iframe 
                  src={`${activePreviewUrl}#toolbar=0&navpanes=0&scrollbar=0`} 
                  className="w-full h-full absolute inset-0 bg-white"
                  title="Document Preview"
                />
              </div>

              <div className="bg-slate-950/50 rounded-xl p-3 border border-slate-800/60 mt-1 flex items-center gap-2">
                <Info className="w-4 h-4 text-indigo-400 flex-shrink-0" />
                <p className="text-[11px] text-slate-400 leading-normal">
                  Dica: Use esta janela de preview em tempo real para validar ou preencher manualmente qualquer dado extraído.
                </p>
              </div>
            </div>
          )}
        </section>

        {/* RIGHT COLUMN: Bento Results list, metrics blocks & inline controller */}
        <section className="col-span-1 lg:col-span-12 xl:col-span-7 flex flex-col gap-6">
          
          {selectedFile && splitPages.length > 0 && (
            <>
              {/* Bento Row Metrics Grid */}
              <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
                <div className="bg-slate-900 border border-slate-800/80 p-4.5 rounded-2xl shadow-lg shadow-black/20 hover:border-slate-700 transition-colors">
                  <p className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">Invoices (NF-e)</p>
                  <p className="text-2xl font-extrabold text-indigo-400 mt-1.5">{notaFiscalCount}</p>
                </div>
                <div className="bg-slate-900 border border-slate-800/80 p-4.5 rounded-2xl shadow-lg shadow-black/20 hover:border-slate-700 transition-colors">
                  <p className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">Impostos e Guias</p>
                  <p className="text-2xl font-extrabold text-emerald-400 mt-1.5">{impostoCount}</p>
                </div>
                <div className="bg-slate-900 border border-slate-800/80 p-4.5 rounded-2xl shadow-lg shadow-black/20 hover:border-slate-700 transition-colors">
                  <p className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">Guias DARF</p>
                  <p className="text-2xl font-extrabold text-amber-400 mt-1.5">{darfCount}</p>
                </div>
                <div className="bg-slate-900 border border-slate-800/80 p-4.5 rounded-2xl shadow-lg shadow-black/20 hover:border-slate-700 transition-colors">
                  <p className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">Extratos</p>
                  <p className="text-2xl font-extrabold text-cyan-400 mt-1.5">{extratoCount}</p>
                </div>
                <div className="bg-slate-900 border border-amber-800/50 p-4.5 rounded-2xl shadow-lg shadow-black/20 hover:border-amber-700 transition-colors">
                  <p className="text-[9px] font-bold text-amber-400 uppercase tracking-widest">FOPAG / Holerites</p>
                  <p className="text-2xl font-extrabold text-amber-400 mt-1.5">{folhaPagamentoCount}</p>
                </div>
                <div className="bg-slate-900 border border-slate-800/80 p-4.5 rounded-2xl shadow-lg shadow-black/20 hover:border-slate-700 transition-colors">
                  <p className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">Outros / Recibos</p>
                  <p className="text-2xl font-extrabold text-slate-400 mt-1.5">{outrosCount}</p>
                </div>
              </div>

              {/* Bento Block 3: Interactive Extracted Segments Block */}
              <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-xl shadow-black/30 flex flex-col gap-5">
                <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4 border-b border-slate-800 pb-5">
                  <div>
                    <h3 className="text-base font-bold text-slate-100">Segmentos e Renomeações</h3>
                    <p className="text-xs text-slate-400 mt-1">Configure os nomes inteligentes ou edite as informações geradas por inteligência artificial.</p>
                  </div>
                  
                  {processedCount > 0 && (
                    <button
                      onClick={downloadAllAsZip}
                      className="px-4.5 py-2.5 bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-white font-bold rounded-xl text-xs tracking-wider uppercase transition-all shadow-lg shadow-emerald-900/10 active:scale-98 flex items-center justify-center gap-2 cursor-pointer"
                      id="btn-download-zip"
                    >
                      <Download className="w-4 h-4" />
                      Baixar ZIP Processado ({processedCount})
                    </button>
                  )}
                </div>

                <div className="flex flex-col gap-4 overflow-y-auto max-h-[750px] pr-1.5">
                  <AnimatePresence initial={false}>
                    {splitPages.map((page, idx) => {
                      const isActive = activePreviewIndex === idx;
                      const hasResult = page.status === "success" && page.metadata;

                      return (
                        <motion.div
                          key={idx}
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0 }}
                          transition={{ duration: 0.15 }}
                          className={`border rounded-2xl p-4 transition-all flex flex-col gap-4 bg-slate-950/40 relative ${
                            isActive ? "border-indigo-500/80 bg-slate-950/70 ring-1 ring-indigo-500/10" : "border-slate-800 hover:border-slate-700 hover:bg-slate-900/40"
                          }`}
                        >
                          {/* Page row header */}
                          <div className="flex items-center justify-between gap-3 flex-wrap sm:flex-nowrap">
                            <button
                              onClick={() => {
                                setActivePreviewUrl(page.blobUrl);
                                setActivePreviewIndex(idx);
                              }}
                              className="flex items-center gap-3 text-left flex-1 min-w-0 cursor-pointer"
                            >
                              <div className={`p-2.5 rounded-xl transition-colors ${
                                isActive ? "bg-indigo-600 text-white shadow-md shadow-indigo-500/10" : "bg-slate-900 border border-slate-800 text-slate-400"
                              }`}>
                                <FileText className="w-5.5 h-5.5" />
                              </div>
                              <div className="min-w-0">
                                <span className="text-[9px] font-bold text-slate-500 uppercase tracking-widest block">FOLHA {idx + 1}</span>
                                <span className={`text-xs font-mono font-bold truncate block mt-0.5 ${isActive ? "text-indigo-300" : "text-slate-200"}`}>
                                  {page.customFilename}
                                </span>
                              </div>
                            </button>

                            <div className="flex items-center gap-2.5 ml-auto sm:ml-0">
                              {/* Page processing indicator */}
                              {page.status === "pending" && (
                                <span className="text-[10px] font-bold bg-slate-900 border border-slate-800 text-slate-400 px-2.5 py-1 rounded-md">
                                  Aguardando
                                </span>
                              )}
                              {page.status === "processing" && (
                                <span className="text-[10px] font-bold bg-indigo-950/50 border border-indigo-900/30 text-indigo-400 px-2.5 py-1 rounded-md flex items-center gap-1.5 animate-pulse">
                                  <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-400" />
                                  Lendo...
                                </span>
                              )}
                              {page.status === "success" && (
                                <span className="text-[10px] font-bold bg-emerald-950/50 border border-emerald-900/30 text-emerald-400 px-2.5 py-1 rounded-md flex items-center gap-1">
                                  <Check className="w-3.5 h-3.5" />
                                  Pronto
                                </span>
                              )}
                              {page.status === "failed" && (
                                <span className="text-[10px] font-bold bg-rose-950/50 border border-rose-900/30 text-rose-400 px-2.5 py-1 rounded-md flex items-center gap-1 cursor-help" title={page.error}>
                                  <AlertCircle className="w-3.5 h-3.5" />
                                  {page.error?.includes("Cota") || page.error?.includes("requisições")
                                    ? "Cota excedida"
                                    : page.error?.includes("Chave")
                                    ? "Sem chave"
                                    : page.error?.includes("Provedor não aceita")
                                    ? "Formato inválido"
                                    : "Falhou"}
                                </span>
                              )}

                              <button
                                onClick={() => downloadSinglePage(page)}
                                className="p-1.5 bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-400 hover:text-slate-200 rounded-lg transition-colors cursor-pointer"
                                title="Baixar esta página avulsa"
                              >
                                <Download className="w-4 h-4" />
                              </button>
                            </div>
                          </div>

                          {/* Editable extracted metadata details (Rendered upon success) */}
                          {hasResult && page.metadata && (
                            <div className="bg-slate-950 border border-slate-800 rounded-xl p-4">
                              {page.metadataList && page.metadataList.length > 1 ? (
                                <>
                                  <div className="flex items-center gap-2 mb-4 pb-3 border-b border-slate-800">
                                    <span className="px-2.5 py-1 bg-amber-950/40 border border-amber-800/30 text-amber-400 text-[10px] font-bold rounded-md">
                                      {page.metadataList.length} documentos nesta página
                                    </span>
                                  </div>
                                  {page.metadataList.map((docMeta, docIdx) => (
                                    <div key={docIdx} className="mb-4 pb-4 border-b border-slate-800/50 last:border-0 last:pb-0 last:mb-0">
                                      <span className="text-[9px] font-bold text-amber-400 uppercase tracking-wider block mb-3">
                                        Documento {docIdx + 1}
                                      </span>
                                      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                        <div className="flex flex-col gap-1.5">
                                          <label className="text-[9px] font-bold text-slate-500 uppercase tracking-wider">Empregador</label>
                                          <input type="text" value={docMeta.companyName || ""}
                                            onChange={(e) => handleCombinedMetadataEdit(idx, docIdx, "companyName", e.target.value)}
                                            className="text-xs bg-slate-900 border border-slate-700 rounded-lg p-2.5 font-semibold text-slate-200 focus:outline-hidden focus:border-amber-500" />
                                        </div>
                                        <div className="flex flex-col gap-1.5">
                                          <label className="text-[9px] font-bold text-slate-500 uppercase tracking-wider">Nome do Funcionário</label>
                                          <input type="text" value={docMeta.pessoaNome || ""}
                                            onChange={(e) => handleCombinedMetadataEdit(idx, docIdx, "pessoaNome", e.target.value)}
                                            className="text-xs bg-slate-900 border border-slate-700 rounded-lg p-2.5 font-semibold text-slate-200 focus:outline-hidden focus:border-amber-500" />
                                        </div>
                                        {docMeta.documentType !== "folha_pagamento" && (
                                          <div className="flex flex-col gap-1.5">
                                            <label className="text-[9px] font-bold text-slate-500 uppercase tracking-wider">Valor R$</label>
                                            <input type="number" step="0.01" value={docMeta.valor !== null ? docMeta.valor : ""}
                                              onChange={(e) => handleCombinedMetadataEdit(idx, docIdx, "valor", e.target.value ? parseFloat(e.target.value) : null)}
                                              className="text-xs bg-slate-900 border border-slate-700 rounded-lg p-2.5 font-semibold text-slate-200 focus:outline-hidden focus:border-amber-500" />
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  ))}
                                </>
                              ) : (
                                <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
                                  <div className="flex flex-col gap-1.5 md:col-span-4">
                                    <label className="text-[9px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                                      <FileCode className="w-3.5 h-3.5 text-indigo-400" />
                                      Tipo de Documento
                                    </label>
                                    <select value={page.metadata.documentType}
                                      onChange={(e) => {
                                        const typeVal = e.target.value as any;
                                        handleManualMetadataEdit(idx, "documentType", typeVal);
                                        handleManualMetadataEdit(idx, "isNotaFiscal", typeVal === "nota_fiscal");
                                      }}
                                      className="text-xs bg-slate-900/85 border border-slate-700 rounded-lg p-2.5 font-semibold text-slate-200 focus:outline-hidden focus:border-indigo-500 cursor-pointer">
                                      <option value="nota_fiscal">Nota Fiscal (INVOICE)</option>
                                      <option value="imposto">Imposto / Guia de Taxa</option>
                                      <option value="darf">DARF (Federais)</option>
                                      <option value="extrato">Extrato Bancário</option>
                                      <option value="planilha">Planilha / Tabela</option>
                                      <option value="folha_pagamento">Folha de Pagamento</option>
                                      <option value="outros">Outros</option>
                                      <option value="nao_identificado">Não Identificado</option>
                                    </select>
                                  </div>
                                  <div className="flex flex-col gap-1.5 md:col-span-3">
                                    <label className="text-[9px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                                      <Hash className="w-3.5 h-3.5 text-indigo-400" />
                                      Número {page.metadata.isNotaFiscal ? "da Nota" : "(Imposto)"}
                                    </label>
                                    <input type="text" disabled={!page.metadata.isNotaFiscal}
                                      value={page.metadata.isNotaFiscal ? (page.metadata.notaNumber || "") : "imposto"}
                                      onChange={(e) => handleManualMetadataEdit(idx, "notaNumber", e.target.value)}
                                      className="text-xs bg-slate-900 border border-slate-700 disabled:bg-slate-900/50 disabled:text-slate-600 disabled:border-slate-900 rounded-lg p-2.5 font-semibold text-slate-200 focus:outline-hidden focus:border-indigo-500" />
                                  </div>
                                  <div className="flex flex-col gap-1.5 md:col-span-3">
                                    <label className="text-[9px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                                      <Briefcase className="w-3.5 h-3.5 text-indigo-400" />
                                      {page.metadata.documentType === "folha_pagamento" ? "Empregador" : "Emitente"}
                                    </label>
                                    <input type="text" value={page.metadata.companyName || ""}
                                      onChange={(e) => handleManualMetadataEdit(idx, "companyName", e.target.value)}
                                      className="text-xs bg-slate-900 border border-slate-700 rounded-lg p-2.5 font-semibold text-slate-200 focus:outline-hidden focus:border-indigo-500" />
                                  </div>
                                  {page.metadata.documentType === "folha_pagamento" && (
                                    <div className="flex flex-col gap-1.5 md:col-span-3">
                                      <label className="text-[9px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                                        <Briefcase className="w-3.5 h-3.5 text-amber-400" />
                                        Nome do Funcionário
                                      </label>
                                      <input type="text" value={page.metadata.pessoaNome || ""}
                                        onChange={(e) => handleManualMetadataEdit(idx, "pessoaNome", e.target.value)}
                                        className="text-xs bg-slate-900 border border-slate-700 rounded-lg p-2.5 font-semibold text-slate-200 focus:outline-hidden focus:border-amber-500" />
                                    </div>
                                  )}
                                  {page.metadata.documentType !== "folha_pagamento" && (
                                    <div className="flex flex-col gap-1.5 md:col-span-3">
                                      <label className="text-[9px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                                        <DollarSign className="w-3.5 h-3.5 text-indigo-400" />
                                        Valor total líquido R$
                                      </label>
                                      <input type="number" step="0.01" value={page.metadata.valor !== null ? page.metadata.valor : ""}
                                        onChange={(e) => handleManualMetadataEdit(idx, "valor", e.target.value ? parseFloat(e.target.value) : null)}
                                        className="text-xs bg-slate-900 border border-slate-700 rounded-lg p-2.5 font-semibold text-slate-200 focus:outline-hidden focus:border-indigo-500" />
                                    </div>
                                  )}
                                </div>
                              )}
                              <div className="flex flex-col gap-1.5 md:col-span-6 mt-4 pt-4 border-t border-slate-800">
                                <span className="text-[9px] font-bold text-slate-500 uppercase tracking-widest block">
                                  Ajustar nome do arquivo físico resultante
                                </span>
                                <input type="text" value={page.customFilename}
                                  onChange={(e) => handleManualFilenameDirectEdit(idx, e.target.value)}
                                  className="text-xs bg-slate-900 border border-slate-700 rounded-lg p-2.5 font-mono text-slate-300 focus:outline-hidden focus:border-indigo-500" />
                              </div>
                              <div className="flex justify-end mt-3">
                                <button
                                  onClick={() => {
                                    setCorrectionPageId(page.id);
                                    setCorrectionFields({});
                                    setShowCorrection(true);
                                  }}
                                  className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white font-bold rounded-lg text-xs transition-colors flex items-center gap-1.5 cursor-pointer"
                                >
                                  <RefreshCw className="w-3.5 h-3.5" />
                                  Reprocessar página
                                </button>
                              </div>
                            </div>
                          )}

                          {/* Failure Retry Box style */}
                          {page.status === "failed" && (
                            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 p-3.5 bg-rose-950/40 border border-rose-900/30 text-rose-300 rounded-xl">
                              <div className="flex-1 min-w-0">
                                <span className="text-xs font-semibold block">
                                  {page.error?.includes("Cota") || page.error?.includes("Muitas requisições")
                                    ? "⚠️ " + page.error
                                    : page.error?.includes("Chave")
                                    ? "🔑 " + page.error
                                    : page.error?.includes("Provedor não aceita")
                                    ? "📄 " + page.error
                                    : page.error}
                                </span>
                                {(page.error?.includes("Cota") || page.error?.includes("requisições")) && (
                                  <span className="text-[11px] text-rose-400/60 mt-1 block">
                                    Tente novamente em alguns minutos ou escolha outro provedor nas configurações ⚙️
                                  </span>
                                )}
                                {page.error?.includes("Chave") && (
                                  <span className="text-[11px] text-rose-400/60 mt-1 block">
                                    Vá em Configurações ⚙️ e adicione uma chave válida
                                  </span>
                                )}
                                {page.error?.includes("Provedor não aceita") && (
                                  <span className="text-[11px] text-rose-400/60 mt-1 block">
                                    Troque para Google Gemini ou outro provedor com suporte a imagens ⚙️
                                  </span>
                                )}
                              </div>
                              <button
                                onClick={async () => {
                                  setSplitPages(prev => prev.map(p => p.id === page.id ? { ...p, status: "processing" } : p));
                                  const res = await processSinglePage(page.id, page);
                                  setSplitPages(prev => prev.map(p => p.id === page.id ? res : p));
                                }}
                                className="px-3 py-1 bg-rose-900 hover:bg-rose-800 text-white font-bold rounded-lg text-xs transition-colors flex items-center gap-1 cursor-pointer shrink-0"
                              >
                                <RefreshCw className="w-3.5 h-3.5" />
                                Re-tentar
                              </button>
                            </div>
                          )}
                        </motion.div>
                      );
                    })}
                  </AnimatePresence>
                </div>
              </div>
            </>
          )}

          {/* Guide description card when no PDF uploaded (Bento block styled) */}
          {!selectedFile && (
            <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-xl shadow-black/30 flex flex-col gap-6">
              <h3 className="text-xs font-bold text-slate-300 uppercase tracking-widest flex items-center gap-2">
                <Info className="w-4 h-4 text-indigo-400" />
                Como Funciona o Processamento?
              </h3>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                
                <div className="p-4 bg-slate-950/60 rounded-2xl border border-slate-800/80 flex gap-3">
                  <div className="w-6.5 h-6.5 rounded-full bg-slate-900 border border-slate-800 flex items-center justify-center text-xs font-bold text-slate-400 shrink-0 mt-0.5">
                    1
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-slate-200">Arraste seu documento</h4>
                    <p className="text-[12px] text-slate-400 leading-normal mt-0.5">Selecione o arquivo PDF digitalizado em bloco que contém guias, notas ou DARFs consolidadas.</p>
                  </div>
                </div>

                <div className="p-4 bg-slate-950/60 rounded-2xl border border-slate-800/80 flex gap-3">
                  <div className="w-6.5 h-6.5 rounded-full bg-indigo-950/50 border border-indigo-900/30 flex items-center justify-center text-xs font-bold text-indigo-400 shrink-0 mt-0.5">
                    2
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-slate-200">Extração com Gemini API</h4>
                    <p className="text-[12px] text-slate-400 leading-normal mt-0.5">Nossa API lê meticulosamente página por página do PDF sem expor chaves públicas aos navegadores dos clientes.</p>
                  </div>
                </div>

                <div className="p-4 bg-slate-950/60 rounded-2xl border border-slate-800/80 flex gap-3 md:col-span-1">
                  <div className="w-6.5 h-6.5 rounded-full bg-slate-900 border border-slate-800 flex items-center justify-center text-xs font-bold text-slate-400 shrink-0 mt-0.5">
                    3
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-slate-200">Regras Inteligentes de Nomes</h4>
                    <p className="text-[12px] text-slate-400 leading-normal mt-0.5">
                      Para Notas, vira: <code className="bg-slate-900 text-indigo-300 px-1 py-0.5 rounded-md text-[11px] font-mono">nome_n°nota_empresa_valor.pdf</code>.
                      Se não for nota, o número é substituído por <code className="bg-slate-900 text-indigo-300 px-1 py-0.5 rounded-md text-[11px] font-mono">imposto</code>, ou <code className="bg-slate-900 text-indigo-300 px-1 py-0.5 rounded-md text-[11px] font-mono">imposto_darf</code> no emissor.
                    </p>
                  </div>
                </div>

                <div className="p-4 bg-slate-950/60 rounded-2xl border border-slate-800/80 flex gap-3 md:col-span-1">
                  <div className="w-6.5 h-6.5 rounded-full bg-slate-900 border border-slate-800 flex items-center justify-center text-xs font-bold text-slate-400 shrink-0 mt-0.5">
                    4
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-slate-200">Revisão Integrada & ZIP Download</h4>
                    <p className="text-[12px] text-slate-400 leading-normal mt-0.5">Edite em tempo real qualquer valor diretamente na interface Bento antes de empacotar todos os PDFs processados.</p>
                  </div>
                </div>

              </div>
            </div>
          )}
        </section>
      </main>
      
      {/* Visual Footer */}
      <footer className="py-8 bg-slate-900/20 border-t border-slate-900 text-center mt-12 px-4.5">
        <p className="text-xs text-slate-500 font-medium">
          AI Disec PDF v{appVersion} • 10 provedores de IA • 100% processamento local.
        </p>
      </footer>

      {/* Documentation Modal */}
      {showDocModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setShowDocModal(false)}>
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 w-full max-w-2xl max-h-[80vh] overflow-y-auto shadow-2xl mx-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <FileCheck className="w-4.5 h-4.5 text-indigo-400" />
                Documentação - AI Disec PDF
              </h3>
              <button onClick={() => setShowDocModal(false)} className="p-1.5 hover:bg-slate-800 rounded-lg text-slate-400 cursor-pointer">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="space-y-4 text-sm text-slate-300 leading-relaxed">
              <section>
                <h4 className="font-bold text-white text-base mb-2">O que é o AI Disec PDF?</h4>
                <p>Divida automaticamente PDFs com várias páginas em arquivos individuais, renomeados inteligentemente por IA.</p>
              </section>
              <section>
                <h4 className="font-bold text-white text-base mb-2">Como usar</h4>
                <ol className="list-decimal list-inside space-y-1 text-slate-400">
                  <li>Arraste um PDF ou clique em &quot;Selecionar PDF&quot;</li>
                  <li>Clique em &quot;Identificar &amp; Organizar Páginas&quot;</li>
                  <li>Revise e edite os metadados extraídos</li>
                  <li>Baixe o ZIP com os arquivos renomeados</li>
                </ol>
              </section>
              <section>
                <h4 className="font-bold text-white text-base mb-2">Provedores de IA</h4>
                <p>São 9 provedores disponíveis. Escolha em Configurações (ícone de engrenagem):</p>
                <ul className="list-disc list-inside space-y-1 text-slate-400 mt-1">
                  <li><strong className="text-slate-200">NVIDIA Llama 3.2 Vision</strong> — Modelo 11B rápido</li>
                  <li><strong className="text-slate-200">Google Gemini 2.5 Flash</strong> — Rápido, suporta imagens</li>
                  <li><strong className="text-slate-200">OpenAI GPT-4o</strong> — Modelo multimodal da OpenAI</li>
                  <li><strong className="text-slate-200">Anthropic Claude Sonnet 4</strong> — Multimodal</li>
                  <li><strong className="text-slate-200">Mistral OCR</strong> — OCR em nuvem</li>
                  <li><strong className="text-slate-200">OpenRouter</strong> — Modelos grátis de visão</li>
                  <li><strong className="text-slate-200">Ollama Cloud</strong> — Llama Vision via Ollama</li>
                  <li><strong className="text-slate-200">Codex Pro</strong> — Limite elevado via login OAuth</li>
                  <li><strong className="text-slate-200">Ollama Local</strong> — 100% offline, download automático</li>
                </ul>
              </section>
              <section>
                <h4 className="font-bold text-white text-base mb-2">Componentes do Nome do Arquivo</h4>
                <p>Você pode ativar/desativar cada parte do nome gerado:</p>
                <ul className="list-disc list-inside space-y-1 text-slate-400 mt-1">
                  <li><strong className="text-slate-200">Nº da Página</strong> — pag1, pag2, etc.</li>
                  <li><strong className="text-slate-200">Tipo do Documento</strong> — nota, imposto, FOPAG, etc.</li>
                  <li><strong className="text-slate-200">Empresa/Pessoa</strong> — Nome do emitente</li>
                  <li><strong className="text-slate-200">Valor</strong> — Valor monetário</li>
                  <li><strong className="text-slate-200">Formato Compacto</strong> — Ignora partes vazias</li>
                  <li><strong className="text-slate-200">Omitir Prefixo</strong> — Remove nome do arquivo original</li>
                </ul>
              </section>
              <section>
                <h4 className="font-bold text-white text-base mb-2">Privacidade</h4>
                <p>Todo processamento é local. Os dados vão apenas para o provedor de IA escolhido. Nenhum dado é armazenado por nós.</p>
              </section>
              <section className="bg-slate-950 border border-slate-800 rounded-xl p-4">
                <h4 className="font-bold text-white text-base mb-2">Documentos Legais</h4>
                <ul className="list-disc list-inside space-y-1 text-slate-400">
                  <li><a href="#" onClick={(e) => { e.preventDefault(); alert("Termos de Uso — consulte o arquivo legal/TERMS.md no diretório do aplicativo."); }} className="text-indigo-400 hover:text-indigo-300">Termos de Uso (TERMS.md)</a></li>
                  <li><a href="#" onClick={(e) => { e.preventDefault(); alert("Política de Privacidade — consulte o arquivo legal/PRIVACY_POLICY.md no diretório do aplicativo."); }} className="text-indigo-400 hover:text-indigo-300">Política de Privacidade (PRIVACY_POLICY.md)</a></li>
                  <li><a href="#" onClick={(e) => { e.preventDefault(); alert("Aviso LGPD — consulte o arquivo legal/LGPD_NOTICE.md no diretório do aplicativo."); }} className="text-indigo-400 hover:text-indigo-300">Aviso LGPD (LGPD_NOTICE.md)</a></li>
                </ul>
                <p className="text-[11px] text-slate-500 mt-2">Os arquivos estão na pasta <code className="bg-slate-800 px-1 rounded">legal/</code> na raiz do aplicativo.</p>
              </section>
            </div>
            <div className="flex justify-end mt-6">
              <button onClick={() => setShowDocModal(false)} className="px-5 py-2.5 text-sm font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl transition-all cursor-pointer">
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Settings Modal */}
      {showSettings && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setShowSettings(false)}>
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 w-full max-w-md shadow-2xl mx-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Cog className="w-4.5 h-4.5 text-indigo-400" />
                Configurações de API
              </h3>
              <button onClick={() => setShowSettings(false)} className="p-1.5 hover:bg-slate-800 rounded-lg text-slate-400 cursor-pointer">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">Provedor de IA</label>
                <select
                  value={settingsProvider}
                  onChange={e => setSettingsProvider(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/40 cursor-pointer"
                >
                  <optgroup label="Modelos na Nuvem (API Key)">
                    <option value="NVIDIA">NVIDIA (Llama 3.2 11B Vision — rápido, grátis)</option>
                    <option value="GOOGLE">Google Gemini 2.5 Flash</option>
                    <option value="OPENAI">OpenAI (GPT-4o)</option>
                    <option value="ANTHROPIC">Anthropic (Claude Sonnet 4)</option>
                    <option value="MISTRAL">Mistral (OCR + classificação)</option>
                    <option value="OPENROUTER">OpenRouter (Gemma 4 26B — FREE)</option>
                    <option value="OLLAMA_CLOUD">Ollama Cloud (token ollama.com)</option>
                    <option value="CODEX">Codex Pro (login OAuth)</option>
                  </optgroup>
                  <optgroup label="Modelo Local (offline, sem chave)">
                    <option value="LOCAL_OLLAMA">Ollama Local (offline, download automático)</option>
                  </optgroup>
                </select>
              </div>

              {settingsProvider === "LOCAL_OLLAMA" ? (
                <OllamaLocalSetup model={settingsLocalModel} onModelChange={setSettingsLocalModel} />
              ) : settingsProvider === "CODEX" ? (
                <CodexLogin apiKey={settingsApiKey} setApiKey={setSettingsApiKey} />
              ) : (
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                    {settingsProvider === "OLLAMA_CLOUD" ? "Token Ollama Cloud" : "Chave de API"}
                  </label>
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <input
                        type={showApiKey ? "text" : "password"}
                        value={settingsApiKey}
                        onChange={e => setSettingsApiKey(e.target.value)}
                        placeholder={settingsApiKey ? "Chave salva. Digite para trocar." : "Cole sua chave aqui"}
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/40 pr-10"
                      />
                      <button
                        type="button"
                        onClick={() => setShowApiKey(!showApiKey)}
                        className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-500 hover:text-slate-300 cursor-pointer"
                        tabIndex={-1}
                      >
                        {showApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                    {settingsApiKey && (
                      <button
                        onClick={() => setSettingsApiKey("")}
                        className="px-3 py-2.5 text-xs font-bold text-rose-400 bg-rose-950/30 border border-rose-900/30 hover:bg-rose-950/50 rounded-xl transition-all cursor-pointer shrink-0"
                        title="Remover chave"
                      >
                        Remover
                      </button>
                    )}
                  </div>
                  <p className="text-[11px] text-slate-500 mt-1.5">
                    {settingsProvider === "OLLAMA_CLOUD"
                      ? "Obtenha o token em ollama.com/signup"
                      : settingsApiKey
                        ? "Chave salva em ~/.ai-disec-pdf/settings.json"
                        : "Sua chave fica salva localmente no disco."}
                  </p>
                </div>
              )}
            </div>

            <div className="flex gap-3 mt-6">
              <button
                onClick={() => setShowSettings(false)}
                className="flex-1 px-4 py-2.5 text-sm font-bold text-slate-300 bg-slate-800 hover:bg-slate-700 rounded-xl transition-all cursor-pointer"
              >
                Cancelar
              </button>
              <button
                onClick={async () => { window.electronAPI?.checkForUpdate(); setUpdateState("checking"); }}
                className="px-4 py-2.5 text-sm font-bold text-cyan-300 bg-cyan-950/40 border border-cyan-800/30 hover:bg-cyan-950/60 rounded-xl transition-all cursor-pointer flex items-center gap-2"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Atualizações
              </button>
              <button
                onClick={saveSettings}
                disabled={savingSettings}
                className="flex-1 px-4 py-2.5 text-sm font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl transition-all disabled:opacity-50 cursor-pointer"
              >
                {savingSettings ? "Salvando..." : "Salvar"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Update overlay */}
      <AnimatePresence>
        {updateState !== "idle" && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-slate-900 border border-slate-800 rounded-2xl p-6 w-full max-w-sm mx-4 shadow-2xl"
            >
              {updateState === "checking" && (
                <>
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-10 h-10 rounded-xl bg-indigo-500/20 flex items-center justify-center">
                      <Loader2 className="w-5 h-5 text-indigo-400 animate-spin" />
                    </div>
                    <div>
                      <h3 className="text-base font-bold text-white">Verificando atualizações...</h3>
                      <p className="text-sm text-slate-400">Consultando GitHub</p>
                    </div>
                  </div>
                  <button
                    onClick={() => setUpdateState("idle")}
                    className="w-full px-4 py-2.5 text-sm font-bold text-slate-300 bg-slate-800 hover:bg-slate-700 rounded-xl transition-all cursor-pointer"
                  >
                    Fechar
                  </button>
                </>
              )}
              {updateState === "available" && (
                <>
                  <div className="flex items-center gap-3 mb-3">
                    <div className="w-10 h-10 rounded-xl bg-indigo-500/20 flex items-center justify-center">
                      <Sparkles className="w-5 h-5 text-indigo-400" />
                    </div>
                    <div>
                      <h3 className="text-base font-bold text-white">Atualização disponível</h3>
                      <p className="text-sm text-slate-400">v{updateVersion}</p>
                    </div>
                  </div>
                  <p className="text-sm text-slate-300 mb-5">
                    Uma nova versão do AI Disec PDF está disponível. Deseja baixar agora?
                  </p>
                  <div className="flex gap-3">
                    <button
                      onClick={() => setUpdateState("idle")}
                      className="flex-1 px-4 py-2.5 text-sm font-bold text-slate-300 bg-slate-800 hover:bg-slate-700 rounded-xl transition-all cursor-pointer"
                    >
                      Agora não
                    </button>
                    <button
                      onClick={() => window.electronAPI?.confirmDownload()}
                      className="flex-1 px-4 py-2.5 text-sm font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl transition-all cursor-pointer"
                    >
                      Baixar
                    </button>
                  </div>
                </>
              )}
              {updateState === "downloading" && (
                <>
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-10 h-10 rounded-xl bg-indigo-500/20 flex items-center justify-center">
                      <Loader2 className="w-5 h-5 text-indigo-400 animate-spin" />
                    </div>
                    <div>
                      <h3 className="text-base font-bold text-white">Baixando atualização...</h3>
                      <p className="text-sm text-slate-400">{updateProgress}%</p>
                    </div>
                  </div>
                  <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden">
                    <motion.div
                      className="h-full bg-indigo-500 rounded-full"
                      initial={{ width: 0 }}
                      animate={{ width: `${updateProgress}%` }}
                      transition={{ duration: 0.3 }}
                    />
                  </div>
                  <p className="text-xs text-slate-500 mt-2 text-center">{updateProgress}% concluído</p>
                </>
              )}
              {updateState === "downloaded" && (
                <>
                  <div className="flex items-center gap-3 mb-3">
                    <div className="w-10 h-10 rounded-xl bg-emerald-500/20 flex items-center justify-center">
                      <CheckCircle className="w-5 h-5 text-emerald-400" />
                    </div>
                    <div>
                      <h3 className="text-base font-bold text-white">Atualização pronta!</h3>
                      <p className="text-sm text-slate-400">v{updateVersion}</p>
                    </div>
                  </div>
                  <p className="text-sm text-slate-300 mb-5">
                    A atualização foi baixada. Reiniciar o app agora para instalar?
                  </p>
                  <div className="flex gap-3">
                    <button
                      onClick={() => setUpdateState("idle")}
                      className="flex-1 px-4 py-2.5 text-sm font-bold text-slate-300 bg-slate-800 hover:bg-slate-700 rounded-xl transition-all cursor-pointer"
                    >
                      Depois
                    </button>
                    <button
                      onClick={() => window.electronAPI?.restartApp()}
                      className="flex-1 px-4 py-2.5 text-sm font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl transition-all cursor-pointer"
                    >
                      Reiniciar
                    </button>
                  </div>
                </>
              )}
              {updateState === "error" && (
                <>
                  <div className="flex items-center gap-3 mb-3">
                    <div className="w-10 h-10 rounded-xl bg-rose-500/20 flex items-center justify-center">
                      <AlertCircle className="w-5 h-5 text-rose-400" />
                    </div>
                    <div>
                      <h3 className="text-base font-bold text-white">Erro na atualização</h3>
                    </div>
                  </div>
                  <p className="text-sm text-slate-300 mb-5">{updateError}</p>
                  <button
                    onClick={() => setUpdateState("idle")}
                    className="w-full px-4 py-2.5 text-sm font-bold text-white bg-slate-700 hover:bg-slate-600 rounded-xl transition-all cursor-pointer"
                  >
                    Fechar
                  </button>
                </>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Reprocess correction dialog */}
      {showCorrection && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setShowCorrection(false)}>
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 w-full max-w-md mx-4 shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <RefreshCw className="w-4.5 h-4.5 text-amber-400" />
                Reprocessar página
              </h3>
              <button onClick={() => setShowCorrection(false)} className="p-1.5 hover:bg-slate-800 rounded-lg text-slate-400 cursor-pointer">
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-sm text-slate-300 mb-4">Quais campos estão incorretos? Selecione abaixo:</p>
            <div className="space-y-2 mb-5">
              {[
                { key: "documentType", label: "Tipo de documento" },
                { key: "companyName", label: "Nome da empresa/emitente" },
                { key: "pessoaNome", label: "Nome do funcionário" },
                { key: "valor", label: "Valor" },
                { key: "notaNumber", label: "Número da nota" },
              ].map(field => (
                <label key={field.key} className="flex items-center gap-3 p-3 bg-slate-950 border border-slate-800 rounded-xl cursor-pointer hover:border-slate-700 transition-colors">
                  <input
                    type="checkbox"
                    checked={!!correctionFields[field.key]}
                    onChange={e => setCorrectionFields(prev => ({ ...prev, [field.key]: e.target.checked }))}
                    className="w-4 h-4 accent-amber-500 cursor-pointer"
                  />
                  <span className="text-sm text-slate-200 font-medium">{field.label}</span>
                </label>
              ))}
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setShowCorrection(false)}
                className="flex-1 px-4 py-2.5 text-sm font-bold text-slate-300 bg-slate-800 hover:bg-slate-700 rounded-xl transition-all cursor-pointer"
              >
                Cancelar
              </button>
              <button
                onClick={async () => {
                  const selected = Object.entries(correctionFields).filter(([, v]) => v).map(([k]) => k);
                  if (selected.length === 0) { alert("Selecione ao menos um campo."); return; }
                  setShowCorrection(false);
                  const page = splitPages.find(p => p.id === correctionPageId);
                  if (!page) return;
                  setSplitPages(prev => prev.map(p => p.id === correctionPageId ? { ...p, status: "processing" } : p));
                  const correctionMsg = "O usuário indicou que o(s) seguinte(s) campo(s) pode(m) estar incorreto(s): " + selected.join(", ") + ". Reavalie com atenção especial.";
                  const res = await processSinglePage(page.id, page, correctionMsg);
                  setSplitPages(prev => prev.map(p => p.id === correctionPageId ? res : p));
                }}
                className="flex-1 px-4 py-2.5 text-sm font-bold text-white bg-amber-600 hover:bg-amber-700 rounded-xl transition-all cursor-pointer"
              >
                Reprocessar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
