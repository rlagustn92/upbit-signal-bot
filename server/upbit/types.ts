// 업비트 API 응답 타입 — 공식 OpenAPI 정의(docs/upbit-openapi-summary.txt) 기준.
// 숫자 문자열 필드(string)는 정밀도 보존을 위해 문자열 그대로 둔다.

export interface UpbitMarket {
  market: string;
  korean_name: string;
  english_name: string;
  market_event?: {
    warning?: boolean;
    caution?: Record<string, boolean>;
  };
}

export interface UpbitTicker {
  market: string;
  trade_date: string;
  trade_time: string;
  trade_timestamp: number;
  opening_price: number;
  high_price: number;
  low_price: number;
  trade_price: number;
  prev_closing_price: number;
  change: 'EVEN' | 'RISE' | 'FALL';
  change_price: number;
  change_rate: number;
  signed_change_price: number;
  signed_change_rate: number;
  trade_volume: number;
  acc_trade_price: number;
  acc_trade_price_24h: number;
  acc_trade_volume: number;
  acc_trade_volume_24h: number;
  timestamp: number;
}

export interface UpbitCandle {
  market: string;
  candle_date_time_utc: string;
  candle_date_time_kst: string;
  opening_price: number;
  high_price: number;
  low_price: number;
  trade_price: number;
  timestamp: number;
  candle_acc_trade_price: number;
  candle_acc_trade_volume: number;
  unit?: number;
}

export interface UpbitInstrument {
  market: string;
  quote_currency: string;
  tick_size: string;
  supported_levels: string[];
}

export interface UpbitAccount {
  currency: string;
  balance: string;
  locked: string;
  avg_buy_price: string;
  avg_buy_price_modified: boolean;
  unit_currency: string;
}

export interface UpbitOrderChance {
  bid_fee: string;
  ask_fee: string;
  maker_bid_fee: string;
  maker_ask_fee: string;
  market: {
    id: string;
    name: string;
    order_sides: string[];
    bid_types: string[];
    ask_types: string[];
    bid: { currency: string; min_total: string };
    ask: { currency: string; min_total: string };
    max_total: string;
    state: string;
  };
  bid_account: UpbitAccount;
  ask_account: UpbitAccount;
}

export interface UpbitOrderTrade {
  market: string;
  uuid: string;
  price: string;
  volume: string;
  funds: string;
  trend?: string;
  created_at: string;
  side: string;
}

export interface UpbitOrder {
  market: string;
  uuid: string;
  side: 'bid' | 'ask';
  ord_type: 'limit' | 'price' | 'market' | 'best';
  price?: string | null;
  state: 'wait' | 'watch' | 'done' | 'cancel' | string;
  created_at: string;
  volume?: string | null;
  remaining_volume: string;
  executed_volume: string;
  reserved_fee: string;
  remaining_fee: string;
  paid_fee: string;
  locked: string;
  trades_count: number;
  time_in_force?: 'fok' | 'ioc' | 'post_only' | null;
  identifier?: string | null;
  smp_type?: string | null;
  prevented_volume?: string;
  prevented_locked?: string;
  trades?: UpbitOrderTrade[];
}

export interface UpbitCreateOrderBody {
  market: string;
  side: 'bid' | 'ask';
  ord_type: 'limit' | 'price' | 'market' | 'best';
  volume?: string;
  price?: string;
  identifier?: string;
  time_in_force?: 'fok' | 'ioc' | 'post_only';
  smp_type?: 'cancel_maker' | 'cancel_taker' | 'reduce';
}

export interface UpbitBatchCancelResult {
  success: { count: number; orders: Array<{ uuid: string; market: string; identifier?: string }> };
  failed: { count: number; orders: Array<{ uuid: string; market: string; identifier?: string }> };
}

export interface UpbitApiKey {
  access_key: string;
  expire_at: string;
}

// ── WebSocket ──
export interface WsTicker {
  type: 'ticker';
  code: string;
  trade_price: number;
  signed_change_rate: number;
  acc_trade_price_24h?: number;
  market_state?: string;
  is_trading_suspended?: boolean;
  trade_timestamp: number;
  timestamp: number;
  stream_type: 'SNAPSHOT' | 'REALTIME';
}

export interface WsTrade {
  type: 'trade';
  code: string;
  trade_price: number;
  trade_volume: number;
  ask_bid: 'ASK' | 'BID';
  trade_timestamp: number;
  sequential_id: number;
  timestamp: number;
  stream_type: 'SNAPSHOT' | 'REALTIME';
}

export interface WsCandle {
  type: string; // candle.1m …
  code: string;
  candle_date_time_utc: string;
  candle_date_time_kst: string;
  opening_price: number;
  high_price: number;
  low_price: number;
  trade_price: number;
  candle_acc_trade_volume: number;
  candle_acc_trade_price: number;
  timestamp: number;
  stream_type: 'SNAPSHOT' | 'REALTIME';
}

export interface WsMyOrder {
  type: 'myOrder';
  code: string;
  uuid: string;
  ask_bid: 'ASK' | 'BID';
  order_type: 'limit' | 'price' | 'market' | 'best';
  state: 'wait' | 'watch' | 'trade' | 'done' | 'cancel' | 'prevented' | string;
  trade_uuid?: string | null;
  price?: number | null;
  avg_price?: number | null;
  volume?: number | null;
  remaining_volume?: number | null;
  executed_volume?: number | null;
  trades_count?: number;
  reserved_fee?: number;
  remaining_fee?: number;
  paid_fee?: number;
  locked?: number;
  executed_funds?: number;
  time_in_force?: string | null;
  trade_fee?: number | null;
  is_maker?: boolean | null;
  identifier?: string | null;
  smp_type?: string | null;
  prevented_volume?: number;
  prevented_locked?: number;
  trade_timestamp?: number | null;
  order_timestamp?: number;
  timestamp: number;
  stream_type: 'REALTIME' | 'SNAPSHOT';
}

export interface WsMyAsset {
  type: 'myAsset';
  asset_uuid: string;
  assets: Array<{ currency: string; balance: number; locked: number }>;
  asset_timestamp: number;
  timestamp: number;
  stream_type: 'REALTIME';
}
