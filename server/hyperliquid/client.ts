// 하이퍼리퀴드 공개 조회 API (키 없음, 읽기 전용). 주문·출금 기능은 만들지 않는다.
//  - POST https://api.hyperliquid.xyz/info  {type: ...}
//  - 리더보드: GET https://stats-data.hyperliquid.xyz/Mainnet/leaderboard
// 요청 한도: IP당 분당 가중치 1200 (clearinghouseState 2, userFills* 20) → 호출하는 쪽에서 간격을 둔다

export interface HlFill {
  coin: string;
  px: string;
  sz: string;
  /** B = 매수, A = 매도 */
  side: 'B' | 'A';
  time: number;
  /** 이 체결 직전 포지션 수량(롱 +, 숏 -) */
  startPosition: string;
  dir: string;
  closedPnl: string;
  fee: string;
}

export interface HlAssetPosition {
  position: {
    coin: string;
    /** 포지션 수량(롱 +, 숏 -) */
    szi: string;
    entryPx: string | null;
    leverage?: { type: string; value: number };
    unrealizedPnl: string;
    positionValue: string;
  };
}

export interface HlClearinghouseState {
  assetPositions: HlAssetPosition[];
  marginSummary: { accountValue: string; totalNtlPos: string };
  time: number;
}

export interface HlLeaderboardRow {
  ethAddress: string;
  accountValue: string;
  displayName: string | null;
  windowPerformances: Array<[string, { pnl: string; roi: string; vlm: string }]>;
}

export interface HyperliquidClientOptions {
  baseUrl?: string;
  statsUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export class HyperliquidClient {
  private readonly baseUrl: string;
  private readonly statsUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(opts: HyperliquidClientOptions = {}) {
    this.baseUrl = opts.baseUrl ?? 'https://api.hyperliquid.xyz';
    this.statsUrl = opts.statsUrl ?? 'https://stats-data.hyperliquid.xyz';
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.timeoutMs = opts.timeoutMs ?? 15_000;
  }

  private async request<T>(url: string, init: RequestInit): Promise<T> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      const res = await this.fetchImpl(url, { ...init, signal: ctrl.signal });
      if (!res.ok) throw new Error(`하이퍼리퀴드 응답 오류 HTTP ${res.status}`);
      return (await res.json()) as T;
    } catch (e) {
      if ((e as Error).name === 'AbortError') throw new Error('하이퍼리퀴드 응답 시간 초과');
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }

  info<T>(body: Record<string, unknown>): Promise<T> {
    return this.request<T>(`${this.baseUrl}/info`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  clearinghouseState(user: string): Promise<HlClearinghouseState> {
    return this.info({ type: 'clearinghouseState', user });
  }

  /** startTime부터 오래된 순으로 최대 2000건. 거래소는 최근 10000건까지만 보관 */
  userFillsByTime(user: string, startTime: number, endTime?: number): Promise<HlFill[]> {
    return this.info({ type: 'userFillsByTime', user, startTime, ...(endTime ? { endTime } : {}), aggregateByTime: true });
  }

  async leaderboard(): Promise<HlLeaderboardRow[]> {
    const d = await this.request<{ leaderboardRows: HlLeaderboardRow[] }>(`${this.statsUrl}/Mainnet/leaderboard`, { method: 'GET' });
    return d.leaderboardRows ?? [];
  }
}

/** 0x로 시작하는 40자리 16진수 지갑 주소인지 */
export const isHlAddress = (s: string) => /^0x[0-9a-fA-F]{40}$/.test(s);

/** 포지션 목록에서 특정 코인의 수량(롱 +, 숏 -, 없으면 0) */
export function positionSize(state: HlClearinghouseState, coin: string): number {
  const p = state.assetPositions.find((a) => a.position.coin === coin);
  return p ? Number(p.position.szi) : 0;
}
