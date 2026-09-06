# archive-old-companies.ps1
# Arquiva a instance Paperclip atual (4 companies, 27 agents, 1.14 GB) renomeando-a,
# abrindo espa�o para a nova instance "default" vazia com company �nica ILM.
#
# REQUISITOS:
# - Server Paperclip PARADO (porta 3100 livre, nenhum processo bun/node do paperclip rodando).
# - Backup j� foi feito em ..\default-backup-YYYYMMDD-HHMMSS (verificar antes de rodar).
#
# USO (PowerShell):
#   .\scripts\archive-old-companies.ps1
#
# REVERT:
#   Move-Item "~/.paperclip/instances/default-archived-<ts>" "~/.paperclip/instances/default"

$ErrorActionPreference = "Stop"

$Root = Join-Path $env:USERPROFILE ".paperclip\instances"
$Current = Join-Path $Root "default"
$Timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$Archived = Join-Path $Root "default-archived-$Timestamp"

if (-not (Test-Path $Current)) {
    Write-Host "[skip] $Current n�o existe. Nada a arquivar." -ForegroundColor Yellow
    exit 0
}

# Sanity: garantir que server n�o est� rodando na porta 3100
$Listener = Get-NetTCPConnection -State Listen -LocalPort 3100 -ErrorAction SilentlyContinue
if ($Listener) {
    Write-Host "[ERRO] Porta 3100 est� ativa (PID $($Listener.OwningProcess)). Pare o server Paperclip antes." -ForegroundColor Red
    exit 1
}

# Sanity: garantir que embedded-postgres n�o est� rodando
$PgPid = Join-Path $Current "db\postmaster.pid"
if (Test-Path $PgPid) {
    Write-Host "[ERRO] $PgPid existe (embedded-postgres pode estar rodando). Pare o server antes." -ForegroundColor Red
    exit 1
}

Write-Host "Arquivando $Current -> $Archived" -ForegroundColor Cyan
Move-Item -Path $Current -Destination $Archived
Write-Host "[ok] Arquivado." -ForegroundColor Green

Write-Host ""
Write-Host "Pr�ximos passos:" -ForegroundColor Cyan
Write-Host "  1. pnpm dev:server   # sobe o server; ele cria ~/.paperclip/instances/default/ vazia"
Write-Host "  2. Abra http://localhost:3100 e crie a company 'ILM' (prefix ILM)"
Write-Host "  3. Aplique os drafts em ~/.paperclip/drafts/ILM-v1/ seguindo drafts/ILM-v1/README.md"
Write-Host ""
Write-Host "Para reverter:"
Write-Host "  Move-Item '$Archived' '$Current'"
