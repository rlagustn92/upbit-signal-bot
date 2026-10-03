import type {
  BotDTO,
  ConnectionDTO,
  ConnectionTestResult,
  CreateBotRequest,
  LiveChecklistItem,
  MarketDTO,
  SignalDTO,
  StrategyDefaults,
  TradeDTO,
  TradingMode,
  UpdateBotRequest,
  AccountDTO,
} from '../../shared/types';

// 백엔드 API 호출. Secret Key는 등록할 때 한 번 서버로 보내고, 프론트 어디에도 저장하지 않는다.

export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers: {
        Accept: 'application/json',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        'X-Requested-With': 'upbit-bot',
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError('NETWORK', '서버에 연결할 수 없어요. 프로그램(서버)이 켜져 있는지 확인해 주세요.', 0);
  }
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!res.ok) {
    const err = (json as { error?: { code?: string; message?: string } } | null)?.error;
    throw new ApiError(err?.code ?? `HTTP_${res.status}`, err?.message ?? '요청을 처리하지 못했어요.', res.status);
  }
  return json as T;
}

export const api = {
  strategyDefaults: () => request<StrategyDefaults>('GET', '/strategy-defaults'),
  markets: () => request<MarketDTO[]>('GET', '/markets'),

  createBot: (req: CreateBotRequest) => request<{ bot: BotDTO; startError: string | null }>('POST', '/bots', req),
  updateBot: (id: number, req: UpdateBotRequest) => request<BotDTO>('PATCH', `/bots/${id}`, req),
  deleteBot: (id: number) => request<{ ok: true }>('DELETE', `/bots/${id}`),
  startBot: (id: number) => request<BotDTO>('POST', `/bots/${id}/start`),
  stopBot: (id: number) => request<{ bot: BotDTO; cancelled: number; failed: number }>('POST', `/bots/${id}/stop`),
  liquidatePaper: (id: number) => request<BotDTO>('POST', `/bots/${id}/paper-liquidate`),
  setBotMode: (id: number, mode: TradingMode, confirmText?: string) => request<BotDTO>('POST', `/bots/${id}/mode`, { mode, confirmText }),

  trades: (limit = 100) => request<TradeDTO[]>('GET', `/trades?limit=${limit}`),
  signals: (limit = 100) => request<SignalDTO[]>('GET', `/signals?limit=${limit}`),

  refreshAccount: () => request<AccountDTO>('POST', '/account/refresh'),
  resetPaper: () => request<AccountDTO>('POST', '/paper/reset'),

  testConnection: () => request<ConnectionTestResult>('POST', '/connection/test'),
  saveCredentials: (accessKey: string, secretKey: string) => request<ConnectionDTO>('PUT', '/connection/credentials', { accessKey, secretKey }),
  deleteCredentials: () => request<ConnectionDTO>('DELETE', '/connection/credentials'),

  liveChecklist: () => request<{ items: LiveChecklistItem[]; liveEnabled: boolean; hardLock: boolean; confirmText: string }>('GET', '/live/checklist'),
  enableLive: (confirmText: string, withdrawPermissionOff: boolean) => request<{ liveEnabled: boolean }>('POST', '/live/enable', { confirmText, withdrawPermissionOff }),
  disableLive: () => request<{ liveEnabled: boolean; stoppedBots: number }>('POST', '/live/disable'),

  emergencyStop: () => request<{ bots: number; cancelled: number; failed: number }>('POST', '/emergency-stop'),
  releaseEmergency: () => request<{ ok: true }>('POST', '/emergency-release'),
};
