# LIMPAR_API_COLUMBIA.ps1
# Auditoria da pasta + quarentena reversivel. NUNCA apaga arquivos.
# Executar: powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\api-dados\LIMPAR_API_COLUMBIA.ps1
param(
    [string]$PastaApi = "C:\api-dados",
    [string]$PastaArquivo = "C:\_Columbia_Arquivados",
    [switch]$Simular
)
$ErrorActionPreference = "Stop"
$PastaApi = [IO.Path]::GetFullPath($PastaApi).TrimEnd("\")
$PastaArquivo = [IO.Path]::GetFullPath($PastaArquivo).TrimEnd("\")
if (!(Test-Path -LiteralPath (Join-Path $PastaApi "api.py") -PathType Leaf)) { throw "Arquivo api.py nao encontrado na pasta solicitada." }
if (!(Test-Path -LiteralPath (Join-Path $PastaApi "iniciar_columbia_PRODUCAO.bat") -PathType Leaf)) { throw "Inicializador de producao nao encontrado. Nada sera movido." }
if ($PastaArquivo.StartsWith($PastaApi + "\", [StringComparison]::OrdinalIgnoreCase)) { throw "PastaArquivo deve ficar FORA da pasta da API." }
if ($PastaArquivo.TrimEnd("\").Equals($PastaApi,[StringComparison]::OrdinalIgnoreCase)) { throw "Nao use a pasta da API como destino." }

# VALIDACAO: nenhuma alteracao de codigo, SQL, cache, banco, tunnel ou arquivos de credenciais.
# Preservados explicitamente: api.py, auth.py, conexao.py, permissoes_columbia.py,
# horas_disponiveis_columbia.py, inventario_columbia.py, pcp_portal_routes.py,
# columbia_whatsapp_agendador.py, watchdog.py, email_config.py,
# SQL/, cache/, dados/, whatsapp_horas_dados/, cloudflared.exe,
# app_erros.log, iniciar_columbia_PRODUCAO.bat, restart.bat e iniciar_watchdog.bat.
$pastasCandidatas = @("__pycache__", "build", "dist", "bkp")
$arquivosCandidatos = @(
    "api - Copia.py",
    "BKP20261015_api.py",
    "bkp-bkp-api.py",
    "SQL.zip",
    "COLUMBIA_PRODUCAO_DIVIDIDA.zip",
    "api.spec",
    "APP_TESTE_HTTP_INVENTARIO.py",
    "EXECUTAR_HOMOLOGACAO_HTTP.bat",
    "EXECUTAR_TESTES_TRAVAS.bat",
    "EXECUTAR_TESTE_19-01-00572.bat",
    "GERAR_BATS_E_CHAVES.bat",
    "GERAR_BATS_E_CHAVES.py",
    "INSTALAR_CONTROLE_APLICAR_CPS_V34.bat",
    "INSTALAR_CONTROLE_APLICAR_CPS_V34.py",
    "INSTRUCOES_V34.txt",
    "TESTAR_ENDPOINT_PUBLICO.bat",
    "TESTAR_ENDPOINT_PUBLICO.py",
    "TESTAR_HTTP_INVENTARIO.py",
    "TESTAR_SEM_DEPOSITO.py",
    "TESTAR_SEM_DEPOSITO_19-01-00572.py",
    "iniciar_columbia_BLOQUEADO.bat",
    "iniciar_columbia_BLOQUEADO_NOVAS_CHAVES.bat",
    "iniciar_columbia_TESTE_29633.bat",
    "iniciar_columbia_TESTE_PUBLICO.bat",
    "simulacao_inventario_29633.json",
    "testar_inventario_29633.py",
    "testar_travas_inventario.py",
    "teste_http_inventario_uvicorn.log",
    "teste_inventario.json",
    "contagem_exemplo.json",
    "cliente_exemplo.py",
    "ATUALIZAR_U_HORAS.py"
)
# Backups antigos: jamais o arquivo ativo api.py/auth.py.
$extras = Get-ChildItem -LiteralPath $PastaApi -File -ErrorAction Stop | Where-Object {
    $_.Name -like "api.py.backup_*" -or $_.Name -like "auth_backup_*.py"
} | Select-Object -ExpandProperty Name
if ($extras) { $arquivosCandidatos += @($extras) }

$referencias = @()
$leituraAgendamentosOk = $false
try {
    $tasks = @(Get-ScheduledTask -ErrorAction Stop)
    foreach ($t in $tasks) {
        foreach ($a in $t.Actions) {
            $referencias += ([string]$a.Execute + " " + [string]$a.Arguments + " " + [string]$a.WorkingDirectory)
        }
    }
    $leituraAgendamentosOk = $true
} catch {
    Write-Warning "Nao foi possivel auditar todas as tarefas agendadas. Arquivos de testes e pastas compiladas serao preservados."
}
$processos = @()
$leituraProcessosOk = $false
try {
    $processos = @(Get-CimInstance Win32_Process -ErrorAction Stop | ForEach-Object {
        ([string]$_.ExecutablePath + " " + [string]$_.CommandLine)
    })
    $leituraProcessosOk = $true
} catch {
    Write-Warning "Nao foi possivel auditar processos. Pastas compiladas serao preservadas."
}
function Referenciado([string]$relativo) {
    $full = Join-Path $PastaApi $relativo
    $alvo = $relativo.Replace("/", "\")
    foreach ($linha in ($referencias + $processos)) {
        if ($linha.IndexOf($full,[StringComparison]::OrdinalIgnoreCase) -ge 0) { return $true }
        $semAspas = $linha.Replace('"', ' ').Replace("'", ' ').Replace("`t", ' ')
        $partes = $semAspas.Split([char[]]@(' ', ';', ',', '=', '(', ')', '&'), [StringSplitOptions]::RemoveEmptyEntries)
        foreach ($p in $partes) {
            $n = $p.Replace("/", "\")
            if ($n.Equals($alvo,[StringComparison]::OrdinalIgnoreCase) -or
                $n.EndsWith("\" + $alvo,[StringComparison]::OrdinalIgnoreCase) -or
                $n.IndexOf("\" + $alvo + "\",[StringComparison]::OrdinalIgnoreCase) -ge 0) {
                return $true
            }
        }
    }
    return $false
}
# Conservador: se o agendamento for desconhecido, nao mexer nos testes antigos.
$lista = @()
foreach ($pasta in $pastasCandidatas) {
    $caminho = Join-Path $PastaApi $pasta
    if (!(Test-Path -LiteralPath $caminho -PathType Container)) { continue }
    if ($pasta -in @("build", "dist") -and (!$leituraAgendamentosOk -or !$leituraProcessosOk)) {
        Write-Warning "PRESERVADO ${pasta}: nao foi possivel confirmar ausencia de referencias."
        continue
    }
    if (Referenciado $pasta) {
        Write-Warning "PRESERVADO ${pasta}: referenciado por processo/tarefa agendada."
        continue
    }
    $lista += [pscustomobject]@{ Relativo = $pasta; Caminho = $caminho; Tipo = "Pasta" }
}
foreach ($arquivo in ($arquivosCandidatos | Select-Object -Unique)) {
    $caminho = Join-Path $PastaApi $arquivo
    if (!(Test-Path -LiteralPath $caminho -PathType Leaf)) { continue }
    if ($arquivo -like "*.bat" -and !$leituraAgendamentosOk) {
        Write-Warning "PRESERVADO ${arquivo}: tarefas agendadas nao auditadas."
        continue
    }
    if (Referenciado $arquivo) {
        Write-Warning "PRESERVADO ${arquivo}: referenciado por processo/tarefa agendada."
        continue
    }
    $lista += [pscustomobject]@{ Relativo = $arquivo; Caminho = $caminho; Tipo = "Arquivo" }
}
$execucao = Get-Date -Format "yyyyMMdd_HHmmss"
$destinoExecucao = Join-Path $PastaArquivo $execucao
$registros = New-Object System.Collections.Generic.List[object]
$contador = 0
$falhas = 0
$bytes = 0L
foreach ($item in $lista) {
    $nbytes = if ($item.Tipo -eq "Arquivo") {
        (Get-Item -LiteralPath $item.Caminho).Length
    } else {
        $total = 0L
        Get-ChildItem -LiteralPath $item.Caminho -File -Recurse -Force -ErrorAction Stop | ForEach-Object { $total += $_.Length }
        $total
    }
    $bytes += $nbytes
    $caminhoDestino = Join-Path $destinoExecucao $item.Relativo
    if ($Simular) {
        Write-Host ("[SIMULAR] {0} ({1:N2} MB)" -f $item.Relativo, ($nbytes/1MB))
    } else {
        try {
            New-Item -ItemType Directory -Path $destinoExecucao -Force | Out-Null
            Move-Item -LiteralPath $item.Caminho -Destination $caminhoDestino -ErrorAction Stop
            if (!(Test-Path -LiteralPath $caminhoDestino)) { throw "Arquivo nao chegou a quarentena" }
            Write-Host ("[ARQUIVADO] {0} ({1:N2} MB)" -f $item.Relativo, ($nbytes/1MB)) -ForegroundColor Green
        } catch {
            Write-Warning ("Falha ao mover {0}: {1}" -f $item.Relativo, $_.Exception.Message)
            $falhas++
            continue
        }
    }
    $contador++
    $registros.Add([pscustomobject]@{
        Origem = $item.Caminho; Quarentena = $caminhoDestino;
        Tipo = $item.Tipo; Bytes = $nbytes
    })
}
if (!$Simular -and $registros.Count -gt 0) {
    $manifesto = Join-Path $destinoExecucao "MANIFESTO.csv"
    $registros | Export-Csv -LiteralPath $manifesto -NoTypeInformation -Encoding UTF8
    $restore = @'
param([string]$Manifesto = (Join-Path $PSScriptRoot "MANIFESTO.csv"))
$ErrorActionPreference = "Stop"
Import-Csv -LiteralPath $Manifesto | ForEach-Object {
    if (Test-Path -LiteralPath $_.Origem) {
        Write-Warning "Ja existe: $($_.Origem). Restauracao interrompida para evitar sobrescrita."
        return
    }
    if (Test-Path -LiteralPath $_.Quarentena) {
        Move-Item -LiteralPath $_.Quarentena -Destination $_.Origem -ErrorAction Stop
        Write-Host "Restaurado $($_.Origem)"
    }
}
'@
    [IO.File]::WriteAllText((Join-Path $destinoExecucao "RESTAURAR.ps1"),$restore,[Text.UTF8Encoding]::new($false))
}
Write-Host ""
Write-Host ("Arquivos/pastas processados: {0}, falhas: {1}" -f $contador, $falhas)
Write-Host ("Tamanho identificado: {0:N2} MB" -f ($bytes/1MB))
if ($Simular) { Write-Host "SIMULACAO: nada foi alterado." -ForegroundColor Yellow }
else {
    Write-Host ("Quarentena: {0}" -f $destinoExecucao) -ForegroundColor Cyan
    Write-Host "Nenhum arquivo foi excluido. SQL, credenciais, logs ativos, caches e banco permaneceram intactos."
    Write-Host "Nao precisa reiniciar a API."
}
