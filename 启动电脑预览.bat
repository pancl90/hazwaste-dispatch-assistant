@echo off
cd /d "%~dp0"
if not exist "START_HERE.html" (
  echo Missing START_HERE.html. Extract the full ZIP and retry.
  pause
  exit /b 1
)
start "" "%~dp0START_HERE.html"
if errorlevel 1 (
  echo Cannot open browser. Please double-click START_HERE.html instead.
  pause
)
