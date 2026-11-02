# Google Workspace Marketplace listing draft

## App
- Name: Local Agent for Sheets
- Type: Editor add-on (Google Sheets)
- Script ID: set in Marketplace SDK > App configuration (standalone add-on project)
- Scopes: `https://www.googleapis.com/auth/spreadsheets.currentonly`, `https://www.googleapis.com/auth/script.container.ui`
- Visibility: Public (or Private / unlisted for a first trial)

## Short description (≤200 chars)
EN: Use your own Claude Code or Codex inside Google Sheets. The agent runs on your computer with your skills and MCP tools and edits the open sheet.
KO: 내 컴퓨터의 Claude Code나 Codex를 구글 시트 안에서 씁니다. 내 스킬과 MCP를 그대로 쓰고 열린 시트를 바로 고칩니다.

## Detailed description
EN:
Local Agent for Sheets puts a chat sidebar in Google Sheets and connects it to the Claude Code or Codex CLI that runs on your own computer.

- Ask in plain language: summarize a range, add formulas, build tables and charts, clean data.
- Your own skills, slash commands and MCP servers work as they do in the terminal.
- Data goes from the sheet to a bridge on your computer (127.0.0.1), then to the AI provider under your own account. The developer runs no server and collects no data.

Requirements: macOS, a Chromium browser, Node.js, and Claude Code or Codex signed in. Install the free bridge from https://github.com/MinJeJung/local-agent-for-excel, then open Extensions > Local Agent for Sheets > 열기 and paste the connection key.

KO:
Local Agent for Sheets는 구글 시트에 대화 사이드바를 띄우고, 내 컴퓨터에서 도는 Claude Code나 Codex CLI와 연결합니다.

- 범위 요약, 수식 추가, 표와 차트 만들기, 데이터 정리를 말로 요청합니다.
- 터미널에서 쓰던 스킬, 슬래시 명령, MCP 서버를 그대로 씁니다.
- 시트 데이터는 내 컴퓨터의 브리지(127.0.0.1)를 거쳐 내 계정의 AI 서비스로만 갑니다. 개발자는 서버를 두지 않고 데이터를 받지 않습니다.

준비물: macOS, Node.js, 로그인된 Claude Code 또는 Codex. 깃허브에서 무료 브리지를 설치한 뒤 확장 프로그램 > Local Agent for Sheets > 열기에서 연결 키를 붙여 넣습니다.

## Category
Productivity (alt: Developer tools)

## Links
- Privacy policy: https://github.com/MinJeJung/local-agent-for-excel/blob/main/PRIVACY.md
- Terms of service: https://github.com/MinJeJung/local-agent-for-excel/blob/main/TERMS.md
- Support: https://github.com/MinJeJung/local-agent-for-excel/issues
- Developer website: https://github.com/MinJeJung/local-agent-for-excel

## Graphics (this folder)
- icon-128.png, icon-32.png
- card-banner-220x140.png
- screenshot-1280x800.png

## Reviewer notes (OAuth verification / Marketplace review)
The add-on needs a local bridge. Reviewers can install it with `git clone https://github.com/MinJeJung/local-agent-for-excel.git && zsh local-agent-for-excel/scripts/install.sh` on macOS, or watch the demo video (to be recorded). `spreadsheets.currentonly` is used to read and write only the open spreadsheet when the user asks.

## Registration steps
1. Create a Google Cloud project. Configure the OAuth consent screen (External, app name, support email, privacy and terms links, the two scopes).
2. Apps Script project settings > Google Cloud Platform project: switch to that project number.
3. Enable "Google Workspace Marketplace SDK". In App configuration, choose Editor add-on > Sheets, enter the script ID and the deployment version number.
4. `clasp create-version` and `clasp create-deployment` for the add-on project.
5. Fill Store listing with the text and graphics above.
6. Publish. Public apps go to Google review. Sensitive-scope OAuth verification may also be required.
