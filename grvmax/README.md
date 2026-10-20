# GRVMAX — Gestão da Implantação Columbia

## Estado
Frontend criado em `grvmax/` isolado do portal Columbia. **Nenhuma alteração no menu nem nos módulos atuais.**
Banco em Google Sheets:
https://docs.google.com/spreadsheets/d/1l4NAwZLJQSLhcCdzxkP1PbkCO94tGuHJnlZO4pjYEMc/edit

O banco foi criado na pasta BANCO_DADOS com 16 tabelas, 19 etapas, 70 atividades e 7 critérios de GO LIVE.

## Ativação obrigatória (Apps Script)
1. Abra o banco acima no Google Sheets.
2. Entre em **Extensões → Apps Script**, criando um projeto vinculado à planilha.
3. Substitua o arquivo `Code.gs` pelo conteúdo de `grvmax/Code.gs` deste repositório.
4. Em **Configurações do projeto → Propriedades do script**, adicione:
   - `GRVMAX_ADMIN_EMAIL`: seu e-mail administrador (o e-mail precisa ser exatamente o usado na configuração inicial)
   - `GRVMAX_SETUP_KEY`: uma chave aleatória e secreta com 16 caracteres ou mais, **não registre no GitHub**
5. Em **Implantar → Nova implantação → Aplicativo da Web**, execute como **Você** e escolha acesso **Qualquer pessoa** (o aplicativo exige autenticação própria e valida permissões no servidor). Autorize as permissões de Sheets, envio de e-mails e triggers. **Não compartilhe o banco com os usuários.**
6. Copie a URL `https://script.google.com/macros/s/.../exec` e configure em `grvmax/index.html`, constante `SCRIPT_URL`. Alternativamente, na primeira visita ao endereço `/columbia/grvmax/`, cole a URL de implantação para testar no seu navegador.
7. Abra `/columbia/grvmax/` e conclua a **Configuração inicial** informando o e-mail configurado, a chave secreta e sua senha (mínimo 10 caracteres). Depois faça login.
8. Cadastre os participantes em **Pessoas**; clique **Enviar acesso** para que cada pessoa defina sua própria senha pelo e-mail. No menu Comunicação, teste um envio. Para lembretes automáticos, ative o agendamento diário.

## Recursos disponíveis no código
- Usuários próprios (e-mail/senha), sessões com expiração e token hasheado; roles Administrador/Consultor/Gestor/Usuário-chave.
- CRUD de etapas, tarefas, pessoas, pendências, mudanças, agenda, treinamentos e critérios GO LIVE.
- Homologação/devolução formal e trilha de decisão.
- Comunicação individual e disparos em lote; registros de TENTATIVA, ENVIADO e ERRO + LOGS de cada evento.
- Auditoria append-only das operações, inclusive login, logout e alterações.
- Lembretes automáticos ou manuais (pendentes e atrasadas), com deduplicação diária.
- GO/NO GO bloqueia aprovação quando critérios obrigatórios ou pendências críticas estão em aberto.
- Responsivos + tema claro/escuro. Dados persistidos no Google Sheets.

## Segurança e limites
- **Nunca salve credenciais em GitHub ou planilha em texto puro**. Senhas são armazenadas como hash iterado com salt e pepper (Script Properties), mas antes de produção sensível recomenda-se migrar autenticação para provedor especializado (ex.: Firebase Auth).
- Não compartilhe a planilha com os participantes. A API lê/escreve com conta proprietária e aplica RBAC no servidor.
- A interface de Apps Script é carregada a partir do GitHub (raw); mantenha a permissão de escrita do repositório restrita.
- O App Script permite incorporação em iframe (ALLOWALL): não reutilize credenciais em domínios não confiáveis. Para maior proteção no futuro, usar backend dedicado em domínio próprio e políticas contra clickjacking.
- Google Apps Script e MailApp têm limites/quota de execução e envio. Registros de e-mail são de **tentativas e resultados da chamada MailApp**; não comprovam entrega/leitura.
- Evidências por enquanto são links HTTPS (Drive, vídeos, documentos). Upload direto de arquivos e anexos múltiplos exigem integração futura.
- **Somente publicar arquivos HTML no GitHub não ativa o backend.** É necessário realizar o deploy Apps Script. Também é necessário redeploy do Web App quando mudar apenas o Code.gs.
- Logs não são apagados pelo aplicativo; acesso direto ao Sheets pelo proprietário permite alteração manual. Para trilha imutável, requer armazenamento externo WORM.

## Localização
`grvmax/index.html` — wrapper da URL /grvmax.
`grvmax/app.html` — interface carregada dinamicamente pelo Apps Script.
`grvmax/Code.gs` — serviço do Apps Script.


## ATUALIZAÇÃO DE 20/10 — URL própria, equipe e e-mails
- A aplicação pública **sempre permanece** em `https://consultoriarf.net/columbia/grvmax/`, inclusive celular (sem redirecionamento automático para script.google.com).
- Links enviados aos usuários para criar e recuperar senhas agora usam `https://consultoriarf.net/columbia/grvmax/?invite=...&email=...`. Tokens são encaminhados ao backend pelo iframe.
- Responsável principal + múltiplos participantes + homologador na edição de cada atividade. Vínculos gravados em `VINCULOS` e mudanças em `LOGS`.
- Usuário-chave também pode enviar e-mails; o servidor aplica permissão e registra `TENTATIVA`, `ENVIADO` e `ERRO`. O histórico que ele vê é apenas dos seus disparos.
- Participante ou homologador recebe a atividade em "Minhas atividades"; homologador indicado pode aprovar/devolver, inclusive se for usuário-chave.
- **IMPORTANTE: o Google Apps Script não se atualiza ao publicar Code.gs no GitHub.** Abra o projeto `COLUMBIA_GRVMAX_API`, substitua o conteúdo de Código.gs pelo `grvmax/Code.gs` atualizado e **Implantar → Gerenciar implantações → Editar → Versão: Nova versão → Implantar**. Faça atualização forte no navegador (Ctrl+Shift+R). Mantenha a mesma implantação URL /exec.
- **Convites antigos já enviados não mudam retroativamente.** Use "Enviar acesso" novamente após implantar a nova versão.
- Ao entrar pelo endereço `script.google.com` digitado ou salvo previamente, a barra continuará no Google. Use sempre o link `consultoriarf.net/columbia/grvmax/`, não o Web App direto.

## ATUALIZAÇÃO DE 20/10 — Atividades unificadas
- Removida a entrada redundante **Minhas atividades** do menu lateral. Agora a tela **Atividades** abre em **Minhas atividades**.
- Visualizações: **Minhas atividades** (responsável, participante ou homologador), **Todas as atividades** (respeitando permissões) e **Criadas por mim** (autoria nos logs).
- Busca e filtros de etapa, responsável, situação e prazo, botão para limpar e indicadores de atividades, pendentes, em andamento, atrasadas e concluídas. Há um único projeto Columbia; portanto, não se acrescentou um filtro de projeto desnecessário.
- Alteração rápida de situação pela tabela, gravada com histórico. **Aguardando validação** abre o formulário para anexar evidência/observação; **Homologada** exige decisão formal no fluxo de homologação.
- Os formulários atuais de atividade, participantes, homologação e a comunicação permanecem intactos.
- O backend atualizado calcula a autoria a partir dos LOGS existentes, sem modificar a estrutura do Sheets. Atividades iniciais sem evento de criação não têm autor verificável e podem não aparecer na visão **Criadas por mim**.
- **Para ativar a autoria completa**, atualizar o Code.gs do Apps Script e publicar em **Implantar → Gerenciar implantações → Editar → Nova versão → Implantar**, mantendo o mesmo link /exec. Antes disso, a interface usa os logs recentes que já vêm da API.
- Backup anterior à alteração: branch backup/grvmax-pre-atividades-unificadas-20261020.

## ATUALIZAÇÃO DE 20/10 — Histórico permanente das atividades e usuário-chave
- **Histórico de observações por atividade:** campo Nova observação inicia vazio em cada abertura. Mensagens anteriores aparecem em cartões de leitura, com autor, data/hora e última mensagem destacada. Não há edição nem exclusão de mensagens anteriores pela aplicação.
- Cada nova observação é gravada como evento OBSERVACAO_REGISTRADA na tabela LOGS, com ator autenticado e horário do servidor. O campo legado ATIVIDADES.OBSERVACAO é preservado; logs históricos antigos que registraram mudanças nessa coluna são recuperados automaticamente na visualização.
- Para usuário-chave, o menu mostra **Minhas atividades** e a tela não exibe opções de Todas as atividades nem Criadas por mim. As permissões do servidor continuam limitando o conteúdo às atividades atribuídas (responsável, participante ou homologador).
- Usuário-chave pode mudar os estados operacionais da atividade atribuída: Não iniciada, Orientada, Em execução e Aguardando validação. A passagem para Aguardando validação abre o formulário e exige evidência ou nova observação. Homologação permanece formal e com controle de permissões.
- A edição do status de uma atividade existente mantém o valor salvo e não redefine automaticamente para Não iniciada.
- **Publicação do backend obrigatória:** atualizar o arquivo Code.gs no projeto Google Apps Script e fazer Gerenciar implantações → Editar → Nova versão → Implantar, mantendo a URL /exec. Antes do deploy, a interface impede novos comentários para não sobrescrever conteúdo com a API antiga; as demais telas permanecem disponíveis.
- Backup antes das alterações: backup/grvmax-antes-historico-observacoes-20261020.
- Testes feitos em ambiente simulado: preservação de observação antiga, inclusão de dois novos registros, ordenação cronológica, atualização de status por usuário-chave, bloqueio de acesso a atividade não atribuída, modal de histórico e filtros de usuário-chave.
