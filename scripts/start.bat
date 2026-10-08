@echo off
title Winter Ops Command Center
echo.
echo === Winter Ops Command Center ===
echo.

where node >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
  echo Node.js is not installed.
  echo Please install LTS from https://nodejs.org/ then re-run this file.
  pause
  exit /b 1
)

REM Move to project root (this file is in scripts/)
pushd %~dp0..

if not exist node_modules (
  echo Installing dependencies...
  call npm install
)

if not exist ".env" (
  echo Creating .env from .env.example
  copy ".env.example" ".env" >nul
)

echo Starting server...
start "" "http://localhost:5173"
node server.js
pause
