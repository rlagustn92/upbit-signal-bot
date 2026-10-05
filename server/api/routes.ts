import express, { type NextFunction, type Request, type Response } from 'express';
import type { App } from '../app';
import path from 'node:path';
import { backtest, normalizeBacktestRequest } from '../backtest';
import fs from 'node:fs';
import type { CopyTradersResponse, StrategyConfig } from '../../shared/types';
import { defaultCopyAddresses, strategyDefaultsForClient } from '../config/strategyDefaults';
import { copyFeed } from '../hyperliquid/watcher';
import { log, type LogTag } from '../lib/logger';
import { BotError } from '../services/botEngine';
import { orderToDTO, signalToDTO, tradeToDTO } from '../services/snapshot';
import { toFriendly } from '../upbit/errors';

const LOCAL_HOSTS = ['127.0.0.1', 'localhost', '[::1]'];

/**
 * 허용 Host: 로컬 주소 + Tailscale(내 기기끼리만 연결되는 사설망) 주소 *.ts.net + .env의 ALLOWED_HOSTS.
 * 서버는 여전히 127.0.0.1에만 열려 있어서, 폰 접속은 `tailscale serve`가 이 PC 안에서 대신 연결해 줄 때만 가능하다.
 */
export function isAllowedHost(host: string, extra: readonly string[] = []): boolean {
  const h = host.toLowerCase().replace(/:\d+$/, '');
  if (LOCAL_HOSTS.includes(h)) return true;
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)*\.ts\.net$/.test(h)) return true;
  return extra.includes(h);
}

function isAllowedOrigin(origin: string, extra: readonly string[]): boolean {
  const m = /^https?:\/\/([^/]+)$/i.exec(origin);
  return !!m && isAllowedHost(m[1], extra);
}
const LIVE_CONFIRM_TEXT = '실제 주문에 동의합니다';

/**
 * REST API (프론트 ↔ 백엔드)
 * 보안: 127.0.0.1 바인딩 + 다른 사이트(Origin)에서 온 요청 거부 + 상태 변경 요청은 커스텀 헤더 필수(CSRF 방지).
 * 응답에는 절대 Secret Key를 포함하지 않는다.
 */
export function createRouter(app: App): express.Router {
  const r = express.Router();
  // DNS 리바인딩 방지: Host가 로컬/Tailscale 주소일 때만 응답
  r.use((req: Request, res: Response, next: NextFunction) => {
    if (!isAllowedHost(String(req.headers.host ?? ''), app.env.allowedHosts)) {
      res.status(403).json({ error: { code: 'FORBIDDEN_HOST', message: '허용되지 않은 접근이에요.' } });
      return;
    }
    next();
  });
  r.use(express.json({ limit: '32kb' }));
  // 잘못된 JSON 등 파싱 오류를 HTML 스택 대신 JSON으로(로컬 경로 노출 방지)
  r.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (!err) return next();
    res.status(400).json({ error: { code: 'BAD_REQUEST', message: '요청 형식이 올바르지 않아요.' } });
  });

  r.use((req: Request, res: Response, next: NextFunction) => {
    const origin = req.headers.origin;
    if (origin && !isAllowedOrigin(origin, app.env.allowedHosts)) {
      res.status(403).json({ error: { code: 'FORBIDDEN_ORIGIN', message: '허용되지 않은 접근이에요.' } });
      return;
    }
    if (req.method !== 'GET' && req.headers['x-requested-with'] !== 'upbit-bot') {
      res.status(403).json({ error: { code: 'MISSING_HEADER', message: '허용되지 않은 요청이에요.' } });
      return;
    }
    next();
  });

  const wrap =
    (fn: (req: Request, res: Response) => Promise<unknown> | unknown) =>
    async (req: Request, res: Response) => {
      try {
        const out = await fn(req, res);
        if (!res.headersSent) res.json(out ?? { ok: true });
      } catch (e) {
        if (e instanceof BotError) {
          res.status(e.status).json({ error: { code: e.code, message: e.message } });
          return;
        }
        log.error('ERROR', `${req.method} ${req.path} 처리 오류: ${(e as Error).message}`);
        res.status(500).json({ error: { code: 'INTERNAL', message: toFriendly(e) } });
      }
    };

  const idParam = (req: Request) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) throw new BotError('INVALID_ID', '잘못된 봇 번호예요.');
    return id;
  };

  // ───── 상태 ─────
  r.get('/health', wrap(() => ({ ok: true, time: new Date().toISOString() })));
  r.get('/snapshot', wrap(() => app.snapshot.build()));
  r.get('/system', wrap(() => app.snapshot.systemState()));

  r.get('/stream', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();
    const send = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    send('snapshot', app.snapshot.build());
    const unsub = app.snapshot.subscribe((s) => send('snapshot', s));
    const hb = setInterval(() => res.write(': ping\n\n'), 20_000);
    req.on('close', () => {
      clearInterval(hb);
      unsub();
    });
  });

  // ───── 전략 기본값/마켓 ─────
  r.get('/strategy-defaults', wrap(() => strategyDefaultsForClient()));
  r.get('/markets', wrap(() => app.market.listKrwMarkets()));

  // ───── 고수 따라하기: 따라 하는 지갑들의 지금 포지션(하이퍼리퀴드 공개 데이터) ─────
  r.get(
    '/copy/traders',
    wrap((): CopyTradersResponse => {
      const coins = ['BTC', 'ETH', 'XRP'];
      const byAddr = new Map<string, number[]>();
      for (const b of app.repo.listBots()) {
        const cfg = b.strategyConfig as StrategyConfig;
        if (cfg.kind !== 'copyTrade') continue;
        const coin = b.marketCode.split('-')[1];
        if (coin && !coins.includes(coin)) coins.push(coin);
        for (const a of cfg.addresses) byAddr.set(a, [...(byAddr.get(a) ?? []), b.id]);
      }
      if (!byAddr.size) for (const a of defaultCopyAddresses()) byAddr.set(a, []);
      const feed = copyFeed();
      feed.want([...byAddr.keys()]);
      let pickedAt: string | null = null;
      try {
        pickedAt = (JSON.parse(fs.readFileSync(path.join(app.env.dataDir, 'hyperliquid', 'picks.json'), 'utf8')) as { generatedAt?: string }).generatedAt ?? null;
      } catch {
        /* 없음 */
      }
      return {
        coins,
        pickedAt,
        traders: [...byAddr].map(([address, botIds]) => {
          const s = feed.get(address);
          return {
            address,
            botIds,
            ok: s?.ok ?? false,
            updatedAt: s?.updatedAt || null,
            accountValue: s?.accountValue ?? null,
            error: s?.error ?? null,
            positions: coins.map((coin) => ({
              coin,
              size: s?.positions[coin] ?? 0,
              entryPx: s?.details[coin]?.entryPx ?? null,
              unrealizedPnl: s?.details[coin]?.unrealizedPnl ?? null,
              leverage: s?.details[coin]?.leverage ?? null,
            })),
          };
        }),
      };
    }),
  );

  // ───── 백테스트(과거 캔들로 전략 시험) — 한 번에 하나만(업비트 조회 한도 보호) ─────
  let backtestRunning = false;
  r.post(
    '/backtest',
    wrap(async (req) => {
      const input = normalizeBacktestRequest((req.body ?? {}) as Record<string, unknown>);
      if (backtestRunning) throw new BotError('BACKTEST_BUSY', '다른 백테스트가 진행 중이에요. 잠시 후 다시 해 주세요.', 409);
      backtestRunning = true;
      try {
        const res = await backtest(app.rest, input, { cacheDir: path.join(app.env.dataDir, 'backtest-cache') });
        log.info('SYSTEM', `백테스트 ${input.marketCode} ${input.strategy} ${res.request.days}일 → ${res.metrics.totalReturnPercent.toFixed(2)}% (매도 ${res.metrics.trades}회)`);
        // 화면에는 요약 + 자산 곡선 + 최근 매도 50건만
        return { request: res.request, config: res.config, simUnit: res.simUnit, analysisUnit: res.analysisUnit, metrics: res.metrics, equity: res.equity, trades: res.trades.slice(-50), notes: res.notes };
      } finally {
        backtestRunning = false;
      }
    }),
  );

  // ───── 봇 ─────
  r.get('/bots', wrap(() => app.engine.toDTOs()));
  r.post(
    '/bots',
    wrap(async (req) => {
      const bot = app.engine.createBot(req.body ?? {});
      let startError: string | null = null;
      if (req.body?.start) {
        try {
          await app.engine.startBot(bot.id);
        } catch (e) {
          startError = e instanceof Error ? e.message : String(e);
        }
      }
      return { bot: app.engine.toDTOs().find((b) => b.id === bot.id), startError };
    }),
  );
  r.patch('/bots/:id', wrap((req) => {
    const id = idParam(req);
    app.engine.updateBot(id, req.body ?? {});
    return app.engine.toDTOs().find((b) => b.id === id);
  }));
  r.delete('/bots/:id', wrap(async (req) => {
    await app.engine.deleteBot(idParam(req));
    return { ok: true };
  }));
  r.post('/bots/:id/start', wrap(async (req) => {
    const id = idParam(req);
    await app.engine.startBot(id);
    return app.engine.toDTOs().find((b) => b.id === id);
  }));
  r.post('/bots/:id/stop', wrap(async (req) => {
    const id = idParam(req);
    const r2 = await app.engine.stopBot(id);
    return { bot: app.engine.toDTOs().find((b) => b.id === id), cancelled: r2.cancelled, failed: r2.failed };
  }));
  r.post('/bots/:id/mode', wrap(async (req) => {
    const id = idParam(req);
    const mode = req.body?.mode;
    if (mode !== 'PAPER' && mode !== 'LIVE') throw new BotError('INVALID_MODE', '모드는 PAPER 또는 LIVE예요.');
    if (mode === 'LIVE' && req.body?.confirmText !== LIVE_CONFIRM_TEXT) throw new BotError('CONFIRM_REQUIRED', `확인 문구 "${LIVE_CONFIRM_TEXT}"를 정확히 입력해 주세요.`);
    await app.engine.setMode(id, mode);
    return app.engine.toDTOs().find((b) => b.id === id);
  }));

  r.post('/bots/:id/paper-liquidate', wrap(async (req) => {
    const id = idParam(req);
    await app.engine.liquidatePaper(id);
    return app.engine.toDTOs().find((b) => b.id === id);
  }));

  // ───── 주문/체결/시그널 ─────
  const limitOf = (req: Request) => Math.min(500, Math.max(1, Number(req.query.limit ?? 100) || 100));
  const botOf = (req: Request) => (req.query.botId ? Number(req.query.botId) : undefined);
  r.get('/orders', wrap((req) => app.repo.listOrders({ botId: botOf(req), limit: limitOf(req) }).map(orderToDTO)));
  r.get('/trades', wrap((req) => app.repo.listTrades({ botId: botOf(req), limit: limitOf(req) }).map((t) => tradeToDTO(app.repo, t))));
  r.get('/signals', wrap((req) => app.repo.listSignals({ botId: botOf(req), limit: limitOf(req) }).map((s) => signalToDTO(app.repo, s))));

  // ───── 계좌 ─────
  r.get('/account', wrap(() => app.snapshot.build().account));
  r.post('/account/refresh', wrap(async () => {
    await app.account.refresh().catch(() => {});
    return app.account.toDTO();
  }));
  r.post('/paper/reset', wrap(() => {
    const paperActive = app.repo.listActiveOrders({ mode: 'PAPER' }).length;
    const activeBots = app.repo.listBots().filter((b) => b.active && b.mode === 'PAPER').length;
    if (paperActive || activeBots) throw new BotError('PAPER_BUSY', '모의투자 봇을 모두 끄고 미체결 주문이 정리된 다음에 초기화할 수 있어요.', 409);
    app.repo.resetPaperPositions();
    app.account.resetPaper();
    app.bus.emitTyped('changed');
    app.bus.emitTyped('activity');
    return app.snapshot.build().account;
  }));

  // ───── 업비트 연결 ─────
  r.get('/connection', wrap(() => app.connection.toDTO()));
  r.post('/connection/test', wrap(() => app.connection.test()));
  r.put('/connection/credentials', wrap((req) => {
    const { accessKey, secretKey } = req.body ?? {};
    if (typeof accessKey !== 'string' || typeof secretKey !== 'string') throw new BotError('INVALID_KEY', 'Access Key와 Secret Key를 모두 입력해 주세요.');
    try {
      app.creds.save(accessKey, secretKey);
    } catch (e) {
      throw new BotError('INVALID_KEY', (e as Error).message);
    }
    return app.connection.toDTO(); // Secret Key는 응답하지 않음
  }));
  r.delete('/connection/credentials', wrap(async () => {
    const liveBots = app.repo.listBots().filter((b) => b.active && b.mode === 'LIVE');
    for (const b of liveBots) await app.engine.stopBot(b.id);
    app.creds.clear();
    return app.connection.toDTO();
  }));

  // ───── 실전(LIVE) ─────
  r.get('/live/checklist', wrap(() => ({ items: app.connection.liveChecklist(), liveEnabled: app.system.liveEnabled, hardLock: app.system.liveHardLock, confirmText: LIVE_CONFIRM_TEXT })));
  r.post('/live/enable', wrap((req) => {
    if (req.body?.confirmText !== LIVE_CONFIRM_TEXT) throw new BotError('CONFIRM_REQUIRED', `확인 문구 "${LIVE_CONFIRM_TEXT}"를 정확히 입력해 주세요.`);
    if (req.body?.withdrawPermissionOff !== true) throw new BotError('CONFIRM_REQUIRED', '업비트에서 출금 권한을 끈 것을 확인해 주세요.');
    const items = app.connection.liveChecklist();
    const failed = items.filter((i) => !i.ok);
    if (failed.length) throw new BotError('CHECKLIST_FAILED', `아직 준비되지 않은 항목이 있어요: ${failed.map((f) => f.label).join(', ')}`, 409);
    app.system.setLiveEnabled(true);
    return { liveEnabled: true };
  }));
  r.post('/live/disable', wrap(async () => {
    const liveBots = app.repo.listBots().filter((b) => b.active && b.mode === 'LIVE');
    for (const b of liveBots) await app.engine.stopBot(b.id);
    app.system.setLiveEnabled(false);
    return { liveEnabled: false, stoppedBots: liveBots.length };
  }));

  // ───── 안전 ─────
  r.post('/emergency-stop', wrap(() => app.engine.emergencyStop()));
  r.post('/emergency-release', wrap(() => {
    app.engine.releaseEmergency();
    return { ok: true };
  }));

  // ───── 로그 ─────
  r.get('/logs', wrap((req) => log.recent(limitOf(req), (req.query.tag as LogTag) || undefined)));

  r.use((_req, res) => res.status(404).json({ error: { code: 'NOT_FOUND', message: '없는 API예요.' } }));
  return r;
}
