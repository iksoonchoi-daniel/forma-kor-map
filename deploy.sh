#!/usr/bin/env bash
# deploy.sh — VM 운영 배포 (daniel 전용)
#
# start.sh 와 목적이 반대다: 자동 pull 없음, --reload 없음, 테스트 통과가 조건.
# 한 스크립트로 합치면 개발 편의 동작(--reload, 자동 pull)이 운영 서버로 새어든다.
#
# 사용: /home/techteam/forma-code-review 에서 ./deploy.sh
# 전제: docs/superpowers/plans/2026-08-06-internal-server-deployment.md 의
#       Task 4~7 (서비스 계정·인증서·systemd·Caddy) 이 끝나 있을 것

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

AGENT_DIR="$ROOT/code-review-agent"
EXT_DIR="$ROOT/forma-code-review"
SERVER_URL="https://10.30.11.65:3501"
AGENT_URL="http://127.0.0.1:8501"

info() { printf '\033[1;34m▶ %s\033[0m\n' "$*"; }
ok()   { printf '\033[1;32m✓ %s\033[0m\n' "$*"; }
die()  { printf '\033[1;31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

# ── 1) 최신화 ────────────────────────────────────────────────────
info "저장소 최신화 (--ff-only)"
[ -z "$(git status --porcelain)" ] \
  || die "로컬에 커밋되지 않은 수정이 있습니다. git status 로 정리하세요."
git pull --ff-only || die "pull 실패 — 되감기가 필요한 상태입니다. 수동 확인하세요."
ok "$(git rev-parse --short HEAD) $(git log -1 --pretty=%s)"

# ── 2) 프런트 빌드 (제자리에서 dist 갱신) ────────────────────────
# 산출물을 다른 경로로 복사하지 않는다. 경로가 둘이면 어느 쪽이 최신인지
# 확인해야 하는 일이 생긴다. Caddy 가 이 dist 를 직접 서빙한다.
info "프런트 빌드"
( cd "$EXT_DIR" && npm ci && npm run build ) || die "프런트 빌드 실패 — 재시작하지 않았습니다."
[ -f "$EXT_DIR/dist/index.html" ] \
  || die "dist/index.html 이 없습니다. 빌드가 산출물을 만들지 못했습니다."
if grep -rq "$AGENT_URL" "$EXT_DIR/dist/"; then
  die "빌드에 개발용 기본 주소가 남아 있습니다 — .env.production 이 읽히지 않았습니다."
fi
ok "dist 갱신됨"

# ── 3) 백엔드 의존성 ─────────────────────────────────────────────
info "백엔드 의존성"
"$AGENT_DIR/venv/bin/pip" install --quiet -r "$AGENT_DIR/requirements.txt" \
  || die "pip 설치 실패."
ok "의존성 준비 완료"

# ── 4) 테스트 — 실패하면 여기서 멈춘다 ───────────────────────────
info "테스트"
( cd "$AGENT_DIR" && ./venv/bin/python -m pytest -q ) \
  || die "테스트 실패 — 서비스를 재시작하지 않았습니다. 이전 버전이 계속 돕니다."
ok "테스트 통과"

# ── 5) 재시작 ────────────────────────────────────────────────────
info "forma-code-review 재시작"
sudo systemctl restart forma-code-review
sleep 2
systemctl is-active --quiet forma-code-review \
  || die "기동 실패. journalctl -u forma-code-review -n 50 을 확인하세요."
ok "forma-code-review 동작 중"

# ── 6) 종단 확인 ─────────────────────────────────────────────────
info "종단 확인"
curl -fsS --max-time 5 "$AGENT_URL/docs" >/dev/null \
  || die "백엔드가 응답하지 않습니다."
# -k 로 확인한다. 여기서 보려는 것은 Caddy 가 살아 있는가이지 인증서 신뢰가 아니다.
# VM 의 트러스트 스토어 상태는 팀원 PC 와 무관하다.
#
# 응답 코드를 남긴다. 종전에는 그냥 죽어서 「Caddy 가 멈췄나 / 403 인가 /
# 인증서가 없나」가 구분되지 않았고, 그걸 갈라내는 데 왕복이 여러 번 들었다
# (2026-08-07). 실패한 자리에서 다음에 칠 명령까지 같이 낸다.
code=$(curl -k -sS -o /dev/null -w '%{http_code}' --max-time 5 "$SERVER_URL/" 2>/dev/null) \
  || code="연결실패"
case "$code" in
  200) ;;
  연결실패)
    die "Caddy 에 연결하지 못했습니다 ($SERVER_URL).
    사이트 블록이 이 IP 를 안 보거나 인증서 SAN 이 다릅니다:
      ip -4 addr show | grep inet
      grep -n '10\.30\.11' /etc/caddy/Caddyfile
      sudo openssl x509 -in /etc/forma/cert.pem -noout -ext subjectAltName
    IP 가 바뀐 것이면: ./change-ip.sh <새 IP>" ;;
  403)
    die "Caddy 가 403 을 돌려줍니다 — caddy 계정이 dist 를 못 읽습니다.
      sudo -u caddy test -r $EXT_DIR/dist/index.html && echo 읽기OK || echo 읽기불가
      namei -l $EXT_DIR/dist/index.html
    상위 디렉터리의 x 비트가 빠진 경우가 대부분입니다: sudo chmod o+x /home/techteam" ;;
  404)
    die "Caddy 가 404 를 돌려줍니다 — root 경로가 dist 를 가리키지 않습니다.
      grep -n 'root' /etc/caddy/Caddyfile
    이 배포의 dist 는 $EXT_DIR/dist 입니다." ;;
  *)
    die "Caddy 가 HTTP $code 를 돌려줍니다.
      sudo journalctl -u caddy -n 30 --no-pager" ;;
esac
ok "배포 완료 — 팀원은 브라우저 새로고침만 하면 됩니다"
