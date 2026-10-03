// ⚠ 참고용 원본 — 빌드에 포함되지 않습니다.
// 사용자가 작업지시서(2026-10-03)로 제공한 UI 프로토타입 원본 그대로입니다.
// 실제 앱은 src/App.tsx + src/components/* 에서 이 디자인을 유지한 채 실제 데이터와 연결됩니다.
import React, { useState } from 'react';
import {
  Plus,
  ShieldCheck,
  Clock,
  ChevronRight,
  Sparkles,
  ArrowUpRight,
  ArrowDownRight,
  RefreshCw,
  Activity,
  X
} from 'lucide-react';

interface BotStrategy {
  id: string;
  coinName: string;
  symbol: string;
  icon: string;
  badgeBg: string;
  isActive: boolean;
  strategyType: '무한 그물망(그리드)' | '과매도 반등 줍줍(RSI)' | '골든크로스 돌파' | '급락 방어 손절컷';
  strategyTitle: string;
  strategyDesc: string;
  targetRange: string;
  currentPrice: number;
  allocatedKRW: number;
  totalProfitRate: number;
  totalProfitKRW: number;
  todayTradesCount: number;
  lastSignal: string;
  signalTime: string;
  mode: '자동 매수·매도' | '신호 알림만 받기';
}

interface SignalLog {
  id: string;
  coinName: string;
  symbol: string;
  type: '매수체결' | '익절매도' | '손절방어' | '시그널감지';
  price: string;
  volume: string;
  reason: string;
  time: string;
  pnl?: string;
}

export default function App() {
  // 코인 자동매매 봇 목록 상태
  const [bots, setBots] = useState<BotStrategy[]>([
    {
      id: 'bot-1',
      coinName: '비트코인',
      symbol: 'BTC/KRW',
      icon: '₿',
      badgeBg: 'bg-amber-100 text-amber-700',
      isActive: true,
      strategyType: '무한 그물망(그리드)',
      strategyTitle: '1.2억~1.4억 박스권 무한 짤짤이',
      strategyDesc: '가격이 내려갈 때마다 쪼개 사고, 오르면 1.5%씩 바로 익절',
      targetRange: '125,000,000 ~ 138,000,000원',
      currentPrice: 132450000,
      allocatedKRW: 3000000,
      totalProfitRate: 18.4,
      totalProfitKRW: 552000,
      todayTradesCount: 14,
      lastSignal: '1.5% 익절 완료 (체결)',
      signalTime: '12분 전',
      mode: '자동 매수·매도'
    },
    {
      id: 'bot-2',
      coinName: '리플',
      symbol: 'XRP/KRW',
      icon: '✕',
      badgeBg: 'bg-zinc-100 text-zinc-800',
      isActive: true,
      strategyType: '과매도 반등 줍줍(RSI)',
      strategyTitle: '공포에 사서 환희에 파는 RSI 봇',
      strategyDesc: '단기 패닉셀로 RSI 30 이하 떨어지면 분할 진입, 65 도달 시 매도',
      targetRange: 'RSI 30 이하 진입',
      currentPrice: 3420,
      allocatedKRW: 1000000,
      totalProfitRate: 9.2,
      totalProfitKRW: 92000,
      todayTradesCount: 3,
      lastSignal: '과매도 구간 1차 분할매수',
      signalTime: '1시간 전',
      mode: '자동 매수·매도'
    },
    {
      id: 'bot-3',
      coinName: '이더리움',
      symbol: 'ETH/KRW',
      icon: 'Ξ',
      badgeBg: 'bg-blue-100 text-blue-700',
      isActive: false,
      strategyType: '골든크로스 돌파',
      strategyTitle: '상승 추세 시작할 때만 탑승',
      strategyDesc: '이동평균선 골든크로스 확인 시 불타기 매수, 하락 전환 시 즉시 매도',
      targetRange: '이평선 5일/20일 교차선',
      currentPrice: 4850000,
      allocatedKRW: 2000000,
      totalProfitRate: -1.2,
      totalProfitKRW: -24000,
      todayTradesCount: 0,
      lastSignal: '대기 중 (하락장 관망)',
      signalTime: '어제 19:30',
      mode: '자동 매수·매도'
    },
    {
      id: 'bot-4',
      coinName: '솔라나',
      symbol: 'SOL/KRW',
      icon: '◎',
      badgeBg: 'bg-purple-100 text-purple-700',
      isActive: true,
      strategyType: '무한 그물망(그리드)',
      strategyTitle: '변동성 큰 솔라나 24시간 자동단타',
      strategyDesc: '하루 24시간 쉬지 않고 0.8%씩 짧게 끊어 먹기',
      targetRange: '260,000 ~ 310,000원',
      currentPrice: 284500,
      allocatedKRW: 1500000,
      totalProfitRate: 24.6,
      totalProfitKRW: 369000,
      todayTradesCount: 28,
      lastSignal: '매도 익절 (+0.85%)',
      signalTime: '3분 전',
      mode: '자동 매수·매도'
    }
  ]);

  // 실시간 체결 로그
  const [logs] = useState<SignalLog[]>([
    {
      id: 'log-1',
      coinName: '솔라나 (SOL)',
      symbol: 'SOL/KRW',
      type: '익절매도',
      price: '284,500원',
      volume: '1.2 SOL',
      reason: '그물망 상단 목표가 도달 (+0.85% 익절 완료)',
      time: '3분 전',
      pnl: '+2,900원 (+0.85%)'
    },
    {
      id: 'log-2',
      coinName: '비트코인 (BTC)',
      symbol: 'BTC/KRW',
      type: '익절매도',
      price: '132,450,000원',
      volume: '0.0035 BTC',
      reason: '1.5% 구간 익절 타겟 터치',
      time: '12분 전',
      pnl: '+6,950원 (+1.52%)'
    },
    {
      id: 'log-3',
      coinName: '리플 (XRP)',
      symbol: 'XRP/KRW',
      type: '매수체결',
      price: '3,390원',
      volume: '147 XRP',
      reason: 'RSI 28.4 과매도 구간 진입으로 1차 분할 매수 체결',
      time: '1시간 전'
    },
    {
      id: 'log-4',
      coinName: '솔라나 (SOL)',
      symbol: 'SOL/KRW',
      type: '매수체결',
      price: '282,100원',
      volume: '1.2 SOL',
      reason: '그물망 하단 지지선 매수 걸어둔 주문 체결',
      time: '1시간 40분 전'
    },
    {
      id: 'log-5',
      coinName: '비트코인 (BTC)',
      symbol: 'BTC/KRW',
      type: '손절방어',
      price: '129,500,000원',
      volume: '0.005 BTC',
      reason: '지정 손절라인 -3.0% 터치로 추가 하락 방어 시장가 청산',
      time: '어제 22:15',
      pnl: '-19,400원 (-3.0%)'
    }
  ]);

  // 상단 탭 상태 (bots: 내 봇 목록, signals: 체결/신호, upbit: 계좌연결)
  const [activeTab, setActiveTab] = useState<'bots' | 'signals' | 'upbit'>('bots');

  // 신규 봇 만들기 모달 상태
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [selectedCoin, setSelectedCoin] = useState({ name: '도지코인', symbol: 'DOGE/KRW', icon: '🐕', price: 295 });
  const [selectedStrategy, setSelectedStrategy] = useState<'grid' | 'rsi' | 'breakout'>('grid');
  const [investBudget, setInvestBudget] = useState<number>(500000);
  const [autoSellProfit, setAutoSellProfit] = useState<number>(2.0);
  const [autoStopLoss, setAutoStopLoss] = useState<number>(3.0);

  // 알림 토스트 상태
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage(null);
    }, 2800);
  };

  const toggleBot = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setBots(prev => prev.map(b => {
      if (b.id === id) {
        const nextState = !b.isActive;
        showToast(nextState ? `⚡ [${b.coinName}] 자동매매 봇을 켰어요! 24시간 시그널 감시 시작` : `⏸️ [${b.coinName}] 자동매매 봇을 일시정지했어요.`);
        return { ...b, isActive: nextState };
      }
      return b;
    }));
  };

  const handleCreateBot = () => {
    const strategyTitles = {
      grid: '박스권 무한 짤짤이 그물망',
      rsi: 'RSI 과매도 바닥 줍줍 전략',
      breakout: '급등 신호 포착 돌파 매매'
    };
    const strategyTypes: Record<string, BotStrategy['strategyType']> = {
      grid: '무한 그물망(그리드)',
      rsi: '과매도 반등 줍줍(RSI)',
      breakout: '골든크로스 돌파'
    };

    const newBot: BotStrategy = {
      id: `bot-${Date.now()}`,
      coinName: selectedCoin.name,
      symbol: selectedCoin.symbol,
      icon: selectedCoin.icon,
      badgeBg: 'bg-yellow-100 text-yellow-800',
      isActive: true,
      strategyType: strategyTypes[selectedStrategy],
      strategyTitle: `${selectedCoin.name} ${strategyTitles[selectedStrategy]}`,
      strategyDesc: `+${autoSellProfit}% 오르면 자동 익절 / -${autoStopLoss}% 하락 시 안전 손절컷`,
      targetRange: `목표 익절 +${autoSellProfit}%`,
      currentPrice: selectedCoin.price,
      allocatedKRW: investBudget,
      totalProfitRate: 0.0,
      totalProfitKRW: 0,
      todayTradesCount: 0,
      lastSignal: '시그널 대기 중 (실시간 호가 추적)',
      signalTime: '방금 전',
      mode: '자동 매수·매도'
    };

    setBots([newBot, ...bots]);
    setIsCreateModalOpen(false);
    showToast(`🤖 [${selectedCoin.name}] 24시간 자동매매 봇이 가동을 시작했어요!`);
  };

  // 통계 계산
  const totalAllocated = bots.reduce((acc, cur) => acc + (cur.isActive ? cur.allocatedKRW : 0), 0);
  const totalProfitSum = bots.reduce((acc, cur) => acc + cur.totalProfitKRW, 0);
  const activeBotsCount = bots.filter(b => b.isActive).length;
  const totalTradesToday = bots.reduce((acc, cur) => acc + cur.todayTradesCount, 0);

  return (
    <div className="min-h-screen bg-[#F2F4F6] text-[#191F28] pb-24 selection:bg-[#3182F6]/20 font-sans">
      {/* 상단 플로팅 토스트 알림 */}
      {toastMessage && (
        <div className="fixed top-5 left-1/2 -translate-x-1/2 z-50 bg-[#191F28]/95 text-white px-5 py-3.5 rounded-2xl shadow-xl flex items-center gap-2.5 text-[15px] font-semibold animate-in fade-in slide-in-from-top-4 duration-300 backdrop-blur-md border border-white/10">
          <span>{toastMessage}</span>
        </div>
      )}

      {/* 헤더 */}
      <header className="sticky top-0 z-30 bg-white/90 backdrop-blur-md border-b border-gray-100">
        <div className="max-w-2xl mx-auto px-5 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-[#093687] text-white flex items-center justify-center font-black text-sm shadow-sm">
              UP
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <span className="font-extrabold text-[18px] tracking-tight">코인 시그널 봇</span>
                <span className="px-1.5 py-0.5 rounded text-[10px] font-black bg-blue-50 text-[#093687]">
                  업비트 전용
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-[#E8F3FF] text-[#1B64DA]">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
              24시간 자동 감시 중
            </span>
          </div>
        </div>

        {/* 탭 네비게이션 */}
        <div className="max-w-2xl mx-auto px-5 flex gap-7 text-[16px] font-bold border-t border-gray-50">
          <button
            onClick={() => setActiveTab('bots')}
            className={`py-3 relative transition-colors ${activeTab === 'bots' ? 'text-[#191F28]' : 'text-[#8B95A1] hover:text-[#4E5968]'}`}
          >
            가동 중인 봇 ({bots.length})
            {activeTab === 'bots' && (
              <span className="absolute bottom-0 left-0 right-0 h-0.75 bg-[#191F28] rounded-full"></span>
            )}
          </button>
          <button
            onClick={() => setActiveTab('signals')}
            className={`py-3 relative transition-colors ${activeTab === 'signals' ? 'text-[#191F28]' : 'text-[#8B95A1] hover:text-[#4E5968]'}`}
          >
            시그널 & 체결내역
            {activeTab === 'signals' && (
              <span className="absolute bottom-0 left-0 right-0 h-0.75 bg-[#191F28] rounded-full"></span>
            )}
          </button>
          <button
            onClick={() => setActiveTab('upbit')}
            className={`py-3 relative transition-colors ${activeTab === 'upbit' ? 'text-[#191F28]' : 'text-[#8B95A1] hover:text-[#4E5968]'}`}
          >
            업비트 API 연결
            {activeTab === 'upbit' && (
              <span className="absolute bottom-0 left-0 right-0 h-0.75 bg-[#191F28] rounded-full"></span>
            )}
          </button>
        </div>
      </header>

      {/* 메인 뷰 */}
      <main className="max-w-2xl mx-auto px-4 pt-5 space-y-4">

        {/* 탭 1: 가동 중인 봇 */}
        {activeTab === 'bots' && (
          <>
            {/* 총 누적 수익 대형 카드 */}
            <div className="bg-white rounded-[28px] p-6 shadow-sm border border-black/[0.03]">
              <div className="flex items-center justify-between text-[#6B7684] text-sm font-semibold mb-1">
                <span>봇이 알아서 벌어준 총 수익</span>
                <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-600 bg-emerald-50 px-2.5 py-1 rounded-lg">
                  <Activity className="w-3.5 h-3.5" /> 오늘 {totalTradesToday}회 자동 거래
                </span>
              </div>

              <div className="flex items-baseline gap-2 mt-1">
                <span className="text-[34px] font-black tracking-tight text-[#191F28]">
                  +{totalProfitSum.toLocaleString()}원
                </span>
                <span className="text-[#F04452] font-black text-lg">
                  (+13.8%)
                </span>
              </div>

              {/* 하단 서브 지표 칩 */}
              <div className="mt-4 pt-4 border-t border-gray-100 grid grid-cols-2 gap-3 text-xs">
                <div className="bg-[#F9FAFB] p-3 rounded-xl">
                  <div className="text-gray-400 font-medium">봇에 할당된 시드머니</div>
                  <div className="text-[15px] font-extrabold text-[#191F28] mt-0.5">
                    {totalAllocated.toLocaleString()}원
                  </div>
                </div>
                <div className="bg-[#F9FAFB] p-3 rounded-xl">
                  <div className="text-gray-400 font-medium">작동 중인 코인 봇</div>
                  <div className="text-[15px] font-extrabold text-[#3182F6] mt-0.5">
                    {activeBotsCount}개 가동 중 (전체 {bots.length}개)
                  </div>
                </div>
              </div>

              {/* 초보자 안심 배너 */}
              <div className="mt-4 bg-[#F2F7FF] rounded-2xl p-3.5 flex items-center gap-3 border border-blue-100">
                <div className="w-9 h-9 rounded-full bg-[#3182F6] text-white flex items-center justify-center shrink-0 font-bold text-sm">
                  ⚡
                </div>
                <div className="text-xs">
                  <p className="font-extrabold text-[#1B64DA]">코인판 24시간 쳐다볼 필요 없어요</p>
                  <p className="text-[#4E5968] mt-0.5">자는 동안에도 원하는 가격대나 시그널이 오면 알아서 사고팝니다.</p>
                </div>
              </div>
            </div>

            {/* 신규 봇 만들기 배너 버튼 */}
            <button
              onClick={() => setIsCreateModalOpen(true)}
              className="w-full bg-[#093687] hover:bg-[#072c6e] text-white rounded-[24px] p-5 flex items-center justify-between font-bold text-left shadow-lg shadow-[#093687]/20 transition-all duration-200 active:scale-[0.99] group"
            >
              <div className="flex items-center gap-3.5">
                <div className="w-12 h-12 rounded-2xl bg-white/10 flex items-center justify-center text-2xl backdrop-blur-xs">
                  🤖
                </div>
                <div>
                  <div className="text-[17px] font-extrabold">새로운 코인 자동매매 봇 만들기</div>
                  <div className="text-xs text-blue-200 mt-0.5 font-medium">원하는 코인과 목표 수익률만 고르면 끝나요</div>
                </div>
              </div>
              <span className="bg-white text-[#093687] px-3.5 py-1.5 rounded-xl text-xs font-black shadow-sm flex items-center gap-1 group-hover:translate-x-0.5 transition-transform">
                봇 세팅하기 <ChevronRight className="w-3.5 h-3.5 stroke-[3]" />
              </span>
            </button>

            {/* 봇 카드 리스트 */}
            <div className="space-y-3 pt-1">
              <div className="flex items-center justify-between px-2">
                <h2 className="text-[18px] font-extrabold text-[#191F28]">내 코인 봇 목록</h2>
                <span className="text-xs text-gray-500 font-medium">스위치를 끄면 즉시 모든 주문이 정지돼요</span>
              </div>

              {bots.map((bot) => (
                <div
                  key={bot.id}
                  className={`bg-white rounded-[26px] p-5 shadow-sm border transition-all duration-200 ${
                    bot.isActive ? 'border-black/[0.04]' : 'border-gray-200/70 bg-gray-50/60 opacity-80'
                  }`}
                >
                  {/* 상단: 로고 & 이름 & 토글 */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className={`w-12 h-12 rounded-2xl ${bot.badgeBg} flex items-center justify-center text-2xl font-black shadow-inner`}>
                        {bot.icon}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="font-extrabold text-[18px] text-[#191F28] tracking-tight">{bot.coinName}</h3>
                          <span className="text-xs font-bold text-gray-400 bg-gray-100 px-2 py-0.5 rounded-md">
                            {bot.symbol}
                          </span>
                        </div>
                        <div className="text-xs font-semibold text-[#6B7684] mt-0.5 flex items-center gap-1.5">
                          <span>현재가 {bot.currentPrice.toLocaleString()}원</span>
                          <span className="text-gray-300">·</span>
                          <span className="text-[#3182F6] font-bold">{bot.strategyType}</span>
                        </div>
                      </div>
                    </div>

                    {/* 대형 토글 스위치 */}
                    <button
                      onClick={(e) => toggleBot(bot.id, e)}
                      className={`relative inline-flex h-8 w-14 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                        bot.isActive ? 'bg-[#3182F6]' : 'bg-[#D1D6DB]'
                      }`}
                      aria-label="봇 On/Off 토글"
                    >
                      <span
                        className={`pointer-events-none inline-block h-7 w-7 transform rounded-full bg-white shadow-md ring-0 transition duration-200 ease-in-out ${
                          bot.isActive ? 'translate-x-6' : 'translate-x-0'
                        }`}
                      />
                    </button>
                  </div>

                  {/* 전략 설명 카드 */}
                  <div className="mt-4 bg-[#F2F4F6] rounded-2xl p-3.5">
                    <div className="flex items-center justify-between text-xs font-bold text-[#191F28]">
                      <span className="flex items-center gap-1">
                        <Sparkles className="w-3.5 h-3.5 text-[#3182F6]" />
                        {bot.strategyTitle}
                      </span>
                      <span className="text-gray-500 font-semibold">{bot.targetRange}</span>
                    </div>
                    <p className="text-xs text-[#6B7684] mt-1 font-medium leading-relaxed">
                      {bot.strategyDesc}
                    </p>
                  </div>

                  {/* 세부 통계 그리드 */}
                  <div className="mt-4 grid grid-cols-3 gap-2 pt-3 border-t border-gray-100 text-center">
                    <div>
                      <div className="text-[11px] font-semibold text-[#8B95A1]">운용 예산</div>
                      <div className="text-[15px] font-extrabold text-[#191F28] mt-0.5">
                        {bot.allocatedKRW.toLocaleString()}원
                      </div>
                    </div>
                    <div>
                      <div className="text-[11px] font-semibold text-[#8B95A1]">오늘 자동 체결</div>
                      <div className="text-[15px] font-extrabold text-[#3182F6] mt-0.5">
                        {bot.todayTradesCount}회
                      </div>
                    </div>
                    <div>
                      <div className="text-[11px] font-semibold text-[#8B95A1]">누적 수익률</div>
                      <div className={`text-[15px] font-extrabold mt-0.5 ${
                        bot.totalProfitRate >= 0 ? 'text-[#F04452]' : 'text-[#3182F6]'
                      }`}>
                        {bot.totalProfitRate >= 0 ? `+${bot.totalProfitRate}%` : `${bot.totalProfitRate}%`}
                      </div>
                    </div>
                  </div>

                  {/* 최근 감지 시그널 */}
                  <div className="mt-3.5 flex items-center justify-between text-xs bg-[#FAFAFB] px-3.5 py-2.5 rounded-xl border border-gray-100">
                    <div className="flex items-center gap-2">
                      <span className="relative flex h-2 w-2">
                        {bot.isActive && (
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                        )}
                        <span className={`relative inline-flex rounded-full h-2 w-2 ${bot.isActive ? 'bg-emerald-500' : 'bg-gray-400'}`}></span>
                      </span>
                      <span className="text-gray-500 font-medium">최근 신호:</span>
                      <span className="font-extrabold text-[#333D4B]">{bot.lastSignal}</span>
                    </div>
                    <span className="text-gray-400 font-medium text-[11px]">{bot.signalTime}</span>
                  </div>
                </div>
              ))}
            </div>

            {/* 초보자 Q&A 안내 */}
            <div className="bg-white rounded-[26px] p-6 shadow-sm border border-black/[0.04] space-y-3.5">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-lg bg-orange-100 text-orange-600 flex items-center justify-center font-bold text-xs">
                  💡
                </div>
                <h3 className="font-extrabold text-[16px] text-[#191F28]">초보자가 자주 묻는 질문</h3>
              </div>

              <div className="space-y-3 text-xs sm:text-sm text-[#4E5968]">
                <div className="bg-[#F9FAFB] p-3.5 rounded-2xl">
                  <span className="font-bold text-[#191F28] block mb-1">Q. 봇이 제 돈을 출금해갈 수 있나요?</span>
                  <p className="text-xs text-[#6B7684] leading-relaxed">
                    전혀 불가능합니다! 업비트 API 키 발급 시 <strong>'출금 권한'은 반드시 끄고 '조회/매수/매도' 권한만</strong> 허용하기 때문에 안전합니다.
                  </p>
                </div>

                <div className="bg-[#F9FAFB] p-3.5 rounded-2xl">
                  <span className="font-bold text-[#191F28] block mb-1">Q. 급락하면 어떡하나요?</span>
                  <p className="text-xs text-[#6B7684] leading-relaxed">
                    모든 봇에는 <strong>'자동 손절컷 (Safety Stop)'</strong>이 내장되어 있어, 지정한 손실률(-3% 등)에 도달하면 즉시 자동으로 원화(KRW)로 바꿔 안전하게 방어합니다.
                  </p>
                </div>
              </div>
            </div>
          </>
        )}

        {/* 탭 2: 시그널 & 체결내역 */}
        {activeTab === 'signals' && (
          <div className="space-y-4">
            <div className="bg-white rounded-[26px] p-6 shadow-sm border border-black/[0.03]">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-[20px] font-extrabold text-[#191F28]">실시간 시그널 & 체결 기록</h2>
                  <p className="text-xs text-[#6B7684] mt-1">업비트 실시간 호가/지표 기반 자동 주문 영수증</p>
                </div>
                <button
                  onClick={() => showToast('체결 내역을 새로고침했어요.')}
                  className="p-2.5 rounded-xl bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors"
                >
                  <RefreshCw className="w-4 h-4" />
                </button>
              </div>

              <div className="divide-y divide-gray-100">
                {logs.map((log) => (
                  <div key={log.id} className="py-4 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className={`w-11 h-11 rounded-2xl flex items-center justify-center font-black text-sm shrink-0 ${
                        log.type === '익절매도'
                          ? 'bg-rose-50 text-[#F04452]'
                          : (log.type === '매수체결' ? 'bg-blue-50 text-[#3182F6]' : 'bg-gray-100 text-gray-600')
                      }`}>
                        {log.type === '익절매도' ? <ArrowUpRight className="w-5 h-5 stroke-[2.5]" /> : <ArrowDownRight className="w-5 h-5 stroke-[2.5]" />}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-extrabold text-[16px] text-[#191F28]">{log.coinName}</span>
                          <span className={`text-[10px] font-black px-2 py-0.5 rounded-md ${
                            log.type === '익절매도'
                              ? 'bg-rose-100 text-[#F04452]'
                              : (log.type === '매수체결' ? 'bg-blue-100 text-[#1B64DA]' : 'bg-gray-200 text-gray-700')
                          }`}>
                            {log.type}
                          </span>
                        </div>
                        <p className="text-xs text-[#6B7684] mt-0.5 line-clamp-1">{log.reason}</p>
                        <div className="text-[11px] text-[#8B95A1] mt-0.5">
                          체결가: {log.price} ({log.volume}) · {log.time}
                        </div>
                      </div>
                    </div>

                    <div className="text-right shrink-0 ml-3">
                      {log.pnl ? (
                        <div className={`font-black text-[15px] ${log.pnl.startsWith('+') ? 'text-[#F04452]' : 'text-[#3182F6]'}`}>
                          {log.pnl}
                        </div>
                      ) : (
                        <div className="font-bold text-[14px] text-gray-700">진입 완료</div>
                      )}
                      <span className="text-[10px] text-gray-400 font-medium">업비트 체결</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* 탭 3: 업비트 API 연결 */}
        {activeTab === 'upbit' && (
          <div className="space-y-4">
            <div className="bg-white rounded-[26px] p-6 shadow-sm border border-black/[0.03] space-y-5">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-2xl bg-[#093687] text-white flex items-center justify-center font-black text-xl shadow-md shadow-[#093687]/20">
                  UP
                </div>
                <div>
                  <h2 className="text-[19px] font-extrabold text-[#191F28]">업비트(Upbit) API 연결</h2>
                  <p className="text-xs text-[#6B7684] mt-0.5">내 계좌와 암호화 통신으로 24시간 실시간 연동 중</p>
                </div>
              </div>

              {/* 연결 상태 카드 */}
              <div className="bg-[#F8F9FA] rounded-2xl p-4.5 border border-gray-200/70 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="font-extrabold text-sm text-[#191F28]">업비트 오픈 API 연동됨</span>
                    <span className="bg-emerald-100 text-emerald-700 text-[10px] font-black px-2 py-0.5 rounded-full flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                      정상 연결
                    </span>
                  </div>
                  <span className="text-xs text-gray-400 font-mono">Access Key: ****38fa</span>
                </div>

                <div className="grid grid-cols-2 gap-2 pt-2 border-t border-gray-200/60 text-xs">
                  <div>
                    <span className="text-gray-400">주문 가능 원화(KRW)</span>
                    <p className="font-extrabold text-[15px] text-[#191F28] mt-0.5">4,820,000원</p>
                  </div>
                  <div>
                    <span className="text-gray-400">보유 코인 평가금</span>
                    <p className="font-extrabold text-[15px] text-[#191F28] mt-0.5">7,500,000원</p>
                  </div>
                </div>
              </div>

              {/* 보안 보증 알림 */}
              <div className="p-4 bg-emerald-50/80 rounded-2xl border border-emerald-100 flex items-start gap-3">
                <ShieldCheck className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
                <div className="text-xs text-[#2A6C4A]">
                  <strong className="block font-bold mb-0.5">출금 권한이 차단된 안전한 Key</strong>
                  업비트 마이페이지에서 API 생성 시 [자산조회 / 주문조회 / 주문하기] 권한만 주었기 때문에 누구도 회원님의 자산을 외부로 인출할 수 없습니다.
                </div>
              </div>

              {/* API 핑 및 변경 버튼 */}
              <div className="pt-2 flex gap-2">
                <button
                  onClick={() => showToast('업비트 API 핑(Ping) 테스트 성공: 지연시간 14ms')}
                  className="flex-1 bg-gray-100 hover:bg-gray-200 text-[#4E5968] font-bold py-3.5 rounded-xl text-xs transition-colors"
                >
                  연결 상태 핑(Ping) 테스트
                </button>
                <button
                  onClick={() => showToast('API 키 관리 메뉴로 이동합니다.')}
                  className="flex-1 bg-[#191F28] hover:bg-black text-white font-bold py-3.5 rounded-xl text-xs transition-colors"
                >
                  API Key 변경
                </button>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* 신규 봇 만들기 모달 */}
      {isCreateModalOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-xs p-0 sm:p-4 animate-in fade-in duration-200">
          <div className="w-full max-w-lg bg-white rounded-t-[32px] sm:rounded-[32px] p-6 shadow-2xl max-h-[90vh] overflow-y-auto no-scrollbar animate-in slide-in-from-bottom-8 duration-300">
            {/* 모달 헤더 */}
            <div className="flex items-center justify-between pb-3 border-b border-gray-100">
              <div>
                <span className="text-xs font-bold text-[#093687]">업비트 24시간 자동감시</span>
                <h3 className="text-[22px] font-black text-[#191F28] tracking-tight">코인 자동매매 봇 만들기</h3>
              </div>
              <button
                onClick={() => setIsCreateModalOpen(false)}
                className="w-9 h-9 rounded-full bg-gray-100 flex items-center justify-center text-gray-500 hover:bg-gray-200"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* 1. 코인 선택 */}
            <div className="mt-5 space-y-2">
              <label className="text-[15px] font-extrabold text-[#191F28] block">
                1. 어떤 코인을 매매할까요?
              </label>
              <div className="grid grid-cols-4 gap-2">
                {[
                  { name: '도지코인', symbol: 'DOGE/KRW', icon: '🐕', price: 295 },
                  { name: '비트코인', symbol: 'BTC/KRW', icon: '₿', price: 132450000 },
                  { name: '이더리움', symbol: 'ETH/KRW', icon: 'Ξ', price: 4850000 },
                  { name: '솔라나', symbol: 'SOL/KRW', icon: '◎', price: 284500 },
                ].map((c) => {
                  const isSelected = selectedCoin.symbol === c.symbol;
                  return (
                    <button
                      key={c.symbol}
                      type="button"
                      onClick={() => setSelectedCoin(c)}
                      className={`p-3 rounded-2xl flex flex-col items-center gap-1 border text-center transition-all ${
                        isSelected
                          ? 'border-[#093687] bg-blue-50/70 ring-2 ring-[#093687]/20 shadow-sm'
                          : 'border-gray-200/70 bg-[#F9FAFB] hover:bg-gray-100'
                      }`}
                    >
                      <span className="text-2xl">{c.icon}</span>
                      <span className="font-extrabold text-[12px] text-[#191F28] mt-0.5">{c.name}</span>
                      <span className="text-[10px] text-gray-400 font-bold">{c.symbol.split('/')[0]}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 2. 매매 시그널 전략 선택 */}
            <div className="mt-6 space-y-2">
              <label className="text-[15px] font-extrabold text-[#191F28] block">
                2. 어떤 시그널에 반응할까요?
              </label>

              <div className="space-y-2.5">
                {[
                  {
                    id: 'grid',
                    title: '🕸️ 무한 그물망 짤짤이 (초보자 추천)',
                    desc: '오르락내리락 횡보장에서 가격이 떨어지면 줍고 조금만 오르면 바로 익절을 무한 반복해요.',
                    badge: '승률 85%+'
                  },
                  {
                    id: 'rsi',
                    title: '📉 RSI 바닥 과매도 반등 줍줍',
                    desc: '남들이 공포에 질려 던질 때(RSI 30 이하)만 자동으로 사서 반등할 때 팔아요.',
                    badge: '안전형'
                  },
                  {
                    id: 'breakout',
                    title: '🚀 골든크로스 돌파 불타기',
                    desc: '강한 상승 추세가 시작될 때만 올라타서 시세를 먹고 하락 전환 시 즉시 손절해요.',
                    badge: '추세추종'
                  }
                ].map((st) => {
                  const isSelected = selectedStrategy === st.id;
                  return (
                    <div
                      key={st.id}
                      onClick={() => setSelectedStrategy(st.id as any)}
                      className={`p-4 rounded-2xl border cursor-pointer transition-all ${
                        isSelected
                          ? 'border-[#093687] bg-blue-50/50 ring-2 ring-[#093687]/20'
                          : 'border-gray-200/70 hover:bg-gray-50'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-extrabold text-[15px] text-[#191F28]">{st.title}</span>
                        <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-blue-100 text-[#093687]">
                          {st.badge}
                        </span>
                      </div>
                      <p className="text-xs text-[#6B7684] mt-1 leading-relaxed">{st.desc}</p>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* 3. 자동 익절 / 손절 설정 */}
            <div className="mt-6 space-y-3 bg-[#F9FAFB] p-4.5 rounded-2xl border border-gray-100">
              <label className="text-[14px] font-extrabold text-[#191F28] block">
                3. 목표 익절률 & 안전 손절컷
              </label>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <span className="text-xs font-bold text-gray-500">목표 익절 (+%)</span>
                  <div className="flex items-center gap-1.5 mt-1.5">
                    {[1.0, 2.0, 3.5].map((rate) => (
                      <button
                        key={rate}
                        type="button"
                        onClick={() => setAutoSellProfit(rate)}
                        className={`flex-1 py-1.5 rounded-xl text-xs font-extrabold transition-all ${
                          autoSellProfit === rate
                            ? 'bg-[#F04452] text-white shadow-sm'
                            : 'bg-white text-gray-600 border border-gray-200'
                        }`}
                      >
                        +{rate}%
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <span className="text-xs font-bold text-gray-500">안전 손절 (-%)</span>
                  <div className="flex items-center gap-1.5 mt-1.5">
                    {[2.0, 3.0, 5.0].map((rate) => (
                      <button
                        key={rate}
                        type="button"
                        onClick={() => setAutoStopLoss(rate)}
                        className={`flex-1 py-1.5 rounded-xl text-xs font-extrabold transition-all ${
                          autoStopLoss === rate
                            ? 'bg-[#3182F6] text-white shadow-sm'
                            : 'bg-white text-gray-600 border border-gray-200'
                        }`}
                      >
                        -{rate}%
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* 4. 투자 금액 */}
            <div className="mt-6 space-y-2">
              <label className="text-[15px] font-extrabold text-[#191F28] flex items-center justify-between">
                <span>4. 봇에게 맡길 예산</span>
                <span className="text-xs text-gray-400 font-medium">업비트 최소 주문 5,000원 이상</span>
              </label>

              <div className="grid grid-cols-4 gap-2">
                {[100000, 300000, 500000, 1000000].map((amt) => (
                  <button
                    key={amt}
                    type="button"
                    onClick={() => setInvestBudget(amt)}
                    className={`py-2 rounded-xl text-xs font-extrabold transition-all ${
                      investBudget === amt
                        ? 'bg-[#191F28] text-white'
                        : 'bg-gray-100 text-[#4E5968] hover:bg-gray-200'
                    }`}
                  >
                    {amt >= 10000 ? `${amt / 10000}만원` : `${amt}원`}
                  </button>
                ))}
              </div>

              <div className="relative mt-2">
                <input
                  type="number"
                  value={investBudget}
                  onChange={(e) => setInvestBudget(Number(e.target.value))}
                  step={10000}
                  className="w-full bg-[#F2F4F6] text-[#191F28] text-xl font-extrabold px-4 py-3.5 rounded-2xl outline-none focus:ring-2 focus:ring-[#093687] pr-12"
                />
                <span className="absolute right-4 top-1/2 -translate-y-1/2 font-bold text-gray-500">원</span>
              </div>
            </div>

            {/* 시작 버튼 */}
            <div className="mt-7 pt-4 border-t border-gray-100">
              <button
                type="button"
                onClick={handleCreateBot}
                className="w-full bg-[#093687] hover:bg-[#072c6e] text-white py-4 rounded-2xl font-black text-[17px] shadow-lg shadow-[#093687]/30 transition-all flex items-center justify-center gap-2 active:scale-[0.98]"
              >
                <span>{selectedCoin.name} 자동매매 봇 시작하기</span>
                <ChevronRight className="w-5 h-5 stroke-[3]" />
              </button>
              <p className="text-center text-[11px] text-gray-400 mt-2">
                스위치를 끄면 언제든 0.1초 만에 즉시 멈출 수 있어요.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
