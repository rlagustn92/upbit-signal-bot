import { describe, expect, it } from 'vitest';
import { toDisplaySymbol, toMarketCode, parseMarketCode, isValidMarketCode } from '../../server/domain/market';
import { D, krwTickSize, normalizePrice, normalizeVolume, validateOrderAmount, volumeForBudget, isOnTick, toPlain } from '../../server/domain/orderMath';
import { createIdentifier, parseIdentifier, isBotIdentifier } from '../../server/domain/identifier';
import { mapUpbitState, isTerminal } from '../../server/domain/orderState';

describe('displaySymbol ↔ marketCode', () => {
  it('BTC/KRW → KRW-BTC', () => {
    expect(toMarketCode('BTC/KRW')).toBe('KRW-BTC');
    expect(toMarketCode('eth/krw')).toBe('KRW-ETH');
  });
  it('KRW-XRP → XRP/KRW', () => {
    expect(toDisplaySymbol('KRW-XRP')).toBe('XRP/KRW');
    expect(toDisplaySymbol('BTC-ETH')).toBe('ETH/BTC');
  });
  it('왕복 변환이 같다', () => {
    for (const m of ['KRW-BTC', 'KRW-DOGE', 'USDT-XRP']) expect(toMarketCode(toDisplaySymbol(m))).toBe(m);
  });
  it('잘못된 형식은 거부', () => {
    expect(() => toMarketCode('BTCKRW')).toThrow();
    expect(() => parseMarketCode('KRW_BTC')).toThrow();
    expect(isValidMarketCode('KRW-BTC')).toBe(true);
    expect(isValidMarketCode('BTC/KRW')).toBe(false);
  });
});

describe('KRW 호가 단위 (docs_krw-market-info.md)', () => {
  it.each([
    [150_000_000, '1000'],
    [1_500_000, '1000'],
    [700_000, '500'],
    [284_500, '100'],
    [70_000, '50'],
    [20_000, '10'],
    [7_000, '5'],
    [3_420, '1'],
    [295, '1'],
    [15, '0.1'],
    [5, '0.01'],
    [0.5, '0.001'],
    [0.05, '0.0001'],
    [0.000005, '0.00000001'],
  ])('%s원 → %s', (p, t) => {
    expect(krwTickSize(p).toString()).toBe(t);
  });
});

describe('normalizePrice', () => {
  it('매수는 내림, 매도는 올림', () => {
    expect(normalizePrice(132_450_123, 'down').toString()).toBe('132450000');
    expect(normalizePrice(132_450_123, 'up').toString()).toBe('132451000');
    expect(normalizePrice('15.07', 'down').toString()).toBe('15');
    expect(normalizePrice('15.01', 'up').toString()).toBe('15.1');
  });
  it('가격대 경계를 넘으면 그 가격대 단위로 다시 맞춘다', () => {
    // 99,999.7 올림 → 100,000(단위 100)
    const p = normalizePrice('99999.7', 'up');
    expect(isOnTick(p)).toBe(true);
    expect(p.toString()).toBe('100000');
  });
  it('결과는 항상 호가 단위 배수', () => {
    for (const v of [1.2345, 9.999, 123.45, 4999.9, 51234, 987654, 2345678]) {
      expect(isOnTick(normalizePrice(v, 'down'))).toBe(true);
      expect(isOnTick(normalizePrice(v, 'up'))).toBe(true);
    }
  });
  it('0 이하 가격은 거부', () => {
    expect(() => normalizePrice(0, 'down')).toThrow();
  });
});

describe('주문 수량/금액', () => {
  it('수량은 소수 8자리로 내림', () => {
    expect(normalizeVolume('0.123456789').toString()).toBe('0.12345678');
    expect(normalizeVolume(1).toString()).toBe('1');
  });
  it('예산 안에서 수수료 포함 최대 수량', () => {
    const v = volumeForBudget(100_000, 50_000, 0.0005);
    expect(D(v).mul(50_000).mul(1.0005).lte(100_000)).toBe(true);
    expect(toPlain(v)).toBe('1.99900049');
  });
  it('최소 주문 금액 검증', () => {
    expect(validateOrderAmount(4999, { minTotal: 5000 }).ok).toBe(false);
    expect(validateOrderAmount(4999, { minTotal: 5000 }).code).toBe('UNDER_MIN_TOTAL');
    expect(validateOrderAmount(5000, { minTotal: 5000 }).ok).toBe(true);
    expect(validateOrderAmount(2_000_000_000, { minTotal: 5000, maxTotal: 1_000_000_000 }).code).toBe('OVER_MAX_TOTAL');
    expect(validateOrderAmount(0, { minTotal: 5000 }).ok).toBe(false);
  });
});

describe('identifier', () => {
  it('형식과 역추적', () => {
    const id = createIdentifier(12, false, 1_700_000_000_000);
    expect(id).toMatch(/^BOT-12-[0-9a-z]+-[0-9a-z]{6}$/);
    expect(id.length).toBeLessThanOrEqual(64);
    const p = parseIdentifier(id)!;
    expect(p.botId).toBe(12);
    expect(p.paper).toBe(false);
    expect(p.createdAtMs).toBe(1_700_000_000_000);
  });
  it('PAPER는 PBOT 접두어로 실제 주문과 구분', () => {
    const id = createIdentifier(3, true);
    expect(id.startsWith('PBOT-3-')).toBe(true);
    expect(parseIdentifier(id)!.paper).toBe(true);
  });
  it('매번 다르다(재사용 불가 규칙)', () => {
    const s = new Set(Array.from({ length: 500 }, () => createIdentifier(1, false)));
    expect(s.size).toBe(500);
  });
  it('다른 봇/사용자 주문 구분', () => {
    expect(isBotIdentifier(createIdentifier(5, false), 5)).toBe(true);
    expect(isBotIdentifier(createIdentifier(5, false), 6)).toBe(false);
    expect(isBotIdentifier('my-manual-order')).toBe(false);
    expect(isBotIdentifier(null)).toBe(false);
  });
});

describe('주문 상태 매핑', () => {
  it('업비트 상태 → 내부 상태', () => {
    expect(mapUpbitState('wait', '0')).toBe('OPEN');
    expect(mapUpbitState('wait', '0.5')).toBe('PARTIALLY_FILLED');
    expect(mapUpbitState('watch', '0')).toBe('WATCH');
    expect(mapUpbitState('done', '1')).toBe('FILLED');
    expect(mapUpbitState('cancel', '0')).toBe('CANCELLED');
    expect(mapUpbitState('cancel', '0.3')).toBe('PARTIALLY_FILLED_CANCELLED');
    expect(mapUpbitState('prevented', '0')).toBe('PREVENTED');
    expect(mapUpbitState('trade', '1', '0')).toBe('FILLED');
    expect(mapUpbitState('trade', '0.4', '0.6')).toBe('PARTIALLY_FILLED');
    expect(mapUpbitState('something_new', '0')).toBe('UNKNOWN');
  });
  it('종료 상태', () => {
    expect(isTerminal('FILLED')).toBe(true);
    expect(isTerminal('OPEN')).toBe(false);
    expect(isTerminal('UNKNOWN')).toBe(false);
  });
});
