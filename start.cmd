@echo off
cd /d "%~dp0"
set "DIR=%~1"
if "%DIR%"=="" set "DIR=diagrams"
echo Oeffne http://127.0.0.1:3456/ im Browser.
"binaries\bpmn-editor-windows-amd64.exe" "%DIR%"
