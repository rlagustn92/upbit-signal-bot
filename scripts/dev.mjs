// 개발 실행기: 백엔드(tsx watch)와 프론트(vite)를 함께 실행한다.
// node 실행 파일 경로(process.execPath)를 직접 사용하므로 PATH 설정과 무관하게 동작한다.
import { spawn } from 'node:child_process';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const node = process.execPath;
const bin = (p) => path.join(root, 'node_modules', p);

const procs = [
  { name: 'server', color: '\x1b[34m', args: [bin('tsx/dist/cli.mjs'), 'watch', '--clear-screen=false', 'server/index.ts'] },
  { name: 'web', color: '\x1b[32m', args: [bin('vite/bin/vite.js')] },
];

const children = procs.map(({ name, color, args }) => {
  const env = { ...process.env, FORCE_COLOR: '1' };
  delete env.NO_COLOR; // NO_COLOR와 FORCE_COLOR가 같이 있으면 경고가 뜸
  const child = spawn(node, args, { cwd: root, env });
  const prefix = `${color}[${name}]\x1b[0m `;
  const pipe = (stream, out) => {
    let buf = '';
    stream.on('data', (d) => {
      buf += d.toString();
      const lines = buf.split(/\r?\n/);
      buf = lines.pop() ?? '';
      for (const l of lines) out.write(prefix + l + '\n');
    });
  };
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);
  child.on('exit', (code) => {
    process.stdout.write(`${prefix}종료 (code ${code})\n`);
    for (const c of children) if (c !== child && !c.killed) c.kill();
    process.exit(code ?? 0);
  });
  return child;
});

const stop = () => {
  for (const c of children) if (!c.killed) c.kill();
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
