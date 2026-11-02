# Local Agent for Excel

[한국어](#한국어) · [English](#english)

---

## 한국어

내 Claude Code와 Codex를 Excel 작업창에서 쓰는 macOS 애드인입니다. 내 구독 로그인, 스킬, MCP 서버, CLI 도구를 그대로 쓰고, 결과를 열려 있는 통합 문서에 바로 씁니다. Google Sheets 사이드바로도 쓸 수 있습니다(실험).

- API 키가 필요 없습니다. `claude`와 `codex` CLI에 로그인한 구독(Claude Pro·Max, ChatGPT)으로 실행합니다.
- 브리지와 CLI는 내 맥에서 실행됩니다. 모델 요청은 선택한 엔진의 서비스로 전송됩니다. 브리지는 `127.0.0.1`에서만 열립니다.
- 대화에 집중하는 화면입니다. 작업 중에는 "Excel 작업 중", "도구 사용 중" 같은 한 줄 상태만 보여 줍니다.

### 필요한 것

- macOS, Microsoft 365 Excel for Mac
- Node.js 20 이상
- `claude` 또는 `codex` CLI 하나 이상, 구독으로 로그인된 상태 (`claude auth status`, `codex login status`로 확인)

Node.js와 npm을 설치한 뒤 새 터미널에서 `node -v`와 `npm -v`를 확인합니다. CLI 설치 후 `claude` 또는 `codex login`으로 구독 로그인합니다. Excel은 한 번 실행하고 종료합니다. 직접 설치에는 Git도 필요합니다.

### 설치

**Claude Code 플러그인**

```
/plugin marketplace add MinJeJung/local-agent-for-excel
/plugin install local-agent-for-excel@local-agent-for-excel
```

설치 후 Claude Code에 "Local Agent for Excel 설치해줘"라고 말하면 설치 스크립트를 실행합니다.

**Codex 플러그인**

```bash
codex plugin marketplace add MinJeJung/local-agent-for-excel
```

```bash
codex plugin add local-agent-for-excel@local-agent-for-excel
```

설치 후 Codex에 "Local Agent for Excel 설치해줘"라고 말합니다.

**직접 설치**

```bash
git clone https://github.com/MinJeJung/local-agent-for-excel.git && zsh local-agent-for-excel/scripts/install.sh
```

설치 스크립트가 하는 일:

1. 앱을 `~/.localxl/app`에 복사하고 Node 패키지를 설치합니다.
2. 브리지를 LaunchAgent `com.localxl.bridge`로 등록합니다 (로그인할 때 자동 시작).
3. 애드인 매니페스트를 Excel 사이드로드 폴더에 복사합니다.

마지막 한 단계는 직접 합니다. Excel을 다시 시작하고 **홈 → 추가 기능 → 개발자 추가 기능 → Local Agent for Excel**을 누릅니다. 버전에 따라 개발자 추가 기능 하위 메뉴 없이 표시될 수 있습니다. 통합 문서를 먼저 여세요. 그다음부터는 홈 탭의 **Local Agent** 버튼으로 엽니다.

업데이트는 설치를 다시 실행한 뒤 Excel을 Cmd+Q로 완전히 종료하고 다시 열면 됩니다. 창만 닫으면 옛 주소가 남아 작업창에 "연결 키가 없습니다"가 나옵니다. 설정은 유지됩니다.

### 사용

- 입력창에 요청을 쓰고 Enter를 누릅니다. `/`를 누르면 내 스킬과 슬래시 명령 목록이 나옵니다.
- 아래쪽 메뉴에서 엔진(Claude Code, Codex)과 추론 강도를 고릅니다. 모델 메뉴는 Claude Code에만 있고, Codex는 내 `~/.codex/config.toml` 모델을 씁니다. 강도를 "낮음"으로 두면 빨라집니다.
- 셀 범위를 직접 선택하면 입력창 위에 범위 칩(예: `Sheet1!B2:D6`)이 나오고, 그 범위의 값을 요청과 함께 보냅니다. 빼려면 칩의 ×를 누릅니다. 셀 하나만 선택했거나 에이전트가 범위를 바꾼 경우에는 칩이 나오지 않습니다.
- "되돌리기"는 마지막 요청이 바꾼 셀의 값과 수식을 복구합니다. 서식, 표, 차트, 시트 삭제는 복구하지 않습니다.
- 답변에 마우스를 올리면 보이는 "구독 사용 (API 환산 $x)"은 같은 작업을 API로 했을 때의 추정 금액입니다. 청구 금액이 아닙니다.

### Google Sheets에서 쓰기 (실험)

같은 브리지를 Google Sheets 사이드바에서도 쓸 수 있습니다. 위 설치를 먼저 끝낸 뒤 스프레드시트마다 한 번 연결합니다. 맥의 Chrome 계열 브라우저에서 시트를 엽니다.

1. [Apps Script 설정](https://script.google.com/home/usersettings)에서 Google Apps Script API를 켭니다 (처음 한 번).
2. 터미널에서 실행합니다. 처음에는 clasp가 Google 로그인 창을 엽니다. `new`를 주면 새 스프레드시트를 만듭니다.
   ```bash
   zsh ~/.localxl/app/scripts/sheets-attach.sh "https://docs.google.com/spreadsheets/d/<ID>/edit"
   ```
3. 시트를 새로 고친 뒤 메뉴 **Local Agent > 열기**를 누릅니다.
4. 처음에는 Google 권한 승인 창이 뜹니다. 내 계정이 만든 스크립트라 "확인되지 않은 앱" 경고가 나옵니다. 고급 > 이동 > 모두 선택 > 계속을 누릅니다. 요청하는 권한은 "현재 스프레드시트 보기·편집"과 "사이드바 표시"뿐입니다.
5. 브라우저가 로컬 네트워크 접근을 물으면 허용을 누릅니다. 사이드바가 `ws://localhost`로 브리지에 연결하려면 필요합니다.
6. 사이드바의 연결 키 칸에 붙여 넣습니다(Cmd+V). 2번에서 키가 클립보드에 복사됩니다.

Excel과 다른 점:
- 4~6번은 스프레드시트마다 한 번씩 다시 합니다. 스크립트가 시트마다 따로 만들어지기 때문입니다.
- 연결 키는 소스에 넣지 않고, 그 시트의 내 사용자 속성(Apps Script UserProperties)에만 저장합니다. 다른 편집자는 내 키를 볼 수 없습니다. 키를 바꾸려면 메뉴 **Local Agent > 연결 키 다시 입력**을 누릅니다.
- 다른 편집자도 사이드바를 열 수 있습니다. 하지만 그 사람의 맥에 브리지와 키가 없으면 연결되지 않습니다. 편집자를 모두 믿을 수 있는 시트에만 붙이세요. 스크립트 코드는 편집자가 바꿀 수 있습니다.
- `run_script`는 Apps Script 코드(`ss`, `SpreadsheetApp`)를 실행합니다. 표는 굵은 머리글, 줄무늬, 필터로 만듭니다.
- 범위 칩은 2초마다 선택을 확인해 갱신합니다.
- 되돌리기는 사이드바를 닫으면 기록이 사라집니다. 시트 자체의 실행 취소(Cmd+Z)는 그대로 쓸 수 있습니다.
- 화면을 최신으로 바꾸려면 같은 명령(2번)을 다시 실행하고 사이드바를 다시 엽니다. 연결을 끊으려면 시트의 **확장 프로그램 > Apps Script**에서 프로젝트를 지웁니다.

### 내 스킬과 MCP 쓰기

작업창은 설치한 사용자의 맥에 있는 자원을 씁니다. 다른 사람의 자원이 들어 있지 않습니다.

- Claude Code: `~/.claude/skills`의 스킬, 설치한 플러그인, 사용자 범위 MCP 서버(`claude mcp add --scope user`)를 씁니다. 엔진은 `workdir`(기본은 홈 폴더)에서 실행되므로, 다른 프로젝트 폴더에 `local` 범위로 등록한 MCP 서버는 보이지 않습니다. 그런 서버는 `--scope user`로 다시 등록하거나 `workdir`를 그 폴더로 바꿉니다.
- Codex: `~/.codex/config.toml`의 `mcp_servers`와 `~/.codex/skills`를 씁니다.
- Claude Code는 작업창에서 권한을 물을 수 없습니다. 권한 모드가 기본(default)이면 Excel 도구와 웹 검색 말고는 MCP 도구, Skill, 셸 명령이 거부됩니다. 쓰려는 도구를 `~/.claude/settings.json`의 `permissions.allow`에 넣습니다. MCP 서버는 서버 이름 단위로, 셸 명령은 명령 앞부분 단위로 허용할 수 있습니다.

  ```json
  { "permissions": { "allow": ["Skill", "mcp__korean-law", "Bash(python3:*)"] } }
  ```

  모든 도구를 묻지 않고 허용하려면 `~/.localxl/config.json`에 `"claudePermissionMode": "bypassPermissions"`를 넣습니다. 이때는 작업창 요청이 모든 MCP 도구와 셸 명령을 실행할 수 있습니다.

### 구독으로만 실행하는 방법

브리지는 엔진을 실행할 때 `ANTHROPIC_API_KEY`, `ANTHROPIC_BASE_URL`, `OPENAI_API_KEY`, `CODEX_API_KEY` 같은 API 키와 게이트웨이 변수를 뺍니다. 그래서 셸에 API 키가 있어도 CLI 로그인(구독)으로 연결합니다. 다만 CLI 설정 파일에 다른 공급자나 인증 방식을 지정했다면 그 설정을 따릅니다. API 키를 쓰려면 설정에 `"allowApiKey": true`를 넣습니다.

### 보안 안내

- 엔진은 설치한 사용자의 Claude Code·Codex 설정과 권한 모드를 그대로 씁니다. 평소에 셸 명령을 자동 허용하도록 설정했다면, 작업창 요청도 셸 명령을 실행할 수 있습니다.
- `run_script` 도구는 모델이 쓴 Office.js 코드(Google Sheets는 Apps Script 코드)를 열린 문서에서 실행합니다.
- 브리지는 무작위 토큰으로 MCP와 작업창 연결을 보호합니다. 토큰은 `~/.localxl/config.json`, `~/.localxl/mcp-claude.json`, Excel 애드인 매니페스트에 저장되고(모두 권한 600), 작업창 페이지에는 들어 있지 않습니다. 설정한 포트의 `localhost`와 `127.0.0.1` 이외의 Host 헤더 요청은 거부합니다 (DNS 리바인딩 차단).
- 웹 검색(`WebSearch`, `WebFetch`)은 작업창에서 묻지 않고 허용합니다. 내 Claude Code 설정의 deny 규칙은 그대로 적용됩니다.
- 시트 삭제처럼 되돌릴 수 없는 작업이 있으니 중요한 파일은 먼저 저장하세요.

### 설정 `~/.localxl/config.json`

바꾼 뒤 브리지를 다시 시작합니다: `launchctl kickstart -k gui/$(id -u)/com.localxl.bridge`

| 키 | 기본값 | 설명 |
|---|---|---|
| `port` | 3939 | 브리지 포트. 바꾸면 설치를 다시 실행합니다. |
| `workdir` | 홈 폴더 | 엔진이 실행되는 폴더 (프로젝트 스킬을 쓰려면 그 프로젝트 폴더) |
| `claudeModel`, `claudeEffort` | null | Claude 기본 모델과 강도. 작업창 메뉴가 우선합니다. |
| `codexModel`, `codexEffort` | null | Codex 기본 모델과 추론 강도 |
| `claudePermissionMode` | null | null이면 내 Claude Code 기본 권한 모드 |
| `codexArgs` | [] | `codex exec`에 더할 인자 |
| `idleMinutes` | 30 | 쓰지 않는 Claude 상주 프로세스를 내리는 시간(분) |
| `allowApiKey` | false | true면 API 키와 게이트웨이 변수를 유지합니다. |
| `debug` | false | true면 검증용 `/debug/*` 엔드포인트를 켭니다. |

로그: `~/.localxl/logs/bridge.log`, `~/.localxl/logs/launchd.err.log`

### 제거

```bash
zsh ~/.localxl/app/scripts/uninstall.sh
```

설정과 로그는 `~/.localxl`에 남습니다. 모두 지우려면 그 폴더를 삭제합니다. 플러그인으로 설치했다면 Claude Code의 `/plugin`이나 Codex의 플러그인 메뉴에서도 제거합니다.

---

## English

A macOS Excel task pane that runs your own Claude Code and Codex. It uses your subscription login, skills, MCP servers and CLI tools, and writes the results into the open workbook. It also works in a Google Sheets sidebar (experimental).

- No API key. It runs the `claude` and `codex` CLIs with the subscription you logged in with (Claude Pro or Max, ChatGPT).
- The bridge and CLIs run on your Mac. Model requests are sent to the selected engine’s service. The bridge listens on `127.0.0.1` only.
- A chat-first pane. While it works, it shows one status line, such as "Excel 작업 중".

### Requirements

- macOS and Microsoft 365 Excel for Mac
- Node.js 20 or later
- `claude` or `codex` CLI (at least one), logged in with a subscription

Install Node.js with npm. Open a new terminal and check `node -v` and `npm -v`. Install a CLI, then sign in with `claude` or `codex login`. Open Excel once and quit it. Manual installation also requires Git.

### Install

**Claude Code plugin**

```
/plugin marketplace add MinJeJung/local-agent-for-excel
/plugin install local-agent-for-excel@local-agent-for-excel
```

Then ask Claude Code: "Install Local Agent for Excel".

**Codex plugin**

```bash
codex plugin marketplace add MinJeJung/local-agent-for-excel
```

```bash
codex plugin add local-agent-for-excel@local-agent-for-excel
```

Then ask Codex: "Install Local Agent for Excel".

**Manual**

```bash
git clone https://github.com/MinJeJung/local-agent-for-excel.git && zsh local-agent-for-excel/scripts/install.sh
```

The script copies the app to `~/.localxl/app`, registers the LaunchAgent `com.localxl.bridge` and copies the add-in manifest into Excel's sideload folder. Then restart Excel and open **Home → Add-ins → Developer Add-ins → Local Agent for Excel**. Open a workbook first. Some versions show the add-in directly under Add-ins. After that, use the **Local Agent** button on the Home tab. To update, run the script again and restart Excel. The model menu applies to Claude Code only; Codex uses the model in `~/.codex/config.toml`.

### Google Sheets (experimental)

The same bridge also works in a Google Sheets sidebar. Finish the install above first, then attach each spreadsheet once. Open the sheet in a Chromium browser on your Mac.

1. Turn on the Google Apps Script API in [Apps Script settings](https://script.google.com/home/usersettings) (once).
2. Run this in a terminal. The first time, clasp opens a Google sign-in page. Pass `new` to create a new spreadsheet.
   ```bash
   zsh ~/.localxl/app/scripts/sheets-attach.sh "https://docs.google.com/spreadsheets/d/<ID>/edit"
   ```
3. Reload the sheet and click **Local Agent > 열기** in the menu.
4. The first time, Google asks for authorization. The script is yours, so you see an "unverified app" warning. Click Advanced > Go to > Select all > Continue. It only asks to view and edit the current spreadsheet and to show a sidebar.
5. If the browser asks for local network access, allow it. The sidebar needs it to reach the bridge at `ws://localhost`.
6. Paste the key into the sidebar (Cmd+V). Step 2 copied it to the clipboard.

Differences from Excel:
- Repeat steps 4 to 6 for each spreadsheet. Each one gets its own script.
- The key is not in the source. It is stored only in your user properties for that sheet (Apps Script UserProperties), so other editors cannot see it. Use **Local Agent > 연결 키 다시 입력** to change it.
- Other editors can open the sidebar, but it cannot connect without a bridge and key on their Mac. Attach it only to sheets whose editors you trust. Editors can change the script code.
- `run_script` runs Apps Script code (`ss`, `SpreadsheetApp`). Tables get a bold header, banding and a filter.
- The range chip checks the selection every 2 seconds.
- Undo history is lost when you close the sidebar. The sheet's own undo (Cmd+Z) still works.
- To update the sidebar, run step 2 again and reopen it. To detach, delete the project in **Extensions > Apps Script**.

### Your own skills and MCP servers

The pane uses the resources on the installing user's Mac. It ships with none of its own.

- Claude Code: skills in `~/.claude/skills`, installed plugins and user-scope MCP servers (`claude mcp add --scope user`). The engine runs in `workdir` (the home folder by default), so MCP servers added with `local` scope in another project folder are not visible. Add them again with `--scope user`, or set `workdir` to that folder.
- Codex: `mcp_servers` in `~/.codex/config.toml` and skills in `~/.codex/skills`.
- Claude Code cannot ask for permission from the pane. In the default permission mode, everything except the Excel tools and web search is denied: MCP tools, Skill and shell commands. Add the tools you want to `permissions.allow` in `~/.claude/settings.json`. You can allow an MCP server by name and a shell command by its prefix.

  ```json
  { "permissions": { "allow": ["Skill", "mcp__korean-law", "Bash(python3:*)"] } }
  ```

  To allow every tool without asking, put `"claudePermissionMode": "bypassPermissions"` in `~/.localxl/config.json`. Requests from the pane can then run any MCP tool and shell command.

### Subscription only

When the bridge starts an engine, it removes API key and gateway variables (`ANTHROPIC_API_KEY`, `ANTHROPIC_BASE_URL`, `OPENAI_API_KEY`, `CODEX_API_KEY` and others), so the CLIs use their subscription login. If a CLI's own config file sets another provider or auth method, that setting still applies. Set `"allowApiKey": true` in the config to keep them. The "API 환산 $x" tooltip on the reply is an estimate of the API price, not a charge.

### Security

- The engines use the installing user's own Claude Code and Codex settings and permission modes. If you allow shell commands without asking, requests from the pane can run shell commands too.
- The `run_script` tool runs code written by the model in the open document (Office.js in Excel, Apps Script in Google Sheets).
- A random token protects the MCP endpoint and the pane connection. It is stored in `~/.localxl/config.json`, `~/.localxl/mcp-claude.json` and the add-in manifest (all mode 600), not in the pane page. Host headers must match `localhost` or `127.0.0.1` and the configured port (DNS rebinding protection).
- Web search (`WebSearch`, `WebFetch`) is allowed without a prompt in the pane. Deny rules in your Claude Code settings still apply.
- Some actions, such as deleting a sheet, cannot be undone. Save important files first.

### Uninstall

```bash
zsh ~/.localxl/app/scripts/uninstall.sh
```

Settings and logs stay in `~/.localxl`. Delete that folder to remove everything. If you installed it as a plugin, also remove it with `/plugin` in Claude Code or the plugin menu in Codex.

---

Not affiliated with or endorsed by Anthropic, OpenAI or Microsoft. Claude, Codex and Excel are trademarks of their owners.

License: [MIT](LICENSE)
