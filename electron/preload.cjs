const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  platform: process.platform,
  startProcessing: () => ipcRenderer.send("processing-started"),
  endProcessing: () => ipcRenderer.send("processing-ended"),
  onUpdateChecking: (fn) => {
    const cb = () => fn();
    ipcRenderer.on("update-checking", cb);
    return () => ipcRenderer.removeListener("update-checking", cb);
  },
  onUpdateAvailable: (fn) => {
    const cb = (_event, version) => fn(version);
    ipcRenderer.on("update-available", cb);
    return () => ipcRenderer.removeListener("update-available", cb);
  },
  onUpdateNotAvailable: (fn) => {
    const cb = () => fn();
    ipcRenderer.on("update-not-available", cb);
    return () => ipcRenderer.removeListener("update-not-available", cb);
  },
  onUpdateProgress: (fn) => {
    const cb = (_event, percent) => fn(percent);
    ipcRenderer.on("update-progress", cb);
    return () => ipcRenderer.removeListener("update-progress", cb);
  },
  onUpdateDownloaded: (fn) => {
    const cb = (_event, version) => fn(version);
    ipcRenderer.on("update-downloaded", cb);
    return () => ipcRenderer.removeListener("update-downloaded", cb);
  },
  onUpdateError: (fn) => {
    const cb = (_event, message) => fn(message);
    ipcRenderer.on("update-error", cb);
    return () => ipcRenderer.removeListener("update-error", cb);
  },
  confirmDownload: () => ipcRenderer.send("confirm-update"),
  restartApp: () => ipcRenderer.send("restart-app"),
  checkForUpdate: () => ipcRenderer.send("check-for-update"),

  // Ollama local: detectar hardware, instalar, baixar modelo, status
  getHardware: () => ipcRenderer.invoke("ollama:get-hardware"),
  checkInstalled: () => ipcRenderer.invoke("ollama:check-installed"),
  install: () => ipcRenderer.invoke("ollama:install"),
  pullModel: (model) => ipcRenderer.invoke("ollama:pull-model", model),
  onPullProgress: (fn) => {
    const cb = (_e, progress) => fn(progress);
    ipcRenderer.on("ollama:pull-progress", cb);
    return () => ipcRenderer.removeListener("ollama:pull-progress", cb);
  },

  // Codex OAuth login
  codexLogin: () => ipcRenderer.invoke("codex:login"),
  codexLogout: () => ipcRenderer.invoke("codex:logout"),
});
