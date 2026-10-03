import type { Env } from '../config/env';
import { log } from '../lib/logger';
import { createJwt } from '../upbit/auth';
import type { WsMyAsset, WsMyOrder } from '../upbit/types';
import { ManagedSocket } from '../upbit/websocket';
import type { AccountService } from './account';
import type { CredentialService } from './credentials';
import type { OrderService } from './orders';
import type { SystemService } from './system';

/**
 * Private WebSocket — 연결 1개에서 myOrder + myAsset 을 함께 구독(문서 권장: 불필요한 다중 연결 금지).
 * 인증: 연결할 때마다 새 JWT(Authorization 헤더). 주문/자산 변동이 없으면 메시지가 오지 않는 것이 정상이므로
 * 무수신 타임아웃은 두지 않고 ping/pong으로 연결을 확인한다.
 */
export class PrivateStream {
  readonly socket: ManagedSocket;
  receivedMyOrder = false;
  receivedMyAsset = false;

  constructor(
    env: Env,
    private readonly creds: CredentialService,
    private readonly orders: OrderService,
    private readonly account: AccountService,
    private readonly system: SystemService,
  ) {
    this.socket = new ManagedSocket({
      name: 'private',
      url: env.upbitWsPrivate,
      getHeaders: () => {
        const c = this.creds.get();
        if (!c) return null;
        return { Authorization: `Bearer ${createJwt(c.accessKey, c.secretKey)}` };
      },
      buildSubscription: () => (this.creds.get() ? [{ type: 'myOrder' }, { type: 'myAsset' }] : []),
      onMessage: (m) => this.onMessage(m),
      onStatus: (s, detail) => {
        this.system.setPrivate(s);
        if (s === 'AUTH_FAILED') log.error('WEBSOCKET', `Private WebSocket 인증 실패(${detail ?? ''}) — API Key를 확인해 주세요.`);
      },
    });
  }

  start(): void {
    if (this.creds.get()) this.socket.start();
  }

  restart(): void {
    if (this.creds.get()) this.socket.restart();
    else this.socket.stop();
  }

  stop(): void {
    this.socket.stop();
  }

  private onMessage(m: Record<string, unknown>): void {
    this.system.lastPrivateMessageAt = Date.now();
    if (m.type === 'myOrder') {
      this.receivedMyOrder = true;
      void this.orders.handleMyOrder(m as unknown as WsMyOrder).catch((e) => log.error('ORDER', `myOrder 처리 오류: ${(e as Error).message}`));
    } else if (m.type === 'myAsset') {
      this.receivedMyAsset = true;
      this.account.applyMyAsset(m as unknown as WsMyAsset);
    }
  }
}
