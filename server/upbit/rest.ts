import { buildEncodedQuery, buildRawQuery, createJwt, type QueryParams } from './auth';
import { UpbitApiError, UpbitNetworkError, UpbitRateLimitError } from './errors';
import { RateLimiter, type RateGroup } from './rateLimiter';
import { log } from '../lib/logger';
import type {
  UpbitAccount,
  UpbitApiKey,
  UpbitBatchCancelResult,
  UpbitCandle,
  UpbitCreateOrderBody,
  UpbitInstrument,
  UpbitMarket,
  UpbitOrder,
  UpbitOrderChance,
  UpbitTicker,
} from './types';

export interface Credentials {
  accessKey: string;
  secretKey: string;
}

export interface RestClientOptions {
  baseUrl: string;
  getCredentials: () => Credentials | null;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  limiter?: RateLimiter;
}

type Method = 'GET' | 'POST' | 'DELETE';

interface RequestSpec {
  method: Method;
  path: string;
  group: RateGroup;
  query?: QueryParams;
  body?: Record<string, unknown>;
  auth: boolean;
  /** 429 시 자동 재시도 허용(조회성 요청만) */
  retryOn429?: boolean;
}

export type MinuteUnit = 1 | 3 | 5 | 10 | 15 | 30 | 60 | 240;

/**
 * 업비트 REST 클라이언트. 모든 업비트 HTTP 호출은 이 클래스만 거친다.
 * 엔드포인트/파라미터는 docs/upbit-openapi-summary.txt (공식 OpenAPI) 기준.
 * 출금·입금·포켓 이전 API는 의도적으로 구현하지 않는다.
 */
export class UpbitRestClient {
  readonly limiter: RateLimiter;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  lastRemaining: Record<string, number> = {};

  constructor(private readonly opts: RestClientOptions) {
    this.limiter = opts.limiter ?? new RateLimiter();
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.timeoutMs = opts.timeoutMs ?? 10_000;
  }

  hasCredentials(): boolean {
    return !!this.opts.getCredentials();
  }

  private async request<T>(spec: RequestSpec, attempt = 0): Promise<T> {
    await this.limiter.acquire(spec.group);

    const rawQuery = spec.query ? buildRawQuery(spec.query) : '';
    const encodedQuery = spec.query ? buildEncodedQuery(spec.query) : '';
    const url = `${this.opts.baseUrl}${spec.path}${encodedQuery ? `?${encodedQuery}` : ''}`;
    const headers: Record<string, string> = { Accept: 'application/json' };
    let bodyText: string | undefined;

    if (spec.body) {
      // undefined 값은 본문/해시 모두에서 제외해 두 문자열이 정확히 일치하도록 한다
      const clean: Record<string, string> = {};
      for (const [k, v] of Object.entries(spec.body)) if (v !== undefined && v !== null) clean[k] = String(v);
      bodyText = JSON.stringify(clean);
      headers['Content-Type'] = 'application/json; charset=utf-8';
      spec = { ...spec, body: clean };
    }

    if (spec.auth) {
      const cred = this.opts.getCredentials();
      if (!cred) throw new UpbitApiError(401, 'no_authorization_token', 'API Key not configured', spec.path);
      const hashSource = spec.body ? buildRawQuery(spec.body as QueryParams) : rawQuery;
      headers.Authorization = `Bearer ${createJwt(cred.accessKey, cred.secretKey, hashSource)}`;
    }

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    let res: Response;
    try {
      res = await this.fetchImpl(url, { method: spec.method, headers, body: bodyText, signal: ctrl.signal });
    } catch (e) {
      clearTimeout(timer);
      const msg = e instanceof Error ? e.message : String(e);
      log.warn('API', `${spec.method} ${spec.path} 네트워크 오류: ${msg}`);
      // POST 주문은 요청이 서버에 도달했을 수도 있다 → 호출자가 identifier로 확인해야 함
      throw new UpbitNetworkError(msg, spec.path, spec.method !== 'GET');
    }
    clearTimeout(timer);

    const remaining = this.limiter.applyRemainingHeader(res.headers.get('Remaining-Req'));
    if (remaining) this.lastRemaining[remaining.group] = remaining.sec;

    if (res.status === 429 || res.status === 418) {
      const blocked = res.status === 418;
      const retryAfter = blocked ? parseBlockMs(await safeText(res)) : 1000 - (Date.now() % 1000) + 20;
      this.limiter.block(spec.group, retryAfter);
      log.warn('API', `${spec.method} ${spec.path} rate limit ${res.status}, ${retryAfter}ms 대기`);
      if (!blocked && spec.retryOn429 && attempt < 2) return this.request<T>(spec, attempt + 1);
      throw new UpbitRateLimitError(spec.group, retryAfter, blocked);
    }

    const text = await safeText(res);
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }

    if (!res.ok) {
      const err = (json as { error?: { name?: string | number; message?: string } } | null)?.error;
      const code = err?.name != null ? String(err.name) : `http_${res.status}`;
      const message = err?.message ?? text.slice(0, 200);
      throw new UpbitApiError(res.status, code, message, spec.path);
    }
    return json as T;
  }

  // ───────────── Quotation (공개) ─────────────
  getMarkets(): Promise<UpbitMarket[]> {
    return this.request({ method: 'GET', path: '/v1/market/all', group: 'market', query: { is_details: true }, auth: false, retryOn429: true });
  }

  getTickers(markets: string[]): Promise<UpbitTicker[]> {
    return this.request({ method: 'GET', path: '/v1/ticker', group: 'ticker', query: { markets }, auth: false, retryOn429: true });
  }

  getTickersByQuote(quoteCurrencies: string[]): Promise<UpbitTicker[]> {
    return this.request({
      method: 'GET',
      path: '/v1/ticker/all',
      group: 'ticker',
      query: { quote_currencies: quoteCurrencies },
      auth: false,
      retryOn429: true,
    });
  }

  getMinuteCandles(unit: MinuteUnit, market: string, count = 200, to?: string): Promise<UpbitCandle[]> {
    return this.request({
      method: 'GET',
      path: `/v1/candles/minutes/${unit}`,
      group: 'candle',
      query: { market, to, count },
      auth: false,
      retryOn429: true,
    });
  }

  getDayCandles(market: string, count = 200, to?: string): Promise<UpbitCandle[]> {
    return this.request({ method: 'GET', path: '/v1/candles/days', group: 'candle', query: { market, to, count }, auth: false, retryOn429: true });
  }

  getOrderbookInstruments(markets: string[]): Promise<UpbitInstrument[]> {
    return this.request({
      method: 'GET',
      path: '/v1/orderbook/instruments',
      group: 'orderbook',
      query: { markets },
      auth: false,
      retryOn429: true,
    });
  }

  // ───────────── Exchange (인증) ─────────────
  /** 포켓 잔고 조회 — [자산조회] 권한 */
  getAccounts(): Promise<UpbitAccount[]> {
    return this.request({ method: 'GET', path: '/v1/accounts', group: 'default', auth: true, retryOn429: true });
  }

  /** 페어별 주문 가능 정보 — [주문조회] 권한 */
  getOrderChance(market: string): Promise<UpbitOrderChance> {
    return this.request({ method: 'GET', path: '/v1/orders/chance', group: 'default', query: { market }, auth: true, retryOn429: true });
  }

  /** 주문 생성 — [주문하기] 권한. ⚠ 실제 주문. LiveExecutor만 호출한다. 자동 재시도하지 않는다. */
  createOrder(body: UpbitCreateOrderBody): Promise<UpbitOrder> {
    return this.request({ method: 'POST', path: '/v1/orders', group: 'order', body: { ...body }, auth: true });
  }

  /** 주문 생성 테스트 — 실제 주문을 만들지 않고 형식/주문 가능 여부만 검증 */
  testOrder(body: UpbitCreateOrderBody): Promise<UpbitOrder> {
    return this.request({ method: 'POST', path: '/v1/orders/test', group: 'order-test', body: { ...body }, auth: true });
  }

  getOrder(by: { uuid?: string; identifier?: string }): Promise<UpbitOrder> {
    return this.request({ method: 'GET', path: '/v1/order', group: 'default', query: { uuid: by.uuid, identifier: by.identifier }, auth: true, retryOn429: true });
  }

  getOrdersByIds(by: { uuids?: string[]; identifiers?: string[]; market?: string }): Promise<UpbitOrder[]> {
    return this.request({
      method: 'GET',
      path: '/v1/orders/uuids',
      group: 'default',
      query: { market: by.market, 'uuids[]': by.uuids, 'identifiers[]': by.identifiers },
      auth: true,
      retryOn429: true,
    });
  }

  getOpenOrders(opts: { market?: string; states?: Array<'wait' | 'watch'>; page?: number; limit?: number } = {}): Promise<UpbitOrder[]> {
    return this.request({
      method: 'GET',
      path: '/v1/orders/open',
      group: 'default',
      query: { market: opts.market, 'states[]': opts.states ?? ['wait', 'watch'], page: opts.page ?? 1, limit: opts.limit ?? 100 },
      auth: true,
      retryOn429: true,
    });
  }

  getClosedOrders(opts: { market?: string; startTime?: string; endTime?: string; limit?: number } = {}): Promise<UpbitOrder[]> {
    return this.request({
      method: 'GET',
      path: '/v1/orders/closed',
      group: 'default',
      query: { market: opts.market, 'states[]': ['done', 'cancel'], start_time: opts.startTime, end_time: opts.endTime, limit: opts.limit ?? 100 },
      auth: true,
      retryOn429: true,
    });
  }

  /** 개별 주문 취소 — [주문하기] 권한 */
  cancelOrder(by: { uuid?: string; identifier?: string }): Promise<UpbitOrder> {
    return this.request({ method: 'DELETE', path: '/v1/order', group: 'default', query: { uuid: by.uuid, identifier: by.identifier }, auth: true });
  }

  /** id 목록으로 취소(최대 20개) — [주문하기] 권한 */
  cancelOrdersByIds(by: { uuids?: string[]; identifiers?: string[] }): Promise<UpbitBatchCancelResult> {
    return this.request({
      method: 'DELETE',
      path: '/v1/orders/uuids',
      group: 'default',
      query: { 'uuids[]': by.uuids, 'identifiers[]': by.identifiers },
      auth: true,
    });
  }

  /** API Key 목록과 만료일 (권한 무관) */
  getApiKeys(): Promise<UpbitApiKey[]> {
    return this.request({ method: 'GET', path: '/v1/api_keys', group: 'default', auth: true, retryOn429: true });
  }
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return '';
  }
}

/** 418 응답 본문에 차단 시간이 있으면 사용, 없으면 30초 */
function parseBlockMs(text: string): number {
  const m = /(\d+)\s*(?:seconds|sec|초)/i.exec(text);
  if (m) return Number(m[1]) * 1000 + 500;
  return 30_000;
}
