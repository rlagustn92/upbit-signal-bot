import type { StatusChip } from '../lib/labels';

export type TabKey = 'bots' | 'signals' | 'upbit';

/** 원본 헤더 그대로. 상태 칩만 실제 시스템 상태로 교체 */
export function Header({ chip, activeTab, onTab, botCount, activeCount }: { chip: StatusChip; activeTab: TabKey; onTab: (t: TabKey) => void; botCount: number; activeCount: number }) {
  const tab = (key: TabKey, label: string) => (
    <button
      onClick={() => onTab(key)}
      className={`py-3 relative transition-colors whitespace-nowrap ${activeTab === key ? 'text-[#191F28]' : 'text-[#8B95A1] hover:text-[#4E5968]'}`}
    >
      {label}
      {activeTab === key && <span className="absolute bottom-0 left-0 right-0 h-0.75 bg-[#191F28] rounded-full"></span>}
    </button>
  );

  return (
    <header className="sticky top-0 z-30 bg-white/90 backdrop-blur-md border-b border-gray-100">
      <div className="max-w-2xl mx-auto px-5 h-16 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-8 h-8 rounded-xl bg-[#093687] text-white flex items-center justify-center font-black text-sm shadow-sm shrink-0">UP</div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="font-extrabold text-[18px] tracking-tight whitespace-nowrap">코인 시그널 봇</span>
              <span className="px-1.5 py-0.5 rounded text-[10px] font-black bg-blue-50 text-[#093687] whitespace-nowrap hidden min-[400px]:inline">업비트 전용</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold ${chip.chip}`}>
            <span className={`w-2 h-2 rounded-full ${chip.dot} ${chip.pulse ? 'animate-pulse' : ''}`}></span>
            {chip.text}
          </span>
        </div>
      </div>

      {/* 탭 네비게이션 */}
      <div className="max-w-2xl mx-auto px-5 flex gap-7 text-[16px] font-bold border-t border-gray-50 overflow-x-auto no-scrollbar">
        {tab('bots', `가동 중인 봇 (${activeCount}/${botCount})`)}
        {tab('signals', '시그널 & 체결내역')}
        {tab('upbit', '업비트 API 연결')}
      </div>
    </header>
  );
}
