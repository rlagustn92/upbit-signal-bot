import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { env } from './config/env';
import { createApp } from './app';
import { createRouter } from './api/routes';
import { log } from './lib/logger';

async function main(): Promise<void> {
  const app = createApp({ env });
  const server = express();
  server.disable('x-powered-by');
  server.use('/api', createRouter(app));

  // 빌드된 프론트(dist/)가 있으면 같은 서버에서 제공 (npm run build 후 npm start)
  const dist = path.resolve(process.cwd(), 'dist');
  if (fs.existsSync(path.join(dist, 'index.html'))) {
    server.use(express.static(dist));
    server.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  }

  const http = server.listen(env.port, env.host, () => {
    log.info('SYSTEM', `백엔드 실행: http://${env.host}:${env.port} (외부 접속 차단)`);
  });

  await app.start().catch((e) => log.error('SYSTEM', `시작 중 오류: ${(e as Error).message}`));

  const shutdown = (sig: string) => {
    log.info('SYSTEM', `${sig} 수신 — 종료합니다 (봇 상태는 DB에 저장되어 재시작 시 복구)`);
    http.close();
    app.stop();
    setTimeout(() => process.exit(0), 300);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('unhandledRejection', (e) => log.error('ERROR', `처리되지 않은 오류: ${(e as Error)?.message ?? e}`));
  process.on('uncaughtException', (e) => {
    // 상태를 알 수 없으므로 기록 후 종료 → 운영 실행기(scripts/start.mjs)가 다시 켜고 재시작 복구가 상태를 맞춘다
    try {
      const dir = path.join(env.dataDir, 'logs');
      fs.mkdirSync(dir, { recursive: true });
      fs.appendFileSync(path.join(dir, 'crash.log'), `${new Date().toISOString()} ${e?.stack ?? e}\n`);
    } catch {
      /* noop */
    }
    log.error('ERROR', `치명적 오류로 종료: ${e?.message}`);
    process.exit(1);
  });
}

void main();
