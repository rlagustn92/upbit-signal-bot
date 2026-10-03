import type { AccountAsset, AccountDTO } from '../../shared/types';
import type { Env } from '../config/env';
import type { Repo } from '../db/repositories';
import { D } from '../domain/orderMath';
import type { Bus } from '../lib/bus';
import { log } from '../lib/logger';
import { toFriendly } from '../upbit/errors';
import type { UpbitRestClient } from '../upbit/rest';
import type { WsMyAsset } from '../upbit/types';
import type { MarketDataService } from './marketData';

interface AssetRow {
  balance: number;
  locked: number;
  avgBuyPrice: number;
}

const PAPER_KEY = 'paper_krw_balance';

/**
 * 계좌(실제 업비트) + 모의투자(PAPER) 원화 잔고.
 * - 실제 계좌: REST /v1/accounts (시작 시, 60초마다, 체결 후) + Private WS myAsset(실시간 변동)
 * - 모의 잔고: system_settings 에 저장
 */
export class AccountService {
  private assets = new Map<string, AssetRow>();
  private updatedAt: number | null = null;
  private error: string | null = null;
  private refreshing: Promise<void> | null = null;

  constructor(
    private readonly rest: UpbitRestClient,
    private readonly repo: Repo,
    private readonly market: MarketDataService,
    private readonly bus: Bus,
    private readonly env: Env,
  ) {
    if (this.repo.getSetting(PAPER_KEY) == null) this.repo.setSetting(PAPER_KEY, String(env.paperInitialKRW));
  }

  hasData(): boolean {
    return this.updatedAt != null;
  }

  lastUpdatedAt(): number | null {
    return this.updatedAt;
  }

  heldCurrencies(): string[] {
    return [...this.assets.entries()].filter(([c, a]) => c !== 'KRW' && a.balance + a.locked > 0).map(([c]) => c);
  }

  async refresh(): Promise<void> {
    if (!this.rest.hasCredentials()) {
      this.assets.clear();
      this.updatedAt = null;
      this.error = null;
      return;
    }
    if (this.refreshing) return this.refreshing;
    this.refreshing = (async () => {
      try {
        const list = await this.rest.getAccounts();
        this.assets.clear();
        for (const a of list) {
          this.assets.set(a.currency, { balance: Number(a.balance), locked: Number(a.locked), avgBuyPrice: Number(a.avg_buy_price) });
        }
        this.updatedAt = Date.now();
        this.error = null;
        this.bus.emitTyped('changed');
      } catch (e) {
        this.error = toFriendly(e);
        log.warn('API', `잔고 조회 실패: ${(e as Error).message}`);
        throw e;
      } finally {
        this.refreshing = null;
      }
    })();
    return this.refreshing;
  }

  /** Private WS myAsset: 변동된 자산만 들어온다 */
  applyMyAsset(msg: WsMyAsset): void {
    for (const a of msg.assets ?? []) {
      const prev = this.assets.get(a.currency);
      this.assets.set(a.currency, { balance: Number(a.balance), locked: Number(a.locked), avgBuyPrice: prev?.avgBuyPrice ?? 0 });
    }
    this.updatedAt = msg.timestamp ?? Date.now();
    this.bus.emitTyped('changed');
  }

  krwAvailable(): number | null {
    if (!this.hasData()) return null;
    return this.assets.get('KRW')?.balance ?? 0;
  }

  coinAvailable(currency: string): number | null {
    if (!this.hasData()) return null;
    return this.assets.get(currency)?.balance ?? 0;
  }

  // ───────── PAPER ─────────
  paperKrw(): number {
    return Number(this.repo.getSetting(PAPER_KEY) ?? this.env.paperInitialKRW);
  }

  adjustPaperKrw(delta: string | number): void {
    this.repo.setSetting(PAPER_KEY, D(this.paperKrw()).plus(delta).toFixed());
  }

  resetPaper(): void {
    this.repo.setSetting(PAPER_KEY, String(this.env.paperInitialKRW));
  }

  toDTO(): AccountDTO {
    const krw = this.paperKrw();
    const paper = { krwBalance: krw, initialKRW: this.env.paperInitialKRW, coinValueKRW: 0, totalKRW: krw };
    if (!this.rest.hasCredentials()) {
      return { source: 'NONE', krwAvailable: null, krwLocked: null, coinEvaluationKRW: null, totalEvaluationKRW: null, assets: [], updatedAt: null, error: null, paper };
    }
    const assets: AccountAsset[] = [];
    let coinEval = 0;
    for (const [currency, a] of this.assets) {
      if (currency === 'KRW') continue;
      const qty = a.balance + a.locked;
      if (qty <= 0) continue;
      const marketCode = `KRW-${currency}`;
      const hasMarket = this.market.getMarket(marketCode) != null;
      const price = hasMarket ? this.market.getPrice(marketCode) : null;
      const evaluation = price != null ? qty * price : null;
      if (evaluation != null) coinEval += evaluation;

      assets.push({ currency, balance: a.balance, locked: a.locked, avgBuyPrice: a.avgBuyPrice, marketCode: hasMarket ? marketCode : null, currentPrice: price, evaluationKRW: evaluation });
    }
    assets.sort((x, y) => (y.evaluationKRW ?? 0) - (x.evaluationKRW ?? 0));
    const krwRow = this.assets.get('KRW');
    const hasData = this.hasData();
    return {
      source: 'UPBIT',
      krwAvailable: hasData ? (krwRow?.balance ?? 0) : null,
      krwLocked: hasData ? (krwRow?.locked ?? 0) : null,
      coinEvaluationKRW: hasData ? Math.round(coinEval) : null,
      totalEvaluationKRW: hasData ? Math.round((krwRow?.balance ?? 0) + (krwRow?.locked ?? 0) + coinEval) : null,
      assets,
      updatedAt: this.updatedAt ? new Date(this.updatedAt).toISOString() : null,
      error: this.error,
      paper,
    };
  }
}
