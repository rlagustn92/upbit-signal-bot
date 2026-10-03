/**
 * 업비트 Rate Limit 그룹별 요청 제어 (docs/upbit-reference/clean/reference_rate-limits.md)
 * - Quotation(IP 단위): market/candle/trade/ticker/orderbook 각 초당 10회
 * - Exchange(포켓 단위): default 30/s, order 12/s, order-test 8/s, order-cancel-all 1회/2초
 * - 응답 헤더 Remaining-Req: group=..; min=..(deprecated); sec=N  → sec=0이면 다음 초까지 대기
 * - 429: 다음 초 경계까지 대기 후 재시도 / 418: 차단 시간 이후 재시도 (차단은 누적 시 점점 길어짐)
 * 문서 한도보다 약간 낮게(약 80%) 잡아 여유를 둔다.
 */
export type RateGroup =
  | 'market'
  | 'candle'
  | 'trade'
  | 'ticker'
  | 'orderbook'
  | 'default'
  | 'order'
  | 'order-test'
  | 'order-cancel-all';

const LIMITS: Record<RateGroup, { count: number; windowMs: number }> = {
  market: { count: 8, windowMs: 1000 },
  candle: { count: 8, windowMs: 1000 },
  trade: { count: 8, windowMs: 1000 },
  ticker: { count: 8, windowMs: 1000 },
  orderbook: { count: 8, windowMs: 1000 },
  default: { count: 24, windowMs: 1000 },
  order: { count: 10, windowMs: 1000 },
  'order-test': { count: 6, windowMs: 1000 },
  'order-cancel-all': { count: 1, windowMs: 2100 },
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class RateLimiter {
  private history = new Map<RateGroup, number[]>();
  private blockedUntil = new Map<RateGroup, number>();
  private chains = new Map<RateGroup, Promise<void>>();

  constructor(private readonly now: () => number = Date.now) {}

  /** 요청 직전에 호출. 그룹 내 요청은 순서대로 슬롯을 받는다. */
  acquire(group: RateGroup): Promise<void> {
    const prev = this.chains.get(group) ?? Promise.resolve();
    const next = prev.then(() => this.waitSlot(group));
    this.chains.set(
      group,
      next.catch(() => {}),
    );
    return next;
  }

  private async waitSlot(group: RateGroup): Promise<void> {
    const { count, windowMs } = LIMITS[group];
    for (;;) {
      const t = this.now();
      const blocked = this.blockedUntil.get(group) ?? 0;
      if (blocked > t) {
        await sleep(blocked - t);
        continue;
      }
      const h = (this.history.get(group) ?? []).filter((x) => t - x < windowMs);
      if (h.length < count) {
        h.push(t);
        this.history.set(group, h);
        return;
      }
      await sleep(windowMs - (t - h[0]) + 5);
    }
  }

  /** Remaining-Req 헤더 반영 */
  applyRemainingHeader(header: string | null): { group: string; sec: number } | null {
    if (!header) return null;
    const m = /group=([^;]+);.*sec=(\d+)/.exec(header);
    if (!m) return null;
    const group = m[1].trim();
    const sec = Number(m[2]);
    if (sec <= 0 && isRateGroup(group)) {
      const t = this.now();
      this.blockedUntil.set(group, Math.max(this.blockedUntil.get(group) ?? 0, t + (1000 - (t % 1000)) + 10));
    }
    return { group, sec };
  }

  /** 429/418 응답 시 차단 */
  block(group: RateGroup, ms: number): void {
    const until = this.now() + ms;
    this.blockedUntil.set(group, Math.max(this.blockedUntil.get(group) ?? 0, until));
  }

  blockedFor(group: RateGroup): number {
    return Math.max(0, (this.blockedUntil.get(group) ?? 0) - this.now());
  }
}

export function isRateGroup(g: string): g is RateGroup {
  return g in LIMITS;
}
