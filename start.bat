@echo off
chcp 65001 >nul
echo Starting personal-homepage services...

echo [1/2] Starting proxy (backend) on :8787...
start "Proxy" cmd /c "cd proxy && npm start"

echo [2/2] Starting site (frontend) on :4321...
start "Site" cmd /c "cd site && npm run dev"

echo.
echo Both services are starting:
echo   Proxy (backend): http://localhost:8787
echo   Site  (frontend): http://localhost:4321
echo.
echo Close this window or press Ctrl+C to stop.
pause
