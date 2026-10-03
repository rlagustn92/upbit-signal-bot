import { useState, type ReactNode } from 'react';
import { Sheet } from './Sheet';

export interface ConfirmOptions {
  eyebrow?: string;
  title: string;
  body: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  /** 입력해야 확인되는 문구(실전 전환 등) */
  requireText?: string;
  onConfirm: () => Promise<void> | void;
}

export function ConfirmDialog({ opts, onClose }: { opts: ConfirmOptions; onClose: () => void }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = !opts.requireText || text.trim() === opts.requireText;

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      await opts.onConfirm();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet eyebrow={opts.eyebrow ?? '확인'} title={opts.title} onClose={onClose}>
      <div className="mt-5 text-sm text-[#4E5968] leading-relaxed space-y-2">{opts.body}</div>
      {opts.requireText && (
        <div className="mt-4">
          <span className="text-xs font-bold text-gray-500">
            아래 칸에 <strong className="text-[#191F28]">"{opts.requireText}"</strong> 를 입력해 주세요
          </span>
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="mt-1.5 w-full bg-[#F2F4F6] text-[#191F28] text-[15px] font-bold px-4 py-3 rounded-2xl outline-none focus:ring-2 focus:ring-[#093687]"
            placeholder={opts.requireText}
          />
        </div>
      )}
      {error && <p className="mt-3 text-xs font-bold text-[#F04452]">{error}</p>}
      <div className="mt-6 pt-4 border-t border-gray-100 flex gap-2">
        <button onClick={onClose} className="flex-1 bg-gray-100 hover:bg-gray-200 text-[#4E5968] font-bold py-3.5 rounded-xl text-sm transition-colors">
          취소
        </button>
        <button
          onClick={run}
          disabled={!ready || busy}
          className={`flex-1 font-black py-3.5 rounded-xl text-sm text-white transition-colors disabled:opacity-40 ${opts.danger ? 'bg-[#F04452] hover:bg-[#d93a47]' : 'bg-[#093687] hover:bg-[#072c6e]'}`}
        >
          {busy ? '처리 중…' : opts.confirmLabel}
        </button>
      </div>
    </Sheet>
  );
}
