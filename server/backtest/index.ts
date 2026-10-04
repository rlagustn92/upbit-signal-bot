import type { CandleUnit, CreateBotRequest, StrategyConfig, StrategyKind } from '../../shared/types';
import { STRATEGY_DEFAULTS } from '../config/strategyDefaults';
import { BotError } from '../services/botEngine';
import { STRATEGIES, buildStrategyConfig, isStrategyKind, validateStrategyConfig } from '../strategies';
import type { UpbitRestClient } from '../upbit/rest';
import { UNIT_MS, loadHistory } from './history';
import { runBacktest, type BacktestResult } from './simulator';

export interface BacktestRequest {
  marketCode: string;
  strategy: StrategyKind;
  budgetKRW: number;
  takeProfitPercent: number;
  stopLossPercent: number;
  strategyConfig?: CreateBotRequest['strategyConfig'];
  /** 며칠 전부터 테스트할지 */
  days: number;
}

export interface BacktestResponse extends BacktestResult {
  request: BacktestRequest;
  config: StrategyConfig;
  simUnit: CandleUnit;
  analysisUnit: CandleUnit | null;
}

/** 시뮬레이션 캔들이 너무 많으면(1분봉 1년 등) 업비트 조회가 수천 번 필요하므로 기간을 줄인다 */
const MAX_SIM_BARS = 60_000;
/** 그리드는 실시간 가격으로 움직이므로 5분봉으로 촘촘히 시뮬레이션 */
const GRID_SIM_UNIT: CandleUnit = '5m';

export function normalizeBacktestRequest(body: Record<string, unknown>): BacktestRequest {
  const strategy = body.strategy;
  if (!isStrategyKind(strategy)) throw new BotError('BAD_STRATEGY', '지원하지 않는 전략이에요.', 400);
  const marketCode = String(body.marketCode ?? '').toUpperCase();
  if (!/^KRW-[A-Z0-9]{1,15}$/.test(marketCode)) throw new BotError('BAD_MARKET', '원화(KRW) 마켓 코드가 아니에요. 예: KRW-BTC', 400);
  const n = (v: unknown, def: number) => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : def);
  const req: BacktestRequest = {
    marketCode,
    strategy,
    budgetKRW: Math.floor(n(body.budgetKRW, 1_000_000)),
    takeProfitPercent: n(body.takeProfitPercent, STRATEGY_DEFAULTS.takeProfitPercent),
    stopLossPercent: n(body.stopLossPercent, STRATEGY_DEFAULTS.stopLossPercent),
    strategyConfig: (body.strategyConfig ?? {}) as CreateBotRequest['strategyConfig'],
    days: Math.round(n(body.days, 90)),
  };
  if (!(req.days >= 3 && req.days <= 365)) throw new BotError('BAD_DAYS', '기간은 3 ~ 365일 사이로 정해 주세요.', 400);
  if (!(req.budgetKRW >= 10_000 && req.budgetKRW <= 1_000_000_000)) throw new BotError('BAD_BUDGET', '예산은 1만 원 ~ 10억 원 사이로 정해 주세요.', 400);
  if (!(req.takeProfitPercent > 0 && req.takeProfitPercent <= 100)) throw new BotError('BAD_TP', '익절은 0 ~ 100% 사이로 정해 주세요.', 400);
  if (!(req.stopLossPercent > 0 && req.stopLossPercent < 100)) throw new BotError('BAD_SL', '손절은 0 ~ 100% 사이로 정해 주세요.', 400);
  return req;
}

export async function backtest(rest: UpbitRestClient, req: BacktestRequest, opts: { cacheDir?: string; onProgress?: (loaded: number, total: number) => void; now?: number } = {}): Promise<BacktestResponse> {
  const config = buildStrategyConfig(req.strategy, req.strategyConfig);
  const errors = validateStrategyConfig(config, req.budgetKRW, STRATEGY_DEFAULTS.minOrderKRWDefault);
  if (errors.length) throw new BotError('INVALID_CONFIG', errors.join(' '), 400);

  const strategy = STRATEGIES[req.strategy];
  const candleUnit = strategy.candleUnit(config);
  const simUnit: CandleUnit = req.strategy === 'grid' ? GRID_SIM_UNIT : (candleUnit ?? '15m');
  const analysisUnit = req.strategy === 'grid' ? candleUnit : null;
  const unitMs = UNIT_MS[simUnit];
  const aMs = analysisUnit ? UNIT_MS[analysisUnit] : unitMs;
  const notes: string[] = [];

  let days = req.days;
  const maxDays = Math.floor((MAX_SIM_BARS * unitMs) / 86_400_000);
  if (days > maxDays) {
    notes.push(`${simUnit} 캔들은 너무 많아서 최근 ${maxDays}일만 테스트했어요.`);
    days = maxDays;
  }
  const now = opts.now ?? Date.now();
  const warmupMs = strategy.minCandles(config) * aMs + aMs;
  const testStart = now - days * 86_400_000;
  const bars = await loadHistory(rest, req.marketCode, simUnit, testStart - warmupMs, { cacheDir: opts.cacheDir, onProgress: opts.onProgress, now });
  const warmup = Math.max(1, bars.findIndex((b) => b.start >= testStart));
  if (bars.length < warmup + 10) throw new BotError('NOT_ENOUGH_DATA', '과거 캔들이 부족해요(최근 상장 코인일 수 있어요). 기간을 줄여 보세요.', 400);

  const result = runBacktest({
    marketCode: req.marketCode,
    strategy: req.strategy,
    config,
    budgetKRW: req.budgetKRW,
    takeProfitPercent: req.takeProfitPercent,
    stopLossPercent: req.stopLossPercent,
    bars,
    unitMs,
    analysisUnitMs: analysisUnit ? aMs : undefined,
    warmup,
  });
  return { ...result, notes: [...notes, ...result.notes], request: { ...req, days }, config, simUnit, analysisUnit };
}
