@echo off
:loop
cls
git status .
timeout /t 10 /nobreak >nul
goto loop
