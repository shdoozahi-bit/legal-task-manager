@echo off
chcp 65001 >nul
echo.
echo  =======================================
echo   مدير المهام - Task Manager
echo  =======================================
echo.
echo  جاري تشغيل السيرفر المحلي...
echo  Starting local server...
echo.

:: Try Python 3
where python >nul 2>nul
if %errorlevel%==0 (
    echo  الرابط: http://localhost:8080
    echo  Link:   http://localhost:8080
    echo.
    echo  اضغط Ctrl+C لإيقاف السيرفر
    echo  Press Ctrl+C to stop.
    echo.
    start "" "http://localhost:8080"
    python -m http.server 8080
    goto :eof
)

:: Try Python 3 explicitly
where python3 >nul 2>nul
if %errorlevel%==0 (
    echo  الرابط: http://localhost:8080
    start "" "http://localhost:8080"
    python3 -m http.server 8080
    goto :eof
)

:: Try Node.js
where node >nul 2>nul
if %errorlevel%==0 (
    echo  الرابط: http://localhost:3000
    start "" "http://localhost:3000"
    npx --yes serve -p 3000 .
    goto :eof
)

echo  [خطأ] لم يتم العثور على Python أو Node.js
echo.
echo  لتفعيل الإشعارات في الخلفية، ثبّت أحدهما:
echo    Python: https://python.org/downloads
echo    Node.js: https://nodejs.org
echo.
echo  ملاحظة: يمكنك فتح index.html مباشرة لكن
echo  الإشعارات لن تعمل إلا عند فتح التطبيق.
echo.
pause
