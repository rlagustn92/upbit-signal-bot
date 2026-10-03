import type { Repo } from '../db/repositories';
import { parseIdentifier } from '../domain/identifier';
import { baseCurrency } from '../domain/market';
import { D } from '../domain/orderMath';
import { log } from '../lib/logger';
import type { UpbitRestClient } from '../upbit/rest';
import type { UpbitOrder } from '../upbit/types';
import type { AccountService } from './account';
import type { OrderService } from './orders';
import type { PositionService } from './positions';
import type { SystemService } from './system';

/**
 * 서버 재시작 복구 (작업지시서 §48~49). 업비트의 실제 상태를 최종 기준으로 삼는다.
 *  1) DB에서 봇 조회  2) 업비트 계좌 확인  3) 보유 자산 확인
 *  4) 업비트 미체결 주문 조회  5) identifier로 봇 주문 식별
 *  6) DB와 비교 → 7) 상태 복구(체결/취소 반영, 누락 주문 등록)
 *  (8) WebSocket 재연결과 9) 전략 감시 재개는 app.ts가 이어서 수행)
 */
export async function recoverOnStartup(deps: {
  repo: Repo;
  rest: UpbitRestClient;
  account: AccountService;
  orders: OrderService;
  positions: PositionService;
  system: SystemService;
}): Promise<string[]> {
  const { repo, rest, account, orders, positions, system } = deps;
  const notes: string[] = [];
  const bots = repo.listBots();
  log.info('SYSTEM', `재시작 복구 시작 — 봇 ${bots.length}개 (활성 ${bots.filter((b) => b.active).length}개)${system.emergencyStop ? ' · 긴급 정지 상태 유지' : ''}`);

  if (!rest.hasCredentials()) {
    const liveActive = repo.listActiveOrders({ mode: 'LIVE' });
    if (liveActive.length) notes.push(`API Key가 없어 실제 미체결 주문 ${liveActive.length}건의 상태를 확인하지 못했어요.`);
    log.info('SYSTEM', 'API Key 없음 → 실제 계좌 복구 단계 생략 (PAPER 주문은 그대로 이어서 시뮬레이션)');
    return notes;
  }

  // 2~3) 계좌
  try {
    await account.refresh();
    log.info('SYSTEM', `계좌 확인 완료 — 보유 코인 ${account.heldCurrencies().length}종`);
  } catch (e) {
    notes.push(`잔고 조회 실패: ${(e as Error).message}`);
  }

  // 4~5) 업비트 미체결 주문 중 봇이 만든 것
  const openFromUpbit: UpbitOrder[] = [];
  try {
    for (let page = 1; page <= 20; page++) {
      const list = await rest.getOpenOrders({ page, limit: 100 });
      openFromUpbit.push(...list);
      if (list.length < 100) break;
    }
  } catch (e) {
    notes.push(`미체결 주문 조회 실패: ${(e as Error).message}`);
    log.error('SYSTEM', `복구: 미체결 주문 조회 실패 ${(e as Error).message}`);
  }
  const botOpen = openFromUpbit.filter((u) => {
    const p = parseIdentifier(u.identifier);
    return p && !p.paper;
  });
  log.info('SYSTEM', `업비트 미체결 주문 ${openFromUpbit.length}건 중 봇 주문 ${botOpen.length}건`);

  // 6~7) 비교/복구
  const seen = new Set<string>();
  for (const u of botOpen) {
    seen.add(u.uuid);
    let o = repo.getOrderByUuid(u.uuid) ?? (u.identifier ? repo.getOrderByIdentifier(u.identifier) : null);
    if (!o) {
      o = orders.adoptOrphan(u);
      notes.push(`DB에 없던 봇 주문 ${u.identifier}을(를) 복구했어요.`);
    }
    if (o) await orders.applyUpbitOrder(o.id, u);
  }
  for (const o of repo.listActiveOrders({ mode: 'LIVE' })) {
    if (o.upbitUuid && seen.has(o.upbitUuid)) continue;
    await orders.reconcile(o.id); // 이미 체결/취소됐거나, 생성되지 않은 주문
  }

  // 포지션 점검: 봇 장부 수량 > 실제 보유 수량이면 경고(사용자가 직접 팔았을 수 있음)
  for (const b of bots.filter((x) => x.mode === 'LIVE')) {
    const pos = positions.get(b.id, b.marketCode);
    const actual = account.coinAvailable(baseCurrency(b.marketCode));
    if (actual == null) continue;
    const lockedInOrders = repo
      .listActiveOrders({ botId: b.id })
      .filter((o) => o.side === 'ask')
      .reduce((a, o) => a.plus(o.remainingVolume ?? 0), D(0));
    if (D(pos.quantity).gt(D(actual).plus(lockedInOrders).plus('0.00000001'))) {
      const msg = `bot#${b.id} 장부상 보유 ${pos.quantity}개보다 실제 보유가 적어요(${actual}). 업비트에서 직접 매도했다면 봇의 매도 주문은 실제 수량까지만 나갑니다.`;
      notes.push(msg);
      log.warn('POSITION', msg);
    }
  }

  log.info('SYSTEM', `재시작 복구 완료${notes.length ? ` — 확인 필요 ${notes.length}건` : ''}`);
  return notes;
}
