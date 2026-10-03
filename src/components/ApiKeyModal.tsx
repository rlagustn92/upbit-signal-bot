import { useState } from 'react';
import { api } from '../api/client';
import { Sheet } from './Sheet';

/**
 * API Key 등록/변경. Secret Key는 저장 버튼을 누를 때 서버로 한 번 전송되고,
 * 서버에서 암호화되어 저장된다. 프론트에는 저장하지 않으며 다시 보여주지 않는다.
 */
export function ApiKeyModal({ source, onClose, onSaved }: { source: 'DB' | 'ENV' | null; onClose: () => void; onSaved: (msg: string) => void }) {
  const [accessKey, setAccessKey] = useState('');
  const [secretKey, setSecretKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.saveCredentials(accessKey, secretKey);
      setSecretKey('');
      onSaved('API Key를 저장했어요. 연결 상태를 확인할게요.');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.deleteCredentials();
      onSaved('화면에서 등록한 API Key를 삭제했어요.');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet eyebrow="업비트 Open API" title="API Key 등록 / 변경" onClose={onClose}>
      <div className="mt-5 bg-[#F2F7FF] rounded-2xl p-3.5 border border-blue-100 text-xs text-[#4E5968] leading-relaxed space-y-1">
        <p className="font-extrabold text-[#1B64DA]">발급 방법</p>
        <p>① 업비트 → 마이페이지 → Open API 관리에서 Key를 만들어요.</p>
        <p>
          ② 권한은 <strong>자산조회 · 주문조회 · 주문하기</strong>만 켜고, <strong className="text-[#F04452]">출금하기는 꼭 꺼 주세요.</strong>
        </p>
        <p>③ 이 프로그램을 실행하는 PC의 IP 주소를 허용 IP로 등록해야 해요.</p>
        <p>④ Secret Key는 발급할 때 한 번만 보여요. 아래에 붙여 넣으세요.</p>
      </div>

      <div className="mt-4 space-y-3">
        <label className="block">
          <span className="text-xs font-bold text-gray-500">Access Key</span>
          <input
            value={accessKey}
            onChange={(e) => setAccessKey(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            className="mt-1.5 w-full bg-[#F2F4F6] text-[#191F28] text-sm font-bold font-mono px-4 py-3 rounded-2xl outline-none focus:ring-2 focus:ring-[#093687]"
          />
        </label>
        <label className="block">
          <span className="text-xs font-bold text-gray-500">Secret Key</span>
          <input
            type="password"
            value={secretKey}
            onChange={(e) => setSecretKey(e.target.value)}
            autoComplete="new-password"
            spellCheck={false}
            className="mt-1.5 w-full bg-[#F2F4F6] text-[#191F28] text-sm font-bold font-mono px-4 py-3 rounded-2xl outline-none focus:ring-2 focus:ring-[#093687]"
          />
        </label>
        <p className="text-[11px] text-[#8B95A1] leading-relaxed">
          Secret Key는 이 PC의 서버에만 암호화되어 저장되고, 화면에 다시 표시되지 않아요. 새 Key를 저장하면 이전 Key는 지워져요.
          {source === 'ENV' && ' (현재는 .env 파일의 Key를 쓰고 있어요. 여기서 등록하면 이 Key가 우선 사용돼요.)'}
        </p>
      </div>

      {error && <p className="mt-3 text-xs font-bold text-[#F04452]">{error}</p>}

      <div className="mt-6 pt-4 border-t border-gray-100 flex gap-2">
        {source === 'DB' && (
          <button onClick={remove} disabled={busy} className="flex-1 bg-gray-100 hover:bg-gray-200 text-[#4E5968] font-bold py-3.5 rounded-xl text-sm transition-colors disabled:opacity-50">
            등록된 Key 삭제
          </button>
        )}
        <button
          onClick={save}
          disabled={busy || !accessKey.trim() || !secretKey.trim()}
          className="flex-1 bg-[#191F28] hover:bg-black text-white font-black py-3.5 rounded-xl text-sm transition-colors disabled:opacity-40"
        >
          {busy ? '저장 중…' : '저장하고 연결 확인'}
        </button>
      </div>
    </Sheet>
  );
}
