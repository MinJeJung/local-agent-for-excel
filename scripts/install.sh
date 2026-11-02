#!/bin/zsh
# Local Agent for Excel 설치·업데이트 (macOS)
# 앱을 ~/.localxl/app 에 복사 → 의존성 설치 → 브리지 상주(LaunchAgent) → Excel에 애드인 등록
[ -n "${ZSH_VERSION:-}" ] || { echo "zsh로 실행하세요: zsh scripts/install.sh"; exit 1; }
set -e
ROOT="${0:A:h:h}"
APP="$HOME/.localxl/app"
LABEL="com.localxl.bridge"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
WEF="$HOME/Library/Containers/com.microsoft.Excel/Data/Documents/wef"

[[ "$(uname)" == Darwin ]] || { echo "macOS 전용입니다."; exit 1; }
whence -p node >/dev/null || { echo "Node.js 20 이상이 필요합니다: https://nodejs.org"; exit 1; }
(( $(node -p 'process.versions.node.split(".")[0]') >= 20 )) || { echo "Node.js 20 이상이 필요합니다 (현재 $(node -v))."; exit 1; }
[[ -d "/Applications/Microsoft Excel.app" ]] || echo "주의: /Applications/Microsoft Excel.app 이 없습니다. Excel을 설치한 뒤 사용하세요."
command -v npm >/dev/null || { echo "npm이 필요합니다. Node.js를 npm과 함께 설치하세요."; exit 1; }
CLAUDE_BIN="$(whence -p claude || true)"; CODEX_BIN="$(whence -p codex || true)"
[[ -z "$CLAUDE_BIN$CODEX_BIN" ]] && { echo "claude 또는 codex CLI가 하나 이상 필요합니다."; exit 1; }
echo "엔진: claude=${CLAUDE_BIN:-없음} codex=${CODEX_BIN:-없음}"

# 플러그인 폴더는 업데이트 때 바뀌므로 고정 위치에 복사해 실행한다
mkdir -p "$APP" "$HOME/.localxl/logs" "$HOME/Library/LaunchAgents"
if [[ "$ROOT" != "$APP" ]]; then
  rsync -a --delete "$ROOT/server/" "$APP/server/"
  rsync -a --delete "$ROOT/taskpane/" "$APP/taskpane/"
  rsync -a --delete "$ROOT/scripts/" "$APP/scripts/"
  rsync -a --delete "$ROOT/sheets/" "$APP/sheets/"
  cp "$ROOT/package.json" "$ROOT/package-lock.json" "$ROOT/manifest.xml" "$APP/"
fi
(cd "$APP" && npm install --omit=dev --no-audit --no-fund --silent)

# 엔진 경로와 연결 키를 설정에 기록 (LaunchAgent는 셸 PATH를 모른다)
read PORT TOKEN <<< "$(node -e '
const fs=require("fs"),p=process.env.HOME+"/.localxl/config.json";
const c=fs.existsSync(p)?JSON.parse(fs.readFileSync(p)):{};
if(process.argv[1])c.claudeBin=process.argv[1]; if(process.argv[2])c.codexBin=process.argv[2];
c.token=c.token||require("crypto").randomBytes(24).toString("hex");
fs.writeFileSync(p,JSON.stringify(c,null,2),{mode:0o600}); fs.chmodSync(p,0o600); console.log(c.port||3939,c.token);' "$CLAUDE_BIN" "$CODEX_BIN")"

# 경로와 PATH에 & 또는 <가 있어도 유효한 plist를 만든다
xml() { node -e 'process.stdout.write(process.argv[1].replace(/[&<>"\x27]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\x22":"&quot;","\x27":"&apos;"}[c])))' "$1"; }
cat > "$PLIST" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array><string>$(xml "$(node -p process.execPath)")</string><string>$(xml "$APP/server/bridge.mjs")</string></array>
  <key>WorkingDirectory</key><string>$(xml "$APP")</string>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>$(xml "$PATH")</string><key>HOME</key><string>$(xml "$HOME")</string></dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$(xml "$HOME/.localxl/logs/bridge.log")</string>
  <key>StandardErrorPath</key><string>$(xml "$HOME/.localxl/logs/launchd.err.log")</string>
</dict></plist>
PL
# 이전 브리지가 완전히 내려간 뒤 다시 올린다 (바로 올리면 "Input/output error"가 난다)
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
for i in {1..20}; do launchctl print "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || break; sleep 0.5; done
launchctl bootstrap "gui/$(id -u)" "$PLIST" 2>/dev/null || { sleep 2; launchctl bootstrap "gui/$(id -u)" "$PLIST"; }

# 작업창 주소에 연결 키를 넣는다. 키는 이 매니페스트와 config.json, 브리지가 만드는 mcp-claude.json에 저장한다
mkdir -p "$WEF" && sed -e "s#localhost:3939/taskpane/index.html\"#localhost:$PORT/taskpane/index.html?k=$TOKEN\"#g" -e "s/localhost:3939/localhost:$PORT/g" "$APP/manifest.xml" > "$WEF/localxl.xml"
chmod 600 "$WEF/localxl.xml"

# 브리지는 로그인 셸 환경을 읽은 뒤 열린다 (셸 설정이 무거우면 10초 넘게 걸린다)
# 같은 포트의 다른 서버를 브리지로 오인하지 않게 응답의 app 값을 확인한다
health() { curl -sf --max-time 2 "http://localhost:$PORT/health" | grep '"app":"localxl"'; }
for i in {1..60}; do health >/dev/null && break; sleep 0.5; done
health || { echo "브리지가 응답하지 않습니다. 포트 $PORT를 다른 프로그램이 쓰는지 확인하세요: lsof -nP -iTCP:$PORT -sTCP:LISTEN"; echo "로그: ~/.localxl/logs/bridge.log, ~/.localxl/logs/launchd.err.log"; exit 1; }
echo "설치 완료. Excel을 완전히 종료했다가 다시 연 뒤 [홈] > 추가 기능 > 개발자 추가 기능 > Local Agent for Excel 을 누르세요."
