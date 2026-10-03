import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Env } from '../config/env';
import type { Repo } from '../db/repositories';
import { log, registerSecret, unregisterSecret } from '../lib/logger';
import type { Credentials } from '../upbit/rest';

/**
 * API Key 보관.
 * - Secret Key는 서버 측에서만 사용. 어떤 API 응답에도 포함하지 않는다.
 * - 화면에서 등록한 Key는 AES-256-GCM으로 암호화해 DB에 저장(마스터 키: APP_ENCRYPTION_KEY 또는 data/master.key).
 * - .env 의 UPBIT_ACCESS_KEY/UPBIT_SECRET_KEY 도 지원(DB 등록 Key가 우선).
 * - 로거에 비밀값을 등록해 혹시 로그에 섞여도 *** 로 가려지게 한다.
 */
export class CredentialService {
  private cached: Credentials | null = null;
  private source: 'DB' | 'ENV' | null = null;
  private masterKey: Buffer | null = null;
  private listeners = new Set<() => void>();

  constructor(
    private readonly repo: Repo,
    private readonly env: Env,
  ) {
    this.reload();
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private getMasterKey(): Buffer {
    if (this.masterKey) return this.masterKey;
    if (/^[0-9a-fA-F]{64}$/.test(this.env.encryptionKeyHex)) {
      this.masterKey = Buffer.from(this.env.encryptionKeyHex, 'hex');
      return this.masterKey;
    }
    const file = path.join(this.env.dataDir, 'master.key');
    try {
      const hex = fs.readFileSync(file, 'utf8').trim();
      if (/^[0-9a-fA-F]{64}$/.test(hex)) {
        this.masterKey = Buffer.from(hex, 'hex');
        return this.masterKey;
      }
    } catch {
      /* 없으면 생성 */
    }
    fs.mkdirSync(this.env.dataDir, { recursive: true });
    const key = crypto.randomBytes(32);
    fs.writeFileSync(file, key.toString('hex'), { mode: 0o600 });
    log.info('SYSTEM', 'Secret Key 암호화용 마스터 키를 data/master.key 에 생성했습니다 (git 제외 폴더).');
    this.masterKey = key;
    return key;
  }

  reload(): void {
    const prev = this.cached;
    this.cached = null;
    this.source = null;
    const rec = this.repo.getActiveCredential();
    if (rec) {
      try {
        const decipher = crypto.createDecipheriv('aes-256-gcm', this.getMasterKey(), Buffer.from(rec.iv, 'hex'));
        decipher.setAuthTag(Buffer.from(rec.tag, 'hex'));
        const secret = Buffer.concat([decipher.update(Buffer.from(rec.secretKeyEnc, 'hex')), decipher.final()]).toString('utf8');
        this.cached = { accessKey: rec.accessKey, secretKey: secret };
        this.source = 'DB';
      } catch {
        log.error('SYSTEM', '저장된 API Key를 복호화하지 못했습니다(마스터 키가 바뀌었을 수 있음). API Key를 다시 등록해 주세요.');
      }
    }
    if (!this.cached && this.env.upbitAccessKey && this.env.upbitSecretKey) {
      this.cached = { accessKey: this.env.upbitAccessKey, secretKey: this.env.upbitSecretKey };
      this.source = 'ENV';
    }
    if (prev && prev.secretKey !== this.cached?.secretKey) unregisterSecret(prev.secretKey);
    if (this.cached) {
      registerSecret(this.cached.secretKey);
    }
  }

  get(): Credentials | null {
    return this.cached;
  }

  getSource(): 'DB' | 'ENV' | null {
    return this.source;
  }

  /** 화면 표시용 마스킹(앞 4 + 뒤 4) */
  maskedAccessKey(): string | null {
    const k = this.cached?.accessKey;
    if (!k) return null;
    return k.length <= 8 ? '****' : `${k.slice(0, 4)}****${k.slice(-4)}`;
  }

  save(accessKey: string, secretKey: string): void {
    const a = accessKey.trim();
    const sec = secretKey.trim();
    if (!/^[A-Za-z0-9]{20,100}$/.test(a)) throw new Error('Access Key 형식이 올바르지 않아요.');
    if (sec.length < 20 || sec.length > 200 || /\s/.test(sec)) throw new Error('Secret Key 형식이 올바르지 않아요.');
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.getMasterKey(), iv);
    const enc = Buffer.concat([cipher.update(sec, 'utf8'), cipher.final()]);
    this.repo.replaceCredential({ accessKey: a, secretKeyEnc: enc.toString('hex'), iv: iv.toString('hex'), tag: cipher.getAuthTag().toString('hex') });
    this.reload();
    log.info('SYSTEM', `API Key가 교체되었습니다 (Access Key ${this.maskedAccessKey()})`);
    for (const l of this.listeners) l();
  }

  clear(): void {
    this.repo.deleteCredentials();
    this.reload();
    log.info('SYSTEM', '화면에서 등록한 API Key를 삭제했습니다.');
    for (const l of this.listeners) l();
  }
}
