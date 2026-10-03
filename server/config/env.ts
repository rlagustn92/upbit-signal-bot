import 'dotenv/config';
import path from 'node:path';

function num(v: string | undefined, def: number): number {
  const n = Number(v);
  return v !== undefined && v.trim() !== '' && Number.isFinite(n) ? n : def;
}

const root = process.cwd();

/**
 * 서버 환경설정. Secret Key는 여기서만 읽고 다른 곳으로 복사하지 않는다
 * (CredentialService가 필요할 때마다 이 객체에서 꺼내 쓴다).
 */
export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: num(process.env.SERVER_PORT, 8787),
  /** 외부 접속 차단을 위해 기본 127.0.0.1 */
  host: process.env.SERVER_HOST?.trim() || '127.0.0.1',
  /** 추가로 허용할 접속 주소(Host). 로컬과 Tailscale(*.ts.net)은 기본 허용 */
  allowedHosts: (process.env.ALLOWED_HOSTS ?? '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean),
  databasePath: path.resolve(root, process.env.DATABASE_PATH?.trim() || './data/bot.db'),
  dataDir: path.resolve(root, './data'),
  encryptionKeyHex: process.env.APP_ENCRYPTION_KEY?.trim() || '',
  upbitAccessKey: process.env.UPBIT_ACCESS_KEY?.trim() || '',
  upbitSecretKey: process.env.UPBIT_SECRET_KEY?.trim() || '',
  paperInitialKRW: num(process.env.PAPER_INITIAL_KRW, 10_000_000),
  /** true면 어떤 경로로도 실제 주문을 보내지 않는다 */
  liveHardLock: !['false', '0'].includes((process.env.LIVE_TRADING_HARD_LOCK ?? '').trim().toLowerCase()), // 정확히 false/0일 때만 해제(오타는 잠금 유지)
  logLevel: (process.env.LOG_LEVEL?.trim() || 'info') as 'debug' | 'info' | 'warn' | 'error',
  upbitRestBase: 'https://api.upbit.com',
  upbitWsPublic: 'wss://api.upbit.com/websocket/v1',
  upbitWsPrivate: 'wss://api.upbit.com/websocket/v1/private',
};

export type Env = typeof env;
