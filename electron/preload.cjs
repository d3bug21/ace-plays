// Ace Plays! - minimal, safe bridge for desktop-only conveniences.
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('acePlaysDesktop', {
  isDesktop: true,
  platform: process.platform,
  toggleFullscreen: () => ipcRenderer.invoke('ace:toggle-fullscreen'),
  isFullscreen: () => ipcRenderer.invoke('ace:is-fullscreen'),
  quit: () => ipcRenderer.invoke('ace:quit'),
});
