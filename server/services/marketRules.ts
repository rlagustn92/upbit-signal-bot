import type { TradingMode } from '../../shared/types';
import { STRATEGY_DEFAULTS } from '../config/strategyDefaults';
import type { Decimal } from '../domain/orderMath';
import { log } from '../lib/logger';
import type { UpbitRestClient } from '../upbit/rest';
import type { UpbitOrderChance } from '../upbit/types';
import type { MarketDataService } from './marketData';

export interface MarketRules {
  marketCode: string;
  bidFee: number;
  askFee: number;
  minTotalBid: number;
  minTotalAsk: number;
  maxTotal: number | null;
  /** 업비트 주문 가능 정보의 페어 상태(active) */
  state: string;
  bidTypes: string[];
  askTypes: string[];
  tickOf: (p: Decimal) => Decimal;
  source: 'UPBIT' | 'DEFAULT';
}

const CACHE_MS = 10 * 60_000;

/**
 * 주문 규칙(수수료/최소·최대 금액/주문 유형/호가 단위).
 * LIVE: /v1/orders/chance (10분 캐시) — 공식 값 우선
 * PAPER: 키가 있고 캐시가 있으면 공식 값, 없으면 중앙 기본값(strategyDefaults)
 */
export class MarketRulesService {
  private cache = new Map<string, { at: number; chance: UpbitOrderChance }>();

  constructor(
    private readonly rest: UpbitRestClient,
    private readonly market: MarketDataService,
  ) {}

  async get(marketCode: string, mode: TradingMode): Promise<MarketRules> {
    const tickOf = this.market.tickFn(marketCode);
    let chance = this.cache.get(marketCode);
    if ((mode === 'LIVE' || chance) && this.rest.hasCredentials() && (!chance || Date.now() - chance.at > CACHE_MS)) {
      try {
        chance = { at: Date.now(), chance: await this.rest.getOrderChance(marketCode) };
        this.cache.set(marketCode, chance);
      } catch (e) {
        if (mode === 'LIVE') throw e;
        log.debug('API', `주문 가능 정보 조회 실패(기본값 사용): ${(e as Error).message}`);
      }
    }
    if (chance) {
      const c = chance.chance;
      return {
        marketCode,
        bidFee: Number(c.bid_fee),
        askFee: Number(c.ask_fee),
        minTotalBid: Number(c.market.bid.min_total),
        minTotalAsk: Number(c.market.ask.min_total),
        maxTotal: c.market.max_total ? Number(c.market.max_total) : null,
        state: c.market.state,
        bidTypes: c.market.bid_types ?? [],
        askTypes: c.market.ask_types ?? [],
        tickOf,
        source: 'UPBIT',
      };
    }
    return {
      marketCode,
      bidFee: STRATEGY_DEFAULTS.feeRateDefault,
      askFee: STRATEGY_DEFAULTS.feeRateDefault,
      minTotalBid: STRATEGY_DEFAULTS.minOrderKRWDefault,
      minTotalAsk: STRATEGY_DEFAULTS.minOrderKRWDefault,
      maxTotal: null,
      state: 'active',
      bidTypes: ['limit', 'price'],
      askTypes: ['limit', 'market'],
      tickOf,
      source: 'DEFAULT',
    };
  }

  invalidate(): void {
    this.cache.clear();
  }
}
