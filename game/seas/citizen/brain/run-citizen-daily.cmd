@echo off
REM Wrapper the Windows Scheduled Task calls. Sets env, then runs the Citizen daily runner.
REM Founder 2026-06-30: Citizen shows up at least once per day to check strat and in-game news.
set "CLAUDE_BIN=C:\Users\bigji\AppData\Roaming\npm\claude.cmd"
set "SEAS_API_BASE=https://tasern.quest/seas-api"
REM LIVE (founder 2026-07-01: they self-fund by trade / bootstrap-and-grow from zero by the rules).
REM Dedicated bot wallets (NOT the treasury) so this is peg-safe; every tool caps its own spend.
set "CITIZEN_ALLOW_LIVE=1"
cd /d "C:\Users\bigji\Documents\MfT-Launch\game\seas"
"C:\Program Files\nodejs\node.exe" "C:\Users\bigji\Documents\MfT-Launch\game\seas\citizen\brain\daily.mjs" --live %*
