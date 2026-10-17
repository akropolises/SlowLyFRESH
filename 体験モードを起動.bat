@echo off
rem Start the exhibition mode (fullscreen). Quit with Ctrl+Shift+Q.
rem Uses the Electron bundled in node_modules, so Node.js does not need to be installed.
set "ELECTRON=%~dp0node_modules\electron\dist\electron.exe"
if not exist "%ELECTRON%" (
  echo node_modules\electron was not found. Copy the whole folder including node_modules.
  pause
  exit /b 1
)
start "" "%ELECTRON%" "%~dp0exhibition\app-main.js"
