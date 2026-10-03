/**
 * 업비트 API 오류 → 초보자용 메시지.
 * 원문 오류(name/message/status)는 내부 로그에 그대로 남기고, 화면에는 friendlyMessage만 보여준다.
 * 출처: docs/upbit-reference/clean/reference_rest-api-guide.md 의 에러 코드 표 + 각 API 문서의 에러 예시
 */

export class UpbitApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    public readonly upbitMessage: string,
    public readonly endpoint: string,
  ) {
    super(`[${status}] ${code}: ${upbitMessage}`);
    this.name = 'UpbitApiError';
  }
  get friendlyMessage(): string {
    return friendlyUpbitError(this.code, this.status);
  }
}

/** 네트워크 오류/타임아웃. maybeProcessed=true면 서버가 요청을 처리했을 수도 있음(POST 주문) */
export class UpbitNetworkError extends Error {
  constructor(
    message: string,
    public readonly endpoint: string,
    public readonly maybeProcessed: boolean,
  ) {
    super(message);
    this.name = 'UpbitNetworkError';
  }
  get friendlyMessage(): string {
    return NETWORK_MESSAGE;
  }
}

export class UpbitRateLimitError extends Error {
  constructor(
    public readonly group: string,
    public readonly retryAfterMs: number,
    public readonly blocked: boolean,
  ) {
    super(`rate limited (${group}) retry after ${retryAfterMs}ms${blocked ? ' [418 blocked]' : ''}`);
    this.name = 'UpbitRateLimitError';
  }
  get friendlyMessage(): string {
    return this.blocked
      ? '요청이 너무 많아 업비트가 잠시 접속을 막았어요. 잠시 후 자동으로 다시 시도해요.'
      : '요청이 너무 많아 잠깐 쉬었다가 다시 시도해요.';
  }
}

export const NETWORK_MESSAGE = '업비트와 연결이 잠시 끊어졌습니다. 다시 연결하고 있습니다.';

const MESSAGES: Record<string, string> = {
  insufficient_funds_bid: '매수할 원화가 부족합니다.',
  insufficient_funds_ask: '매도할 코인이 부족합니다.',
  under_min_total_bid: '최소 주문 금액보다 작아서 살 수 없어요.',
  under_min_total_ask: '최소 주문 금액보다 작아서 팔 수 없어요.',
  over_krw_funds_bid: '한 번에 주문할 수 있는 최대 금액을 넘었어요.',
  over_krw_funds_ask: '한 번에 주문할 수 있는 최대 금액을 넘었어요.',
  invalid_query_payload: 'API Key 인증에 실패했어요. Access Key와 Secret Key가 짝이 맞는지 확인해 주세요.',
  jwt_verification: 'API Key 인증에 실패했어요. Access Key와 Secret Key가 짝이 맞는지 확인해 주세요.',
  expired_access_key: 'API Key가 만료되었어요. 업비트에서 새로 발급해 주세요.',
  nonce_used: '인증 요청이 중복되었어요. 잠시 후 다시 시도할게요.',
  no_authorization_ip: '이 PC의 IP 주소가 API Key의 허용 IP에 등록되어 있지 않아요. 업비트 Open API 관리에서 IP를 추가해 주세요.',
  no_authorization_token: '인증 정보가 없어요. API Key를 등록해 주세요.',
  out_of_scope: '현재 API Key에 이 기능을 사용할 권한이 없습니다.',
  market_offline: '현재 이 코인은 거래할 수 없는 상태입니다. (업비트 점검 중)',
  notfoundmarket: '업비트에 없는 코인(마켓)이에요.',
  order_not_found: '주문을 찾을 수 없어요.',
  duplicated_identifier: '같은 주문 번호가 이미 있어서 중복 주문을 막았어요.',
  invalid_time_in_force: '주문 조건이 올바르지 않아요.',
  create_ask_error: '매도 주문 정보가 올바르지 않아요.',
  create_bid_error: '매수 주문 정보가 올바르지 않아요.',
  validation_error: '주문 정보가 올바르지 않아요.',
  invalid_parameter: '요청 값이 올바르지 않아요.',
  invaild_parameter: '요청 값이 올바르지 않아요.',
  bad_request: '요청 값이 올바르지 않아요.',
  QUERY_PARAMETER_NOT_SUPPORTED: '요청 형식이 올바르지 않아요.',
  currency_not_found: '해당 자산을 찾을 수 없어요.',
  pocket_not_found: '포켓을 찾을 수 없어요.',
};

export function friendlyUpbitError(code: string, status?: number): string {
  if (code && MESSAGES[code]) return MESSAGES[code];
  if (status === 401) return 'API Key 인증에 실패했어요. Key를 다시 확인해 주세요.';
  if (status === 403) return '현재 API Key에 이 기능을 사용할 권한이 없습니다.';
  if (status === 404) return '요청한 정보를 찾을 수 없어요.';
  if (status === 418) return '요청이 너무 많아 업비트가 잠시 접속을 막았어요. 잠시 후 다시 시도해요.';
  if (status === 429) return '요청이 너무 많아 잠깐 쉬었다가 다시 시도해요.';
  if (status && status >= 500) return '업비트 서버에 일시적인 문제가 있어요. 잠시 후 다시 시도해요.';
  return '업비트 요청 중 알 수 없는 오류가 발생했어요.';
}

/** 어떤 오류든 화면용 메시지로 */
export function toFriendly(err: unknown): string {
  if (err instanceof UpbitApiError || err instanceof UpbitNetworkError || err instanceof UpbitRateLimitError) {
    return err.friendlyMessage;
  }
  if (err instanceof Error && err.message) return err.message;
  return '알 수 없는 오류가 발생했어요.';
}
