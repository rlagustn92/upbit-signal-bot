import { useCallback, useEffect, useRef, useState } from 'react';
import type { BotDTO, ConnectionTestResult, SignalDTO, TradeDTO } from '../shared/types';
import { api } from './api/client';
import { ApiKeyModal } from './components/ApiKeyModal';
import { BotsTab } from './components/BotsTab';
import { ConfirmDialog, type ConfirmOptions } from './components/ConfirmDialog';
import { CreateBotModal } from './components/CreateBotModal';
import { Header, type TabKey } from './components/Header';
import { LiveModeModal } from './components/LiveModeModal';
import { SignalsTab } from './components/SignalsTab';
import { UpbitTab } from './components/UpbitTab';
import { useLiveSnapshot } from './hooks/useLiveSnapshot';
import { systemChip } from './lib/labels';

/**
 * 원본 UI(docs/ui-original/App.original.tsx)의 레이아웃/탭/토스트를 그대로 유지하고,
 * 데이터는 백엔드(/api)에서 받은 실제 값으로 채운다. 매매 판단·주문은 전부 서버에서 일어난다.
 */
export default function App() {
  const { snapshot, backendConnected } = useLiveSnapshot();
  const [activeTab, setActiveTab] = useState<TabKey>('bots');
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [apiKeyOpen, setApiKeyOpen] = useState(false);
  const [liveOpen, setLiveOpen] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmOptions | null>(null);
  const [pendingBotIds, setPendingBotIds] = useState<Set<number>>(new Set());
  const [trades, setTrades] = useState<TradeDTO[]>([]);
  const [signals, setSignals] = useState<SignalDTO[]>([]);
  const [activityLoading, setActivityLoading] = useState(false);
  const [testing, setTesting] = useState(false);
  const [lastTest, setLastTest] = useState<ConnectionTestResult | null>(null);

  // 알림 토스트 상태 (원본 그대로)
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const toastTimer = useRef<number | undefined>(undefined);
  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToastMessage(null), 2800);
  }, []);

  // 체결/시그널 목록: 탭을 열 때 + 서버에서 새 활동이 생길 때 다시 불러온다
  const loadActivity = useCallback(async () => {
    setActivityLoading(true);
    try {
      const [t, s] = await Promise.all([api.trades(100), api.signals(100)]);
      setTrades(t);
      setSignals(s);
    } catch (e) {
      showToast((e as Error).message);
    } finally {
      setActivityLoading(false);
    }
  }, [showToast]);

  const activityVersion = snapshot?.activityVersion;
  useEffect(() => {
    if (activeTab === 'signals') void loadActivity();
  }, [activeTab, activityVersion, loadActivity]);

  const withPending = async (id: number, fn: () => Promise<void>) => {
    setPendingBotIds((p) => new Set(p).add(id));
    try {
      await fn();
    } catch (e) {
      showToast(`⚠️ ${(e as Error).message}`);
    } finally {
      setPendingBotIds((p) => {
        const n = new Set(p);
        n.delete(id);
        return n;
      });
    }
  };

  const toggleBot = (bot: BotDTO) =>
    withPending(bot.id, async () => {
      if (bot.active) {
        const r = await api.stopBot(bot.id);
        showToast(`⏸️ [${bot.coinName}] 봇을 껐어요.${r.cancelled ? ` 미체결 주문 ${r.cancelled}건 취소.` : ''} 가진 코인은 그대로이고, 꺼진 동안엔 손절도 작동하지 않아요.`);
      } else {
        await api.startBot(bot.id);
        showToast(`⚡ [${bot.coinName}] 봇을 켰어요! ${bot.mode === 'LIVE' ? '실전 계좌로' : '모의투자로'} 시그널 감시 시작`);
      }
    });

  const deleteBot = (bot: BotDTO) => {
    const holdsPaper = bot.mode === 'PAPER' && bot.stats.positionQuantity > 0;
    const holdsLive = bot.mode === 'LIVE' && bot.stats.positionQuantity > 0;
    if (holdsLive) {
      showToast('⚠️ 이 봇이 실제로 산 코인이 남아 있어요. 업비트에서 직접 정리한 뒤 삭제해 주세요.');
      return;
    }
    setConfirm({
      title: `${bot.coinName} 봇 삭제`,
      body: (
        <>
          <p>이 봇을 목록에서 지워요. 지난 체결 기록은 남아 있어요.</p>
          {holdsPaper && <p className="text-[#F04452] font-bold">이 봇이 모의투자로 들고 있는 가상 코인을 지금 가격으로 먼저 팔고(가상 원화로 돌려받고) 삭제해요.</p>}
        </>
      ),
      confirmLabel: holdsPaper ? '모의 코인 팔고 삭제' : '삭제',
      danger: true,
      onConfirm: async () => {
        if (holdsPaper) await api.liquidatePaper(bot.id);
        await api.deleteBot(bot.id);
        showToast(`🗑️ [${bot.coinName}] 봇을 삭제했어요.`);
      },
    });
  };

  const liquidatePaper = (bot: BotDTO) =>
    setConfirm({
      title: `${bot.coinName} 모의 코인 팔기`,
      body: <p>이 봇이 모의투자로 들고 있는 가상 코인을 지금 가격(시장가)으로 모두 팔아 가상 원화로 돌려요. 실제 업비트 주문은 나가지 않아요.</p>,
      confirmLabel: '모의 코인 팔기',
      onConfirm: async () => {
        await api.liquidatePaper(bot.id);
        showToast(`[${bot.coinName}] 모의 코인을 정리했어요.`);
      },
    });

  const switchMode = (bot: BotDTO) => {
    if (bot.mode === 'LIVE') {
      setConfirm({
        title: '모의투자(PAPER)로 전환',
        body: <p>이 봇을 다시 모의투자로 바꿔요. 실제 주문은 더 이상 나가지 않아요.</p>,
        confirmLabel: '모의로 전환',
        onConfirm: async () => {
          await api.setBotMode(bot.id, 'PAPER');
          showToast(`[${bot.coinName}] 봇이 모의투자 모드가 됐어요.`);
        },
      });
      return;
    }
    setConfirm({
      eyebrow: '실전 매매(LIVE)',
      title: `${bot.coinName} 봇을 실전으로 전환`,
      body: (
        <>
          <p className="font-black text-[#F04452]">지금부터 실제 업비트 계좌에서 주문이 실행됩니다.</p>
          <p>
            이 봇을 켜면 예산 {bot.budgetKRW.toLocaleString('ko-KR')}원 안에서 실제로 코인을 사고팔아요. 자동매매는 수익을 보장하지 않으며 손실이 날 수 있어요.
          </p>
        </>
      ),
      confirmLabel: '실전으로 전환',
      danger: true,
      requireText: '실제 주문에 동의합니다',
      onConfirm: async () => {
        await api.setBotMode(bot.id, 'LIVE', '실제 주문에 동의합니다');
        showToast(`🔴 [${bot.coinName}] 봇이 실전 모드가 됐어요. 켜면 실제 주문이 나가요.`);
      },
    });
  };

  const emergencyStop = () =>
    setConfirm({
      title: '모든 자동매매 멈추기',
      body: (
        <>
          <p>· 모든 봇을 끄고 새 주문을 막아요.</p>
          <p>· 봇이 넣어둔 미체결 주문을 취소해요.</p>
          <p>
            · <strong>가지고 있는 코인은 팔지 않아요.</strong> (팔고 싶다면 업비트에서 직접 정리해 주세요)
          </p>
          <p className="text-[#F04452] font-bold">· 멈춘 동안에는 손절·익절도 작동하지 않아요.</p>
        </>
      ),
      confirmLabel: '전체 멈추기',
      danger: true,
      onConfirm: async () => {
        const r = await api.emergencyStop();
        showToast(`🛑 긴급 정지 — 봇 ${r.bots}개 끔, 미체결 ${r.cancelled}건 취소${r.failed ? ` (취소 실패 ${r.failed}건)` : ''}`);
      },
    });

  const releaseEmergency = async () => {
    try {
      await api.releaseEmergency();
      showToast('긴급 정지를 해제했어요. 봇은 꺼진 상태라 필요한 봇만 다시 켜 주세요.');
    } catch (e) {
      showToast(`⚠️ ${(e as Error).message}`);
    }
  };

  const runTest = async () => {
    setTesting(true);
    try {
      const r = await api.testConnection();
      setLastTest(r);
      showToast(r.ok ? `✅ ${r.summary}` : `⚠️ ${r.summary}`);
    } catch (e) {
      showToast(`⚠️ ${(e as Error).message}`);
    } finally {
      setTesting(false);
    }
  };

  const resetPaper = () =>
    setConfirm({
      title: '가상 원화 초기화',
      body: <p>모의투자 가상 원화를 시작 금액으로 되돌리고, 모의 봇들이 들고 있던 가상 코인과 손익 기록도 0으로 초기화해요. 모의투자 봇을 모두 끄고 미체결 주문이 없어야 해요. (지난 체결 기록은 남아요)</p>,
      confirmLabel: '초기화',
      onConfirm: async () => {
        await api.resetPaper();
        showToast('가상 원화를 초기화했어요.');
      },
    });

  const disableLive = () =>
    setConfirm({
      title: '실전 매매 끄기',
      body: <p>켜져 있는 실전(LIVE) 봇을 모두 끄고 미체결 주문을 취소해요. 가진 코인은 팔지 않아요.</p>,
      confirmLabel: '실전 끄기',
      onConfirm: async () => {
        const r = await api.disableLive();
        showToast(`실전 매매를 껐어요.${r.stoppedBots ? ` 실전 봇 ${r.stoppedBots}개를 껐어요.` : ''}`);
      },
    });

  const bots = snapshot?.bots ?? [];
  const liveActive = bots.some((b) => b.active && b.mode === 'LIVE');
  const chip = systemChip(snapshot?.system ?? null, backendConnected, liveActive);

  return (
    <div className="min-h-screen bg-[#F2F4F6] text-[#191F28] pb-24 selection:bg-[#3182F6]/20 font-sans">
      {/* 상단 플로팅 토스트 알림 */}
      {toastMessage && (
        <div className="fixed top-5 left-1/2 -translate-x-1/2 z-[60] bg-[#191F28]/95 text-white px-5 py-3.5 rounded-2xl shadow-xl flex items-center gap-2.5 text-[15px] font-semibold animate-in fade-in slide-in-from-top-4 duration-300 backdrop-blur-md border border-white/10 w-max max-w-[calc(100vw-32px)]">
          <span>{toastMessage}</span>
        </div>
      )}

      <Header chip={chip} activeTab={activeTab} onTab={setActiveTab} botCount={bots.length} activeCount={bots.filter((b) => b.active).length} />

      {/* 메인 뷰 */}
      <main className="max-w-2xl mx-auto px-4 pt-5 space-y-4">
        {!backendConnected && (
          <div className="bg-rose-50 border border-rose-100 rounded-2xl p-3.5 text-xs font-bold text-[#9B2C36]">
            서버(백엔드)에 연결되지 않았어요. 터미널에서 <code className="font-mono">npm run dev</code> 가 실행 중인지 확인해 주세요. 다시 연결을 시도하고 있어요…
          </div>
        )}
        {snapshot?.system.message && <div className="bg-amber-50 border border-amber-100 rounded-2xl p-3.5 text-xs font-bold text-amber-800">⚠ {snapshot.system.message}</div>}

        {activeTab === 'bots' && (
          <BotsTab
            snapshot={snapshot}
            pendingBotIds={pendingBotIds}
            onCreate={() => setIsCreateModalOpen(true)}
            onToggle={toggleBot}
            onDelete={deleteBot}
            onSwitchMode={switchMode}
            onLiquidatePaper={liquidatePaper}
            onEmergencyStop={emergencyStop}
            onReleaseEmergency={releaseEmergency}
          />
        )}

        {activeTab === 'signals' && (
          <SignalsTab
            trades={trades}
            signals={signals}
            loading={activityLoading}
            onRefresh={async () => {
              await loadActivity();
              showToast('체결 내역을 새로고침했어요.');
            }}
          />
        )}

        {activeTab === 'upbit' && (
          <UpbitTab
            snapshot={snapshot}
            testing={testing}
            lastTest={lastTest}
            onTest={runTest}
            onChangeKey={() => setApiKeyOpen(true)}
            onOpenLive={() => setLiveOpen(true)}
            onDisableLive={disableLive}
            onResetPaper={resetPaper}
          />
        )}
      </main>

      {isCreateModalOpen && (
        <CreateBotModal
          livePrices={snapshot?.prices ?? {}}
          onClose={() => setIsCreateModalOpen(false)}
          onCreated={(coinName, startError) => {
            setIsCreateModalOpen(false);
            showToast(startError ? `봇은 만들었지만 시작하지 못했어요: ${startError}` : `🤖 [${coinName}] 봇이 모의투자로 감시를 시작했어요!`);
          }}
        />
      )}

      {apiKeyOpen && (
        <ApiKeyModal
          source={snapshot?.connection.credentialSource ?? null}
          onClose={() => setApiKeyOpen(false)}
          onSaved={(msg) => {
            setApiKeyOpen(false);
            showToast(msg);
            setLastTest(null);
            void runTest();
          }}
        />
      )}

      {liveOpen && (
        <LiveModeModal
          onClose={() => setLiveOpen(false)}
          onEnabled={() => {
            setLiveOpen(false);
            showToast('실전 매매를 허용했어요. 봇을 끈 상태에서 하나씩 실전으로 전환할 수 있어요.');
          }}
        />
      )}

      {confirm && <ConfirmDialog opts={confirm} onClose={() => setConfirm(null)} />}
    </div>
  );
}
