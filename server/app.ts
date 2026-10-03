import type { Env } from './config/env';
import { openDatabase } from './db/database';
import { Repo } from './db/repositories';
import { Bus } from './lib/bus';
import { log } from './lib/logger';
import { UpbitRestClient } from './upbit/rest';
import { AccountService } from './services/account';
import { BotEngine } from './services/botEngine';
import { ConnectionService } from './services/connection';
import { CredentialService } from './services/credentials';
import { MarketDataService } from './services/marketData';
import { MarketRulesService } from './services/marketRules';
import { OrderService } from './services/orders';
import { PositionService } from './services/positions';
import { PrivateStream } from './services/privateStream';
import { recoverOnStartup } from './services/recovery';
import { SnapshotService } from './services/snapshot';
import { SystemService } from './services/system';
import { ENGINE } from './config/strategyDefaults';
import { baseCurrency } from './domain/market';

export interface AppOptions {
  env: Env;
  /** 테스트용: 가짜 fetch 주입 */
  fetchImpl?: typeof fetch;
  /** 테스트용: 메모리 DB */
  databasePath?: string;
}

/** 모든 서비스를 조립한다(의존성 주입). index.ts와 테스트가 함께 사용. */
export function createApp(opts: AppOptions) {
  const { env } = opts;
  const db = openDatabase(opts.databasePath ?? env.databasePath);
  const repo = new Repo(db);
  const bus = new Bus();
  bus.setMaxListeners(50);
  const system = new SystemService(repo, env, bus);
  const creds = new CredentialService(repo, env);
  const rest = new UpbitRestClient({ baseUrl: env.upbitRestBase, getCredentials: () => creds.get(), fetchImpl: opts.fetchImpl });
  const market = new MarketDataService(rest, bus, env, (s) => {
    system.setPublic(s);
  });
  bus.onTyped('ticker', () => {
    system.lastPublicMessageAt = Date.now();
  });
  const rules = new MarketRulesService(rest, market);
  const positions = new PositionService(repo);
  const account = new AccountService(rest, repo, market, bus, env);
  const orders = new OrderService(repo, rest, market, rules, positions, account, system, bus);
  const engine = new BotEngine(repo, market, orders, positions, system, bus);
  const privateStream = new PrivateStream(env, creds, orders, account, system);
  const connection = new ConnectionService(rest, creds, repo, account, system, () => privateStream);
  const snapshot = new SnapshotService(repo, engine, account, connection, system, market, creds, bus);

  // 실제 보유 코인의 평가금 계산을 위해 보유 코인 현재가도 WebSocket으로 구독
  market.addSubscriptionProvider(() => ({
    ticker: [...ENGINE.watchMarkets, ...account.heldCurrencies().map((c) => `KRW-${c}`)],
  }));

  // API Key가 바뀌면 Private WS 재연결, 잔고 재조회
  creds.onChange(() => {
    rules.invalidate();
    privateStream.restart();
    void account.refresh().catch(() => {});
    market.recomputeSubscriptions();
    bus.emitTyped('changed');
  });

  // 체결이 생기면 실제 계좌를 다시 조회(LIVE)
  bus.onTyped('tradeRecorded', (t) => {
    if (t.mode === 'LIVE') setTimeout(() => void account.refresh().catch(() => {}), 1500);
  });

  let accountTimer: NodeJS.Timeout | null = null;

  async function start(): Promise<void> {
    log.info('SYSTEM', `서버 시작 — PAPER 기본 / LIVE 하드락 ${env.liveHardLock ? 'ON(실제 주문 불가)' : 'OFF'} / 실전 허용 ${system.liveEnabled ? 'ON' : 'OFF'}`);
    if (creds.get()) log.info('SYSTEM', `API Key 사용 (${creds.getSource()}) ${creds.maskedAccessKey()}`);
    else log.info('SYSTEM', 'API Key 없음 — 시세 조회와 모의투자(PAPER)만 가능');

    await recoverOnStartup({ repo, rest, account, orders, positions, system }).then((notes) => {
      system.message = notes.length ? notes.join(' / ') : null;
    });
    await market.start();
    privateStream.start();
    await engine.resumeActiveBots();
    orders.startSync();
    accountTimer = setInterval(() => {
      if (creds.get()) void account.refresh().then(() => market.recomputeSubscriptions()).catch(() => {});
    }, ENGINE.accountSyncMs);
    market.recomputeSubscriptions();
  }

  function stop(): void {
    market.stop();
    privateStream.stop();
    orders.stopSync();
    if (accountTimer) clearInterval(accountTimer);
    snapshot.stop();
    try {
      db.close();
    } catch {
      /* noop */
    }
  }

  return { env, db, repo, bus, system, creds, rest, market, rules, positions, account, orders, engine, privateStream, connection, snapshot, start, stop, baseCurrency };
}

export type App = ReturnType<typeof createApp>;
