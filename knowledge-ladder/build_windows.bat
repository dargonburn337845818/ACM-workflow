@echo off
REM ============================================
REM  Codeforces Difficulty Ladder - Windows build
REM  Requirements: Windows + Python 3.10+
REM  Usage: double-click or run build_windows.bat
REM ============================================

cd /d "%~dp0"

echo [1/3] Installing dependencies...
python -m pip install -r requirements.txt
if errorlevel 1 goto :error

echo [2/3] Cleaning old build...
if exist build rmdir /s /q build
if exist dist rmdir /s /q dist

echo [3/3] Building single-file exe...
python -m PyInstaller --noconfirm --onefile --windowed --name "CodeforcesDifficultyLadder" --add-data "style.qss;." --add-data "style_mac.qss;." main.py
if errorlevel 1 goto :error

echo.
echo Build complete: dist\CodeforcesDifficultyLadder.exe
pause
exit /b 0

:error
echo.
echo Build failed. Please check the error messages above.
pause
exit /b 1
