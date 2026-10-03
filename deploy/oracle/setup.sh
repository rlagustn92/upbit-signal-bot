#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# 오라클 클라우드(Ubuntu 22.04/24.04, ARM/x86) 설치 스크립트
#   사용법(서버에 SSH로 접속한 뒤):
#     curl -fsSL https://raw.githubusercontent.com/<계정>/<저장소>/main/deploy/oracle/setup.sh -o setup.sh
#     bash setup.sh https://github.com/<계정>/<저장소>.git
#   하는 일: Node.js 24 설치 → 코드 받기 → 패키지 설치/빌드 → .env 생성(모의투자·실전 잠금) → 자동 실행 서비스 등록
#   보안: 서버는 127.0.0.1 에만 열립니다. 화면은 SSH 터널(connect-cloud.bat)로만 접속하세요. 방화벽 포트를 열지 마세요.
# ─────────────────────────────────────────────────────────────
set -euo pipefail

REPO_URL="${1:-}"
APP_DIR="${APP_DIR:-$HOME/coin-bot}"
SERVICE=coin-bot

if [[ -z "$REPO_URL" && ! -d "$APP_DIR/.git" ]]; then
  echo "사용법: bash setup.sh <git 저장소 주소>" >&2
  exit 1
fi

echo "▶ 1/5 Node.js 24 설치"
if ! command -v node >/dev/null || [[ "$(node -v | cut -d. -f1)" != "v24" ]]; then
  curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
  sudo apt-get install -y nodejs git
fi
node -v

echo "▶ 2/5 코드 받기 ($APP_DIR)"
if [[ -d "$APP_DIR/.git" ]]; then
  git -C "$APP_DIR" pull --ff-only
else
  git clone "$REPO_URL" "$APP_DIR"
fi
cd "$APP_DIR"

echo "▶ 3/5 패키지 설치 + 화면 빌드"
npm ci
npm run build

echo "▶ 4/5 설정 파일(.env)"
if [[ ! -f .env ]]; then
  cp .env.example .env
  chmod 600 .env
  echo "  .env 를 만들었어요 (모의투자 전용, LIVE_TRADING_HARD_LOCK=true)."
fi
mkdir -p data && chmod 700 data

echo "▶ 5/5 자동 실행 서비스 등록 (부팅 시 시작, 죽으면 자동 재시작)"
sudo tee /etc/systemd/system/$SERVICE.service >/dev/null <<UNIT
[Unit]
Description=Coin Signal Bot (Upbit)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$USER
WorkingDirectory=$APP_DIR
Environment=NODE_ENV=production
ExecStart=$(command -v node) $APP_DIR/node_modules/tsx/dist/cli.mjs server/index.ts
Restart=always
RestartSec=10
# 같은 1시간 안에 너무 자주 죽으면 멈추고 사람이 확인
StartLimitIntervalSec=3600
StartLimitBurst=20

[Install]
WantedBy=multi-user.target
UNIT
sudo systemctl daemon-reload
sudo systemctl enable --now $SERVICE
sleep 3
systemctl --no-pager status $SERVICE | head -n 8 || true

PUBIP=$(curl -fsS https://ifconfig.me 2>/dev/null || echo "알 수 없음")
cat <<DONE

✅ 설치 완료
 - 서버 공인 IP: $PUBIP   ← 업비트 Open API 관리에서 이 IP를 '허용 IP'로 등록하세요
 - 상태 보기:   systemctl status $SERVICE
 - 로그 보기:   journalctl -u $SERVICE -f     (파일: $APP_DIR/data/logs/)
 - 업데이트:    cd $APP_DIR && git pull && npm ci && npm run build && sudo systemctl restart $SERVICE
 - 화면 접속:   내 PC에서 connect-cloud.bat 실행 (SSH 터널) → http://127.0.0.1:8787
DONE
