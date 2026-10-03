import { useState } from 'react';
import { Activity, ChevronDown, ChevronRight, Sparkles } from 'lucide-react';
import type { BotDTO, SnapshotDTO } from '../../shared/types';
import { coinMeta } from '../lib/coinMeta';
import { baseSymbol, price, qty, relativeTime, signedPercent, signedWon, won } from '../lib/format';
import { MODE_LABEL, STRATEGY_LABEL } from '../lib/labels';

interface Props {
  snapshot: SnapshotDTO | null;
  pendingBotIds: Set<number>;
  onCreate: () => void;
  onToggle: (bot: BotDTO) => void;
  onDelete: (bot: BotDTO) => void;
  onSwitchMode: (bot: BotDTO) => void;
  onLiquidatePaper: (bot: BotDTO) => void;
  onEmergencyStop: () => void;
  onReleaseEmergency: () => void;
}

export function BotsTab({ snapshot, pendingBotIds, onCreate, onToggle, onDelete, onSwitchMode, onLiquidatePaper, onEmergencyStop, onReleaseEmergency }: Props) {
  const bots = snapshot?.bots ?? [];
  const s = snapshot?.summary;
  const activeCount = bots.filter((b) => b.active).length;
  const liveActive = bots.some((b) => b.active && b.mode === 'LIVE');
  const emergency = snapshot?.system.emergencyStop ?? false;
  const totalPnl = s?.totalPnl ?? 0;
  const pct = s?.totalPnlPercentOfBudget ?? 0;

  return (
    <>
      {/* 총 손익 대형 카드 */}
      <div className="bg-white rounded-[28px] p-6 shadow-sm border border-black/[0.03]">
        <div className="flex items-center justify-between text-[#6B7684] text-sm font-semibold mb-1 gap-2">
          <span>{snapshot?.headlineMode === 'LIVE' ? '실전 봇 손익' : '모의투자 봇 손익'} (실현 + 미실현)</span>
          <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-600 bg-emerald-50 px-2.5 py-1 rounded-lg shrink-0">
            <Activity className="w-3.5 h-3.5" /> 오늘 {s?.todayTradesCount ?? 0}회 체결
          </span>
        </div>

        <div className="flex items-baseline gap-2 mt-1 flex-wrap">
          <span className="text-[34px] font-black tracking-tight text-[#191F28]">{signedWon(totalPnl)}</span>
          <span className={`font-black text-lg ${Math.abs(pct) < 0.005 ? 'text-[#8B95A1]' : pct > 0 ? 'text-[#F04452]' : 'text-[#3182F6]'}`}>({signedPercent(pct)})</span>
        </div>
        <p className="text-[11px] text-[#8B95A1] font-medium mt-0.5">
          이미 팔아서 확정된 수익 {signedWon(s?.realizedPnl ?? 0)} · 아직 안 판 코인의 현재 기준 손익 {signedWon(s?.unrealizedPnl ?? 0)} · 수익률은 봇 예산 합계 대비
          {snapshot?.headlineMode === 'LIVE' && snapshot.summaryByMode.PAPER.botCount > 0 && <> · 모의투자 봇 손익 {signedWon(snapshot.summaryByMode.PAPER.totalPnl)}(별도)</>}
        </p>

        {/* 하단 서브 지표 칩 */}
        <div className="mt-4 pt-4 border-t border-gray-100 grid grid-cols-2 gap-3 text-xs">
          <div className="bg-[#F9FAFB] p-3 rounded-xl">
            <div className="text-gray-400 font-medium">켜진 봇에 맡긴 예산</div>
            <div className="text-[15px] font-extrabold text-[#191F28] mt-0.5">{won(s?.activeBudget ?? 0)}</div>
          </div>
          <div className="bg-[#F9FAFB] p-3 rounded-xl">
            <div className="text-gray-400 font-medium">작동 중인 코인 봇</div>
            <div className="text-[15px] font-extrabold text-[#3182F6] mt-0.5">
              {activeCount}개 가동 중 (전체 {bots.length}개)
            </div>
          </div>
        </div>

        {/* 안내 배너 — 실제 동작 그대로 설명 */}
        <div className="mt-4 bg-[#F2F7FF] rounded-2xl p-3.5 flex items-center gap-3 border border-blue-100">
          <div className="w-9 h-9 rounded-full bg-[#3182F6] text-white flex items-center justify-center shrink-0 font-bold text-sm">⚡</div>
          <div className="text-xs">
            <p className="font-extrabold text-[#1B64DA]">{liveActive ? '실전(LIVE) 봇은 실제 업비트 계좌로 주문해요' : '지금은 모의투자(PAPER) — 실제 돈은 움직이지 않아요'}</p>
            <p className="text-[#4E5968] mt-0.5">이 프로그램(서버)이 켜져 있는 동안 설정한 조건이 오면 봇이 대신 주문해요. 수익을 보장하지 않아요.</p>
          </div>
        </div>
      </div>

      {/* 신규 봇 만들기 배너 버튼 */}
      <button
        onClick={onCreate}
        className="w-full bg-[#093687] hover:bg-[#072c6e] text-white rounded-[24px] p-5 flex items-center justify-between font-bold text-left shadow-lg shadow-[#093687]/20 transition-all duration-200 active:scale-[0.99] group"
      >
        <div className="flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-2xl bg-white/10 flex items-center justify-center text-2xl backdrop-blur-xs">🤖</div>
          <div>
            <div className="text-[17px] font-extrabold">새로운 코인 자동매매 봇 만들기</div>
            <div className="text-xs text-blue-200 mt-0.5 font-medium">코인과 전략, 예산을 고르면 모의투자로 시작해요</div>
          </div>
        </div>
        <span className="bg-white text-[#093687] px-3.5 py-1.5 rounded-xl text-xs font-black shadow-sm flex items-center gap-1 group-hover:translate-x-0.5 transition-transform shrink-0">
          봇 세팅하기 <ChevronRight className="w-3.5 h-3.5 stroke-[3]" />
        </span>
      </button>

      {/* 봇 카드 리스트 */}
      <div className="space-y-3 pt-1">
        <div className="flex items-center justify-between px-2 gap-2">
          <h2 className="text-[18px] font-extrabold text-[#191F28] shrink-0">내 코인 봇 목록</h2>
          <span className="text-xs text-gray-500 font-medium text-right">끄면 새 주문 중단 + 미체결 취소 (코인은 안 팔고, 손절도 멈춰요)</span>
        </div>

        {snapshot && bots.length === 0 && (
          <div className="bg-white rounded-[26px] p-6 shadow-sm border border-black/[0.04] text-center">
            <div className="text-3xl">🤖</div>
            <p className="font-extrabold text-[16px] text-[#191F28] mt-2">아직 만든 봇이 없어요</p>
            <p className="text-xs text-[#6B7684] mt-1">위의 "봇 세팅하기"를 눌러 첫 봇을 만들어 보세요. 처음에는 모의투자로 동작해요.</p>
          </div>
        )}

        {bots.map((bot) => (
          <BotCard
            key={bot.id}
            bot={bot}
            pending={pendingBotIds.has(bot.id)}
            liveEnabled={snapshot?.system.liveEnabled ?? false}
            onToggle={() => onToggle(bot)}
            onDelete={() => onDelete(bot)}
            onSwitchMode={() => onSwitchMode(bot)}
            onLiquidatePaper={() => onLiquidatePaper(bot)}
          />
        ))}
      </div>

      {/* 모든 자동매매 멈추기 */}
      <div className={`rounded-[26px] p-5 shadow-sm border ${emergency ? 'bg-rose-50 border-rose-100' : 'bg-white border-black/[0.04]'}`}>
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-rose-100 text-[#F04452] flex items-center justify-center text-xl shrink-0">🛑</div>
            <div>
              <div className="font-extrabold text-[16px] text-[#191F28]">{emergency ? '긴급 정지 중이에요' : '모든 자동매매 멈추기'}</div>
              <p className="text-xs text-[#6B7684] mt-0.5 leading-relaxed">
                {emergency
                  ? '모든 봇이 꺼져 있고 새 주문이 막혀 있어요. 해제한 뒤 봇을 하나씩 다시 켤 수 있어요.'
                  : '모든 봇을 끄고, 봇이 넣어둔 미체결 주문을 취소해요. 가진 코인은 팔지 않으며, 멈춘 동안엔 손절도 작동하지 않아요.'}
              </p>
            </div>
          </div>
          <button
            onClick={emergency ? onReleaseEmergency : onEmergencyStop}
            className={`shrink-0 px-3.5 py-2.5 rounded-xl text-xs font-black transition-colors ${
              emergency ? 'bg-white text-[#191F28] border border-gray-200 hover:bg-gray-50' : 'bg-[#F04452] text-white hover:bg-[#d93a47]'
            }`}
          >
            {emergency ? '긴급 정지 해제' : '전체 멈추기'}
          </button>
        </div>
      </div>

      {/* 초보자 Q&A 안내 */}
      <div className="bg-white rounded-[26px] p-6 shadow-sm border border-black/[0.04] space-y-3.5">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-lg bg-orange-100 text-orange-600 flex items-center justify-center font-bold text-xs">💡</div>
          <h3 className="font-extrabold text-[16px] text-[#191F28]">초보자가 자주 묻는 질문</h3>
        </div>

        <div className="space-y-3 text-xs sm:text-sm text-[#4E5968]">
          <div className="bg-[#F9FAFB] p-3.5 rounded-2xl">
            <span className="font-bold text-[#191F28] block mb-1">Q. 봇이 제 돈을 출금해갈 수 있나요?</span>
            <p className="text-xs text-[#6B7684] leading-relaxed">
              이 프로그램에는 <strong>출금 기능이 아예 없어요.</strong> 그래도 만일을 위해 업비트 API Key를 만들 때 <strong>'출금하기' 권한은 반드시 끄고</strong> '자산조회 / 주문조회 /
              주문하기'만 켜 주세요. 프로그램은 출금 권한이 꺼져 있는지 직접 확인할 수 없으니, 업비트 화면에서 꼭 확인해 주세요.
            </p>
          </div>

          <div className="bg-[#F9FAFB] p-3.5 rounded-2xl">
            <span className="font-bold text-[#191F28] block mb-1">Q. 급락하면 어떡하나요?</span>
            <p className="text-xs text-[#6B7684] leading-relaxed">
              봇마다 <strong>손절 기준(-2% 등)</strong>을 정할 수 있어요. 평균 매입가 대비 그 기준에 닿으면 시장가로 팔도록 주문을 보내요. 단, 급락할 때는 실제 체결 가격이 기준보다 더 낮을 수
              있고, <strong>봇이 꺼져 있거나 프로그램이 꺼져 있으면 손절도 작동하지 않아요.</strong> 손절선에 닿아 팔고 나면 하락 중 다시 사지 않도록 봇이 자동으로 꺼져요.
            </p>
          </div>

          <div className="bg-[#F9FAFB] p-3.5 rounded-2xl">
            <span className="font-bold text-[#191F28] block mb-1">Q. 모의투자(PAPER)와 실전(LIVE)은 뭐가 달라요?</span>
            <p className="text-xs text-[#6B7684] leading-relaxed">
              모의투자는 실제 업비트 시세로 가상의 돈을 사고팔아 보는 연습이에요. 실전은 실제 계좌로 주문하며, 업비트 API 연결 탭에서 점검 항목을 모두 통과하고 직접 허용해야만 켤 수 있어요.
            </p>
          </div>
        </div>
      </div>
    </>
  );
}

function BotCard({
  bot,
  pending,
  liveEnabled,
  onToggle,
  onDelete,
  onSwitchMode,
  onLiquidatePaper,
}: {
  bot: BotDTO;
  pending: boolean;
  liveEnabled: boolean;
  onToggle: () => void;
  onDelete: () => void;
  onSwitchMode: () => void;
  onLiquidatePaper: () => void;
}) {
  const base = baseSymbol(bot.displaySymbol);
  const meta = coinMeta(base);
  const st = bot.stats;
  const rate = st.totalPnlPercentOfBudget;
  const [showOrders, setShowOrders] = useState(false);
  return (
    <div className={`bg-white rounded-[26px] p-5 shadow-sm border transition-all duration-200 ${bot.active ? 'border-black/[0.04]' : 'border-gray-200/70 bg-gray-50/60 opacity-80'}`}>
      {/* 상단: 로고 & 이름 & 토글 */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-3 min-w-0">
          <div className={`w-12 h-12 rounded-2xl ${meta.badgeBg} flex items-center justify-center text-2xl font-black shadow-inner shrink-0`}>{meta.icon}</div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-extrabold text-[18px] text-[#191F28] tracking-tight">{bot.coinName}</h3>
              <span className="text-xs font-bold text-gray-400 bg-gray-100 px-2 py-0.5 rounded-md">{bot.displaySymbol}</span>
              <span className="text-[10px] font-bold text-gray-400">#{bot.id}</span>
              <span className={`text-[10px] font-black px-1.5 py-0.5 rounded-md ${bot.mode === 'LIVE' ? 'bg-rose-100 text-[#F04452]' : 'bg-gray-100 text-gray-500'}`}>{MODE_LABEL[bot.mode]}</span>
            </div>
            {bot.name !== `${bot.coinName} ${STRATEGY_LABEL[bot.strategy]}` && <div className="text-[11px] font-bold text-[#4E5968] truncate">{bot.name}</div>}
            <div className="text-xs font-semibold text-[#6B7684] mt-0.5 flex items-center gap-1.5 flex-wrap">
              <span>현재가 {st.currentPrice != null ? `${price(st.currentPrice)}원` : '수신 대기'}</span>
              <span className="text-gray-300">·</span>
              <span className="text-[#3182F6] font-bold">{STRATEGY_LABEL[bot.strategy]}</span>
            </div>
          </div>
        </div>

        {/* 대형 토글 스위치 */}
        <button
          onClick={onToggle}
          disabled={pending}
          className={`relative inline-flex h-8 w-14 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none disabled:cursor-wait ${
            bot.active ? 'bg-[#3182F6]' : 'bg-[#D1D6DB]'
          }`}
          aria-label="봇 On/Off 토글"
        >
          <span className={`pointer-events-none inline-block h-7 w-7 transform rounded-full bg-white shadow-md ring-0 transition duration-200 ease-in-out ${bot.active ? 'translate-x-6' : 'translate-x-0'}`} />
        </button>
      </div>

      {/* 전략 설명 카드 */}
      <div className="mt-4 bg-[#F2F4F6] rounded-2xl p-3.5">
        <div className="flex items-center justify-between text-xs font-bold text-[#191F28] gap-2">
          <span className="flex items-center gap-1">
            <Sparkles className="w-3.5 h-3.5 text-[#3182F6] shrink-0" />
            {bot.strategyTitle}
          </span>
          <span className="text-gray-500 font-semibold text-right">{bot.targetRange}</span>
        </div>
        <p className="text-xs text-[#6B7684] mt-1 font-medium leading-relaxed">{bot.strategyDescription}</p>
      </div>

      {/* 세부 통계 그리드 */}
      <div className="mt-4 grid grid-cols-3 gap-2 pt-3 border-t border-gray-100 text-center">
        <div>
          <div className="text-[11px] font-semibold text-[#8B95A1]">운용 예산</div>
          <div className="text-[15px] font-extrabold text-[#191F28] mt-0.5">{won(bot.budgetKRW)}</div>
        </div>
        <div>
          <div className="text-[11px] font-semibold text-[#8B95A1]">오늘 체결</div>
          <div className="text-[15px] font-extrabold text-[#3182F6] mt-0.5">{st.todayTradesCount}회</div>
        </div>
        <div>
          <div className="text-[11px] font-semibold text-[#8B95A1]">수익률(예산 대비)</div>
          <div className={`text-[15px] font-extrabold mt-0.5 ${Math.abs(rate) < 0.005 ? 'text-[#191F28]' : rate > 0 ? 'text-[#F04452]' : 'text-[#3182F6]'}`}>{signedPercent(rate)}</div>
        </div>
      </div>

      {(st.positionQuantity > 0 || st.openOrdersCount > 0 || st.realizedPnl !== 0) && (
        <p className="mt-2 text-[11px] text-[#8B95A1] font-medium text-center leading-relaxed">
          {st.positionQuantity > 0 && (
            <>
              들고 있는 코인 {qty(st.positionQuantity)} {base} (평균 {price(st.averageEntryPrice)}원) · 현재 기준 {signedWon(st.unrealizedPnl)}
            </>
          )}
          {st.positionQuantity > 0 && (st.realizedPnl !== 0 || st.openOrdersCount > 0) && ' · '}
          {st.realizedPnl !== 0 && <>확정 수익 {signedWon(st.realizedPnl)}</>}
          {st.realizedPnl !== 0 && st.openOrdersCount > 0 && ' · '}
          {st.openOrdersCount > 0 && <>대기 중인 주문 {st.openOrdersCount}건</>}
        </p>
      )}

      {bot.openOrders.length > 0 && (
        <div className="mt-2">
          <button onClick={() => setShowOrders((v) => !v)} className="w-full flex items-center justify-center gap-1 text-[11px] font-bold text-[#4E5968] hover:text-[#191F28]">
            대기 중인 주문 {bot.openOrders.length}건 {showOrders ? '접기' : '보기'}
            <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showOrders ? 'rotate-180' : ''}`} />
          </button>
          {showOrders && (
            <div className="mt-1.5 bg-[#F9FAFB] rounded-xl divide-y divide-gray-100 text-[11px]">
              {bot.openOrders.map((o) => (
                <div key={o.id} className="flex items-center justify-between px-3 py-1.5">
                  <span className={`font-extrabold ${o.side === 'bid' ? 'text-[#1B64DA]' : 'text-[#F04452]'}`}>
                    {o.side === 'bid' ? '사기' : '팔기'} 예약{o.gridLevelId ? ` · ${o.gridLevelId.replace('L', '')}번째 칸` : ''}
                  </span>
                  <span className="text-[#4E5968] font-bold">
                    {o.price ? `${price(o.price)}원` : '시장가'} · {o.volume ? `${qty(o.volume)} ${base}` : ''}
                    {Number(o.executedVolume) > 0 ? ` (일부 체결 ${qty(o.executedVolume)})` : ''}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {!bot.active && st.positionQuantity > 0 && (
        <p className="mt-2 text-[11px] font-bold text-amber-700 bg-amber-50 rounded-lg px-3 py-1.5">⚠ 꺼져 있어서 들고 있는 코인의 손절·익절이 작동하지 않아요</p>
      )}

      {bot.blockedReason && <p className="mt-2 text-[11px] font-bold text-amber-700 bg-amber-50 rounded-lg px-3 py-1.5">⚠ {bot.blockedReason}</p>}

      {/* 최근 감지 시그널 */}
      <div className="mt-3.5 flex items-center justify-between text-xs bg-[#FAFAFB] px-3.5 py-2.5 rounded-xl border border-gray-100 gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="relative flex h-2 w-2 shrink-0">
            {bot.active && <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>}
            <span className={`relative inline-flex rounded-full h-2 w-2 ${bot.active ? 'bg-emerald-500' : 'bg-gray-400'}`}></span>
          </span>
          <span className="text-gray-500 font-medium shrink-0">최근 신호:</span>
          <span className="font-extrabold text-[#333D4B] truncate">{bot.lastSignalText ?? (bot.active ? '시그널 대기 중 (실시간 시세 감시)' : '꺼져 있어요')}</span>
        </div>
        <span className="text-gray-400 font-medium text-[11px] shrink-0">{relativeTime(bot.lastSignalAt)}</span>
      </div>

      {!bot.active && (
        <div className="mt-3 flex justify-end gap-2 flex-wrap">
          {bot.mode === 'PAPER' && st.positionQuantity > 0 && (
            <button onClick={onLiquidatePaper} className="px-3 py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 text-xs font-bold text-[#4E5968]">
              모의 코인 팔기
            </button>
          )}
          {(liveEnabled || bot.mode === 'LIVE') && (
            <button onClick={onSwitchMode} className="px-3 py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 text-xs font-bold text-[#4E5968]">
              {bot.mode === 'PAPER' ? '실전(LIVE)으로 전환' : '모의(PAPER)로 전환'}
            </button>
          )}
          <button onClick={onDelete} className="px-3 py-1.5 rounded-lg bg-gray-100 hover:bg-rose-50 text-xs font-bold text-[#4E5968] hover:text-[#F04452]">
            봇 삭제
          </button>
        </div>
      )}
    </div>
  );
}
