@echo off
REM Monthly LP inventory refresh — all read-only. Archives prior data, then re-sweeps + revalues + redraws.
cd /d C:\Users\bigji\Documents\MfT-Launch\tools
if exist C:\Users\bigji\lp-inventory.json copy /Y C:\Users\bigji\lp-inventory.json C:\Users\bigji\lp-inventory.prev.json
if exist C:\Users\bigji\value-inventory.json copy /Y C:\Users\bigji\value-inventory.json C:\Users\bigji\value-inventory.prev.json
set NODE="C:\Program Files\nodejs\node.exe"
echo [refresh] sweeping LP ownership...
%NODE% sweep-lps.js
echo [refresh] valuing positions...
%NODE% value-lps.js
echo [refresh] writing digest...
%NODE% digest-lps.js > C:\Users\bigji\lp-digest.txt
echo [refresh] rendering graph...
%NODE% render-lp-graph.js
echo [refresh] done. Outputs: lp-inventory.json, value-inventory.json, lp-digest.txt, lp-graph.html
