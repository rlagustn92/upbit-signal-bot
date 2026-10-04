import { useState } from 'react';
import { BarChart3 } from 'lucide-react';
import type { BacktestRequest, BacktestResultDTO } from '../../shared/types';
import { api } from '../api/client';
import { CANDLE_LABEL } from '../lib/labels';
import { won } from '../lib/format';

const PERIODS = [30, 90, 180, 365];

const pct = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;
const color = (n: number) => (n > 0 ? 'text-[#F04452]' : n < 0 ? 'text-[#3182F6]' : 'text-[#191F28]');
const day = (t: number) => new Date(t).toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' });

/** 봇 만들기 화면의 "과거로 미리 테스트". 지금 고른 설정 그대로 과거 캔들 위에서 돌려 본다. */
export function BacktestPanel({ request }: { request: Omit<BacktestRequest, 'days'> }) {
  const [days, setDays] = useState(90);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ key: string; data: BacktestResultDTO } | null>(null);
  const key = JSON.stringify({ ...request, days });
  const current = result?.key === key ? result.data : null;
  const stale = result != null && !current;

  const run = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.backtest({ ...request, days });
      setResult({ key, data });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const shown = current ?? result?.data ?? null;

  return (
    <div className="mt-6 rounded-2xl border border-gray-200/80 bg-[#F9FAFB] p-4">
      <div className="flex items-center justify-between">
        <span className="text-[15px] font-extrabold text-[#191F28] flex items-center gap-1.5">
          <BarChart3 className="w-4 h-4 text-[#093687]" /> 과거로 미리 테스트
        </span>
        <span className="text-[11px] text-gray-400 font-medium">돈이 들지 않아요</span>
      </div>
      <p className="mt-1 text-[11px] text-[#8B95A1] leading-relaxed">지금 고른 설정 그대로 지난 기간의 실제 업비트 캔들 위에서 돌려 봐요. 수수료 0.05%와 시장가 미끄러짐도 넣어서 계산해요.</p>

      <div className="mt-3 flex gap-2">
        {PERIODS.map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => setDays(d)}
            className={`flex-1 py-1.5 rounded-xl text-xs font-extrabold transition-all ${days === d ? 'bg-[#191F28] text-white' : 'bg-white text-gray-600 border border-gray-200'}`}
          >
            {d === 365 ? '1년' : `${d}일`}
          </button>
        ))}
      </div>
      <button
        type="button"
        onClick={run}
        disabled={loading}
        className="mt-3 w-full bg-white border border-[#093687] text-[#093687] py-2.5 rounded-xl font-extrabold text-sm hover:bg-blue-50 transition-all disabled:opacity-60"
      >
        {loading ? '과거 캔들 받아서 계산하는 중… (처음엔 1~2분)' : current ? '다시 테스트' : `최근 ${days === 365 ? '1년' : `${days}일`}로 테스트하기`}
      </button>
      {error && <p className="mt-2 text-xs font-bold text-[#F04452]">{error}</p>}

      {shown && (
        <div className={`mt-4 space-y-3 ${stale ? 'opacity-50' : ''}`}>
          {stale && <p className="text-[11px] font-bold text-[#F59F00]">설정이 바뀌었어요. 다시 테스트하면 새 결과가 나와요.</p>}
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-xl bg-white p-3 border border-gray-100">
              <div className="text-[11px] font-bold text-gray-500">이 봇 수익률</div>
              <div className={`text-xl font-black ${color(shown.metrics.totalReturnPercent)}`}>{pct(shown.metrics.totalReturnPercent)}</div>
              <div className="text-[11px] text-gray-400">{won(shown.metrics.finalEquity)}</div>
            </div>
            <div className="rounded-xl bg-white p-3 border border-gray-100">
              <div className="text-[11px] font-bold text-gray-500">그냥 사서 들고 있었다면</div>
              <div className={`text-xl font-black ${color(shown.metrics.buyHoldPercent)}`}>{pct(shown.metrics.buyHoldPercent)}</div>
              <div className="text-[11px] text-gray-400">
                {day(shown.metrics.startAt)} ~ {day(shown.metrics.endAt)} · {CANDLE_LABEL[shown.simUnit]}
              </div>
            </div>
          </div>

          <EquityChart data={shown.equity} budget={shown.request.budgetKRW} />

          <div className="grid grid-cols-3 gap-2 text-center">
            <Stat label="매도 횟수" value={`${shown.metrics.trades}번`} />
            <Stat label="승률" value={`${shown.metrics.winRate.toFixed(0)}%`} />
            <Stat label="손익비" value={shown.metrics.payoffRatio == null ? '-' : `${shown.metrics.payoffRatio.toFixed(2)} : 1`} hint="평균 수익 ÷ 평균 손실" />
            <Stat label="최대 낙폭" value={`-${shown.metrics.maxDrawdownPercent.toFixed(1)}%`} hint="고점 대비 가장 많이 줄었던 비율" />
            <Stat label="손절" value={`${shown.metrics.stopLosses}번`} />
            <Stat label="낸 수수료" value={won(Math.round(shown.metrics.feesPaid))} />
          </div>

          {shown.notes.length > 0 && (
            <ul className="space-y-1">
              {shown.notes.map((n) => (
                <li key={n} className="text-[11px] text-[#6B7684] leading-relaxed">
                  · {n}
                </li>
              ))}
            </ul>
          )}
          <p className="text-[11px] text-[#8B95A1] leading-relaxed">
            ⚠ 과거 결과가 앞으로의 수익을 보장하지 않아요. 캔들 안에서 가격이 움직인 순서는 추정이라 실제와 다를 수 있어요. 한 기간만 보지 말고 여러 기간·코인으로 확인해 보세요.
          </p>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl bg-white py-2 px-1 border border-gray-100" title={hint}>
      <div className="text-[10px] font-bold text-gray-500">{label}</div>
      <div className="text-sm font-black text-[#191F28]">{value}</div>
    </div>
  );
}

/** 자산(봇) vs 그냥 보유 — 둘 다 시작 = 100으로 맞춘 선 그래프 */
function EquityChart({ data, budget }: { data: BacktestResultDTO['equity']; budget: number }) {
  if (data.length < 2) return null;
  const W = 300;
  const H = 90;
  const p0 = data[0].price;
  const bot = data.map((d) => (d.equity / budget) * 100);
  const hold = data.map((d) => (d.price / p0) * 100);
  const all = [...bot, ...hold, 100];
  const min = Math.min(...all);
  const max = Math.max(...all);
  const y = (v: number) => H - 4 - ((v - min) / Math.max(1e-9, max - min)) * (H - 8);
  const x = (i: number) => (i / (data.length - 1)) * W;
  const line = (vals: number[]) => vals.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  return (
    <div className="rounded-xl bg-white p-3 border border-gray-100">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-24" preserveAspectRatio="none" role="img" aria-label="자산 변화 그래프">
        <line x1={0} x2={W} y1={y(100)} y2={y(100)} stroke="#E5E8EB" strokeDasharray="3 3" />
        <path d={line(hold)} fill="none" stroke="#B0B8C1" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
        <path d={line(bot)} fill="none" stroke="#093687" strokeWidth={2} vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="mt-1 flex gap-3 text-[10px] font-bold">
        <span className="text-[#093687]">━ 이 봇</span>
        <span className="text-[#8B95A1]">━ 그냥 보유</span>
      </div>
    </div>
  );
}
