// Frontend ↔ Backend 공용 타입(DTO).
// 내부 용어는 업비트 공식 용어(bid/ask, wait/done/cancel …)를 그대로 쓰고,
// 쉬운 한국어 표현은 화면(src/)에서만 변환한다.

export type TradingMode = 'PAPER' | 'LIVE';
export type StrategyKind = 'grid' | 'rsi' | 'goldenCross';
export type OrderSide = 'bid' | 'ask';
/** 업비트 ord_type */
export type OrderType = 'limit' | 'price' | 'market' | 'best';

/**
 * 내부 주문 상태. 업비트 원본 상태(upbitState)와 별도로 관리한다.
 * 업비트가 새 상태를 추가하면 server/domain/orderState.ts 의 매핑만 고치면 된다.
 */
export type OrderState =
  | 'REQUESTED' // 서버가 주문을 보내려는 중(응답 전)
  | 'OPEN' // wait — 접수, 체결 대기
  | 'WATCH' // watch — 예약 주문 대기
  | 'PARTIALLY_FILLED' // 일부 체결, 남은 수량 대기 중
  | 'FILLED' // done — 전량 체결
  | 'CANCELLED' // cancel — 체결 없이 취소
  | 'PARTIALLY_FILLED_CANCELLED' // 일부 체결 후 취소
  | 'PREVENTED' // 자전거래 체결 방지(SMP)로 취소
  | 'REJECTED' // 사전 검증 실패 또는 업비트가 거절(4xx)
  | 'UNKNOWN'; // 네트워크 오류 등으로 결과 미확인 → 복구 로직이 확정

export type OrderPurpose =
  | 'GRID_BUY'
  | 'GRID_SELL'
  | 'ENTRY'
  | 'EXIT'
  | 'TAKE_PROFIT'
  | 'STOP_LOSS'
  | 'MANUAL';

export type SignalType = 'BUY' | 'SELL' | 'INFO';

export type CandleUnit = '1m' | '3m' | '5m' | '10m' | '15m' | '30m' | '60m' | '240m' | '1d';

/** 모든 전략 공통 위험 관리 */
export interface RiskConfig {
  /** 트레일링 익절(%): 목표 익절에 닿은 뒤 최고가에서 이만큼 내려오면 판다. 0이면 목표 익절에서 바로 판다 */
  trailingStopPercent: number;
  /** 하루 최대 손실(예산 대비 %): 오늘 확정 손실이 이만큼이면 그날은 새로 사지 않는다. 0이면 끔 */
  dailyLossLimitPercent: number;
  /** 손실을 보고 판 뒤 새로 사기까지 쉬는 시간(분). 0이면 끔 */
  cooldownAfterLossMin: number;
}

export interface GridConfig extends RiskConfig {
  /** 기준가(봇 생성 시점 현재가). 0이면 시작 시점 현재가로 자동 설정 */
  basePrice: number;
  /** 간격 방식: fixed = spacingPercent 고정, atr = 최근 변동폭(ATR)에 맞춰 자동 */
  spacingMode: 'fixed' | 'atr';
  /** 레벨 간격(%) — 기준가에서 아래로 이 간격마다 매수 레벨 (atr 모드에서는 최소값) */
  spacingPercent: number;
  /** atr 모드: 간격 = ATR(14) ÷ 가격 × 이 배수 */
  atrMultiplier: number;
  /** 매수 레벨 개수 */
  levels: number;
  /** 레벨 하나에 쓰는 금액(KRW). 0이면 예산 ÷ 레벨 수 */
  orderKRW: number;
  /** 같은 레벨 재진입까지 최소 대기(초) */
  reentryCooldownSec: number;
  /** 하락장 매수 멈춤: 가격이 분석봉 EMA50보다 3% 넘게 아래면 새로 사지 않음(파는 건 계속) */
  downtrendGuard: boolean;
  /** ATR/추세 계산에 쓰는 캔들 */
  analysisUnit: CandleUnit;
}

export interface RsiConfig extends RiskConfig {
  candleUnit: CandleUnit;
  period: number;
  oversold: number;
  overbought: number;
  /** rebound = 과매도로 내려갔다가 다시 과매도선 위로 올라올 때(반등 확인) 매수, dip = 과매도선 아래로 내려가는 순간 매수 */
  entryMode: 'rebound' | 'dip';
  /** 추세 필터: 종가가 EMA(이 기간) 위일 때만 매수. 0이면 끔 */
  trendEmaPeriod: number;
  /** 1회 진입 금액 = 예산 × splitRatio */
  splitRatio: number;
  maxEntries: number;
}

export interface GoldenCrossConfig extends RiskConfig {
  candleUnit: CandleUnit;
  /** 이동평균 종류 */
  maType: 'SMA' | 'EMA';
  shortPeriod: number;
  longPeriod: number;
  /** 거래량 확인: 교차 봉의 거래량이 최근 20봉 평균 × 이 배수 이상일 때만 매수. 0이면 끔 */
  volumeMultiplier: number;
  /** ATR 손절: 첫 매수 시점 ATR(14) × 이 배수만큼 내려가면 손절(손절 %와 비교해 더 가까운 쪽). 0이면 끔 */
  atrStopMultiplier: number;
  /** 진입 금액 = 예산 × entryRatio */
  entryRatio: number;
  /** 데드크로스 시 전량 매도 여부 */
  exitOnDeadCross: boolean;
}

export type StrategyConfig =
  | ({ kind: 'grid' } & GridConfig)
  | ({ kind: 'rsi' } & RsiConfig)
  | ({ kind: 'goldenCross' } & GoldenCrossConfig);

export interface StrategyDefaults {
  takeProfitPercent: number;
  stopLossPercent: number;
  takeProfitChoices: number[];
  stopLossChoices: number[];
  budgetChoices: number[];
  grid: GridConfig;
  rsi: RsiConfig;
  goldenCross: GoldenCrossConfig;
  feeRateDefault: number;
  minOrderKRWDefault: number;
}

export interface BotDTO {
  id: number;
  name: string;
  displayName: string;
  marketCode: string; // KRW-BTC
  displaySymbol: string; // BTC/KRW
  coinName: string; // 비트코인
  strategy: StrategyKind;
  strategyConfig: StrategyConfig;
  budgetKRW: number;
  takeProfitPercent: number;
  stopLossPercent: number;
  active: boolean;
  mode: TradingMode;
  lastSignalText: string | null;
  lastSignalAt: string | null;
  createdAt: string;
  updatedAt: string;
  /** 엔진이 이 봇을 실행하지 못하는 이유(예: LIVE 하드락) */
  blockedReason: string | null;
  /** 이 봇의 대기 중인 주문(카드에서 펼쳐 보기) */
  openOrders: Array<{ id: number; side: OrderSide; purpose: OrderPurpose; price: string | null; volume: string | null; executedVolume: string; gridLevelId: string | null; state: OrderState }>;
  /** 카드의 전략 설명 박스용(서버 전략 모듈이 실제 설정값으로 생성) */
  strategyTitle: string;
  strategyDescription: string;
  targetRange: string;
  stats: BotStats;
}

export interface BotStats {
  currentPrice: number | null;
  positionQuantity: number;
  averageEntryPrice: number;
  totalCost: number;
  realizedPnl: number;
  unrealizedPnl: number;
  unrealizedPnlPercent: number;
  totalPnl: number;
  /** 총손익 ÷ 예산 × 100 */
  totalPnlPercentOfBudget: number;
  todayTradesCount: number;
  openOrdersCount: number;
  /** 포지션 원가 + 미체결 매수 잠금액 */
  usedBudgetKRW: number;
}

export interface OrderDTO {
  id: number;
  botId: number | null;
  identifier: string;
  upbitUuid: string | null;
  marketCode: string;
  side: OrderSide;
  orderType: OrderType;
  price: string | null;
  volume: string | null;
  executedVolume: string;
  remainingVolume: string | null;
  averagePrice: string | null;
  executedFunds: string;
  fee: string;
  state: OrderState;
  upbitState: string | null;
  purpose: OrderPurpose;
  gridLevelId: string | null;
  reason: string | null;
  strategySignalId: number | null;
  mode: TradingMode;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TradeDTO {
  id: number;
  botId: number | null;
  orderId: number;
  marketCode: string;
  displaySymbol: string;
  coinName: string;
  side: OrderSide;
  price: string;
  volume: string;
  funds: string;
  fee: string;
  /** 매도 체결일 때만 값이 있음(수수료 반영 실현손익) */
  realizedPnl: string | null;
  realizedPnlPercent: number | null;
  purpose: OrderPurpose;
  strategy: StrategyKind | null;
  reason: string | null;
  mode: TradingMode;
  timestamp: string;
}

export interface SignalDTO {
  id: number;
  botId: number;
  marketCode: string;
  displaySymbol: string;
  coinName: string;
  strategy: StrategyKind;
  signalType: SignalType;
  signalValue: string | null;
  reason: string;
  /** 이 시그널로 주문이 나갔는지, 거절됐다면 이유 */
  outcome: string | null;
  orderId: number | null;
  timestamp: string;
}

export type SystemStatus = 'SYSTEM_ONLINE' | 'CONNECTING' | 'DEGRADED' | 'DISCONNECTED' | 'EMERGENCY_STOP';

export type StreamStatus = 'IDLE' | 'CONNECTING' | 'OPEN' | 'RECONNECTING' | 'CLOSED' | 'AUTH_FAILED';

export interface SystemStateDTO {
  status: SystemStatus;
  emergencyStop: boolean;
  publicStream: StreamStatus;
  privateStream: StreamStatus;
  lastPublicMessageAt: string | null;
  lastPrivateMessageAt: string | null;
  activeBots: number;
  totalBots: number;
  liveHardLock: boolean;
  liveEnabled: boolean;
  hasCredentials: boolean;
  serverTime: string;
  message: string | null;
}

export interface AccountAsset {
  currency: string;
  balance: number;
  locked: number;
  avgBuyPrice: number;
  marketCode: string | null;
  currentPrice: number | null;
  evaluationKRW: number | null;
}

export interface AccountDTO {
  source: 'UPBIT' | 'NONE';
  krwAvailable: number | null;
  krwLocked: number | null;
  coinEvaluationKRW: number | null;
  totalEvaluationKRW: number | null;
  assets: AccountAsset[];
  updatedAt: string | null;
  error: string | null;
  /** 모의투자 지갑: 가상 원화 + 모의 봇들이 들고 있는 가상 코인 평가금 */
  paper: { krwBalance: number; initialKRW: number; coinValueKRW: number; totalKRW: number };
}

export type PermissionState = 'OK' | 'DENIED' | 'UNKNOWN' | 'NOT_CHECKED';

export interface ConnectionDTO {
  hasCredentials: boolean;
  credentialSource: 'DB' | 'ENV' | null;
  accessKeyMasked: string | null;
  lastTestAt: string | null;
  lastTestResult: ConnectionTestResult | null;
  apiKeyExpireAt: string | null;
}

export interface ConnectionTestResult {
  ok: boolean;
  /** 사용자에게 보여줄 한 줄 요약 */
  summary: string;
  category: 'OK' | 'NO_CREDENTIALS' | 'AUTH_FAILED' | 'PERMISSION' | 'NETWORK' | 'UPBIT_SERVER' | 'IP_NOT_ALLOWED' | 'RATE_LIMIT' | 'UNKNOWN';
  publicApi: { ok: boolean; latencyMs: number | null; message: string };
  permissions: {
    quotation: PermissionState; // 시세 조회
    assetRead: PermissionState; // 자산조회
    orderRead: PermissionState; // 주문조회
    orderWrite: PermissionState; // 주문하기 (주문 생성 테스트 API로 확인, 실제 주문 없음)
    withdraw: PermissionState; // 출금 — 프로그램이 확인할 수 없음
  };
  details: string[];
  testedAt: string;
}

export interface MarketDTO {
  marketCode: string;
  displaySymbol: string;
  coinName: string;
  englishName: string;
  warning: boolean;
  caution: boolean;
  tradePrice: number | null;
  signedChangeRate: number | null;
  accTradePrice24h: number | null;
}

export interface ModeSummary {
  totalPnl: number;
  realizedPnl: number;
  unrealizedPnl: number;
  totalBudget: number;
  activeBudget: number;
  totalPnlPercentOfBudget: number;
  todayTradesCount: number;
  botCount: number;
}

export interface LiveChecklistItem {
  key: string;
  label: string;
  ok: boolean;
  detail: string;
}

export interface SnapshotDTO {
  system: SystemStateDTO;
  bots: BotDTO[];
  account: AccountDTO;
  connection: ConnectionDTO;
  /** 모의/실전 손익을 섞지 않도록 모드별로 따로 집계. summary는 화면 대표 모드(실전 봇이 있으면 LIVE, 없으면 PAPER) */
  summaryByMode: Record<TradingMode, ModeSummary>;
  headlineMode: TradingMode;
  summary: {
    totalPnl: number;
    realizedPnl: number;
    unrealizedPnl: number;
    totalBudget: number;
    activeBudget: number;
    totalPnlPercentOfBudget: number;
    todayTradesCount: number;
  };
  /** 화면에 표시 중인 마켓들의 현재가 */
  prices: Record<string, number>;
  /** 체결/시그널 목록이 바뀌면 증가 → 프론트가 목록을 다시 불러옴 */
  activityVersion: number;
}

export interface CreateBotRequest {
  marketCode: string;
  strategy: StrategyKind;
  budgetKRW: number;
  takeProfitPercent: number;
  stopLossPercent: number;
  strategyConfig?: Partial<GridConfig & RsiConfig & GoldenCrossConfig>;
  name?: string;
  start?: boolean;
}

export interface UpdateBotRequest {
  name?: string;
  budgetKRW?: number;
  takeProfitPercent?: number;
  stopLossPercent?: number;
  strategyConfig?: Partial<GridConfig & RsiConfig & GoldenCrossConfig>;
}

/** 백테스트(과거 캔들로 전략 시험) */
export interface BacktestRequest {
  marketCode: string;
  strategy: StrategyKind;
  budgetKRW: number;
  takeProfitPercent: number;
  stopLossPercent: number;
  strategyConfig?: Partial<GridConfig & RsiConfig & GoldenCrossConfig>;
  days: number;
}

export interface BacktestMetricsDTO {
  startAt: number;
  endAt: number;
  bars: number;
  finalEquity: number;
  totalReturnPercent: number;
  buyHoldPercent: number;
  trades: number;
  wins: number;
  losses: number;
  winRate: number;
  avgWin: number;
  avgLoss: number;
  payoffRatio: number | null;
  profitFactor: number | null;
  expectancy: number;
  maxDrawdownPercent: number;
  feesPaid: number;
  stopLosses: number;
  exposurePercent: number;
  buys: number;
  openPnl: number;
}

export interface BacktestResultDTO {
  request: BacktestRequest;
  simUnit: CandleUnit;
  analysisUnit: CandleUnit | null;
  metrics: BacktestMetricsDTO;
  equity: Array<{ t: number; equity: number; price: number }>;
  trades: Array<{ at: number; purpose: OrderPurpose; price: number; volume: number; pnl: number; pnlPercent: number }>;
  notes: string[];
}

export interface ApiError {
  error: { code: string; message: string };
}
