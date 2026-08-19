#!/bin/zsh
# 맥 자동 실행용: 로그인 필요한 2곳(시계거래소·타임포럼)만 담당.
# 결과는 snapshot.local.json 으로 올려, 대시보드가 클라우드 6곳과 합쳐서 보여준다.
cd "$(dirname "$0")" || exit 1
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
echo "===== $(date '+%Y-%m-%d %H:%M:%S') (로컬:로그인2곳) 시작 =====" >> data/run.log
CONFIG=config.local.json SEEN_FILE=seen.login.json SNAPSHOT_FILE=snapshot.local.json \
  /opt/homebrew/bin/node index.js >> data/run.log 2>&1
echo "----- 종료 (exit $?) -----" >> data/run.log

# 로컬 스냅샷을 GitHub에 push(폰 대시보드에 시계거래소 반영). 먼저 커밋→pull→push 순.
if git remote get-url origin >/dev/null 2>&1; then
  git add docs/snapshot.local.json >> data/run.log 2>&1
  git commit -m "chore: local snapshot $(date '+%Y-%m-%d %H:%M')" >> data/run.log 2>&1
  # --autostash: 추적 파일에 딴 변경이 있어도 rebase가 안 막히게(과거 push 실패 원인)
  git pull --rebase --autostash -X ours >> data/run.log 2>&1
  git push >> data/run.log 2>&1
fi
