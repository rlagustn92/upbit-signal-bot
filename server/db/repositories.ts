import type {
  OrderPurpose,
  OrderSide,
  OrderState,
  OrderType,
  SignalType,
  StrategyConfig,
  StrategyKind,
  TradingMode,
} from '../../shared/types';
import type { DB } from './database';

/** 모든 SQL은 이 파일에만 둔다(DB 교체 용이). */

export interface BotRecord {
  id: number;
  name: string;
  displayName: string;
  marketCode: string;
  displaySymbol: string;
  coinName: string;
  strategy: StrategyKind;
  strategyConfig: StrategyConfig;
  strategyState: Record<string, unknown>;
  budgetKRW: string;
  takeProfitPercent: number;
  stopLossPercent: number;
  active: boolean;
  mode: TradingMode;
  lastSignalText: string | null;
  lastSignalAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OrderRecord {
  id: number;
  botId: number | null;
  identifier: string;
  upbitUuid: string | null;
  marketCode: string;
  side: OrderSide;
  ordType: OrderType;
  price: string | null;
  volume: string | null;
  executedVolume: string;
  remainingVolume: string | null;
  averagePrice: string | null;
  executedFunds: string;
  paidFee: string;
  /** 매수 주문이 잠그고 있는 예상 KRW(예산 계산용) */
  reservedKrw: string;
  state: OrderState;
  upbitState: string | null;
  purpose: OrderPurpose;
  gridLevelId: string | null;
  reason: string | null;
  strategySignalId: number | null;
  mode: TradingMode;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TradeRecord {
  id: number;
  botId: number | null;
  orderId: number;
  upbitTradeUuid: string | null;
  marketCode: string;
  side: OrderSide;
  price: string;
  volume: string;
  funds: string;
  fee: string;
  realizedPnl: string | null;
  costBasis: string | null;
  mode: TradingMode;
  timestamp: string;
}

export interface SignalRecord {
  id: number;
  botId: number;
  marketCode: string;
  strategy: StrategyKind;
  signalType: SignalType;
  signalValue: string | null;
  reason: string;
  outcome: string | null;
  orderId: number | null;
  timestamp: string;
}

export interface PositionRecord {
  botId: number;
  marketCode: string;
  quantity: string;
  averageEntryPrice: string;
  totalCost: string;
  realizedPnl: string;
  updatedAt: string;
}

export interface CredentialRecord {
  id: number;
  accessKey: string;
  secretKeyEnc: string;
  iv: string;
  tag: string;
  createdAt: string;
}

type Row = Record<string, unknown>;
const nowIso = () => new Date().toISOString();

const s = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));

function toBot(r: Row): BotRecord {
  return {
    id: Number(r.id),
    name: String(r.name),
    displayName: String(r.display_name),
    marketCode: String(r.market_code),
    displaySymbol: String(r.display_symbol),
    coinName: String(r.coin_name),
    strategy: r.strategy as StrategyKind,
    strategyConfig: JSON.parse(String(r.strategy_config)),
    strategyState: JSON.parse(String(r.strategy_state || '{}')),
    budgetKRW: String(r.budget_krw),
    takeProfitPercent: Number(r.take_profit_percent),
    stopLossPercent: Number(r.stop_loss_percent),
    active: Number(r.active) === 1,
    mode: r.mode as TradingMode,
    lastSignalText: s(r.last_signal_text),
    lastSignalAt: s(r.last_signal_at),
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  };
}

function toOrder(r: Row): OrderRecord {
  return {
    id: Number(r.id),
    botId: r.bot_id == null ? null : Number(r.bot_id),
    identifier: String(r.identifier),
    upbitUuid: s(r.upbit_uuid),
    marketCode: String(r.market_code),
    side: r.side as OrderSide,
    ordType: r.ord_type as OrderType,
    price: s(r.price),
    volume: s(r.volume),
    executedVolume: String(r.executed_volume),
    remainingVolume: s(r.remaining_volume),
    averagePrice: s(r.average_price),
    executedFunds: String(r.executed_funds),
    paidFee: String(r.paid_fee),
    reservedKrw: String(r.reserved_krw),
    state: r.state as OrderState,
    upbitState: s(r.upbit_state),
    purpose: r.purpose as OrderPurpose,
    gridLevelId: s(r.grid_level_id),
    reason: s(r.reason),
    strategySignalId: r.strategy_signal_id == null ? null : Number(r.strategy_signal_id),
    mode: r.mode as TradingMode,
    errorCode: s(r.error_code),
    errorMessage: s(r.error_message),
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  };
}

function toTrade(r: Row): TradeRecord {
  return {
    id: Number(r.id),
    botId: r.bot_id == null ? null : Number(r.bot_id),
    orderId: Number(r.order_id),
    upbitTradeUuid: s(r.upbit_trade_uuid),
    marketCode: String(r.market_code),
    side: r.side as OrderSide,
    price: String(r.price),
    volume: String(r.volume),
    funds: String(r.funds),
    fee: String(r.fee),
    realizedPnl: s(r.realized_pnl),
    costBasis: s(r.cost_basis),
    mode: r.mode as TradingMode,
    timestamp: String(r.timestamp),
  };
}

function toSignal(r: Row): SignalRecord {
  return {
    id: Number(r.id),
    botId: Number(r.bot_id),
    marketCode: String(r.market_code),
    strategy: r.strategy as StrategyKind,
    signalType: r.signal_type as SignalType,
    signalValue: s(r.signal_value),
    reason: String(r.reason),
    outcome: s(r.outcome),
    orderId: r.order_id == null ? null : Number(r.order_id),
    timestamp: String(r.timestamp),
  };
}

function toPosition(r: Row): PositionRecord {
  return {
    botId: Number(r.bot_id),
    marketCode: String(r.market_code),
    quantity: String(r.quantity),
    averageEntryPrice: String(r.average_entry_price),
    totalCost: String(r.total_cost),
    realizedPnl: String(r.realized_pnl),
    updatedAt: String(r.updated_at),
  };
}

const ORDER_COLS: Record<keyof Omit<OrderRecord, 'id' | 'createdAt'>, string> = {
  botId: 'bot_id',
  identifier: 'identifier',
  upbitUuid: 'upbit_uuid',
  marketCode: 'market_code',
  side: 'side',
  ordType: 'ord_type',
  price: 'price',
  volume: 'volume',
  executedVolume: 'executed_volume',
  remainingVolume: 'remaining_volume',
  averagePrice: 'average_price',
  executedFunds: 'executed_funds',
  paidFee: 'paid_fee',
  reservedKrw: 'reserved_krw',
  state: 'state',
  upbitState: 'upbit_state',
  purpose: 'purpose',
  gridLevelId: 'grid_level_id',
  reason: 'reason',
  strategySignalId: 'strategy_signal_id',
  mode: 'mode',
  errorCode: 'error_code',
  errorMessage: 'error_message',
  updatedAt: 'updated_at',
};

const ACTIVE_STATES = `('REQUESTED','OPEN','WATCH','PARTIALLY_FILLED','UNKNOWN')`;

type SqlParam = string | number | null;

export class Repo {
  constructor(readonly db: DB) {}

  // ───────── bots ─────────
  insertBot(b: Omit<BotRecord, 'id' | 'createdAt' | 'updatedAt' | 'lastSignalText' | 'lastSignalAt'>): BotRecord {
    const t = nowIso();
    const r = this.db
      .prepare(
        `INSERT INTO bots (name, display_name, market_code, display_symbol, coin_name, strategy, strategy_config, strategy_state,
          budget_krw, take_profit_percent, stop_loss_percent, active, mode, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        b.name,
        b.displayName,
        b.marketCode,
        b.displaySymbol,
        b.coinName,
        b.strategy,
        JSON.stringify(b.strategyConfig),
        JSON.stringify(b.strategyState ?? {}),
        b.budgetKRW,
        b.takeProfitPercent,
        b.stopLossPercent,
        b.active ? 1 : 0,
        b.mode,
        t,
        t,
      );
    return this.getBot(Number(r.lastInsertRowid))!;
  }

  getBot(id: number): BotRecord | null {
    const r = this.db.prepare('SELECT * FROM bots WHERE id = ? AND deleted_at IS NULL').get(id) as Row | undefined;
    return r ? toBot(r) : null;
  }

  /** 삭제된 봇 포함(과거 체결 기록 표시용) */
  getBotAny(id: number): BotRecord | null {
    const r = this.db.prepare('SELECT * FROM bots WHERE id = ?').get(id) as Row | undefined;
    return r ? toBot(r) : null;
  }

  listBots(): BotRecord[] {
    return (this.db.prepare('SELECT * FROM bots WHERE deleted_at IS NULL ORDER BY id DESC').all() as Row[]).map(toBot);
  }

  updateBot(id: number, patch: Partial<Pick<BotRecord, 'name' | 'displayName' | 'budgetKRW' | 'takeProfitPercent' | 'stopLossPercent' | 'strategyConfig' | 'active' | 'mode'>>): void {
    const sets: string[] = [];
    const vals: SqlParam[] = [];
    const map: Record<string, [string, (v: unknown) => SqlParam]> = {
      name: ['name', (v) => String(v)],
      displayName: ['display_name', (v) => String(v)],
      budgetKRW: ['budget_krw', (v) => String(v)],
      takeProfitPercent: ['take_profit_percent', (v) => Number(v)],
      stopLossPercent: ['stop_loss_percent', (v) => Number(v)],
      strategyConfig: ['strategy_config', (v) => JSON.stringify(v)],
      active: ['active', (v) => (v ? 1 : 0)],
      mode: ['mode', (v) => String(v)],
    };
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined || !map[k]) continue;
      sets.push(`${map[k][0]} = ?`);
      vals.push(map[k][1](v));
    }
    if (!sets.length) return;
    sets.push('updated_at = ?');
    vals.push(nowIso(), id);
    this.db.prepare(`UPDATE bots SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  }

  setAllBotsInactive(): number {
    const r = this.db.prepare(`UPDATE bots SET active = 0, updated_at = ? WHERE active = 1 AND deleted_at IS NULL`).run(nowIso());
    return Number(r.changes);
  }

  saveStrategyState(id: number, state: Record<string, unknown>): void {
    this.db.prepare('UPDATE bots SET strategy_state = ? WHERE id = ?').run(JSON.stringify(state), id);
  }

  setLastSignal(id: number, text: string, at = nowIso()): void {
    this.db.prepare('UPDATE bots SET last_signal_text = ?, last_signal_at = ? WHERE id = ?').run(text, at, id);
  }

  softDeleteBot(id: number): void {
    this.db.prepare('UPDATE bots SET deleted_at = ?, active = 0 WHERE id = ?').run(nowIso(), id);
  }

  // ───────── orders ─────────
  insertOrder(o: Omit<OrderRecord, 'id' | 'createdAt' | 'updatedAt'>): OrderRecord {
    const t = nowIso();
    const cols = Object.keys(ORDER_COLS).filter((k) => k !== 'updatedAt') as Array<keyof typeof ORDER_COLS>;
    const sql = `INSERT INTO orders (${cols.map((c) => ORDER_COLS[c]).join(', ')}, created_at, updated_at)
      VALUES (${cols.map(() => '?').join(', ')}, ?, ?)`;
    const vals = cols.map((c) => (o as unknown as Record<string, SqlParam>)[c] ?? null);
    const r = this.db.prepare(sql).run(...vals, t, t);
    return this.getOrder(Number(r.lastInsertRowid))!;
  }

  updateOrder(id: number, patch: Partial<Omit<OrderRecord, 'id' | 'createdAt' | 'updatedAt'>>): OrderRecord {
    const sets: string[] = [];
    const vals: SqlParam[] = [];
    for (const [k, v] of Object.entries(patch)) {
      const col = ORDER_COLS[k as keyof typeof ORDER_COLS];
      if (!col || v === undefined) continue;
      sets.push(`${col} = ?`);
      vals.push(v as SqlParam);
    }
    sets.push('updated_at = ?');
    vals.push(nowIso(), id);
    this.db.prepare(`UPDATE orders SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
    return this.getOrder(id)!;
  }

  getOrder(id: number): OrderRecord | null {
    const r = this.db.prepare('SELECT * FROM orders WHERE id = ?').get(id) as Row | undefined;
    return r ? toOrder(r) : null;
  }

  getOrderByIdentifier(identifier: string): OrderRecord | null {
    const r = this.db.prepare('SELECT * FROM orders WHERE identifier = ?').get(identifier) as Row | undefined;
    return r ? toOrder(r) : null;
  }

  getOrderByUuid(uuid: string): OrderRecord | null {
    const r = this.db.prepare('SELECT * FROM orders WHERE upbit_uuid = ?').get(uuid) as Row | undefined;
    return r ? toOrder(r) : null;
  }

  listActiveOrders(filter: { botId?: number; mode?: TradingMode } = {}): OrderRecord[] {
    const where = [`state IN ${ACTIVE_STATES}`];
    const vals: SqlParam[] = [];
    if (filter.botId !== undefined) {
      where.push('bot_id = ?');
      vals.push(filter.botId);
    }
    if (filter.mode) {
      where.push('mode = ?');
      vals.push(filter.mode);
    }
    return (this.db.prepare(`SELECT * FROM orders WHERE ${where.join(' AND ')} ORDER BY id`).all(...vals) as Row[]).map(toOrder);
  }

  /** 같은 목적/레벨의 활성 주문(중복 주문 방지용) */
  findActiveOrder(botId: number, purposes: OrderPurpose[], gridLevelId?: string | null): OrderRecord | null {
    const vals: SqlParam[] = [botId, ...purposes];
    let sql = `SELECT * FROM orders WHERE bot_id = ? AND purpose IN (${purposes.map(() => '?').join(',')}) AND state IN ${ACTIVE_STATES}`;
    if (gridLevelId !== undefined) {
      sql += ' AND grid_level_id IS ?';
      vals.push(gridLevelId);
    }
    const r = this.db.prepare(sql + ' LIMIT 1').get(...vals) as Row | undefined;
    return r ? toOrder(r) : null;
  }

  listOrders(filter: { botId?: number; limit?: number } = {}): OrderRecord[] {
    const vals: SqlParam[] = [];
    let sql = 'SELECT * FROM orders';
    if (filter.botId !== undefined) {
      sql += ' WHERE bot_id = ?';
      vals.push(filter.botId);
    }
    sql += ' ORDER BY id DESC LIMIT ?';
    vals.push(filter.limit ?? 100);
    return (this.db.prepare(sql).all(...vals) as Row[]).map(toOrder);
  }

  // ───────── trades ─────────
  /** 같은 업비트 체결 uuid는 한 번만 기록(중복 반영 방지). 이미 있으면 null */
  insertTrade(t: Omit<TradeRecord, 'id'>): TradeRecord | null {
    if (t.upbitTradeUuid && this.db.prepare('SELECT 1 FROM trades WHERE upbit_trade_uuid = ?').get(t.upbitTradeUuid)) return null;
    const r = this.db
      .prepare(
        `INSERT INTO trades (bot_id, order_id, upbit_trade_uuid, market_code, side, price, volume, funds, fee, realized_pnl, cost_basis, mode, timestamp)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(t.botId, t.orderId, t.upbitTradeUuid, t.marketCode, t.side, t.price, t.volume, t.funds, t.fee, t.realizedPnl, t.costBasis, t.mode, t.timestamp);
    return toTrade(this.db.prepare('SELECT * FROM trades WHERE id = ?').get(Number(r.lastInsertRowid)) as Row);
  }

  tradesForOrder(orderId: number): TradeRecord[] {
    return (this.db.prepare('SELECT * FROM trades WHERE order_id = ? ORDER BY id').all(orderId) as Row[]).map(toTrade);
  }

  listTrades(filter: { botId?: number; limit?: number } = {}): TradeRecord[] {
    const vals: SqlParam[] = [];
    let sql = 'SELECT * FROM trades';
    if (filter.botId !== undefined) {
      sql += ' WHERE bot_id = ?';
      vals.push(filter.botId);
    }
    sql += ' ORDER BY timestamp DESC, id DESC LIMIT ?';
    vals.push(filter.limit ?? 100);
    return (this.db.prepare(sql).all(...vals) as Row[]).map(toTrade);
  }

  /** 이 봇이 since 이후 확정한 실현손익 합계(하루 최대 손실 한도용) */
  realizedSince(botId: number, sinceIso: string): number {
    const r = this.db
      .prepare(`SELECT COALESCE(SUM(CAST(realized_pnl AS REAL)), 0) AS s FROM trades WHERE bot_id = ? AND timestamp >= ? AND realized_pnl IS NOT NULL`)
      .get(botId, sinceIso) as Row | undefined;
    return Number(r?.s ?? 0);
  }

  countTradesSince(sinceIso: string): Map<number, number> {
    const rows = this.db.prepare('SELECT bot_id, COUNT(*) AS c FROM trades WHERE timestamp >= ? GROUP BY bot_id').all(sinceIso) as Row[];
    return new Map(rows.map((r) => [Number(r.bot_id), Number(r.c)]));
  }

  // ───────── signals ─────────
  insertSignal(sig: Omit<SignalRecord, 'id' | 'timestamp' | 'outcome' | 'orderId'>): SignalRecord {
    const t = nowIso();
    const r = this.db
      .prepare('INSERT INTO signals (bot_id, market_code, strategy, signal_type, signal_value, reason, timestamp) VALUES (?,?,?,?,?,?,?)')
      .run(sig.botId, sig.marketCode, sig.strategy, sig.signalType, sig.signalValue, sig.reason, t);
    return toSignal(this.db.prepare('SELECT * FROM signals WHERE id = ?').get(Number(r.lastInsertRowid)) as Row);
  }

  updateSignalOutcome(id: number, outcome: string, orderId: number | null = null): void {
    this.db.prepare('UPDATE signals SET outcome = ?, order_id = COALESCE(?, order_id) WHERE id = ?').run(outcome, orderId, id);
  }

  listSignals(filter: { botId?: number; limit?: number } = {}): SignalRecord[] {
    const vals: SqlParam[] = [];
    let sql = 'SELECT * FROM signals';
    if (filter.botId !== undefined) {
      sql += ' WHERE bot_id = ?';
      vals.push(filter.botId);
    }
    sql += ' ORDER BY id DESC LIMIT ?';
    vals.push(filter.limit ?? 100);
    return (this.db.prepare(sql).all(...vals) as Row[]).map(toSignal);
  }

  // ───────── positions ─────────
  getPosition(botId: number, marketCode: string): PositionRecord | null {
    const r = this.db.prepare('SELECT * FROM positions WHERE bot_id = ? AND market_code = ?').get(botId, marketCode) as Row | undefined;
    return r ? toPosition(r) : null;
  }

  listPositions(): PositionRecord[] {
    return (this.db.prepare('SELECT * FROM positions').all() as Row[]).map(toPosition);
  }

  upsertPosition(p: Omit<PositionRecord, 'updatedAt'>): void {
    this.db
      .prepare(
        `INSERT INTO positions (bot_id, market_code, quantity, average_entry_price, total_cost, realized_pnl, updated_at)
         VALUES (?,?,?,?,?,?,?)
         ON CONFLICT(bot_id, market_code) DO UPDATE SET quantity = excluded.quantity, average_entry_price = excluded.average_entry_price,
           total_cost = excluded.total_cost, realized_pnl = excluded.realized_pnl, updated_at = excluded.updated_at`,
      )
      .run(p.botId, p.marketCode, p.quantity, p.averageEntryPrice, p.totalCost, p.realizedPnl, nowIso());
  }

  /** 모의투자 초기화: PAPER 봇의 포지션/전략 상태를 비운다(체결 기록은 이력으로 남김) */
  resetPaperPositions(): void {
    const t = nowIso();
    this.db
      .prepare(
        `UPDATE positions SET quantity = '0', average_entry_price = '0', total_cost = '0', realized_pnl = '0', updated_at = ?
         WHERE bot_id IN (SELECT id FROM bots WHERE mode = 'PAPER')`,
      )
      .run(t);
    this.db.prepare(`UPDATE bots SET strategy_state = '{}' WHERE mode = 'PAPER'`).run();
  }

  // ───────── settings ─────────
  getSetting(key: string): string | null {
    const r = this.db.prepare('SELECT value FROM system_settings WHERE key = ?').get(key) as Row | undefined;
    return r ? String(r.value) : null;
  }

  setSetting(key: string, value: string): void {
    this.db
      .prepare('INSERT INTO system_settings (key, value, updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at')
      .run(key, value, nowIso());
  }

  // ───────── credentials ─────────
  getActiveCredential(): CredentialRecord | null {
    const r = this.db.prepare('SELECT * FROM api_credentials WHERE active = 1 ORDER BY id DESC LIMIT 1').get() as Row | undefined;
    if (!r) return null;
    return {
      id: Number(r.id),
      accessKey: String(r.access_key),
      secretKeyEnc: String(r.secret_key_enc),
      iv: String(r.iv),
      tag: String(r.tag),
      createdAt: String(r.created_at),
    };
  }

  /** 새 키 저장 시 이전 키 레코드는 삭제(암호문도 남기지 않음) */
  replaceCredential(c: Omit<CredentialRecord, 'id' | 'createdAt'>): void {
    this.db.exec('BEGIN');
    try {
      this.db.prepare('DELETE FROM api_credentials').run();
      this.db
        .prepare('INSERT INTO api_credentials (access_key, secret_key_enc, iv, tag, active, created_at) VALUES (?,?,?,?,1,?)')
        .run(c.accessKey, c.secretKeyEnc, c.iv, c.tag, nowIso());
      this.db.exec('COMMIT');
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }

  deleteCredentials(): void {
    this.db.prepare('DELETE FROM api_credentials').run();
  }
}
