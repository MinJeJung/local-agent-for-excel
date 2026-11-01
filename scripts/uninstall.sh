#!/bin/zsh
# Local Agent for Excel 제거: 브리지 상주 해제, Excel 애드인 등록 해제, 설치된 앱 삭제 (설정·로그는 남긴다)
LABEL="com.localxl.bridge"
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null
rm -f "$HOME/Library/LaunchAgents/$LABEL.plist" "$HOME/Library/Containers/com.microsoft.Excel/Data/Documents/wef/localxl.xml"
[[ -d "$HOME/.localxl/app" ]] && rm -rf "$HOME/.localxl/app"
echo "제거 완료. 설정(config.json)과 로그는 ~/.localxl 에 남아 있습니다. 모두 지우려면 ~/.localxl 폴더를 삭제하세요."
