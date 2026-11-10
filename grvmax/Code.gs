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

/* Permissões persistidas em aba PERMISSOES: uma linha JSON por perfil. */
const GRV_PERMISSION_MODULES={
  dashboard:['view'],plano:['view'],
  stages:['view','create','edit','schedule'],
  activities:['view','view_all','create','edit','status','comment','assign','delete','schedule'],
  approvals:['view','decide','decide_all'],people:['view','create','edit','invite'],
  emails:['view','send','reminders','schedule'],
  agenda:['view','create','edit'],pending:['view','create','edit'],
  changes:['view','create','edit'],training:['view','create','edit'],
  golive:['view','edit','decide'],history:['view'],permissions:['view','manage']
};
const GRV_TABLE_MODULE={ETAPAS:'stages',ATIVIDADES:'activities',PESSOAS:'people',
  PENDENCIAS:'pending',MUDANCAS:'changes',AGENDA:'agenda',
  TREINAMENTOS:'training',GO_LIVE:'golive'};
let GRV_PERM_CACHE=null;
function grvPermissionKeys(){
  return Object.keys(GRV_PERMISSION_MODULES).flatMap(m=>GRV_PERMISSION_MODULES[m].map(a=>m+'.'+a));
}
function grvPermissionDefaults(role){
  const result={};grvPermissionKeys().forEach(k=>result[k]=role==='Administrador');
  if(role==='Administrador')return result;
  const views=['dashboard','stages','activities','approvals','people','emails',
    'agenda','pending','changes','training','golive','history'];
  if(role!=='Usuário-chave')views.push('plano');
  views.forEach(m=>result[m+'.view']=true);
  if(['Consultor','Gestor'].includes(role))result['activities.view_all']=true;
  ['activities.status','activities.comment','approvals.decide','emails.send']
    .forEach(k=>result[k]=true);
  if(role==='Consultor'){
    result['approvals.decide_all']=true;
    ['stages.create','stages.edit','stages.schedule','activities.create',
      'activities.edit','activities.assign','activities.delete','activities.schedule',
      'emails.reminders','agenda.create','agenda.edit','pending.create','pending.edit',
      'changes.create','changes.edit','training.create','training.edit','golive.edit']
      .forEach(k=>result[k]=true);
  }
  return result;
}
function grvPermissionMatrix(){
  if(GRV_PERM_CACHE)return GRV_PERM_CACHE;
  const matrix={};GRV_ROLES.forEach(role=>matrix[role]=grvPermissionDefaults(role));
  const sheet=grvSS().getSheetByName('PERMISSOES');
  if(sheet&&sheet.getLastRow()>1){
    sheet.getRange(2,1,sheet.getLastRow()-1,2).getDisplayValues().forEach(row=>{
      const role=row[0];if(!GRV_ROLES.includes(role)||role==='Administrador')return;
      try{
        const data=JSON.parse(row[1]||'{}');
        if(!data||typeof data!=='object'||Array.isArray(data))return;
        grvPermissionKeys().forEach(k=>{if(typeof data[k]==='boolean')matrix[role][k]=data[k];});
      }catch(ignored){}
    });
  }
  GRV_PERM_CACHE=matrix;return matrix;
}
function grvCan(who,key){
  if(!who||!GRV_ROLES.includes(who.PERFIL)||!grvPermissionKeys().includes(key))return false;
  if(who.PERFIL==='Administrador')return true;
  if(key.startsWith('permissions.'))return false;
  const allowed=grvPermissionMatrix()[who.PERFIL]||{},module=key.split('.')[0];
  return !!allowed[key]&&(key.endsWith('.view')||!!allowed[module+'.view']);
}
function grvSavePermissions(who,p){
  if(who.PERFIL!=='Administrador')throw Error('Somente administradores podem alterar permissões.');
  const role=String(p.role||''),data=p.permissions;
  if(!GRV_ROLES.includes(role)||role==='Administrador')throw Error('O perfil Administrador é protegido e não pode ser alterado.');
  if(!data||typeof data!=='object'||Array.isArray(data))throw Error('Matriz de permissões inválida.');
  const keys=grvPermissionKeys();
  if(Object.keys(data).some(k=>!keys.includes(k)))throw Error('Permissão desconhecida.');
  const clean={};keys.forEach(k=>{
    if(k.startsWith('permissions.')){clean[k]=false;return;}
    if(typeof data[k]!=='boolean')throw Error('Matriz incompleta.');
    const m=k.split('.')[0];clean[k]=!!data[k]&&(k.endsWith('.view')||!!data[m+'.view']);
  });
  return grvLock(()=>{
    const before=grvPermissionMatrix()[role];
    const sheet=grvSS().getSheetByName('PERMISSOES')||grvSS().insertSheet('PERMISSOES');
    if(!sheet.getLastRow())sheet.appendRow(['PERFIL','REGRAS_JSON','ATUALIZADO_EM','ATUALIZADO_POR']);
    const rows=sheet.getLastRow()>1?sheet.getRange(2,1,sheet.getLastRow()-1,1).getDisplayValues().flat():[];
    const idx=rows.indexOf(role),row=[role,JSON.stringify(clean),grvNow(),who.EMAIL];
    if(idx>=0)sheet.getRange(idx+2,1,1,4).setValues([row]);
    else sheet.appendRow(row);
    GRV_PERM_CACHE=null;
    grvLog(who,'PERMISSOES',role,'PERMISSOES_ALTERADAS',before,clean,
      'Alteração de perfil pelo administrador');
    return {ok:true,role:role,permissions:clean};
  });
}


function doGet(e) {
  const html = UrlFetchApp.fetch(GRV_APP_HTML, {muteHttpExceptions:true, followRedirects:true});
  if (html.getResponseCode() !== 200) return HtmlService.createHtmlOutput('Interface não disponível. Atualize a página.');
  return HtmlService.createHtmlOutput(html.getContentText('UTF-8'))
    .setTitle('GRVMAX | Implantação Columbia')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}
/**
 * API HTTP: somente POST JSON. O Cloudflare Worker faz proxy HTTPS e CORS.
 * Preserva google.script.run / doGet para rollback da versão anterior.
 */
function doPost(e) {
  let answer;
  try {
    const raw=e&&e.postData&&e.postData.contents||'';
    if(!raw || raw.length>150000)throw Error('Corpo da requisição inválido.');
    const req=JSON.parse(raw);
    if(!req || typeof req.action!=='string' || !req.payload || typeof req.payload!=='object' || Array.isArray(req.payload))
      throw Error('Parâmetros inválidos.');
    if(req.token && (typeof req.token!=='string' || req.token.length>512))
      throw Error('Credencial inválida.');
    answer={ok:true,result:api(req.action,req.payload,req.token||'')};
  }catch(err){
    answer={ok:false,error:String(err&&err.message||err)};
  }
  return ContentService.createTextOutput(JSON.stringify(answer))
    .setMimeType(ContentService.MimeType.JSON);
}

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
      case 'savePermissions': return grvSavePermissions(who,p);
      case 'save': return grvSave(who,p);
      case 'recalculateSchedule': return grvRecalculateSchedule(who);
      case 'syncStageDates': return grvSyncStagesNow(who);
      case 'deleteActivity': return grvDeleteActivity(who,p);
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

/**
 * Dependencias do cronograma: o sucessor so pode iniciar depois da
 * VALIDACAO (PRAZO) de sua predecessora. Datas autoajustadas usam
 * orientacao na terca e validacao na quinta, 16 dias depois.
 * O planejamento inteiro e calculado ANTES de gravar qualquer linha.
 */
function grvValidPlanDate(v) {
  const d=String(v||'');
  return /^\d{4}-\d{2}-\d{2}$/.test(d)&&!isNaN(Date.parse(d+'T12:00:00Z'))&&new Date(d+'T12:00:00Z').toISOString().slice(0,10)===d;
}
function grvPlanAddDays(v,days) {
  if(!grvValidPlanDate(v))return '';
  const d=new Date(v+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+days);
  return d.toISOString().slice(0,10);
}
function grvPlanDiff(a,b) {
  return grvValidPlanDate(a)&&grvValidPlanDate(b)
    ?Math.round((Date.parse(a+'T12:00:00Z')-Date.parse(b+'T12:00:00Z'))/86400000):0;
}
function grvPlanRecess(v) {
  const md=String(v||'').slice(5,10);
  return md>='12-20'||md<='01-03';
}
function grvPlanWeekday(v,weekday,strict) {
  let d=grvPlanAddDays(v,strict?1:0);
  if(!d)return '';
  for(let i=0;i<70;i++){
    if(new Date(d+'T12:00:00Z').getUTCDay()===weekday&&!grvPlanRecess(d))return d;
    d=grvPlanAddDays(d,1);
  }
  throw Error('Não foi possível encontrar uma data útil para o cronograma.');
}
function grvPlanValidation(orientation) {
  return grvPlanWeekday(grvPlanAddDays(orientation,16),4,false);
}
function grvPlanCheckDirectActivity(a,rows) {
  if(a.DATA_ORIENTACAO&&!grvValidPlanDate(a.DATA_ORIENTACAO))throw Error('Data da orientação inválida.');
  if(a.PRAZO&&!grvValidPlanDate(a.PRAZO))throw Error('Data da validação inválida.');
  if(a.DATA_ORIENTACAO&&a.PRAZO&&a.PRAZO<a.DATA_ORIENTACAO)
    throw Error('A validação não pode anteceder a orientação.');
  if(!a.DEPENDE_DE)return;
  if(a.DEPENDE_DE===a.ID)throw Error('A atividade não pode depender dela mesma.');
  const parent=rows.find(x=>x.ID===a.DEPENDE_DE);
  if(!parent)throw Error('Atividade predecessora não encontrada.');
  if(!grvValidPlanDate(parent.PRAZO))throw Error('Defina a data de validação da predecessora: '+parent.TITULO);
  const min=grvPlanWeekday(parent.PRAZO,2,true);
  if(!grvValidPlanDate(a.DATA_ORIENTACAO))throw Error('Informe a orientação da atividade dependente (a partir de '+min+').');
  if(a.DATA_ORIENTACAO<min)
    throw Error('Dependência inválida: "'+a.TITULO+'" só pode iniciar a partir de '+min+' (terça após a validação de "'+parent.TITULO+'", em '+parent.PRAZO+').');
}
/**
 * Ordenacao topologica evita ciclos e garante que cadeias A -> B -> C
 * sejam reajustadas na ordem correta. Mantem a folga existente quando
 * possivel e respeita sempre a validacao da predecessora.
 */
function grvPlanActivityChain(rows,rootId,oldRoot,repairAll) {
  const byId=new Map(rows.map(x=>[x.ID,{...x}]));
  const original=new Map(rows.map(x=>[x.ID,{...x}]));
  if(oldRoot)original.set(rootId,{...oldRoot});
  const order=[],visiting=new Set(),visited=new Set();
  function visit(id) {
    if(visiting.has(id))throw Error('Dependência circular detectada entre atividades. Corrija antes de salvar.');
    if(visited.has(id))return;
    const a=byId.get(id);if(!a)return;
    visiting.add(id);
    if(a.DEPENDE_DE&&byId.has(a.DEPENDE_DE))visit(a.DEPENDE_DE);
    visiting.delete(id);visited.add(id);order.push(id);
  }
  Array.from(byId.keys()).forEach(visit);
  const touched=new Set(rootId?[rootId]:[]),changed=[];
  order.forEach(id=>{
    if(id===rootId&&!repairAll)return;
    const a=byId.get(id),pid=String(a.DEPENDE_DE||'');
    if(!pid||(!repairAll&&!touched.has(pid)))return;
    const parent=byId.get(pid);
    if(!parent)throw Error('A predecessora de "'+a.TITULO+'" não foi encontrada.');
    if(!grvValidPlanDate(parent.PRAZO))throw Error('Defina a validação da predecessora "'+parent.TITULO+'" antes de reprogramar.');
    const earliest=grvPlanWeekday(parent.PRAZO,2,true);
    const oldParent=original.get(pid)||parent;
    const delta=touched.has(pid)?grvPlanDiff(parent.PRAZO,oldParent.PRAZO):0;
    const before={...a},completed=['Homologada','Cancelada'].includes(a.STATUS);
    let newStart=a.DATA_ORIENTACAO||'';
    if(!completed&&delta&&grvValidPlanDate(newStart))
      newStart=grvPlanWeekday(grvPlanAddDays(newStart,delta),2,false);
    if(!grvValidPlanDate(newStart)||newStart<earliest)newStart=earliest;
    if(completed&&newStart!==a.DATA_ORIENTACAO)
      throw Error('A atividade "'+a.TITULO+'" já foi concluída/cancelada e ficaria antes da predecessora. Revise o cronograma manualmente.');
    if(!completed&&newStart!==a.DATA_ORIENTACAO){
      a.DATA_ORIENTACAO=newStart;
      a.PRAZO=grvPlanValidation(newStart);
    }else if(!completed&&repairAll&&newStart&&(!grvValidPlanDate(a.PRAZO)||a.PRAZO<newStart)){
      a.PRAZO=grvPlanValidation(newStart);
    }
    if(a.DATA_ORIENTACAO!==before.DATA_ORIENTACAO||a.PRAZO!==before.PRAZO){
      a.ATUALIZADO_EM=grvNow();
      changed.push({before:before,after:{...a}});
    }
    touched.add(id);
  });
  return changed;
}

/**
 * ETAPAS seguem o cronograma das atividades:
 * DATA_INICIO = menor DATA_ORIENTACAO e DATA_FIM = maior PRAZO.
 * Não cria nem altera datas de atividades; só reflete o planejamento atual.
 * Etapas sem nenhuma atividade conservam datas manuais, exceto quando a
 * última atividade é removida (nesse caso, limpa o período obsoleto).
 */
function grvStageActivityRange(stageId,activityRows){
  const rows=activityRows.filter(x=>x.ETAPA_ID===stageId && x.STATUS!=='Cancelada');
  if(!rows.length)return null;
  const starts=rows.map(x=>x.DATA_ORIENTACAO).filter(grvValidPlanDate).sort();
  const ends=rows.map(x=>x.PRAZO).filter(grvValidPlanDate).sort();
  return {DATA_INICIO:starts[0]||'',DATA_FIM:ends.length?ends[ends.length-1]:''};
}
function grvSyncStageDates(who,activityRows,clearEmptyStageIds){
  const stages=grvRows('ETAPAS');
  const clearing=new Set(clearEmptyStageIds||[]);
  const changed=[];
  stages.forEach(st=>{
    const active=grvStageActivityRange(st.ID,activityRows);
    // Etapas sem atividades continuam editáveis, salvo exclusão da última.
    if(!active&&!clearing.has(st.ID)&&!activityRows.some(a=>a.ETAPA_ID===st.ID))return;
    const newStart=active?active.DATA_INICIO:'';
    const newFinish=active?active.DATA_FIM:'';
    if((st.DATA_INICIO||'')===newStart&&(st.DATA_FIM||'')===newFinish)return;
    const before={...st};
    st.DATA_INICIO=newStart;st.DATA_FIM=newFinish;st.ATUALIZADO_EM=grvNow();
    grvWrite('ETAPAS',st);
    const clean=o=>{const {_row,...rest}=o;return rest;};
    grvLog(who,'ETAPAS',st.ID,'DATAS_AJUSTADAS_PELAS_ATIVIDADES',
      clean(before),clean(st),'Início = primeira orientação; fim = última validação.');
    changed.push({ID:st.ID,DATA_INICIO:newStart,DATA_FIM:newFinish});
  });
  return changed;
}
function grvSyncStagesNow(who){
  if(!grvCan(who,'stages.schedule'))
    throw Error('Sem permissão para sincronizar etapas.');
  const changed=grvLock(()=>grvSyncStageDates(who,grvRows('ATIVIDADES')));
  return {ok:true,stagesUpdated:changed.length,stages:changed};
}

function grvApplyActivitySchedule(who,changes) {
  changes.forEach(x=>{
    grvWrite('ATIVIDADES',x.after);
    const clean=o=>{const {_row,...safe}=o;return safe;};
    grvLog(who,'ATIVIDADES',x.after.ID,'REPROGRAMOU_DEPENDENCIA',clean(x.before),clean(x.after),
      'Reprogramação automática após alteração de predecessora. Orientação: '+x.after.DATA_ORIENTACAO+'; validação: '+x.after.PRAZO);
  });
}
function grvRecalculateSchedule(who) {
  if(!grvCan(who,'activities.schedule'))throw Error('Sem permissão para recalcular o cronograma.');
  const updated=grvLock(()=>{
    const rows=grvRows('ATIVIDADES'),plan=grvPlanActivityChain(rows,'',null,true);
    grvApplyActivitySchedule(who,plan);
    const latest=new Map(plan.map(x=>[x.after.ID,x.after]));
    const activities=rows.map(x=>latest.get(x.ID)||x);
    const stages=grvSyncStageDates(who,activities);
    return {plan:plan,stages:stages};
  });
  const changes=updated.plan;
  changes.forEach(x=>{try{grvNotifyActivity(who,{
    id:x.after.ID,title:x.after.TITULO,owner:x.after.RESPONSAVEL_ID,
    previousOwner:x.before.RESPONSAVEL_ID,status:x.after.STATUS,previousStatus:x.before.STATUS,
    due:x.after.PRAZO,previousDue:x.before.PRAZO,previousTeam:[],currentTeam:[]
  });}catch(err){grvLog(who,'ATIVIDADES',x.after.ID,'NOTIFICACAO_FALHOU',null,null,String(err));}});
  return {ok:true,reprogrammed:changes.length,stagesUpdated:updated.stages.length};
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
  const role=who.PERFIL,admin=role==='Administrador',full=grvCan(who,'activities.view_all'),matrix=grvPermissionMatrix(),permissions=matrix[role];
  const listPeople=grvCan(who,'people.view')||grvCan(who,'emails.send');
  const people=grvRows('PESSOAS').filter(x=>admin||x.ATIVO==='SIM').map(x=>{
    const p=grvPublicPerson(x);
    return listPeople||x.ID===who.ID?p:{ID:p.ID,NOME:p.NOME,ATIVO:p.ATIVO};
  });
  const seeActivities=['dashboard.view','plano.view','stages.view','activities.view','approvals.view']
    .some(k=>grvCan(who,k));
  const all=grvRows('ATIVIDADES');
  const vinculos=grvRows('VINCULOS').filter(v=>v.TIPO==='PARTICIPANTE'||v.TIPO==='HOMOLOGADOR');
  const activities=!seeActivities?[]:full?all:all.filter(a=>
    a.RESPONSAVEL_ID===who.ID||vinculos.some(v=>v.ATIVIDADE_ID===a.ID&&v.PESSOA_ID===who.ID));
  const ids=new Set(activities.map(a=>a.ID));
  // Mapa da autoria baseado no log append-only: sem migrar ou regravar atividades.
  const logRows=grvRows('LOGS'),createdBy={},activityNotes={};
  // Observações são imutáveis: cada mensagem ocupa um evento no LOGS.
  // Recupera ainda os textos antigos registrados nos snapshots de auditoria.
  logRows.forEach(x=>{
    if(x.ENTIDADE==='ATIVIDADES'&&ids.has(x.ENTIDADE_ID)){
      let body='',kind='REGISTRO';
      if(x.ACAO==='OBSERVACAO_REGISTRADA'){
        body=String(x.DETALHE||'');kind='OBSERVACAO';
      }else if(x.ACAO==='CRIOU'||x.ACAO==='ALTEROU'){
        try{
          const before=JSON.parse(x.ANTES_JSON||'{}'),after=JSON.parse(x.DEPOIS_JSON||'{}');
          const prev=String(before.OBSERVACAO||'').trim(),curr=String(after.OBSERVACAO||'').trim();
          if(curr&&curr!==prev){body=curr;kind='LEGADO';}
        }catch(ignored){}
      }
      if(body.trim()){
        if(!activityNotes[x.ENTIDADE_ID])activityNotes[x.ENTIDADE_ID]=[];
        activityNotes[x.ENTIDADE_ID].push({
          ID:x.ID,DATA:x.TIMESTAMP,AUTOR_ID:x.ATOR_ID,AUTOR:x.ATOR_EMAIL,
          TEXTO:body.trim(),TIPO:kind
        });
      }
    }
    if(x.ENTIDADE==='ATIVIDADES'&&x.ACAO==='CRIOU'&&ids.has(x.ENTIDADE_ID)&&!createdBy[x.ENTIDADE_ID])
      createdBy[x.ENTIDADE_ID]=x.ATOR_ID;
  });
  activities.forEach(a=>{
    const legacy=String(a.OBSERVACAO||'').trim(),entries=activityNotes[a.ID]||[];
    if(legacy&&!entries.some(x=>x.TEXTO===legacy)){
      if(!activityNotes[a.ID])activityNotes[a.ID]=[];
      activityNotes[a.ID].push({ID:'LEGADO-'+a.ID,DATA:'',AUTOR_ID:'',AUTOR:'',
        TEXTO:legacy,TIPO:'LEGADO'});
    }
  });
  Object.keys(activityNotes).forEach(id=>activityNotes[id].sort((a,b)=>
    String(b.DATA||'').localeCompare(String(a.DATA||''))));
  const stageids=new Set(activities.map(a=>a.ETAPA_ID));
  const safe=(s)=>s.map(o=>{const {_row,...a}=o;return a;});
  const seeStages=['stages.view','activities.view','plano.view','dashboard.view']
    .some(k=>grvCan(who,k));
  return {ok:true,me:grvPublicPerson(who),project:safe(grvRows('PROJETOS')),
    stages:seeStages?safe(grvRows('ETAPAS').filter(x=>full||stageids.has(x.ID))):[],
    activities:safe(activities),createdBy:createdBy,activityNotes:activityNotes,notesAppendOnly:true,
    people:people,vinculos:safe(vinculos.filter(v=>ids.has(v.ATIVIDADE_ID))),
    pending:['pending.view','dashboard.view','plano.view','golive.view'].some(k=>grvCan(who,k))?
      safe(grvRows('PENDENCIAS').filter(x=>full||ids.has(x.ATIVIDADE_ID)||x.RESPONSAVEL_ID===who.ID)):[],
    changes:(grvCan(who,'changes.view')||grvCan(who,'plano.view'))?
      safe(grvRows('MUDANCAS').filter(x=>full||ids.has(x.ATIVIDADE_ID))):[],
    agenda:(grvCan(who,'agenda.view')||grvCan(who,'plano.view'))?
      safe(grvRows('AGENDA').filter(x=>full||x.RESPONSAVEL_ID===who.ID||(x.PARTICIPANTES||'').includes(who.ID))):[],
    trainings:grvCan(who,'training.view')?safe(grvRows('TREINAMENTOS')):[],goLive:(grvCan(who,'golive.view')||grvCan(who,'plano.view'))?safe(grvRows('GO_LIVE')):[],
    approvals:(grvCan(who,'approvals.view')||grvCan(who,'plano.view'))?safe(grvRows('HOMOLOGACOES').filter(x=>full||ids.has(x.ATIVIDADE_ID))):[],
    emails:grvCan(who,'emails.view')?safe(grvRows('COMUNICACOES').filter(x=>full||x.ENVIADO_POR===who.ID).slice(-350).reverse()):[],
    logs:grvCan(who,'history.view')?safe(logRows.filter(x=>full||x.ATOR_ID===who.ID).slice(-500).reverse()):[],
    permissions:permissions,permissionMatrix:admin?matrix:null,canEdit:admin||role==='Consultor',canAdmin:admin};
}
function grvSave(who,p){
  if(String(p.table||'')==='PERMISSOES')return grvSavePermissions(who,p);
  const table=String(p.table||'');if(GRV_EDITABLE.indexOf(table)<0)throw Error('Cadastro não permitido.');
  const body=p.item||{},module=GRV_TABLE_MODULE[table],admin=who.PERFIL==='Administrador',
    isNew=!body.ID,full=grvCan(who,module+'.'+(isNew?'create':'edit')),
    canStatus=table==='ATIVIDADES'&&grvCan(who,'activities.status'),
    canComment=table==='ATIVIDADES'&&grvCan(who,'activities.comment');
  const incomingNote=table==='ATIVIDADES'&&Object.prototype.hasOwnProperty.call(body,'OBSERVACAO')
    ?String(body.OBSERVACAO||'').trim():'';
  if(incomingNote.length>10000)throw Error('Observação deve ter no máximo 10.000 caracteres.');
  if(!grvCan(who,module+'.view'))throw Error('Sem acesso ao módulo.');
  if(!full&&!(table==='ATIVIDADES'&&!isNew&&(canStatus||canComment)))
    throw Error('Você não tem permissão para esta operação.');
  if(table==='ATIVIDADES'&&incomingNote&&!canComment)throw Error('Sem permissão para registrar observações.');
  if(table==='ATIVIDADES'&&body.STATUS!==undefined&&!canStatus)
    throw Error('Sem permissão para alterar a situação.');
  if(table==='PESSOAS'&&!admin&&body.ID===who.ID)throw Error('Você não pode alterar seu próprio acesso.');
  const changingTeam=table==='ATIVIDADES' && (Array.isArray(p.participantIds)||Object.prototype.hasOwnProperty.call(p,'homologatorId'));
  if(changingTeam&&!grvCan(who,'activities.assign'))throw Error('Sem permissão para alterar equipe de atividade.');
  const saved = grvLock(()=>{
    const old=body.ID?grvFind(table,body.ID):null;
    if(body.ID&&!old)throw Error('Registro não encontrado.');
    if(table==='ATIVIDADES'&&!grvCan(who,'activities.view_all')&&
       (!old||old.RESPONSAVEL_ID!==who.ID&&!grvRows('VINCULOS')
         .some(v=>v.ATIVIDADE_ID===old.ID&&v.PESSOA_ID===who.ID))&&!isNew)
      throw Error('Atividade não atribuída a você.');
    if(!full&&(!old||old.RESPONSAVEL_ID!==who.ID&&
       !grvRows('VINCULOS').some(v=>v.ATIVIDADE_ID===old.ID&&v.PESSOA_ID===who.ID)))
      throw Error('Atividade não atribuída a você.');
    if(!full&&old.STATUS==='Homologada')throw Error('Atividade homologada está bloqueada para alterações. Peça reabertura à consultoria.');
    const t=grvTable(table);let next=old?{...old}:{};
    if(!full){
      // Usuário-chave pode atualizar a situação das atividades atribuídas a ele.
      // Homologação continua restrita ao fluxo formal de aprovação.
      const allow=new Set(['ID','STATUS','EVIDENCIA_URL','OBSERVACAO']);
      if(Object.keys(body).some(k=>!allow.has(k)))throw Error('Campo restrito para este perfil.');
      if(canStatus)['STATUS','EVIDENCIA_URL'].forEach(k=>{
        if(body[k]!==undefined)next[k]=String(body[k]).slice(0,3000);
      });
      if(['Homologada','Cancelada'].includes(next.STATUS))throw Error('Homologação exige aprovação da consultoria.');if(!['Não iniciada','Em execução','Aguardando validação','Orientada','Devolvida',old.STATUS].includes(next.STATUS))throw Error('Situação inválida.');}
    else t.heads.forEach(k=>{if(body[k]!==undefined && !['_row','SALT','HASH','SENHA_TEMPORARIA','CRIADO_EM','ATUALIZADO_EM','HOMOLOGADO_POR','DATA_HOMOLOGACAO'].includes(k) && !(table==='ATIVIDADES'&&k==='OBSERVACAO'))next[k]=String(body[k]).slice(0,k==='DESCRICAO'||k==='OBSERVACAO'?30000:3000);});
    if(table==='PESSOAS'&&!admin){
      if(old&&old.PERFIL==='Administrador')throw Error('Sem permissão para editar administrador.');
      if(old&&body.EMAIL!==undefined&&String(body.EMAIL).trim().toLowerCase()!==String(old.EMAIL).toLowerCase())
        throw Error('Somente administradores podem alterar o e-mail de acesso.');
      if((body.PERFIL!==undefined&&old&&String(body.PERFIL)!==old.PERFIL)||
         (body.ATIVO!==undefined&&old&&String(body.ATIVO)!==old.ATIVO)||
         (!old&&body.PERFIL&&body.PERFIL!=='Usuário-chave'))
        throw Error('Somente administradores atribuem perfis e alteram situação de usuários.');
      next.PERFIL=old?old.PERFIL:'Usuário-chave';
      next.ATIVO=old?old.ATIVO:'SIM';
    }
    if(table==='ATIVIDADES'){
      if(!next.STATUS&&!old)next.STATUS='Não iniciada';
      if(!GRV_ACTIVITY_STATUS.includes(next.STATUS||'Não iniciada'))throw Error('Situação inválida.');
      if(next.STATUS==='Homologada'&&(!old||old.STATUS!=='Homologada'))throw Error('Use a homologação formal para aprovar.');
      if(next.DATA_ORIENTACAO && !next.PRAZO && /^\d{4}-\d\d-\d\d$/.test(next.DATA_ORIENTACAO)){
        next.PRAZO=grvPlanValidation(next.DATA_ORIENTACAO);
      }
      if(next.STATUS==='Aguardando validação'&&(!next.EVIDENCIA_URL&&!next.OBSERVACAO&&!incomingNote))throw Error('Informe uma evidência ou observação antes de solicitar validação.');
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
    let scheduleChanges=[],plannedActivities=null;
    if(table==='ETAPAS'){
      const range=grvStageActivityRange(next.ID,grvRows('ATIVIDADES'));
      if(range){next.DATA_INICIO=range.DATA_INICIO;next.DATA_FIM=range.DATA_FIM;}
    }
    if(table==='ATIVIDADES'&&full){
      const all=grvRows('ATIVIDADES').filter(x=>x.ID!==next.ID).concat([next]);
      grvPlanCheckDirectActivity(next,all);
      scheduleChanges=grvPlanActivityChain(all,next.ID,old,false);
      const cascade=new Map(scheduleChanges.map(x=>[x.after.ID,x.after]));
      plannedActivities=all.map(x=>cascade.get(x.ID)||x);
    }
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
    if(scheduleChanges.length)grvApplyActivitySchedule(who,scheduleChanges);
    let stageUpdates=[];
    if(table==='ATIVIDADES'&&full){
      // Inclui etapa anterior caso uma atividade tenha mudado de etapa.
      const clearIds=old&&old.ETAPA_ID!==next.ETAPA_ID?[old.ETAPA_ID]:[];
      stageUpdates=grvSyncStageDates(who,plannedActivities,clearIds);
    }
    // Registro exclusivamente aditivo: nunca altera a mensagem anterior em ATIVIDADES.OBSERVACAO.
    if(table==='ATIVIDADES'&&incomingNote)
      grvLog(who,'ATIVIDADES',next.ID,'OBSERVACAO_REGISTRADA',null,null,incomingNote);
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
    return {ok:true,id:next.ID,newPerson:table==='PESSOAS'&&!old,reprogrammed:scheduleChanges.length,stagesUpdated:stageUpdates.length,cascadeNotifications:scheduleChanges.map(x=>({
      id:x.after.ID,title:x.after.TITULO,owner:x.after.RESPONSAVEL_ID,previousOwner:x.before.RESPONSAVEL_ID,
      status:x.after.STATUS,previousStatus:x.before.STATUS,due:x.after.PRAZO,previousDue:x.before.PRAZO,
      previousTeam:[],currentTeam:[]
    })),notification:table==='ATIVIDADES'?{id:next.ID,title:next.TITULO,owner:next.RESPONSAVEL_ID,previousOwner:old?.RESPONSAVEL_ID||'',status:next.STATUS,previousStatus:old?.STATUS||'',due:next.PRAZO,previousDue:old?.PRAZO||'',previousTeam:previousTeam.map(x=>x.PESSOA_ID+'|'+x.TIPO),currentTeam:currentTeam.map(x=>x.PESSOA_ID+'|'+x.TIPO)}:null};
  });
  if(saved.newPerson&&grvCan(who,'people.invite')){try{grvInvite(who,{id:saved.id});}catch(err){grvLog(who,'PESSOAS',saved.id,'CONVITE_AUTOMATICO_FALHOU',null,null,String(err));}}
  if(saved.notification){try{grvNotifyActivity(who,saved.notification);}catch(err){grvLog(who,'ATIVIDADES',saved.id,'NOTIFICACAO_FALHOU',null,null,String(err));}}
  (saved.cascadeNotifications||[]).forEach(n=>{try{grvNotifyActivity(who,n);}catch(err){grvLog(who,'ATIVIDADES',n.id,'NOTIFICACAO_FALHOU',null,null,String(err));}});
  return {ok:true,id:saved.id,reprogrammed:saved.reprogrammed||0,stagesUpdated:saved.stagesUpdated||0};
}

/**
 * Excluir atividade cadastral sem apagar seu historico. Nao elimina atividades
 * homologadas, ja iniciadas, com sucessoras ou com registros operacionais
 * vinculados. A trilha de auditoria registra o snapshot antes da remocao.
 */
function grvDeleteActivity(who,p) {
  if(!grvCan(who,'activities.delete'))
    throw Error('Sem permissão para excluir atividades.');
  const id=String(p.id||'').trim();
  if(!/^[A-Za-z0-9_-]{3,80}$/.test(id))throw Error('Identificador da atividade inválido.');
  return grvLock(()=>{
    const activity=grvFind('ATIVIDADES',id);
    if(!activity)throw Error('Atividade não encontrada. Atualize a tela.');
    if(!['Não iniciada','Cancelada'].includes(activity.STATUS))
      throw Error('Esta atividade já tem execução registrada. Cancele a atividade antes de excluí-la.');
    const linked=grvRows('ATIVIDADES').filter(x=>String(x.DEPENDE_DE||'').trim()===id);
    if(linked.length)
      throw Error('Não é possível excluir: outras atividades dependem desta ('+
        linked.slice(0,3).map(x=>x.TITULO).join('; ')+
        (linked.length>3?' e mais '+(linked.length-3):'')+'). Remova primeiro essas dependências.');
    for(const table of ['HOMOLOGACOES','PENDENCIAS','MUDANCAS','AGENDA']){
      if(grvRows(table).some(x=>x.ATIVIDADE_ID===id))
        throw Error('Não é possível excluir: existem registros vinculados em '+table+'. Preserve o histórico e use Cancelada.');
    }
    // O historico de e-mails e observacoes e imutavel: COMUNICACOES e LOGS
    // permanecem para auditoria. Apenas os vinculos ativos sao removidos.
    const team=grvRows('VINCULOS').filter(x=>x.ATIVIDADE_ID===id);
    const {_row,...snapshot}=activity;
    grvLog(who,'ATIVIDADES',id,'EXCLUIU',snapshot,null,
      'Exclusão solicitada pelo usuário. Vínculos removidos: '+team.length+'. Histórico preservado.');
    const membersTable=grvTable('VINCULOS').s;
    team.sort((a,b)=>Number(b._row)-Number(a._row))
      .forEach(x=>membersTable.deleteRow(Number(x._row)));
    grvTable('ATIVIDADES').s.deleteRow(Number(activity._row));
    const stageChanges=grvSyncStageDates(who,grvRows('ATIVIDADES'),[activity.ETAPA_ID]);
    return {ok:true,id:id,stagesUpdated:stageChanges.length};
  });
}

function grvApprove(who,p){
  if(!grvCan(who,'approvals.decide') || (!grvCan(who,'approvals.decide_all') && !grvRows('VINCULOS').some(v=>v.TIPO==='HOMOLOGADOR'&&v.ATIVIDADE_ID===String(p.id||'')&&v.PESSOA_ID===who.ID)))throw Error('Sem permissão para homologar esta atividade.');
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
    const reviewers=homologatorId?all.filter(u=>u.ID===homologatorId&&u.ATIVO==='SIM'):all.filter(u=>u.ATIVO==='SIM'&&grvCan(u,'approvals.decide_all')&&u.ID!==who.ID);
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
  if(!grvCan(who,'emails.send'))throw Error('Sem permissão para enviar comunicações.');
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
  if(!grvCan(who,'people.invite'))throw Error('Sem permissão para enviar convites.');
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
  if(!grvCan(who,'golive.decide'))throw Error('Sem permissão para decidir o GO LIVE.');
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
  if(!grvCan(who,'emails.schedule'))throw Error('Sem permissão para agendar lembretes.');
  ScriptApp.getProjectTriggers().filter(t=>t.getHandlerFunction()==='cronReminders').forEach(t=>ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('cronReminders').timeBased().everyDays(1).atHour(8).create();
  grvLog(who,'CONFIG','','LEMBRETES_ATIVADOS',null,{frequencia:'diária 8h'},'');
  return {ok:true};
}
function grvReminders(who){if(!grvCan(who,'emails.reminders'))throw Error('Sem permissão.');return grvRunReminders(who);}
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