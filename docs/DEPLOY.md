# 24시간 무료로 돌리기

봇은 **프로그램(서버)이 켜져 있는 동안에만** 동작합니다. 무료로 24시간 돌리는 방법은 두 가지예요.

| | ① 내 PC 상시 실행 | ② 오라클 클라우드 무료 서버 (추천) |
|---|---|---|
| 비용 | 무료(전기료) | 무료(Always Free) |
| PC를 꺼도 동작 | ❌ | ✅ |
| 업비트 허용 IP | 집 IP가 바뀌면 다시 등록해야 함 | 고정 IP라 한 번만 등록 |
| 난이도 | 쉬움 (bat 더블클릭) | 보통 (가입·서버 만들기 20~30분) |

> ❓ **Streamlit / GitHub로는 안 되나요?**
> - GitHub는 코드 보관용이라 프로그램을 계속 실행해 주지 않아요. (GitHub Actions는 장시간 상시 실행 용도가 아님)
> - Streamlit Community Cloud는 접속이 없으면 앱이 잠들고, 재시작하면 저장소(DB)가 초기화되며, 서버 IP가 고정되지 않아 업비트 허용 IP 등록이 불가능해요. 또 Python 전용이에요.
> - Vercel/Netlify 같은 웹 호스팅도 "요청이 올 때만 잠깐 실행"이라 24시간 감시가 안 돼요.

---

## ① 내 PC로 24시간 돌리기

1. `start-24h.bat` 더블클릭 → 화면 http://127.0.0.1:8787
2. 윈도우를 켤 때 자동으로 시작하려면 `autostart-install.bat` 한 번 실행 (해제: `autostart-remove.bat`)
3. **절전 모드 끄기**: 설정 → 시스템 → 전원 → "화면 및 절전" → *절전 모드 전환: 안 함* (화면 끄기는 괜찮아요)
4. 업비트 API Key의 허용 IP에 **집 공인 IP**를 등록 (네이버에 "내 IP" 검색). 공유기를 재시작하면 바뀔 수 있어요.

서버가 예기치 않게 죽으면 `scripts/start.mjs`가 자동으로 다시 켜고, 재시작 복구가 봇/주문 상태를 맞춥니다.

---

## ② 오라클 클라우드 무료 서버로 돌리기

### 1. 가입 (10분)
1. https://www.oracle.com/kr/cloud/free/ → **무료로 시작하기**
2. **홈 리전은 `South Korea Central (Seoul)` 또는 `South Korea North (Chuncheon)`** 선택 — 나중에 못 바꿔요. (한국 리전이 업비트와 가까워요)
3. 카드 인증(소액 승인 후 취소)만 하고 과금되지 않아요. Always Free 범위만 쓰면 무료예요.

### 2. 서버(인스턴스) 만들기
1. 메뉴 → 컴퓨트 → 인스턴스 → **인스턴스 생성**
2. 이미지: **Ubuntu 24.04** (또는 22.04)
3. 구성(Shape): **Ampere A1 Flex** — OCPU 1, 메모리 6GB면 충분 (Always Free: 최대 4 OCPU / 24GB)
   - A1 재고가 없으면 `VM.Standard.E2.1.Micro`(AMD, 무료)도 가능하지만 메모리가 1GB라 빌드가 느려요.
4. **SSH 키 추가 → 개인 키 저장**(예: `C:\keys\oracle.key`). 잃어버리면 접속 못 해요.
5. 생성 후 **공인 IP 주소**를 메모. (네트워킹에서 "예약된 공인 IP"로 바꾸면 영구 고정)

### 3. 설치 (5분)
PowerShell에서 서버 접속:
```powershell
ssh -i C:\keys\oracle.key ubuntu@<서버 공인 IP>
```
서버에서 (저장소 주소는 본인 GitHub 주소로):
```bash
curl -fsSL https://raw.githubusercontent.com/rlagustn92/upbit-signal-bot/main/deploy/oracle/setup.sh -o setup.sh
bash setup.sh https://github.com/rlagustn92/upbit-signal-bot.git
```
끝나면 서버 공인 IP가 출력돼요 → **업비트 Open API 관리에서 그 IP를 허용 IP로 등록**.

### 4. 화면 보기 (내 PC)
`connect-cloud.bat` 더블클릭 → 처음 한 번 서버 IP와 키 파일 경로 입력 → 브라우저가 http://127.0.0.1:8787 로 열려요.
- SSH 터널로 접속하므로 **서버 포트를 인터넷에 열 필요가 없어요(열지 마세요).** 봇 화면에는 매매 버튼이 있어서 공개되면 위험해요.
- 창을 닫아도 봇은 서버에서 계속 돌아가요.

### 5. 관리 명령 (서버에서)
| 하고 싶은 것 | 명령 |
|---|---|
| 상태 보기 | `systemctl status coin-bot` |
| 실시간 로그 | `journalctl -u coin-bot -f` |
| 재시작 | `sudo systemctl restart coin-bot` |
| 멈추기 | `sudo systemctl stop coin-bot` |
| 새 버전 받기 | `cd ~/coin-bot && git pull && npm ci && npm run build && sudo systemctl restart coin-bot` |
| API Key/설정 | 화면의 "API Key 등록"(암호화 저장) 또는 `nano ~/coin-bot/.env` |

### ⚠ 알아둘 점
- 오라클은 Always Free 인스턴스가 **7일 동안 CPU·네트워크·메모리 사용률이 매우 낮으면 회수(정지)할 수 있다**고 안내해요. 이 봇은 가벼워서 해당될 수 있어요. 계정을 **종량제(Pay As You Go)로 업그레이드**하면 회수 대상에서 빠지고, Always Free 범위 안에서는 여전히 0원이에요. (업그레이드 후 유료 자원을 만들지 않도록 주의)
- 서버 시간대와 상관없이 "오늘 체결/하루 손실 한도"는 한국 시간 기준으로 계산돼요.
- 실전(LIVE)은 서버의 `.env`에서 `LIVE_TRADING_HARD_LOCK=false`로 직접 바꾸고 `sudo systemctl restart coin-bot` 해야만 풀려요.
