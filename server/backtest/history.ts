import fs from 'node:fs';
import path from 'node:path';
import type { CandleUnit } from '../../shared/types';
import type { Bar } from '../indicators';
import type { MinuteUnit, UpbitRestClient } from '../upbit/rest';
import type { UpbitCandle } from '../upbit/types';

export const UNIT_MS: Record<CandleUnit, number> = {
  '1m': 60_000,
  '3m': 180_000,
  '5m': 300_000,
  '10m': 600_000,
  '15m': 900_000,
  '30m': 1_800_000,
  '60m': 3_600_000,
  '240m': 14_400_000,
  '1d': 86_400_000,
};

const utcMs = (s: string) => Date.parse(s.endsWith('Z') ? s : `${s}Z`);
/** 업비트 candles `to` 형식: 2025-06-24T04:56:53Z (UTC, 밀리초 없음) */
const toParam = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');

function toBar(c: UpbitCandle): Bar {
  return {
    start: utcMs(c.candle_date_time_utc),
    open: c.opening_price ?? c.trade_price,
    high: c.high_price ?? c.trade_price,
    low: c.low_price ?? c.trade_price,
    close: c.trade_price,
    volume: c.candle_acc_trade_volume ?? 0,
  };
}

export interface HistoryOptions {
  /** 캐시 폴더(없으면 캐시 안 함) */
  cacheDir?: string;
  onProgress?: (loaded: number, total: number) => void;
  now?: number;
}

/**
 * 과거 캔들 [fromMs, 지금) 를 업비트 REST로 받아온다(200개씩 과거로 페이지 이동).
 * 같은 마켓/단위는 data/backtest-cache 에 저장해 두고, 다음에는 모자란 앞/뒤 구간만 받는다.
 * 아직 닫히지 않은 마지막 캔들은 뺀다.
 */
export async function loadHistory(rest: UpbitRestClient, market: string, unit: CandleUnit, fromMs: number, opts: HistoryOptions = {}): Promise<Bar[]> {
  const unitMs = UNIT_MS[unit];
  const now = opts.now ?? Date.now();
  const lastClosedStart = Math.floor(now / unitMs) * unitMs - unitMs;
  const file = opts.cacheDir ? path.join(opts.cacheDir, `${market}_${unit}.json`) : null;

  let cached: Bar[] = [];
  if (file && fs.existsSync(file)) {
    try {
      cached = JSON.parse(fs.readFileSync(file, 'utf8')) as Bar[];
    } catch {
      cached = [];
    }
  }

  const byStart = new Map<number, Bar>(cached.map((b) => [b.start, b]));
  const total = Math.max(1, Math.ceil((lastClosedStart - fromMs) / unitMs));
  let loaded = cached.filter((b) => b.start >= fromMs).length;

  /** endMs(포함 안 함)부터 과거로 stopMs까지 받기 */
  const fetchBack = async (endMs: number, stopMs: number) => {
    let to = endMs;
    for (let guard = 0; guard < 5000 && to > stopMs; guard++) {
      const raw = unit === '1d' ? await rest.getDayCandles(market, 200, toParam(to)) : await rest.getMinuteCandles(Number(unit.replace('m', '')) as MinuteUnit, market, 200, toParam(to));
      if (!raw.length) break;
      let oldest = Infinity;
      for (const c of raw) {
        const b = toBar(c);
        if (!byStart.has(b.start)) loaded++;
        byStart.set(b.start, b);
        oldest = Math.min(oldest, b.start);
      }
      opts.onProgress?.(Math.min(loaded, total), total);
      if (!(oldest < to)) break;
      to = oldest;
      if (raw.length < 200) break; // 상장 이전까지 도달
    }
  };

  const cachedMin = cached.length ? cached[0].start : Infinity;
  const cachedMax = cached.length ? cached[cached.length - 1].start : -Infinity;
  if (!cached.length) {
    await fetchBack(lastClosedStart + unitMs, fromMs);
  } else {
    // 최근 구간(캐시 이후)
    if (cachedMax < lastClosedStart) await fetchBack(lastClosedStart + unitMs, cachedMax);
    // 더 과거 구간(캐시 이전)
    if (cachedMin > fromMs) await fetchBack(cachedMin, fromMs);
  }

  const all = [...byStart.values()].filter((b) => b.start <= lastClosedStart).sort((a, b) => a.start - b.start);
  if (file) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(all));
  }
  return all.filter((b) => b.start >= fromMs);
}
