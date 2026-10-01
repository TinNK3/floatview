const { contextBridge, ipcRenderer, webUtils } = require('electron');

const on = (channel) => (fn) => {
  const handler = (_e, payload) => fn(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};

contextBridge.exposeInMainWorld('floatview', {
  getState: () => ipcRenderer.invoke('get-state'),
  openLink: (input, opts) => ipcRenderer.invoke('open-link', input, opts),
  updateHistory: (url, patch) => ipcRenderer.invoke('update-history', url, patch),
  clearHistory: () => ipcRenderer.invoke('clear-history'),
  clearSiteData: () => ipcRenderer.invoke('clear-site-data'),
  setSetting: (key, value) => ipcRenderer.invoke('set-setting', key, value),
  pickYtDlp: () => ipcRenderer.invoke('pick-ytdlp'),
  getInjectScript: () => ipcRenderer.invoke('get-inject-script'),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  openDataFile: () => ipcRenderer.invoke('open-data-file'),
  window: (action, arg) => ipcRenderer.send('window', action, arg),
  pathForFile: (file) => webUtils.getPathForFile(file),
  onState: on('state'),
  onCommand: on('command'),
  onCursor: on('cursor'),
  onHandleHot: on('handle-hot'),
  onSize: on('size'),
  // clock, Pomodoro, move reminder, sounds
  timer: (action, arg) => ipcRenderer.invoke('timer', action, arg),
  getTimer: () => ipcRenderer.invoke('get-timer'),
  getClockAssets: () => ipcRenderer.invoke('get-clock-assets'),
  setSection: (section, value) => ipcRenderer.invoke('set-section', section, value),
  addSound: (testPath) => ipcRenderer.invoke('add-sound', testPath),
  removeSound: (id) => ipcRenderer.invoke('remove-sound', id),
  getStats: () => ipcRenderer.invoke('get-stats'),
  resetStats: () => ipcRenderer.invoke('reset-stats'),
  onTimerState: on('timer-state'),
  onTimerVideo: on('timer-video'),
  onPlaySound: on('play-sound'),
  onSettings: on('settings'),
  // "Up next" queue
  getQueue: () => ipcRenderer.invoke('get-queue'),
  setQueue: (q) => ipcRenderer.invoke('set-queue', q),
  expandPaths: (paths) => ipcRenderer.invoke('expand-paths', paths),
  expandPlaylist: (url) => ipcRenderer.invoke('expand-playlist', url),
  // hotkeys (Settings → Keys)
  getHotkeys: () => ipcRenderer.invoke('get-hotkeys'),
  setHotkey: (action, accel) => ipcRenderer.invoke('set-hotkey', action, accel),
  resetHotkeys: () => ipcRenderer.invoke('reset-hotkeys'),
  pauseHotkeys: (on) => ipcRenderer.invoke('pause-hotkeys', on),
});
