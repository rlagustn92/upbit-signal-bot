import fs from 'node:fs';
import path from 'node:path';
import type { StrategyDefaults } from '../../shared/types';
import { env } from './env';

/**
 * ▶ 전략 기본값은 이 파일 한 곳에서만 관리한다.
 *   예) "그리드 간격 기본값 1% → 1.5%" 는 grid.spacingPercent 만 바꾸면 된다.
 *   이미 만들어진 봇은 생성 시점 값이 봇별로 DB(bots.strategy_config)에 저장되어 있으므로
 *   여기 값을 바꿔도 기존 봇에는 영향이 없다(봇 수정 API로 개별 변경).
 */
export const STRATEGY_DEFAULTS: StrategyDefaults = {
  takeProfitPercent: 2.0,
  stopLossPercent: 3.0,
  takeProfitChoices: [1.0, 2.0, 3.5],
  stopLossChoices: [2.0, 3.0, 5.0],
  budgetChoices: [100_000, 300_000, 500_000, 1_000_000],

  grid: {
    basePrice: 0, // 0 = 봇 시작 시점 현재가
    spacingMode: 'fixed', // 'atr' = 최근 변동폭에 맞춰 자동
    spacingPercent: 1.0,
    atrMultiplier: 1.0,
    levels: 5,
    orderKRW: 0, // 0 = 예산 ÷ 레벨 수
    reentryCooldownSec: 60,
    downtrendGuard: true, // 하락 추세가 강하면 새로 사지 않음
    analysisUnit: '60m',
    trailingStopPercent: 0, // 그리드는 칸별 지정가 익절
    dailyLossLimitPercent: 5,
    cooldownAfterLossMin: 60,
  },

  rsi: {
    candleUnit: '15m',
    period: 14,
    oversold: 30,
    overbought: 70,
    entryMode: 'rebound', // 떨어지는 칼날을 잡지 않고 반등을 확인한 뒤 매수
    trendEmaPeriod: 200, // 장기 추세(EMA200) 위에서만 매수
    splitRatio: 0.33, // × maxEntries 3 = 99% (예산 안에서 3번 모두 가능)
    maxEntries: 3,
    trailingStopPercent: 0,
    dailyLossLimitPercent: 5,
    cooldownAfterLossMin: 60,
  },

  goldenCross: {
    candleUnit: '60m',
    maType: 'EMA',
    shortPeriod: 9,
    longPeriod: 21,
    volumeMultiplier: 1.2, // 거래량이 평소보다 20% 이상 많을 때만 진짜 돌파로 봄
    atrStopMultiplier: 2.0,
    entryRatio: 1.0,
    exitOnDeadCross: true,
    trailingStopPercent: 1.5, // 목표 익절 도달 후 최고가에서 1.5% 내려오면 매도
    dailyLossLimitPercent: 5,
    cooldownAfterLossMin: 120,
  },

  // 연구 결과(scripts/research.ts, 2022-10~2026-10 BTC/ETH/XRP 60분봉): EMA100 위 · k=2.5 · 최대 50봉 보유가 가장 꾸준했음
  bollinger: {
    candleUnit: '60m',
    period: 20,
    k: 2.5,
    trendEmaPeriod: 100,
    maxHoldBars: 50,
    entryRatio: 1.0,
    trailingStopPercent: 0, // 중심선 복귀에서 팔기 때문에 쓰지 않음
    dailyLossLimitPercent: 5,
    cooldownAfterLossMin: 0, // 연구에서는 쉬는 시간 없이 검증함
  },

  // 실험: 하이퍼리퀴드 고수 따라하기(모의투자 전용). 주소 목록은 defaultCopyAddresses() 참고
  copyTrade: {
    addresses: [],
    joinExisting: false, // 켤 때 이미 롱인 사람은 다음 '새 진입'부터 따라 함
    maxStaleSec: 60,
    trailingStopPercent: 0, // 그 사람이 팔 때 팜
    dailyLossLimitPercent: 0, // 순수하게 따라 하는 실험이라 끔(원하면 봇별로 켜기)
    cooldownAfterLossMin: 0,
  },

  /** /v1/orders/chance 조회 전 또는 PAPER 모드에서 쓰는 KRW 마켓 수수료율(0.05%) */
  feeRateDefault: 0.0005,
  /** /v1/orders/chance 의 min_total 조회 전 사용하는 값. 출처: docs/upbit-reference/docs_krw-market-info.md */
  minOrderKRWDefault: 5000,
};

/**
 * 따라하기 기본 주소: npm run hl-pick 결과(data/hyperliquid/picks.json)가 있으면 그것, 없으면 아래 목록
 * (아래 목록도 hl-pick으로 고른 것 — 고른 날짜는 docs/COPYTRADE.md 참고)
 */
export const COPY_TRADE_FALLBACK_ADDRESSES: string[] = [
  // 2026-10-05 hl-pick: 최근 60일 BTC·ETH·XRP 롱 8번 이상 · 업비트로 따라 했을 때 PF 1.5 이상 · 앞/뒤 기간 모두 손실 아님
  '0xd142479997958a4fefd1f8d5373b31ce36987d73',
  '0x42fd5648cf21c158d15e4f58785760755b3f6623',
  '0x352deb23bebae8b4c57d0ae341d9c1951fd8425a',
  '0x535191d6d49922d69cc7829dbb73e48694840db7',
  '0x95da8596c44dd09f4b8becce87ad3b7894fb2328',
];

export function defaultCopyAddresses(): string[] {
  try {
    const f = path.join(env.dataDir, 'hyperliquid', 'picks.json');
    const j = JSON.parse(fs.readFileSync(f, 'utf8')) as { addresses?: unknown };
    const list = Array.isArray(j.addresses) ? j.addresses.filter((a): a is string => typeof a === 'string' && /^0x[0-9a-fA-F]{40}$/.test(a)) : [];
    if (list.length) return list.slice(0, 10).map((a) => a.toLowerCase());
  } catch {
    /* 파일 없음 */
  }
  return COPY_TRADE_FALLBACK_ADDRESSES;
}

/** 화면에 내려주는 기본값(따라하기 주소 포함) */
export function strategyDefaultsForClient(): StrategyDefaults {
  return { ...STRATEGY_DEFAULTS, copyTrade: { ...STRATEGY_DEFAULTS.copyTrade, addresses: defaultCopyAddresses() } };
}

/** 엔진 동작 상수(전략 무관) */
export const ENGINE = {
  /** 캔들 히스토리 로드 개수 (REST 최대 200) */
  candleHistoryCount: 200,
  /** 캔들 히스토리 최대 페이지 수(1페이지 200개) — EMA200 같은 장기 지표 계산용 */
  candleHistoryMaxPages: 3,
  /** 일봉은 WS 미지원 → REST 재조회 주기 */
  dailyCandlePollMs: 60_000,
  /** LIVE 미체결 주문 REST 동기화 주기(myOrder 보완) */
  liveOrderSyncMs: 30_000,
  /** 계좌 REST 동기화 주기(myAsset 보완) */
  accountSyncMs: 60_000,
  /** 같은 봇의 실시간 가격 평가 최소 간격 */
  tickEvalMinMs: 500,
  /** 화면 스냅샷 push 최소 간격 */
  snapshotThrottleMs: 1000,
  /** 같은 봇에서 손절/익절 주문 재시도 최소 간격 */
  exitRetryMs: 15_000,
  /** 검증 실패한 같은 의도(같은 봇·목적·레벨)를 다시 시도하기까지 대기 — 로그/시그널 폭주 방지 */
  rejectedIntentCooldownMs: 60_000,
  /** PAPER 시장가 체결 시 불리하게 적용하는 미끄러짐(%) — 모의 결과가 실제보다 좋아 보이지 않도록 */
  paperSlippagePercent: 0.05,
  /** 계좌 잔고가 이 시간보다 오래되면 주문 전 다시 조회 */
  accountStaleMs: 15_000,
  /** 봇이 없어도 실시간 현재가를 받아두는 대표 마켓(코인 선택 화면 빠른 선택 + 연결 상태 확인용) */
  watchMarkets: ['KRW-BTC', 'KRW-ETH', 'KRW-XRP'],
};
