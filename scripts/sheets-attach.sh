#!/bin/zsh
# Google Sheets에 Local Agent 사이드바를 붙이거나 최신 화면으로 바꾼다 (macOS)
# 사용: zsh scripts/sheets-attach.sh <스프레드시트 주소 | new>
# 스프레드시트마다 Apps Script 프로젝트를 하나 만들고(clasp), 사이드바 화면을 올린 뒤 연결 키를 클립보드에 복사한다
[ -n "${ZSH_VERSION:-}" ] || { echo "zsh로 실행하세요: zsh scripts/sheets-attach.sh <주소>"; exit 1; }
set -e
ROOT="${0:A:h:h}"
CLASP=(npx --yes @google/clasp@3.4.1)
TARGET="${1:-}"
[[ -n "$TARGET" ]] || { echo "사용: zsh $0 <스프레드시트 주소 | new>"; exit 1; }
whence -p node >/dev/null || { echo "Node.js 20 이상이 필요합니다: https://nodejs.org"; exit 1; }
[[ -f "$HOME/.localxl/config.json" ]] || { echo "먼저 Local Agent를 설치하세요: zsh scripts/install.sh"; exit 1; }

# clasp은 처음 한 번 Google 로그인이 필요하다. Apps Script API도 켜야 한다: https://script.google.com/home/usersettings
if [[ ! -f "$HOME/.clasprc.json" ]]; then
  echo "Google 계정으로 clasp에 로그인합니다. 브라우저가 열리면 승인하세요."
  "${CLASP[@]}" login
fi

if [[ "$TARGET" == new ]]; then
  ID=""
else
  ID="$(node -e 'const m=/\/spreadsheets\/d\/([\w-]{20,})/.exec(process.argv[1])||/^([\w-]{20,})$/.exec(process.argv[1]);process.stdout.write(m?m[1]:"")' "$TARGET")"
  [[ -n "$ID" ]] || { echo "스프레드시트 주소를 알아보지 못했습니다: $TARGET"; exit 1; }
fi

DIR="$HOME/.localxl/sheets/${ID:-new-$(date +%Y%m%d%H%M%S)}"
mkdir -p "$DIR"; chmod 700 "$HOME/.localxl/sheets"
cd "$DIR"
if [[ ! -f .clasp.json ]]; then
  if [[ -n "$ID" ]]; then
    "${CLASP[@]}" create-script --type sheets --title "Local Agent" --parentId "$ID" --rootDir . >/dev/null
  else
    "${CLASP[@]}" create-script --type sheets --title "Local Agent 시트" --rootDir . >/dev/null
    ID="$(node -p 'require("./.clasp.json").parentId')"
    mv "$DIR" "$HOME/.localxl/sheets/$ID"; DIR="$HOME/.localxl/sheets/$ID"; cd "$DIR"
  fi
fi
node "$ROOT/scripts/build-sheets.mjs" "$DIR" >/dev/null
"${CLASP[@]}" push -f >/dev/null

# 연결 키는 소스에 넣지 않는다. 사이드바에서 한 번 붙여 넣으면 이 시트의 내 사용자 속성에만 저장된다
node -e 'const c=require(process.env.HOME+"/.localxl/config.json");process.stdout.write((c.port&&c.port!==3939?c.port+":":"")+c.token)' | pbcopy
echo "완료: https://docs.google.com/spreadsheets/d/$ID/edit"
echo "1. 시트를 새로 고친 뒤 메뉴 Local Agent > 열기를 누르세요."
echo "2. 처음에는 Google 권한 승인 창이 뜹니다. 내 계정이 만든 스크립트라 '확인되지 않은 앱' 경고가 나옵니다. 고급 > 이동 > 모두 선택 > 계속을 누르세요."
echo "3. 브라우저가 로컬 네트워크 접근을 물으면 허용을 누르세요."
echo "4. 사이드바의 연결 키 칸에 붙여 넣으세요 (Cmd+V). 키는 클립보드에 복사되어 있습니다."
