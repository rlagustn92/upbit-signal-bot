import { describe, expect, it } from 'vitest';
import { isAllowedHost } from '../../server/api/routes';

describe('isAllowedHost (폰 접속용 Tailscale 허용)', () => {
  it('로컬 주소 허용', () => {
    expect(isAllowedHost('127.0.0.1:8787')).toBe(true);
    expect(isAllowedHost('localhost:5173')).toBe(true);
    expect(isAllowedHost('[::1]:8787')).toBe(true);
  });
  it('Tailscale *.ts.net 허용', () => {
    expect(isAllowedHost('my-pc.tail1234.ts.net')).toBe(true);
    expect(isAllowedHost('My-PC.tail1234.ts.net:443')).toBe(true);
  });
  it('그 밖의 주소 거부(DNS 리바인딩 방지)', () => {
    expect(isAllowedHost('evil.com')).toBe(false);
    expect(isAllowedHost('ts.net.evil.com')).toBe(false);
    expect(isAllowedHost('evilts.net')).toBe(false);
    expect(isAllowedHost('192.168.0.10:8787')).toBe(false);
    expect(isAllowedHost('')).toBe(false);
  });
  it('ALLOWED_HOSTS로 추가 허용', () => {
    expect(isAllowedHost('192.168.0.10:8787', ['192.168.0.10'])).toBe(true);
  });
});
