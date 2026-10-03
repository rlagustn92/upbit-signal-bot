import { useEffect, type ReactNode } from 'react';
import { X } from 'lucide-react';

/** 원본 "봇 만들기" 모달과 같은 바텀시트/카드 모달 껍데기 */
export function Sheet({ eyebrow, title, onClose, children }: { eyebrow: string; title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-xs p-0 sm:p-4 animate-in fade-in duration-200"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-full max-w-lg bg-white rounded-t-[32px] sm:rounded-[32px] p-6 pt-0 shadow-2xl max-h-[90vh] overflow-y-auto no-scrollbar animate-in slide-in-from-bottom-8 duration-300">
        <div className="sticky top-0 z-10 bg-white pt-6 flex items-center justify-between pb-3 border-b border-gray-100">
          <div>
            <span className="text-xs font-bold text-[#093687]">{eyebrow}</span>
            <h3 className="text-[22px] font-black text-[#191F28] tracking-tight">{title}</h3>
          </div>
          <button onClick={onClose} className="w-9 h-9 rounded-full bg-gray-100 flex items-center justify-center text-gray-500 hover:bg-gray-200" aria-label="닫기">
            <X className="w-5 h-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
