@echo off
if defined AGENT_COMPANY_NODE (
  "%AGENT_COMPANY_NODE%" "%~dp0..\src\cli\team.js" %*
  exit /b
)
node "%~dp0..\src\cli\team.js" %*
