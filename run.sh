#!/bin/zsh
# 맥 자동 실행용: 로그인 필요한 2곳(시계거래소·타임포럼)만 담당.
# 나머지 6곳은 GitHub Actions(클라우드)가 처리하므로 여기선 제외 → 중복 알림 없음.
cd "$(dirname "$0")" || exit 1
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
echo "===== $(date '+%Y-%m-%d %H:%M:%S') (로컬:로그인2곳) 시작 =====" >> data/run.log
CONFIG=config.local.json SEEN_FILE=seen.login.json NO_SNAPSHOT=1 \
  /opt/homebrew/bin/node index.js >> data/run.log 2>&1
echo "----- 종료 (exit $?) -----" >> data/run.log
