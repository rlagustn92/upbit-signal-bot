# PROGRESS.md — 작업 진행 기록 (재개 시 이 파일부터 읽기)

Node 경로(포터블): `%LOCALAPPDATA%\node-portable\node-v24.21.0-win-x64`
bash에서: `export PATH="$LOCALAPPDATA/node-portable/node-v24.21.0-win-x64:$PATH"` (Git Bash 기준)
실행: `npm run dev` (scripts/dev.mjs가 tsx watch 백엔드 + vite 프론트를 함께 띄움) → http://localhost:5173
미리보기 설정: `.claude/launch.json` (이름 `upbit-bot`)

## 체크리스트
- [x] PHASE 1: 분석(빈 폴더였음), 업비트 문서 수집(docs/), IMPLEMENTATION_PLAN.md, docs/REQUIREMENTS.md(지시서 요약)
- [x] 스캐폴딩: Vite + React 19 + TS 7 + Tailwind v4 / Express 5 + ws + node:sqlite + decimal.js / vitest
- [x] PHASE 2: Public REST + JWT(HS512) + accounts — 공개 API 실호출 확인
- [x] PHASE 3: Public WS(ticker/trade/candle) + Private WS(myOrder+myAsset 1연결) + 재연결/백오프/ping — public 실수신 확인
- [x] PHASE 4: 주문 인프라(검증·identifier·주문테스트 API·조회·취소·체결추적·UNKNOWN 복구)
- [x] PHASE 5: Paper Trading(가상 주문/체결/포지션/손익/가상잔고)
- [x] PHASE 6~8: Grid / RSI / Golden Cross
- [x] PHASE 9: Risk(예산/중복/익절/손절/긴급정지/봇OFF, 손절 후 봇 자동 OFF)
- [x] Frontend 실제 데이터 연결(SSE 실시간), 원본 디자인 유지
- [x] 테스트: 단위 67 + PAPER 통합 8 + 업비트 네트워크(공개 5, Key 있을 때 private 5)
- [x] README
- [x] PHASE 10: LIVE 코드 경로(LiveExecutor) — **하드락 ON 기본, 사용자가 .env + 체크리스트 + 확인창을 거쳐야만 활성**
- [x] QA 1차(서브에이전트) 피드백 반영 — CRASH 1건 + MAJOR 11건 + 주요 MINOR 수정, 회귀 테스트 tests/integration/qaRegression.test.ts
- [x] 재시작 복구 실검증(서버 종료→재기동 후 봇/포지션/미체결/모의잔고 동일)
- [x] QA 2차 반영 — LIVE 접수 후 실패→UNKNOWN, 손절 재시도 15초 고정, 수수료 포함 최소금액, 모의 잔량 정리, 삭제 흐름, 고아 주문, crash.log, UI 다듬기
- [x] 실전형 전략 강화 — RSI 반등 확인+EMA200 추세 필터 / 골든크로스 EMA+거래량 확인+ATR 손절+트레일링 / 그리드 ATR 간격+하락장 매수 멈춤 / 공통: 하루 최대 손실, 손실 후 쉬는 시간 / OHLCV 캔들 + 히스토리 페이지 조회
- [x] 딸깍 실행 bat (start.bat, start-24h.bat, autostart-*.bat, connect-cloud.bat — CP949+CRLF로 저장해야 cmd에서 안 깨짐)
- [x] 24시간 무료 운영 안내 docs/DEPLOY.md + 오라클 클라우드 설치 스크립트 deploy/oracle/setup.sh(systemd)
- [x] GitHub 공개: https://github.com/rlagustn92/upbit-signal-bot (main = 개인정보 없는 새 이력, 로컬 `local-history` 브랜치는 이전 이력 — 절대 push 금지)
- [x] 폰 접속: Tailscale(*.ts.net Host 허용, 서버는 127.0.0.1 유지) + phone-on.bat / phone-off.bat, docs/PHONE.md
- [x] 백테스트: server/backtest/(history 캐시 + simulator가 실제 전략 코드 재사용) + POST /api/backtest + 봇 만들기 화면 "과거로 미리 테스트" + `npm run backtest`. 기본 코인 BTC/ETH/XRP
- [x] 전략 연구(scripts/research.ts, docs/RESEARCH.md) → 4번째 전략 "볼린저 반등"(server/strategies/bollinger.ts) 추가. 연구 도구의 지정가 같은 캔들 익절 편향 버그 수정함

## Git 운영 메모
- 공개 브랜치: `main` → origin. 커밋 작성자는 GitHub noreply 이메일(로컬 git config에 설정됨)
- `local-history`: 공개 전 이력(개인 이메일, 업비트 문서 사본 포함) — push하지 말 것
- 로컬 전용(gitignore): `.env`, `data/`, `.claude/`, `docs/upbit-reference/`, `docs/upbit-openapi-summary.txt`, `cloud-connect.cfg`

## QA 1차에서 고친 것 (2026-10-03)
- CRASH: 전략명 "constructor" 등 프로토타입 키 → 서버 다운 (isStrategyKind로 차단, 스냅샷 타이머 보호)
- M1 LIVE 5xx 응답을 거절로 단정 → UNKNOWN + identifier로 확인(중복 실주문 방지)
- M2 LIVE 체결 목록 조회 실패 시 포지션 누락 → 기록된 체결만큼만 인정 + 동기화가 보충
- M3 봇 중복 시작/동시 주문 경쟁 → startBot 멱등 + 봇별 주문 락 + 기록 직전 재확인
- M4 체결·포지션·모의잔고 비원자적 → 트랜잭션
- M5 캔들 공백 위에서 지표 계산 → 오래된 캐시 재로드, 공백 감지 시 재로드 후 판단
- M6 그리드 기준가 고정 → 켤 때(보유 없음) 재설정, 호가 단위보다 작은 간격/익절/손절 거부
- M7 RSI 기본값 3회차 예산 초과 → 0.33, 비율×횟수 ≤100% 검증 / 그리드 칸금액×칸수 ≤ 예산
- M8 모의 코인 보유 봇 삭제 시 가상 자산 증발 → 삭제 차단 + "모의 코인 팔기", 모의 초기화 시 포지션도 초기화
- M9 예산만 수정 시 검증 생략 → 항상 재검증
- M10 하드락 오타 시 해제 → 정확히 false/0일 때만 해제
- M11 봇 OFF/긴급정지 중 손절 미작동 안내 추가
- MINOR: 시그널 문구 가격=실제 주문 가격, 잘못된 JSON→JSON 오류, WS 메시지 처리 try/catch, Host 검사, 삭제된 봇 체결 이름 유지, 탭 "활성/전체", 봇 #번호, 모의 지갑 총액, 모달 Esc/바깥클릭 닫기, 숫자 입력 개선, 봇별 대기 주문 보기

## 남은 개선 후보
- 헤드라인 수익률에 PAPER/LIVE가 섞임(LIVE 사용 시 분리 표시 필요)
- 실전 체크리스트의 '내장 기능' 항목은 자동 테스트 기반 자기 확인(ok 고정)
- PAPER 체결의 호가 잔량 미반영

## 아직 실제와 연결되지 않은/검증 못 한 부분 (정직하게)
- **API Key가 없어서** Private REST(잔고/주문가능정보/주문테스트)와 Private WS(myOrder/myAsset)는 실제 계정으로 검증하지 못함. 코드는 공식 문서대로 구현, 단위테스트로 JWT/쿼리해시 검증. 사용자가 Key 등록 후 "연결 상태 테스트" + `npm run test:network` 로 확인 필요.
- LIVE 주문 생성/취소는 한 번도 실제로 호출하지 않음(의도적). LiveExecutor 경로는 코드 리뷰 + 타입 검사만.
- PAPER 체결은 근사치: 시장가 = 최근 체결가 ±0.05% 미끄러짐, 지정가 = 체결가가 닿으면 지정가로 전량 체결(호가 잔량 미반영).
- 일봉(1d) 전략은 WS 미지원이라 REST 60초 폴링.
- 지원 마켓: 원화(KRW) 마켓만.

## 주요 설계 결정 (사용자 확인 없이 정한 것)
- 봇별 mode(PAPER/LIVE). 새 봇은 항상 PAPER. LIVE 전환은 봇 OFF + 포지션 0 + 실전 허용 상태에서만.
- PAPER identifier는 `PBOT-`, LIVE는 `BOT-{botId}-{ts36}-{rand6}` (최대 64자).
- 손절 기준 = 평균 매입가(매수 수수료 포함). 손절 체결 시 봇 자동 OFF(재매수 방지).
- 그리드: 기준가(봇 켤 때 현재가) 아래로 간격% 칸. 칸당 1주문. 비어 있을 때 2칸 이상 오르면 기준가 이동.
- RSI: 과매도선 하향 돌파 순간만 진입, 위로 올라와야 재무장. 시작 시 이미 과매도면 대기.
- 실전 체크리스트의 "출금 권한 꺼짐"은 API로 확인 불가 → 사용자 체크박스로 확인.
- 서버는 127.0.0.1 바인딩, 상태 변경 API는 `X-Requested-With: upbit-bot` 헤더 필수, 외부 Origin 거부.

## 작업 로그
### 2026-10-03
- 폴더가 비어 있고 Node 미설치 → 포터블 Node 24 LTS 설치(SHA256 검증)
- 업비트 공식 문서 47개 페이지 사본 저장 및 OpenAPI 요약 생성
- 백엔드/프론트/테스트/README 초판 완성, 실시간 시세로 PAPER 봇 3개 구동 확인
- 통합 테스트로 결함 발견·수정: 손절 직후 그리드가 하락 중 즉시 재매수 → 손절 체결 시 봇 자동 OFF
