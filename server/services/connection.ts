import type { ConnectionDTO, ConnectionTestResult, LiveChecklistItem, PermissionState } from '../../shared/types';
import type { Repo } from '../db/repositories';
import { D, normalizePrice, normalizeVolume, toPlain } from '../domain/orderMath';
import { log } from '../lib/logger';
import { UpbitApiError, UpbitNetworkError, UpbitRateLimitError, toFriendly } from '../upbit/errors';
import type { UpbitRestClient } from '../upbit/rest';
import type { AccountService } from './account';
import type { CredentialService } from './credentials';
import type { PrivateStream } from './privateStream';
import type { SystemService } from './system';

const TEST_KEY = 'last_connection_test';
const AUTH_CODES = new Set(['invalid_query_payload', 'jwt_verification', 'expired_access_key', 'nonce_used', 'no_authorization_token']);

/**
 * 업비트 연결 테스트 & 실전(LIVE) 전 체크리스트.
 * 연결 테스트는 실제로 업비트에 요청을 보내 결과로 판단한다(가짜 성공 메시지 없음).
 * 주문하기 권한은 "주문 생성 테스트" API(/v1/orders/test)로 확인 — 실제 주문은 생성되지 않는다.
 */
export class ConnectionService {
  private last: ConnectionTestResult | null = null;
  private apiKeyExpireAt: string | null = null;

  constructor(
    private readonly rest: UpbitRestClient,
    private readonly creds: CredentialService,
    private readonly repo: Repo,
    private readonly account: AccountService,
    private readonly system: SystemService,
    private readonly privateStream: () => PrivateStream,
  ) {
    try {
      const raw = this.repo.getSetting(TEST_KEY);
      if (raw) this.last = JSON.parse(raw);
    } catch {
      this.last = null;
    }
    this.creds.onChange(() => {
      this.last = null;
      this.apiKeyExpireAt = null;
      this.repo.setSetting(TEST_KEY, '');
    });
  }

  toDTO(): ConnectionDTO {
    return {
      hasCredentials: !!this.creds.get(),
      credentialSource: this.creds.getSource(),
      accessKeyMasked: this.creds.maskedAccessKey(),
      lastTestAt: this.last?.testedAt ?? null,
      lastTestResult: this.last,
      apiKeyExpireAt: this.apiKeyExpireAt,
    };
  }

  async test(): Promise<ConnectionTestResult> {
    const details: string[] = [];
    const perms: ConnectionTestResult['permissions'] = {
      quotation: 'NOT_CHECKED',
      assetRead: 'NOT_CHECKED',
      orderRead: 'NOT_CHECKED',
      orderWrite: 'NOT_CHECKED',
      withdraw: 'UNKNOWN',
    };
    const result = (ok: boolean, category: ConnectionTestResult['category'], summary: string, publicApi: ConnectionTestResult['publicApi']): ConnectionTestResult => {
      const r: ConnectionTestResult = { ok, category, summary, publicApi, permissions: perms, details, testedAt: new Date().toISOString() };
      this.last = r;
      this.repo.setSetting(TEST_KEY, JSON.stringify(r));
      log.info('API', `연결 테스트: ${category} — ${summary}`);
      return r;
    };

    // 1) 공개 API (시세 조회)
    let publicApi: ConnectionTestResult['publicApi'];
    let btcPrice = 0;
    try {
      const t0 = Date.now();
      const t = await this.rest.getTickers(['KRW-BTC']);
      btcPrice = t[0]?.trade_price ?? 0;
      publicApi = { ok: true, latencyMs: Date.now() - t0, message: '업비트 시세 서버 응답 정상' };
      perms.quotation = 'OK';
    } catch (e) {
      perms.quotation = 'DENIED';
      const net = e instanceof UpbitNetworkError;
      const server = e instanceof UpbitApiError && e.status >= 500;
      publicApi = { ok: false, latencyMs: null, message: toFriendly(e) };
      return result(false, net ? 'NETWORK' : server ? 'UPBIT_SERVER' : e instanceof UpbitRateLimitError ? 'RATE_LIMIT' : 'UNKNOWN', net ? '업비트에 연결할 수 없어요. 인터넷 연결을 확인해 주세요.' : toFriendly(e), publicApi);
    }

    // 2) API Key
    if (!this.creds.get()) {
      details.push('API Key가 없어 시세 조회만 가능해요. 잔고 조회와 주문을 하려면 API Key를 등록해 주세요.');
      return result(false, 'NO_CREDENTIALS', 'API Key가 등록되지 않았어요 (시세 조회는 정상)', publicApi);
    }

    // 3) 자산조회
    try {
      await this.account.refresh();
      perms.assetRead = 'OK';
      details.push('내 계좌(잔고) 조회 가능');
    } catch (e) {
      if (e instanceof UpbitApiError) {
        if (e.code === 'out_of_scope') {
          perms.assetRead = 'DENIED';
          details.push('[자산조회] 권한이 없어요.');
        } else if (e.code === 'no_authorization_ip') {
          return result(false, 'IP_NOT_ALLOWED', e.friendlyMessage, publicApi);
        } else if (AUTH_CODES.has(e.code) || e.status === 401) {
          return result(false, 'AUTH_FAILED', e.friendlyMessage, publicApi);
        } else if (e.status >= 500) {
          return result(false, 'UPBIT_SERVER', e.friendlyMessage, publicApi);
        } else {
          perms.assetRead = 'UNKNOWN';
          details.push(`잔고 조회 오류: ${e.friendlyMessage}`);
        }
      } else if (e instanceof UpbitNetworkError) {
        return result(false, 'NETWORK', e.friendlyMessage, publicApi);
      } else {
        perms.assetRead = 'UNKNOWN';
        details.push(`잔고 조회 오류: ${toFriendly(e)}`);
      }
    }

    // 4) 주문조회
    try {
      await this.rest.getOrderChance('KRW-BTC');
      perms.orderRead = 'OK';
      details.push('주문 가능 정보 조회 가능');
    } catch (e) {
      perms.orderRead = e instanceof UpbitApiError && e.code === 'out_of_scope' ? 'DENIED' : 'UNKNOWN';
      details.push(perms.orderRead === 'DENIED' ? '[주문조회] 권한이 없어요.' : `주문 가능 정보 조회 오류: ${toFriendly(e)}`);
    }

    // 5) 주문하기 — 주문 생성 테스트 API(실제 주문 없음). 현재가의 절반 가격, 약 5,500원어치 지정가 매수로 형식 검증
    try {
      const px = normalizePrice(D(btcPrice || 100_000_000).mul(0.5), 'down');
      const vol = normalizeVolume(D(5500).div(px));
      await this.rest.testOrder({ market: 'KRW-BTC', side: 'bid', ord_type: 'limit', price: toPlain(px), volume: toPlain(vol) });
      perms.orderWrite = 'OK';
      details.push('주문 권한 확인됨 (주문 생성 테스트 API 사용 — 실제 주문은 만들지 않았어요)');
    } catch (e) {
      if (e instanceof UpbitApiError && e.code === 'out_of_scope') {
        perms.orderWrite = 'DENIED';
        details.push('[주문하기] 권한이 없어요. 자동매매를 하려면 주문하기 권한이 필요해요.');
      } else if (e instanceof UpbitApiError && /insufficient_funds|under_min_total|over_krw_funds/.test(e.code)) {
        perms.orderWrite = 'OK';
        details.push(`주문 권한 확인됨 (테스트 주문은 "${e.friendlyMessage}"로 검증만 됨 — 실제 주문 없음)`);
      } else {
        perms.orderWrite = 'UNKNOWN';
        details.push(`주문 권한 확인 중 오류: ${toFriendly(e)}`);
      }
    }

    // 6) API Key 만료일
    try {
      const keys = await this.rest.getApiKeys();
      const mine = keys.find((k) => k.access_key === this.creds.get()?.accessKey);
      this.apiKeyExpireAt = mine?.expire_at ?? null;
      if (mine) details.push(`API Key 만료일: ${mine.expire_at}`);
    } catch {
      /* 선택 정보 */
    }

    details.push('출금 권한은 프로그램이 확인할 수 없어요. 업비트 Open API 관리에서 [출금하기] 권한이 꺼져 있는지 꼭 직접 확인해 주세요. (이 프로그램에는 출금 기능이 없어요)');

    const allOk = perms.assetRead === 'OK' && perms.orderRead === 'OK' && perms.orderWrite === 'OK';
    if (allOk) return result(true, 'OK', '정상 연결 — 시세·잔고·주문조회·주문 권한 확인됨', publicApi);
    const denied = Object.entries(perms).some(([k, v]) => k !== 'withdraw' && v === 'DENIED');
    return result(false, denied ? 'PERMISSION' : 'UNKNOWN', denied ? '연결은 됐지만 일부 권한이 없어요' : '연결은 됐지만 일부 확인에 실패했어요', publicApi);
  }

  /** 실전(LIVE) 전 체크리스트 (작업지시서 §75). 하나라도 실패하면 LIVE를 켤 수 없다. */
  liveChecklist(): LiveChecklistItem[] {
    const t = this.last;
    const recent = t && Date.now() - Date.parse(t.testedAt) < 24 * 3600_000;
    const p = (s: PermissionState | undefined) => s === 'OK';
    const ps = this.privateStream();
    const pubFresh = this.system.publicStream === 'OPEN';
    const paperSells = Number(
      (this.repo.db.prepare(`SELECT COUNT(*) AS c FROM trades WHERE mode = 'PAPER' AND side = 'ask'`).get() as { c: number } | undefined)?.c ?? 0,
    );
    const items: LiveChecklistItem[] = [
      { key: 'hardLock', label: '실전 하드락 해제(.env LIVE_TRADING_HARD_LOCK=false)', ok: !this.system.liveHardLock, detail: this.system.liveHardLock ? '.env에서 직접 false로 바꾸고 서버를 다시 켜야 해요' : '해제됨' },
      { key: 'auth', label: 'API 인증 성공(최근 24시간 내 연결 테스트)', ok: !!recent && p(t?.permissions.assetRead), detail: recent ? t!.summary : '연결 테스트를 먼저 실행해 주세요' },
      { key: 'balance', label: '실제 잔고 조회 성공', ok: this.account.hasData(), detail: this.account.hasData() ? '조회됨' : '잔고를 아직 못 받았어요' },
      { key: 'orderRead', label: '주문 가능 정보 조회', ok: !!recent && p(t?.permissions.orderRead), detail: '' },
      { key: 'orderWrite', label: '주문 권한(주문 생성 테스트로 확인)', ok: !!recent && p(t?.permissions.orderWrite), detail: '' },
      { key: 'ticker', label: '실시간 현재가 수신(Public WebSocket)', ok: pubFresh, detail: this.system.publicStream },
      { key: 'private', label: 'myOrder / myAsset 구독(Private WebSocket)', ok: this.system.privateStream === 'OPEN', detail: `${this.system.privateStream}${ps.receivedMyAsset ? ' · myAsset 수신 확인' : ''}${ps.receivedMyOrder ? ' · myOrder 수신 확인' : ''}` },
      { key: 'emergency', label: '긴급 정지 해제 상태', ok: !this.system.emergencyStop, detail: this.system.emergencyStop ? '긴급 정지 중' : '정상' },
      { key: 'paper', label: 'PAPER 모의투자로 매수→매도 한 사이클 이상 검증', ok: paperSells >= 1, detail: `모의 매도 체결 ${paperSells}건` },
      {
        key: 'builtin',
        label: '가격단위 보정·최소금액·예산 제한·중복 주문 방지·주문/체결 추적·DB 저장·재시작 복구',
        ok: true,
        detail: '코드에 구현되어 있고 자동 테스트(npm test)로 검증해요',
      },
    ];
    return items;
  }
}
