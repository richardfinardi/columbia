# Columbia Machine - Agendador WhatsApp 18:30 (horario de Brasilia)
# Execute no SERVIDOR Columbia, em PowerShell como o usuario que executa a API.
# A chave da AUVRIUN nunca vai para o GitHub ou para argumentos da tarefa.
$ErrorActionPreference = 'Stop'
$taskName = 'COLUMBIA - Fechamento Horas WhatsApp'
$target = 'C:\api-dados\columbia_whatsapp_agendador.py'

Write-Host ''
Write-Host 'COLUMBIA - INSTALACAO DO WHATSAPP AUTOMATICO' -ForegroundColor Cyan
if (-not (Test-Path -LiteralPath $target)) {
    throw "Arquivo ausente: $target. Copie-o do GitHub antes de instalar."
}
# WindowsApps/python.exe pode ser apenas o atalho da Microsoft Store.
# Prioriza o Python real, com httpx instalado, para executar o agendador.
$paths = New-Object 'System.Collections.Generic.List[string]'
$launcher = Get-Command py -ErrorAction SilentlyContinue
if ($launcher) {
    try {
        $resolved = & $launcher.Source -c 'import sys; print(sys.executable)' 2>$null
        if ($LASTEXITCODE -eq 0 -and $resolved) { $paths.Add(([string]$resolved).Trim()) }
    } catch {}
}
Get-Command python.exe -All -ErrorAction SilentlyContinue | ForEach-Object {
    if ($_.Source -and $_.Source -notlike '*\\WindowsApps\\*') { $paths.Add($_.Source) }
}
Get-ChildItem -Path (Join-Path $env:LOCALAPPDATA 'Programs\Python\Python*\python.exe') -ErrorAction SilentlyContinue | ForEach-Object {
    $paths.Add($_.FullName)
}
$pythonPath = $null
foreach ($candidate in ($paths | Select-Object -Unique)) {
    if (-not (Test-Path -LiteralPath $candidate)) { continue }
    try {
        & $candidate -c 'import httpx' 2>$null
        if ($LASTEXITCODE -eq 0) { $pythonPath = $candidate; break }
    } catch {}
}
if (-not $pythonPath) {
    throw "Python REAL com httpx nao localizado. Execute no servidor: py -0p"
}
Write-Host "Python verificado: $pythonPath"

$login = Read-Host "Usuario do GRV Columbia que possui CSENHA.U_HORAS=1"
if ([string]::IsNullOrWhiteSpace($login)) { throw "O usuario e obrigatorio." }

Write-Host ''
Write-Host 'Copie a chave da AUVRIUN (auv_...) para a area de transferencia.' -ForegroundColor Cyan
Write-Host 'Nao precisa colar no PowerShell. O instalador vai ler a chave copiada.'
Read-Host 'Depois de copiar a chave, pressione ENTER aqui' | Out-Null
$clipboard = [string](Get-Clipboard -Raw)
$matchesFound = [regex]::Matches($clipboard, '(?<![A-Za-z0-9_-])auv_[A-Za-z0-9_-]{43}(?![A-Za-z0-9_-])')
if ($matchesFound.Count -ne 1) {
    throw "Nao consegui localizar UMA chave no clipboard. No Bloco de Notas, selecione apenas a linha que comeca com auv_, pressione Ctrl+C e execute novamente."
}
$key = $matchesFound[0].Value
Write-Host 'Chave localizada, formato validado (sem exibir o valor).' -ForegroundColor Green
Remove-Variable clipboard, matchesFound -ErrorAction SilentlyContinue

# Ambiente do usuario, evita chave escrita nos argumentos da tarefa.
[Environment]::SetEnvironmentVariable('AUVRIUN_COLUMBIA_KEY', $key, 'User')
[Environment]::SetEnvironmentVariable('COLUMBIA_HORAS_SERVICE_USER', $login, 'User')
$env:AUVRIUN_COLUMBIA_KEY = $key
$env:COLUMBIA_HORAS_SERVICE_USER = $login
Remove-Variable -Name key -ErrorAction SilentlyContinue

Write-Host ''
Write-Host 'Verificando dependencias e dados SEM ENVIAR WhatsApp...' -ForegroundColor Yellow
& $pythonPath $target --preview
if ($LASTEXITCODE -ne 0) {
    throw "A simulacao falhou. A tarefa NAO sera instalada. Corrija o erro acima."
}

$account = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$action = New-ScheduledTaskAction -Execute $pythonPath -Argument ('"{0}"' -f $target) -WorkingDirectory 'C:\api-dados'
$trigger = New-ScheduledTaskTrigger -Daily -At '18:30'
$principal = New-ScheduledTaskPrincipal -UserId $account -LogonType S4U -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 40)
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description 'Dispara relatorios Columbia pelo WhatsApp AUVRIUN. Diario seg-sex, semanal segunda, mensal dia 1.' -Force | Out-Null

Write-Host ''
Write-Host 'TAREFA CRIADA COM SUCESSO.' -ForegroundColor Green
Write-Host "Nome: $taskName"
Write-Host 'Horario diario: 18:30 (horario local do servidor)'
Write-Host 'Envio diario: segunda a sexta, do dia atual'
Write-Host 'Envio semanal: segunda-feira, sobre segunda a domingo anteriores'
Write-Host 'Envio mensal: dia 1, sobre o mes anterior'
Write-Host 'Repeticoes do mesmo periodo sao bloqueadas pela Central AUVRIUN.'
Write-Host "Para conferir: Get-ScheduledTask -TaskName '$taskName'"
