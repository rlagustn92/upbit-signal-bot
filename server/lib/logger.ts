import fs from 'node:fs';
import path from 'node:path';
import { env } from '../config/env';

export type LogTag =
  | 'PRICE'
  | 'STRATEGY'
  | 'SIGNAL'
  | 'ORDER'
  | 'ORDER_FILLED'
  | 'ORDER_CANCEL'
  | 'POSITION'
  | 'ERROR'
  | 'WEBSOCKET'
  | 'SYSTEM'
  | 'API'
  | 'RISK';

type Level = 'debug' | 'info' | 'warn' | 'error';
const LEVELS: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

/** 로그에 절대 남기면 안 되는 값들. CredentialService가 등록한다. */
const secrets = new Set<string>();

export function registerSecret(value: string | undefined | null): void {
  if (value && value.length >= 6) secrets.add(value);
}

export function unregisterSecret(value: string | undefined | null): void {
  if (value) secrets.delete(value);
}

const SENSITIVE_KEYS = /(secret|password|authorization|token|jwt|access_?key)/i;

/** 문자열/객체에서 비밀정보를 가린다. */
export function redact(input: unknown): unknown {
  if (typeof input === 'string') {
    let s = input;
    for (const sec of secrets) s = s.split(sec).join('***');
    // Bearer 토큰 / JWT 형태 마스킹
    s = s.replace(/Bearer\s+[A-Za-z0-9\-_.]+/g, 'Bearer ***');
    s = s.replace(/eyJ[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+/g, '***jwt***');
    return s;
  }
  if (Array.isArray(input)) return input.map(redact);
  if (input && typeof input === 'object') {
    if (input instanceof Error) {
      return { name: input.name, message: redact(input.message) };
    }
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEYS.test(k) ? '***' : redact(v);
    }
    return out;
  }
  return input;
}

let logDir: string | null = null;
function fileFor(date: Date): string | null {
  try {
    if (!logDir) {
      logDir = path.join(env.dataDir, 'logs');
      fs.mkdirSync(logDir, { recursive: true });
    }
    const d = new Date(date.getTime() + 9 * 3600_000).toISOString().slice(0, 10); // KST 날짜
    return path.join(logDir, `bot-${d}.log`);
  } catch {
    return null;
  }
}

type Listener = (entry: LogEntry) => void;
const listeners = new Set<Listener>();

export interface LogEntry {
  time: string;
  level: Level;
  tag: LogTag;
  message: string;
  data?: unknown;
}

const recent: LogEntry[] = [];
const RECENT_MAX = 500;

function write(level: Level, tag: LogTag, message: string, data?: unknown): void {
  if (LEVELS[level] < LEVELS[env.logLevel] && level !== 'error') return;
  const now = new Date();
  const entry: LogEntry = {
    time: now.toISOString(),
    level,
    tag,
    message: redact(message) as string,
    data: data === undefined ? undefined : redact(data),
  };
  const line = `${entry.time} ${level.toUpperCase().padEnd(5)} [${tag}] ${entry.message}${
    entry.data === undefined ? '' : ' ' + safeJson(entry.data)
  }`;
  if (process.env.VITEST !== 'true') {
    (level === 'error' ? console.error : level === 'warn' ? console.warn : console.log)(line);
    const f = fileFor(now);
    if (f) fs.appendFile(f, line + '\n', () => {});
  }
  recent.push(entry);
  if (recent.length > RECENT_MAX) recent.shift();
  for (const l of listeners) l(entry);
}

function safeJson(v: unknown): string {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

export const log = {
  debug: (tag: LogTag, msg: string, data?: unknown) => write('debug', tag, msg, data),
  info: (tag: LogTag, msg: string, data?: unknown) => write('info', tag, msg, data),
  warn: (tag: LogTag, msg: string, data?: unknown) => write('warn', tag, msg, data),
  error: (tag: LogTag, msg: string, data?: unknown) => write('error', tag, msg, data),
  recent: (limit = 200, tag?: LogTag) => recent.filter((e) => !tag || e.tag === tag).slice(-limit),
  onEntry: (l: Listener) => {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};
