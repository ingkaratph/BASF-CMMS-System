@echo off
setlocal
cd /d "%~dp0"
if not exist "scripts\sync-part-images.mjs" (
  echo This BAT must be inside the CMMS project root after installing the patch.
  pause
  exit /b 1
)
echo ============================================================
echo CMMS Spare Part Image Sync - ALL 1204 rows
echo This will search, download, resize, and map images automatically.
echo Existing mapped images are skipped. Failed items can be retried later.
echo ============================================================
echo.
node scripts\sync-part-images.mjs --delay=800
set ERR=%ERRORLEVEL%
echo.
if not "%ERR%"=="0" echo Sync ended with error code %ERR%.
echo Report: server\part-images-sync-report.csv
pause
endlocal
