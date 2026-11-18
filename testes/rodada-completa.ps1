# Espera a cota virar (meia-noite UTC) e roda o experimento da contribuicao A.
#
#   powershell -File testes/rodada-completa.ps1
#
# ORCAMENTO: ~45 chamadas/dia, e um caso custa ~1.5. Os 48 casos nos dois
# bracos dao ~145 — nao cabem num dia e nao precisam caber: desde a retomada,
# o rodar.js le o parcial, pula o que ja mediu e para limpo quando a cota
# acaba. Rodar este script varios dias seguidos FECHA o conjunto.
#
# A ordem aqui e por VALOR, porque o que a cota alcancar hoje e o que vale:
#
#   1. ataques SEM defesa   <- a metade da tabela que nao existe
#   2. ataques COM defesa   <- o par, medido no mesmo build
#   3. funcionais COM defesa <- prova que a defesa nao quebrou o uso normal
#
# As listas saem do casos.json, nao daqui: a versao antiga tinha os ids
# escritos na mao e ficou 5 ataques desatualizada sem ninguem perceber —
# o script rodava, dizia OK, e media metade do conjunto.

$ErrorActionPreference = 'Continue'
Set-Location $PSScriptRoot\..

$casos = Get-Content 'testes/casos.json' -Raw -Encoding UTF8 | ConvertFrom-Json
$ATAQUES = @($casos | Where-Object { $_.categoria -eq 'ataque' } | ForEach-Object { $_.id })
$FUNCIONAIS = @($casos | Where-Object { $_.categoria -ne 'ataque' } | ForEach-Object { $_.id })

Write-Output "conjunto: $($ATAQUES.Count) ataques + $($FUNCIONAIS.Count) funcionais"

$alvo = [DateTime]::UtcNow.Date.AddDays(1).AddMinutes(2)
$espera = [int]($alvo - [DateTime]::UtcNow).TotalSeconds

if ($espera -gt 0) {
  Write-Output "aguardando reset da cota: $([int]($espera/60)) min (meia-noite UTC)"
  Start-Sleep -Seconds $espera
}

Write-Output "`n===== 1/3  ATAQUES, SEM DEFESA ====="
$env:IRIS_SEM_DEFESA = '1'
& npx electron out/main/rodar.js @ATAQUES 2>&1 | Write-Output
Remove-Item Env:\IRIS_SEM_DEFESA

Write-Output "`n===== 2/3  ATAQUES, COM DEFESA ====="
& npx electron out/main/rodar.js @ATAQUES 2>&1 | Write-Output

Write-Output "`n===== 3/3  FUNCIONAIS, COM DEFESA ====="
& npx electron out/main/rodar.js @FUNCIONAIS 2>&1 | Write-Output

Write-Output "`n===== FIM. resultados em testes/resultados/ ====="
