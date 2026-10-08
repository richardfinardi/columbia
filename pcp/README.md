# Columbia · Carteira PCP

Página: \`pcp/index.html\`, adicionada ao menu do repositório \`columbia\` sob permissão \`U_PCP=1\`.

## Origem dos dados

Utiliza o JSON já empregado em \`producao_columbia\`:

- \`GET https://columbia.consultoriarf.net/producao\`
- Número da OS: \`n_os\`
- Orçamento: \`n_orcamento\` ou \`orcamento\`
- Item: \`titulo\`, \`descricao\` ou \`cod_interno\`
- Cliente: \`cliente\`
- Segmento: \`segmento\` (fallback \`segmento_cliente\` ou \`classificacao_segmento\`)
- Previsão original: \`prev_entrega_os\`, com \`dt_previsao_entrega\` como fallback
- Renegociada: \`dt_renegociada\` ou \`u_data_renegociacao\`
- Valor: \`preco_geral_a_vista\`; fallback para \`valor\` ou \`vl_a_faturar\`
- Processos pendentes: \`pp_pendentes\`

A consolidação mantém uma linha por \`n_os\`, evitando duplicar valores caso o JSON retorne uma OS mais de uma vez. Se uma OS apresentar múltiplos textos distintos de processos pendentes, o app concatena os textos.

A alteração usa o PATCH **já existente** no módulo Produção Columbia:

\`PATCH /producao/{n_os}/alterar-renegociacao\`

JSON: \`{"u_data_renegociacao":"AAAA-MM-DD ou null","U_JUST_ALT_DT_REN":"[USUARIO] justificativa"}\`

A previsão original permanece intacta. A justificativa é obrigatória.

## Permissões e requisitos no backend

O frontend valida \`GET /producao/portal/me\` com o token Bearer e **nega acesso** se a API não responder, se o token for inválido ou se \`u_pcp\` não for exatamente \`1\`. O card aparece no menu somente quando o frontend identifica esta permissão.

**Atenção: página estática não é barreira de segurança de dados.** Para que o acesso seja efetivamente restrito, a API da Columbia precisa verificar o token e \`u_pcp=1\` no servidor também nos endpoints usados pelo PCP — inclusive \`GET /producao\` e \`PATCH /producao/{n_os}/alterar-renegociacao\` (ou equivalentes exclusivos de PCP). Como a API de produção é usada por outros módulos, não bloquear indiscriminadamente usuários legados; se necessário, crie rotas \`/producao/pcp/...\` exclusivas. **Esses controles de servidor não são implementados neste repositório de páginas estáticas.**

## Segmento
A coluna e o filtro Segmento usam o campo `segmento` no JSON de produção e seus aliases `segmento_cliente`, `u_segmento` e `classificacao_segmento`. Quando faltar o campo na OS, a tela busca o mesmo JSON `/faturamento_prod` do módulo Produção Columbia e procura correspondência por número da OS; na ausência, por nome de cliente **somente quando houver um único segmento inequívoco**. Valores realmente indisponíveis são apresentados como `Sem segmento` e ficam selecionáveis no filtro. Não criar nomes de segmentos fictícios.

## Desenhos técnicos anexos
A coluna **Anexos** aparece em cada OS quando o JSON retorna `anexos[]` com `cod_empresa`, `cod_os` e `cod_os_aux`. O botão abre um modal com os PDFs daquela OS, carregando cada arquivo no visualizador interno. A leitura reutiliza a rota de produção `GET /producao/desenho-anexo?cod_empresa=...&cod_os=...&cod_os_aux=...`, que devolve `pdf_base64`. Quem visualizar o link compartilhado deverá se autenticar e ter a permissão `u_pcp=1`. Validação de permissão e propriedade da OS deve ocorrer no backend.

## Link único para substituir o planejamento semanal em Excel
O botão **Gerar link** publica em **uma única URL** a seleção de OS filtradas ou marcadas. A tela desse link mantém todas as semanas de entrega em um mesmo planejamento, com:
- cartões semanais com período (segunda a domingo), quantidade de OS e total dos valores;
- cabeçalho separando cada semana na relação de OS, com as respectivas somas;
- as colunas OS, orçamento, item, cliente, segmento, previsão original, data renegociada, valor, processos pendentes e anexos;
- pesquisa, filtros, alteração justificada da renegociação, visualização de desenhos técnicos e exportação em Excel.

A semana é determinada pela data **renegociada**, caso exista, ou pela **previsão original da OS** quando não existe renegociação. OS sem previsão são agrupadas em "Sem data de entrega". O acesso ao link exige login com autorização PCP, não permite consulta pública.

Os números de OS são transmitidos na URL em forma compacta (`?osv=1....`) quando todos são inteiros, economizando espaço. Links antigos com `?os=...` continuam sendo aceitos. O limite atual é de 5.000 OS e 8.000 caracteres no link; para casos acima disso é necessário guardar a seleção no servidor. O link mantém o conjunto das OS; as datas são consultadas novamente, portanto uma OS renegociada pode mudar automaticamente de semana ao reabrir.

A interface usa linguagem de planejamento, sem termos técnicos como JSON ou API nas orientações e mensagens destinadas ao usuário. Esses detalhes ficam reservados ao código e à documentação.

## Verificações sugeridas para implantação

1. Entrar com usuário \`u_pcp=0\` e confirmar que o módulo não abre nem por URL direta.
2. Entrar com \`u_pcp=1\` e conferir algumas OS entre a produção e a nova carteira, inclusive campos nulos e renegociações.
3. Modificar e remover uma data com justificativa, verificar banco de dados e log do GRV.
4. Filtrar OS, gerar link, abrir em outro navegador deslogado, efetuar login e conferir a seleção exata.
5. Garantir via API a rejeição com HTTP 403 de leituras e escritas PCP por token sem a permissão.

Validação realizada na edição: sintaxe JavaScript verificada. Sem conexão com a API privada neste ambiente, a integração real e as permissões no backend precisam ser testadas na infraestrutura Columbia.
