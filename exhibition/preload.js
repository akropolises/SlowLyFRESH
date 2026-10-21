// 展示の画面のpreload。スタッフ用キー、全画面・小さな表示の切り替え、本物のゆっくリフレッシュに予定を渡す口を渡す
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("exhibitBridge", {
  onCommand: (callback) => ipcRenderer.on("exhibit-command", (_event, command) => callback(command)),
  // { mode: "full" | "window" | "widget", width, height }(widgetのときだけ大きさを渡す)
  setWindowMode: (options) => ipcRenderer.invoke("exhibit-window-mode", options),
  releaseFocus: () => ipcRenderer.invoke("exhibit-release-focus"),
  // 本物のアプリに「次の予定」を渡す(nullで消す)
  setMeeting: (meeting) => ipcRenderer.invoke("exhibit-set-meeting", meeting),
  triggerSlow: (eventId) => ipcRenderer.invoke("exhibit-trigger-slow", eventId),
});
