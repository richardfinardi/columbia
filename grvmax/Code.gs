/**
 * COLUMBIA / GRVMAX — API Apps Script v1
 * BANCO: 1l4NAwZLJQSLhcCdzxkP1PbkCO94tGuHJnlZO4pjYEMc
 * Implantação: crie projeto Apps Script V8; cole este arquivo; configure
 * GRVMAX_SETUP_KEY e GRVMAX_ADMIN_EMAIL em Propriedades do script;
 * implante como Web App (executar como você, acesso qualquer pessoa).
 * O usuário autentica no aplicativo, NÃO no CPS e NÃO com Google.
 */
const GRV_DB_ID = '1l4NAwZLJQSLhcCdzxkP1PbkCO94tGuHJnlZO4pjYEMc';
const GRV_APP_HTML = 'https://raw.githubusercontent.com/richardfinardi/columbia/main/grvmax/app.html';
const GRV_SESSION_HOURS = 12;
const GRV_ENTITIES = ['PROJETOS','ETAPAS','ATIVIDADES','PESSOAS','VINCULOS','HOMOLOGACOES','PENDENCIAS','MUDANCAS','AGENDA','TREINAMENTOS','COMUNICACOES','LOGS','GO_LIVE','SESSOES','CONVITES'];
const GRV_EDITABLE = ['ETAPAS','ATIVIDADES','PESSOAS','PENDENCIAS','MUDANCAS','AGENDA','TREINAMENTOS','GO_LIVE'];
const GRV_MANAGERS = ['Administrador','Consultor'];
const GRV_ACTIVITY_STATUS = ['Não iniciada','Orientada','Em execução','Aguardando validação','Devolvida','Homologada','Cancelada'];
const GRV_ROLES = ['Administrador','Consultor','Gestor','Usuário-chave'];

function doGet(e) {
  const html = UrlFetchApp.fetch(GRV_APP_HTML, {muteHttpExceptions:true, followRedirects:true});
  if (html.getResponseCode() !== 200) return HtmlService.createHtmlOutput('Interface não disponível. Atualize a página.');
  return HtmlService.createHtmlOutput(html.getContentText('UTF-8'))
    .setTitle('GRVMAX | Implantação Columbia')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}
function doPost(e) { return ContentService.createTextOutput(JSON.stringify({error:'Acesse o aplicativo pela interface web.'})).setMimeType(ContentService.MimeType.JSON); }

function api(action, payload, token) {
  try {
    const p = payload || {};
    if (action === 'bootstrap') return {ok:true, needsSetup:grvRows('PESSOAS').length===0};
    if (action === 'setup') return grvSetup(p);
    if (action === 'login') return grvLogin(p);
    if (action === 'forgot') return grvForgot(p);
    if (action === 'setPassword') return grvSetPassword(p);
    const who = grvAuth(token);
    switch(action) {
      case 'state': return grvState(who);
      case 'save': return grvSave(who,p);
      case 'approve': return grvApprove(who,p);
      case 'sendEmail': return grvSendEmails(who,p);
      case 'invite': return grvInvite(who,p);
      case 'reminders': return grvReminders(who);
      case 'installReminders': return grvInstallReminders(who);
      case 'goDecision': return grvGoDecision(who,p);
      case 'logout': grvLogout(who,token); return {ok:true};
      default: throw Error('Comando desconhecido');
    }
  } catch(err) {
    throw Error(String(err && err.message || err));
  }
}
function grvNow() { return Utilities.formatDate(new Date(), 'America/Sao_Paulo', "yyyy-MM-dd'T'HH:mm:ssXXX"); }
function grvSS() { return SpreadsheetApp.openById(GRV_DB_ID); }
function grvTable(name) {
  if(GRV_ENTITIES.indexOf(name)<0 && name!=='CONFIG') throw Error('Tabela inválida');
  const s=grvSS().getSheetByName(name); if(!s) throw Error('Aba ausente: '+name);
  const heads=s.getRange(1,1,1,s.getLastColumn()).getDisplayValues()[0].filter(Boolean);
  return {s:s,heads:heads};
}
function grvRows(name) {
  const t=grvTable(name),last=t.s.getLastRow(); if(last<2) return [];
  return t.s.getRange(2,1,last-1,t.heads.length).getDisplayValues().map((r,i)=>{
    const o={};t.heads.forEach((h,j)=>o[h]=r[j]);o._row=i+2;return o;
  }).filter(x=>x.ID || (name==='CONFIG' && x.CHAVE));
}
function grvFind(name,id) {return grvRows(name).find(r=>r.ID===id)||null;}
function grvFindEmail(email) {return grvRows('PESSOAS').find(x=>String(x.EMAIL).toLowerCase()===String(email).trim().toLowerCase())||null;}
function grvId(prefix) {return prefix+'-'+Utilities.getUuid().slice(0,8).toUpperCase();}
function grvSafe(v){if(v===null||v===undefined)return ''; const s=String(v);return /^[=]/.test(s)?"'"+s:s;}
function grvWrite(name,obj){
  const t=grvTable(name),row=t.heads.map(k=>grvSafe(obj[k])); if(obj._row) t.s.getRange(Number(obj._row),1,1,row.length).setValues([row]); else t.s.appendRow(row);
  return obj;
}
function grvLock(fn) {
  const lock=LockService.getScriptLock();if(!lock.tryLock(20000))throw Error('Sistema ocupado. Tente novamente.');
  try{return fn();}finally{lock.releaseLock();}
}
function grvJson(o){try{return JSON.stringify(o||{}).slice(0,30000);}catch(e){return '{}';}}
function grvLog(who,table,id,action,before,after,detail){
  const w=who||{ID:'SISTEMA',EMAIL:'sistema'};
  grvWrite('LOGS',{ID:grvId('LOG'),TIMESTAMP:grvNow(),ATOR_ID:w.ID,ATOR_EMAIL:w.EMAIL,ENTIDADE:table,ENTIDADE_ID:id||'',ACAO:action,ANTES_JSON:grvJson(before),DEPOIS_JSON:grvJson(after),DETALHE:detail||''});
}
function grvDigest(s){return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,String(s),Utilities.Charset.UTF_8).map(b=>('0'+(b<0?b+256:b).toString(16)).slice(-2)).join('');}
function grvSecret(){
  const props=PropertiesService.getScriptProperties();let pepper=props.getProperty('GRVMAX_PEPPER');
  if(!pepper){pepper=Utilities.getUuid()+Utilities.getUuid();props.setProperty('GRVMAX_PEPPER',pepper);}
  return pepper;
}
function grvHash(password,salt){
  let h=grvDigest(String(password)+'|'+salt+'|'+grvSecret());
  for(let i=0;i<1200;i++) h=grvDigest(h+'|'+salt+'|'+i);
  return h;
}
function grvToken(){return Utilities.getUuid()+Utilities.getUuid().replace(/-/g,'');}
function grvLogin(p){
  const email=String(p.email||'').trim().toLowerCase(),pass=String(p.password||'');
  const cache=CacheService.getScriptCache(),key='login-fails-'+grvDigest(email).slice(0,30),fails=Number(cache.get(key)||0);
  if(fails>=8)throw Error('Muitas tentativas. Aguarde 15 minutos.');
  const user=grvFindEmail(email),good=user && user.ATIVO==='SIM' && user.HASH && grvHash(pass,user.SALT)===user.HASH;
  if(!good){
    cache.put(key,String(fails+1),900);
    grvLog({ID:'ANONIMO',EMAIL:email},'PESSOAS',user?user.ID:'','LOGIN_FALHOU',null,null,'Credenciais inválidas');
    throw Error('E-mail ou senha inválidos');
  }
  cache.remove(key);
  const token=grvToken(),expires=new Date(Date.now()+GRV_SESSION_HOURS*3600000).toISOString();
  grvLock(()=>{
    grvWrite('SESSOES',{ID:grvId('SES'),PESSOA_ID:user.ID,TOKEN_HASH:grvDigest(token),EXPIRA_EM:expires,REVOGADA:'NÃO',CRIADO_EM:grvNow()});
    grvWrite('PESSOAS',{...user,ULTIMO_ACESSO:grvNow()});
    grvLog(user,'SESSOES','','LOGIN',null,{expira:expires},'Login com e-mail/senha');
  });
  return {ok:true,token:token,user:grvPublicPerson(user)};
}
function grvAuth(token){
  if(!token||String(token).length<50)throw Error('Sessão encerrada. Faça login novamente.');
  const hash=grvDigest(token),ses=grvRows('SESSOES').find(x=>x.TOKEN_HASH===hash && x.REVOGADA!=='SIM' && Date.parse(x.EXPIRA_EM)>Date.now());
  if(!ses)throw Error('Sessão inválida ou expirada.');
  const user=grvFind('PESSOAS',ses.PESSOA_ID);
  if(!user||user.ATIVO!=='SIM')throw Error('Usuário desativado.');
  return user;
}
function grvPublicPerson(p){const o={};['ID','NOME','EMAIL','EMPRESA','DEPARTAMENTO','CARGO','PERFIL','ATIVO','ULTIMO_ACESSO','CRIADO_EM'].forEach(k=>o[k]=p[k]||'');return o;}
function grvSetup(p){
  return grvLock(()=>{
    if(grvRows('PESSOAS').length)throw Error('O administrador já foi configurado.');
    const prop=PropertiesService.getScriptProperties(), key=prop.getProperty('GRVMAX_SETUP_KEY')||'',admin=String(prop.getProperty('GRVMAX_ADMIN_EMAIL')||'').toLowerCase();
    if(!key||key.length<16||!admin)throw Error('Configure GRVMAX_SETUP_KEY (mínimo 16 caracteres) e GRVMAX_ADMIN_EMAIL nas Propriedades do script.');
    if(String(p.key||'')!==key||String(p.email||'').toLowerCase().trim()!==admin)throw Error('Chave ou e-mail de administrador incorretos.');
    if(String(p.password||'').length<10)throw Error('A senha deve ter no mínimo 10 caracteres.');
    const salt=grvToken(),u={ID:grvId('PES'),NOME:String(p.name||'Administrador').slice(0,120),EMAIL:admin,EMPRESA:'Consultoria',DEPARTAMENTO:'Implantação',CARGO:'Administrador',PERFIL:'Administrador',ATIVO:'SIM',SALT:salt,HASH:grvHash(p.password,salt),SENHA_TEMPORARIA:'NÃO',CRIADO_EM:grvNow(),ATUALIZADO_EM:grvNow()};
    grvWrite('PESSOAS',u);grvLog(u,'PESSOAS',u.ID,'SETUP',null,{EMAIL:admin},'Administrador inicial configurado');
    prop.deleteProperty('GRVMAX_SETUP_KEY');
    return {ok:true};
  });
}
function grvState(who){
  const role=who.PERFIL,admin=role==='Administrador',full=admin||role==='Consultor'||role==='Gestor';
  const people=grvRows('PESSOAS').filter(x=>admin||x.ATIVO==='SIM').map(grvPublicPerson);
  const all=grvRows('ATIVIDADES');
  const vinculos=grvRows('VINCULOS').filter(v=>v.TIPO==='PARTICIPANTE'||v.TIPO==='HOMOLOGADOR');
  const activities=full?all:all.filter(a=>a.RESPONSAVEL_ID===who.ID||vinculos.some(v=>v.ATIVIDADE_ID===a.ID&&v.PESSOA_ID===who.ID));
  const ids=new Set(activities.map(a=>a.ID));
  const stageids=new Set(activities.map(a=>a.ETAPA_ID));
  const safe=(s)=>s.map(o=>{const {_row,...a}=o;return a;});
  return {ok:true,me:grvPublicPerson(who),project:safe(grvRows('PROJETOS')),stages:safe(grvRows('ETAPAS').filter(x=>full||stageids.has(x.ID))),activities:safe(activities),
    people:people,vinculos:safe(vinculos.filter(v=>ids.has(v.ATIVIDADE_ID))),pending:safe(grvRows('PENDENCIAS').filter(x=>full||ids.has(x.ATIVIDADE_ID)||x.RESPONSAVEL_ID===who.ID)),
    changes:safe(grvRows('MUDANCAS').filter(x=>full||ids.has(x.ATIVIDADE_ID))),agenda:safe(grvRows('AGENDA').filter(x=>full||x.RESPONSAVEL_ID===who.ID||(x.PARTICIPANTES||'').includes(who.ID))),
    trainings:safe(grvRows('TREINAMENTOS')),goLive:safe(grvRows('GO_LIVE')),
    approvals:safe(grvRows('HOMOLOGACOES').filter(x=>full||ids.has(x.ATIVIDADE_ID))),
    emails:safe(grvRows('COMUNICACOES').filter(x=>full||x.ENVIADO_POR===who.ID).slice(-350).reverse()),
    logs:safe(grvRows('LOGS').filter(x=>full||x.ATOR_ID===who.ID).slice(-500).reverse()),canEdit:admin||role==='Consultor',canAdmin:admin};
}
function grvSave(who,p){
  const table=String(p.table||'');if(GRV_EDITABLE.indexOf(table)<0)throw Error('Cadastro não permitido.');
  const body=p.item||{},full=GRV_MANAGERS.includes(who.PERFIL),admin=who.PERFIL==='Administrador';
  if(table==='PESSOAS'&&!admin)throw Error('Apenas administradores podem gerenciar pessoas.');
  if(!full&&table!=='ATIVIDADES')throw Error('Você não tem permissão para esta operação.');
  const changingTeam=table==='ATIVIDADES' && (Array.isArray(p.participantIds)||Object.prototype.hasOwnProperty.call(p,'homologatorId'));
  if(changingTeam&&!full)throw Error('Apenas consultores e administradores alteram equipe de atividades.');
  if(table==='GO_LIVE'&&!full)throw Error('Operação não autorizada.');
  const saved = grvLock(()=>{
    const old=body.ID?grvFind(table,body.ID):null;
    if(body.ID&&!old)throw Error('Registro não encontrado.');
    if(!full&&(!old||old.RESPONSAVEL_ID!==who.ID&& !grvRows('VINCULOS').some(v=>v.ATIVIDADE_ID===old.ID&&v.PESSOA_ID===who.ID)))throw Error('Atividade não atribuída a você.');
    if(!full&&old.STATUS==='Homologada')throw Error('Atividade homologada está bloqueada para alterações. Peça reabertura à consultoria.');
    const t=grvTable(table);let next=old?{...old}:{};
    if(!full){['STATUS','EVIDENCIA_URL','OBSERVACAO'].forEach(k=>{if(body[k]!==undefined)next[k]=body[k]});if(['Homologada','Cancelada'].includes(next.STATUS))throw Error('Homologação exige aprovação da consultoria.');if(!['Em execução','Aguardando validação','Orientada','Devolvida',old.STATUS].includes(next.STATUS))throw Error('Situação inválida.');}
    else t.heads.forEach(k=>{if(body[k]!==undefined && !['_row','SALT','HASH','SENHA_TEMPORARIA','CRIADO_EM','ATUALIZADO_EM','HOMOLOGADO_POR','DATA_HOMOLOGACAO'].includes(k))next[k]=String(body[k]).slice(0,k==='DESCRICAO'||k==='OBSERVACAO'?30000:3000);});
    if(table==='ATIVIDADES'){
      if(!GRV_ACTIVITY_STATUS.includes(next.STATUS||'Não iniciada'))throw Error('Situação inválida.');
      if(next.STATUS==='Homologada'&&(!old||old.STATUS!=='Homologada'))throw Error('Use a homologação formal para aprovar.');
      if(next.DATA_ORIENTACAO && !next.PRAZO && /^\d{4}-\d\d-\d\d$/.test(next.DATA_ORIENTACAO)){
        const date=new Date(next.DATA_ORIENTACAO+'T12:00:00Z');date.setUTCDate(date.getUTCDate()+9);next.PRAZO=date.toISOString().slice(0,10);
      }
      if(next.STATUS==='Aguardando validação'&&(!next.EVIDENCIA_URL&&!next.OBSERVACAO))throw Error('Informe uma evidência ou observação antes de solicitar validação.');
      if(next.EVIDENCIA_URL&&!/^https:\/\//i.test(next.EVIDENCIA_URL))throw Error('Evidência deve ser um link HTTPS.');
      if(next.STATUS==='Aguardando validação'&&old?.STATUS!=='Aguardando validação') next.DATA_CONCLUSAO=grvNow();
    }
    if(table==='PESSOAS'){
      next.EMAIL=String(next.EMAIL||'').trim().toLowerCase();
      if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(next.EMAIL))throw Error('E-mail inválido.');
      if(grvRows('PESSOAS').some(x=>x.EMAIL===next.EMAIL&&x.ID!==next.ID))throw Error('Este e-mail já está cadastrado.');
      if(!GRV_ROLES.includes(next.PERFIL))throw Error('Perfil inválido.');
      if(!old){next.ATIVO='SIM';next.SALT='';next.HASH='';next.SENHA_TEMPORARIA='SIM';}
      if(old&&old.ID===who.ID&&(next.PERFIL!=='Administrador'||next.ATIVO!=='SIM'))throw Error('Você não pode remover seu próprio acesso.');
    }
    if(table==='GO_LIVE'&&next.STATUS==='Aprovado'&&(!next.EVIDENCIA_URL&&!next.RESPONSAVEL_ID))throw Error('Informe responsável ou evidência.');
    if(!next.ID)next.ID=grvId(({ETAPAS:'ETP',ATIVIDADES:'ATV',PESSOAS:'PES',PENDENCIAS:'PEND',MUDANCAS:'MUD',AGENDA:'AG',TREINAMENTOS:'TRE',GO_LIVE:'GOL'})[table]);
    if(!next.CRIADO_EM)next.CRIADO_EM=grvNow();
    next.ATUALIZADO_EM=grvNow();
    let previousTeam=[],currentTeam=[];
    if(changingTeam){
      const valid=grvRows('PESSOAS').filter(x=>x.ATIVO==='SIM').map(x=>x.ID);
      const participants=[...new Set((p.participantIds||[]).map(String).filter(Boolean))];
      const homologator=String(p.homologatorId||'');
      if(participants.length>30)throw Error('Limite de 30 participantes por atividade.');
      if(participants.some(id=>!valid.includes(id)))throw Error('Há participantes inválidos ou inativos.');
      if(homologator&&!valid.includes(homologator))throw Error('Homologador inválido ou inativo.');
      previousTeam=grvRows('VINCULOS').filter(x=>x.ATIVIDADE_ID===next.ID&&['PARTICIPANTE','HOMOLOGADOR'].includes(x.TIPO));
      currentTeam=participants.map(id=>({PESSOA_ID:id,TIPO:'PARTICIPANTE'}));
      if(homologator)currentTeam.push({PESSOA_ID:homologator,TIPO:'HOMOLOGADOR'});
    }
    grvWrite(table,next);
    if(changingTeam){
      const wanted=new Set(currentTeam.map(x=>x.PESSOA_ID+'|'+x.TIPO));
      previousTeam.filter(x=>!wanted.has(x.PESSOA_ID+'|'+x.TIPO)).sort((a,b)=>Number(b._row)-Number(a._row)).forEach(x=>grvTable('VINCULOS').s.deleteRow(Number(x._row)));
      const was=new Set(previousTeam.map(x=>x.PESSOA_ID+'|'+x.TIPO));
      currentTeam.filter(x=>!was.has(x.PESSOA_ID+'|'+x.TIPO)).forEach(x=>grvWrite('VINCULOS',{ID:grvId('VIN'),ATIVIDADE_ID:next.ID,PESSOA_ID:x.PESSOA_ID,TIPO:x.TIPO,CRIADO_EM:grvNow()}));
      const beforeMembers=previousTeam.map(x=>x.PESSOA_ID+'|'+x.TIPO).sort();
      const afterMembers=currentTeam.map(x=>x.PESSOA_ID+'|'+x.TIPO).sort();
      if(JSON.stringify(beforeMembers)!==JSON.stringify(afterMembers)){
        grvLog(who,'VINCULOS',next.ID,'EQUIPE_ALTERADA',beforeMembers,afterMembers,'Responsável principal: '+(next.RESPONSAVEL_ID||'não definido'));
      }
    }
    const cleaned=o=>{if(!o)return null;const {SALT,HASH,SENHA_TEMPORARIA,_row,...safe}=o;return safe;};
    grvLog(who,table,next.ID,old?'ALTEROU':'CRIOU',cleaned(old),cleaned(next),'');
    return {ok:true,id:next.ID,newPerson:table==='PESSOAS'&&!old,notification:table==='ATIVIDADES'?{id:next.ID,title:next.TITULO,owner:next.RESPONSAVEL_ID,previousOwner:old?.RESPONSAVEL_ID||'',status:next.STATUS,previousStatus:old?.STATUS||'',due:next.PRAZO,previousDue:old?.PRAZO||'',previousTeam:previousTeam.map(x=>x.PESSOA_ID+'|'+x.TIPO),currentTeam:currentTeam.map(x=>x.PESSOA_ID+'|'+x.TIPO)}:null};
  });
  if(saved.newPerson){try{grvInvite(who,{id:saved.id});}catch(err){grvLog(who,'PESSOAS',saved.id,'CONVITE_AUTOMATICO_FALHOU',null,null,String(err));}}
  if(saved.notification){try{grvNotifyActivity(who,saved.notification);}catch(err){grvLog(who,'ATIVIDADES',saved.id,'NOTIFICACAO_FALHOU',null,null,String(err));}}
  return {ok:true,id:saved.id};
}
function grvApprove(who,p){
  if(!GRV_MANAGERS.includes(who.PERFIL) && !grvRows('VINCULOS').some(v=>v.TIPO==='HOMOLOGADOR'&&v.ATIVIDADE_ID===String(p.id||'')&&v.PESSOA_ID===who.ID))throw Error('Apenas consultoria ou homologador designado pode aprovar.');
  const id=String(p.id||''),decision=String(p.decision||''),note=String(p.note||'').trim();
  if(!['Homologada','Devolvida'].includes(decision))throw Error('Decisão inválida.');
  if(decision==='Devolvida'&&!note)throw Error('Informe o motivo da devolução.');
  const approved=grvLock(()=>{
    const a=grvFind('ATIVIDADES',id);
    if(!a)throw Error('Atividade não encontrada.');
    if(!['Aguardando validação','Devolvida','Em execução'].includes(a.STATUS))throw Error('Atividade não está disponível para homologação.');
    const before={...a};a.STATUS=decision;a.OBSERVACAO=note||a.OBSERVACAO;
    if(decision==='Homologada'){a.DATA_HOMOLOGACAO=grvNow();a.HOMOLOGADO_POR=who.ID;}
    a.ATUALIZADO_EM=grvNow();grvWrite('ATIVIDADES',a);
    const h={ID:grvId('HOM'),ATIVIDADE_ID:id,DECISAO:decision,PARECER:note,RESPONSAVEL_ID:who.ID,DATA:grvNow(),EVIDENCIA_URL:a.EVIDENCIA_URL};
    grvWrite('HOMOLOGACOES',h);grvLog(who,'ATIVIDADES',id,'HOMOLOGOU_'+decision,before,a,note);
    return {ok:true,id:id,title:a.TITULO,owner:a.RESPONSAVEL_ID,decision:decision};
  });
  const involved=new Set([approved.owner,...grvRows('VINCULOS').filter(v=>v.ATIVIDADE_ID===id&&v.TIPO==='PARTICIPANTE').map(v=>v.PESSOA_ID)]);
  const toNotify=grvRows('PESSOAS').filter(u=>involved.has(u.ID)&&u.ID!==who.ID&&u.ATIVO==='SIM');
  toNotify.forEach(u=>grvMail(who,'HOMOLOGACAO',u.EMAIL,'GRVMAX | '+decision+' — '+approved.title,'Sua atividade teve nova decisão: '+decision+'\nAtividade: '+approved.title+'\nParecer: '+note+'\nAcesse: '+grvPortalLink(),id));
  return {ok:true};
}
function grvNotifyActivity(who,n){
  const all=grvRows('PESSOAS'),recipient=all.find(p=>p.ID===n.owner&&p.ATIVO==='SIM');
  if(recipient&&n.owner!==n.previousOwner)grvMail(who,'ATRIBUICAO',recipient.EMAIL,'GRVMAX | Nova atividade atribuída','Olá, '+recipient.NOME+'!\nAtividade: '+n.title+'\nPrazo: '+(n.due||'A definir')+'\nAcesse: '+grvPortalLink(),n.id);
  else if(recipient&&n.due!==n.previousDue&&n.previousDue)grvMail(who,'PRAZO_ALTERADO',recipient.EMAIL,'GRVMAX | Prazo alterado — '+n.title,'Atividade: '+n.title+'\nNovo prazo: '+n.due+'\nAcesse: '+grvPortalLink(),n.id);
  const previous=new Set(n.previousTeam||[]),current=new Set(n.currentTeam||[]);
  (n.currentTeam||[]).filter(v=>!previous.has(v)).forEach(v=>{
    const [id,role]=v.split('|'),u=all.find(x=>x.ID===id&&x.ATIVO==='SIM');
    if(u&&u.ID!==n.owner)grvMail(who,role==='HOMOLOGADOR'?'DESIGNACAO_HOMOLOGADOR':'PARTICIPACAO',u.EMAIL,'GRVMAX | '+(role==='HOMOLOGADOR'?'Nova homologação atribuída':'Nova participação')+' — '+n.title,'Olá, '+u.NOME+'!\nAtividade: '+n.title+'\nPapel: '+role+'\nPrazo: '+(n.due||'A definir')+'\nAcesse: '+grvPortalLink(),n.id);
  });
  if(n.status==='Aguardando validação'&&n.previousStatus!==n.status){
    const homologatorId=(n.currentTeam||[]).filter(v=>v.endsWith('|HOMOLOGADOR')).map(v=>v.split('|')[0])[0];
    const reviewers=homologatorId?all.filter(u=>u.ID===homologatorId&&u.ATIVO==='SIM'):all.filter(u=>u.ATIVO==='SIM'&&GRV_MANAGERS.includes(u.PERFIL)&&u.ID!==who.ID);
    reviewers.forEach(u=>grvMail(who,'PEDIDO_VALIDACAO',u.EMAIL,'GRVMAX | Homologação solicitada — '+n.title,'Atividade aguardando conferência: '+n.title+'\nResponsável: '+(recipient?.NOME||'Não definido')+'\nAcesse: '+grvPortalLink(),n.id));
  }
}

function grvLogEmail(who,type,email,subject,body,activity,status,error) {
  grvWrite('COMUNICACOES',{ID:grvId('EML'),TIPO:type,ASSUNTO:subject,CORPO:body,DESTINATARIOS:email,ATIVIDADE_ID:activity||'',STATUS:status,ERRO:error||'',ENVIADO_POR:who.ID||'SISTEMA',DATA:grvNow()});
  grvLog(who,'COMUNICACOES',email,status==='ENVIADO'?'EMAIL_ENVIADO':'EMAIL_'+status,null,{tipo:type,assunto:subject,destinatario:email,atividade:activity,erro:error||''},'');
}
function grvMail(who,type,to,subject,body,activity){
  grvLogEmail(who,type,to,subject,body,activity,'TENTATIVA','');
  try{
    MailApp.sendEmail({to:to,subject:subject,body:body,name:'GRVMAX | Implantação Columbia'});
    grvLogEmail(who,type,to,subject,body,activity,'ENVIADO','');
    return {email:to,status:'ENVIADO'};
  }catch(err){
    grvLogEmail(who,type,to,subject,body,activity,'ERRO',String(err));
    return {email:to,status:'ERRO',error:String(err)};
  }
}
function grvSendEmails(who,p){
  if(!GRV_ROLES.includes(who.PERFIL))throw Error('Sem permissão para enviar comunicações.');
  const ids=Array.isArray(p.peopleIds)?p.peopleIds.slice(0,50):[];
  if(!ids.length)throw Error('Selecione os destinatários.');
  const subj=String(p.subject||'').trim().slice(0,200),body=String(p.body||'').trim().slice(0,15000);
  if(!subj||!body)throw Error('Preencha assunto e mensagem.');
  const dest=grvRows('PESSOAS').filter(x=>ids.includes(x.ID)&&x.ATIVO==='SIM');
  if(!dest.length)throw Error('Nenhum destinatário ativo.');
  const results=dest.map(x=>grvMail(who,'MANUAL',x.EMAIL,subj,body+'\n\nAcompanhe: '+grvPortalLink(),String(p.activityId||'')));
  return {ok:true,results:results};
}
function grvPortalLink(){return 'https://consultoriarf.net/columbia/grvmax/';}
function grvInvite(who,p){
  if(who.PERFIL!=='Administrador')throw Error('Somente administrador convida usuários.');
  const person=grvFind('PESSOAS',String(p.id||''));
  if(!person||person.ATIVO!=='SIM')throw Error('Usuário não encontrado ou inativo.');
  const token=grvToken(),expires=new Date(Date.now()+48*3600000).toISOString();
  grvLock(()=>grvWrite('CONVITES',{ID:grvId('INV'),PESSOA_ID:person.ID,TOKEN_HASH:grvDigest(token),EXPIRA_EM:expires,UTILIZADO_EM:'',CRIADO_EM:grvNow()}));
  const url=grvPortalLink()+'?invite='+encodeURIComponent(token)+'&email='+encodeURIComponent(person.EMAIL);
  const result=grvMail(who,'CONVITE',person.EMAIL,'GRVMAX | Defina sua senha','Olá, '+person.NOME+'!\n\nSeu acesso à implantação do GRVMAX foi cadastrado.\nDefina sua senha pessoal (link válido por 48 horas):\n'+url+'\n\nSe você não solicitou, ignore esta mensagem.','');
  return {ok:result.status==='ENVIADO',result};
}
function grvForgot(p){
  const email=String(p.email||'').trim().toLowerCase(),person=grvFindEmail(email);
  if(person && person.ATIVO==='SIM'){
    const token=grvToken(),expires=new Date(Date.now()+30*60000).toISOString();
    grvLock(()=>grvWrite('CONVITES',{ID:grvId('RST'),PESSOA_ID:person.ID,TOKEN_HASH:grvDigest(token),EXPIRA_EM:expires,UTILIZADO_EM:'',CRIADO_EM:grvNow()}));
    grvMail({ID:'SISTEMA',EMAIL:'sistema'},'RECUPERACAO',email,'GRVMAX | Redefinição de senha','Para redefinir sua senha, acesse em até 30 minutos:\n'+grvPortalLink()+'?invite='+encodeURIComponent(token)+'&email='+encodeURIComponent(email),'');
  }
  return {ok:true,message:'Se o e-mail estiver cadastrado, enviaremos instruções.'};
}
function grvSetPassword(p){
  const email=String(p.email||'').trim().toLowerCase(),pass=String(p.password||''),token=String(p.invite||'');
  if(pass.length<10)throw Error('A senha deve ter no mínimo 10 caracteres.');
  return grvLock(()=>{
    const person=grvFindEmail(email),inv=grvRows('CONVITES').find(x=>x.PESSOA_ID===person?.ID&&x.TOKEN_HASH===grvDigest(token)&&!x.UTILIZADO_EM&&Date.parse(x.EXPIRA_EM)>Date.now());
    if(!person||!inv||token.length<50)throw Error('Link inválido ou expirado.');
    const before={senhaDefinida:!!person.HASH};person.SALT=grvToken();person.HASH=grvHash(pass,person.SALT);person.SENHA_TEMPORARIA='NÃO';person.ATUALIZADO_EM=grvNow();
    inv.UTILIZADO_EM=grvNow();grvWrite('PESSOAS',person);grvWrite('CONVITES',inv);
    grvLog(person,'PESSOAS',person.ID,'SENHA_DEFINIDA',before,{senhaDefinida:true},'Convite/reset utilizado');
    return {ok:true};
  });
}
function grvLogout(who,token){
  grvLock(()=>{
    const ses=grvRows('SESSOES').find(x=>x.TOKEN_HASH===grvDigest(token));
    if(ses){ses.REVOGADA='SIM';grvWrite('SESSOES',ses);}
    grvLog(who,'SESSOES',ses?.ID||'','LOGOUT',null,null,'');
  });
}
function grvGoDecision(who,p){
  if(who.PERFIL!=='Administrador')throw Error('Apenas administrador libera o GO LIVE.');
  const decision=String(p.decision||''),note=String(p.note||'');
  if(!['GO','NO-GO'].includes(decision))throw Error('Decisão inválida');
  const unchecked=grvRows('GO_LIVE').filter(x=>x.OBRIGATORIO==='SIM'&&x.STATUS!=='Aprovado');
  const critical=grvRows('PENDENCIAS').filter(x=>x.PRIORIDADE==='Crítica'&&!['Resolvida','Cancelada'].includes(x.STATUS));
  if(decision==='GO'&&(unchecked.length||critical.length))throw Error('GO LIVE bloqueado: '+unchecked.length+' critérios não aprovados, '+critical.length+' pendências críticas.');
  return grvLock(()=>{
    const proj=grvRows('PROJETOS')[0];if(!proj)throw Error('Projeto não encontrado');
    const before={...proj};proj.STATUS=decision==='GO'?'GO LIVE autorizado':'GO LIVE bloqueado';proj.ATUALIZADO_EM=grvNow();if(decision==='GO')proj.DATA_GO_LIVE=grvNow().slice(0,10);
    grvWrite('PROJETOS',proj);grvLog(who,'PROJETOS',proj.ID,'DECISAO_'+decision,before,proj,note);
    return {ok:true};
  });
}
function grvInstallReminders(who){
  if(who.PERFIL!=='Administrador')throw Error('Apenas administrador configura lembretes.');
  ScriptApp.getProjectTriggers().filter(t=>t.getHandlerFunction()==='cronReminders').forEach(t=>ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('cronReminders').timeBased().everyDays(1).atHour(8).create();
  grvLog(who,'CONFIG','','LEMBRETES_ATIVADOS',null,{frequencia:'diária 8h'},'');
  return {ok:true};
}
function grvReminders(who){if(!GRV_MANAGERS.includes(who.PERFIL))throw Error('Sem permissão.');return grvRunReminders(who);}
function cronReminders(){grvRunReminders({ID:'SISTEMA',EMAIL:'sistema'});}
function grvRunReminders(who){
  const today=Utilities.formatDate(new Date(),'America/Sao_Paulo','yyyy-MM-dd'),people=grvRows('PESSOAS'),history=grvRows('COMUNICACOES'),activity=grvRows('ATIVIDADES');
  let total=0,errors=0;
  activity.forEach(a=>{
    if(!a.PRAZO||['Homologada','Cancelada'].includes(a.STATUS)||!a.RESPONSAVEL_ID)return;
    const diff=Math.round((new Date(a.PRAZO+'T12:00:00Z')-new Date(today+'T12:00:00Z'))/86400000);
    if(diff>2)return;
    const person=people.find(x=>x.ID===a.RESPONSAVEL_ID&&x.ATIVO==='SIM');if(!person)return;
    const key='LEMBRETE-'+today+'-'+a.ID;
    if(history.some(e=>e.TIPO===key&&e.DESTINATARIOS===person.EMAIL))return;
    const subject=diff<0?'[Atrasada] '+a.TITULO:'[Prazo próximo] '+a.TITULO;
    const text='Olá '+person.NOME+',\n\nAtividade: '+a.TITULO+'\nPrazo: '+a.PRAZO+'\nSituação: '+a.STATUS+'\n\nAcompanhe: '+grvPortalLink();
    const r=grvMail(who,key,person.EMAIL,subject,text,a.ID);total++;if(r.status==='ERRO')errors++;
  });
  grvLog(who,'COMUNICACOES','','LEMBRETES_PROCESSADOS',null,{total:total,erros:errors},'');
  return {ok:true,total:total,errors:errors};
}