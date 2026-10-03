# IMPLEMENTATION_PLAN.md — 업비트 자동매매 봇

> 작성일: 2026-10-03 · 기준 문서: 업비트 개발자 센터(docs.upbit.com/kr, 2026-09 갱신본)
> 공식 문서 원문 사본: `docs/upbit-reference/` (원본 .md), `docs/upbit-reference/clean/` (HTML 제거본),
> OpenAPI 요약: `docs/upbit-openapi-summary.txt` (두 사본 모두 로컬 전용 — 저작권상 공개 저장소에는 포함하지 않음)

---

## A. 현재 프로젝트 구조 (분석 결과)

작업 시작 시점의 폴더 `AUTO COIN BUY/`는 **완전히 비어 있었습니다**.
`package.json`, `src/`, Tailwind/Vite/TS 설정, 빌드 스크립트 모두 존재하지 않았고, git 저장소도 아니었습니다.
또한 PC에 Node.js가 설치되어 있지 않았습니다.

따라서:

- UI 원본은 작업지시서에 붙여진 `src/index.css`, `src/App.tsx`를 **그대로** 기준으로 삼았습니다.
- 원본 코드가 사용하는 기술로부터 환경을 역산했습니다.
  - `@import 'tailwindcss';` → **Tailwind CSS v4** (`@tailwindcss/vite` 플러그인)
  - `h-0.75`, `p-4.5`, `backdrop-blur-xs` 등 v4 문법 사용
  - `lucide-react` 아이콘
  - React 함수형 컴포넌트 + TypeScript → **Vite + React + TS**
- Node.js LTS(v24.21.0)를 공식 nodejs.org 배포본(SHA256 검증)으로 사용자 폴더에 포터블 설치했습니다
  (`%LOCALAPPDATA%\node-portable\node-v24.21.0-win-x64`). 시스템 설정은 바꾸지 않았습니다.

최종 구조:

```
AUTO COIN BUY/
├─ index.html, vite.config.ts, tsconfig*.json, package.json
├─ src/                       ← Frontend (React + TS + Tailwind v4)
│  ├─ index.css               ← 원본 그대로
│  ├─ App.tsx                 ← 원본 레이아웃/탭/헤더 유지, 데이터만 실제로 교체
│  ├─ api/                    ← 백엔드 호출 (fetch + SSE)
│  ├─ hooks/                  ← useLiveState 등
│  ├─ components/             ← 원본 JSX를 그대로 옮긴 탭/카드/모달
│  └─ lib/                    ← 숫자/시간 포맷, 코인 아이콘 메타
├─ shared/                    ← Frontend·Backend 공용 타입(DTO)
├─ server/                    ← Backend (Node + TS)
│  ├─ index.ts                ← 부트스트랩 + 재시작 복구
│  ├─ config/                 ← 환경변수, 전략 기본값(중앙화)
│  ├─ db/                     ← SQLite(node:sqlite) + 마이그레이션 + Repository
│  ├─ upbit/                  ← REST/WS 클라이언트, JWT, Rate Limit, 에러 번역
│  ├─ domain/                 ← market code 변환, 가격/수량 보정, identifier
│  ├─ indicators/             ← RSI, 이동평균
│  ├─ strategies/             ← grid / rsi / goldenCross / riskExit(익절·손절)
│  ├─ execution/              ← PaperExecutor / LiveExecutor
│  ├─ services/               ← 시세, 계좌, 주문, 포지션, 봇엔진, 시스템상태, 복구
│  └─ api/                    ← REST 라우트 + SSE 스트림
├─ tests/                     ← vitest 단위/통합 테스트
├─ docs/                      ← 업비트 공식 문서 사본
├─ data/                      ← SQLite DB, 암호화 키 (git 제외)
├─ IMPLEMENTATION_PLAN.md, PROGRESS.md, README.md
└─ .env.example, .gitignore
```

## B. 기존 UI 구조 (유지 대상)

| 영역 | 유지 내용 | 실제 데이터로 바뀌는 부분 |
|---|---|---|
| 헤더 | UP 로고, "코인 시그널 봇", "업비트 전용" 배지, 상태 칩 | 상태 칩: "24시간 자동 감시 중" 고정 → 실제 시스템 상태(정상/연결 중/끊김/긴급 정지 + 감시 중 봇 수) |
| 탭 3개 | 가동 중인 봇 / 시그널 & 체결내역 / 업비트 API 연결 | 봇 개수 실제 |
| 총 손익 카드 | 대형 숫자 + 칩 2개 + 파란 배너 | 실현+미실현 손익, 예산 대비 %, 오늘 체결 수, 할당 예산, 가동 봇 수 |
| 봇 만들기 배너 | 그대로 | — |
| 봇 카드 | 아이콘, 이름, 심볼칩, 현재가, 전략명, 큰 On/Off 스위치, 전략 설명 박스, 통계 3칸, 최근 신호 | 현재가(WS), 예산, 오늘 체결, 누적 수익률, 최근 신호/시각, PAPER/LIVE 배지 |
| FAQ 카드 | 그대로 | 문구를 실제 동작에 맞게 수정(§46) |
| 시그널 & 체결 탭 | 영수증형 리스트 | DB의 실제 체결(Trade) + 시그널(Signal) |
| 업비트 API 탭 | 연결 카드, 잔고 2칸, 보안 안내, 버튼 2개 | 실제 연결/권한/마스킹 키/잔고/평가금/마지막 수신 시각, 실제 연결 테스트, 실제 Key 변경 |
| 봇 만들기 모달 | 1~4단계 + 시작 버튼 | 실제 KRW 마켓 목록/현재가, 전략 세부설정(접이식), 서버 검증 후 생성 |
| 토스트 | 그대로 | 서버 응답 기반 메시지 |

추가 UI(디자인 언어 동일하게 최소 추가): "모든 자동매매 멈추기" 카드, LIVE 전환 확인창, API Key 입력 모달, 전략 세부설정 접이식 영역.

## C. 실제 API로 교체할 하드코딩 데이터

| 원본 하드코딩 | 교체 |
|---|---|
| `bots` useState 4개 | `GET /api/bots` (DB) |
| `logs` useState 5개 | `GET /api/trades`, `GET /api/signals` (DB) |
| 현재가 132450000 / 3420 / 4850000 / 284500 / 295 | 업비트 ticker WebSocket → 서버 캐시 → SSE |
| (+13.8%) / +552,000원 / +18.4% / +24.6% / 14회 | Trade·Position에서 계산 |
| 4,820,000원 / 7,500,000원 | `GET /v1/accounts` + `myAsset` |
| Access Key: ****38fa | 실제 Key 앞4·뒤4만 마스킹 표시 |
| "핑 테스트 성공: 14ms" | `POST /api/connection/test` 실제 결과 |
| "24시간 자동 감시 중" | 시스템 상태 모델 |
| 모달 코인 4개 + 가격 | `GET /v1/market/all` + `GET /v1/ticker/all?quote_currencies=KRW` |

## D. Backend 구조 — 왜 필요한가

1. **Secret Key 보호**: 브라우저에 Secret Key가 있으면 개발자도구로 누구나 볼 수 있습니다. JWT 서명은 서버에서만 합니다.
2. **24시간 동작**: 브라우저 탭을 닫아도 전략 감시·주문 추적이 계속되어야 합니다.
3. **상태 영속성/복구**: 주문·체결·포지션은 DB에 저장하고, 재시작 시 업비트 실제 상태와 대조합니다.
4. **Rate Limit 관리**: 모든 업비트 호출을 한 곳에서 제어해야 초과/차단(418)을 막을 수 있습니다.

역할: Upbit REST/WS 통신, JWT 인증, 전략 실행, 주문 생성/취소/조회, 체결 추적, 포지션·손익, DB, 봇 상태, 재시작 복구, 로그, 안전장치.
서버는 기본적으로 `127.0.0.1`에만 바인딩합니다(외부 접속 차단).

## E. Database 구조 (SQLite → PostgreSQL 이전 용이하게)

- 엔진: Node 24 내장 `node:sqlite` (네이티브 빌드 불필요). 모든 SQL은 `server/db/`의 Repository에만 존재 → DB 교체 시 그 폴더만 수정.
- 금액/수량은 **TEXT(10진 문자열)** 로 저장하고 계산은 `decimal.js` 사용(부동소수 오차 방지).

| 테이블 | 주요 컬럼 |
|---|---|
| `bots` | id, name, display_name, market_code, display_symbol, coin_name, strategy, strategy_config(JSON), budget_krw, take_profit_percent, stop_loss_percent, active, mode(PAPER/LIVE), strategy_state(JSON), last_signal_text, last_signal_at, created_at, updated_at, deleted_at |
| `orders` | id, bot_id, identifier(UNIQUE), upbit_uuid, market_code, side(bid/ask), ord_type, price, volume, executed_volume, remaining_volume, average_price, executed_funds, paid_fee, state(내부 상태), upbit_state, purpose(ENTRY/EXIT/GRID_BUY/GRID_SELL/STOP_LOSS/TAKE_PROFIT), grid_level_id, reason, strategy_signal_id, mode, error_code, error_message, created_at, updated_at |
| `trades` | id, bot_id, order_id, upbit_trade_uuid(UNIQUE), market_code, side, price, volume, funds, fee, realized_pnl, mode, timestamp |
| `signals` | id, bot_id, market_code, strategy, signal_type(BUY/SELL/INFO), signal_value, reason, acted(주문 연결 여부), order_id, timestamp |
| `positions` | bot_id+market_code(PK), quantity, average_entry_price, total_cost, realized_pnl, updated_at (현재가/미실현은 조회 시 계산) |
| `system_settings` | key, value (emergency_stop, paper_krw_balance, live_enabled 등) |
| `api_credentials` | id, access_key, secret_key_enc(AES-256-GCM), iv, tag, created_at, active |
| `event_logs` | id, tag([ORDER] 등), message, data(JSON), created_at |

## F. Upbit REST API (공식 OpenAPI 기준, Base `https://api.upbit.com`)

| 용도 | Method / Path | 권한 | Rate Limit 그룹 |
|---|---|---|---|
| 페어 목록 | GET `/v1/market/all?is_details=true` | 공개 | market 10/s (IP) |
| 현재가(페어) | GET `/v1/ticker?markets=` | 공개 | ticker 10/s |
| 현재가(마켓 전체) | GET `/v1/ticker/all?quote_currencies=KRW` | 공개 | ticker |
| 분 캔들 | GET `/v1/candles/minutes/{unit}` (1,3,5,10,15,30,60,240) | 공개 | candle 10/s |
| 일 캔들 | GET `/v1/candles/days` | 공개 | candle |
| 최근 체결 | GET `/v1/trades/ticks` | 공개 | trade |
| 호가 | GET `/v1/orderbook?markets=` | 공개 | orderbook |
| 호가 정책(tick_size) | GET `/v1/orderbook/instruments?markets=` | 공개 | orderbook |
| 포켓 잔고 | GET `/v1/accounts` | 자산조회 | default 30/s (포켓) |
| 주문 가능 정보 | GET `/v1/orders/chance?market=` | 주문조회 | default |
| 주문 생성 | POST `/v1/orders` | 주문하기 | order 12/s |
| 주문 생성 테스트 | POST `/v1/orders/test` | 주문하기 | order-test 8/s |
| 개별 주문 조회 | GET `/v1/order?uuid=|identifier=` | 주문조회 | default |
| id로 주문 목록 | GET `/v1/orders/uuids?uuids[]=|identifiers[]=` | 주문조회 | default |
| 체결 대기 주문 | GET `/v1/orders/open?states[]=wait&states[]=watch` | 주문조회 | default |
| 종료 주문 | GET `/v1/orders/closed` | 주문조회 | default |
| 개별 취소 | DELETE `/v1/order?uuid=|identifier=` | 주문하기 | default |
| id로 목록 취소(최대 20) | DELETE `/v1/orders/uuids` | 주문하기 | default |
| API Key 목록(만료일) | GET `/v1/api_keys` | (권한 무관) | default |

인증: JWT(HS512), payload `{access_key, nonce(uuid), query_hash(SHA512 hex), query_hash_alg:"SHA512"}`.
GET/DELETE는 **URL 인코딩 전** 쿼리 문자열을 그대로 해시, 배열은 `key[]=a&key[]=b`. POST는 JSON 본문을 `k=v&...` 로 변환해 해시.
잔여 요청: 응답 헤더 `Remaining-Req: group=...; min=...; sec=N` (min은 deprecated). 429 → 다음 초까지 대기, 418 → 차단 시간 후 재시도.

**구현하지 않는 것**: 출금/입금/포켓 이전 API 전체 (출금 기능 없음 — 보안 원칙 §7).

## G. Upbit WebSocket

| 연결 | URL | 구독 |
|---|---|---|
| Public (1개) | `wss://api.upbit.com/websocket/v1` | `ticker`(봇 마켓 + 화면 마켓), `trade`(Paper 체결 시뮬레이션용), `candle.{1m..240m}`(전략용) |
| Private (1개) | `wss://api.upbit.com/websocket/v1/private` + `Authorization: Bearer JWT` | `myOrder`, `myAsset` (한 연결에서 함께 구독) |

- 요청 형식: `[{"ticket":uuid},{"type":"ticker","codes":[...]},...,{"format":"DEFAULT"}]`
- 구독 변경 시 새 연결 없이 새 구독 메시지 전송(이전 구독 대체) — 메시지 한도 5/s, 100/min 준수 위해 디바운스.
- 연결 유지: 120초 idle 종료 → 30초마다 ping 프레임, 응답 없으면 재연결.
- 재연결: 지수 백오프(1s→2s→4s… 최대 60s) + 지터, 연결 시도 5/s 한도 내. 인증 실패(INVALID_AUTH)는 즉시 재시도하지 않고 상태를 "인증 실패"로 표시.
- myAsset은 최초 구독 후 수분간 지연될 수 있다고 문서에 명시 → REST `/v1/accounts` 주기 동기화(60s)로 보완.
- myOrder는 연결이 끊긴 사이 이벤트가 유실될 수 있음 → 재연결 직후 REST로 미체결 주문 재조회.

## H. Strategy Engine 구조

```
실시간 데이터(ticker/candle/trade) → MarketDataService(캐시, 캔들 확정 판단)
 → BotEngine(봇별 Strategy 인스턴스 호출)
 → Strategy.evaluate(context) → Signal[] (사람이 읽는 reason 포함)
 → RiskManager(긴급정지/봇 ON/예산/잔고/중복/최소금액/가격단위)
 → OrderService.place() → Executor(Paper|Live)
 → 주문 추적(myOrder / REST / Paper 시뮬레이터) → Trade 기록
 → PositionService(평단/실현손익) → SSE로 UI 반영
```

공통 인터페이스 (`server/strategies/types.ts`):

```ts
interface Strategy {
  readonly kind: StrategyKind;
  requiredCandleUnit(): CandleUnit | null;
  initialize(ctx): void;            // 캔들 히스토리 로드 후
  onTicker(ctx, price): Signal[];   // 실시간 가격
  onCandleClose(ctx, candle): Signal[]; // 확정 캔들 (재도장 방지)
  onOrderUpdate(ctx, order): void;  // 체결/취소 반영 (그리드 레벨 상태 등)
  validateConfig(config): string[]; // 설정 검증
}
```

- 전략 상태(그리드 레벨, RSI 진입 횟수, 마지막 교차 등)는 `bots.strategy_state`에 JSON으로 저장 → 재시작 후 이어서 동작.
- 기본값은 `server/config/strategyDefaults.ts` 한 곳에서 관리, 봇 생성 시 사용자의 값으로 덮어써 봇별 저장.
- 익절/손절(`riskExit`)은 모든 전략 공통 모듈.

### 전략별 정의
- **Grid**: 기준가(생성 시 현재가) 아래로 `spacingPercent` 간격의 매수 레벨 `levels`개. 가격이 레벨에 닿으면 그 레벨 가격으로 지정가 매수(레벨당 `orderKRW`). 매수 체결 시 `체결가 × (1 + 익절%)` 지정가 매도. 매도 체결 시 레벨 재사용(재진입 쿨다운 `reentryCooldownSec`). 레벨마다 `gridLevelId`(`L0`,`L1`…)로 **활성 주문 1개만** 허용.
- **RSI**: 확정 캔들 기준 RSI(Wilder, period 14). RSI가 과매도선을 **하향 돌파한 순간**만 분할 매수(`orderKRW = 예산 × splitRatio`), 최대 `maxEntries`회, 다시 과매도선 위로 올라가야 다음 진입 가능(재무장). RSI ≥ 과매수선이면 전량 매도.
- **Golden Cross**: 확정 캔들 기준 MA(short=5, long=20). `이전 short ≤ long` 이고 `현재 short > long`인 **교차 이벤트**에서만 매수(포지션 없을 때 1회). 데드크로스 이벤트에서 전량 매도.
- **익절/손절(공통)**: 기준 = 포지션 평균 매입단가(**매수 수수료 포함** 총비용 ÷ 수량). 현재가 기준 수익률 ≥ 익절% → 시장가 매도, ≤ −손절% → 시장가 매도. 매도 전 보유수량·주문가능수량 재확인. 그리드는 레벨별 익절을 쓰고 공통 모듈은 손절만 적용.

## I. 안전장치

| 장치 | 구현 |
|---|---|
| PAPER 기본값 | 새 봇은 항상 PAPER. 서버 최초 실행 시 LIVE 비활성 |
| LIVE 하드락 | `.env`의 `LIVE_TRADING_HARD_LOCK=true`(기본)면 LIVE 주문 코드 경로 자체가 막힘. 사용자가 직접 false로 바꿔야 함 |
| LIVE 전환 확인 | 체크리스트(§75) 전부 통과 + "지금부터 실제 업비트 계좌에서 주문이 실행됩니다." 확인창 + 확인 문구 입력 |
| 긴급 전체 정지 | 모든 봇 OFF, 신규 주문 차단 플래그(DB 저장), 봇이 만든 미체결 주문만 취소, 보유 코인 매도 안 함 |
| 개별 봇 OFF | 해당 봇 신규 주문 금지 + 해당 봇 identifier의 미체결 주문만 취소, 보유 코인 매도 안 함 |
| 중복 주문 방지 | (botId, purpose, gridLevelId/signalKey) 활성 주문 존재 시 거부 + 시그널 이벤트 1회성(교차/재무장) + 주문 진행 중 락(in-flight) + identifier 유일성 |
| 예산 | 봇 사용액(포지션 원가 + 미체결 매수 잠금액) + 이번 주문(+수수료) ≤ 예산, 그리고 계좌 주문가능 KRW 확인 |
| 주문 전 검증 | 마켓 존재/거래가능(경고 종목 포함 표시), ord_type 조합, 가격 단위, 수량 소수 자릿수, 최소 주문 5,000원(`/orders/chance`의 min_total 우선), 최대 주문(max_total) |
| 네트워크 오류 | 주문 응답 유실 시 `GET /v1/order?identifier=`로 생성 여부 확인 후 상태 결정(UNKNOWN → 확정) |
| Rate Limit | 그룹별 토큰버킷 + Remaining-Req 반영 + 429/418 백오프 |
| 비밀정보 | Secret Key는 서버 메모리/암호화 DB/.env에만. API 응답·로그에 절대 포함 안 함(로거에서 키 패턴 마스킹) |

## J. 구현 순서

1. PHASE 1 — 분석, 본 문서, 패키지/구조 결정, UI 원본 복원 및 실행 확인
2. PHASE 2 — Public REST(마켓/현재가/캔들/호가정책), JWT, `/v1/accounts`(KRW·보유코인)
3. PHASE 3 — Public WS(ticker/trade/candle), Private WS(myOrder/myAsset), 재연결
4. PHASE 4 — 주문 인프라: 검증, `/orders/chance`, identifier, `/orders/test`, 조회, 취소, 체결 추적
5. PHASE 5 — Paper Trading(가상 주문/체결/포지션/손익)
6. PHASE 6 — Grid · PHASE 7 — RSI · PHASE 8 — Golden Cross
7. PHASE 9 — Risk(예산/중복/익절/손절/전체정지/봇 OFF)
8. PHASE 10 — LIVE (체크리스트 통과 + 하드락 해제 + 확인창 후에만)

## K. 테스트 계획

- **Unit (vitest)**: market code 변환, tick size/가격 보정, 수량 보정, 최소금액·예산 검증, RSI·MA, 그리드 레벨 계산, 익절/손절 조건, 중복 주문 방지, identifier 생성/파싱, JWT·query_hash, Paper 체결 시뮬레이터, 포지션 평단/실현손익.
- **Integration**: 공개 API 실제 호출(인증 없이), WS 연결 후 ticker 수신(`RUN_NETWORK_TESTS=1`일 때만). Private(잔고/주문가능/주문테스트/조회/취소/myOrder/myAsset)는 `.env`에 Key가 있을 때만 실행하며, **주문 생성은 `/v1/orders/test`만 사용**(실주문 없음).
- **실거래 전 안전검증**: Paper 모드로 최소 수일 운용 → 체결/손익 수기 대조 → 재시작 복구 테스트(서버 강제 종료 후 재기동) → 긴급정지 테스트 → 체크리스트 통과 확인 → 소액 LIVE.
