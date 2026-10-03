import type { OrderPurpose, OrderState, TradingMode } from '../../shared/types';
import { ENGINE, STRATEGY_DEFAULTS } from '../config/strategyDefaults';
import type { BotRecord, OrderRecord, Repo } from '../db/repositories';
import { transaction } from '../db/database';
import { createIdentifier, parseIdentifier } from '../domain/identifier';
import { baseCurrency } from '../domain/market';
import { D, normalizePrice, normalizeVolume, toPlain, validateOrderAmount, volumeForBudget, type Decimal } from '../domain/orderMath';
import { isActive, isTerminal, mapUpbitState } from '../domain/orderState';
import { LiveExecutor } from '../execution/liveExecutor';
import { PaperExecutor } from '../execution/paperExecutor';
import type { Executor, FillInput } from '../execution/types';
import type { Bus } from '../lib/bus';
import { log } from '../lib/logger';
import { toFriendly, UpbitApiError } from '../upbit/errors';
import type { UpbitRestClient } from '../upbit/rest';
import type { UpbitCreateOrderBody, UpbitOrder, WsMyOrder } from '../upbit/types';
import type { AccountService } from './account';
import type { MarketDataService } from './marketData';
import type { MarketRulesService } from './marketRules';
import type { PositionService } from './positions';
import type { SystemService } from './system';

export interface SubmitRequest {
  bot: BotRecord;
  side: 'bid' | 'ask';
  purpose: OrderPurpose;
  kind: 'limit' | 'market';
  limitPrice?: number;
  krwAmount?: number;
  volume?: string | 'ALL';
  gridLevelId?: string | null;
  reason: string;
  signalId?: number | null;
  /** 꺼진 PAPER 봇의 가상 코인 정리용(LIVE에는 절대 적용되지 않음) */
  allowInactivePaper?: boolean;
}

export type SubmitResult = { ok: true; order: OrderRecord } | { ok: false; code: string; message: string };

const EXIT_PURPOSES: OrderPurpose[] = ['EXIT', 'TAKE_PROFIT', 'STOP_LOSS'];

function dedupeGroup(purpose: OrderPurpose): OrderPurpose[] {
  if (purpose === 'GRID_BUY' || purpose === 'GRID_SELL') return ['GRID_BUY', 'GRID_SELL'];
  if (EXIT_PURPOSES.includes(purpose)) return EXIT_PURPOSES;
  return [purpose];
}

const fail = (code: string, message: string): SubmitResult => ({ ok: false, code, message });
const won = (n: Decimal | number) => Math.round(Number(n)).toLocaleString('ko-KR');

/**
 * 주문 서비스 — 모든 주문은 여기서만 만들어진다.
 *   검증(긴급정지/봇 ON/LIVE 허용/마켓/중복/가격단위/수량/최소·최대 금액/예산/잔고)
 *   → identifier 부여 → 실행기(PAPER|LIVE) → 체결(Trade) 기록 → 포지션/손익 반영
 * 주문(Order)과 체결(Trade)은 분리해서 기록한다. 주문 성공 응답 ≠ 체결.
 */
export class OrderService {
  readonly paper: PaperExecutor;
  readonly live: LiveExecutor;
  private syncTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly repo: Repo,
    private readonly rest: UpbitRestClient,
    private readonly market: MarketDataService,
    private readonly rules: MarketRulesService,
    private readonly positions: PositionService,
    private readonly account: AccountService,
    private readonly system: SystemService,
    private readonly bus: Bus,
  ) {
    this.paper = new PaperExecutor({
      markPlaced: (id, patch) => this.transition(id, patch),
      recordPaperFill: (id, fill) => this.recordPaperFill(id, fill),
      markCancelled: (id) => this.markCancelledLocal(id),
      activePaperOrders: (m) => this.repo.listActiveOrders({ mode: 'PAPER' }).filter((o) => !m || o.marketCode === m),
      getPrice: (m) => this.market.getPrice(m),
      feeRate: () => STRATEGY_DEFAULTS.feeRateDefault,
    });
    this.live = new LiveExecutor(this.rest, {
      applyUpbitOrder: (id, u) => this.applyUpbitOrder(id, u),
      markRejected: (id, code, msg) => this.markRejected(id, code, msg),
      markUnknown: (id, msg) => void this.transition(id, { state: 'UNKNOWN', errorMessage: msg }),
      reconcileUnknown: (id) => this.reconcile(id),
      liveAllowed: () => this.liveGate(),
    });
    this.bus.onTyped('trade', (market, price) => this.paper.onTrade(market, price));
  }

  private executor(mode: TradingMode): Executor {
    return mode === 'LIVE' ? this.live : this.paper;
  }

  liveGate(): { ok: boolean; reason: string } {
    if (this.system.liveHardLock) return { ok: false, reason: '실전 매매가 잠겨 있어요(.env LIVE_TRADING_HARD_LOCK=true).' };
    if (!this.system.liveEnabled) return { ok: false, reason: '실전 매매(LIVE)가 허용되지 않았어요.' };
    if (!this.rest.hasCredentials()) return { ok: false, reason: 'API Key가 없어요.' };
    return { ok: true, reason: '' };
  }

  // ───────────────────────── 주문 생성 ─────────────────────────
  /** 봇별 주문 처리 락: 한 봇의 주문은 한 번에 하나씩만 검증·전송한다(중복 주문 경쟁 방지) */
  private inFlight = new Set<number>();

  async submit(req: SubmitRequest): Promise<SubmitResult> {
    const id = req.bot.id;
    if (this.inFlight.has(id)) return fail('IN_FLIGHT', '이 봇의 다른 주문을 처리 중이라 이번 주문은 건너뛰었어요.');
    this.inFlight.add(id);
    try {
      return await this.submitLocked(req);
    } finally {
      this.inFlight.delete(id);
    }
  }

  private async submitLocked(req: SubmitRequest): Promise<SubmitResult> {
    const bot = this.repo.getBot(req.bot.id);
    if (!bot) return fail('BOT_NOT_FOUND', '봇을 찾을 수 없어요.');

    // 1) 시스템/봇 상태
    if (this.system.emergencyStop) return fail('EMERGENCY_STOP', '긴급 정지 중이라 주문하지 않았어요.');
    const inactiveOk = req.allowInactivePaper === true && bot.mode === 'PAPER';
    if (!bot.active && !inactiveOk) return fail('BOT_OFF', '봇이 꺼져 있어 주문하지 않았어요.');
    if (bot.mode === 'LIVE') {
      const g = this.liveGate();
      if (!g.ok) return fail('LIVE_LOCKED', g.reason);
    }

    // 2) 마켓 검증
    const marketCode = bot.marketCode;
    const info = this.market.getMarket(marketCode);
    if (!info) return fail('MARKET_NOT_FOUND', '업비트에 없는 코인(마켓)이에요.');
    if (!marketCode.startsWith('KRW-')) return fail('UNSUPPORTED_MARKET', '현재는 원화(KRW) 마켓만 지원해요.');
    let rules;
    try {
      rules = await this.rules.get(marketCode, bot.mode);
    } catch (e) {
      return fail('RULES_UNAVAILABLE', toFriendly(e));
    }
    if (rules.state !== 'active') return fail('MARKET_INACTIVE', '현재 이 코인은 거래할 수 없는 상태입니다.');

    // 3) 중복 주문 방지 (같은 목적/같은 그리드 레벨의 활성 주문)
    const group = dedupeGroup(req.purpose);
    const dup = this.repo.findActiveOrder(bot.id, group, req.gridLevelId === undefined ? undefined : (req.gridLevelId ?? null));
    if (dup) return fail('DUPLICATE', `이미 같은 목적의 주문(${dup.identifier})이 진행 중이라 새로 주문하지 않았어요.`);

    const lastPrice = this.market.getPrice(marketCode);
    if (lastPrice == null) return fail('NO_PRICE', '현재가를 아직 받지 못해서 주문하지 않았어요.');

    // 4) 주문 형태 만들기 (가격 단위/수량 보정)
    const fee = req.side === 'bid' ? rules.bidFee : rules.askFee;
    let body: UpbitCreateOrderBody;
    let total: Decimal;
    let reserved = D(0);
    let price: string | null = null;
    let volume: string | null = null;

    if (req.side === 'bid') {
      const krw = D(req.krwAmount ?? 0);
      if (krw.lte(0)) return fail('INVALID_AMOUNT', '매수 금액이 올바르지 않아요.');
      if (req.kind === 'limit') {
        if (!rules.bidTypes.includes('limit')) return fail('ORDER_TYPE_UNSUPPORTED', '이 코인은 지정가 매수를 지원하지 않아요.');
        const px = normalizePrice(req.limitPrice ?? lastPrice, 'down', rules.tickOf);
        const vol = volumeForBudget(krw, px, fee);
        if (vol.lte(0)) return fail('INVALID_VOLUME', '주문 수량이 0이에요.');
        total = px.mul(vol);
        reserved = total.mul(1 + fee);
        price = toPlain(px);
        volume = toPlain(vol);
        body = { market: marketCode, side: 'bid', ord_type: 'limit', price, volume };
      } else {
        if (!rules.bidTypes.includes('price')) return fail('ORDER_TYPE_UNSUPPORTED', '이 코인은 시장가 매수를 지원하지 않아요.');
        total = krw.div(1 + fee).floor(); // 시장가 매수 총액(원 단위 내림). 수수료는 별도로 잠긴다.
        reserved = total.mul(1 + fee);
        price = toPlain(total);
        body = { market: marketCode, side: 'bid', ord_type: 'price', price };
      }
    } else {
      const pos = this.positions.get(bot.id, marketCode);
      let sellable = D(pos.quantity).minus(this.lockedSellVolume(bot.id));
      if (bot.mode === 'LIVE') {
        if (!this.account.hasData() || Date.now() - (this.account.lastUpdatedAt() ?? 0) > ENGINE.accountStaleMs) {
          await this.account.refresh().catch(() => {});
        }
        const avail = this.account.coinAvailable(baseCurrency(marketCode));
        if (avail == null) return fail('ACCOUNT_UNAVAILABLE', '잔고를 확인하지 못해 주문하지 않았어요.');
        if (D(avail).lt(sellable)) {
          log.warn('RISK', `bot#${bot.id} 봇 보유수량(${sellable.toFixed()})보다 실제 주문가능 수량(${avail})이 적음 → 실제 수량으로 제한`);
          sellable = D(avail);
        }
      }
      const want = req.volume === undefined || req.volume === 'ALL' ? sellable : D(req.volume);
      const vol = normalizeVolume(want.gt(sellable) ? sellable : want);
      if (vol.lte(0)) return fail('NOTHING_TO_SELL', '팔 수 있는 코인이 없어요.');
      volume = toPlain(vol);
      if (req.kind === 'limit') {
        if (!rules.askTypes.includes('limit')) return fail('ORDER_TYPE_UNSUPPORTED', '이 코인은 지정가 매도를 지원하지 않아요.');
        const px = normalizePrice(req.limitPrice ?? lastPrice, 'up', rules.tickOf);
        total = px.mul(vol);
        price = toPlain(px);
        body = { market: marketCode, side: 'ask', ord_type: 'limit', price, volume };
      } else {
        if (!rules.askTypes.includes('market')) return fail('ORDER_TYPE_UNSUPPORTED', '이 코인은 시장가 매도를 지원하지 않아요.');
        total = D(lastPrice).mul(vol);
        body = { market: marketCode, side: 'ask', ord_type: 'market', volume };
      }
    }

    // 5) 최소/최대 주문 금액
    // (모의 코인 정리는 가상 거래라 최소 주문 금액 예외 — 소액 잔량도 정리할 수 있게)
    const minTotal = inactiveOk && req.side === 'ask' ? 0.00000001 : req.side === 'bid' ? rules.minTotalBid : rules.minTotalAsk;
    const amt = validateOrderAmount(total, { minTotal, maxTotal: rules.maxTotal });
    if (!amt.ok) return fail(amt.code ?? 'INVALID_AMOUNT', amt.message ?? '주문 금액이 올바르지 않아요.');

    // 6) 봇 예산 + 7) 계좌 잔고 (매수만)
    if (req.side === 'bid') {
      const used = this.usedBudget(bot.id, marketCode);
      const budget = D(bot.budgetKRW);
      if (used.plus(reserved).gt(budget)) {
        return fail('BUDGET_EXCEEDED', `봇 예산(${won(budget)}원)을 넘어서 주문하지 않았어요. 사용 중 ${won(used)}원, 이번 주문 ${won(reserved)}원`);
      }
      if (bot.mode === 'PAPER') {
        const avail = D(this.account.paperKrw()).minus(this.reservedPaperKrw());
        if (avail.lt(reserved)) return fail('INSUFFICIENT_KRW', `모의투자 원화가 부족합니다. (사용 가능 ${won(avail)}원)`);
      } else {
        if (!this.account.hasData() || Date.now() - (this.account.lastUpdatedAt() ?? 0) > ENGINE.accountStaleMs) {
          await this.account.refresh().catch(() => {});
        }
        const krw = this.account.krwAvailable();
        if (krw == null) return fail('ACCOUNT_UNAVAILABLE', '잔고를 확인하지 못해 주문하지 않았어요.');
        if (D(krw).lt(reserved)) return fail('INSUFFICIENT_KRW', '매수할 원화가 부족합니다.');
      }
    }

    // 8) 비동기 대기(잔고 조회 등) 사이에 상태가 바뀌었을 수 있으므로 기록 직전에 한 번 더 확인
    if (this.system.emergencyStop) return fail('EMERGENCY_STOP', '긴급 정지 중이라 주문하지 않았어요.');
    if (!this.repo.getBot(bot.id)?.active && !inactiveOk) return fail('BOT_OFF', '봇이 꺼져 있어 주문하지 않았어요.');
    const dup2 = this.repo.findActiveOrder(bot.id, group, req.gridLevelId === undefined ? undefined : (req.gridLevelId ?? null));
    if (dup2) return fail('DUPLICATE', `이미 같은 목적의 주문(${dup2.identifier})이 진행 중이라 새로 주문하지 않았어요.`);

    // 9) 주문 기록 → 실행
    const identifier = createIdentifier(bot.id, bot.mode === 'PAPER');
    body.identifier = identifier;
    const order = this.repo.insertOrder({
      botId: bot.id,
      identifier,
      upbitUuid: null,
      marketCode,
      side: req.side,
      ordType: body.ord_type,
      price,
      volume,
      executedVolume: '0',
      remainingVolume: volume,
      averagePrice: null,
      executedFunds: '0',
      paidFee: '0',
      reservedKrw: toPlain(reserved.toDecimalPlaces(8)),
      state: 'REQUESTED',
      upbitState: null,
      purpose: req.purpose,
      gridLevelId: req.gridLevelId ?? null,
      reason: req.reason,
      strategySignalId: req.signalId ?? null,
      mode: bot.mode,
      errorCode: null,
      errorMessage: null,
    });
    log.info(
      'ORDER',
      `${bot.mode} ${marketCode} ${req.side === 'bid' ? 'BUY' : 'SELL'} ${body.ord_type} price=${price ?? '-'} volume=${volume ?? '-'} purpose=${req.purpose}${req.gridLevelId ? `/${req.gridLevelId}` : ''} identifier=${identifier}`,
    );
    this.bus.emitTyped('changed');
    try {
      await this.executor(bot.mode).place(order, body);
    } catch (e) {
      this.markRejected(order.id, 'EXECUTOR_ERROR', toFriendly(e));
    }
    const after = this.repo.getOrder(order.id)!;
    if (after.state === 'REJECTED') return fail(after.errorCode ?? 'REJECTED', after.errorMessage ?? '주문이 거절됐어요.');
    return { ok: true, order: after };
  }

  /** 이 봇이 쓰고 있는 예산 = 포지션 원가 + 미체결 매수 주문이 잡고 있는 금액 */
  usedBudget(botId: number, marketCode: string): Decimal {
    const pos = this.positions.get(botId, marketCode);
    let used = D(pos.totalCost);
    for (const o of this.repo.listActiveOrders({ botId })) if (o.side === 'bid') used = used.plus(this.remainingReserved(o));
    return used;
  }

  private remainingReserved(o: OrderRecord): Decimal {
    const reserved = D(o.reservedKrw || 0);
    if (o.ordType === 'price') return D(o.executedVolume).gt(0) ? D(0) : reserved;
    const vol = D(o.volume ?? 0);
    if (vol.lte(0)) return reserved;
    return reserved.mul(D(o.remainingVolume ?? o.volume ?? 0).div(vol));
  }

  private reservedPaperKrw(): Decimal {
    let r = D(0);
    for (const o of this.repo.listActiveOrders({ mode: 'PAPER' })) if (o.side === 'bid') r = r.plus(this.remainingReserved(o));
    return r;
  }

  /** 이 봇의 활성 매도 주문이 잡고 있는 수량 */
  private lockedSellVolume(botId: number): Decimal {
    let v = D(0);
    for (const o of this.repo.listActiveOrders({ botId })) if (o.side === 'ask') v = v.plus(D(o.remainingVolume ?? o.volume ?? 0));
    return v;
  }

  // ───────────────────────── 상태 반영 ─────────────────────────
  /** 주문 상태 갱신 + 변화량 계산 + 이벤트 */
  transition(orderId: number, patch: Partial<OrderRecord>): OrderRecord {
    const before = this.repo.getOrder(orderId)!;
    const after = this.repo.updateOrder(orderId, patch);
    const delta = D(after.executedVolume).minus(before.executedVolume);
    const deltaFunds = D(after.executedFunds).minus(before.executedFunds);
    const deltaAvg = delta.gt(0) ? deltaFunds.div(delta).toNumber() : 0;
    const becameTerminal = !isTerminal(before.state) && isTerminal(after.state);
    if (before.state !== after.state || delta.gt(0)) {
      this.bus.emitTyped('orderUpdated', after, delta.toNumber(), deltaAvg, becameTerminal);
      this.bus.emitTyped('changed');
    }
    if (becameTerminal) {
      const tag = after.state === 'FILLED' ? 'ORDER_FILLED' : after.state === 'REJECTED' ? 'ORDER' : 'ORDER_CANCEL';
      log.info(tag, `${after.marketCode} ${after.identifier} → ${after.state} executedVolume=${after.executedVolume}${after.averagePrice ? ` avg=${after.averagePrice}` : ''}`);
    }
    return after;
  }

  markRejected(orderId: number, code: string, message: string): void {
    this.transition(orderId, { state: 'REJECTED', errorCode: code, errorMessage: message });
  }

  private markCancelledLocal(orderId: number): void {
    const o = this.repo.getOrder(orderId);
    if (!o || isTerminal(o.state)) return;
    this.transition(orderId, { state: D(o.executedVolume).gt(0) ? 'PARTIALLY_FILLED_CANCELLED' : 'CANCELLED', upbitState: 'cancel' });
  }

  /** 체결 1건 기록(Trade) + 포지션 반영. 업비트 체결 uuid 중복이면 무시 */
  private recordTrade(o: OrderRecord, fill: FillInput): boolean {
    if (o.botId == null) return false;
    const botId = o.botId;
    // 같은 체결을 두 번 반영하지 않도록 포지션을 건드리기 전에 확인
    if (this.tradeExists(fill.tradeUuid)) {
      log.warn('ORDER_FILLED', `중복 체결 무시 ${fill.tradeUuid}`);
      return false;
    }
    // 포지션 · 체결 기록 · 모의 잔고를 하나의 트랜잭션으로(중간 실패 시 모두 취소)
    const result = transaction(this.repo.db, () => {
      const eff = this.positions.apply(botId, o.marketCode, o.side, fill.price, fill.volume, fill.fee);
      const trade = this.repo.insertTrade({
        botId,
        orderId: o.id,
        upbitTradeUuid: fill.tradeUuid,
        marketCode: o.marketCode,
        side: o.side,
        price: fill.price,
        volume: fill.volume,
        funds: toPlain(D(fill.price).mul(fill.volume)),
        fee: fill.fee,
        realizedPnl: eff.realized,
        costBasis: eff.costBasis,
        mode: o.mode,
        timestamp: fill.timestamp,
      });
      if (!trade) throw new Error(`duplicate trade ${fill.tradeUuid}`);
      if (o.mode === 'PAPER') {
        const funds = D(fill.price).mul(fill.volume);
        this.account.adjustPaperKrw(o.side === 'bid' ? funds.plus(fill.fee).neg().toFixed() : funds.minus(fill.fee).toFixed());
      }
      return { trade, closed: eff.closed };
    });
    log.info('ORDER_FILLED', `${o.mode} ${o.marketCode} ${o.side === 'bid' ? 'BUY' : 'SELL'} ${fill.volume} @ ${fill.price} fee=${fill.fee} identifier=${o.identifier}`);
    this.bus.emitTyped('tradeRecorded', result.trade);
    this.bus.emitTyped('activity');
    if (result.closed) this.bus.emitTyped('positionClosed', botId);
    return true;
  }

  private tradeExists(uuid: string | null): boolean {
    if (!uuid) return false;
    return this.repo.db.prepare('SELECT 1 FROM trades WHERE upbit_trade_uuid = ?').get(uuid) != null;
  }

  private recordPaperFill(orderId: number, fill: FillInput): void {
    const o = this.repo.getOrder(orderId);
    if (!o || isTerminal(o.state)) return;
    if (!this.recordTrade(o, fill)) return;
    const executed = D(o.executedVolume).plus(fill.volume);
    const funds = D(o.executedFunds).plus(D(fill.price).mul(fill.volume));
    const paidFee = D(o.paidFee).plus(fill.fee);
    const remaining = o.ordType === 'price' ? D(0) : D(o.volume ?? 0).minus(executed);
    const state: OrderState = remaining.lte(0) ? 'FILLED' : 'PARTIALLY_FILLED';
    this.transition(orderId, {
      executedVolume: toPlain(executed),
      executedFunds: toPlain(funds),
      paidFee: toPlain(paidFee),
      averagePrice: toPlain(funds.div(executed).toDecimalPlaces(8)),
      remainingVolume: toPlain(remaining.lt(0) ? 0 : remaining),
      state,
      upbitState: state === 'FILLED' ? 'done' : 'wait',
    });
  }

  /** LIVE: 업비트 주문 응답/조회 결과를 반영. 누락된 체결은 trades 목록으로 보충 */
  async applyUpbitOrder(orderId: number, u: UpbitOrder): Promise<void> {
    const o = this.repo.getOrder(orderId);
    if (!o) return;
    const recordedVol = this.repo.tradesForOrder(o.id).reduce((a, t) => a.plus(t.volume), D(0));
    const executed = D(u.executed_volume || 0);
    if (executed.gt(recordedVol)) {
      let trades = u.trades;
      if (!trades || !trades.length) {
        try {
          trades = (await this.rest.getOrder({ uuid: u.uuid })).trades ?? [];
        } catch (e) {
          log.warn('ORDER_FILLED', `체결 목록 조회 실패 ${o.identifier}: ${(e as Error).message}`);
          trades = [];
        }
      }
      const missing = (trades ?? []).filter((t) => !this.tradeExists(t.uuid));
      const recordedFee = this.repo.tradesForOrder(o.id).reduce((a, t) => a.plus(t.fee), D(0));
      const feeLeft = D(u.paid_fee || 0).minus(recordedFee);
      const missingFunds = missing.reduce((a, t) => a.plus(t.funds || D(t.price).mul(t.volume)), D(0));
      for (const t of missing) {
        const funds = D(t.funds || D(t.price).mul(t.volume));
        const fee = missingFunds.gt(0) && feeLeft.gt(0) ? feeLeft.mul(funds.div(missingFunds)) : D(0);
        this.recordTrade(this.repo.getOrder(o.id)!, {
          price: String(t.price),
          volume: String(t.volume),
          fee: toPlain(fee.toDecimalPlaces(8)),
          tradeUuid: t.uuid,
          timestamp: t.created_at ? new Date(t.created_at).toISOString() : new Date().toISOString(),
        });
      }
    }
    this.applyAggregates(o.id, { uuid: u.uuid, upbitState: u.state, executed, remaining: u.remaining_volume ?? null, paidFee: u.paid_fee ?? null });
  }

  /**
   * 업비트 주문 집계를 반영하되, 체결 기록(Trade)이 다 모이지 않았으면 기록된 만큼만 체결로 인정한다.
   * → 포지션(손절/익절 대상 수량)과 주문 상태가 어긋나지 않고, 주기 동기화가 누락분을 다시 채운다.
   */
  private applyAggregates(orderId: number, src: { uuid: string; upbitState: string; executed: Decimal; remaining: string | null; paidFee: string | null }): void {
    const o = this.repo.getOrder(orderId);
    if (!o) return;
    const trades = this.repo.tradesForOrder(orderId);
    const recorded = trades.reduce((a, t) => a.plus(t.volume), D(0));
    const funds = trades.reduce((a, t) => a.plus(t.funds), D(0));
    // 봇이 없는 주문(삭제된 봇의 주문)은 포지션에 반영하지 않으므로 체결 기록을 기다리지 않는다
    const complete = o.botId == null || recorded.gte(src.executed);
    const executedUsed = complete ? src.executed : recorded;
    let state = mapUpbitState(src.upbitState, toPlain(src.executed), src.remaining);
    if (!complete) {
      if (isTerminal(state) || state === 'OPEN') state = recorded.gt(0) ? 'PARTIALLY_FILLED' : 'UNKNOWN';
      log.warn('ORDER_FILLED', `${o.identifier} 체결 ${src.executed.toFixed()} 중 ${recorded.toFixed()}만 기록됨 → 다음 동기화에서 보충`);
    }
    this.transition(orderId, {
      upbitUuid: src.uuid,
      upbitState: complete ? src.upbitState : 'pending_trades',
      state,
      executedVolume: toPlain(executedUsed),
      remainingVolume: src.remaining ?? o.remainingVolume,
      paidFee: src.paidFee ?? o.paidFee,
      executedFunds: toPlain(funds),
      averagePrice: executedUsed.gt(0) ? toPlain(funds.div(executedUsed).toDecimalPlaces(8)) : null,
    });
  }

  /** LIVE: Private WS myOrder 이벤트 */
  async handleMyOrder(m: WsMyOrder): Promise<void> {
    let o = this.repo.getOrderByUuid(m.uuid) ?? (m.identifier ? this.repo.getOrderByIdentifier(m.identifier) : null);
    if (!o) {
      const parsed = parseIdentifier(m.identifier);
      if (!parsed || parsed.paper) return; // 사용자가 직접 낸 주문 등 봇 주문이 아님 → 무시
      // 우리가 만든 주문인데 DB에 아직 없음(응답 유실 등) → 조회 후 반영
      log.warn('ORDER', `DB에 없는 봇 주문 이벤트 수신 ${m.identifier} → 조회해서 반영`);
      try {
        const u = await this.rest.getOrder({ uuid: m.uuid });
        o = this.adoptOrphan(u);
        if (o) await this.applyUpbitOrder(o.id, u);
      } catch (e) {
        log.error('ORDER', `봇 주문 조회 실패 ${m.identifier}: ${(e as Error).message}`);
      }
      return;
    }
    if (m.state === 'trade' && m.trade_uuid && !this.tradeExists(m.trade_uuid)) {
      this.recordTrade(o, {
        price: String(m.price ?? 0),
        volume: String(m.volume ?? 0),
        fee: String(m.trade_fee ?? 0),
        tradeUuid: m.trade_uuid,
        timestamp: new Date(m.trade_timestamp ?? m.timestamp).toISOString(),
      });
    }
    const fresh = this.repo.getOrder(o.id)!;
    const executed = D(m.executed_volume ?? fresh.executedVolume);
    const upbitState = m.state === 'trade' ? (D(m.remaining_volume ?? 0).gt(0) ? 'wait' : 'done') : m.state;
    const recorded = this.repo.tradesForOrder(o.id).reduce((a, t) => a.plus(t.volume), D(0));
    if (executed.gt(recorded)) {
      // 기록 안 된 체결이 있으면 REST로 체결 목록을 받아 보충(실패하면 기록된 만큼만 반영 후 동기화에서 재시도)
      try {
        await this.applyUpbitOrder(o.id, await this.rest.getOrder({ uuid: m.uuid }));
        return;
      } catch {
        /* 아래에서 기록된 만큼만 반영 */
      }
    }
    this.applyAggregates(o.id, {
      uuid: m.uuid,
      upbitState,
      executed,
      remaining: m.remaining_volume != null ? String(m.remaining_volume) : fresh.remainingVolume,
      paidFee: m.paid_fee != null ? String(m.paid_fee) : fresh.paidFee,
    });
  }

  /** identifier가 봇 형식인데 DB에 없는 업비트 주문을 DB에 등록 */
  adoptOrphan(u: UpbitOrder): OrderRecord | null {
    const parsed = parseIdentifier(u.identifier);
    if (!parsed || parsed.paper || !u.identifier) return null;
    const bot = this.repo.getBot(parsed.botId);
    const existing = this.repo.getOrderByIdentifier(u.identifier);
    if (existing) return existing;
    const o = this.repo.insertOrder({
      botId: bot ? bot.id : null,
      identifier: u.identifier,
      upbitUuid: u.uuid,
      marketCode: u.market,
      side: u.side,
      ordType: u.ord_type,
      price: u.price ?? null,
      volume: u.volume ?? null,
      executedVolume: '0',
      remainingVolume: u.remaining_volume ?? null,
      averagePrice: null,
      executedFunds: '0',
      paidFee: '0',
      reservedKrw: u.side === 'bid' ? u.locked : '0',
      state: 'UNKNOWN',
      upbitState: u.state,
      purpose: 'MANUAL',
      gridLevelId: null,
      reason: '재시작/복구 중 발견된 봇 주문',
      strategySignalId: null,
      mode: 'LIVE',
      errorCode: null,
      errorMessage: null,
    });
    log.warn('ORDER', `복구: 봇 주문 ${u.identifier} 를 DB에 등록`);
    return o;
  }

  /** UNKNOWN/REQUESTED 주문의 실제 상태 확인 */
  async reconcile(orderId: number): Promise<void> {
    const o = this.repo.getOrder(orderId);
    if (!o || o.mode !== 'LIVE' || isTerminal(o.state)) return;
    try {
      const u = await this.rest.getOrder(o.upbitUuid ? { uuid: o.upbitUuid } : { identifier: o.identifier });
      await this.applyUpbitOrder(o.id, u);
    } catch (e) {
      if (e instanceof UpbitApiError && e.code === 'order_not_found') {
        // 업비트에 주문이 없음 = 생성되지 않았음
        this.markRejected(o.id, 'NOT_CREATED', '주문이 업비트에 생성되지 않았어요.');
      } else {
        log.warn('ORDER', `주문 상태 확인 실패 ${o.identifier}: ${(e as Error).message} (다음 동기화 때 재시도)`);
      }
    }
  }

  // ───────────────────────── 취소 ─────────────────────────
  async cancel(orderId: number): Promise<void> {
    const o = this.repo.getOrder(orderId);
    if (!o || isTerminal(o.state)) return;
    if (o.mode === 'LIVE' && (o.state === 'REQUESTED' || o.state === 'UNKNOWN')) {
      await this.reconcile(o.id);
      const r = this.repo.getOrder(o.id)!;
      if (isTerminal(r.state)) return;
    }
    await this.executor(o.mode).cancel(this.repo.getOrder(o.id)!);
  }

  /** 이 봇이 만든 미체결 주문만 취소(다른 봇/사용자 주문은 건드리지 않음). 보유 코인은 팔지 않는다. */
  async cancelBotOrders(botId: number, why: string): Promise<{ requested: number; failed: number }> {
    const orders = this.repo.listActiveOrders({ botId }).filter((o) => parseIdentifier(o.identifier)?.botId === botId);
    let failed = 0;
    for (const o of orders) {
      try {
        await this.cancel(o.id);
      } catch {
        failed++;
      }
    }
    if (orders.length) log.info('ORDER_CANCEL', `bot#${botId} 미체결 주문 ${orders.length}건 취소 요청 (${why})${failed ? `, 실패 ${failed}건` : ''}`);
    return { requested: orders.length, failed };
  }

  /** LIVE 취소 요청 후 종료 상태가 될 때까지 잠시 확인(최대 timeoutMs) */
  async waitBotOrdersClosed(botId: number, timeoutMs = 4000): Promise<boolean> {
    const until = Date.now() + timeoutMs;
    for (;;) {
      const active = this.repo.listActiveOrders({ botId });
      if (!active.length) return true;
      if (Date.now() > until) return false;
      await new Promise((r) => setTimeout(r, 700));
      for (const o of active) if (o.mode === 'LIVE') await this.reconcile(o.id);
    }
  }

  // ───────────────────────── LIVE 주기 동기화 ─────────────────────────
  startSync(): void {
    if (this.syncTimer) return;
    this.syncTimer = setInterval(() => void this.syncLive(), ENGINE.liveOrderSyncMs);
  }

  stopSync(): void {
    if (this.syncTimer) clearInterval(this.syncTimer);
    this.syncTimer = null;
  }

  /** myOrder 유실 대비: 활성 LIVE 주문을 REST로 확인 */
  async syncLive(): Promise<void> {
    if (!this.rest.hasCredentials()) return;
    const active = this.repo.listActiveOrders({ mode: 'LIVE' });
    if (!active.length) return;
    const withUuid = active.filter((o) => o.upbitUuid);
    for (let i = 0; i < withUuid.length; i += 20) {
      const chunk = withUuid.slice(i, i + 20);
      try {
        const list = await this.rest.getOrdersByIds({ uuids: chunk.map((o) => o.upbitUuid!) });
        for (const u of list) {
          const o = this.repo.getOrderByUuid(u.uuid);
          if (!o) continue;
          const changed = u.state !== o.upbitState || !D(u.executed_volume).eq(o.executedVolume);
          if (changed) await this.applyUpbitOrder(o.id, u);
        }
      } catch (e) {
        log.warn('ORDER', `LIVE 주문 동기화 실패: ${(e as Error).message}`);
      }
    }
    for (const o of active.filter((x) => !x.upbitUuid)) await this.reconcile(o.id);
  }

  isActiveOrder(o: OrderRecord): boolean {
    return isActive(o.state);
  }
}
