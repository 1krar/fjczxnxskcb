@echo off
cd /d "%~dp0"
where python >nul 2>nul
if errorlevel 1 goto no_python
python local_preview.py
echo.
echo Local preview stopped or failed. Press any key to close.
pause >nul
exit /b
:no_python
echo Python was not found. Please install Python or add it to PATH.
pause >nul
exit /b 1
