import { ShieldAlert, ShieldCheck } from 'lucide-react';
import type { ConnectionTestResult, PermissionState, SnapshotDTO } from '../../shared/types';
import { qty, relativeTime, won } from '../lib/format';
import { PERMISSION_TEXT } from '../lib/labels';

interface Props {
  snapshot: SnapshotDTO | null;
  testing: boolean;
  lastTest: ConnectionTestResult | null;
  onTest: () => void;
  onChangeKey: () => void;
  onOpenLive: () => void;
  onDisableLive: () => void;
  onResetPaper: () => void;
}

const PERM_ROWS: Array<[keyof ConnectionTestResult['permissions'], string]> = [
  ['quotation', '시세 조회'],
  ['assetRead', '내 계좌(잔고) 조회'],
  ['orderRead', '주문 조회'],
  ['orderWrite', '주문하기'],
];

function permTone(s: PermissionState): string {
  if (s === 'OK') return 'bg-emerald-100 text-emerald-700';
  if (s === 'DENIED') return 'bg-rose-100 text-[#F04452]';
  return 'bg-gray-200 text-gray-600';
}

export function UpbitTab({ snapshot, testing, lastTest, onTest, onChangeKey, onOpenLive, onDisableLive, onResetPaper }: Props) {
  const conn = snapshot?.connection;
  const acc = snapshot?.account;
  const sys = snapshot?.system;
  const test = lastTest ?? conn?.lastTestResult ?? null;
  const hasKey = !!conn?.hasCredentials;

  let badge = { text: '미연결', cls: 'bg-gray-200 text-gray-600', dot: 'bg-gray-400', pulse: false };
  let title = 'API Key가 등록되지 않았어요';
  if (hasKey) {
    if (sys?.privateStream === 'AUTH_FAILED' || test?.category === 'AUTH_FAILED' || test?.category === 'IP_NOT_ALLOWED') {
      badge = { text: '인증 실패', cls: 'bg-rose-100 text-[#F04452]', dot: 'bg-rose-500', pulse: false };
      title = '업비트 인증에 실패했어요';
    } else if (test?.ok) {
      badge = { text: '정상 연결', cls: 'bg-emerald-100 text-emerald-700', dot: 'bg-emerald-500', pulse: true };
      title = '업비트 오픈 API 연동됨';
    } else {
      badge = { text: '확인 필요', cls: 'bg-amber-100 text-amber-700', dot: 'bg-amber-500', pulse: false };
      title = 'API Key 등록됨 (연결 테스트 필요)';
    }
  }
  const subtitle = !hasKey
    ? 'API Key를 등록하면 실제 잔고 조회와 실전 주문을 쓸 수 있어요'
    : sys?.privateStream === 'OPEN'
      ? '내 계좌의 주문·자산 변동을 실시간으로 받고 있어요'
      : '내 계좌 실시간 연결을 확인하는 중이에요';
  const lastData = acc?.updatedAt ?? sys?.lastPrivateMessageAt ?? null;
  const allPermOk = test?.permissions && PERM_ROWS.every(([k]) => test.permissions[k] === 'OK');

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-[26px] p-6 shadow-sm border border-black/[0.03] space-y-5">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-[#093687] text-white flex items-center justify-center font-black text-xl shadow-md shadow-[#093687]/20 shrink-0">UP</div>
          <div>
            <h2 className="text-[19px] font-extrabold text-[#191F28]">업비트(Upbit) API 연결</h2>
            <p className="text-xs text-[#6B7684] mt-0.5">{subtitle}</p>
          </div>
        </div>

        {/* 연결 상태 카드 */}
        <div className="bg-[#F8F9FA] rounded-2xl p-4.5 border border-gray-200/70 space-y-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              <span className="font-extrabold text-sm text-[#191F28]">{title}</span>
              <span className={`${badge.cls} text-[10px] font-black px-2 py-0.5 rounded-full flex items-center gap-1`}>
                <span className={`w-1.5 h-1.5 rounded-full ${badge.dot} ${badge.pulse ? 'animate-pulse' : ''}`}></span>
                {badge.text}
              </span>
            </div>
            <span className="text-xs text-gray-400 font-mono">Access Key: {conn?.accessKeyMasked ?? '없음'}</span>
          </div>

          <div className="grid grid-cols-2 gap-2 pt-2 border-t border-gray-200/60 text-xs">
            <div>
              <span className="text-gray-400">지금 쓸 수 있는 원화(KRW)</span>
              <p className="font-extrabold text-[15px] text-[#191F28] mt-0.5">{acc?.krwAvailable != null ? won(acc.krwAvailable) : '-'}</p>
            </div>
            <div>
              <span className="text-gray-400">보유 코인 평가금</span>
              <p className="font-extrabold text-[15px] text-[#191F28] mt-0.5">{acc?.coinEvaluationKRW != null ? won(acc.coinEvaluationKRW) : '-'}</p>
            </div>
            <div>
              <span className="text-gray-400">전체 평가금(주문 중 금액 포함)</span>
              <p className="font-extrabold text-[15px] text-[#191F28] mt-0.5">{acc?.totalEvaluationKRW != null ? won(acc.totalEvaluationKRW) : '-'}</p>
            </div>
            <div>
              <span className="text-gray-400">마지막 데이터 수신</span>
              <p className="font-extrabold text-[15px] text-[#191F28] mt-0.5">{lastData ? relativeTime(lastData) : '-'}</p>
            </div>
          </div>

          {acc?.error && <p className="text-[11px] font-bold text-[#F04452]">{acc.error}</p>}

          {acc && acc.assets.length > 0 && (
            <div className="pt-2 border-t border-gray-200/60 space-y-1.5">
              <span className="text-[11px] text-gray-400">들고 있는 코인</span>
              {acc.assets.map((a) => (
                <div key={a.currency} className="flex items-center justify-between text-xs">
                  <span className="font-bold text-[#333D4B]">
                    {a.currency} <span className="text-gray-400 font-medium">{qty(a.balance + a.locked)}개{a.locked > 0 ? ` (주문 중 ${qty(a.locked)})` : ''}</span>
                  </span>
                  <span className="font-extrabold text-[#191F28]">{a.evaluationKRW != null ? won(a.evaluationKRW) : '시세 없음'}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 권한 상태 — 실제 확인 결과만 표시 */}
        <div className={`p-4 rounded-2xl border flex items-start gap-3 ${allPermOk ? 'bg-emerald-50/80 border-emerald-100' : 'bg-amber-50/70 border-amber-100'}`}>
          {allPermOk ? <ShieldCheck className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" /> : <ShieldAlert className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />}
          <div className={`text-xs flex-1 ${allPermOk ? 'text-[#2A6C4A]' : 'text-[#7A5A12]'}`}>
            <strong className="block font-bold mb-1.5">API Key 권한 {test ? `(${relativeTime(test.testedAt)} 확인)` : '(연결 테스트로 확인해요)'}</strong>
            <div className="space-y-1">
              {PERM_ROWS.map(([k, label]) => {
                let s: PermissionState = test?.permissions[k] ?? 'NOT_CHECKED';
                if (k === 'quotation' && s === 'NOT_CHECKED' && sys?.publicStream === 'OPEN') s = 'OK'; // 실시간 시세를 받는 중이면 시세 조회는 확인된 것
                return (
                  <div key={k} className="flex items-center justify-between">
                    <span>{label}</span>
                    <span className={`text-[10px] font-black px-2 py-0.5 rounded-full ${permTone(s)}`}>{PERMISSION_TEXT[s]}</span>
                  </div>
                );
              })}
              <div className="flex items-center justify-between">
                <span>출금 권한</span>
                <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-gray-200 text-gray-600">직접 확인 필요</span>
              </div>
            </div>
            <p className="mt-2 leading-relaxed">
              이 프로그램에는 출금 기능이 없어요. 업비트 마이페이지 → Open API 관리에서 Key를 만들 때 <strong>[자산조회 / 주문조회 / 주문하기]</strong>만 켜고
              <strong> [출금하기]는 꺼 주세요.</strong> 출금 권한이 꺼졌는지는 프로그램이 확인할 수 없어요.
            </p>
          </div>
        </div>

        {test && test.details.length > 0 && (
          <div className="bg-[#F9FAFB] rounded-2xl p-3.5 text-[11px] text-[#4E5968] space-y-1">
            <p className="font-extrabold text-[#191F28] text-xs">연결 테스트 결과: {test.summary}</p>
            {test.publicApi.latencyMs != null && <p>· 업비트 응답 시간 {test.publicApi.latencyMs}ms</p>}
            {test.details.map((d, i) => (
              <p key={i}>· {d}</p>
            ))}
          </div>
        )}

        {/* 연결 테스트 & 변경 버튼 */}
        <div className="pt-2 flex gap-2">
          <button onClick={onTest} disabled={testing} className="flex-1 bg-gray-100 hover:bg-gray-200 text-[#4E5968] font-bold py-3.5 rounded-xl text-xs transition-colors disabled:opacity-60">
            {testing ? '업비트에 확인하는 중…' : '연결 상태 테스트'}
          </button>
          <button onClick={onChangeKey} className="flex-1 bg-[#191F28] hover:bg-black text-white font-bold py-3.5 rounded-xl text-xs transition-colors">
            {hasKey ? 'API Key 변경' : 'API Key 등록'}
          </button>
        </div>
      </div>

      {/* 모의투자 / 실전 */}
      <div className="bg-white rounded-[26px] p-6 shadow-sm border border-black/[0.03] space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="font-extrabold text-[16px] text-[#191F28]">모의투자(PAPER) 지갑</div>
            <p className="text-xs text-[#6B7684] mt-0.5">실제 시세로 가상의 돈을 사고팔아요. 시작 금액 {won(acc?.paper.initialKRW ?? 0)}</p>
          </div>
          <div className="text-right shrink-0">
            <div className="text-[11px] text-gray-400">모의 지갑 전체(원화 + 코인)</div>
            <div className="font-extrabold text-[15px] text-[#191F28]">{won(acc?.paper.totalKRW ?? 0)}</div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="bg-[#F9FAFB] p-3 rounded-xl">
            <div className="text-gray-400 font-medium">지금 쓸 수 있는 가상 원화</div>
            <div className="text-[15px] font-extrabold text-[#191F28] mt-0.5">{won(acc?.paper.krwBalance ?? 0)}</div>
          </div>
          <div className="bg-[#F9FAFB] p-3 rounded-xl">
            <div className="text-gray-400 font-medium">들고 있는 가상 코인 평가금</div>
            <div className="text-[15px] font-extrabold text-[#191F28] mt-0.5">{won(acc?.paper.coinValueKRW ?? 0)}</div>
          </div>
        </div>
        <button onClick={onResetPaper} className="w-full bg-gray-100 hover:bg-gray-200 text-[#4E5968] font-bold py-3 rounded-xl text-xs transition-colors">
          가상 원화 초기화
        </button>

        <div className="pt-4 border-t border-gray-100 flex items-center justify-between gap-3">
          <div>
            <div className="font-extrabold text-[16px] text-[#191F28] flex items-center gap-2">
              실전 매매(LIVE)
              <span
                className={`text-[10px] font-black px-2 py-0.5 rounded-full ${
                  sys?.liveHardLock ? 'bg-gray-200 text-gray-600' : sys?.liveEnabled ? 'bg-rose-100 text-[#F04452]' : 'bg-gray-200 text-gray-600'
                }`}
              >
                {sys?.liveHardLock ? '잠김' : sys?.liveEnabled ? '허용됨' : '꺼짐'}
              </span>
            </div>
            <p className="text-xs text-[#6B7684] mt-0.5 leading-relaxed">
              {sys?.liveHardLock
                ? '안전을 위해 잠겨 있어요. 모든 점검을 마친 뒤 .env 파일에서 직접 풀어야 해요.'
                : sys?.liveEnabled
                  ? '실전으로 전환한 봇은 실제 업비트 계좌로 주문해요.'
                  : '점검 항목을 모두 통과하면 켤 수 있어요.'}
            </p>
          </div>
          {sys?.liveEnabled ? (
            <button onClick={onDisableLive} className="shrink-0 px-3.5 py-2.5 rounded-xl text-xs font-black bg-white text-[#191F28] border border-gray-200 hover:bg-gray-50">
              실전 끄기
            </button>
          ) : (
            <button onClick={onOpenLive} className="shrink-0 px-3.5 py-2.5 rounded-xl text-xs font-black bg-[#191F28] text-white hover:bg-black">
              점검 항목 보기
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
