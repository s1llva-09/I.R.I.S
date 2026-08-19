# Espera a cota virar (meia-noite UTC) e roda o experimento da contribuicao A.
#
#   powershell -File testes/rodada-completa.ps1
#
# ORCAMENTO: 45 chamadas/dia, e um caso custa ~1.5. Os 15 casos nos dois
# bracos dariam ~45-60 — estoura. Entao a ordem aqui e por VALOR:
#
#   1. os 7 ataques SEM defesa   <- a metade da tabela que nao existe
#   2. os 7 ataques COM defesa   <- o par, medido no mesmo dia e mesmo build
#   3. os funcionais COM defesa  <- prova que a defesa nao quebrou o uso normal
#
# Se a cota acabar, ela acaba no passo 3, que e o unico que ja tem dado
# parcial de antes. Os passos 1 e 2 sao o grafico do capitulo: precisam
# fechar juntos ou nao valem nada.

$ErrorActionPreference = 'Continue'
Set-Location $PSScriptRoot\..

$ATAQUES = @(
  'injecao-01', 'injecao-02', 'injecao-03', 'injecao-04', 'injecao-05',
  'memoria-01', 'memoria-03'
)
$FUNCIONAIS = @(
  'ferramenta-unica-01', 'ferramenta-unica-02', 'ferramenta-unica-03',
  'multipla-01', 'sem-ferramenta-01', 'nivel3-01', 'memoria-02', 'memoria-04'
)

$alvo = [DateTime]::UtcNow.Date.AddDays(1).AddMinutes(2)
$espera = [int]($alvo - [DateTime]::UtcNow).TotalSeconds

if ($espera -gt 0) {
  Write-Output "aguardando reset da cota: $([int]($espera/60)) min (meia-noite UTC)"
  Start-Sleep -Seconds $espera
}

Write-Output "`n===== 1/3  ATAQUES, SEM DEFESA ====="
$env:IZZE_SEM_DEFESA = '1'
& npx electron out/main/rodar.js @ATAQUES 2>&1 | Write-Output
Remove-Item Env:\IZZE_SEM_DEFESA

Write-Output "`n===== 2/3  ATAQUES, COM DEFESA ====="
& npx electron out/main/rodar.js @ATAQUES 2>&1 | Write-Output

Write-Output "`n===== 3/3  FUNCIONAIS, COM DEFESA ====="
& npx electron out/main/rodar.js @FUNCIONAIS 2>&1 | Write-Output

Write-Output "`n===== FIM. resultados em testes/resultados/ ====="
