@echo off
chcp 65001 >nul
set PYTHONIOENCODING=utf-8
cd /d "%~dp0"
python scrape_timetable.py
echo.
echo Scraper finished or stopped. Press any key to close.
pause >nul
