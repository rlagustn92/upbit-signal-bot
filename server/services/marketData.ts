import type { CandleUnit, MarketDTO, StreamStatus } from '../../shared/types';
import { ENGINE } from '../config/strategyDefaults';
import type { Env } from '../config/env';
import { toDisplaySymbol } from '../domain/market';
import { D, krwTickSize, type Decimal } from '../domain/orderMath';
import type { Bus } from '../lib/bus';
import { log } from '../lib/logger';
import type { MinuteUnit, UpbitRestClient } from '../upbit/rest';
import type { Bar } from '../indicators';
import type { UpbitCandle, UpbitMarket, WsCandle, WsTicker, WsTrade } from '../upbit/types';
import { ManagedSocket } from '../upbit/websocket';

export interface MarketInfo {
  marketCode: string;
  koreanName: string;
  englishName: string;
  warning: boolean;
  caution: boolean;
}

export interface TickerInfo {
  price: number;
  signedChangeRate: number | null;
  accTradePrice24h: number | null;
  updatedAt: number;
}

type CandleBar = Bar; // start(UTC ms), open, high, low, close, volume

interface CandleSeries {
  closed: CandleBar[];
  current: CandleBar | null;
}

export interface Subscriptions {
  ticker: Set<string>;
  trade: Set<string>;
  candles: Set<string>; // `${market}|${unit}`
}

const UNIT_MS: Record<CandleUnit, number> = {
  '1m': 60_000,
  '3m': 180_000,
  '5m': 300_000,
  '10m': 600_000,
  '15m': 900_000,
  '30m': 1_800_000,
  '60m': 3_600_000,
  '240m': 14_400_000,
  '1d': 86_400_000,
};

const MAX_CLOSED = 500;
const utcMs = (s: string) => Date.parse(s.endsWith('Z') ? s : `${s}Z`);

/**
 * 시세 데이터.
 * - 실시간 현재가/체결/캔들은 Public WebSocket 1개 연결로 수신(REST 반복 조회 금지)
 * - REST는 시작 시 초기값, 캔들 히스토리, 코인 목록 화면 요청(30초 캐시)에만 사용
 */
export class MarketDataService {
  private markets = new Map<string, MarketInfo>();
  private tickers = new Map<string, TickerInfo>();
  private candles = new Map<string, CandleSeries>();
  private instrumentTicks = new Map<string, Decimal>();
  private lastGapReload = new Map<string, number>();
  private providers: Array<() => Partial<{ ticker: Iterable<string>; trade: Iterable<string>; candles: Iterable<string> }>> = [];
  private allTickersFetchedAt = 0;
  private marketsFetchedAt = 0;
  private dailyPollTimer: NodeJS.Timeout | null = null;
  private closeCheckTimer: NodeJS.Timeout | null = null;
  private subs: Subscriptions = { ticker: new Set(), trade: new Set(), candles: new Set() };
  readonly socket: ManagedSocket;

  constructor(
    private readonly rest: UpbitRestClient,
    private readonly bus: Bus,
    env: Env,
    private readonly onStreamStatus?: (s: StreamStatus) => void,
  ) {
    this.socket = new ManagedSocket({
      name: 'public',
      url: env.upbitWsPublic,
      buildSubscription: () => this.buildSubscription(),
      onMessage: (m) => this.handleMessage(m),
      onStatus: (s) => this.onStreamStatus?.(s),
      idleTimeoutMs: 90_000,
    });
  }

  // ───────── 시작/종료 ─────────
  async start(): Promise<void> {
    await this.refreshMarkets().catch((e) => log.error('PRICE', `마켓 목록 조회 실패: ${e.message}`));
    this.recomputeSubscriptions(false);
    await this.seedTickers([...this.subs.ticker]).catch((e) => log.warn('PRICE', `현재가 초기 조회 실패: ${e.message}`));
    this.socket.start();
    this.dailyPollTimer = setInterval(() => void this.pollDailyCandles(), ENGINE.dailyCandlePollMs);
    this.closeCheckTimer = setInterval(() => this.closeElapsedCandles(), 5000);
  }

  stop(): void {
    this.socket.stop();
    if (this.dailyPollTimer) clearInterval(this.dailyPollTimer);
    if (this.closeCheckTimer) clearInterval(this.closeCheckTimer);
  }

  // ───────── 마켓 목록 ─────────
  async refreshMarkets(): Promise<void> {
    const list: UpbitMarket[] = await this.rest.getMarkets();
    this.markets.clear();
    for (const m of list) {
      const caution = m.market_event?.caution ? Object.values(m.market_event.caution).some(Boolean) : false;
      this.markets.set(m.market, {
        marketCode: m.market,
        koreanName: m.korean_name,
        englishName: m.english_name,
        warning: !!m.market_event?.warning,
        caution,
      });
    }
    this.marketsFetchedAt = Date.now();
    log.info('PRICE', `업비트 거래 가능 페어 ${list.length}개 로드`);
  }

  getMarket(code: string): MarketInfo | undefined {
    return this.markets.get(code);
  }

  hasMarkets(): boolean {
    return this.markets.size > 0;
  }

  /** 코인 선택 화면용: KRW 마켓 전체 + 현재가 (REST 30초 캐시, 화면 요청 시에만) */
  async listKrwMarkets(): Promise<MarketDTO[]> {
    if (Date.now() - this.marketsFetchedAt > 3600_000 || !this.markets.size) await this.refreshMarkets();
    if (Date.now() - this.allTickersFetchedAt > 30_000) {
      try {
        const all = await this.rest.getTickersByQuote(['KRW']);
        for (const t of all) {
          const prev = this.tickers.get(t.market);
          // WS로 받은 값이 더 최신이면 유지
          if (!prev || prev.updatedAt < t.timestamp) {
            this.tickers.set(t.market, { price: t.trade_price, signedChangeRate: t.signed_change_rate, accTradePrice24h: t.acc_trade_price_24h, updatedAt: t.timestamp });
          }
        }
        this.allTickersFetchedAt = Date.now();
      } catch (e) {
        log.warn('PRICE', `KRW 마켓 현재가 조회 실패: ${(e as Error).message}`);
      }
    }
    const out: MarketDTO[] = [];
    for (const m of this.markets.values()) {
      if (!m.marketCode.startsWith('KRW-')) continue;
      const t = this.tickers.get(m.marketCode);
      out.push({
        marketCode: m.marketCode,
        displaySymbol: toDisplaySymbol(m.marketCode),
        coinName: m.koreanName,
        englishName: m.englishName,
        warning: m.warning,
        caution: m.caution,
        tradePrice: t?.price ?? null,
        signedChangeRate: t?.signedChangeRate ?? null,
        accTradePrice24h: t?.accTradePrice24h ?? null,
      });
    }
    out.sort((a, b) => (b.accTradePrice24h ?? 0) - (a.accTradePrice24h ?? 0));
    return out;
  }

  // ───────── 현재가 ─────────
  getPrice(market: string): number | null {
    return this.tickers.get(market)?.price ?? null;
  }

  getTicker(market: string): TickerInfo | undefined {
    return this.tickers.get(market);
  }

  /** 화면 표시용 가격 맵 */
  pricesFor(markets: Iterable<string>): Record<string, number> {
    const out: Record<string, number> = {};
    for (const m of markets) {
      const p = this.getPrice(m);
      if (p != null) out[m] = p;
    }
    return out;
  }

  async seedTickers(markets: string[]): Promise<void> {
    const list = markets.filter((m) => !this.tickers.has(m));
    for (let i = 0; i < list.length; i += 50) {
      const chunk = list.slice(i, i + 50);
      const res = await this.rest.getTickers(chunk);
      for (const t of res) this.tickers.set(t.market, { price: t.trade_price, signedChangeRate: t.signed_change_rate, accTradePrice24h: t.acc_trade_price_24h, updatedAt: t.timestamp });
    }
  }

  // ───────── 호가 단위 ─────────
  /** 마켓별 호가 정책(tick_size) 조회. 현재가 가격대에서만 유효하므로 그 가격대에만 적용 */
  async refreshInstruments(markets: string[]): Promise<void> {
    if (!markets.length) return;
    try {
      const res = await this.rest.getOrderbookInstruments(markets);
      for (const r of res) {
        const t = D(r.tick_size);
        this.instrumentTicks.set(r.market, t);
        const price = this.getPrice(r.market);
        if (price != null && r.market.startsWith('KRW-') && !krwTickSize(price).eq(t)) {
          log.warn('PRICE', `${r.market} 호가 단위가 표와 다릅니다 (API ${r.tick_size}, 표 ${krwTickSize(price).toString()}) → API 값 우선 적용`);
        }
      }
    } catch (e) {
      log.warn('PRICE', `호가 정책 조회 실패(표 사용): ${(e as Error).message}`);
    }
  }

  /** 가격 → 호가 단위 함수. 현재가와 같은 가격대면 API tick_size, 아니면 KRW 정책 표 */
  tickFn(market: string): (p: Decimal) => Decimal {
    const apiTick = this.instrumentTicks.get(market);
    const cur = this.getPrice(market);
    return (p: Decimal) => {
      const table = krwTickSize(p);
      if (apiTick && cur != null && krwTickSize(cur).eq(table)) return apiTick;
      return table;
    };
  }

  // ───────── 캔들 ─────────
  getCloses(market: string, unit: CandleUnit): number[] {
    return (this.candles.get(`${market}|${unit}`)?.closed ?? []).map((c) => c.close);
  }

  /** 확정된 봉(OHLCV) */
  getBars(market: string, unit: CandleUnit): Bar[] {
    return [...(this.candles.get(`${market}|${unit}`)?.closed ?? [])];
  }

  async ensureCandles(market: string, unit: CandleUnit, min: number): Promise<number[]> {
    const key = `${market}|${unit}`;
    const existing = this.candles.get(key);
    // 캐시가 충분하고 "최신"일 때만 재사용. 봇이 꺼져 구독이 끊겼던 동안 비어 있는 구간이 있으면 다시 받는다
    const last = existing?.closed[existing.closed.length - 1];
    const fresh = last && Date.now() - last.start <= UNIT_MS[unit] * 2.5;
    if (existing && existing.closed.length >= min && fresh) return existing.closed.map((c) => c.close);
    await this.reloadSeries(market, unit, min);
    return (this.candles.get(key)?.closed ?? []).map((c) => c.close);
  }

  /** REST로 캔들 히스토리를 받는다. 200개 넘게 필요하면 `to`(이전 페이지의 가장 오래된 봉 시각)로 이어 받는다 */
  private async reloadSeries(market: string, unit: CandleUnit, need = 0): Promise<void> {
    const fetchPage = (to?: string) =>
      unit === '1d' ? this.rest.getDayCandles(market, ENGINE.candleHistoryCount, to) : this.rest.getMinuteCandles(Number(unit.replace('m', '')) as MinuteUnit, market, ENGINE.candleHistoryCount, to);
    let raw = await fetchPage();
    const pages = Math.min(ENGINE.candleHistoryMaxPages, Math.ceil((need + 20) / ENGINE.candleHistoryCount));
    for (let p = 1; p < pages && raw.length >= ENGINE.candleHistoryCount * p; p++) {
      const oldest = raw.reduce((a, c) => (c.candle_date_time_utc < a ? c.candle_date_time_utc : a), raw[0].candle_date_time_utc);
      const more = await fetchPage(`${oldest}Z`);
      if (!more.length) break;
      raw = raw.concat(more);
    }
    const seen = new Set<string>();
    raw = raw.filter((c) => (seen.has(c.candle_date_time_utc) ? false : (seen.add(c.candle_date_time_utc), true)));
    this.candles.set(`${market}|${unit}`, this.toSeries(raw, unit));
    log.info('PRICE', `${market} ${unit} 캔들 ${this.candles.get(`${market}|${unit}`)!.closed.length}개 로드`);
  }

  private toSeries(raw: UpbitCandle[], unit: CandleUnit): CandleSeries {
    const now = Date.now();
    const bars: CandleBar[] = raw
      .map((c) => ({
        start: utcMs(c.candle_date_time_utc),
        open: c.opening_price ?? c.trade_price,
        high: c.high_price ?? c.trade_price,
        low: c.low_price ?? c.trade_price,
        close: c.trade_price,
        volume: c.candle_acc_trade_volume ?? 0,
      }))
      .sort((a, b) => a.start - b.start);
    const closed: CandleBar[] = [];
    let current: CandleBar | null = null;
    for (const b of bars) {
      if (b.start + UNIT_MS[unit] <= now) closed.push(b);
      else current = b;
    }
    return { closed: closed.slice(-MAX_CLOSED), current };
  }

  private onCandle(market: string, unit: CandleUnit, bar: CandleBar): void {
    const key = `${market}|${unit}`;
    const s = this.candles.get(key);
    if (!s) return; // 아직 히스토리를 로드하지 않은 구독
    const lastClosed = s.closed[s.closed.length - 1];
    if (lastClosed && bar.start <= lastClosed.start) {
      if (bar.start === lastClosed.start) Object.assign(lastClosed, bar); // 늦게 도착한 같은 봉 업데이트
      return;
    }
    if (!s.current || bar.start === s.current.start) {
      s.current = bar;
      return;
    }
    if (bar.start > s.current.start) {
      this.closeCurrent(market, unit, s);
      s.current = bar;
    }
  }

  private closeCurrent(market: string, unit: CandleUnit, s: CandleSeries): void {
    if (!s.current) return;
    const prev = s.closed[s.closed.length - 1];
    // 거래가 드문 코인은 봉이 원래 비기도 하므로 3봉 이상 비었을 때만, 시리즈당 10분에 한 번만 다시 받는다
    const key = `${market}|${unit}`;
    const gap = prev && s.current.start - prev.start > UNIT_MS[unit] * 3 && Date.now() - (this.lastGapReload.get(key) ?? 0) > 600_000;
    if (gap) this.lastGapReload.set(key, Date.now());
    s.closed.push(s.current);
    if (s.closed.length > MAX_CLOSED) s.closed.shift();
    s.current = null;
    if (gap) {
      // WS 끊김 등으로 봉이 비었으면, 공백을 낀 채로 지표를 계산하지 않도록 REST로 다시 받은 뒤 확정 이벤트를 보낸다
      log.info('PRICE', `${market} ${unit} 캔들 공백(체결 없음 또는 연결 끊김) → 다시 불러온 뒤 판단`);
      void this.reloadSeries(market, unit)
        .then(() => this.bus.emitTyped('candleClose', market, unit))
        .catch((e) => log.warn('PRICE', `${market} ${unit} 캔들 재로드 실패(이번 봉은 판단 생략): ${(e as Error).message}`));
      return;
    }
    this.bus.emitTyped('candleClose', market, unit);
  }

  /** 체결이 없어 새 봉이 안 와도, 기간이 끝난 봉은 확정 처리 */
  private closeElapsedCandles(): void {
    const now = Date.now();
    for (const [key, s] of this.candles) {
      if (!s.current) continue;
      const [market, unit] = key.split('|') as [string, CandleUnit];
      if (unit === '1d') continue;
      if (s.current.start + UNIT_MS[unit] + 3000 <= now) this.closeCurrent(market, unit, s);
    }
  }

  private async pollDailyCandles(): Promise<void> {
    for (const key of this.subs.candles) {
      const [market, unit] = key.split('|') as [string, CandleUnit];
      if (unit !== '1d') continue;
      try {
        const raw = await this.rest.getDayCandles(market, 2);
        for (const c of raw.sort((a, b) => utcMs(a.candle_date_time_utc) - utcMs(b.candle_date_time_utc))) {
          this.onCandle(market, '1d', { start: utcMs(c.candle_date_time_utc), open: c.opening_price, high: c.high_price, low: c.low_price, close: c.trade_price, volume: c.candle_acc_trade_volume });
        }
      } catch (e) {
        log.warn('PRICE', `${market} 일봉 조회 실패: ${(e as Error).message}`);
      }
    }
  }

  // ───────── WebSocket 구독 ─────────
  addSubscriptionProvider(fn: () => Partial<{ ticker: Iterable<string>; trade: Iterable<string>; candles: Iterable<string> }>): void {
    this.providers.push(fn);
  }

  /** 구독 대상 재계산. 바뀌었으면 WS에 새 구독 메시지 전송 */
  recomputeSubscriptions(send = true): void {
    const next: Subscriptions = { ticker: new Set(), trade: new Set(), candles: new Set() };
    for (const p of this.providers) {
      const r = p();
      for (const m of r.ticker ?? []) next.ticker.add(m);
      for (const m of r.trade ?? []) next.trade.add(m);
      for (const c of r.candles ?? []) next.candles.add(c);
    }
    // 시장 목록에 없는 코드는 구독하지 않음(INVALID_PARAM 방지)
    if (this.markets.size) {
      for (const set of [next.ticker, next.trade]) for (const m of [...set]) if (!this.markets.has(m)) set.delete(m);
      for (const c of [...next.candles]) if (!this.markets.has(c.split('|')[0])) next.candles.delete(c);
    }
    const same = (a: Set<string>, b: Set<string>) => a.size === b.size && [...a].every((x) => b.has(x));
    const changed = !same(next.ticker, this.subs.ticker) || !same(next.trade, this.subs.trade) || !same(next.candles, this.subs.candles);
    this.subs = next;
    if (changed && send) {
      void this.seedTickers([...next.ticker]).catch(() => {});
      this.socket.updateSubscription();
    }
  }

  private buildSubscription(): Array<Record<string, unknown>> {
    const out: Array<Record<string, unknown>> = [];
    if (this.subs.ticker.size) out.push({ type: 'ticker', codes: [...this.subs.ticker].sort() });
    if (this.subs.trade.size) out.push({ type: 'trade', codes: [...this.subs.trade].sort(), is_only_realtime: true });
    const byUnit = new Map<string, string[]>();
    for (const c of this.subs.candles) {
      const [market, unit] = c.split('|');
      if (unit === '1d') continue; // WS 미지원 → REST 폴링
      byUnit.set(unit, [...(byUnit.get(unit) ?? []), market]);
    }
    for (const [unit, codes] of byUnit) out.push({ type: `candle.${unit}`, codes: codes.sort(), is_only_realtime: true });
    return out;
  }

  private handleMessage(m: Record<string, unknown>): void {
    const type = String(m.type ?? '');
    if (type === 'ticker') {
      const t = m as unknown as WsTicker;
      this.tickers.set(t.code, { price: t.trade_price, signedChangeRate: t.signed_change_rate, accTradePrice24h: t.acc_trade_price_24h ?? null, updatedAt: t.timestamp });
      this.bus.emitTyped('ticker', t.code, t.trade_price);
    } else if (type === 'trade') {
      const t = m as unknown as WsTrade;
      this.bus.emitTyped('trade', t.code, t.trade_price, t.trade_volume, t.trade_timestamp);
    } else if (type.startsWith('candle.')) {
      const c = m as unknown as WsCandle;
      const unit = type.slice('candle.'.length) as CandleUnit;
      this.onCandle(c.code, unit, {
        start: utcMs(c.candle_date_time_utc),
        open: c.opening_price,
        high: c.high_price,
        low: c.low_price,
        close: c.trade_price,
        volume: c.candle_acc_trade_volume,
      });
    }
  }
}
