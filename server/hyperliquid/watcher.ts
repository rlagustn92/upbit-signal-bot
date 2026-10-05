// 따라 하는 지갑들의 현재 포지션을 주기적으로 조회해 메모리에 들고 있는다.
// 전략이 want()로 "이 주소들 보고 있어요"라고 알리면 그 주소만 조회하고, 2분 넘게 아무도 안 찾으면 조회를 멈춘다.
import { log } from '../lib/logger';
import { HyperliquidClient, type HlClearinghouseState } from './client';

export interface TraderSnapshot {
  ok: boolean;
  /** 코인별 포지션 수량(롱 +, 숏 -) */
  positions: Record<string, number>;
  /** 코인별 진입가·평가손익(화면 표시용) */
  details: Record<string, { entryPx: number | null; unrealizedPnl: number; leverage: number | null }>;
  accountValue: number | null;
  /** 마지막으로 성공한 조회 시각 */
  updatedAt: number;
  error?: string;
}

export interface CopyFeed {
  want(addresses: string[]): void;
  get(address: string): TraderSnapshot | undefined;
}

export class HyperliquidWatcher implements CopyFeed {
  private wanted = new Map<string, number>();
  private snaps = new Map<string, TraderSnapshot>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private polling = false;

  constructor(
    private readonly client: HyperliquidClient,
    private readonly opts: { pollMs: number; idleMs: number } = { pollMs: 5_000, idleMs: 120_000 },
  ) {}

  want(addresses: string[]): void {
    const now = Date.now();
    for (const a of addresses) {
      const key = a.toLowerCase();
      const first = !this.wanted.has(key);
      this.wanted.set(key, now);
      if (first) void this.pollOne(key);
    }
    if (!this.timer) {
      this.timer = setInterval(() => void this.tick(), this.opts.pollMs);
      this.timer.unref?.();
    }
  }

  get(address: string): TraderSnapshot | undefined {
    return this.snaps.get(address.toLowerCase());
  }

  /** 지금 보고 있는 주소 목록 */
  watching(): string[] {
    return [...this.wanted.keys()];
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async tick(): Promise<void> {
    if (this.polling) return;
    this.polling = true;
    try {
      const now = Date.now();
      for (const [a, at] of this.wanted) if (now - at > this.opts.idleMs) this.wanted.delete(a);
      if (!this.wanted.size) {
        this.stop();
        return;
      }
      await Promise.all([...this.wanted.keys()].map((a) => this.pollOne(a)));
    } finally {
      this.polling = false;
    }
  }

  private async pollOne(address: string): Promise<void> {
    try {
      const s: HlClearinghouseState = await this.client.clearinghouseState(address);
      const positions: Record<string, number> = {};
      const details: TraderSnapshot['details'] = {};
      for (const ap of s.assetPositions ?? []) {
        const p = ap.position;
        positions[p.coin] = Number(p.szi);
        details[p.coin] = { entryPx: p.entryPx != null ? Number(p.entryPx) : null, unrealizedPnl: Number(p.unrealizedPnl), leverage: p.leverage?.value ?? null };
      }
      this.snaps.set(address, { ok: true, positions, details, accountValue: Number(s.marginSummary?.accountValue ?? NaN), updatedAt: Date.now() });
    } catch (e) {
      const prev = this.snaps.get(address);
      const msg = (e as Error).message;
      if (!prev || prev.ok) log.warn('SYSTEM', `하이퍼리퀴드 조회 실패 ${address.slice(0, 8)}…: ${msg}`);
      // 마지막 성공 값은 남겨 두되 ok=false 로 표시(전략은 오래된 값으로 매매하지 않음)
      this.snaps.set(address, { ...(prev ?? { positions: {}, details: {}, accountValue: null, updatedAt: 0 }), ok: false, error: msg });
    }
  }
}

let feed: CopyFeed & Partial<Pick<HyperliquidWatcher, 'watching'>> = new HyperliquidWatcher(new HyperliquidClient());

/** 전략·API가 쓰는 공용 조회기 */
export const copyFeed = () => feed;
/** 테스트용: 가짜 조회기로 바꾸기 */
export function setCopyFeed(f: CopyFeed): void {
  feed = f;
}
