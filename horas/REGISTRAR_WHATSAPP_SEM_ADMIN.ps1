# Columbia Machine - Cadastro de tarefa sem permissao administrativa.
# Executar com a MESMA conta Windows que instalou as variaveis do WhatsApp.
# Usa somente a propria sessao do usuario e o nivel LIMITED (sem elevacao).
$ErrorActionPreference = 'Stop'
$taskName = 'COLUMBIA - Fechamento Horas WhatsApp'
$target = 'C:\api-dados\columbia_whatsapp_agendador.py'
if (-not (Test-Path -LiteralPath $target)) {
    throw "Arquivo nao encontrado: $target"
}
$storedKey = [Environment]::GetEnvironmentVariable('AUVRIUN_COLUMBIA_KEY', 'User')
$storedUser = [Environment]::GetEnvironmentVariable('COLUMBIA_HORAS_SERVICE_USER', 'User')
if ([string]::IsNullOrWhiteSpace($storedKey) -or [string]::IsNullOrWhiteSpace($storedUser)) {
    throw 'Variaveis da integracao nao foram localizadas no perfil desta conta Windows. Execute o instalador original com este usuario para salva-las.'
}
Remove-Variable storedKey -ErrorAction SilentlyContinue

$paths = New-Object 'System.Collections.Generic.List[string]'
$launcher = Get-Command py -ErrorAction SilentlyContinue
if ($launcher) {
    try {
        $resolved = & $launcher.Source -c 'import sys; print(sys.executable)' 2>$null
        if ($LASTEXITCODE -eq 0 -and $resolved) { $paths.Add(([string]$resolved).Trim()) }
    } catch {}
}
Get-Command python.exe -All -ErrorAction SilentlyContinue | ForEach-Object {
    if ($_.Source -and $_.Source -notlike '*\WindowsApps\*') { $paths.Add($_.Source) }
}
$local = Join-Path $env:LOCALAPPDATA 'Python'
Get-ChildItem -LiteralPath $local -Filter python.exe -Recurse -File -ErrorAction SilentlyContinue | ForEach-Object { $paths.Add($_.FullName) }
$pythonPath = $null
foreach ($candidate in ($paths | Select-Object -Unique)) {
    if (-not (Test-Path -LiteralPath $candidate)) { continue }
    try {
        & $candidate -c 'import httpx' 2>$null
        if ($LASTEXITCODE -eq 0) { $pythonPath = $candidate; break }
    } catch {}
}
if (-not $pythonPath) { throw 'Nao foi encontrado Python instalado com httpx.' }
Write-Host "Python: $pythonPath"
Write-Host "Conta Windows atual: $([Security.Principal.WindowsIdentity]::GetCurrent().Name)"
Write-Host 'Cadastrando tarefa sem elevacao para a propria conta...'

$action = New-ScheduledTaskAction -Execute $pythonPath -Argument ('"{0}"' -f $target) -WorkingDirectory 'C:\api-dados'
$trigger = New-ScheduledTaskTrigger -Daily -At '18:30'
$account = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$principal = New-ScheduledTaskPrincipal -UserId $account -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 40)
try {
    Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description 'Fechamento Columbia via WhatsApp AUVRIUN; somente na sessao interativa desta conta.' -Force -ErrorAction Stop | Out-Null
} catch {
    Write-Host ''
    Write-Host 'O Windows bloqueou o cadastro da tarefa para usuarios comuns.' -ForegroundColor Yellow
    Write-Host 'Nao foi instalado nenhum metodo alternativo de envio.' -ForegroundColor Yellow
    Write-Host ("Detalhe: " + $_.Exception.Message)
    exit 2
}
$task = Get-ScheduledTask -TaskName $taskName -ErrorAction Stop
$info = Get-ScheduledTaskInfo -TaskName $taskName -ErrorAction Stop
Write-Host ''
Write-Host 'TAREFA REGISTRADA COM SUCESSO' -ForegroundColor Green
Write-Host ("Nome: " + $task.TaskName)
Write-Host ("Estado: " + $task.State)
Write-Host ("Proxima execucao: " + $info.NextRunTime)
Write-Host 'Horario: 18:30 (horario local do servidor).'
Write-Host 'IMPORTANTE: essa tarefa roda somente quando esta conta Windows permanece logada.'
Write-Host 'Desconectar o RDP sem encerrar a sessao geralmente a preserva; fazer logoff encerra.'
