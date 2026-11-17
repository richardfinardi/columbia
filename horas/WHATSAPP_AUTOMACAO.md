# Columbia | Envio automático do Fechamento de Horas via WhatsApp

**Status do repositório:** motor de cálculo, roteamento para AUVRIUN e instalador preparados. **Os envios não ficam ativos apenas com commit no GitHub**; é obrigatório instalar a tarefa no Windows da Columbia e validá-la.

## Requisitos

- Servidor Windows Columbia com API ativa e arquivos \`C:\api-dados\auth.py\` e \`C:\api-dados\horas_disponiveis_columbia.py\`, já operacionais.
- Python que consegue importar \`httpx\`, \`auth\`, \`horas_disponiveis_columbia\`, \`conexao\` e o cliente SQL instalado.
- Variável de ambiente do Aponta Fácil \`APONTAFACIL_TOKEN\` no contexto do usuário que executa a tarefa.
- Aplicação ativa \`columbia\` no painel da AUVRIUN, provedor W-API, evento ativo \`fechamento_horas\` no modo TEXTO.
- A chave da aplicação \`columbia\` gerada no painel da AUVRIUN (formato \`auv_...\`). Se ela foi perdida, rotacionar pelo painel e usar a nova chave em **todas** as integrações de produção que a usam.
- Um usuário GRV Columbia ativo com \`CSENHA.U_HORAS=1\` (conta de serviço da automação). A rotina usa esse perfil apenas para obter um JWT válido de 8 horas via \`auth.criar_token_acesso\`; nenhum JWT permanente é guardado.

## Instalação

1. Copiar \`horas/columbia_whatsapp_agendador.py\` para \`C:\api-dados\columbia_whatsapp_agendador.py\`.
2. Copiar \`horas/INSTALAR_WHATSAPP_COLUMBIA.ps1\` para \`C:\api-dados\INSTALAR_WHATSAPP_COLUMBIA.ps1\`.
3. Abrir PowerShell **como administrador**, usando a mesma conta Windows que já tem acesso à API e ao token do Aponta Fácil.
4. Executar:
   \`\`\`powershell
   Set-ExecutionPolicy -Scope Process Bypass -Force
   & "C:\api-dados\INSTALAR_WHATSAPP_COLUMBIA.ps1"
   \`\`\`
5. Informar o nome de uma conta GRV com \`U_HORAS=1\` e colar a chave da aplicação AUVRIUN no prompt oculto. **Não colar a chave no chat nem no repositório.**
6. O instalador simula o envio com \`--preview\` e **não registra** a tarefa se os dados/permissões falharem. A simulação de terça-feira considera os assinantes diários. Para conferir também os relatórios de fechamento, use:
   \`\`\`powershell
   python C:\api-dados\columbia_whatsapp_agendador.py --preview --date 2026-11-02
   python C:\api-dados\columbia_whatsapp_agendador.py --preview --date 2026-11-01
   \`\`\`
   Os exemplos acima simulam segunda-feira (semanal) e dia 1 (mensal), sem envio. Altere as datas conforme necessário.

## Horários e períodos

Uma tarefa Windows é executada **diariamente às 18h30**, no horário local do servidor. Dentro da rotina:

| Assinatura | Dia de envio | Período |
|---|---|---|
| Diário | Segunda a sexta | Apontamentos e eventos do próprio dia |
| Semanal | Toda segunda-feira | Segunda a domingo da semana anterior |
| Mensal | Todo dia 1 | Mês calendário anterior |

Se o servidor não estiver no fuso de Brasília, ajuste a tarefa do Windows para o horário correspondente. A rotina usa \`America/Sao_Paulo\` para interpretar as datas e o agendamento.

## Garantias e limites

- A rotina lista somente assinaturas ativas e confirmadas na Central AUVRIUN. **Não exige cadastrar telefones na lista fixa.**
- Segmentos, máquinas e funcionários da assinatura são aplicados como filtros; a disponibilidade de cada funcionário é rateada pelo total de horas apontadas no período.
- Há **uma mensagem por tipo selecionado** (metas e/ou resumo), sem imagem, PDF ou anexos.
- O servidor **não envia** se faltarem dados confiáveis, se a API cair ou se o período não puder ser conciliado.
- Disponibilidade é calculada com os eventos de **HORAS NORMAIS** e **HORAS EXTRAS**, eliminando a duplicidade entre total e subtipos de horas extras por funcionário/dia.
- Relatórios diários e semanais **exigem datas diárias válidas no GRV**, sem converter registros apenas mensais em resultados de um dia.
- Períodos fechados de Aponta Fácil são armazenados no próprio servidor com **somente** data, nome, descrição e quantidade do evento, sem CPF ou e-mail.
- A Central AUVRIUN usa referência \`frequência:início:fim\` e o tipo de mensagem para suprimir reenvios já aceitos pelo provedor. KV não fornece deduplicação transacional para concorrência elevada.
- Status \`ACCEPTED\` significa aceito pela W-API, **não** comprova entrega efetiva ao aparelho; confirme pelo telefone.
- A chave AUVRIUN é escrita como variável de ambiente no perfil Windows do usuário que instala a tarefa. Proteja o acesso a esse usuário no servidor. Não há credencial no código ou no GitHub.
- O agendador executa com a mesma conta Windows e \`LogonType S4U\` para não depender de sessão gráfica aberta. Se a tarefa retornar erro de acesso/perfil em uma instalação específica, revisar a opção de logon da tarefa no Agendador.

## Diagnóstico

\`\`\`powershell
Get-ScheduledTask -TaskName "COLUMBIA - Fechamento Horas WhatsApp"
Get-ScheduledTaskInfo -TaskName "COLUMBIA - Fechamento Horas WhatsApp"
python C:\api-dados\columbia_whatsapp_agendador.py --preview
\`\`\`

**Pontos de falha:**
- \`401\` em \`/custos_apontamento\`: JWT gerado pela tarefa não confere com \`SECRET_KEY\` utilizado pela API. Confirme que a variável \`SECRET_KEY\` persistente está acessível à conta da tarefa; não exponha seu valor.
- \`403\` no GRV: a conta de serviço não possui \`U_HORAS=1\`.
- \`401\` na AUVRIUN: chave \`auv_...\` incorreta/desativada.
- \`Sem apontamentos/data diária\`: fonte GRV não disponibiliza o período detalhado; a rotina suspende esse envio, em vez de apresentar número estimado.
- \`AUVRIUN fechou/apontamentos parciais\`: verificar logs da tarefa e o histórico de envios na Central AUVRIUN.

**Não realizar testes de envio real usando \`--date\`**; a opção aceita apenas \`--preview\`. Para testes de entrega ao aparelho, use o botão da assinatura na página da Columbia.
