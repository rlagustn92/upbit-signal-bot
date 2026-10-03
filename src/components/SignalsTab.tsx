import { useState } from 'react';
import { ArrowDownRight, ArrowUpRight, RefreshCw, Sparkles } from 'lucide-react';
import type { SignalDTO, TradeDTO } from '../../shared/types';
import { baseSymbol, price, qty, relativeTime, signedPercent, signedWon, won } from '../lib/format';
import { STRATEGY_LABEL, tradeBadge } from '../lib/labels';

interface Props {
  trades: TradeDTO[];
  signals: SignalDTO[];
  loading: boolean;
  onRefresh: () => void;
}

/** 시그널(봇의 판단)과 체결(실제로 사고판 기록)을 구분해서 보여준다 */
export function SignalsTab({ trades, signals, loading, onRefresh }: Props) {
  const [view, setView] = useState<'trades' | 'signals'>('trades');

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-[26px] p-6 shadow-sm border border-black/[0.03]">
        <div className="flex items-center justify-between mb-4 gap-2">
          <div>
            <h2 className="text-[20px] font-extrabold text-[#191F28]">실시간 시그널 & 체결 기록</h2>
            <p className="text-xs text-[#6B7684] mt-1">봇의 판단(시그널)과 실제로 사고판 기록(체결 영수증)을 따로 보여줘요</p>
          </div>
          <button onClick={onRefresh} className="p-2.5 rounded-xl bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors shrink-0" aria-label="새로고침">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2 mb-1">
          {(
            [
              ['trades', `체결 영수증 (${trades.length})`],
              ['signals', `시그널 (${signals.length})`],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setView(key)}
              className={`py-2 rounded-xl text-xs font-extrabold transition-all ${view === key ? 'bg-[#191F28] text-white' : 'bg-gray-100 text-[#4E5968] hover:bg-gray-200'}`}
            >
              {label}
            </button>
          ))}
        </div>

        {view === 'trades' ? (
          <div className="divide-y divide-gray-100">
            {trades.length === 0 && <Empty text="아직 체결된 거래가 없어요. 봇이 조건에 맞는 주문을 넣고, 그 주문이 체결되면 여기에 표시돼요." />}
            {trades.map((t) => (
              <TradeRow key={t.id} t={t} />
            ))}
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {signals.length === 0 && <Empty text="아직 감지된 시그널이 없어요." />}
            {signals.map((s) => (
              <SignalRow key={s.id} s={s} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="py-8 text-center text-xs text-[#8B95A1]">{text}</p>;
}

function TradeRow({ t }: { t: TradeDTO }) {
  const pnl = t.realizedPnl != null ? Number(t.realizedPnl) : null;
  const badge = tradeBadge(t.side, t.purpose, pnl);
  const sym = baseSymbol(t.displaySymbol);
  const iconBox = badge.tone === 'profit' ? 'bg-rose-50 text-[#F04452]' : badge.tone === 'buy' ? 'bg-blue-50 text-[#3182F6]' : 'bg-gray-100 text-gray-600';
  const badgeCls = badge.tone === 'profit' ? 'bg-rose-100 text-[#F04452]' : badge.tone === 'buy' ? 'bg-blue-100 text-[#1B64DA]' : 'bg-gray-200 text-gray-700';
  return (
    <div className="py-4 flex items-center justify-between">
      <div className="flex items-center gap-3 min-w-0">
        <div className={`w-11 h-11 rounded-2xl flex items-center justify-center font-black text-sm shrink-0 ${iconBox}`}>
          {t.side === 'ask' ? <ArrowUpRight className="w-5 h-5 stroke-[2.5]" /> : <ArrowDownRight className="w-5 h-5 stroke-[2.5]" />}
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-extrabold text-[16px] text-[#191F28]">
              {t.coinName} ({sym})
            </span>
            <span className={`text-[10px] font-black px-2 py-0.5 rounded-md ${badgeCls}`}>{badge.text}</span>
            {t.botId != null && <span className="text-[10px] font-bold text-gray-400">봇 #{t.botId}</span>}
          </div>
          <p className="text-xs text-[#6B7684] mt-0.5 line-clamp-1">{t.reason ?? '봇 주문 체결'}</p>
          <div className="text-[11px] text-[#8B95A1] mt-0.5">
            체결가: {price(t.price)}원 ({qty(t.volume)} {sym}) · 금액 {won(Number(t.funds))} · 수수료 {won(Number(t.fee))}
            {t.strategy ? ` · ${STRATEGY_LABEL[t.strategy]}` : ''} · {relativeTime(t.timestamp)}
          </div>
        </div>
      </div>

      <div className="text-right shrink-0 ml-3">
        {pnl != null ? (
          <div className={`font-black text-[15px] ${pnl >= 0 ? 'text-[#F04452]' : 'text-[#3182F6]'}`}>
            {signedWon(pnl)}
            {t.realizedPnlPercent != null && <span className="block text-[11px]">({signedPercent(t.realizedPnlPercent)})</span>}
          </div>
        ) : (
          <div className="font-bold text-[14px] text-gray-700">구매 완료</div>
        )}
        <span className="text-[10px] text-gray-400 font-medium">{t.mode === 'LIVE' ? '업비트 체결' : '모의 체결'}</span>
      </div>
    </div>
  );
}

function SignalRow({ s }: { s: SignalDTO }) {
  const tone = s.signalType === 'BUY' ? 'bg-blue-100 text-[#1B64DA]' : s.signalType === 'SELL' ? 'bg-rose-100 text-[#F04452]' : 'bg-gray-200 text-gray-700';
  const label = s.signalType === 'BUY' ? '사기 신호' : s.signalType === 'SELL' ? '팔기 신호' : '알림';
  return (
    <div className="py-4 flex items-start gap-3">
      <div className="w-11 h-11 rounded-2xl flex items-center justify-center shrink-0 bg-gray-100 text-[#3182F6]">
        <Sparkles className="w-5 h-5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-extrabold text-[15px] text-[#191F28]">
            {s.coinName} ({baseSymbol(s.displaySymbol)})
          </span>
          <span className={`text-[10px] font-black px-2 py-0.5 rounded-md ${tone}`}>{label}</span>
          <span className="text-[10px] text-gray-400 font-bold">{STRATEGY_LABEL[s.strategy]}</span>
        </div>
        <p className="text-xs text-[#4E5968] mt-0.5">{s.reason}</p>
        <div className="text-[11px] text-[#8B95A1] mt-0.5">
          {s.signalValue ? `${s.signalValue} · ` : ''}
          {s.outcome ?? '처리 중'} · {relativeTime(s.timestamp)}
        </div>
      </div>
    </div>
  );
}
