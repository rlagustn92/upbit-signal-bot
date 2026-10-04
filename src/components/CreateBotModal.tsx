import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Search } from 'lucide-react';
import type { CandleUnit, CreateBotRequest, MarketDTO, StrategyDefaults, StrategyKind } from '../../shared/types';
import { api } from '../api/client';
import { coinMeta, QUICK_PICK_MARKETS } from '../lib/coinMeta';
import { baseSymbol, price, won } from '../lib/format';
import { CANDLE_LABEL } from '../lib/labels';
import { Sheet } from './Sheet';
import { BacktestPanel } from './BacktestPanel';

interface Props {
  livePrices: Record<string, number>;
  onClose: () => void;
  onCreated: (coinName: string, startError: string | null) => void;
}

// 원본 UI의 전략 카드 3개. 성능을 보장하는 듯한 배지(승률/안전형)는 기능 설명으로 바꿨다.
const STRATEGY_CARDS: Array<{ id: StrategyKind; title: string; desc: string; badge: string }> = [
  {
    id: 'grid',
    title: '🕸️ 무한 그물망 짤짤이',
    desc: '가격이 일정 간격으로 내려갈 때마다 나눠 사고, 산 가격보다 조금 오르면 파는 것을 반복해요. 오르락내리락하는 횡보장에 맞고, 하락 추세가 강하면 새로 사지 않아요.',
    badge: '횡보장용',
  },
  {
    id: 'rsi',
    title: '📉 RSI 바닥 과매도 반등 줍줍',
    desc: 'RSI가 과매도선(기본 30) 아래로 내려갔다가 다시 올라오는 순간(반등 확인) 나눠 사고, 과매수선에 닿으면 팔아요. 장기 추세가 꺾인 하락장에서는 사지 않아요.',
    badge: '역추세',
  },
  {
    id: 'goldenCross',
    title: '🚀 골든크로스 돌파 불타기',
    desc: '단기 이동평균선이 장기선을 위로 뚫고 거래량도 늘어나는 순간 사요. 오르면 최고가를 따라가다 꺾이면 팔고(트레일링), 변동폭 기반 손절로 크게 잃지 않게 막아요.',
    badge: '추세추종',
  },
  {
    id: 'bollinger',
    title: '🎯 볼린저 밴드 반등',
    desc: '올라가는 흐름(큰 추세선 위)에서 가격이 볼린저 하단 아래로 과하게 빠지면 사고, 중심선으로 돌아오면 팔아요. 오래 안 돌아오면 정해진 시간 뒤에 정리해요. 기본값은 과거 4년 BTC·ETH·XRP 데이터 연구에서 가장 꾸준했던 설정이에요(미래 수익 보장 아님). 자주 사지는 않아요.',
    badge: '평균회귀',
  },
];

/** 볼린저 반등은 넓은 '안전장치' 손절만 둔다 */
const BOLLINGER_SL_CHOICES = [5.0, 8.0, 10.0];

const UNITS: CandleUnit[] = ['1m', '3m', '5m', '15m', '30m', '60m', '240m', '1d'];

type Cfg = Record<string, number | string | boolean>;

export function CreateBotModal({ livePrices, onClose, onCreated }: Props) {
  const [defaults, setDefaults] = useState<StrategyDefaults | null>(null);
  const [markets, setMarkets] = useState<MarketDTO[]>([]);
  const [marketsError, setMarketsError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string>('KRW-BTC');
  const [query, setQuery] = useState('');
  const [strategy, setStrategy] = useState<StrategyKind>('grid');
  const [tp, setTp] = useState(2.0);
  const [sl, setSl] = useState(3.0);
  const [budget, setBudget] = useState(100000);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [cfg, setCfg] = useState<Record<StrategyKind, Cfg>>({ grid: {}, rsi: {}, goldenCross: {}, bollinger: {} });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .strategyDefaults()
      .then((d) => {
        setDefaults(d);
        setTp(d.takeProfitPercent);
        setSl(d.stopLossPercent);
        setCfg({ grid: { ...d.grid }, rsi: { ...d.rsi }, goldenCross: { ...d.goldenCross }, bollinger: { ...d.bollinger } });
      })
      .catch((e) => setError(e.message));
    api
      .markets()
      .then(setMarkets)
      .catch((e) => setMarketsError(e.message));
  }, []);

  const byCode = useMemo(() => new Map(markets.map((m) => [m.marketCode, m])), [markets]);
  const quick = QUICK_PICK_MARKETS.map((c) => byCode.get(c) ?? ({ marketCode: c, displaySymbol: `${c.split('-')[1]}/KRW`, coinName: c.split('-')[1], tradePrice: null } as MarketDTO));
  const sel = byCode.get(selected);
  const selName = sel?.coinName ?? baseSymbol(`${selected.split('-')[1]}/KRW`);
  const selPrice = livePrices[selected] ?? sel?.tradePrice ?? null;

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return markets
      .filter((m) => m.coinName.toLowerCase().includes(q) || m.englishName.toLowerCase().includes(q) || m.marketCode.toLowerCase().includes(q))
      .slice(0, 8);
  }, [query, markets]);

  useEffect(() => {
    if (!defaults) return;
    if (strategy === 'bollinger') setSl((v) => (BOLLINGER_SL_CHOICES.includes(v) ? v : 8.0));
    else setSl((v) => (defaults.stopLossChoices.includes(v) ? v : defaults.stopLossPercent));
  }, [strategy, defaults]);

  const setField = (key: string, value: number | string | boolean) => setCfg((prev) => ({ ...prev, [strategy]: { ...prev[strategy], [key]: value } }));
  const c = cfg[strategy];

  const summary = (() => {
    if (!defaults) return '';
    if (strategy === 'grid') {
      const per = Number(c.orderKRW) > 0 ? Number(c.orderKRW) : Math.floor(budget / Math.max(1, Number(c.levels)));
      return `${c.spacingMode === 'atr' ? '변동폭 맞춤 간격' : `${c.spacingPercent}% 간격`} ${c.levels}칸 · 한 칸 ${won(per)}${c.downtrendGuard ? ' · 하락장 매수 멈춤' : ''}`;
    }
    if (strategy === 'bollinger')
      return `${CANDLE_LABEL[c.candleUnit as CandleUnit]} 볼린저(${c.period}, ${c.k}) 하단 매수 → 중심선 매도${Number(c.trendEmaPeriod) > 0 ? ` · EMA${c.trendEmaPeriod} 위에서만` : ''}${Number(c.maxHoldBars) > 0 ? ` · 최대 ${c.maxHoldBars}봉` : ''}`;
    if (strategy === 'rsi')
      return `${CANDLE_LABEL[c.candleUnit as CandleUnit]} RSI ${c.oversold} ${c.entryMode === 'rebound' ? '반등 확인 후' : '아래에서'} 매수${Number(c.trendEmaPeriod) > 0 ? ` · EMA${c.trendEmaPeriod} 위에서만` : ''} · 최대 ${c.maxEntries}회`;
    return `${CANDLE_LABEL[c.candleUnit as CandleUnit]} ${c.maType} ${c.shortPeriod}/${c.longPeriod} 교차${Number(c.volumeMultiplier) > 0 ? ' · 거래량 확인' : ''}${Number(c.trailingStopPercent) > 0 ? ` · 트레일링 ${c.trailingStopPercent}%` : ''}`;
  })();

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const req: CreateBotRequest = {
        marketCode: selected,
        strategy,
        budgetKRW: budget,
        takeProfitPercent: tp,
        stopLossPercent: sl,
        strategyConfig: c as CreateBotRequest['strategyConfig'],
        start: true,
      };
      const res = await api.createBot(req);
      onCreated(res.bot?.coinName ?? selName, res.startError);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Sheet eyebrow="업비트 자동매매 · 모의투자(PAPER)로 시작" title="코인 자동매매 봇 만들기" onClose={onClose}>
      {/* 1. 코인 선택 */}
      <div className="mt-5 space-y-2">
        <label className="text-[15px] font-extrabold text-[#191F28] block">1. 어떤 코인을 매매할까요?</label>
        <div className="grid grid-cols-3 gap-2">
          {quick.map((m) => {
            const base = m.marketCode.split('-')[1];
            const isSelected = selected === m.marketCode;
            return (
              <button
                key={m.marketCode}
                type="button"
                onClick={() => setSelected(m.marketCode)}
                className={`p-3 rounded-2xl flex flex-col items-center gap-1 border text-center transition-all ${
                  isSelected ? 'border-[#093687] bg-blue-50/70 ring-2 ring-[#093687]/20 shadow-sm' : 'border-gray-200/70 bg-[#F9FAFB] hover:bg-gray-100'
                }`}
              >
                <span className="text-2xl">{coinMeta(base).icon}</span>
                <span className="font-extrabold text-[12px] text-[#191F28] mt-0.5 truncate max-w-full">{m.coinName}</span>
                <span className="text-[10px] text-gray-400 font-bold">{base}</span>
              </button>
            );
          })}
        </div>

        <div className="relative">
          <Search className="w-4 h-4 text-gray-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="다른 코인 찾기 (예: 리플, XRP)"
            className="w-full bg-[#F2F4F6] text-[#191F28] text-sm font-bold pl-10 pr-4 py-3 rounded-2xl outline-none focus:ring-2 focus:ring-[#093687]"
          />
        </div>
        {query.trim() && results.length === 0 && markets.length > 0 && <p className="text-[11px] text-[#8B95A1] font-bold">"{query}" 검색 결과가 없어요. 원화(KRW) 마켓 코인만 찾을 수 있어요.</p>}
        {marketsError && <p className="text-[11px] text-[#F04452] font-bold">코인 목록을 불러오지 못했어요: {marketsError}</p>}
        {results.length > 0 && (
          <div className="border border-gray-100 rounded-2xl divide-y divide-gray-100 overflow-hidden">
            {results.map((m) => (
              <button
                key={m.marketCode}
                type="button"
                onClick={() => {
                  setSelected(m.marketCode);
                  setQuery('');
                }}
                className="w-full flex items-center justify-between px-3.5 py-2.5 text-left hover:bg-gray-50"
              >
                <span className="text-sm font-extrabold text-[#191F28]">
                  {m.coinName} <span className="text-[11px] text-gray-400 font-bold">{baseSymbol(m.displaySymbol)}</span>
                  {m.warning && <span className="ml-1.5 text-[10px] font-black px-1.5 py-0.5 rounded bg-rose-100 text-[#F04452]">유의</span>}
                  {!m.warning && m.caution && <span className="ml-1.5 text-[10px] font-black px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">주의</span>}
                </span>
                <span className="text-xs font-bold text-[#4E5968]">{m.tradePrice != null ? `${price(m.tradePrice)}원` : ''}</span>
              </button>
            ))}
          </div>
        )}
        <p className="text-xs text-[#6B7684] font-semibold">
          선택: <strong className="text-[#191F28]">{selName}</strong> ({selected}) · 현재가 {selPrice != null ? `${price(selPrice)}원` : '불러오는 중'}
          {sel?.warning && <span className="text-[#F04452] font-bold"> · 업비트 유의 종목이에요</span>}
        </p>
      </div>

      {/* 2. 매매 시그널 전략 선택 */}
      <div className="mt-6 space-y-2">
        <label className="text-[15px] font-extrabold text-[#191F28] block">2. 어떤 시그널에 반응할까요?</label>
        <div className="space-y-2.5">
          {STRATEGY_CARDS.map((st) => {
            const isSelected = strategy === st.id;
            return (
              <div
                key={st.id}
                onClick={() => setStrategy(st.id)}
                className={`p-4 rounded-2xl border cursor-pointer transition-all ${isSelected ? 'border-[#093687] bg-blue-50/50 ring-2 ring-[#093687]/20' : 'border-gray-200/70 hover:bg-gray-50'}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-extrabold text-[15px] text-[#191F28]">{st.title}</span>
                  <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-blue-100 text-[#093687] shrink-0">{st.badge}</span>
                </div>
                <p className="text-xs text-[#6B7684] mt-1 leading-relaxed">{st.desc}</p>
              </div>
            );
          })}
        </div>

        {/* 전략 세부 설정 (접이식) */}
        {defaults && (
          <div className="bg-[#F9FAFB] rounded-2xl border border-gray-100">
            <button type="button" onClick={() => setShowAdvanced((v) => !v)} className="w-full flex items-center justify-between px-4 py-3 text-left">
              <span className="text-xs font-bold text-[#4E5968]">
                세부 설정 <span className="text-gray-400 font-medium">· {summary}</span>
              </span>
              <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${showAdvanced ? 'rotate-180' : ''}`} />
            </button>
            {showAdvanced && (
              <div className="px-4 pb-4 grid grid-cols-2 gap-3">
                {strategy === 'grid' && (
                  <>
                    <SelectField
                      label="간격 방식"
                      value={String(c.spacingMode)}
                      options={[
                        ['fixed', '고정 간격'],
                        ['atr', '변동폭(ATR)에 맞춰 자동'],
                      ]}
                      onChange={(v) => setField('spacingMode', v)}
                    />
                    <NumField label={c.spacingMode === 'atr' ? '최소 간격 (%)' : '그물망 간격 (%)'} value={c.spacingPercent} step={0.1} onChange={(v) => setField('spacingPercent', v)} />
                    {c.spacingMode === 'atr' && <NumField label="변동폭 배수" value={c.atrMultiplier} step={0.1} onChange={(v) => setField('atrMultiplier', v)} />}
                    <NumField label="칸 수" value={c.levels} step={1} onChange={(v) => setField('levels', v)} />
                    <NumField label="한 칸 금액 (0=자동)" value={c.orderKRW} step={10000} onChange={(v) => setField('orderKRW', v)} />
                    <NumField label="같은 칸 재진입 대기(초)" value={c.reentryCooldownSec} step={10} onChange={(v) => setField('reentryCooldownSec', v)} />
                    <label className="col-span-2 flex items-center gap-2 text-xs font-bold text-[#4E5968]">
                      <input type="checkbox" checked={!!c.downtrendGuard} onChange={(e) => setField('downtrendGuard', e.target.checked)} />
                      하락장 매수 멈춤 (60분봉 50선보다 3% 넘게 아래면 새로 사지 않기)
                    </label>
                    <p className="col-span-2 text-[11px] text-[#8B95A1] leading-relaxed">기준가는 봇을 켤 때(들고 있는 칸이 없으면 다시 켤 때마다)의 현재가예요. 가격이 한 번에 크게 떨어지면 여러 칸을 연달아 살 수 있어요. 기준가에서 간격만큼 내려간 가격마다 한 칸씩 사고, 각 칸은 산 가격 대비 목표 익절%에 팔아요.</p>
                  </>
                )}
                {strategy === 'rsi' && (
                  <>
                    <UnitField value={c.candleUnit as CandleUnit} onChange={(v) => setField('candleUnit', v)} />
                    <NumField label="RSI 기간" value={c.period} step={1} onChange={(v) => setField('period', v)} />
                    <NumField label="과매도선 (이 아래로 내려가면 사기)" value={c.oversold} step={1} onChange={(v) => setField('oversold', v)} />
                    <NumField label="과매수선 (이 이상이면 팔기)" value={c.overbought} step={1} onChange={(v) => setField('overbought', v)} />
                    <SelectField
                      label="매수 시점"
                      value={String(c.entryMode)}
                      options={[
                        ['rebound', '반등 확인 후 (추천)'],
                        ['dip', '떨어지는 순간 바로'],
                      ]}
                      onChange={(v) => setField('entryMode', v)}
                    />
                    <NumField label="추세 필터 EMA 기간 (0=끄기)" value={c.trendEmaPeriod} step={10} onChange={(v) => setField('trendEmaPeriod', v)} />
                    <NumField label="1회 매수 비율 (%)" value={Math.round(Number(c.splitRatio) * 100)} step={1} onChange={(v) => setField('splitRatio', v / 100)} />
                    <NumField label="최대 나눠 사기 횟수" value={c.maxEntries} step={1} onChange={(v) => setField('maxEntries', v)} />
                  </>
                )}
                {strategy === 'goldenCross' && (
                  <>
                    <UnitField value={c.candleUnit as CandleUnit} onChange={(v) => setField('candleUnit', v)} />
                    <NumField label="매수 비율 (%)" value={Math.round(Number(c.entryRatio) * 100)} step={5} onChange={(v) => setField('entryRatio', v / 100)} />
                    <SelectField
                      label="이동평균 종류"
                      value={String(c.maType)}
                      options={[
                        ['EMA', 'EMA (최근 가격에 민감)'],
                        ['SMA', 'SMA (단순 평균)'],
                      ]}
                      onChange={(v) => setField('maType', v)}
                    />
                    <NumField label="거래량 확인 배수 (0=끄기)" value={c.volumeMultiplier} step={0.1} onChange={(v) => setField('volumeMultiplier', v)} />
                    <NumField label="단기 이평선" value={c.shortPeriod} step={1} onChange={(v) => setField('shortPeriod', v)} />
                    <NumField label="장기 이평선" value={c.longPeriod} step={1} onChange={(v) => setField('longPeriod', v)} />
                    <NumField label="변동폭(ATR) 손절 배수 (0=끄기)" value={c.atrStopMultiplier} step={0.5} onChange={(v) => setField('atrStopMultiplier', v)} />
                    <label className="col-span-2 flex items-center gap-2 text-xs font-bold text-[#4E5968]">
                      <input type="checkbox" checked={!!c.exitOnDeadCross} onChange={(e) => setField('exitOnDeadCross', e.target.checked)} />
                      데드크로스(아래로 뚫음)에서 팔기
                    </label>
                  </>
                )}
                {strategy === 'bollinger' && (
                  <>
                    <UnitField value={c.candleUnit as CandleUnit} onChange={(v) => setField('candleUnit', v)} />
                    <NumField label="매수 비율 (%)" value={Math.round(Number(c.entryRatio) * 100)} step={5} onChange={(v) => setField('entryRatio', v / 100)} />
                    <NumField label="볼린저 기간" value={c.period} step={1} onChange={(v) => setField('period', v)} />
                    <NumField label="밴드 폭 (표준편차 배수)" value={c.k} step={0.1} onChange={(v) => setField('k', v)} />
                    <NumField label="큰 추세선 EMA 기간 (0=끄기)" value={c.trendEmaPeriod} step={10} onChange={(v) => setField('trendEmaPeriod', v)} />
                    <NumField label="최대 보유 캔들 수 (0=끄기)" value={c.maxHoldBars} step={5} onChange={(v) => setField('maxHoldBars', v)} />
                    <p className="col-span-2 text-[11px] text-[#8B95A1] leading-relaxed">밴드 폭을 키우면(예: 3) 더 깊게 빠질 때만 사서 횟수는 줄고 한 번의 질은 좋아지는 경향이 있어요. 중심선 복귀에서 팔기 때문에 목표 익절%는 쓰지 않아요.</p>
                  </>
                )}
                {/* 공통 위험 관리 */}
                <div className="col-span-2 pt-2 mt-1 border-t border-gray-200/70 text-[11px] font-extrabold text-[#4E5968]">위험 관리 (모든 전략 공통)</div>
                {strategy !== 'grid' && strategy !== 'bollinger' && (
                  <NumField label="트레일링 익절 % (0=목표에서 바로 팔기)" value={c.trailingStopPercent} step={0.5} onChange={(v) => setField('trailingStopPercent', v)} />
                )}
                <NumField label="하루 최대 손실 % (예산 대비, 0=끄기)" value={c.dailyLossLimitPercent} step={1} onChange={(v) => setField('dailyLossLimitPercent', v)} />
                <NumField label="손실 후 쉬는 시간 (분)" value={c.cooldownAfterLossMin} step={10} onChange={(v) => setField('cooldownAfterLossMin', v)} />
                <p className="col-span-2 text-[11px] text-[#8B95A1] leading-relaxed">
                  {strategy !== 'grid' && strategy !== 'bollinger' && '트레일링 익절: 목표 익절에 닿아도 바로 팔지 않고, 계속 오르면 따라가다가 최고가에서 정한 %만큼 내려오면 팔아요. '}
                  하루 손실 한도에 닿거나 손실을 보고 판 직후에는 새로 사지 않아요(파는 건 계속).
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* 3. 자동 익절 / 손절 설정 */}
      <div className="mt-6 space-y-3 bg-[#F9FAFB] p-4.5 rounded-2xl border border-gray-100">
        <label className="text-[14px] font-extrabold text-[#191F28] block">3. 목표 익절률 & 손절 기준</label>
        <div className="grid grid-cols-2 gap-3">
          <div className={strategy === 'bollinger' ? 'opacity-40 pointer-events-none' : ''}>
            <span className="text-xs font-bold text-gray-500">목표 익절 (+%){strategy === 'bollinger' ? ' · 안 씀' : ''}</span>
            <div className="flex items-center gap-1.5 mt-1.5">
              {(defaults?.takeProfitChoices ?? [1.0, 2.0, 3.5]).map((rate) => (
                <button
                  key={rate}
                  type="button"
                  onClick={() => setTp(rate)}
                  className={`flex-1 py-1.5 rounded-xl text-xs font-extrabold transition-all ${tp === rate ? 'bg-[#F04452] text-white shadow-sm' : 'bg-white text-gray-600 border border-gray-200'}`}
                >
                  +{rate}%
                </button>
              ))}
            </div>
          </div>
          <div>
            <span className="text-xs font-bold text-gray-500">손절 기준 (-%)</span>
            <div className="flex items-center gap-1.5 mt-1.5">
              {(strategy === 'bollinger' ? BOLLINGER_SL_CHOICES : (defaults?.stopLossChoices ?? [2.0, 3.0, 5.0])).map((rate) => (
                <button
                  key={rate}
                  type="button"
                  onClick={() => setSl(rate)}
                  className={`flex-1 py-1.5 rounded-xl text-xs font-extrabold transition-all ${sl === rate ? 'bg-[#3182F6] text-white shadow-sm' : 'bg-white text-gray-600 border border-gray-200'}`}
                >
                  -{rate}%
                </button>
              ))}
            </div>
          </div>
        </div>
        <p className="text-[11px] text-[#8B95A1] leading-relaxed">
          {strategy === 'grid' ? '그물망은 칸마다 산 가격 기준으로 익절해요. ' : ''}
          {strategy === 'bollinger' ? '볼린저 반등은 중심선 복귀·시간 손절로 팔고, 손절 %는 급락 대비 안전장치예요(연구에서는 넓은 손절이 더 나았어요). ' : ''}손절은 평균 매입가(수수료 포함) 대비로 판단해 시장가로 팔아요. 급락하면 실제 체결가는 기준보다 낮을 수 있어요.
        </p>
      </div>

      {/* 4. 투자 금액 */}
      <div className="mt-6 space-y-2">
        <label className="text-[15px] font-extrabold text-[#191F28] flex items-center justify-between">
          <span>4. 봇에게 맡길 예산</span>
          <span className="text-xs text-gray-400 font-medium">업비트 최소 주문 5,000원 이상</span>
        </label>
        <div className="grid grid-cols-4 gap-2">
          {(defaults?.budgetChoices ?? [100000, 300000, 500000, 1000000]).map((amt) => (
            <button
              key={amt}
              type="button"
              onClick={() => setBudget(amt)}
              className={`py-2 rounded-xl text-xs font-extrabold transition-all ${budget === amt ? 'bg-[#191F28] text-white' : 'bg-gray-100 text-[#4E5968] hover:bg-gray-200'}`}
            >
              {amt >= 10000 ? `${amt / 10000}만원` : `${amt}원`}
            </button>
          ))}
        </div>
        <div className="relative mt-2">
          <input
            type="number"
            value={budget || ''}
            placeholder="0"
            onChange={(e) => setBudget(Number(e.target.value))}
            step={10000}
            className="w-full bg-[#F2F4F6] text-[#191F28] text-xl font-extrabold px-4 py-3.5 rounded-2xl outline-none focus:ring-2 focus:ring-[#093687] pr-12"
          />
          <span className="absolute right-4 top-1/2 -translate-y-1/2 font-bold text-gray-500">원</span>
        </div>
        <p className="text-[11px] text-[#8B95A1]">이 봇은 이 금액을 넘어서 사지 않아요. 처음엔 모의투자 가상 원화로 동작해요.</p>
      </div>

      {/* 5. 과거로 미리 테스트 */}
      {defaults && (
        <BacktestPanel
          request={{ marketCode: selected, strategy, budgetKRW: budget, takeProfitPercent: tp, stopLossPercent: sl, strategyConfig: c as CreateBotRequest['strategyConfig'] }}
        />
      )}

      {/* 시작 버튼 */}
      <div className="mt-7 pt-4 border-t border-gray-100">
        {error && <p className="mb-3 text-xs font-bold text-[#F04452]">{error}</p>}
        <button
          type="button"
          onClick={submit}
          disabled={submitting || !defaults}
          className="w-full bg-[#093687] hover:bg-[#072c6e] text-white py-4 rounded-2xl font-black text-[17px] shadow-lg shadow-[#093687]/30 transition-all flex items-center justify-center gap-2 active:scale-[0.98] disabled:opacity-60"
        >
          <span>{submitting ? '봇을 만드는 중…' : `${selName} 봇 만들고 모의투자 시작`}</span>
          <ChevronRight className="w-5 h-5 stroke-[3]" />
        </button>
        <p className="text-center text-[11px] text-gray-400 mt-2">스위치를 끄면 새 주문이 멈추고 미체결 주문이 취소돼요. (가진 코인은 팔지 않아요)</p>
      </div>
    </Sheet>
  );
}

function NumField({ label, value, step, onChange }: { label: string; value: number | string | boolean | undefined; step: number; onChange: (v: number) => void }) {
  const [text, setText] = useState(String(Number(value ?? 0)));
  useEffect(() => {
    // 바깥 값이 바뀌었을 때만 동기화(입력 중 빈칸/소수점은 유지)
    if (Number(text) !== Number(value ?? 0)) setText(String(Number(value ?? 0)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <label className="block">
      <span className="text-[11px] font-bold text-gray-500">{label}</span>
      <input
        type="number"
        step={step}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          if (e.target.value.trim() !== '' && Number.isFinite(Number(e.target.value))) onChange(Number(e.target.value));
        }}
        className="mt-1 w-full bg-white text-[#191F28] text-sm font-extrabold px-3 py-2 rounded-xl border border-gray-200 outline-none focus:ring-2 focus:ring-[#093687]"
      />
    </label>
  );
}

function SelectField({ label, value, options, onChange }: { label: string; value: string; options: Array<[string, string]>; onChange: (v: string) => void }) {
  return (
    <label className="block">
      <span className="text-[11px] font-bold text-gray-500">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full bg-white text-[#191F28] text-sm font-extrabold px-3 py-2 rounded-xl border border-gray-200 outline-none focus:ring-2 focus:ring-[#093687]"
      >
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </label>
  );
}

function UnitField({ value, onChange }: { value: CandleUnit; onChange: (v: CandleUnit) => void }) {
  return (
    <label className="block">
      <span className="text-[11px] font-bold text-gray-500">캔들(봉) 단위</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as CandleUnit)}
        className="mt-1 w-full bg-white text-[#191F28] text-sm font-extrabold px-3 py-2 rounded-xl border border-gray-200 outline-none focus:ring-2 focus:ring-[#093687]"
      >
        {UNITS.map((u) => (
          <option key={u} value={u}>
            {CANDLE_LABEL[u]}
          </option>
        ))}
      </select>
    </label>
  );
}
