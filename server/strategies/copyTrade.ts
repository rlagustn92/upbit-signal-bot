import type { StrategyConfig } from '../../shared/types';
import { copyFeed } from '../hyperliquid/watcher';
import type { Strategy, StrategyContext, StrategyIntent } from './types';

type CtCfg = Extract<StrategyConfig, { kind: 'copyTrade' }>;

/** 따라 하는 사람 한 명 몫 */
interface Slice {
  /** 그 사람이 이 코인을 '안 들고 있는' 모습을 한 번이라도 봤는지 — 봤어야 다음 롱을 '새 진입'으로 따라 산다 */
  armed: boolean;
  /** 그 사람 몫으로 지금 들고 있는지 */
  holding: boolean;
  /** 그 사람 몫 수량 */
  qty: number;
  /** 마지막으로 본 그 사람의 롱 여부 */
  traderLong: boolean | null;
}

interface CtState {
  slices?: Record<string, Slice>;
  staleWarnAt?: number;
}

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const coinOf = (marketCode: string) => marketCode.split('-')[1] ?? marketCode;
const vol8 = (q: number) => (Math.floor(q * 1e8) / 1e8).toFixed(8);

function slicesOf(ctx: StrategyContext<CtCfg>): Record<string, Slice> {
  const st = ctx.state as CtState;
  st.slices ??= {};
  for (const a of ctx.config.addresses) {
    const key = a.toLowerCase();
    st.slices[key] ??= { armed: ctx.config.joinExisting, holding: false, qty: 0, traderLong: null };
  }
  return st.slices;
}

/**
 * 하이퍼리퀴드 고수 따라하기 (실험, 모의투자 전용)
 * - 예산 ÷ 사람 수 = 한 사람 몫. 그 사람이 이 코인 롱을 새로 잡으면 그 몫만큼 시장가 매수
 * - 그 사람이 롱을 정리하거나 숏으로 바꾸면 그 몫을 시장가 매도
 * - 레버리지·숏·수량은 따라 하지 않음(방향만). 조회가 끊기거나 오래된 값이면 매매하지 않음
 * - 손절 %(봇 공통)는 급락 대비 안전장치. 공통 목표 익절은 쓰지 않음(그 사람이 팔 때 팜)
 */
export const copyTradeStrategy: Strategy<CtCfg> = {
  kind: 'copyTrade',
  candleUnit: () => null,
  minCandles: () => 0,

  initialize(ctx) {
    const slices = slicesOf(ctx);
    // 꺼져 있는 동안 손절 등으로 다 팔렸으면 기록을 맞춘다
    if (!(ctx.position.quantity > 0)) {
      for (const s of Object.values(slices)) {
        s.holding = false;
        s.qty = 0;
      }
    }
    copyFeed().want(ctx.config.addresses);
    return [];
  },

  onTicker(ctx) {
    const cfg = ctx.config;
    const st = ctx.state as CtState;
    const slices = slicesOf(ctx);
    const coin = coinOf(ctx.bot.marketCode);
    const feed = copyFeed();
    feed.want(cfg.addresses);
    if (ctx.hasActiveOrder(['ENTRY', 'EXIT', 'TAKE_PROFIT', 'STOP_LOSS'])) return [];

    const tracked = new Set(cfg.addresses.map((a) => a.toLowerCase()));
    const holdingCount = Object.values(slices).filter((s) => s.holding).length;
    const per = Math.floor(Number(ctx.bot.budgetKRW) / Math.max(1, cfg.addresses.length));
    let stale = 0;

    for (const [addr, s] of Object.entries(slices)) {
      // 설정에서 빠진 사람: 들고 있던 몫은 팔고 기록을 지운다
      if (!tracked.has(addr)) {
        if (s.holding && s.qty > 0) return [sell(ctx, addr, s, holdingCount, `${short(addr)}을(를) 따라 하기 목록에서 빼서 그 몫을 팔기`)];
        delete slices[addr];
        continue;
      }
      const snap = feed.get(addr);
      if (!snap || !snap.ok || ctx.now - snap.updatedAt > cfg.maxStaleSec * 1000) {
        stale++;
        continue;
      }
      const size = snap.positions[coin] ?? 0;
      const long = size > 0;
      if (!long) s.armed = true;
      s.traderLong = long;

      if (long && s.armed && !s.holding) {
        const d = snap.details[coin];
        return [
          {
            signalType: 'BUY',
            signalValue: `${short(addr)} ${coin} 롱 ${size}${d?.entryPx ? ` @ $${d.entryPx}` : ''}${d?.leverage ? ` (${d.leverage}배)` : ''}`,
            reason: `고수 ${short(addr)}이(가) ${coin} 롱을 잡아서 따라 사기 (예산 1/${cfg.addresses.length})`,
            order: { side: 'bid', purpose: 'ENTRY', kind: 'market', krwAmount: per, gridLevelId: addr },
          },
        ];
      }
      if (!long && s.holding) {
        const why = size < 0 ? '숏으로 바꿔서' : '롱을 정리해서';
        return [sell(ctx, addr, s, holdingCount, `고수 ${short(addr)}이(가) ${coin} ${why} 그 몫을 따라 팔기`)];
      }
    }

    if (stale > 0 && (st.staleWarnAt == null || ctx.now - st.staleWarnAt > 3600_000)) {
      st.staleWarnAt = ctx.now;
      return [{ signalType: 'INFO', signalValue: `${stale}/${cfg.addresses.length}명 조회 지연`, reason: `하이퍼리퀴드에서 ${stale}명의 포지션을 ${cfg.maxStaleSec}초 넘게 못 받아서 그 사람들은 잠시 따라 하지 않아요` }];
    }
    return [];
  },

  onCandleClose: () => [],

  onOrderUpdate(ctx, order, filledVolume) {
    const s = order.gridLevelId ? (ctx.state as CtState).slices?.[order.gridLevelId] : undefined;
    if (!s) return;
    if (order.side === 'bid' && order.purpose === 'ENTRY') {
      s.qty += filledVolume;
      s.holding = s.qty > 0;
    } else if (order.side === 'ask') {
      s.qty = Math.max(0, s.qty - filledVolume);
      if (s.qty < 1e-8 || order.state === 'FILLED') {
        s.qty = 0;
        s.holding = false;
      }
    }
  },

  onPositionClosed(ctx) {
    // 손절 등으로 전부 팔림: 모든 몫을 비우고, 다음엔 그 사람이 한 번 정리했다가 다시 롱을 잡을 때 따라 산다
    for (const s of Object.values((ctx.state as CtState).slices ?? {})) {
      if (s.holding) s.armed = false;
      s.holding = false;
      s.qty = 0;
    }
  },

  describe(bot, cfg, state) {
    const slices = (state as CtState).slices ?? {};
    const holding = Object.values(slices).filter((s) => s.holding).length;
    const longNow = Object.values(slices).filter((s) => s.traderLong).length;
    const coin = coinOf(bot.marketCode);
    return {
      title: `하이퍼리퀴드 고수 ${cfg.addresses.length}명 따라하기`,
      description:
        `${cfg.addresses.map(short).join(', ')} 이(가) ${coin} 롱을 새로 잡으면 예산의 1/${cfg.addresses.length}씩 사고, 정리하면 그 몫을 팔아요. ` +
        `레버리지·숏은 따라 하지 않아요. 급락 대비 손절 -${bot.stopLossPercent}% · 실험용(모의투자 전용)`,
      range: `따라 산 몫 ${holding}/${cfg.addresses.length} · 지금 ${coin} 롱인 고수 ${longNow}명`,
    };
  },
};

function sell(ctx: StrategyContext<CtCfg>, addr: string, s: Slice, holdingCount: number, reason: string): StrategyIntent {
  // 마지막 남은 몫이면 소수점 찌꺼기까지 전부 판다
  const all = holdingCount <= 1 || s.qty >= ctx.position.quantity - 1e-8;
  return {
    signalType: 'SELL',
    signalValue: `${short(addr)} 몫 ${vol8(Math.min(s.qty, ctx.position.quantity))}`,
    reason,
    order: { side: 'ask', purpose: 'EXIT', kind: 'market', volume: all ? 'ALL' : vol8(Math.min(s.qty, ctx.position.quantity)), gridLevelId: addr },
  };
}
