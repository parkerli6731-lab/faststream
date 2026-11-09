/**
 * 独立嗅探服务 (Clean-Room Sniffer Server)
 * 监听 127.0.0.1:37651，接收浏览器扩展嗅探到的下载/视频链接。
 * 纯协议实现，解耦所有 UI 与原生绑定。
 */

import * as http from 'http';
import { cleanTitle, guessCategory } from './sniffer_protocol';

export interface SniffPayload {
  url: string;
  filename?: string;
  size?: number;
  headers?: Record<string, string>;
  kind?: string;
  cookies?: string;
}

export class SnifferServer {
  private server: http.Server | null = null;
  private readonly port: number;
  private readonly onCaptureCallback: (payload: SniffPayload) => void;

  constructor(port = 37651, onCapture: (payload: SniffPayload) => void) {
    this.port = port;
    this.onCaptureCallback = onCapture;
  }

  public start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        // 设置跨域 CORS 响应头
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

        if (req.method === 'OPTIONS') {
          res.writeHead(200);
          res.end();
          return;
        }

        const url = req.url || '';

        // 1. 版本探测路由
        if (req.method === 'GET' && url.startsWith('/version')) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, name: 'FastStream', version: '1.0.0', build: 'faststream-oss' }));
          return;
        }

        // 2. 媒体嗅探捕获路由
        if (req.method === 'POST' && url.startsWith('/capture')) {
          let body = '';
          req.on('data', (chunk) => { body += chunk; });
          req.on('end', () => {
            try {
              const data = JSON.parse(body);
              if (data.filename) {
                data.filename = cleanTitle(data.filename);
              }
              if (!data.category && data.filename) {
                data.category = guessCategory(data.filename);
              }

              // 派发至核心下载引擎
              this.onCaptureCallback(data);

              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ ok: true }));
            } catch (err: any) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ ok: false, error: 'Invalid JSON payload' }));
            }
          });
          return;
        }

        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Not Found' }));
      });

      this.server.on('error', (err: any) => {
        if (err.code === 'EADDRINUSE') {
          console.warn(`[sniff] 绑定 127.0.0.1:${this.port} 失败：（可能已有实例在运行）`);
        }
        reject(err);
      });

      this.server.listen(this.port, '127.0.0.1', () => {
        console.log(`[sniff] 本地服务已启动 127.0.0.1:${this.port}`);
        resolve();
      });
    });
  }

  public stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => resolve());
      } else {
        resolve();
      }
    });
  }
}
