import crypto from 'node:crypto';

/**
 * 업비트 JWT 인증 (docs/upbit-reference/reference_auth.md)
 * - header: {"alg":"HS512","typ":"JWT"}  (HS512 권장)
 * - payload: access_key, nonce(UUID), [query_hash(SHA512 hex), query_hash_alg:"SHA512"]
 * - signature: HMAC-SHA512(base64url(header).base64url(payload), SecretKey) — Secret Key는 base64 디코딩하지 않는다.
 * - query_hash 입력: GET/DELETE는 "URL 인코딩 전" 실제 쿼리 문자열(순서 유지),
 *   배열 파라미터는 key[]=a&key[]=b 형식, POST는 JSON 본문을 k=v&k=v 로 변환한 문자열.
 */

export type QueryValue = string | number | boolean | null | undefined | Array<string | number>;
export type QueryParams = Record<string, QueryValue>;

function pairs(params: QueryParams): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      if (key.endsWith('[]')) {
        for (const v of value) out.push([key, String(v)]);
      } else {
        // pairs, quote_currencies 처럼 [] 없는 키는 쉼표로 연결
        if (value.length) out.push([key, value.join(',')]);
      }
    } else {
      out.push([key, String(value)]);
    }
  }
  return out;
}

/** 해시용: URL 인코딩하지 않은 쿼리 문자열 */
export function buildRawQuery(params: QueryParams): string {
  return pairs(params)
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
}

/** 실제 요청 URL용: 값은 인코딩하고 키의 '[]'는 인코딩하지 않는다(문서 규칙) */
export function buildEncodedQuery(params: QueryParams): string {
  return pairs(params)
    .map(([k, v]) => `${encodeURIComponent(k).replace(/%5B%5D/g, '[]')}=${encodeURIComponent(v)}`)
    .join('&');
}

const b64url = (buf: Buffer | string) => Buffer.from(buf).toString('base64url');

export function sha512Hex(text: string): string {
  return crypto.createHash('sha512').update(text, 'utf8').digest('hex');
}

export function createJwt(accessKey: string, secretKey: string, rawQuery = ''): string {
  if (!accessKey || !secretKey) throw new Error('API Key가 설정되어 있지 않습니다.');
  const header = { alg: 'HS512', typ: 'JWT' };
  const payload: Record<string, string> = { access_key: accessKey, nonce: crypto.randomUUID() };
  if (rawQuery) {
    payload.query_hash = sha512Hex(rawQuery);
    payload.query_hash_alg = 'SHA512';
  }
  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const signature = crypto.createHmac('sha512', secretKey).update(signingInput).digest('base64url');
  return `${signingInput}.${signature}`;
}

/** 테스트/디버그용: JWT payload 디코드(서명 검증 없음) */
export function decodeJwtPayload(token: string): Record<string, string> {
  const [, payload] = token.split('.');
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
}

export function verifyJwt(token: string, secretKey: string): boolean {
  const [h, p, s] = token.split('.');
  const expected = crypto.createHmac('sha512', secretKey).update(`${h}.${p}`).digest('base64url');
  return crypto.timingSafeEqual(Buffer.from(s), Buffer.from(expected));
}
