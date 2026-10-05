import type { CandleUnit, StrategyKind } from '../../shared/types';

export function candleUnitLabel(u: CandleUnit): string {
  if (u === '1d') return '일봉';
  return `${u.replace('m', '')}분봉`;
}

/** 원본 UI의 전략 표시명(strategyType)을 유지 */
export const STRATEGY_LABEL: Record<StrategyKind, string> = {
  grid: '무한 그물망(그리드)',
  rsi: '과매도 반등 줍줍(RSI)',
  goldenCross: '골든크로스 돌파',
  bollinger: '볼린저 반등',
  copyTrade: '고수 따라하기',
};
