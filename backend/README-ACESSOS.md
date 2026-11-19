# Columbia | Gerenciamento de acessos CSENHA

A pagina `gerenciar-acessos.html` reaproveita o login atual do portal e aparece no menu
somente para usuarios com `CSENHA.U_GESTOR = 1`.

## Arquivos
- `/gerenciar-acessos.html`: interface de gestao de permissoes.
- `/index.html`: icone de escudo ao lado do usuario (apenas gestores).
- `/backend/permissoes_columbia.py`: API isolada, usando `conexao.get_conn` e o JWT existente.
- `/backend/INSTALAR_GERENCIADOR.ps1`: instalacao segura no Windows.

## Instalar backend (uma vez)
Na maquina Columbia, salve o arquivo `backend/INSTALAR_GERENCIADOR.ps1` e execute:
```powershell
powershell.exe -ExecutionPolicy Bypass -File .\INSTALAR_GERENCIADOR.ps1
```
Ele copia `permissoes_columbia.py` para `C:\api-dados`, faz backup de `api.py`,
registra o novo router sem remover rotas e valida a sintaxe. Reinicie o `start.bat`
ja existente. Caso o Python nao importe o modulo, o script restaura o `api.py`.

## Regras
- Empresa 1, usuarios ativos de CSENHA.
- 11 permissoes: ANALISTA_CADASTRO, ANEXO, CUSTOS, ENGENHARIA, FATURAMENTO,
  FINALIZACAO, NOTAS, PCP, VENDEDOR, HORAS e GESTOR.
- GET `/producao/permissoes/me`: valida JWT e consulta GESTOR diretamente no banco.
- GET `/producao/permissoes/usuarios`: exige JWT valido + U_GESTOR atual no banco.
- PATCH `/producao/permissoes/usuarios/{codigo}`: exige JWT valido + U_GESTOR
  atual no banco, aceita apenas campos oficiais com 0 ou 1.
- Bloqueia tentativa de remover o ultimo gestor ativo.
- Permite salvar por usuario ou todos os pendentes, com confirmacao ao alterar gestor.
- A autorizacao fica **na API**; ocultar icone no portal e somente melhoria visual.
- As alteracoes podem requerer novo login dos usuarios, pois os outros endpoints
  do portal continuam usando as permissoes registradas no JWT por 8 horas.

O gerenciador nao modifica `auth.py` nem o sistema de login.
A tela nao aparece funcional ate a inclusao do router no servidor Windows.
