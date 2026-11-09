/**
 * FastStream macOS Application Main Entry
 */

import { app, BrowserWindow, Menu } from 'electron';
import * as path from 'path';
import { FastStreamManager } from './ipc_handlers';

let manager: FastStreamManager | null = null;
let mainWindow: BrowserWindow | null = null;

function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1040,
    height: 680,
    minWidth: 840,
    minHeight: 520,
    title: 'FastStream',
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#090c14',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: false,
    },
  });

  win.loadFile(path.join(__dirname, '../../ui/index.html'));

  win.on('closed', () => {
    mainWindow = null;
  });

  return win;
}

function setupMenu(): void {
  const isMac = process.platform === 'darwin';
  const template: any = [
    ...(isMac
      ? [
          {
            label: 'FastStream',
            submenu: [
              { role: 'about', label: 'About FastStream' },
              { type: 'separator' },
              { role: 'services' },
              { type: 'separator' },
              { role: 'hide', label: 'Hide FastStream' },
              { role: 'hideOthers', label: 'Hide Others' },
              { role: 'unhide', label: 'Show All' },
              { type: 'separator' },
              { role: 'quit', label: 'Quit FastStream' },
            ],
          },
        ]
      : []),
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        { role: 'close' },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(() => {
  setupMenu();
  manager = new FastStreamManager();
  mainWindow = createMainWindow();
  manager.setMainWindow(mainWindow);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createMainWindow();
      manager?.setMainWindow(mainWindow);
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
