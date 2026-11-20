#!/usr/bin/env pwsh
# Quick Fix Launcher - Simple alias for fix-chrome-profile.ps1

$scriptPath = Split-Path -Parent $MyInvocation.MyCommand.Path
& "$scriptPath\fix-chrome-profile.ps1"
