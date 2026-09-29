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
});
