// 운영 실행기: 백엔드가 예기치 않게 종료되면 자동으로 다시 실행한다(재시작 복구 로직이 상태를 되살림).
// 재시작 폭주 방지: 점점 길게 대기(5초 → 최대 5분), 1시간에 20번 넘게 죽으면 멈추고 사람이 확인하도록 한다.
import { spawn } from 'node:child_process';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const tsx = path.join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const crashes = [];
let child = null;
let stopping = false;

function run() {
  child = spawn(process.execPath, [tsx, 'server/index.ts'], { cwd: root, stdio: 'inherit', env: { ...process.env, NODE_ENV: process.env.NODE_ENV ?? 'production' } });
  child.on('exit', (code, signal) => {
    if (stopping) return process.exit(0);
    const now = Date.now();
    crashes.push(now);
    while (crashes.length && now - crashes[0] > 3600_000) crashes.shift();
    if (crashes.length > 20) {
      console.error(`[supervisor] 1시간 동안 ${crashes.length}번 종료되어 자동 재시작을 멈춥니다. 로그(data/logs)를 확인해 주세요.`);
      process.exit(1);
    }
    const wait = Math.min(300_000, 5000 * 2 ** (crashes.length - 1));
    console.error(`[supervisor] 서버가 종료됨(code=${code} signal=${signal}). ${Math.round(wait / 1000)}초 후 다시 실행합니다.`);
    setTimeout(run, wait);
  });
}

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    stopping = true;
    child?.kill(sig);
  });
}

run();
