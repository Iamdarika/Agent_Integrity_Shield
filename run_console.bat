@echo off
REM AIS Console launcher. Double-click to start; the browser opens by itself.
REM For Live mode, set your key first in this window:  set GOOGLE_API_KEY=your-key
cd /d "%~dp0"
python app\server.py
pause
