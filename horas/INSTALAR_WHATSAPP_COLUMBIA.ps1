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
$pythonCommand = Get-Command python -ErrorAction Stop
$pythonPath = $pythonCommand.Source
if (-not (Test-Path -LiteralPath $pythonPath)) { throw "Python nao localizado: $pythonPath" }
Write-Host "Python: $pythonPath"

$login = Read-Host "Usuario do GRV Columbia que possui CSENHA.U_HORAS=1"
if ([string]::IsNullOrWhiteSpace($login)) { throw "O usuario e obrigatorio." }

$secure = Read-Host "Chave da aplicacao 'columbia' na AUVRIUN (auv_...)" -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try {
    $key = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
} finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
}
if ($key -notmatch '^auv_[A-Za-z0-9_-]{40,90}$') {
    throw "Chave da AUVRIUN invalida. Gere uma nova chave da aplicacao columbia."
}

# Ambiente do usuario, evita chave escrita nos argumentos da tarefa.
[Environment]::SetEnvironmentVariable('AUVRIUN_COLUMBIA_KEY', $key, 'User')
[Environment]::SetEnvironmentVariable('COLUMBIA_HORAS_SERVICE_USER', $login, 'User')
$env:AUVRIUN_COLUMBIA_KEY = $key
$env:COLUMBIA_HORAS_SERVICE_USER = $login
Remove-Variable -Name key, secure -ErrorAction SilentlyContinue

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
