import crypto from 'node:crypto';
import WebSocket from 'ws';
import type { StreamStatus } from '../../shared/types';
import { log } from '../lib/logger';

/**
 * 업비트 WebSocket 연결 관리 (docs/upbit-reference/clean/reference_websocket-guide.md, docs_websocket-best-practice.md)
 * - 120초 동안 송수신이 없으면 서버가 끊음 → 30초마다 ping 프레임, pong 10초 무응답 시 재연결
 * - 재연결: 지수 백오프(1s→2s→…→60s) + 지터. 연속 실패가 많으면 5분 간격으로 완화(폭주 방지)
 * - 연결 요청 한도(초당 5회) / 메시지 한도(초당 5회, 분당 100회) → 구독 변경은 디바운스
 * - 인증 실패(INVALID_AUTH / HTTP 401)는 자동 재시도하지 않고 AUTH_FAILED로 멈춘다(키 교체 시 restart)
 * - 중복 연결 방지: 이미 연결/연결 중이면 connect()는 아무것도 하지 않는다
 */
export interface ManagedSocketOptions {
  name: 'public' | 'private';
  url: string;
  /** 연결할 때마다 호출(Private: 새 JWT 생성). null이면 연결하지 않음 */
  getHeaders?: () => Record<string, string> | null;
  /** 현재 구독 요청 메시지의 type 객체 목록. 빈 배열이면 구독하지 않음 */
  buildSubscription: () => Array<Record<string, unknown>>;
  onMessage: (msg: Record<string, unknown>) => void;
  onStatus?: (status: StreamStatus, detail?: string) => void;
  /** 데이터 무수신 허용 시간(ms). public은 ticker가 계속 오므로 짧게, private은 길게 */
  idleTimeoutMs?: number;
}

const PING_INTERVAL_MS = 30_000;
const PONG_TIMEOUT_MS = 10_000;
const BASE_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 60_000;
const SLOW_BACKOFF_MS = 5 * 60_000;
const SLOW_AFTER_FAILURES = 30;
const STABLE_AFTER_MS = 30_000;

export class ManagedSocket {
  private ws: WebSocket | null = null;
  private status: StreamStatus = 'IDLE';
  private failures = 0;
  private stopped = true;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private pingTimer: NodeJS.Timeout | null = null;
  private pongTimer: NodeJS.Timeout | null = null;
  private stableTimer: NodeJS.Timeout | null = null;
  private idleTimer: NodeJS.Timeout | null = null;
  private subTimer: NodeJS.Timeout | null = null;
  private lastSentSubscription = '';
  private subscriptionSends: number[] = [];
  lastMessageAt: number | null = null;

  constructor(private readonly opts: ManagedSocketOptions) {}

  getStatus(): StreamStatus {
    return this.status;
  }

  private setStatus(s: StreamStatus, detail?: string): void {
    if (this.status === s && !detail) return;
    this.status = s;
    this.opts.onStatus?.(s, detail);
  }

  start(): void {
    this.stopped = false;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    this.clearTimers();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    if (this.ws) {
      this.ws.removeAllListeners();
      try {
        this.ws.terminate();
      } catch {
        /* noop */
      }
      this.ws = null;
    }
    this.setStatus('CLOSED');
  }

  /** 인증정보 변경 등으로 처음부터 다시 연결 */
  restart(): void {
    this.stop();
    this.failures = 0;
    this.start();
  }

  private connect(): void {
    if (this.stopped) return;
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return;

    const sub = this.opts.buildSubscription();
    if (sub.length === 0) {
      this.setStatus('IDLE');
      return; // 구독할 것이 없으면 연결하지 않음
    }

    let headers: Record<string, string> | undefined;
    if (this.opts.getHeaders) {
      const h = this.opts.getHeaders();
      if (!h) {
        this.setStatus('IDLE', 'no credentials');
        return;
      }
      headers = h;
    }

    this.setStatus(this.failures > 0 ? 'RECONNECTING' : 'CONNECTING');
    log.info('WEBSOCKET', `${this.opts.name} 연결 시도${this.failures ? ` (재시도 ${this.failures}회째)` : ''}`);

    const ws = new WebSocket(this.opts.url, { headers, perMessageDeflate: true, handshakeTimeout: 15_000 });
    this.ws = ws;
    this.lastSentSubscription = '';

    ws.on('open', () => {
      log.info('WEBSOCKET', `${this.opts.name} 연결됨`);
      this.setStatus('OPEN');
      this.sendSubscription(true);
      this.startHeartbeat();
      this.stableTimer = setTimeout(() => {
        this.failures = 0;
      }, STABLE_AFTER_MS);
    });

    ws.on('message', (data: WebSocket.RawData) => {
      this.lastMessageAt = Date.now();
      this.resetIdle();
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return;
      }
      if (msg && typeof msg === 'object' && 'error' in msg) {
        const err = msg.error as { name?: string; message?: string };
        log.error('WEBSOCKET', `${this.opts.name} 오류 응답: ${err?.name} ${err?.message ?? ''}`);
        if (err?.name === 'INVALID_AUTH') {
          this.authFailed('INVALID_AUTH');
        }
        return;
      }
      if ('status' in msg && msg.status === 'UP') return;
      try {
        this.opts.onMessage(msg);
      } catch (e) {
        log.error('WEBSOCKET', `${this.opts.name} 메시지 처리 오류: ${(e as Error).message}`);
      }
    });

    ws.on('pong', () => {
      if (this.pongTimer) clearTimeout(this.pongTimer);
      this.pongTimer = null;
    });

    ws.on('unexpected-response', (_req, res) => {
      const code = res.statusCode ?? 0;
      log.error('WEBSOCKET', `${this.opts.name} 연결 거절 HTTP ${code}`);
      if (code === 401 || code === 403) {
        this.authFailed(`HTTP ${code}`);
      } else {
        try {
          ws.terminate();
        } catch {
          /* noop */
        }
      }
    });

    ws.on('error', (err) => {
      log.warn('WEBSOCKET', `${this.opts.name} 오류: ${err.message}`);
    });

    ws.on('close', (code, reason) => {
      this.clearTimers();
      if (this.ws === ws) this.ws = null;
      if (this.stopped || this.status === 'AUTH_FAILED') return;
      log.warn('WEBSOCKET', `${this.opts.name} 연결 종료 code=${code} ${reason?.toString() ?? ''}`);
      this.scheduleReconnect();
    });
  }

  private authFailed(detail: string): void {
    this.setStatus('AUTH_FAILED', detail);
    this.clearTimers();
    if (this.ws) {
      this.ws.removeAllListeners();
      try {
        this.ws.terminate();
      } catch {
        /* noop */
      }
      this.ws = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return;
    this.failures++;
    const exp = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** Math.min(this.failures - 1, 10));
    const base = this.failures > SLOW_AFTER_FAILURES ? SLOW_BACKOFF_MS : exp;
    const delay = Math.round(base * (0.8 + Math.random() * 0.4));
    this.setStatus('RECONNECTING');
    log.info('WEBSOCKET', `${this.opts.name} ${Math.round(delay / 1000)}초 후 재연결`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private startHeartbeat(): void {
    this.pingTimer = setInterval(() => {
      const ws = this.ws;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      try {
        ws.ping();
      } catch {
        /* noop */
      }
      if (this.pongTimer) clearTimeout(this.pongTimer);
      this.pongTimer = setTimeout(() => {
        log.warn('WEBSOCKET', `${this.opts.name} pong 응답 없음 → 재연결`);
        try {
          ws.terminate();
        } catch {
          /* noop */
        }
      }, PONG_TIMEOUT_MS);
    }, PING_INTERVAL_MS);
    this.resetIdle();
  }

  private resetIdle(): void {
    if (!this.opts.idleTimeoutMs) return;
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      log.warn('WEBSOCKET', `${this.opts.name} ${Math.round(this.opts.idleTimeoutMs! / 1000)}초간 데이터 없음 → 재연결`);
      try {
        this.ws?.terminate();
      } catch {
        /* noop */
      }
    }, this.opts.idleTimeoutMs);
  }

  private clearTimers(): void {
    for (const t of [this.pingTimer, this.pongTimer, this.stableTimer, this.idleTimer, this.subTimer]) {
      if (t) clearTimeout(t);
    }
    this.pingTimer = this.pongTimer = this.stableTimer = this.idleTimer = this.subTimer = null;
  }

  /** 구독 대상이 바뀌었을 때 호출. 디바운스 후 새 구독 메시지 1회 전송(새 연결 없음) */
  updateSubscription(): void {
    if (this.stopped) return;
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      // 아직 연결 전이면 연결 시도(구독 대상이 생겼을 수 있음)
      if (!this.ws && !this.reconnectTimer) this.connect();
      return;
    }
    if (this.subTimer) clearTimeout(this.subTimer);
    this.subTimer = setTimeout(() => this.sendSubscription(false), 800);
  }

  private sendSubscription(force: boolean): void {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const types = this.opts.buildSubscription();
    if (types.length === 0) {
      // 구독할 것이 없으면 연결을 닫아 자원 낭비를 막는다
      this.stop();
      this.stopped = false;
      this.setStatus('IDLE');
      return;
    }
    const key = JSON.stringify(types);
    if (!force && key === this.lastSentSubscription) return;
    const now = Date.now();
    this.subscriptionSends = this.subscriptionSends.filter((t) => now - t < 60_000);
    if (this.subscriptionSends.length >= 90 || this.subscriptionSends.filter((t) => now - t < 1000).length >= 4) {
      this.subTimer = setTimeout(() => this.sendSubscription(force), 1500);
      return;
    }
    const message = [{ ticket: `bot-${this.opts.name}-${crypto.randomUUID()}` }, ...types, { format: 'DEFAULT' }];
    ws.send(JSON.stringify(message));
    this.subscriptionSends.push(now);
    this.lastSentSubscription = key;
    log.info('WEBSOCKET', `${this.opts.name} 구독 요청: ${types.map((t) => `${t.type}${Array.isArray(t.codes) ? `(${(t.codes as string[]).length})` : ''}`).join(', ')}`);
  }
}
