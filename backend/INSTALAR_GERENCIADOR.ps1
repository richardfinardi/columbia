# Instala o gerenciador CSENHA no backend Columbia, preservando o api.py.
# Execute na maquina Windows onde a API roda, com acesso a pasta C:\api-dados.
param([string]$PastaApi = "C:\api-dados")
$ErrorActionPreference = "Stop"
$arquivoApi = Join-Path $PastaApi "api.py"
$arquivoModulo = Join-Path $PastaApi "permissoes_columbia.py"
$origem = "https://raw.githubusercontent.com/richardfinardi/columbia/main/backend/permissoes_columbia.py"
if (!(Test-Path -LiteralPath $arquivoApi)) { throw "Nao encontrei o api.py em $PastaApi" }

[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$temporario = "$arquivoModulo.download"
try {
    # O curl.exe costuma funcionar onde Invoke-WebRequest apresenta erro SSL/TLS.
    & curl.exe --fail --silent --show-error --location --max-time 35 --output $temporario $origem
    if ($LASTEXITCODE -ne 0) { throw "Falha ao baixar o modulo do GitHub." }
    if (!(Test-Path $temporario) -or (Get-Item $temporario).Length -lt 4000) {
        throw "O modulo baixado esta vazio ou incompleto."
    }
    $conteudoModulo = Get-Content -LiteralPath $temporario -Raw -Encoding UTF8
    if (!$conteudoModulo.Contains("router = APIRouter(")) {
        throw "O arquivo baixado nao tem o formato esperado."
    }

    $codigoAtual = Get-Content -LiteralPath $arquivoApi -Raw -Encoding UTF8
    $marca = "app.include_router(_horas_router)"
    $inclusao = "from permissoes_columbia import router as _permissoes_columbia_router`r`napp.include_router(_permissoes_columbia_router)"
    if (!$codigoAtual.Contains("app.include_router(_permissoes_columbia_router)")) {
        if (!$codigoAtual.Contains($marca)) {
            throw "O ponto de integracao nao foi localizado. O api.py nao foi alterado."
        }
    }

    $selo = Get-Date -Format "yyyyMMdd_HHmmss"
    $backup = "$arquivoApi.backup_acessos_$selo"
    Copy-Item -LiteralPath $arquivoApi -Destination $backup -ErrorAction Stop
    if (Test-Path $arquivoModulo) {
        Copy-Item -LiteralPath $arquivoModulo -Destination "$arquivoModulo.backup_$selo"
    }
    try {
        Move-Item -LiteralPath $temporario -Destination $arquivoModulo -Force
        if (!$codigoAtual.Contains("app.include_router(_permissoes_columbia_router)")) {
            $novoCodigo = $codigoAtual.Replace($marca, "$marca`r`n$inclusao")
            [System.IO.File]::WriteAllText($arquivoApi, $novoCodigo, [System.Text.UTF8Encoding]::new($false))
        }

        Push-Location $PastaApi
        try {
            $python = (Get-Command python.exe -ErrorAction SilentlyContinue)
            if ($null -eq $python) { throw "Python nao encontrado no PATH. Nenhuma alteracao da API sera mantida." }
            & $python.Source -m py_compile "api.py" "permissoes_columbia.py"
            if ($LASTEXITCODE -ne 0) { throw "O Python encontrou um erro de sintaxe." }
            & $python.Source -c "from permissoes_columbia import router; print('Modulo de permissoes OK')"
            if ($LASTEXITCODE -ne 0) { throw "Nao foi possivel importar o modulo de permissoes." }
        } finally { Pop-Location }
    } catch {
        Copy-Item -LiteralPath $backup -Destination $arquivoApi -Force
        throw
    }
    Write-Host ""
    Write-Host "Gerenciador instalado com sucesso." -ForegroundColor Green
    Write-Host "Backup original: $backup"
    Write-Host "Reinicie a API pelo start.bat que voce ja utiliza."
    Write-Host "Rotas: /producao/permissoes/me e /producao/permissoes/usuarios"
} finally {
    if (Test-Path $temporario) { Remove-Item -LiteralPath $temporario -Force }
}
