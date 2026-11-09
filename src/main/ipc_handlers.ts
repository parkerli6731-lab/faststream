/**
 * FastStream Main IPC Handler & Bridge
 * 桥接表现层请求与纯净室下载引擎
 */

import { ipcMain, dialog, shell, BrowserWindow, clipboard } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { DownloadEngine } from '../core/download_engine';
import { SnifferServer, SniffPayload } from '../core/sniff_server';

export class FastStreamManager {
  private tasks: Map<number, { engine?: DownloadEngine; snap: any }> = new Map();
  private settingsPath: string;
  private settings: any = {};
  private snifferServer: SnifferServer | null = null;
  private mainWindow: BrowserWindow | null = null;

  constructor() {
    const configDir = path.join(os.homedir(), '.faststream');
    fs.mkdirSync(configDir, { recursive: true });
    this.settingsPath = path.join(configDir, 'settings.json');
    this.loadSettings();
    this.initSniffer();
    this.registerIpc();
  }

  public setMainWindow(win: BrowserWindow): void {
    this.mainWindow = win;
  }

  private loadSettings(): void {
    const defaultDir = path.join(os.homedir(), 'Downloads');
    const defaults = {
      defaultDir,
      defaultConnections: 8,
      maxConcurrent: 3,
      maxRateKB: 0,
      autoPasteUrl: true,
    };

    if (fs.existsSync(this.settingsPath)) {
      try {
        this.settings = { ...defaults, ...JSON.parse(fs.readFileSync(this.settingsPath, 'utf-8')) };
        return;
      } catch (e) {}
    }
    this.settings = defaults;
    this.saveSettings();
  }

  private saveSettings(): void {
    fs.writeFileSync(this.settingsPath, JSON.stringify(this.settings, null, 2), 'utf-8');
  }

  private initSniffer(): void {
    this.snifferServer = new SnifferServer(37651, (payload: SniffPayload) => {
      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        this.mainWindow.webContents.send('fs:sniff', payload);
        if (this.mainWindow.isMinimized()) this.mainWindow.restore();
        this.mainWindow.focus();
      }
    });
    this.snifferServer.start().catch((err) => {
      console.warn('[Sniffer] Loopback listener standby:', err.message);
    });
  }

  private broadcastTaskUpdate(snap: any): void {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('fs:taskUpdate', snap);
    }
  }

  private registerIpc(): void {
    ipcMain.handle('fs:list', () => Array.from(this.tasks.values()).map((t) => t.snap));

    ipcMain.handle('fs:add', async (_e, opts) => {
      const taskId = Date.now();
      const dir = opts.dir || this.settings.defaultDir;
      const filename = opts.filename || 'download.bin';
      const connections = opts.connections || this.settings.defaultConnections || 8;
      const maxRateKB = opts.maxRate || this.settings.maxRateKB || 0;

      const engine = new DownloadEngine({
        id: taskId,
        url: opts.url,
        dir,
        filename,
        connections,
        maxRateKB,
        headers: opts.headers,
        onSnapshot: (snap) => {
          this.tasks.set(taskId, { engine, snap });
          this.broadcastTaskUpdate(snap);
        },
      });

      const initialSnap = engine.getSnapshot();
      this.tasks.set(taskId, { engine, snap: initialSnap });
      this.broadcastTaskUpdate(initialSnap);

      // 启动下载
      engine.start().catch((err) => {
        console.error(`[FastStream Engine] Task #${taskId} error:`, err);
      });

      return taskId;
    });

    ipcMain.handle('fs:pause', (_e, id: number) => {
      const t = this.tasks.get(id);
      if (t && t.engine) t.engine.pause();
    });

    ipcMain.handle('fs:resume', (_e, id: number) => {
      const t = this.tasks.get(id);
      if (t && t.engine) {
        t.engine.start().catch((err) => console.error('[Resume Error]:', err));
      }
    });

    ipcMain.handle('fs:remove', (_e, id: number, deleteFile: boolean) => {
      const t = this.tasks.get(id);
      if (t) {
        if (t.engine) t.engine.pause();
        if (deleteFile && t.snap) {
          const fp = path.join(t.snap.dir, t.snap.filename);
          if (fs.existsSync(fp)) fs.unlinkSync(fp);
        }
        this.tasks.delete(id);
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
          this.mainWindow.webContents.send('fs:taskRemove', id);
        }
      }
    });

    ipcMain.handle('fs:defaultDir', () => this.settings.defaultDir);
    ipcMain.handle('fs:chooseDir', async () => {
      const res = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] });
      return res.canceled ? null : res.filePaths[0];
    });

    ipcMain.handle('fs:openFolder', (_e, dir: string) => { if (dir) shell.openPath(dir); });
    ipcMain.handle('fs:openFile', (_e, fp: string) => { if (fp) shell.openPath(fp); });

    ipcMain.handle('fs:getSettings', () => this.settings);
    ipcMain.handle('fs:saveSettings', (_e, newSettings) => {
      this.settings = { ...this.settings, ...newSettings };
      this.saveSettings();
      return true;
    });

    ipcMain.handle('fs:clipboardRead', () => clipboard.readText());
  }
}
