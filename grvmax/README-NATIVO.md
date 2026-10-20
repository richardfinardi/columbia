# GRVMAX — frontend nativo GitHub + API separada

## O que permanece preservado
- Banco Google Sheets original, sem trocar ID ou estrutura.
- Autenticação, histórico, permissões, comunicações e lembretes seguem no mesmo `Code.gs`.
- `grvmax/index.html` e `grvmax/app.html` originais **não foram alterados** nesta etapa.

## Pré-requisitos antes de ativar o frontend nativo
1. No projeto Apps Script `COLUMBIA_GRVMAX_API`, substituir `Código.gs` pelo `grvmax/Code.gs` atualizado no GitHub e publicar **Nova versão** da implantação existente, mantendo o mesmo endereço `/exec`. A mudança permite `POST` JSON, mantendo `google.script.run` para a versão antiga.
2. Implantar o Cloudflare Worker do diretório `grvmax/worker` (`npx wrangler deploy`, ou via painel Cloudflare), configurar variável secreta **GRVMAX_SCRIPT_URL** = endereço completo da implantação Apps Script (`https://script.google.com/macros/s/.../exec`). Nunca colocar token/senhas de usuários no worker, GitHub ou URL.
3. Configurar domínio personalizado **grvmax-api.consultoriarf.net** no Worker (ou alterar o endpoint em `grvmax/v2/index.html` conforme o domínio efetivamente criado).
4. Confirmar `https://grvmax-api.consultoriarf.net/health` com `configured:true`, e testar a chamada POST real (login, leitura e gravação de atividade de teste, log e envio) no `/columbia/grvmax/v2/`.
5. Somente após teste no computador e Android, substituir `grvmax/index.html` pelo conteúdo do `grvmax/v2/index.html`. O endereço público continua `https://consultoriarf.net/columbia/grvmax/`.

## Segurança
- Não usar `mode:no-cors`, JSONP, tokens por GET ou `iframe` para transportar comandos. Somente POST HTTPS para o Worker, que encaminha ao Apps Script no servidor.
- Worker aceita apenas origem `consultoriarf.net` e caminhos fixos; ações, permissões, senha e auditoria permanecem conferidos no `Code.gs`.
- O frontend `v2/index.html` é um snapshot fiel de `app.html` com troca do transporte e leitura dos parâmetros de convite diretamente pela URL.
- Não alterar as telas nem tabelas Columbia fora de GRVMAX.

## Rollback
- Backup integral do código na branch `backup/grvmax-before-native-20261020`.
- Se houver problema, manter/restaurar `grvmax/index.html` antigo. O Apps Script continua atendendo o fluxo antigo via `google.script.run`; não é preciso restaurar planilha.
