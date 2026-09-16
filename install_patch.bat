@echo off
setlocal
set TARGET=%~1
if "%TARGET%"=="" set /p TARGET=Enter CMMS root path (example C:\Users\Administrator\Documents\ChatGPT\CMMS): 
if "%TARGET%"=="" exit /b 1
node "%~dp0install-patch.mjs" "%TARGET%"
if errorlevel 1 (
  echo.
  echo Install failed.
  pause
  exit /b 1
)
echo.
echo Installed successfully.
echo Run the image sync from the CMMS root:
echo   node scripts\sync-part-images.mjs
pause
endlocal
