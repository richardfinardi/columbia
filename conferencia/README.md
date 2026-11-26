# Columbia | Conferência de materiais de revenda

Interface publicada no menu Columbia, com a **mesma permissão da Conferência antiga**: CSENHA.\`U_ANALISTA_CADASTRO = 1\`.
A página valida o usuário por \`GET /producao/portal/me\`. O botão do menu também respeita a permissão.

## Consulta dos dados

### Fornecedor da última NF de entrada
O frontend exibe, na mesma célula de **Última NF / datas**, o nome do fornecedor, o número da NF, a emissão e a data da entrada. O nome é consultivo, sem qualquer alteração na rotina de gravação.

O endpoint `GET /revenda` deve retornar o campo JSON `fornecedor_ultima_entrada` **referente à mesma última NF** que gerou `ncm_ultima_entrada`, `ultima_nf_entrada` e as datas. Dentro do `LEFT JOIN LATERAL` que seleciona a última nota, acrescente:

```sql
LEFT JOIN tfornece forn
  ON forn.cod_empresa = co.cod_empresa
 AND forn.codigo = co.cod_fornecedor
```

E na lista de campos da subconsulta da última nota:

```sql
forn.nome AS fornecedor_ultima_entrada
```

Inclua `ultima_nf.fornecedor_ultima_entrada` no `SELECT` principal. Os nomes dos aliases `co` e `ultima_nf` devem corresponder aos usados na SQL do endpoint. Confirmar que o cadastro TFORNECE tem o campo `nome` (não há inspeção direta ao esquema do banco). O filtro por coluna e a pesquisa global incluem o fornecedor.



| Endpoint GET (na API Columbia) | Uso |
| --- | --- |
| \`/revenda\` | Materiais de revenda ativos. Empresa 1, família 20, reposição 0. |
| \`/ncm\` | Catálogo CPS de NCM: código interno, número, descrição, IPI. |
| \`/cbsibs\` | Catálogo CPS de classificações tributárias CBS/IBS. |

Os três devem responder em JSON com lista de registros. A página aceita lista direta ou objeto com propriedade \`data\`, \`dados\`, \`items\`, \`resultados\` etc.

**Comportamento:**
- Listagem com filtros **no cabeçalho de cada coluna** (mesmo modelo da Sintercan / Material de Cliente), busca incremental, seleção múltipla de valores, Selecionar tudo, Limpar e Aplicar, ordenação, paginação e cards total/pendente/revisado/progresso.
- **Não exibir exportação/download CSV ou Excel**: a conferência e as alterações devem ocorrer no próprio portal.
- Filtros incluem `grupo`, `subgrupo1` e `subgrupo2`, trazidos do endpoint `/revenda`.
- Seleção por linha, página ou todos os filtrados, com **alteração em massa** de NCM, CBS/IBS, GTIN, benefício fiscal e revisão. Apenas campos marcados são alterados.
- **Lote em massa:** aplica os valores escolhidos aos campos marcados, mesmo que o cadastro tenha mudado depois da consulta. Não confere snapshots antigos por material, mas usa transação, bloqueio de linhas, validação de NCM/CBS e escopo fixo da revenda. Campos não selecionados não são gravados. Confirmação explícita no portal.
- **Edição individual:** mantém verificação de concorrência (HTTP 409) e agora informa os campos divergentes. Comparação numérica aceita BOOLEAN em U_REVISADO.
- Regra de interface para as próximas tabelas da Columbia: usar esse mesmo filtro compacto por coluna.
- NCM: seleção pesquisável por código ou descrição. Puxa da tabela fiscal \`tcla_fis\` os valores \`codigo\`, \`numero\`, \`descricao\` e \`ipi\`.
- CBS/IBS: seleção pesquisável na tabela \`tclasstrib_cbsibs\`, código \`codigo_cclastrib\` e respectiva descrição.
- GTIN (\`cean_i03\`) e código benefício fiscal (\`cbenef_i05f\`) são digitáveis.
- \`Salvar sem concluir\` grava o cadastro com \`u_revisado = 0\`.
- \`Salvar e concluir revisão\` grava o cadastro e define \`u_revisado = 1\`.
- Revisados podem ser abertos novamente.
- Nenhuma alteração é simulada no front. O status só é atualizado após resposta bem-sucedida do servidor e releitura dos dados.

## Escrita: instalar a rota no FastAPI do servidor Columbia

A interface GitHub Pages é estática. **Os 3 GETs informados não atualizam tproduto**.
O módulo [revenda_routes.py](./revenda_routes.py) é uma implementação modular de referência; a integração principal foi adaptada ao `api.py` real do servidor, preservando todas as rotas existentes. A implantação da API atualizada no servidor que hospeda \`columbia.consultoriarf.net\` ainda é necessária.

Rota:
\`POST https://columbia.consultoriarf.net/revenda/atualizar\`

O backend:
- autentica o Bearer, aplica a permissão \`U_ANALISTA_CADASTRO\` no servidor;
- fixa \`cod_empresa=1\`, \`cod_familia=20\`, \`metodo_reposicao=0\`, \`inativo=0\`, impedindo atualização fora da revenda;
- bloqueia concorrência (snapshot + \`SELECT ... FOR UPDATE\`);
- verifica o NCM em \`tcla_fis\`, preenchendo diretamente número, descrição e IPI;
- verifica o código CBS/IBS em \`tclasstrib_cbsibs\`, preenchendo diretamente a descrição;
- grava os demais campos digitados e \`u_revisado\` em uma única transação;
- confirma \`{"ok":true,"codigo":123,"u_revisado":1}\`.

### Exemplo de montagem (adaptar ao FastAPI existente)

Importe \`revenda_routes.py\` na aplicação principal da API da Columbia (a que contém \`GET /revenda\`). Não crie outro \`FastAPI()\`.

~~~python
import os
import psycopg2
from fastapi import Depends
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from revenda_routes import build_revenda_router

bearer = HTTPBearer()

def usuario_columbia(
    cred: HTTPAuthorizationCredentials = Depends(bearer),
):
    # SUBSTITUIR pela validação real do TOKEN da Columbia.
    # Deve retornar o usuário e as permissões CSENHA carregadas do servidor.
    return validar_token_columbia_existente(cred.credentials)

def conexao_cps():
    # Preferir a função de conexão PostgreSQL já usada pelos GETs.
    # A variável de ambiente deve existir somente no servidor.
    return psycopg2.connect(os.environ["CPS_POSTGRES_DSN"])

app.include_router(
    build_revenda_router(
        user_dependency=usuario_columbia,
        connection_factory=conexao_cps,
    )
)
~~~

A função \`validar_token_columbia_existente\` do exemplo **não existe neste repositório**: use a dependência autenticadora que o servidor já utiliza. NÃO retorne \`{"u_analista_cadastro": 1}\` fixo e nunca confie apenas em permissões do localStorage.

**CORS:** no servidor permitir origem \`https://consultoriarf.net\`, \`POST\` e \`OPTIONS\`, cabeçalho \`Authorization\` e \`Content-Type\` para a rota nova. Preservar as restrições atuais; não liberar \`*\` indiscriminadamente.

**Banco:** nenhuma tabela nova é necessária. Conferir os comprimentos dos campos CPS \`cean_i03\`, \`cbenef_i05f\` e \`cclass_trib_ibscbs\` antes de publicar em produção. A função usa \`psycopg2\`/\`psycopg\` (parâmetro \`%s\`) e transação PostgreSQL. Todos os valores gravados são parametrizados.

### Exemplo de body

~~~json
{
  "codigo": 123,
  "ncm_codigo": 55,
  "cbs_codigo": "000001",
  "cean_i03": "7891234567890",
  "cbenef_i05f": "",
  "revisado": true,
  "esperado": {
    "cod_classificacao_fiscal": 55,
    "classificacao_fiscal": "73089090",
    "descricao_classi_fiscal": "DESCRICAO",
    "ipi": 0,
    "cean_i03": "",
    "cbenef_i05f": "",
    "cclass_trib_ibscbs": "000001",
    "desc_cclass_trib_ibscbs": "DESCRICAO CBS",
    "u_revisado": 0
  }
}
~~~

O objeto \`esperado\` é construído automaticamente no front a partir do GET; não é digitado pelo usuário. Se outro usuário alterar o material entre leitura e gravação, retorna HTTP 409.

## Verificações antes de dar a implementação por concluída

1. Validar respostas reais dos três GETs, incluindo caracteres, tipos e CORS.
2. Instalar e reiniciar a API com o router de gravação.
3. Testar usuário com permissão e usuário sem \`U_ANALISTA_CADASTRO\` (esperado 403).
4. Fazer gravação controlada em um material de teste; conferir NCM, IPI, CBS e \`U_REVISADO\` diretamente em \`TPRODUTO\`.
5. Testar salvar sem concluir, concluir, reabrir e corrigir um material revisado.
6. Testar duas sessões editando o mesmo registro (esperado 409 na segunda).
7. Conferir uso no celular, barra de rolagem horizontal e pesquisa nas tabelas de referência.

## Backup da tela anterior
Branch: \`backup/conferencia-2026-11-19\`, arquivo \`conferencia/index.html\`.
A nova implementação não altera nem apaga o backup.
