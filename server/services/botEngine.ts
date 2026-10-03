import type { BotDTO, CandleUnit, CreateBotRequest, OrderPurpose, StrategyConfig, TradingMode, UpdateBotRequest } from '../../shared/types';
import { ENGINE, STRATEGY_DEFAULTS } from '../config/strategyDefaults';
import type { BotRecord, OrderRecord, Repo } from '../db/repositories';
import { isValidMarketCode, toDisplaySymbol } from '../domain/market';
import { D, krwTickSize } from '../domain/orderMath';
import type { Bus } from '../lib/bus';
import { log } from '../lib/logger';
import { buildStrategyConfig, isStrategyKind, STRATEGIES, validateStrategyConfig } from '../strategies';
import { STRATEGY_LABEL } from '../strategies/labels';
import { riskExitIntents } from '../strategies/riskExit';
import type { Strategy, StrategyContext, StrategyIntent } from '../strategies/types';
import type { MarketDataService } from './marketData';
import type { OrderService } from './orders';
import type { PositionService } from './positions';
import type { SystemService } from './system';

interface Runtime {
  bot: BotRecord;
  strategy: Strategy;
  state: Record<string, unknown>;
  stateJson: string;
  unit: CandleUnit | null;
  busy: boolean;
  lastTickEval: number;
  ready: boolean;
}

/** 주문 1건에 필요한 최소 금액: 업비트 최소 주문 금액 + 수수료 + 2% 여유(소폭 손실 후에도 팔 수 있도록) */
export function minOrderWithFee(): number {
  return Math.ceil(STRATEGY_DEFAULTS.minOrderKRWDefault * (1 + STRATEGY_DEFAULTS.feeRateDefault) * 1.02);
}

const VALID_UNITS = ['1m', '3m', '5m', '10m', '15m', '30m', '60m', '240m', '1d'];
function checkCandleUnit(cfg: { candleUnit?: unknown } | undefined): void {
  if (cfg?.candleUnit !== undefined && !VALID_UNITS.includes(String(cfg.candleUnit))) {
    throw new BotError('INVALID_CANDLE_UNIT', `캔들 단위는 ${VALID_UNITS.join(', ')} 중 하나여야 해요.`);
  }
}

export class BotError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400,
  ) {
    super(message);
  }
}

const EXIT_PURPOSES: OrderPurpose[] = ['EXIT', 'TAKE_PROFIT', 'STOP_LOSS'];

/** 저장된 설정 + 최신 기본값(새로 생긴 항목) → 실제 사용할 설정. 예전에 만든 봇도 새 항목은 기본값으로 동작 */
function cfgOf(bot: BotRecord): StrategyConfig {
  return buildStrategyConfig(bot.strategy, bot.strategyConfig as unknown as Record<string, unknown>);
}
const KST_OFFSET = 9 * 3600_000;

function kstMidnightIso(now = Date.now()): string {
  const k = new Date(now + KST_OFFSET);
  k.setUTCHours(0, 0, 0, 0);
  return new Date(k.getTime() - KST_OFFSET).toISOString();
}

/**
 * 봇 엔진: 실시간 데이터 → 지표/전략 판단 → 시그널 → (Risk·중복·예산 검증은 OrderService) → 주문
 * - 봇별 실행 상태(runtime)는 메모리에 두되, 전략 상태는 매 평가 후 DB(bots.strategy_state)에 저장 → 재시작 복구
 * - 봇별 busy 락: 주문 요청이 진행 중이면 다음 틱은 건너뜀(네트워크 지연 중 같은 신호로 재주문 방지)
 */
export class BotEngine {
  private runtimes = new Map<number, Runtime>();
  private rejectCooldown = new Map<string, { until: number; streak: number }>();

  constructor(
    private readonly repo: Repo,
    private readonly market: MarketDataService,
    private readonly orders: OrderService,
    private readonly positions: PositionService,
    private readonly system: SystemService,
    private readonly bus: Bus,
  ) {
    this.bus.onTyped('ticker', (m, p) => this.onTicker(m, p));
    this.bus.onTyped('candleClose', (m, u) => void this.onCandleClose(m, u));
    this.bus.onTyped('orderUpdated', (o, delta, avg, terminal) => this.onOrderUpdated(o, delta, avg, terminal));
    this.bus.onTyped('positionClosed', (botId) => this.onPositionClosed(botId));
    this.market.addSubscriptionProvider(() => this.subscriptions());
  }

  // ───────────── 구독 대상 ─────────────
  private subscriptions() {
    const ticker = new Set<string>();
    const trade = new Set<string>();
    const candles = new Set<string>();
    for (const b of this.repo.listBots()) ticker.add(b.marketCode);
    for (const rt of this.runtimes.values()) {
      if (rt.bot.mode === 'PAPER') trade.add(rt.bot.marketCode);
      if (rt.unit) candles.add(`${rt.bot.marketCode}|${rt.unit}`);
    }
    // 활성 PAPER 주문이 남아 있는 마켓도 체결 시뮬레이션을 위해 구독
    for (const o of this.repo.listActiveOrders({ mode: 'PAPER' })) trade.add(o.marketCode);
    return { ticker, trade, candles };
  }

  // ───────────── 시작/복구 ─────────────
  async resumeActiveBots(): Promise<void> {
    for (const bot of this.repo.listBots()) {
      if (!isStrategyKind(bot.strategy)) {
        log.error('SYSTEM', `bot#${bot.id} 알 수 없는 전략(${String(bot.strategy)}) → 실행하지 않고 목록에서 제외`);
        this.repo.softDeleteBot(bot.id);
        continue;
      }
      if (!bot.active) continue;
      if (this.system.emergencyStop) {
        this.repo.updateBot(bot.id, { active: false });
        continue;
      }
      try {
        await this.startRuntime(bot);
        log.info('SYSTEM', `bot#${bot.id} (${bot.name}) 감시 재개`);
      } catch (e) {
        log.error('SYSTEM', `bot#${bot.id} 재개 실패: ${(e as Error).message}`);
      }
    }
    this.market.recomputeSubscriptions();
  }

  private async startRuntime(bot: BotRecord): Promise<void> {
    const strategy = STRATEGIES[bot.strategy];
    const unit = strategy.candleUnit(cfgOf(bot));
    const rt: Runtime = {
      bot,
      strategy,
      state: structuredClone(bot.strategyState ?? {}),
      stateJson: JSON.stringify(bot.strategyState ?? {}),
      unit,
      busy: false,
      lastTickEval: 0,
      ready: false,
    };
    this.runtimes.set(bot.id, rt);
    await this.market.seedTickers([bot.marketCode]).catch(() => {});
    await this.market.refreshInstruments([bot.marketCode]);
    if (unit) await this.market.ensureCandles(bot.marketCode, unit, strategy.minCandles(cfgOf(bot)));
    // 준비하는 사이 봇이 꺼졌거나 다시 시작됐으면 이 실행기는 버린다
    if (this.runtimes.get(bot.id) !== rt) return;
    const ctx = this.context(rt, this.market.getPrice(bot.marketCode) ?? 0);
    const intents = strategy.initialize(ctx);
    this.persistState(rt);
    rt.ready = true;
    if (intents.length) await this.process(rt, intents);
  }

  // ───────────── 이벤트 처리 ─────────────
  private onTicker(market: string, price: number): void {
    const now = Date.now();
    for (const rt of this.runtimes.values()) {
      if (rt.bot.marketCode !== market || !rt.ready || rt.busy) continue;
      if (now - rt.lastTickEval < ENGINE.tickEvalMinMs) continue;
      rt.lastTickEval = now;
      void this.evaluate(rt, price, 'ticker');
    }
  }

  private async onCandleClose(market: string, unit: CandleUnit): Promise<void> {
    for (const rt of this.runtimes.values()) {
      if (rt.bot.marketCode !== market || rt.unit !== unit || !rt.ready) continue;
      // 캔들 확정은 놓치면 안 되므로 busy면 잠시 기다렸다 처리
      for (let i = 0; i < 20 && rt.busy; i++) await new Promise((r) => setTimeout(r, 250));
      void this.evaluate(rt, this.market.getPrice(market) ?? 0, 'candle');
    }
  }

  private onOrderUpdated(o: OrderRecord, delta: number, avg: number, terminal: boolean): void {
    if (o.botId == null) return;
    const rt = this.runtimes.get(o.botId);
    const bot = rt?.bot ?? this.repo.getBot(o.botId);
    if (!bot) return;
    // 실행 중이 아니어도(봇 OFF 중 체결) 전략 상태는 갱신해야 다음 시작 때 맞다
    const runtime: Runtime = rt ?? {
      bot,
      strategy: STRATEGIES[bot.strategy],
      state: structuredClone(bot.strategyState ?? {}),
      stateJson: JSON.stringify(bot.strategyState ?? {}),
      unit: null,
      busy: false,
      lastTickEval: 0,
      ready: false,
    };
    if (delta > 0 || terminal) {
      runtime.strategy.onOrderUpdate(this.context(runtime, this.market.getPrice(bot.marketCode) ?? 0), o, delta, avg);
      this.persistState(runtime);
    }
    if (delta > 0) {
      const what = o.side === 'bid' ? '매수 체결' : '매도 체결';
      this.repo.setLastSignal(bot.id, `${what} (${Math.round(avg).toLocaleString('ko-KR')}원)`);
      this.bus.emitTyped('activity');
    } else if (terminal && o.state === 'REJECTED' && o.errorMessage) {
      this.repo.setLastSignal(bot.id, `주문 실패: ${o.errorMessage}`);
    }
    if (terminal && o.side === 'ask' && Number(o.executedVolume) > 0) {
      const realized = this.repo.tradesForOrder(o.id).reduce((a, t) => a + Number(t.realizedPnl ?? 0), 0);
      if (realized < 0) {
        runtime.state._lossAt = Date.now(); // 손실 후 쉬는 시간 시작
        this.persistState(runtime);
      }
    }
    if (terminal && o.purpose === 'STOP_LOSS' && Number(o.executedVolume) > 0) {
      // 손절 후 하락이 이어질 때 곧바로 재매수하지 않도록 봇을 끈다(보유 코인은 이미 매도됨).
      // 그리드는 다시 켤 때 그 시점 가격을 새 기준가로 쓰도록 기준가를 비운다.
      if (bot.strategy === 'grid') delete runtime.state.basePrice;
      this.persistState(runtime);
      this.repo.updateBot(bot.id, { active: false });
      this.runtimes.delete(bot.id);
      this.repo.setLastSignal(bot.id, '손절 후 봇을 자동으로 껐어요. 다시 켜면 그때 가격부터 새로 시작해요.');
      log.warn('RISK', `bot#${bot.id} 손절 체결 → 재매수 방지를 위해 봇 OFF`);
      void this.orders.cancelBotOrders(bot.id, '손절 후 자동 OFF');
      this.bus.emitTyped('changed');
    }
    if (terminal) this.market.recomputeSubscriptions();
  }

  private onPositionClosed(botId: number): void {
    const rt = this.runtimes.get(botId);
    const bot = rt?.bot ?? this.repo.getBot(botId);
    if (!bot) return;
    const runtime = rt ?? { bot, strategy: STRATEGIES[bot.strategy], state: structuredClone(bot.strategyState ?? {}), stateJson: '', unit: null, busy: false, lastTickEval: 0, ready: false };
    runtime.strategy.onPositionClosed(this.context(runtime, this.market.getPrice(bot.marketCode) ?? 0));
    this.persistState(runtime);
  }

  private context(rt: Runtime, price: number): StrategyContext {
    const pos = this.positions.get(rt.bot.id, rt.bot.marketCode);
    return {
      bot: rt.bot,
      config: cfgOf(rt.bot),
      state: rt.state,
      position: { quantity: Number(pos.quantity), averageEntryPrice: Number(pos.averageEntryPrice), totalCost: Number(pos.totalCost) },
      price,
      closes: rt.unit ? this.market.getCloses(rt.bot.marketCode, rt.unit) : [],
      bars: rt.unit ? this.market.getBars(rt.bot.marketCode, rt.unit) : [],
      hasActiveOrder: (purposes, gridLevelId) => this.repo.findActiveOrder(rt.bot.id, purposes, gridLevelId === undefined ? undefined : gridLevelId) != null,
      now: Date.now(),
    };
  }

  private persistState(rt: Runtime): void {
    const json = JSON.stringify(rt.state);
    if (json === rt.stateJson) return;
    rt.stateJson = json;
    this.repo.saveStrategyState(rt.bot.id, rt.state);
  }

  private async evaluate(rt: Runtime, price: number, trigger: 'ticker' | 'candle'): Promise<void> {
    if (rt.busy || !(price > 0)) return;
    if (this.system.emergencyStop) return;
    rt.busy = true;
    try {
      // 최신 봇 설정 반영(수정 API로 바뀌었을 수 있음)
      const fresh = this.repo.getBot(rt.bot.id);
      if (!fresh || !fresh.active) {
        this.runtimes.delete(rt.bot.id);
        return;
      }
      rt.bot = fresh;
      const ctx = this.context(rt, price);
      const intents: StrategyIntent[] = [];
      if (trigger === 'ticker') {
        intents.push(...riskExitIntents(ctx));
        if (!intents.length) intents.push(...rt.strategy.onTicker(ctx));
      } else {
        intents.push(...rt.strategy.onCandleClose(ctx));
      }
      this.persistState(rt);
      if (intents.length) await this.process(rt, intents);
    } catch (e) {
      log.error('STRATEGY', `bot#${rt.bot.id} 평가 오류: ${(e as Error).message}`);
    } finally {
      rt.busy = false;
    }
  }

  private async process(rt: Runtime, intents: StrategyIntent[]): Promise<void> {
    const bot = rt.bot;
    for (const intent of intents) {
      if (!intent.order) {
        const sig = this.repo.insertSignal({ botId: bot.id, marketCode: bot.marketCode, strategy: bot.strategy, signalType: intent.signalType, signalValue: intent.signalValue, reason: intent.reason });
        this.repo.updateSignalOutcome(sig.id, '알림');
        this.repo.setLastSignal(bot.id, intent.reason);
        log.info('SIGNAL', `bot#${bot.id} ${bot.marketCode} ${intent.signalType} ${intent.signalValue ?? ''} — ${intent.reason}`);
        this.bus.emitTyped('activity');
        continue;
      }
      const ord = intent.order;
      // 새로 사는 주문은 하루 손실 한도/손실 후 쉬는 시간을 먼저 확인
      if (ord.side === 'bid') {
        const blocked = this.entryBlockReason(rt);
        if (blocked) {
          if (Date.now() - Number(rt.state._blockNotifiedAt ?? 0) > 3600_000) {
            rt.state._blockNotifiedAt = Date.now();
            this.persistState(rt);
            const sig = this.repo.insertSignal({ botId: bot.id, marketCode: bot.marketCode, strategy: bot.strategy, signalType: 'INFO', signalValue: intent.signalValue, reason: `${intent.reason} → 하지만 ${blocked}` });
            this.repo.updateSignalOutcome(sig.id, '주문 안 함(위험 관리)');
            this.repo.setLastSignal(bot.id, blocked);
            log.info('RISK', `bot#${bot.id} 신규 매수 보류: ${blocked}`);
            this.bus.emitTyped('activity');
          }
          continue;
        }
      }
      const key = `${bot.id}|${ord.purpose}|${ord.gridLevelId ?? ''}`;
      const cd = this.rejectCooldown.get(key);
      if (cd && cd.until > Date.now()) continue;

      log.info('STRATEGY', `bot#${bot.id} ${bot.marketCode} ${intent.signalValue ?? ''} → ${intent.signalType}_SIGNAL (${ord.purpose})`);
      const sig = this.repo.insertSignal({ botId: bot.id, marketCode: bot.marketCode, strategy: bot.strategy, signalType: intent.signalType, signalValue: intent.signalValue, reason: intent.reason });
      this.repo.setLastSignal(bot.id, intent.reason);
      log.info('SIGNAL', `bot#${bot.id} ${intent.reason}`);

      // 손절/익절/청산 전에는 이 봇의 다른 미체결 주문(그리드 매도 등)을 먼저 취소해 묶인 수량을 풀어준다
      if (EXIT_PURPOSES.includes(ord.purpose)) {
        await this.orders.cancelBotOrders(bot.id, `${ord.purpose} 전 정리`);
        await this.orders.waitBotOrdersClosed(bot.id);
      }

      const res = await this.orders.submit({
        bot,
        side: ord.side,
        purpose: ord.purpose,
        kind: ord.kind,
        limitPrice: ord.limitPrice,
        krwAmount: ord.krwAmount,
        volume: ord.volume,
        gridLevelId: ord.gridLevelId ?? null,
        reason: intent.reason,
        signalId: sig.id,
      });
      if (res.ok) {
        this.rejectCooldown.delete(key);
        const filled = res.order.state === 'FILLED';
        this.repo.updateSignalOutcome(sig.id, filled ? '주문 체결' : '주문 접수', res.order.id);
      } else {
        const streak = (cd?.streak ?? 0) + 1;
        const transient = ['IN_FLIGHT', 'NO_PRICE', 'RULES_UNAVAILABLE', 'ACCOUNT_UNAVAILABLE'].includes(res.code);
        // 손절/익절/청산은 위험을 줄이는 주문이라 길게 쉬지 않는다(15초 고정)
        const wait = EXIT_PURPOSES.includes(ord.purpose)
          ? ENGINE.exitRetryMs
          : transient
            ? 5_000
            : Math.min(30 * 60_000, ENGINE.rejectedIntentCooldownMs * 2 ** (streak - 1));
        if (res.code !== 'IN_FLIGHT') this.rejectCooldown.set(key, { until: Date.now() + wait, streak: transient ? 0 : streak });
        this.repo.updateSignalOutcome(sig.id, `주문 안 함: ${res.message}`);
        this.repo.setLastSignal(bot.id, `주문 안 함: ${res.message}`);
        log.warn('RISK', `bot#${bot.id} 주문 거부(${res.code}): ${res.message}`);
      }
      this.bus.emitTyped('activity');
    }
  }

  // ───────────── 봇 관리 API ─────────────
  createBot(req: CreateBotRequest): BotRecord {
    const marketCode = String(req.marketCode ?? '').trim().toUpperCase();
    if (!isValidMarketCode(marketCode)) throw new BotError('INVALID_MARKET', '코인(마켓) 코드가 올바르지 않아요.');
    if (!marketCode.startsWith('KRW-')) throw new BotError('UNSUPPORTED_MARKET', '현재는 원화(KRW) 마켓만 지원해요.');
    const info = this.market.getMarket(marketCode);
    if (!info) throw new BotError('MARKET_NOT_FOUND', '업비트에서 거래할 수 없는 코인이에요.');
    if (!isStrategyKind(req.strategy)) throw new BotError('INVALID_STRATEGY', '전략을 선택해 주세요.');
    if (typeof req.budgetKRW !== 'number' && typeof req.budgetKRW !== 'string') throw new BotError('INVALID_BUDGET', '예산은 숫자로 입력해 주세요.');
    if (req.name !== undefined && typeof req.name !== 'string') throw new BotError('INVALID_NAME', '이름은 글자로 입력해 주세요.');
    const budget = Math.floor(Number(req.budgetKRW));
    const minOrder = STRATEGY_DEFAULTS.minOrderKRWDefault;
    const minBudget = minOrderWithFee();
    if (!Number.isFinite(budget) || budget < minBudget) throw new BotError('INVALID_BUDGET', `예산은 ${minBudget.toLocaleString('ko-KR')}원 이상이어야 해요. (최소 주문 ${minOrder.toLocaleString('ko-KR')}원 + 수수료 여유)`);
    if (budget > 1_000_000_000) throw new BotError('INVALID_BUDGET', '예산이 너무 커요.');
    const tp = Number(req.takeProfitPercent);
    const sl = Number(req.stopLossPercent);
    if (!(tp >= 0.1 && tp <= 100)) throw new BotError('INVALID_TP', '목표 익절은 0.1% ~ 100% 사이여야 해요.');
    if (!(sl >= 0.1 && sl <= 50)) throw new BotError('INVALID_SL', '손절 기준은 0.1% ~ 50% 사이여야 해요.');
    checkCandleUnit(req.strategyConfig);
    const config: StrategyConfig = buildStrategyConfig(req.strategy, req.strategyConfig);
    const errors = validateStrategyConfig(config, budget, minOrder);
    if (errors.length) throw new BotError('INVALID_CONFIG', errors[0]);
    this.checkTickFloor(marketCode, config, tp, sl);
    this.checkBasePrice(marketCode, config);

    const name = String(req.name ?? '').trim().slice(0, 60) || `${info.koreanName} ${STRATEGY_LABEL[req.strategy]}`;
    const bot = this.repo.insertBot({
      name,
      displayName: name,
      marketCode,
      displaySymbol: toDisplaySymbol(marketCode),
      coinName: info.koreanName,
      strategy: req.strategy,
      strategyConfig: config,
      strategyState: {},
      budgetKRW: String(budget),
      takeProfitPercent: tp,
      stopLossPercent: sl,
      active: false,
      mode: 'PAPER', // 새 봇은 항상 모의투자로 시작
    });
    log.info('SYSTEM', `봇 생성 bot#${bot.id} ${marketCode} ${req.strategy} 예산 ${budget}원 (PAPER)`);
    this.market.recomputeSubscriptions();
    this.bus.emitTyped('changed');
    return bot;
  }

  updateBot(id: number, req: UpdateBotRequest): BotRecord {
    const bot = this.repo.getBot(id);
    if (!bot) throw new BotError('NOT_FOUND', '봇을 찾을 수 없어요.', 404);
    const patch: Parameters<Repo['updateBot']>[1] = {};
    if (req.name !== undefined) {
      const n = String(req.name).trim();
      if (!n || n.length > 60) throw new BotError('INVALID_NAME', '이름은 1~60자로 정해 주세요.');
      patch.name = n;
      patch.displayName = n;
    }
    const budget = req.budgetKRW !== undefined ? Math.floor(Number(req.budgetKRW)) : Number(bot.budgetKRW);
    if (req.budgetKRW !== undefined) {
      if (!Number.isFinite(budget) || budget < STRATEGY_DEFAULTS.minOrderKRWDefault) throw new BotError('INVALID_BUDGET', '예산이 너무 작아요.');
      patch.budgetKRW = String(budget);
    }
    if (req.takeProfitPercent !== undefined) {
      const tp = Number(req.takeProfitPercent);
      if (!(tp >= 0.1 && tp <= 100)) throw new BotError('INVALID_TP', '목표 익절은 0.1% ~ 100% 사이여야 해요.');
      patch.takeProfitPercent = tp;
    }
    if (req.stopLossPercent !== undefined) {
      const sl = Number(req.stopLossPercent);
      if (!(sl >= 0.1 && sl <= 50)) throw new BotError('INVALID_SL', '손절 기준은 0.1% ~ 50% 사이여야 해요.');
      patch.stopLossPercent = sl;
    }
    // 예산이나 전략 설정이 바뀌면 둘이 맞는지 다시 검증(이름/익절/손절만 바꿀 때는 기존 설정 그대로 허용)
    checkCandleUnit(req.strategyConfig);
    const merged = buildStrategyConfig(bot.strategy, { ...(bot.strategyConfig as object), ...(req.strategyConfig ?? {}) });
    if (req.budgetKRW !== undefined || req.strategyConfig) {
      const errors = validateStrategyConfig(merged, budget, STRATEGY_DEFAULTS.minOrderKRWDefault);
      if (errors.length) throw new BotError('INVALID_CONFIG', errors[0]);
    }
    if (req.strategyConfig) patch.strategyConfig = merged;
    this.checkTickFloor(bot.marketCode, merged, patch.takeProfitPercent ?? bot.takeProfitPercent, patch.stopLossPercent ?? bot.stopLossPercent);
    this.repo.updateBot(id, patch);
    const updated = this.repo.getBot(id)!;
    const rt = this.runtimes.get(id);
    if (rt) rt.bot = updated;
    log.info('SYSTEM', `봇 수정 bot#${id}`, patch);
    this.bus.emitTyped('changed');
    return updated;
  }

  async startBot(id: number): Promise<BotRecord> {
    const bot = this.repo.getBot(id);
    if (!bot) throw new BotError('NOT_FOUND', '봇을 찾을 수 없어요.', 404);
    if (this.system.emergencyStop) throw new BotError('EMERGENCY_STOP', '긴급 정지 중이에요. 먼저 긴급 정지를 해제해 주세요.', 409);
    if (bot.mode === 'LIVE') {
      const g = this.orders.liveGate();
      if (!g.ok) throw new BotError('LIVE_LOCKED', g.reason, 409);
    }
    if (bot.active && this.runtimes.has(id)) return bot; // 이미 실행 중이면 아무것도 하지 않음(실행기 중복 생성 방지)
    this.repo.updateBot(id, { active: true });
    const fresh = this.repo.getBot(id)!;
    try {
      await this.startRuntime(fresh);
    } catch (e) {
      // 그 사이 다른 시작이 성공했을 수 있으므로, 실행 중인 실행기가 없을 때만 끈다
      if (!this.runtimes.get(id)?.ready) {
        this.repo.updateBot(id, { active: false });
        this.runtimes.delete(id);
      }
      throw new BotError('START_FAILED', `봇을 시작하지 못했어요: ${(e as Error).message}`, 500);
    }
    if (!this.runtimes.has(id)) return this.repo.getBot(id)!; // 시작 도중 꺼짐
    this.market.recomputeSubscriptions();
    log.info('SYSTEM', `bot#${id} 켜짐 (${fresh.mode})`);
    this.bus.emitTyped('changed');
    return fresh;
  }

  /** 봇 OFF: 신규 주문 중단 + 이 봇의 미체결 주문 취소. 보유 코인은 팔지 않는다. */
  async stopBot(id: number): Promise<{ bot: BotRecord; cancelled: number; failed: number }> {
    const bot = this.repo.getBot(id);
    if (!bot) throw new BotError('NOT_FOUND', '봇을 찾을 수 없어요.', 404);
    this.repo.updateBot(id, { active: false });
    this.runtimes.delete(id);
    const r = await this.orders.cancelBotOrders(id, '봇 OFF');
    this.market.recomputeSubscriptions();
    log.info('SYSTEM', `bot#${id} 꺼짐 — 미체결 ${r.requested}건 취소 요청, 보유 코인은 유지`);
    this.bus.emitTyped('changed');
    return { bot: this.repo.getBot(id)!, cancelled: r.requested, failed: r.failed };
  }

  async setMode(id: number, mode: TradingMode): Promise<BotRecord> {
    const bot = this.repo.getBot(id);
    if (!bot) throw new BotError('NOT_FOUND', '봇을 찾을 수 없어요.', 404);
    if (bot.mode === mode) return bot;
    if (bot.active) throw new BotError('BOT_ACTIVE', '봇을 끈 다음에 모드를 바꿀 수 있어요.', 409);
    if (this.repo.listActiveOrders({ botId: id }).length) throw new BotError('HAS_ORDERS', '미체결 주문이 정리된 다음에 바꿀 수 있어요.', 409);
    if (D(this.positions.get(id, bot.marketCode).quantity).gt(0)) {
      throw new BotError('HAS_POSITION', '이 봇이 들고 있는 코인이 있어서 모드를 바꿀 수 없어요. (모의/실전 기록이 섞이지 않도록)', 409);
    }
    if (mode === 'LIVE') {
      const g = this.orders.liveGate();
      if (!g.ok) throw new BotError('LIVE_LOCKED', g.reason, 409);
    }
    this.repo.updateBot(id, { mode });
    this.repo.saveStrategyState(id, {});
    log.warn('SYSTEM', `bot#${id} 모드 변경 → ${mode}`);
    this.bus.emitTyped('changed');
    return this.repo.getBot(id)!;
  }

  async deleteBot(id: number): Promise<void> {
    const bot = this.repo.getBot(id);
    if (!bot) throw new BotError('NOT_FOUND', '봇을 찾을 수 없어요.', 404);
    if (bot.active) throw new BotError('BOT_ACTIVE', '봇을 끈 다음에 삭제할 수 있어요.', 409);
    if (this.repo.listActiveOrders({ botId: id }).length) throw new BotError('HAS_ORDERS', '미체결 주문이 정리된 다음에 삭제할 수 있어요.', 409);
    if (D(this.positions.get(id, bot.marketCode).quantity).gt(0)) {
      throw new BotError(
        'HAS_POSITION',
        bot.mode === 'LIVE'
          ? '이 봇이 실제로 산 코인이 남아 있어요. 업비트에서 직접 정리한 뒤 삭제해 주세요.'
          : '이 봇이 모의투자로 들고 있는 코인이 있어요. 먼저 "모의 코인 팔기"로 정리한 뒤 삭제해 주세요.',
        409,
      );
    }
    this.repo.softDeleteBot(id);
    this.market.recomputeSubscriptions();
    log.info('SYSTEM', `bot#${id} 삭제`);
    this.bus.emitTyped('changed');
  }

  /** 긴급 전체 정지: 모든 봇 OFF + 신규 주문 차단 + 봇 미체결 주문 취소. 보유 코인 강제 매도 없음. */
  async emergencyStop(): Promise<{ bots: number; cancelled: number; failed: number }> {
    this.system.setEmergencyStop(true);
    const bots = this.repo.listBots();
    const activeCount = bots.filter((b) => b.active).length;
    this.repo.setAllBotsInactive();
    this.runtimes.clear();
    let cancelled = 0;
    let failed = 0;
    for (const b of bots) {
      const r = await this.orders.cancelBotOrders(b.id, '긴급 정지');
      cancelled += r.requested;
      failed += r.failed;
    }
    // 삭제된 봇의 주문 등 botId가 없는 봇 형식 주문도 취소
    for (const o of this.repo.listActiveOrders().filter((x) => x.botId == null || !bots.some((b) => b.id === x.botId))) {
      try {
        await this.orders.cancel(o.id);
        cancelled++;
      } catch {
        failed++;
      }
    }
    this.market.recomputeSubscriptions();
    log.warn('SYSTEM', `🛑 긴급 정지 완료 — 봇 ${activeCount}개 OFF, 미체결 ${cancelled}건 취소 요청${failed ? `(실패 ${failed})` : ''}, 보유 코인은 그대로`);
    this.bus.emitTyped('changed');
    return { bots: activeCount, cancelled, failed };
  }

  releaseEmergency(): void {
    this.system.setEmergencyStop(false);
  }

  /** 모의투자 봇이 들고 있는 가상 코인을 시장가로 정리(봇이 꺼져 있을 때만, PAPER 전용) */
  async liquidatePaper(id: number): Promise<void> {
    const bot = this.repo.getBot(id);
    if (!bot) throw new BotError('NOT_FOUND', '봇을 찾을 수 없어요.', 404);
    if (bot.mode !== 'PAPER') throw new BotError('NOT_PAPER', '실전 봇의 코인은 프로그램이 팔지 않아요. 업비트에서 직접 정리해 주세요.', 409);
    if (bot.active) throw new BotError('BOT_ACTIVE', '봇을 끈 다음에 정리할 수 있어요.', 409);
    if (this.repo.listActiveOrders({ botId: id }).length) throw new BotError('HAS_ORDERS', '미체결 주문이 정리된 다음에 할 수 있어요.', 409);
    const r = await this.orders.submit({ bot, side: 'ask', purpose: 'MANUAL', kind: 'market', volume: 'ALL', reason: '사용자가 모의 코인 팔기를 눌러 정리', allowInactivePaper: true });
    if (!r.ok) throw new BotError(r.code, r.message, 409);
    this.repo.setLastSignal(id, '모의 코인을 시장가로 정리했어요');
  }

  /** 새로 사면 안 되는 이유(하루 손실 한도 / 손실 후 쉬는 시간). 없으면 null */
  private entryBlockReason(rt: Runtime): string | null {
    const cfg = cfgOf(rt.bot);
    if (cfg.dailyLossLimitPercent > 0) {
      const lossToday = this.repo.realizedSince(rt.bot.id, kstMidnightIso());
      const limit = (Number(rt.bot.budgetKRW) * cfg.dailyLossLimitPercent) / 100;
      if (lossToday <= -limit) return `오늘 확정 손실이 하루 한도(예산의 ${cfg.dailyLossLimitPercent}%)에 닿아서 내일까지 새로 사지 않아요`;
    }
    if (cfg.cooldownAfterLossMin > 0 && rt.state._lossAt) {
      const left = Number(rt.state._lossAt) + cfg.cooldownAfterLossMin * 60_000 - Date.now();
      if (left > 0) return `손실을 보고 판 뒤 쉬는 중이에요 (${Math.ceil(left / 60_000)}분 남음)`;
    }
    return null;
  }

  /** 그리드 기준가를 직접 넣을 때는 현재가 ±20% 안에서만(너무 높으면 켜자마자 모든 칸을 시장가로 사게 됨) */
  private checkBasePrice(marketCode: string, cfg: StrategyConfig): void {
    if (cfg.kind !== 'grid' || !(cfg.basePrice > 0)) return;
    const p = this.market.getPrice(marketCode);
    if (p == null) throw new BotError('NO_PRICE', '현재가를 아직 받지 못해서 기준가를 확인할 수 없어요. 기준가를 0(자동)으로 두세요.');
    if (cfg.basePrice > p * 1.2 || cfg.basePrice < p * 0.8) throw new BotError('BASE_PRICE_RANGE', '기준가는 현재가의 ±20% 안에서 정해 주세요. (0이면 켤 때 현재가)');
  }

  /** 호가 단위보다 작은 설정은 의미가 없으므로 거부(예: 127원 코인에 0.1% 간격 → 모든 칸이 같은 가격) */
  private checkTickFloor(marketCode: string, cfg: StrategyConfig, tp: number, sl: number): void {
    const p = this.market.getPrice(marketCode);
    if (p == null || !(p > 0)) return;
    const tickPct = (krwTickSize(p).toNumber() / p) * 100;
    const min = (Math.ceil(tickPct * 100) / 100).toFixed(2);
    if (cfg.kind === 'grid' && cfg.spacingPercent < tickPct) {
      throw new BotError('SPACING_TOO_SMALL', `이 코인은 호가 단위가 커서 간격을 최소 ${min}% 이상으로 정해야 해요.`);
    }
    if (tp < tickPct || sl < tickPct) {
      throw new BotError('TP_SL_TOO_SMALL', `이 코인은 한 호가가 약 ${min}%라서 익절/손절을 그보다 크게 정해야 해요.`);
    }
  }

  isRunning(id: number): boolean {
    return this.runtimes.has(id);
  }

  // ───────────── 화면용 DTO ─────────────
  toDTOs(): BotDTO[] {
    const today = this.repo.countTradesSince(kstMidnightIso());
    const gate = this.orders.liveGate();
    return this.repo.listBots().filter((b) => isStrategyKind(b.strategy)).map((b) => {
      const pos = this.positions.get(b.id, b.marketCode);
      const price = this.market.getPrice(b.marketCode);
      const qty = Number(pos.quantity);
      const cost = Number(pos.totalCost);
      const unrealized = price != null && qty > 0 ? qty * price - cost : 0;
      const realized = Number(pos.realizedPnl);
      const total = realized + unrealized;
      const budget = Number(b.budgetKRW);
      const desc = STRATEGIES[b.strategy].describe(b, cfgOf(b), b.strategyState);
      const open = this.repo.listActiveOrders({ botId: b.id });
      let blockedReason: string | null = null;
      if (this.system.emergencyStop) blockedReason = '긴급 정지 중';
      else if (b.mode === 'LIVE' && !gate.ok) blockedReason = gate.reason;
      return {
        id: b.id,
        name: b.name,
        displayName: b.displayName,
        marketCode: b.marketCode,
        displaySymbol: b.displaySymbol,
        coinName: b.coinName,
        strategy: b.strategy,
        strategyConfig: cfgOf(b),
        budgetKRW: budget,
        takeProfitPercent: b.takeProfitPercent,
        stopLossPercent: b.stopLossPercent,
        active: b.active,
        mode: b.mode,
        lastSignalText: b.lastSignalText,
        lastSignalAt: b.lastSignalAt,
        createdAt: b.createdAt,
        updatedAt: b.updatedAt,
        blockedReason,
        openOrders: open.map((o) => ({ id: o.id, side: o.side, purpose: o.purpose, price: o.price, volume: o.volume, executedVolume: o.executedVolume, gridLevelId: o.gridLevelId, state: o.state })),
        strategyTitle: desc.title,
        strategyDescription: desc.description,
        targetRange: desc.range,
        stats: {
          currentPrice: price,
          positionQuantity: qty,
          averageEntryPrice: Number(pos.averageEntryPrice),
          totalCost: cost,
          realizedPnl: Math.round(realized),
          unrealizedPnl: Math.round(unrealized),
          unrealizedPnlPercent: cost > 0 ? (unrealized / cost) * 100 : 0,
          totalPnl: Math.round(total),
          totalPnlPercentOfBudget: budget > 0 ? (total / budget) * 100 : 0,
          todayTradesCount: today.get(b.id) ?? 0,
          openOrdersCount: open.length,
          usedBudgetKRW: Math.round(this.orders.usedBudget(b.id, b.marketCode).toNumber()),
        },
      } as BotDTO;
    });
  }
}
