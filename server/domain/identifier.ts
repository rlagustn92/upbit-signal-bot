import crypto from 'node:crypto';

/**
 * 봇 주문 식별자. 업비트 identifier 규칙: 계정 전체에서 유일, 재사용 불가, 최대 64자.
 * 형식: BOT-{botId}-{epochMs(36진수)}-{랜덤6}
 *  → 어떤 봇이 만든 주문인지(botId) 식별자만 보고 역추적할 수 있다.
 * PAPER 주문은 PBOT- 접두어를 써서 실제 주문과 절대 섞이지 않게 한다.
 */
export const LIVE_PREFIX = 'BOT';
export const PAPER_PREFIX = 'PBOT';
const RE = /^(P?BOT)-(\d+)-([0-9a-z]+)-([0-9a-z]{6})$/;
const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

function random6(): string {
  const bytes = crypto.randomBytes(6);
  let s = '';
  for (const b of bytes) s += ALPHABET[b % ALPHABET.length];
  return s;
}

export function createIdentifier(botId: number, paper: boolean, now = Date.now()): string {
  if (!Number.isInteger(botId) || botId <= 0) throw new Error('botId가 올바르지 않습니다.');
  const id = `${paper ? PAPER_PREFIX : LIVE_PREFIX}-${botId}-${now.toString(36)}-${random6()}`;
  if (id.length > 64) throw new Error('identifier가 64자를 넘습니다.');
  return id;
}

export interface ParsedIdentifier {
  paper: boolean;
  botId: number;
  createdAtMs: number;
}

export function parseIdentifier(identifier: string | null | undefined): ParsedIdentifier | null {
  if (!identifier) return null;
  const m = RE.exec(identifier);
  if (!m) return null;
  return { paper: m[1] === PAPER_PREFIX, botId: Number(m[2]), createdAtMs: parseInt(m[3], 36) };
}

export function isBotIdentifier(identifier: string | null | undefined, botId?: number): boolean {
  const p = parseIdentifier(identifier);
  return !!p && (botId === undefined || p.botId === botId);
}
