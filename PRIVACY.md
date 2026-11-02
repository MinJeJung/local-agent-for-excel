# Privacy Policy — Local Agent for Sheets / Excel

Last updated: 2026-11-02

Local Agent connects a spreadsheet (Google Sheets or Microsoft Excel) to an AI coding agent (Claude Code or Codex) that runs on **your own computer**. The developer runs no server and receives no data.

## What the add-on reads
- Only the spreadsheet you opened the add-on in (`spreadsheets.currentonly` scope).
- Sheet names, the current selection, and the cell values or formulas that the agent asks for while answering your request.

## Where that data goes
- To the Local Agent bridge program on your computer (`127.0.0.1`), over a local WebSocket.
- The bridge passes your prompt and the needed sheet data to the AI CLI you installed (Claude Code or Codex). That CLI sends it to its provider (Anthropic or OpenAI) under **your own account**, and the provider's privacy policy applies.
- Nothing is sent to the developer or to any third party chosen by the developer.

## What is stored
- The connection key for your local bridge is stored in your Google account's per-user script properties (Sheets) or in the browser storage of the task pane (Excel). It is never sent anywhere except your local bridge.
- The bridge keeps only its settings (connection key, port, chosen engine) in `~/.localxl` on your computer. It does not save your chats. The AI CLI may keep its own session logs on your computer, as described in its documentation.

## What is not collected
- No analytics, no tracking, no advertising, no sale or sharing of data.

## Google user data
Use of information received from Google APIs follows the [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy), including the Limited Use requirements. Data from Google Sheets is used only to carry out the request you type in the sidebar.

## Removing the add-on
Uninstall it from Extensions > Add-ons > Manage add-ons, and revoke access at https://myaccount.google.com/permissions. Delete `~/.localxl` to remove local data.

## Contact
Open an issue: https://github.com/MinJeJung/local-agent-for-excel/issues
