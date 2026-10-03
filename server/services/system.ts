import type { StreamStatus, SystemStatus } from '../../shared/types';
import type { Env } from '../config/env';
import type { Repo } from '../db/repositories';
import type { Bus } from '../lib/bus';
import { log } from '../lib/logger';

/**
 * 시스템 전체 상태.
 * SYSTEM_ONLINE: 정상 / CONNECTING: 연결 중 / DEGRADED: 일부 기능 문제(예: Private WS 인증 실패)
 * DISCONNECTED: 시세 연결 끊김 / EMERGENCY_STOP: 긴급 정지 중
 */
export class SystemService {
  publicStream: StreamStatus = 'IDLE';
  privateStream: StreamStatus = 'IDLE';
  lastPublicMessageAt: number | null = null;
  lastPrivateMessageAt: number | null = null;
  message: string | null = null;

  constructor(
    private readonly repo: Repo,
    private readonly env: Env,
    private readonly bus: Bus,
  ) {}

  get emergencyStop(): boolean {
    return this.repo.getSetting('emergency_stop') === '1';
  }

  setEmergencyStop(on: boolean): void {
    this.repo.setSetting('emergency_stop', on ? '1' : '0');
    log.warn('SYSTEM', on ? '🛑 긴급 정지 활성화 — 신규 주문 전면 차단' : '긴급 정지 해제');
    this.bus.emitTyped('changed');
  }

  get liveHardLock(): boolean {
    return this.env.liveHardLock;
  }

  /** 사용자가 LIVE 확인창을 통과해 실전 매매를 허용했는지(하드락이 걸려 있으면 의미 없음) */
  get liveEnabled(): boolean {
    return !this.env.liveHardLock && this.repo.getSetting('live_enabled') === '1';
  }

  setLiveEnabled(on: boolean): void {
    this.repo.setSetting('live_enabled', on ? '1' : '0');
    log.warn('SYSTEM', on ? '실전 매매(LIVE) 허용됨' : '실전 매매(LIVE) 비활성화');
    this.bus.emitTyped('changed');
  }

  setPublic(s: StreamStatus): void {
    this.publicStream = s;
    this.bus.emitTyped('changed');
  }

  setPrivate(s: StreamStatus): void {
    this.privateStream = s;
    this.bus.emitTyped('changed');
  }

  status(hasCredentials: boolean): SystemStatus {
    if (this.emergencyStop) return 'EMERGENCY_STOP';
    if (this.publicStream === 'OPEN') {
      if (hasCredentials && (this.privateStream === 'AUTH_FAILED' || this.privateStream === 'RECONNECTING')) return 'DEGRADED';
      return 'SYSTEM_ONLINE';
    }
    if (this.publicStream === 'IDLE') return 'SYSTEM_ONLINE'; // 구독할 시세가 없을 때
    if (this.publicStream === 'CONNECTING') return 'CONNECTING';
    return 'DISCONNECTED';
  }
}
