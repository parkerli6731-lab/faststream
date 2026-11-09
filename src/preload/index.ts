/**
 * FastStream Preload Script
 * 纯净室 API 暴露，上下文隔离
 */

import { contextBridge, ipcRenderer } from 'electron';

const faststreamAPI = {
  // 任务管理
  list: () => ipcRenderer.invoke('fs:list'),
  add: (opts: any) => ipcRenderer.invoke('fs:add', opts),
  pause: (id: number) => ipcRenderer.invoke('fs:pause', id),
  resume: (id: number) => ipcRenderer.invoke('fs:resume', id),
  remove: (id: number, delFile: boolean) => ipcRenderer.invoke('fs:remove', id, delFile),

  // 文件系统
  chooseDir: () => ipcRenderer.invoke('fs:chooseDir'),
  defaultDir: () => ipcRenderer.invoke('fs:defaultDir'),
  openFolder: (dir: string) => ipcRenderer.invoke('fs:openFolder', dir),
  openFile: (fp: string) => ipcRenderer.invoke('fs:openFile', fp),

  // 系统与设置
  getSettings: () => ipcRenderer.invoke('fs:getSettings'),
  saveSettings: (s: any) => ipcRenderer.invoke('fs:saveSettings', s),
  clipboardRead: () => ipcRenderer.invoke('fs:clipboardRead'),

  // 事件监听
  onTaskUpdate: (cb: (snap: any) => void) => {
    ipcRenderer.on('fs:taskUpdate', (_e, snap) => cb(snap));
  },
  onTaskRemove: (cb: (id: number) => void) => {
    ipcRenderer.on('fs:taskRemove', (_e, id) => cb(id));
  },
  onSniff: (cb: (payload: any) => void) => {
    ipcRenderer.on('fs:sniff', (_e, p) => cb(p));
  },
};

contextBridge.exposeInMainWorld('faststreamAPI', faststreamAPI);
