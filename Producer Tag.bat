@echo off
rem Producer Tag - Windows double-click launcher. Opens the control-panel window;
rem closing the window quits. The git hooks keep working regardless.
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is required. Install it from https://nodejs.org and try again.
  pause
  exit /b 1
)
node gui.js
