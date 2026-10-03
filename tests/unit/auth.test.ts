import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { buildEncodedQuery, buildRawQuery, createJwt, decodeJwtPayload, sha512Hex, verifyJwt } from '../../server/upbit/auth';
import { redact, registerSecret } from '../../server/lib/logger';

describe('쿼리 문자열 (reference_auth.md 규칙)', () => {
  it('배열은 key[]=a&key[]=b, 순서 유지, 인코딩 안 함', () => {
    expect(buildRawQuery({ market: 'KRW-BTC', 'states[]': ['wait', 'watch'], limit: 10 })).toBe('market=KRW-BTC&states[]=wait&states[]=watch&limit=10');
  });
  it('[] 없는 배열 키는 쉼표 연결', () => {
    expect(buildRawQuery({ markets: ['KRW-BTC', 'KRW-ETH'] })).toBe('markets=KRW-BTC,KRW-ETH');
  });
  it('undefined/null은 제외', () => {
    expect(buildRawQuery({ uuid: undefined, identifier: 'BOT-1', x: null })).toBe('identifier=BOT-1');
  });
  it('URL용은 값만 인코딩하고 []는 그대로', () => {
    expect(buildEncodedQuery({ 'uuids[]': ['a b'], markets: ['KRW-BTC', 'KRW-ETH'] })).toBe('uuids[]=a%20b&markets=KRW-BTC%2CKRW-ETH');
  });
});

describe('JWT (HS512)', () => {
  const access = 'a7Xd92LmQW3vBtRzYpMj5CxNKeT1HuVs0fFgJcAw';
  const secret = 'test-secret-key-not-real-0123456789';

  it('파라미터가 없으면 query_hash 없음', () => {
    const t = createJwt(access, secret);
    const p = decodeJwtPayload(t);
    expect(p.access_key).toBe(access);
    expect(p.nonce).toMatch(/^[0-9a-f-]{36}$/);
    expect(p.query_hash).toBeUndefined();
    expect(JSON.parse(Buffer.from(t.split('.')[0], 'base64url').toString())).toEqual({ alg: 'HS512', typ: 'JWT' });
  });
  it('query_hash = SHA512(원문 쿼리)', () => {
    const q = 'market=KRW-BTC&side=bid&volume=0.001&price=50000000&ord_type=limit';
    const p = decodeJwtPayload(createJwt(access, secret, q));
    expect(p.query_hash).toBe(crypto.createHash('sha512').update(q).digest('hex'));
    expect(p.query_hash).toBe(sha512Hex(q));
    expect(p.query_hash_alg).toBe('SHA512');
  });
  it('서명은 Secret Key(디코딩 없이)로 HMAC-SHA512', () => {
    const t = createJwt(access, secret, 'a=1');
    expect(verifyJwt(t, secret)).toBe(true);
    expect(verifyJwt(t, secret + 'x')).toBe(false);
  });
  it('nonce는 매 요청마다 다름', () => {
    expect(decodeJwtPayload(createJwt(access, secret)).nonce).not.toBe(decodeJwtPayload(createJwt(access, secret)).nonce);
  });
});

describe('로그 비밀정보 가리기', () => {
  it('등록된 Secret과 토큰/민감 키를 가린다', () => {
    registerSecret('super-secret-value-123');
    expect(redact('key=super-secret-value-123 ok')).toBe('key=*** ok');
    expect(redact('Authorization: Bearer abc.def.ghi')).toBe('Authorization: Bearer ***');
    expect(redact({ secretKey: 'x', nested: { authorization: 'y', ok: 1 } })).toEqual({ secretKey: '***', nested: { authorization: '***', ok: 1 } });
  });
});
