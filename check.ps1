#!/usr/bin/env pwsh
# Quick Health Check Launcher - Simple alias for pre-campaign-check.ps1

$scriptPath = Split-Path -Parent $MyInvocation.MyCommand.Path
& "$scriptPath\pre-campaign-check.ps1"
