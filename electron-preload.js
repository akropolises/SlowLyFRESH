const { contextBridge, ipcRenderer } = require("electron");

const bridge = {
  isElectron: true,
  setReminders(reminders) {
    return ipcRenderer.invoke("set-reminders", reminders);
  },
  showWindow() {
    return ipcRenderer.invoke("show-window");
  },
  enterSlowMode() {
    return ipcRenderer.invoke("enter-slow-mode");
  },
  leaveSlowMode() {
    return ipcRenderer.invoke("leave-slow-mode");
  },
  loadGoogleEvents(config) {
    return ipcRenderer.invoke("load-google-events", config);
  },
  clearGoogleAuth() {
    return ipcRenderer.invoke("clear-google-auth");
  },
  revokeGoogleAuth() {
    return ipcRenderer.invoke("revoke-google-auth");
  },
  openPrivacyPolicy() {
    return ipcRenderer.invoke("open-privacy-policy");
  },
  onStartSlow(callback) {
    ipcRenderer.on("electron-start-slow", (_event, proposalId) => {
      callback(proposalId);
    });
  },
};

contextBridge.exposeInMainWorld("MicroSlowElectron", bridge);
contextBridge.exposeInMainWorld("SlowIndexElectron", bridge);
