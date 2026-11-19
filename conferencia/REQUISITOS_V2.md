# Conferência V2 — levantamento inicial
Data: 19/11/2026
Status: Preparação / escopo funcional a definir.

## Proteção do legado
- Backup integral do estado anterior à reformulação na branch `backup/conferencia-2026-11-19`.
- Antes da reforma, `conferencia/` tinha um único arquivo: `conferencia/index.html`.
- Na `main`, conteúdo substituído por aviso de reformulação, e cartão removido do menu principal.
- Desenvolvimento isolado em `feature/conferencia-v2`.
- Não alterar endpoints, banco de dados nem aprovações de cadastros enquanto o novo desenho não estiver definido.

## Funcionalidades identificadas no front antigo (inventário, não escopo aprovado da V2)
- Clientes, fornecedores e materiais: consulta, análise e solicitação de alterações.
- Comercial, compras e movimentação de materiais: visões analíticas.
- Filtros temporais: ano, ano/mês, intervalo de datas.
- Alterações individuais e em lote de materiais; marcação de registros analisados.
- Autenticação por token Bearer; exibição do cartão condicionada à permissão `u_analista_cadastro`.

## Integrações existentes (servidor FastAPI)
Base: `https://columbia.consultoriarf.net/producao`
- `GET /analista/clientes`
- `GET /analista/fornecedores`
- `GET /analista/materiais`
- `GET /analista/estado-cadastros`
- `GET /analista/materiais/estado-cadastros`
- `POST /analista/materiais/analise`
- `POST /analista/materiais/alteracoes`
- `POST /analista/materiais/alteracoes-lote`

## Diretrizes propostas para reconstrução
1. Reutilizar as integrações atuais somente após validar contratos reais de resposta.
2. Manter validação de acesso e autenticação antes de exibir dados.
3. Projeto responsivo para computador e celular, com tabelas navegáveis, filtros e ordenação.
4. Prevenir alterações indevidas; confirmar no front as operações de gravação e em lote.
5. Evitar carregar grandes volumes sem indicação visual de progresso e sem paginação apropriada.
6. Construir e homologar na branch de desenvolvimento antes de reativar a rota no menu.

## A definir na próxima etapa
- Quais das seis visões antigas permanecem, são unificadas ou excluídas.
- Campos obrigatórios por visão, filtros prioritários e indicadores desejados.
- Fluxos de análise, edição, alterações em lote e permissão de aprovação.
- Critérios de homologação e data para liberação da nova tela.

Este é um levantamento técnico, não uma especificação funcional fechada.
