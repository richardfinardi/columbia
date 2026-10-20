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
