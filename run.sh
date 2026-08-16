#!/bin/zsh
# 자동 실행용 래퍼: watch-alert 디렉토리에서 index.js 실행, 로그 남김.
cd "$(dirname "$0")" || exit 1
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
echo "===== $(date '+%Y-%m-%d %H:%M:%S') 실행 시작 =====" >> data/run.log
/opt/homebrew/bin/node index.js >> data/run.log 2>&1
code=$?
echo "----- 검색 종료 (exit $code) -----" >> data/run.log

# 대시보드 스냅샷을 GitHub에 push(폰에서 최신 유지). remote 없으면 조용히 skip.
if git remote get-url origin >/dev/null 2>&1; then
  git add docs/snapshot.json >> data/run.log 2>&1
  git commit -m "chore: snapshot $(date '+%Y-%m-%d %H:%M')" >> data/run.log 2>&1 && \
  git push >> data/run.log 2>&1
fi
