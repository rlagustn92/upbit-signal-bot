import { useEffect, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import type { BotDTO, CopyTradersResponse } from '../../shared/types';
import { api } from '../api/client';
import { won } from '../lib/format';

const COPY_MARKETS = ['KRW-BTC', 'KRW-ETH', 'KRW-XRP'];
const BUDGETS = [100_000, 200_000, 300_000];

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const usd = (n: number | null) => (n == null || !Number.isFinite(n) ? '-' : `$${Math.round(n).toLocaleString('en-US')}`);
const ago = (t: number | null) => {
  if (!t) return '아직 못 받음';
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  return s < 60 ? `${s}초 전` : `${Math.round(s / 60)}분 전`;
};

/**
 * 하이퍼리퀴드 고수 따라하기 실험 패널: 따라 하는 지갑들의 지금 BTC·ETH·XRP 포지션(공개 데이터)과
 * 따라하기 봇이 없으면 한 번에 만들기 버튼
 */
export function CopyTradersPanel({ bots }: { bots: BotDTO[] }) {
  const [data, setData] = useState<CopyTradersResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [budget, setBudget] = useState(200_000);
  const [creating, setCreating] = useState(false);
  const [createMsg, setCreateMsg] = useState<string | null>(null);

  const copyBots = bots.filter((b) => b.strategy === 'copyTrade');
  const missing = COPY_MARKETS.filter((m) => !copyBots.some((b) => b.marketCode === m));

  useEffect(() => {
    let alive = true;
    const load = () =>
      api
        .copyTraders()
        .then((d) => {
          if (!alive) return;
          setData(d);
          setError(null);
        })
        .catch((e) => alive && setError(e instanceof Error ? e.message : String(e)));
    void load();
    const t = setInterval(load, 5_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  const createAll = async () => {
    setCreating(true);
    setCreateMsg(null);
    const done: string[] = [];
    try {
      for (const m of missing) {
        const res = await api.createBot({ marketCode: m, strategy: 'copyTrade', budgetKRW: budget, takeProfitPercent: 2, stopLossPercent: 10, strategyConfig: {}, start: true });
        done.push(res.bot.coinName);
        if (res.startError) setCreateMsg(`${res.bot.coinName} 봇은 만들었지만 켜지 못했어요: ${res.startError}`);
      }
      if (done.length) setCreateMsg((prev) => prev ?? `${done.join(', ')} 따라하기 봇을 모의투자로 켰어요.`);
    } catch (e) {
      setCreateMsg(`${done.length ? `${done.join(', ')}까지 만들었어요. ` : ''}${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setCreating(false);
    }
  };

  const traders = data?.traders ?? [];

  return (
    <div className="bg-white rounded-[26px] p-5 shadow-sm border border-black/[0.04]">
      <div className="flex items-center justify-between gap-2">
        <div className="font-extrabold text-[16px] text-[#191F28]">🐋 하이퍼리퀴드 고수 따라하기</div>
        <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 shrink-0">실험 · 모의투자</span>
      </div>
      <p className="text-xs text-[#6B7684] mt-1 leading-relaxed">
        아래 지갑이 BTC·ETH·XRP 롱을 새로 잡으면 봇이 예산을 사람 수로 나눈 만큼 따라 사고, 정리하면 그 몫을 팔아요. 레버리지·숏은 따라 하지 않아요.
        {data?.pickedAt && <> 지갑은 {new Date(data.pickedAt).toLocaleDateString('ko-KR')}에 리더보드에서 골랐어요.</>}
      </p>

      {/* 따라 하는 사람들 */}
      <div className="mt-3 space-y-2">
        {error && <p className="text-[11px] font-bold text-[#F04452]">불러오지 못했어요: {error}</p>}
        {!error && data && traders.length === 0 && <p className="text-[11px] text-[#8B95A1] font-bold">따라 할 지갑이 아직 없어요. npm run hl-pick 으로 고르거나 봇 만들기에서 주소를 넣어 주세요.</p>}
        {traders.map((t) => (
          <div key={t.address} className="rounded-2xl bg-[#F9FAFB] border border-gray-100 px-3.5 py-2.5">
            <div className="flex items-center justify-between gap-2 text-xs">
              <a href={`https://hyperdash.com/address/${t.address}`} target="_blank" rel="noreferrer" className="font-mono font-bold text-[#191F28] inline-flex items-center gap-1 hover:underline">
                {short(t.address)} <ExternalLink className="w-3 h-3 text-gray-400" />
              </a>
              <span className="text-[11px] text-[#8B95A1] font-bold">
                계좌 {usd(t.accountValue)} · {t.ok ? ago(t.updatedAt) : <span className="text-[#F04452]">조회 실패</span>}
              </span>
            </div>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {t.positions.map((p) => {
                const side = p.size > 0 ? 'long' : p.size < 0 ? 'short' : 'none';
                return (
                  <span
                    key={p.coin}
                    className={`text-[11px] font-extrabold px-2 py-0.5 rounded-lg ${side === 'long' ? 'bg-rose-50 text-[#F04452]' : side === 'short' ? 'bg-blue-50 text-[#3182F6]' : 'bg-gray-100 text-[#8B95A1]'}`}
                    title={p.entryPx ? `진입가 $${p.entryPx} · 평가손익 ${usd(p.unrealizedPnl)}` : undefined}
                  >
                    {p.coin} {side === 'long' ? `롱${p.leverage ? ` ${p.leverage}배` : ''}` : side === 'short' ? '숏(안 따라 함)' : '없음'}
                    {side !== 'none' && p.unrealizedPnl != null && <span className="font-bold opacity-80"> {p.unrealizedPnl >= 0 ? '+' : ''}{usd(p.unrealizedPnl).replace('$-', '-$')}</span>}
                  </span>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* 봇 한 번에 만들기 */}
      {missing.length > 0 && traders.length > 0 && (
        <div className="mt-4 pt-4 border-t border-gray-100">
          <p className="text-xs font-extrabold text-[#191F28]">
            {missing.map((m) => m.split('-')[1]).join('·')} 따라하기 봇 {copyBots.length ? '나머지도 ' : ''}만들기 <span className="text-[#8B95A1] font-bold">(코인당 예산)</span>
          </p>
          <div className="mt-2 grid grid-cols-3 gap-2">
            {BUDGETS.map((b) => (
              <button
                key={b}
                type="button"
                onClick={() => setBudget(b)}
                className={`py-2 rounded-xl text-xs font-extrabold transition-all ${budget === b ? 'bg-[#191F28] text-white' : 'bg-gray-100 text-[#4E5968] hover:bg-gray-200'}`}
              >
                {b / 10000}만원
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={createAll}
            disabled={creating}
            className="mt-2.5 w-full bg-[#093687] hover:bg-[#072c6e] text-white py-3 rounded-2xl font-black text-sm disabled:opacity-60"
          >
            {creating ? '만드는 중…' : `${missing.length}개 만들고 모의투자로 켜기 (총 ${won(budget * missing.length)})`}
          </button>
          <p className="text-[11px] text-[#8B95A1] mt-1.5">급락 대비 손절 -10%. 켤 때 이미 롱인 사람은 다음 새 진입부터 따라 해요.</p>
        </div>
      )}
      {createMsg && <p className="mt-2 text-[11px] font-bold text-[#4E5968]">{createMsg}</p>}
    </div>
  );
}
