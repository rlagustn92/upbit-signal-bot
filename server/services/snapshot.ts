import type { ModeSummary, OrderDTO, SignalDTO, SnapshotDTO, SystemStateDTO, TradeDTO, TradingMode } from '../../shared/types';
import { ENGINE } from '../config/strategyDefaults';
import type { OrderRecord, Repo, SignalRecord, TradeRecord } from '../db/repositories';
import { toDisplaySymbol } from '../domain/market';
import type { Bus } from '../lib/bus';
import { log } from '../lib/logger';
import type { AccountService } from './account';
import type { BotEngine } from './botEngine';
import type { ConnectionService } from './connection';
import type { CredentialService } from './credentials';
import type { MarketDataService } from './marketData';
import type { SystemService } from './system';

type Listener = (s: SnapshotDTO) => void;

/** 화면에 필요한 상태를 한 번에 모아 SSE로 밀어준다(최대 초당 1회). */
export class SnapshotService {
  private listeners = new Set<Listener>();
  private timer: NodeJS.Timeout | null = null;
  private lastSent = 0;
  private dirty = false;
  activityVersion = 0;

  constructor(
    private readonly repo: Repo,
    private readonly engine: BotEngine,
    private readonly account: AccountService,
    private readonly connection: ConnectionService,
    private readonly system: SystemService,
    private readonly market: MarketDataService,
    private readonly creds: CredentialService,
    bus: Bus,
  ) {
    bus.onTyped('changed', () => this.schedule());
    bus.onTyped('activity', () => {
      this.activityVersion++;
      this.schedule();
    });
    // 현재가 변화도 화면에 반영(스로틀)
    bus.onTyped('ticker', () => this.schedule());
  }

  subscribe(l: Listener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  private schedule(): void {
    if (!this.listeners.size) return;
    this.dirty = true;
    if (this.timer) return;
    const wait = Math.max(0, ENGINE.snapshotThrottleMs - (Date.now() - this.lastSent));
    this.timer = setTimeout(() => {
      this.timer = null;
      if (!this.dirty) return;
      this.dirty = false;
      this.lastSent = Date.now();
      try {
        const snap = this.build();
        for (const l of this.listeners) l(snap);
      } catch (e) {
        log.error('ERROR', `화면 상태 생성 오류: ${(e as Error).message}`);
      }
    }, wait);
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
  }

  systemState(): SystemStateDTO {
    const bots = this.repo.listBots();
    const hasCreds = !!this.creds.get();
    return {
      status: this.system.status(hasCreds),
      emergencyStop: this.system.emergencyStop,
      publicStream: this.system.publicStream,
      privateStream: this.system.privateStream,
      lastPublicMessageAt: this.system.lastPublicMessageAt ? new Date(this.system.lastPublicMessageAt).toISOString() : null,
      lastPrivateMessageAt: this.system.lastPrivateMessageAt ? new Date(this.system.lastPrivateMessageAt).toISOString() : null,
      activeBots: bots.filter((b) => b.active).length,
      totalBots: bots.length,
      liveHardLock: this.system.liveHardLock,
      liveEnabled: this.system.liveEnabled,
      hasCredentials: hasCreds,
      serverTime: new Date().toISOString(),
      message: this.system.message,
    };
  }

  build(): SnapshotDTO {
    const allBots = this.engine.toDTOs();
    const summarize = (mode: TradingMode): ModeSummary => {
      const list = allBots.filter((b) => b.mode === mode);
      const totalBudget = list.reduce((a, b) => a + b.budgetKRW, 0);
      const realizedPnl = list.reduce((a, b) => a + b.stats.realizedPnl, 0);
      const unrealizedPnl = list.reduce((a, b) => a + b.stats.unrealizedPnl, 0);
      return {
        totalPnl: realizedPnl + unrealizedPnl,
        realizedPnl,
        unrealizedPnl,
        totalBudget,
        activeBudget: list.reduce((a, b) => a + (b.active ? b.budgetKRW : 0), 0),
        totalPnlPercentOfBudget: totalBudget > 0 ? ((realizedPnl + unrealizedPnl) / totalBudget) * 100 : 0,
        todayTradesCount: list.reduce((a, b) => a + b.stats.todayTradesCount, 0),
        botCount: list.length,
      };
    };
    const summaryByMode = { PAPER: summarize('PAPER'), LIVE: summarize('LIVE') };
    const headlineMode: TradingMode = summaryByMode.LIVE.botCount > 0 ? 'LIVE' : 'PAPER';
    const bots = allBots;
    const h = summaryByMode[headlineMode];
    const markets = new Set([...ENGINE.watchMarkets, ...bots.map((b) => b.marketCode)]);
    const account = this.account.toDTO();
    const paperCoins = bots.filter((b) => b.mode === 'PAPER').reduce((a, b) => a + b.stats.positionQuantity * (b.stats.currentPrice ?? 0), 0);
    account.paper.coinValueKRW = Math.round(paperCoins);
    account.paper.totalKRW = Math.round(account.paper.krwBalance + paperCoins);
    return {
      system: this.systemState(),
      bots,
      account,
      connection: this.connection.toDTO(),
      summaryByMode,
      headlineMode,
      summary: {
        totalPnl: h.totalPnl,
        realizedPnl: h.realizedPnl,
        unrealizedPnl: h.unrealizedPnl,
        totalBudget: h.totalBudget,
        activeBudget: h.activeBudget,
        totalPnlPercentOfBudget: h.totalPnlPercentOfBudget,
        todayTradesCount: h.todayTradesCount,
      },
      prices: this.market.pricesFor(markets),
      activityVersion: this.activityVersion,
    };
  }
}

// ───────── Record → DTO ─────────
export function orderToDTO(o: OrderRecord): OrderDTO {
  return {
    id: o.id,
    botId: o.botId,
    identifier: o.identifier,
    upbitUuid: o.upbitUuid,
    marketCode: o.marketCode,
    side: o.side,
    orderType: o.ordType,
    price: o.price,
    volume: o.volume,
    executedVolume: o.executedVolume,
    remainingVolume: o.remainingVolume,
    averagePrice: o.averagePrice,
    executedFunds: o.executedFunds,
    fee: o.paidFee,
    state: o.state,
    upbitState: o.upbitState,
    purpose: o.purpose,
    gridLevelId: o.gridLevelId,
    reason: o.reason,
    strategySignalId: o.strategySignalId,
    mode: o.mode,
    errorCode: o.errorCode,
    errorMessage: o.errorMessage,
    createdAt: o.createdAt,
    updatedAt: o.updatedAt,
  };
}

export function tradeToDTO(repo: Repo, t: TradeRecord): TradeDTO {
  const bot = t.botId != null ? repo.getBotAny(t.botId) : null;
  const order = repo.getOrder(t.orderId);
  const realized = t.realizedPnl != null ? Number(t.realizedPnl) : null;
  const basis = t.costBasis != null ? Number(t.costBasis) : null;
  return {
    id: t.id,
    botId: t.botId,
    orderId: t.orderId,
    marketCode: t.marketCode,
    displaySymbol: toDisplaySymbol(t.marketCode),
    coinName: bot?.coinName ?? t.marketCode.split('-')[1],
    side: t.side,
    price: t.price,
    volume: t.volume,
    funds: t.funds,
    fee: t.fee,
    realizedPnl: t.realizedPnl,
    realizedPnlPercent: realized != null && basis && basis > 0 ? (realized / basis) * 100 : null,
    purpose: order?.purpose ?? 'MANUAL',
    strategy: bot?.strategy ?? null,
    reason: order?.reason ?? null,
    mode: t.mode,
    timestamp: t.timestamp,
  };
}

export function signalToDTO(repo: Repo, s: SignalRecord): SignalDTO {
  const bot = repo.getBotAny(s.botId);
  return {
    id: s.id,
    botId: s.botId,
    marketCode: s.marketCode,
    displaySymbol: toDisplaySymbol(s.marketCode),
    coinName: bot?.coinName ?? s.marketCode.split('-')[1],
    strategy: s.strategy,
    signalType: s.signalType,
    signalValue: s.signalValue,
    reason: s.reason,
    outcome: s.outcome,
    orderId: s.orderId,
    timestamp: s.timestamp,
  };
}
