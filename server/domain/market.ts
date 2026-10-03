/**
 * 화면용 거래쌍(displaySymbol: "BTC/KRW")과 업비트 페어 코드(marketCode: "KRW-BTC")를 분리한다.
 * 업비트 페어 코드 형식: {호가 자산(quote)}-{기준 자산(base)}  (예: KRW-BTC, BTC-ETH, USDT-XRP)
 */
export interface MarketPair {
  quote: string; // KRW
  base: string; // BTC
}

const MARKET_CODE_RE = /^([A-Z0-9]{2,10})-([A-Z0-9]{1,15})$/;
const DISPLAY_RE = /^([A-Z0-9]{1,15})\/([A-Z0-9]{2,10})$/;

export function parseMarketCode(marketCode: string): MarketPair {
  const m = MARKET_CODE_RE.exec(marketCode?.trim() ?? '');
  if (!m) throw new Error(`잘못된 마켓 코드 형식: ${marketCode}`);
  return { quote: m[1], base: m[2] };
}

export function isValidMarketCode(marketCode: string): boolean {
  return MARKET_CODE_RE.test(marketCode?.trim() ?? '');
}

/** "BTC/KRW" → "KRW-BTC" */
export function toMarketCode(displaySymbol: string): string {
  const m = DISPLAY_RE.exec(displaySymbol?.trim().toUpperCase() ?? '');
  if (!m) throw new Error(`잘못된 표시 심볼 형식: ${displaySymbol}`);
  return `${m[2]}-${m[1]}`;
}

/** "KRW-BTC" → "BTC/KRW" */
export function toDisplaySymbol(marketCode: string): string {
  const { quote, base } = parseMarketCode(marketCode);
  return `${base}/${quote}`;
}

export function baseCurrency(marketCode: string): string {
  return parseMarketCode(marketCode).base;
}

export function quoteCurrency(marketCode: string): string {
  return parseMarketCode(marketCode).quote;
}
