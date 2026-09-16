@echo off
setlocal
cd /d "%~dp0"
node scripts\sync-part-images.mjs --only-failed --delay=1200
pause
endlocal
