// 운영 실행기: 백엔드가 예기치 않게 종료되면 자동으로 다시 실행한다(재시작 복구 로직이 상태를 되살림).
// 재시작 폭주 방지: 점점 길게 대기(5초 → 최대 5분), 1시간에 20번 넘게 죽으면 멈추고 사람이 확인하도록 한다.
// 백그라운드(창 없음) 운영 지원:
//  - data/run/supervisor.pid 에 자기 PID를 적는다(이미 실행 중이면 두 번째 실행은 바로 끝낸다)
//  - data/run/stop.request 파일이 생기면 서버를 정상 종료시키고 끝낸다(bot-control.bat 의 '끄기')
//    윈도우에서는 다른 프로세스에 SIGTERM을 보낼 수 없어서 파일 + IPC 메시지로 정상 종료를 요청한다
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const tsx = path.join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const runDir = path.join(root, 'data', 'run');
const pidFile = path.join(runDir, 'supervisor.pid');
const stopFile = path.join(runDir, 'stop.request');
const crashes = [];
let child = null;
let stopping = false;

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
}

fs.mkdirSync(runDir, { recursive: true });
try {
  const old = Number(fs.readFileSync(pidFile, 'utf8').trim());
  // PC가 갑자기 꺼졌다 켜지면 pid 파일이 남고 같은 번호를 다른 프로그램이 쓸 수 있다 → 부팅 전에 적힌 파일은 무시
  const bootAt = Date.now() - os.uptime() * 1000;
  const writtenAfterBoot = fs.statSync(pidFile).mtimeMs > bootAt;
  if (old && old !== process.pid && writtenAfterBoot && alive(old)) {
    console.error(`[supervisor] 봇이 이미 실행 중이에요(PID ${old}). 화면: http://127.0.0.1:8787  끄려면 bot-control.bat`);
    process.exit(0);
  }
} catch {
  /* pid 파일 없음 */
}
fs.writeFileSync(pidFile, String(process.pid));
try {
  fs.rmSync(stopFile, { force: true }); // 예전 끄기 요청이 남아 있으면 지운다
} catch {
  /* noop */
}

function cleanup() {
  try {
    if (fs.readFileSync(pidFile, 'utf8').trim() === String(process.pid)) fs.rmSync(pidFile, { force: true });
  } catch {
    /* noop */
  }
}
process.on('exit', cleanup);

function run() {
  child = spawn(process.execPath, [tsx, 'server/index.ts'], {
    cwd: root,
    stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
    env: { ...process.env, NODE_ENV: process.env.NODE_ENV ?? 'production' },
  });
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

function stop(reason) {
  if (stopping) return;
  stopping = true;
  console.log(`[supervisor] ${reason} — 서버를 정상 종료합니다`);
  if (!child || child.exitCode != null) return process.exit(0);
  try {
    child.send({ cmd: 'shutdown' });
  } catch {
    child.kill();
  }
  // 정상 종료가 10초 안에 안 끝나면 강제로 끝낸다(봇 상태는 DB에 있어 다음 실행 때 복구)
  setTimeout(() => {
    child?.kill();
    process.exit(0);
  }, 10_000).unref();
}

for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => stop(sig));
setInterval(() => {
  if (fs.existsSync(stopFile)) {
    try {
      fs.rmSync(stopFile, { force: true });
    } catch {
      /* noop */
    }
    stop('끄기 요청');
  }
}, 1000);

run();
