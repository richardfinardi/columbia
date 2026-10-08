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

## Interface interna: planilha direta
A tela do usuário PCP **não exibe resumo por semana e não agrupa OS na tabela**. Mostra uma única planilha com filtros, ordenação, pesquisa, seleção, anexos, edição de data e botão para criar link de visualização.

O filtro **Entrega de / Entrega até** considera uma única data vigente para cada OS: **manual ativa, se houver; senão, reprogramada do GRV; caso contrário, original**. Se a data original é 13/10/2026 e a reprogramada é 01/12/2026, esta OS **não aparece** no período de outubro, somente no período de dezembro. Os limites do intervalo são inclusivos. A tela exibe ambas as datas nas colunas, mas não utiliza a original para passar no filtro quando há reprogramação. O agrupamento da visualização pública segue a mesma prioridade. A interface mantém o nome **Reprogramada**, enquanto o banco utiliza `u_data_renegociacao` e a rota de atualização é `alterar-renegociacao`.

## Visualização pública: cronograma semanal
**Somente `pcp/portal.html`** tem agrupamento por semana de entrega. Não há mais uma parede de cartões repetidos: o portal mostra a lista de semanas em **cabeçalhos expansíveis**, com status da semana, quantidade de OS, atrasadas, datas e valores quando liberados. A semana atual (ou a mais relevante) vem aberta, as demais começam recolhidas. O usuário pode expandir/recolher cada uma ou todas. Semanas atuais e futuras vêm primeiro e o histórico vencido fica depois, ordenado da mais recente para a mais antiga. Filtros e pesquisa mostram automaticamente as OS correspondentes. A data de agrupamento prioriza a **reprogramada**, recorrendo à previsão original quando não existe reprogramação.

## Planilha e Kanban — data unica do PCP (08/10/2026)

A pagina `/columbia/pcp` possui dois modos: **Planilha** e **Kanban**. Nos dois modos e no link publico a **data vigente** e calculada assim:

1. `TOS.u_dt_rep_manual` quando `TOS.u_reprogramado_manual = 1` **e** existe data manual valida.
2. Caso contrario, `TOS.u_data_renegociacao` (JSON `dt_renegociada`).
3. Por ultimo, `TOS.dt_prevista` (JSON `prev_entrega_os`).

A Planilha apresenta **Entrega vigente** com a origem (KANBAN/GRV/ORIGINAL), e **Original (referencia)** visualmente. Os filtros de periodo, indicadores de atraso e Excel utilizam a data vigente. A coluna original e somente referencia. A indicação visual **KANBAN** representa a data manual `u_dt_rep_manual` ativa; não muda o nome do campo no backend.

**Mesmo quando uma OS está marcada KANBAN, o botão ✎ Editar GRV permanece disponível na Planilha.** Ele edita exclusivamente `u_data_renegociacao` pelo endpoint já existente, com justificativa, sem limpar `u_dt_rep_manual` nem `u_reprogramado_manual`. Enquanto o Kanban estiver ativo, a entrega vigente continua mostrando a data do Kanban; no modal há aviso explícito e é apresentada a data atual do GRV. O link público e o Excel mostram a mesma origem visual KANBAN quando aplicável.

O Kanban filtra obrigatoriamente **um mes**, iniciando no mes atual e usando setas para navegar. **Pesquisa geral, Cliente, Segmento e Situacao sao compartilhados e sincronizados em duas vias com a Planilha**, inclusive ao atualizar a pagina (persistem em localStorage). Filtros por coluna da planilha que nao sejam de data tambem sao respeitados no Kanban. O periodo `Entrega de/ate` e filtros por colunas de data (`entrega` e `original`) **nao restringem o Kanban**: apenas o mes das setas determina o intervalo. `Limpar filtros` do Kanban remove apenas os filtros nao relacionados a datas, preservando `from/to`, filtros de colunas de datas e o mes escolhido. Mostra uma coluna para cada semana de calendario que intersecta o mes, inclusive quando houver seis. Cada OS aparece na semana da data vigente, e as setas do cartao acionam:

`PATCH /producao/pcp/kanban/mover` com `{"cod_empresa":1,"cod_os":1234,"direcao":1}` ou `direcao:-1`.

No servidor o endpoint valida `u_pcp=1`, usa chave interna `TOS.COD_EMPRESA+TOS.CODIGO`, bloqueia OS concluida/cancelada, escolhe a sexta da semana seguinte/anterior e grava `TOS.U_DT_REP_MANUAL` + `TOS.U_REPROGRAMADO_MANUAL = 1`. A escrita ajusta o cache local. **Nao grava DT_PREVISTA nem U_DATA_RENEGOCIACAO.**

O servidor precisa instalar a API Python atualizada (arquivo `api.py` e `pcp_portal_routes.py`) **e** a consulta `sql/producao_base.sql` precisa incluir as duas novas colunas no CTE `os_ativas` e no `SELECT` final. Apenas commitar GitHub Pages **nao publica** rotas novas no Windows. O pacote completo foi entregue na conversa, nao esta implantado automaticamente.

---

## Segmento
A coluna e o filtro Segmento usam o campo `segmento` no JSON de produção e seus aliases `segmento_cliente`, `u_segmento` e `classificacao_segmento`. Quando faltar o campo na OS, a tela busca o mesmo JSON `/faturamento_prod` do módulo Produção Columbia e procura correspondência por número da OS; na ausência, por nome de cliente **somente quando houver um único segmento inequívoco**. Valores realmente indisponíveis são apresentados como `Sem segmento` e ficam selecionáveis no filtro. Não criar nomes de segmentos fictícios.

## Desenhos técnicos anexos
A coluna **Anexos** aparece em cada OS quando o JSON retorna `anexos[]` com `cod_empresa`, `cod_os` e `cod_os_aux`. O botão abre um modal com os PDFs daquela OS, carregando cada arquivo no visualizador interno. A leitura reutiliza a rota de produção `GET /producao/desenho-anexo?cod_empresa=...&cod_os=...&cod_os_aux=...`, que devolve `pdf_base64`. Quem visualizar o link compartilhado deverá se autenticar e ter a permissão `u_pcp=1`. Validação de permissão e propriedade da OS deve ocorrer no backend.

## Portal compartilhado público — validade e acesso somente leitura

O botão **Gerar link** da Carteira PCP agora cria **um único portal público** para as OS filtradas ou marcadas, seguindo o funcionamento da PSTEC. É possível informar nome, validade de 7, 30, 90 ou 365 dias, ou deixar sem vencimento, e decidir se serão exibidos valores e permitida a exportação em Excel.

A pessoa que recebe o endereço **não precisa de usuário nem senha**. Ela acessa `pcp/portal.html?id=...&token=...`, visualiza a carteira completa dividida em semanas (segunda-feira a domingo), com os totais por semana, consulta todas as colunas e abre os anexos PDF **diretamente em outra aba**. A página pública **não possui controles de edição**, de alteração de data ou de criação de novos links.

O botão **Gerenciar links** no módulo interno lista os planejamentos gerados e oferece copiar, desativar ou reativar. O link é verificado no **servidor a cada consulta e a cada abertura de PDF**. Links vencidos e desativados retornam HTTP 410, sem entregar dados.

A data da semana é sempre a reprogramada, caso exista; senão, a original da OS. Os valores e dados são consultados novamente ao abrir o portal, portanto o planejamento reflete alterações posteriores às datas ou processos, mas inclui somente as OS selecionadas na criação. OS sem data ficam em uma semana especial.

### Instalação obrigatória no servidor Columbia

O site do repositório `columbia` é estático (GitHub Pages). **Validade, revogação e acesso sem senha exigem um backend**. O código de backend já foi preparado em `pcp/backend/portal_routes.py` para incorporar ao FastAPI que serve `columbia.consultoriarf.net`. O procedimento e dependências estão em `pcp/backend/README.md`.

**O portal público não entrará em funcionamento completo somente com os commits de GitHub**: é indispensável configurar e subir o novo router no servidor Columbia. O formulário de criação informa um erro se a rota ainda não estiver ativa. Não usar links antigos do tipo `?os=...` ou `?osv=...` como substitutos, pois esses continuam sujeitos ao login do módulo interno e não possuem validade.

Os endpoints de criação, consulta de links e reativação só aceitam usuários autenticados e validados pelo próprio backend com `u_pcp=1`. Os únicos endpoints públicos retornam dados ou PDFs após verificar um token imprevisível, a data de vencimento, o status ativo e a lista autorizada de OS.

## Verificações sugeridas para implantação

1. Entrar com usuário \`u_pcp=0\` e confirmar que o módulo não abre nem por URL direta.
2. Entrar com \`u_pcp=1\` e conferir algumas OS entre a produção e a nova carteira, inclusive campos nulos e renegociações.
3. Modificar e remover uma data com justificativa, verificar banco de dados e log do GRV.
4. Filtrar a planilha pela **data de entrega vigente** (reprogramada > original) e confirmar que uma OS reprogramada para dezembro não aparece ao filtrar outubro. Após instalar o backend, conferir a visualização pública agrupada em semanas.
5. Garantir via API a rejeição com HTTP 403 de leituras e escritas PCP por token sem a permissão.

Validação realizada na edição: sintaxe JavaScript verificada. Sem conexão com a API privada neste ambiente, a integração real e as permissões no backend precisam ser testadas na infraestrutura Columbia.

### Correção dos filtros do Kanban (08/10/2026)

Os menus de **Cliente** e **Segmento** das duas abas são populados diretamente do mesmo `store.rows` (dados do JSON `/producao`, mais complemento de segmento, quando disponível), em vez de copiar as opções HTML do select oculto da Planilha. A pesquisa e a situação usam os valores canônicos da Planilha e são sincronizadas ao trocar de aba ou aplicar filtros no Kanban. Um contador abaixo dos filtros do Kanban indica quantas OS, clientes e segmentos foram efetivamente carregados; erros de autorização/consulta ficam visíveis no próprio Kanban. O mês permanece o único período aplicado ao Kanban e os filtros por coluna que não sejam de data continuam sincronizados.


## Migração do Controle de Produção para /columbia (08/10/2026)

A aplicação V7.6.7 antes hospedada em `/producao_columbia` foi copiada integralmente para **`/columbia/producao/`** nos arquivos `producao/index.html` e `producao/controle.js`. Preserva a programação, conferência, faturamento, anexos e **aba Limbo**. Os caminhos de logo foram ajustados para o novo diretório.

A página `/columbia` apresenta **Controle de Produção** somente a quem tem `U_PCP=1`; o novo módulo exige também uma validação **online** `GET /producao/portal/me` com Bearer antes de carregar a lógica original. Usa a mesma sessão e login de `/columbia/login.html`. Não utiliza mais o login legado `columbia_token`. Se não autorizado, o módulo não é inicializado. A URL antiga e seu antigo `login.html` agora exibem "Link desativado" e direcionam ao menu de `/columbia`. Não foi feita exclusão definitiva do código antigo do histórico Git.

**Regra do Limbo:** a Planilha PCP e o Kanban removem `u_limbo=1` no recebimento do JSON. O backend dos links públicos, em `pcp/backend/portal_routes.py`, também não normaliza OS no limbo: para esta regra valer em links já criados, instale a atualização `pcp_portal_routes.py` no servidor Windows e reinicie o processo da API. A tela Controle de Produção continua consultando as OS no limbo na sua aba própria para permitir que sejam reativadas.

**Limite de segurança:** JavaScript estático restringe visualização e navegação, mas **não substitui autorização em todas as rotas SQL/REST legadas**. O endpoint `/producao` também é usado por outros módulos, então não foi bloqueado globalmente para não quebrá-los. Para isolamento real de dados, é necessário aplicar a permissão `U_PCP` no backend às rotas específicas do Controle de Produção, revisando dependências de outros consumidores.


## Arrastar e soltar no Kanban (08/10/2026)

Além das setas `←/→`, os cartões da OS podem ser **arrastados para qualquer coluna de semana do mês exibido**, com mouse ou dedo (pela alça **⠿ Arrastar** no celular). Ao passar o cartão, as colunas aptas recebem borda azul pontilhada; o destino fica verde. Ao soltar, a data da OS fica na **sexta-feira da semana escolhida** e `TOS.u_reprogramado_manual=1`. O indicador visual permanece **KANBAN**.

**Compatibilidade com a API atual:** não precisa instalar uma rota nova: a interface continua chamando `PATCH /producao/pcp/kanban/mover` com `direcao: +1` ou `-1`. Se a OS pular três semanas, o navegador realiza três chamadas sucessivas, **aguardando confirmação** de cada uma; isso **não é uma transação atômica**. Se a terceira chamada falhar, as duas primeiras permanecerão gravadas, e a tela avisará que o movimento foi parcial e atualizará os dados. O usuário sem `u_pcp=1` não consegue gravar pelo backend. As setas continuam funcionando como antes.

Quando a sexta-feira da semana alvo cai **fora do mês selecionado** (coluna parcial na borda do mês), o sistema pede confirmação, porque a OS deixará de aparecer no mês exibido após o movimento. Soltar no mesmo período não altera a OS.
