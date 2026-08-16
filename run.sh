#!/bin/zsh
# 자동 실행용 래퍼: watch-alert 디렉토리에서 index.js 실행, 로그 남김.
cd "$(dirname "$0")" || exit 1
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
echo "===== $(date '+%Y-%m-%d %H:%M:%S') 실행 시작 =====" >> data/run.log
/opt/homebrew/bin/node index.js >> data/run.log 2>&1
echo "----- 종료 (exit $?) -----" >> data/run.log
