@echo off
rem Opens TankFiles in its own window. Close this console to stop the game server.
cd /d "%~dp0"
node server.js --open
