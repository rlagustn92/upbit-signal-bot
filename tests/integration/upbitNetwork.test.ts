import { describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { env } from '../../server/config/env';
import { createJwt } from '../../server/upbit/auth';
import { UpbitApiError } from '../../server/upbit/errors';
import { UpbitRestClient } from '../../server/upbit/rest';
import { D, normalizePrice, normalizeVolume, toPlain } from '../../server/domain/orderMath';

/**
 * 실제 업비트 서버 통합 테스트 — `npm run test:network` 로만 실행된다.
 * - Public: 인증 없이 조회, WebSocket ticker 수신
 * - Private(.env에 Key가 있을 때만): 잔고, 주문 가능 정보, 주문 생성 "테스트" API, 미체결 조회, Private WS 연결
 * ⚠ 실제 주문 생성/취소는 하지 않는다. 주문은 /v1/orders/test(실주문 없음)만 사용한다.
 */
const RUN = process.env.RUN_NETWORK_TESTS === '1';
const HAS_KEY = !!(env.upbitAccessKey && env.upbitSecretKey);
const creds = HAS_KEY ? { accessKey: env.upbitAccessKey, secretKey: env.upbitSecretKey } : null;
const rest = new UpbitRestClient({ baseUrl: env.upbitRestBase, getCredentials: () => creds });

function wsFirstMessage(url: string, sub: unknown[], headers?: Record<string, string>, timeoutMs = 10_000): Promise<Record<string, unknown> | 'OPENED'> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, { headers });
    const t = setTimeout(() => {
      ws.terminate();
      // Private 스트림은 변동이 없으면 메시지가 없는 게 정상 → 연결 성공만 확인
      resolve('OPENED');
    }, timeoutMs);
    ws.on('open', () => ws.send(JSON.stringify(sub)));
    ws.on('message', (d) => {
      const m = JSON.parse(d.toString());
      if (m.status === 'UP') return;
      clearTimeout(t);
      ws.close();
      resolve(m);
    });
    ws.on('unexpected-response', (_q, r) => {
      clearTimeout(t);
      reject(new Error(`HTTP ${r.statusCode}`));
    });
    ws.on('error', (e) => {
      clearTimeout(t);
      reject(e);
    });
  });
}

describe.skipIf(!RUN)('업비트 Public API (인증 없음)', () => {
  it('페어 목록에 KRW-BTC가 있다', async () => {
    const m = await rest.getMarkets();
    expect(m.find((x) => x.market === 'KRW-BTC')?.korean_name).toBe('비트코인');
  });
  it('현재가 조회', async () => {
    const t = await rest.getTickers(['KRW-BTC', 'KRW-ETH']);
    expect(t).toHaveLength(2);
    expect(t[0].trade_price).toBeGreaterThan(0);
  });
  it('분 캔들 조회', async () => {
    const c = await rest.getMinuteCandles(1, 'KRW-BTC', 5);
    expect(c.length).toBe(5);
  });
  it('호가 정책(tick_size) 조회', async () => {
    const i = await rest.getOrderbookInstruments(['KRW-BTC']);
    expect(Number(i[0].tick_size)).toBeGreaterThan(0);
  });
  it('WebSocket ticker 수신', async () => {
    const m = await wsFirstMessage(env.upbitWsPublic, [{ ticket: 'test' }, { type: 'ticker', codes: ['KRW-BTC'] }, { format: 'DEFAULT' }]);
    expect(m).not.toBe('OPENED');
    expect((m as Record<string, unknown>).type).toBe('ticker');
  });
});

describe.skipIf(!RUN || !HAS_KEY)('업비트 Private API (.env Key 필요, 실주문 없음)', () => {
  it('잔고 조회', async () => {
    const a = await rest.getAccounts();
    expect(Array.isArray(a)).toBe(true);
  });
  it('주문 가능 정보', async () => {
    const c = await rest.getOrderChance('KRW-BTC');
    expect(c.market.id).toBe('KRW-BTC');
  });
  it('주문 생성 테스트 API (실제 주문 생성 안 됨)', async () => {
    const [t] = await rest.getTickers(['KRW-BTC']);
    const px = normalizePrice(D(t.trade_price).mul(0.5), 'down');
    const vol = normalizeVolume(D(5500).div(px));
    try {
      const r = await rest.testOrder({ market: 'KRW-BTC', side: 'bid', ord_type: 'limit', price: toPlain(px), volume: toPlain(vol) });
      expect(r.uuid).toBeTruthy();
    } catch (e) {
      // 잔고 부족도 "형식/권한 검증 통과" 의미
      expect(e instanceof UpbitApiError && /insufficient_funds|under_min/.test(e.code)).toBe(true);
    }
  });
  it('미체결 주문 조회', async () => {
    const o = await rest.getOpenOrders({ limit: 10 });
    expect(Array.isArray(o)).toBe(true);
  });
  it('Private WebSocket(myOrder+myAsset) 연결', async () => {
    const r = await wsFirstMessage(
      env.upbitWsPrivate,
      [{ ticket: 'test' }, { type: 'myOrder' }, { type: 'myAsset' }],
      { Authorization: `Bearer ${createJwt(creds!.accessKey, creds!.secretKey)}` },
      5000,
    );
    if (r !== 'OPENED') expect(['myOrder', 'myAsset']).toContain(r.type);
  });
});
