import { useEffect, useState } from 'react';
import type { LiveChecklistItem } from '../../shared/types';
import { api } from '../api/client';
import { Sheet } from './Sheet';

/** 실전(LIVE) 허용 — 점검 항목 전부 통과 + 출금 권한 확인 + 확인 문구 입력이 모두 필요 */
export function LiveModeModal({ onClose, onEnabled }: { onClose: () => void; onEnabled: () => void }) {
  const [items, setItems] = useState<LiveChecklistItem[]>([]);
  const [confirmText, setConfirmText] = useState('실제 주문에 동의합니다');
  const [typed, setTyped] = useState('');
  const [withdrawOff, setWithdrawOff] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () =>
    api
      .liveChecklist()
      .then((r) => {
        setItems(r.items);
        setConfirmText(r.confirmText);
      })
      .catch((e) => setError(e.message));

  useEffect(() => {
    void load();
  }, []);

  const allOk = items.length > 0 && items.every((i) => i.ok);
  const ready = allOk && withdrawOff && typed.trim() === confirmText;

  const enable = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.enableLive(typed.trim(), withdrawOff);
      onEnabled();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      void load();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet eyebrow="실전 매매(LIVE)" title="실전 전 점검 항목" onClose={onClose}>
      <div className="mt-5 bg-rose-50 border border-rose-100 rounded-2xl p-3.5 text-xs text-[#9B2C36] leading-relaxed">
        <p className="font-black text-[13px]">{allOk ? '허용하면 실전 봇은 실제 업비트 계좌에서 주문을 실행합니다.' : '아래 항목을 모두 통과해야 실전 매매를 허용할 수 있어요.'}</p>
        <p className="mt-1">실전을 허용해도 모든 봇이 바로 실전이 되지는 않아요. 봇을 끈 상태에서 하나씩 "실전(LIVE)으로 전환"해야 해요. 자동매매는 수익을 보장하지 않고 손실이 날 수 있어요.</p>
      </div>

      <div className="mt-4 divide-y divide-gray-100 border border-gray-100 rounded-2xl">
        {items.map((i) => (
          <div key={i.key} className="px-3.5 py-2.5 flex items-start gap-2.5">
            <span className={`mt-0.5 w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-black shrink-0 ${i.ok ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-[#F04452]'}`}>{i.ok ? '✓' : '✕'}</span>
            <div className="min-w-0">
              <p className="text-xs font-bold text-[#191F28]">{i.label}</p>
              {i.detail && <p className="text-[11px] text-[#8B95A1]">{i.detail}</p>}
            </div>
          </div>
        ))}
        {!items.length && <p className="px-3.5 py-4 text-xs text-[#8B95A1]">점검 항목을 불러오는 중…</p>}
      </div>

      <label className="mt-4 flex items-start gap-2 text-xs font-bold text-[#4E5968]">
        <input type="checkbox" className="mt-0.5" checked={withdrawOff} onChange={(e) => setWithdrawOff(e.target.checked)} />
        업비트 Open API 관리에서 이 Key의 [출금하기] 권한이 꺼져 있는 것을 직접 확인했어요.
      </label>

      <div className="mt-3">
        <span className="text-xs font-bold text-gray-500">
          확인 문구 <strong className="text-[#191F28]">"{confirmText}"</strong> 입력
        </span>
        <input
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          placeholder={confirmText}
          className="mt-1.5 w-full bg-[#F2F4F6] text-[#191F28] text-[15px] font-bold px-4 py-3 rounded-2xl outline-none focus:ring-2 focus:ring-[#093687]"
        />
      </div>

      {error && <p className="mt-3 text-xs font-bold text-[#F04452]">{error}</p>}

      <div className="mt-6 pt-4 border-t border-gray-100 flex gap-2">
        <button onClick={onClose} className="flex-1 bg-gray-100 hover:bg-gray-200 text-[#4E5968] font-bold py-3.5 rounded-xl text-sm transition-colors">
          닫기
        </button>
        <button onClick={enable} disabled={!ready || busy} className="flex-1 bg-[#F04452] hover:bg-[#d93a47] text-white font-black py-3.5 rounded-xl text-sm transition-colors disabled:opacity-40">
          {busy ? '확인 중…' : allOk ? '실전 매매 허용' : '아직 준비 안 됨'}
        </button>
      </div>
    </Sheet>
  );
}
