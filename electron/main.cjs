// Ace Plays! - Electron main process.
const { app, BrowserWindow, ipcMain, shell, Menu } = require('electron');
const path = require('path');

let win = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: '#1d2a33',
    title: 'Ace Plays!',
    show: false,
    autoHideMenuBar: true,
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  if (process.platform !== 'darwin') Menu.setApplicationMenu(null);
  win.once('ready-to-show', () => win && win.show());
  const devUrl = process.env.ACE_DEV_URL;
  if (devUrl) win.loadURL(devUrl);
  else win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));

  // Keep the game self-contained: never navigate the game window away.
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file:') && !(devUrl && url.startsWith(devUrl))) e.preventDefault();
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('before-input-event', (_e, input) => {
    if (input.type === 'keyDown' && input.key === 'F11') win.setFullScreen(!win.isFullScreen());
  });
  win.on('closed', () => { win = null; });
}

ipcMain.handle('ace:toggle-fullscreen', () => {
  if (!win) return false;
  win.setFullScreen(!win.isFullScreen());
  return win.isFullScreen();
});
ipcMain.handle('ace:is-fullscreen', () => (win ? win.isFullScreen() : false));
ipcMain.handle('ace:quit', () => app.quit());

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => app.quit());
// Silence unused warning for shell in sandboxed builds.
void shell;
