# Notas fiscais

`notas_fiscais.sql` é a consulta completa entregue na migração de 29/09/2026, com uma alteração: status 150 também representa autorização e participa dos mesmos cálculos do status 100. O texto do status identifica autorização fora do prazo.

Foram preservados os seis blocos da consulta, joins, agrupamentos, UNION/UNION ALL, regras de importação, família 30, gerar faturamento, devoluções, serviços/ISS, canceladas/inutilizadas, observações, corte de ano e exclusão da NF 11825. Não há inclusão manual de notas ou valores.

Na tela, a grade Faturamento volta a exibir remessas com faturamento zero; isso não muda os indicadores de receita. Sucata reconhece tipo ou segmento SUCATA/SUCATAS. Colunas, filtros, ordenação, exportação, permissões e regras de devolução permanecem.

## Aplicação na API

O GitHub Pages publica a tela. Ele não instala o SQL no computador que executa a API.

Substituir apenas `sql/notas_fiscais.sql` no diretório da API por este arquivo. Preservar os demais SQLs. Atualizar/reiniciar o processo da API conforme seu carregamento de consultas e clicar Atualizar na tela. Não aplicar novamente inclusões manuais do relatório exportado.

## Validação

Executar `node tests/notas_fiscais.test.cjs`.

Após instalar na API, conferir o retorno de `/notas_fiscais`: NF 12026 deve trazer status de autorização fora do prazo e os valores calculados a partir dos itens. A data continua sendo a emissão registrada no CPS, não a transmissão. Remessa em garantia sem gerar faturamento deve continuar com faturamento zero. NFes 12005 e 12020 devem aparecer na aba Sucata. Conferir por CFOP/segmento, sem agregar ou deduplicar só por número de NF.

A consulta precisa ser executada contra o CPS para validar valores, impostos e totais reais. Os testes locais verificam o comportamento da tela e os pontos alterados no SQL; não substituem a conciliação fiscal.
