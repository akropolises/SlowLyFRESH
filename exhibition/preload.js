// 展示の画面のpreload。スタッフ用キー、全画面・ウィンドウの切り替え、本物のゆっくリフレッシュとのやりとりの口を渡す
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("exhibitBridge", {
  onCommand: (callback) => ipcRenderer.on("exhibit-command", (_event, command) => callback(command)),
  setWindowMode: (mode) => ipcRenderer.invoke("exhibit-window-mode", mode),
  // 本物のアプリに「次の予定」を渡す(nullで消す)
  setMeeting: (meeting) => ipcRenderer.invoke("exhibit-set-meeting", meeting),
  triggerSlow: (eventId) => ipcRenderer.invoke("exhibit-trigger-slow", eventId),
  // 本物のアプリの全画面が始まった("enter")・終わった("leave")
  onSlowMode: (callback) => ipcRenderer.on("exhibit-slow-mode", (_event, mode) => callback(mode)),
});
