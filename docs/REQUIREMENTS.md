# 작업지시서 요약 (2026-10-03 사용자 제공 원문의 요구사항 체크리스트)

원문은 88개 항목. 재개 시 이 목록으로 누락 여부를 확인한다.

## UI 원칙
- 기존 UI(docs/ui-original/App.original.tsx, src/index.css) 디자인·색·카드·배치·모바일 느낌·토스 스타일·초보자 한국어 유지. 새로 디자인 금지.
- 하드코딩 데이터만 실제 데이터로 교체. 실제 동작과 다른/보안상 잘못된 문구는 수정.
- 화면 = 쉬운 말(코인 사기/팔기, 지금 쓸 수 있는 돈, 이미 팔아서 확정된 수익…), 코드 = 정확한 업비트 용어.
- 성능/안전 보장 표현 제거: 승률 85%+, 초보자 추천, 안전형, 안전 손절, 알아서 벌어준 총 수익, 0.1초 만에 멈춤, 무조건 수익, 손실 걱정 없음.
- 헤더 "24시간 자동 감시 중" → 실제 상태(정상/연결 중/끊김/재연결 중/긴급 정지 + N개 봇 감시 중).
- 새 봇 만들기 UX(1 코인 → 2 시그널 → 3 익절/손절 → 4 예산 → 시작) 유지, 필요한 전략 설정은 디자인 해치지 않게 추가.
- 코인 목록은 업비트 실제 거래가능 마켓 + 실제 현재가.
- 시그널 & 체결내역: 코인, 사기/팔기, 체결가, 수량, 금액, 수수료, 손익, 전략, 이유, 시간. 시그널과 체결 구분.
- API 탭: 연결 여부, 권한 상태(확인 안 된 건 "안전"이라 하지 않음), Access Key 마스킹, KRW 잔고, 보유 코인, 평가금, 마지막 수신 시간. 실제 연결 테스트(정상/인증 실패/권한 부족/네트워크/업비트 서버 오류). 실제 API Key 변경(Secret 재표시 금지).
- PAPER/LIVE 명확 표시. LIVE 전환 시 "지금부터 실제 업비트 계좌에서 주문이 실행됩니다." 확인창.
- "모든 자동매매 멈추기" 버튼.
- App.tsx에 전부 넣지 말고 components/pages/hooks/api/services/strategies/types/backend/db/utils로 분리(과도한 파일 분할 금지).
- Desktop/Mobile, 카드, 탭, 모달, 토스트, 색, 여백, 버튼, 타이포 유지 검증.

## 보안
- Secret Key는 서버에서만. React/localStorage/sessionStorage/URL/쿼리/프론트 상태 금지. 로그·에러·응답에 미노출. 출금 기능 구현 금지. 출금 권한 끄도록 안내.
- .env/.env.local/키 파일 git 제외(.gitignore). 평문 저장 최소화(암호화). dev/prod env 분리.

## 업비트 연동
- 공식 문서 기준(추측 금지). displaySymbol(BTC/KRW) ↔ marketCode(KRW-BTC) 분리.
- REST: 마켓, 현재가, 캔들, 체결, 호가 / 자산, 주문가능정보, 주문 생성·조회·취소. 주문은 REST.
- WS: public ticker/trade/orderbook/candle, private myOrder/myAsset(한 연결). 재연결(간격·최대 재시도·폭주 방지), 연결 유지, 중복 연결 방지, 인증 실패 처리.
- Rate Limit: 현재가 REST polling 금지, 주문 조회 과다 금지, 같은 신호 반복 주문 금지, Remaining-Req 처리.
- 주문 생성 테스트 API 활용(실돈 테스트 금지). Paper Trading은 별도 구현.

## 주문/체결
- 상태: 요청, 접수, wait, 부분 체결, 전량 체결, 취소, 부분체결 후 취소, 실패, 네트워크 오류, API 오류, 체결 방지(prevented) 등. 확장 쉽게.
- Order와 Trade 분리. 주문 성공 ≠ 체결.
- 모든 봇 주문에 내부 identifier(BOT-{botId}-{ts}-{rand}) → 봇/전략/시그널/포지션/체결/손익 역추적.
- 주문 전 검증: 마켓 존재·거래가능, 주문방식, 가격·수량 형식, 가격단위, 최소/최대 금액, KRW·코인 잔고, 잠긴 자산, 봇 ON, 예산, 중복, 긴급정지. 실패 시 주문 안 함.
- normalizePrice/normalizeVolume/validateOrderAmount/validateMarket 유틸(하드코딩 대신 공식 정책/API).
- 봇별 예산(계좌잔고·봇예산·사용금액·이번주문 계층 검증). 예산→수량 계산→보정→최소금액→주문.

## 모델
- Bot: id, name, displayName, marketCode, displaySymbol, coinName, strategy, strategyConfig, budgetKRW, takeProfitPercent, stopLossPercent, active, mode, createdAt, updatedAt
- Order: id, botId, identifier, upbitUuid, marketCode, side, orderType, price, volume, executedVolume, remainingVolume, averagePrice, fee, state, reason, strategySignalId, createdAt, updatedAt
- Trade: id, botId, marketCode, orderId, side, price, volume, fee, timestamp
- Position: botId, marketCode, quantity, averageEntryPrice, totalCost, currentPrice, unrealizedPnl, unrealizedPnlPercent, realizedPnl, updatedAt
- Signal: id, botId, marketCode, strategy, signalType, signalValue, reason(사람이 읽는), timestamp
- 테이블: bots, orders, trades, signals, positions, system_settings, api_connection(보안 저장). SQLite → PostgreSQL 이전 쉽게.

## 전략
- strategies/ 모듈 분리, 공통 인터페이스(initialize/onMarketData/onCandle/onTicker/onOrderUpdate/generateSignal/validate/stop 개념).
- Grid: 설정(기준가, 상/하단, 간격, 개수, 주문금액, 익절, 손절, 최대운용, 재진입 제한) 봇별 config. gridLevelId로 중복 방지.
- RSI: Indicator 모듈 분리. period/oversold/overbought/주문금액/최대 진입/분할 비율/익절/손절. 중복 신호 반복 매수 금지.
- Golden Cross: 이전 MA5<=MA20 → 현재 MA5>MA20 교차 이벤트만, 중복 진입 금지.
- 손절: 기준 명확히(평단/체결가/수수료 포함 여부). 실행 전 보유·주문가능 수량 재확인.
- 익절: 실제 포지션 평균 매입단가 기준.
- 손익: 실현/미실현/총 구분(수수료 반영). 샘플 숫자 전부 제거.
- 설정 기본값 중앙화(config/strategies), 봇별 값은 별도 저장. "그리드 간격 1→1.5%" 같은 변경이 한두 곳 수정으로 가능해야.

## 안전
- 첫 실행은 PAPER. LIVE 기본 OFF, 명시 확인 후만.
- 긴급 전체 정지: 전략 중단, 신규 주문 중단, 봇 OFF, 봇이 만든 미체결 취소, 보유 코인 강제 매도 안 함.
- 봇 OFF: 신규 주문 금지, 그 봇의 미체결만 취소(botId/identifier로 식별), 보유 코인 매도 안 함.
- 재시작 복구: DB 활성 봇 → 계좌 → 보유자산 → 미체결 → 자동주문 식별 → DB vs 업비트 비교 → 복구 → WS 재연결 → 전략 재개. 업비트 상태가 최종 기준. 주기적 동기화.
- 중복 주문 방지(botId, market, signalId, identifier, 목적, 포지션, 미체결 조합).
- API 오류 → 초보자 메시지(insufficient_funds_bid → "매수할 원화가 부족합니다." 등), 내부 로그엔 원문.
- 로그 태그: [PRICE] [STRATEGY] [SIGNAL] [ORDER] [ORDER_FILLED] [ORDER_CANCEL] [POSITION] [ERROR] [WEBSOCKET] [SYSTEM]. 비밀정보 금지.
- LIVE 전 체크리스트(§75): API 인증, 출금 권한 미사용, 잔고 조회, 현재가 수신, WS 정상, myOrder, myAsset, 주문가능정보, 가격단위 보정, 최소금액, 예산, 중복 방지, 주문 추적, 체결 추적, DB 저장, 재시작 복구, 긴급 정지, Paper 검증. 하나라도 불완전하면 LIVE 금지.

## API (프론트 ↔ 백엔드) 예
GET/POST /api/bots, PATCH /api/bots/:id, POST /api/bots/:id/start|stop, GET /api/orders, /api/trades, /api/signals, /api/account, /api/connection, POST /api/connection/test. 실시간 반영(WS/SSE).

## 테스트
- Unit: symbol↔market, 가격단위, 수량, 최소금액, 예산, RSI, MA, Grid, 익절, 손절, 중복 방지, identifier.
- Integration: Public 무인증, Private 인증, 잔고, 주문가능, 주문 생성 테스트, 조회, 취소, WS 연결, ticker, myOrder, myAsset. 실거래 테스트 금지.

## 첫 개발 사이클 완료 기준
1 UI 그대로 실행 2 실제 현재가 3 Private 인증 4 실제 KRW 잔고 5 실제 보유 코인 6 실시간 ticker 7 Private WS 연결 8 Paper Trading.

## README (완료 후)
설치, 실행, 환경변수, Upbit Key 발급, 권한 설정, PAPER 사용, LIVE 사용, 봇 생성, 전략 설명, 긴급 정지, 로그 확인, 문제 해결, 실거래 전 체크리스트.

## 보고
구현마다 변경 파일 / 변경 내용 / 테스트 결과 / 아직 Mock인 부분 / 실거래 미연결 부분 기록 (PROGRESS.md).
