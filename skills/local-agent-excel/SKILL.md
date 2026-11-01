---
name: local-agent-excel
description: Install, start, check, update or remove Local Agent for Excel, a macOS Excel task pane that runs the user's own Claude Code and Codex (subscription login) with their skills, MCP servers and CLI tools. Use when the user says "install Local Agent for Excel", "set up the Excel agent", "the Excel pane is not connected", "엑셀 에이전트 설치", "Local Agent for Excel 설치해줘", "엑셀 작업창 연결 안 돼", or asks to update or uninstall it.
---

# Local Agent for Excel

The plugin root is two folders above this skill folder (`<this skill dir>/../..`). It contains `scripts/`, `server/`, `taskpane/` and `manifest.xml`. Call it `ROOT` below and use its absolute path in every command.

## Install or update

1. Check requirements and stop with a clear message if one fails:
   - macOS (`uname` prints `Darwin`).
   - Node.js 18 or later (`node -v`).
   - Microsoft Excel for Mac is installed (`ls /Applications/Microsoft\ Excel.app`).
   - At least one engine is logged in with a subscription:
     - `claude auth status` shows `"loggedIn": true`. If `authMethod` is not `claude.ai`, tell the user the pane will try to use their subscription login and ask them to run `claude` once and log in.
     - `codex login status` prints `Logged in using ChatGPT`.
2. Run `zsh "ROOT/scripts/install.sh"` (zsh, not bash). It copies the app to `~/.localxl/app`, installs Node packages, registers the LaunchAgent `com.localxl.bridge` and copies the add-in manifest into Excel's sideload folder. Running it again updates the app in place and keeps the settings in `~/.localxl/config.json`.
3. Confirm the bridge answers: `curl -s http://localhost:3939/health` returns `"ok":true`.
4. Tell the user the last manual step (Excel does not allow it to be automated):
   - Quit Excel completely and reopen it (also needed after an update).
   - Home tab > Add-ins > Developer Add-ins (개발자 추가 기능) > **Local Agent for Excel**. After the first time, the **Local Agent** button stays on the Home tab.

## Check status or fix a pane that does not connect

- `curl -s http://localhost:3939/health` shows whether the bridge runs (`ok`), whether a pane is connected (`pane`) and which engine is busy (`running`).
- Restart the bridge: `launchctl kickstart -k gui/$(id -u)/com.localxl.bridge`, wait about 10 seconds, then check health again.
- Logs: `~/.localxl/logs/bridge.log` (KST timestamps) and `~/.localxl/logs/launchd.err.log`.
- If the pane says the connection key is missing, run the install script again and restart Excel. If the pane shows a red dot, the bridge is not reachable. If the engine says it is not installed, set `claudeBin` or `codexBin` in `~/.localxl/config.json` to the output of `command -v claude` / `command -v codex` and restart the bridge.

## Settings

`~/.localxl/config.json` (mode 600). Restart the bridge after editing.

| Key | Meaning |
|---|---|
| `port` | Bridge port, default 3939. After changing it, run the install script again and restart Excel. |
| `workdir` | Folder the engines run in, default the home folder. |
| `claudeModel`, `claudeEffort` | Default Claude model and effort. The pane menu overrides them. |
| `codexModel`, `codexEffort` | Default Codex model and reasoning effort. |
| `idleMinutes` | Minutes before the warm Claude process stops when unused, default 30. |
| `allowApiKey` | Default false: API key and gateway variables are removed so both engines use the subscription login. |
| `debug` | Default false. True enables the `/debug/*` endpoints used for testing. |

## Uninstall

Run `zsh "ROOT/scripts/uninstall.sh"`. It removes the LaunchAgent, the add-in manifest and `~/.localxl/app`, and keeps `~/.localxl/config.json` and logs. Tell the user they can delete `~/.localxl` to remove everything.
