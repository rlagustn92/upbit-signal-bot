import type { CandleUnit, CreateBotRequest, StrategyConfig, StrategyKind } from '../../shared/types';
import { STRATEGY_DEFAULTS } from '../config/strategyDefaults';
import { gridStrategy } from './grid';
import { rsiStrategy } from './rsi';
import { goldenCrossStrategy } from './goldenCross';
import type { Strategy } from './types';

export const STRATEGIES: Record<StrategyKind, Strategy> = {
  grid: gridStrategy as unknown as Strategy,
  rsi: rsiStrategy as unknown as Strategy,
  goldenCross: goldenCrossStrategy as unknown as Strategy,
};

/** 문자열이 지원하는 전략인지(프로토타입 키 'constructor' 등 차단) */
export function isStrategyKind(v: unknown): v is StrategyKind {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(STRATEGIES, v);
}

const CANDLE_UNITS: CandleUnit[] = ['1m', '3m', '5m', '10m', '15m', '30m', '60m', '240m', '1d'];

const pick = <T extends string>(v: unknown, allowed: readonly T[], def: T): T => (allowed.includes(v as T) ? (v as T) : def);
const bool = (v: unknown, def: boolean) => (typeof v === 'boolean' ? v : def);

/** 공통 위험 관리 설정 */
function buildRisk(i: Record<string, unknown>, d: { trailingStopPercent: number; dailyLossLimitPercent: number; cooldownAfterLossMin: number }) {
  return {
    trailingStopPercent: num(i.trailingStopPercent, d.trailingStopPercent),
    dailyLossLimitPercent: num(i.dailyLossLimitPercent, d.dailyLossLimitPercent),
    cooldownAfterLossMin: Math.round(num(i.cooldownAfterLossMin, d.cooldownAfterLossMin)),
  };
}

const num = (v: unknown, def: number) => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : def);

/** 기본값(중앙 설정) + 사용자 입력 → 봇별 전략 설정 */
export function buildStrategyConfig(kind: StrategyKind, input: CreateBotRequest['strategyConfig'] = {}): StrategyConfig {
  const i = (input ?? {}) as Record<string, unknown>;
  if (kind === 'grid') {
    const d = STRATEGY_DEFAULTS.grid;
    return {
      kind,
      basePrice: num(i.basePrice, d.basePrice),
      spacingMode: pick(i.spacingMode, ['fixed', 'atr'] as const, d.spacingMode),
      spacingPercent: num(i.spacingPercent, d.spacingPercent),
      atrMultiplier: num(i.atrMultiplier, d.atrMultiplier),
      levels: Math.round(num(i.levels, d.levels)),
      orderKRW: Math.floor(num(i.orderKRW, d.orderKRW)),
      reentryCooldownSec: Math.round(num(i.reentryCooldownSec, d.reentryCooldownSec)),
      downtrendGuard: bool(i.downtrendGuard, d.downtrendGuard),
      analysisUnit: pick(i.analysisUnit, CANDLE_UNITS, d.analysisUnit),
      ...buildRisk(i, d),
    };
  }
  if (kind === 'rsi') {
    const d = STRATEGY_DEFAULTS.rsi;
    return {
      kind,
      candleUnit: (CANDLE_UNITS.includes(i.candleUnit as CandleUnit) ? i.candleUnit : d.candleUnit) as CandleUnit,
      period: Math.round(num(i.period, d.period)),
      oversold: num(i.oversold, d.oversold),
      overbought: num(i.overbought, d.overbought),
      entryMode: pick(i.entryMode, ['rebound', 'dip'] as const, d.entryMode),
      trendEmaPeriod: Math.round(num(i.trendEmaPeriod, d.trendEmaPeriod)),
      splitRatio: num(i.splitRatio, d.splitRatio),
      maxEntries: Math.round(num(i.maxEntries, d.maxEntries)),
      ...buildRisk(i, d),
    };
  }
  const d = STRATEGY_DEFAULTS.goldenCross;
  return {
    kind: 'goldenCross',
    candleUnit: (CANDLE_UNITS.includes(i.candleUnit as CandleUnit) ? i.candleUnit : d.candleUnit) as CandleUnit,
    maType: pick(i.maType, ['SMA', 'EMA'] as const, d.maType),
    shortPeriod: Math.round(num(i.shortPeriod, d.shortPeriod)),
    longPeriod: Math.round(num(i.longPeriod, d.longPeriod)),
    volumeMultiplier: num(i.volumeMultiplier, d.volumeMultiplier),
    atrStopMultiplier: num(i.atrStopMultiplier, d.atrStopMultiplier),
    entryRatio: num(i.entryRatio, d.entryRatio),
    exitOnDeadCross: bool(i.exitOnDeadCross, d.exitOnDeadCross),
    ...buildRisk(i, d),
  };
}

/** 설정 검증. 문제가 있으면 사람이 읽는 메시지 목록 */
export function validateStrategyConfig(cfg: StrategyConfig, budgetKRW: number, minOrderBase: number): string[] {
  const e: string[] = [];
  // 시장가 매수 총액 = 금액 ÷ (1+수수료) 이므로, 수수료와 소폭 손실 여유(2%)를 더한 값을 최소로 본다
  const minOrderKRW = Math.ceil(minOrderBase * (1 + STRATEGY_DEFAULTS.feeRateDefault) * 1.02);
  // 공통 위험 관리
  if (!(cfg.trailingStopPercent >= 0 && cfg.trailingStopPercent <= 20)) e.push('트레일링 익절은 0(끔) ~ 20% 사이로 정해 주세요.');
  if (!(cfg.dailyLossLimitPercent >= 0 && cfg.dailyLossLimitPercent <= 50)) e.push('하루 최대 손실은 0(끔) ~ 50% 사이로 정해 주세요.');
  if (!(cfg.cooldownAfterLossMin >= 0 && cfg.cooldownAfterLossMin <= 1440)) e.push('손실 후 쉬는 시간은 0 ~ 1440분 사이로 정해 주세요.');
  if (cfg.kind === 'grid') {
    if (!(cfg.atrMultiplier >= 0.3 && cfg.atrMultiplier <= 5)) e.push('변동폭 배수는 0.3 ~ 5 사이로 정해 주세요.');
    if (!(cfg.spacingPercent >= 0.1 && cfg.spacingPercent <= 20)) e.push('그물망 간격은 0.1% ~ 20% 사이로 정해 주세요.');
    if (!(cfg.levels >= 1 && cfg.levels <= 50)) e.push('그물망 칸 수는 1 ~ 50 사이로 정해 주세요.');
    if (cfg.basePrice < 0) e.push('기준가는 0 이상이어야 해요.');
    const per = cfg.orderKRW > 0 ? cfg.orderKRW : Math.floor(budgetKRW / Math.max(1, cfg.levels));
    if (per < minOrderKRW) e.push(`한 칸에 쓰는 금액(${per.toLocaleString('ko-KR')}원)이 최소 주문 금액(${minOrderKRW.toLocaleString('ko-KR')}원)보다 작아요. 예산을 늘리거나 칸 수를 줄여 주세요.`);
    if (cfg.orderKRW > 0 && cfg.orderKRW * cfg.levels > budgetKRW) e.push(`한 칸 금액 × 칸 수(${(cfg.orderKRW * cfg.levels).toLocaleString('ko-KR')}원)가 예산보다 커요. 마지막 칸들은 살 수 없어요.`);
    if (cfg.reentryCooldownSec < 0) e.push('재진입 대기 시간은 0 이상이어야 해요.');
  } else if (cfg.kind === 'rsi') {
    if (!(cfg.period >= 2 && cfg.period <= 100)) e.push('RSI 기간은 2 ~ 100 사이로 정해 주세요.');
    if (!(cfg.oversold > 0 && cfg.oversold < cfg.overbought && cfg.overbought < 100)) e.push('RSI 기준은 0 < 과매도 < 과매수 < 100 이어야 해요.');
    if (!(cfg.splitRatio > 0 && cfg.splitRatio <= 1)) e.push('분할 비율은 0 ~ 1 사이여야 해요.');
    if (!(cfg.maxEntries >= 1 && cfg.maxEntries <= 20)) e.push('최대 진입 횟수는 1 ~ 20 사이로 정해 주세요.');
    if (cfg.splitRatio * cfg.maxEntries > 1 + 1e-9) e.push(`1회 비율 × 최대 횟수(${Math.round(cfg.splitRatio * cfg.maxEntries * 100)}%)가 예산(100%)을 넘어요. 마지막 매수는 예산 초과로 실행되지 않아요.`);
    if (Math.floor(budgetKRW * cfg.splitRatio) < minOrderKRW) e.push(`1회 매수 금액이 최소 주문 금액(${minOrderKRW.toLocaleString('ko-KR')}원)보다 작아요.`);
    if (!(cfg.trendEmaPeriod === 0 || (cfg.trendEmaPeriod >= 20 && cfg.trendEmaPeriod <= 400))) e.push('추세 필터 기간은 0(끔) 또는 20 ~ 400 사이로 정해 주세요.');
  } else {
    if (!(cfg.shortPeriod >= 2 && cfg.shortPeriod < cfg.longPeriod && cfg.longPeriod <= 200)) e.push('이동평균 기간은 2 ≤ 단기 < 장기 ≤ 200 이어야 해요.');
    if (!(cfg.entryRatio > 0 && cfg.entryRatio <= 1)) e.push('진입 비율은 0 ~ 1 사이여야 해요.');
    if (!(cfg.volumeMultiplier >= 0 && cfg.volumeMultiplier <= 5)) e.push('거래량 확인 배수는 0(끔) ~ 5 사이로 정해 주세요.');
    if (!(cfg.atrStopMultiplier >= 0 && cfg.atrStopMultiplier <= 10)) e.push('변동폭 손절 배수는 0(끔) ~ 10 사이로 정해 주세요.');
    if (Math.floor(budgetKRW * cfg.entryRatio) < minOrderKRW) e.push(`매수 금액이 최소 주문 금액(${minOrderKRW.toLocaleString('ko-KR')}원)보다 작아요.`);
  }
  return e;
}

export type { Strategy };
