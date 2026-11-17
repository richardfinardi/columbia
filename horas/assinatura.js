"use strict";
const API="https://auvriun-whatsapp.auvriun-monitor.workers.dev/whatsapp/v1/columbia/subscription";
const BASE="https://columbia.consultoriarf.net", TOKEN="columbia_analista_token";
const $=id=>document.getElementById(id);
const selected={segmentos:new Set(),maquinas:new Set(),funcionarios:new Set()};
let active=false,loading=false,serverPrefs=null,started=false;
let rawRowsCache=[],previewReport=null,previewSeq=0,previewTimer=null;
const AVAILABLE_CACHE_KEY="columbia_horas_apontafacil_mensal_v4";
async function getAvailableForPreview(period){
 try{
  const cached=JSON.parse(localStorage.getItem(AVAILABLE_CACHE_KEY)||"{}");
  const arr=cached.version===4?cached.months?.[period]:null;
  if(Array.isArray(arr)&&arr.length)return arr;
 }catch(_){}
 const [year,month]=period.split("-");
 const response=await request(BASE+"/horas_disponiveis?ano="+year+"&mes="+Number(month));
 const rows=Array.isArray(response.funcionarios)?response.funcionarios:
  Array.isArray(response.data)?response.data:Array.isArray(response)?response:[];
 if(!rows.length)throw Error("Aponta Fácil não retornou horas para "+period);
 const normalized=rows.map(r=>({
  period:String(r.periodo||r.period||period),
  employee:String(r.nome||r.employee||r.funcionario||""),
  available:Number(r.horas_disponiveis??r.available??0)
 }));
 // Compartilha somente horas agregadas com o cache já usado pelo painel Columbia.
 try{
  const old=JSON.parse(localStorage.getItem(AVAILABLE_CACHE_KEY)||"{}");
  const months=old.version===4&&old.months&&typeof old.months==="object"?old.months:{};
  months[period]=normalized;
  localStorage.setItem(AVAILABLE_CACHE_KEY,JSON.stringify({version:4,months}));
 }catch(_){}
 return normalized;
}
async function buildPreview(){
 const seq=++previewSeq;
 const output=$("messagePreview");
 output.textContent="Calculando metas e horas do último mês fechado...";
 const period=window.ColumbiaWhatsAppReport.lastClosedPeriod();
 try{
  if(!rawRowsCache.length)throw Error("Dados dos apontamentos não estão disponíveis para montar a prévia");
  const available=await getAvailableForPreview(period);
  const report=window.ColumbiaWhatsAppReport.build(rawRowsCache,available,preferences(),period);
  if(seq!==previewSeq)return null;
  previewReport=report;
  output.textContent=report.text;
  $("reportPeriodNotice").textContent="Dados reais de "+period.split("-").reverse().join("/")+" · Prévia mensal (último mês fechado)";
  return report;
 }catch(e){
  if(seq!==previewSeq)return null;
  previewReport=null;
  output.textContent="Não foi possível montar a prévia: "+e.message;
  throw e;
 }
}
function schedulePreview(){
 clearTimeout(previewTimer);
 previewTimer=setTimeout(()=>{void buildPreview().catch(()=>{})},250);
}
const norm=s=>String(s??"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-zA-Z0-9]/g,"").toLowerCase();
function notify(msg,error=false){const el=$("notice");el.textContent=msg;el.classList.toggle("error",error)}
function digits(v){return String(v??"").replace(/\D/g,"")}
function validPhone(v){
 let n=digits(v);
 if(n.length===10||n.length===11)n="55"+n;
 if(!/^55\d{10,11}$/.test(n))throw Error("Informe um WhatsApp brasileiro com DDD.");
 return n;
}
function uniqueSorted(values){return [...new Set(values.filter(Boolean).map(v=>String(v).trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b,"pt-BR"))}
async function request(url,method="GET",body){
 const t=localStorage.getItem(TOKEN);
 if(!t)throw Error("Sessão Columbia encerrada. Entre novamente.");
 const r=await fetch(url,{method,headers:{Authorization:"Bearer "+t,Accept:"application/json",...(body?{"Content-Type":"application/json"}:{})},body:body?JSON.stringify(body):undefined,cache:"no-store"});
 let data={};try{data=await r.json()}catch(_){}
 if(!r.ok)throw Error(data.error||data.detail||"Falha de comunicação (HTTP "+r.status+").");
 return data;
}
function preferences(){
 const types=[];
 if($("topicMetas").checked)types.push("metas");
 if($("topicResumo").checked)types.push("resumo");
 if(!types.length)throw Error("Selecione Metas, Resumo ou ambos.");
 return {types,frequency:document.querySelector("input[name=frequency]:checked")?.value||"mensal",
  scopes:Object.fromEntries(Object.entries(selected).map(([k,v])=>[k,[...v]]))};
}
function updateCount(type){
 const size=selected[type].size;
 $("count"+type[0].toUpperCase()+type.slice(1)).textContent=size?size+" selecionado(s)":"Todos";
}
function picker(type,values){
 const id=type[0].toUpperCase()+type.slice(1),box=$("options"+id);
 box.replaceChildren();
 for(const value of uniqueSorted(values)){
  const label=document.createElement("label"),input=document.createElement("input");
  input.type="checkbox";input.value=value;input.checked=selected[type].has(value);
  input.addEventListener("change",()=>{if(input.checked)selected[type].add(value);else selected[type].delete(value);updateCount(type);schedulePreview()});
  const span=document.createElement("span");span.textContent=value;
  label.append(input,span);box.appendChild(label);
 }
 updateCount(type);
}
function applyPreferences(p){
 if(!p)return;
 $("topicMetas").checked=(p.types||[]).includes("metas");
 $("topicResumo").checked=(p.types||[]).includes("resumo");
 const r=document.querySelector('input[name="frequency"][value="'+p.frequency+'"]');
 if(r)r.checked=true;
 for(const type of Object.keys(selected)){
  selected[type]=new Set(p.scopes?.[type]||[]);
  const options=$("options"+type[0].toUpperCase()+type.slice(1));
  options.querySelectorAll('input[type="checkbox"]').forEach(ch=>ch.checked=selected[type].has(ch.value));
  updateCount(type);
 }
}
async function populate(){
 const raw=await request(BASE+"/custos_apontamento");
 const rows=Array.isArray(raw)?raw:Array.isArray(raw.data)?raw.data:Array.isArray(raw.dados)?raw.dados:Array.isArray(raw.apontamentos)?raw.apontamentos:Array.isArray(raw.custos_apontamento)?raw.custos_apontamento:[];
 rawRowsCache=rows;
 if(!rows.length)return notify("Não foi possível listar máquinas, funcionários e segmentos. A assinatura ainda pode usar 'Todos'.",true);
 picker("segmentos",rows.map(r=>r.seguimento||r.segmento));
 picker("maquinas",rows.map(r=>r.maquina));
 picker("funcionarios",rows.map(r=>r.funcionario));
 if(serverPrefs)applyPreferences(serverPrefs);
}
function stateDisplay(p){
 active=!!p?.active;serverPrefs=p?.preferences||null;
 $("subscriberStatus").classList.toggle("active",active);
 $("subscriberStatus").textContent=active?"Assinatura confirmada · WhatsApp final "+(p?.phoneFinal||"••••")+
   " · "+({diario:"Diária",semanal:"Semanal",mensal:"Mensal"}[p.preferences?.frequency]||""):"Nenhuma assinatura ativa. Confirme seu telefone para começar.";
 $("unsubscribe").hidden=!active;$("savePrefs").hidden=!active;$("testMessage").hidden=!active;
 $("requestCode").textContent=active?"Trocar WhatsApp":"Enviar código";
 if(serverPrefs)applyPreferences(serverPrefs);
}
function busy(yes){loading=yes;for(const id of ["requestCode","confirmCode","savePrefs","unsubscribe","testMessage"])$(id).disabled=yes}
async function boot(){
 try{
  const me=await request(BASE+"/producao/portal/me");
  if(Number(me.u_horas)!==1)throw Error("Seu usuário não tem permissão CSENHA.U_HORAS.");
  $("accessGate").hidden=true;$("app").hidden=false;
  const status=await request(API);
  stateDisplay(status.subscription);
  await populate();
  schedulePreview();
 }catch(e){
  if(!$("app").hidden)notify(e.message,true);
  else $("accessGate").innerHTML="<strong>Não foi possível abrir a assinatura</strong><p></p><a href='./index.html'>Voltar ao painel</a>",
       $("accessGate").querySelector("p").textContent=e.message;
 }
}
$("requestCode").addEventListener("click",async()=>{
 if(loading)return;
 try{
  const phone=validPhone($("phoneInput").value),pref=preferences();
  busy(true);notify("");
  const res=await request(API+"/start","POST",{phone,...pref});
  $("confirmBox").hidden=false;$("otpInput").value="";
  $("otpInput").focus();
  notify("Código enviado ao WhatsApp final "+res.phoneFinal+". Digite os seis números para confirmar.");
  started=true;
 }catch(e){notify(e.message,true)}finally{busy(false)}
});
$("confirmCode").addEventListener("click",async()=>{
 if(loading)return;
 try{
  busy(true);notify("");
  if(!/^\d{6}$/.test($("otpInput").value.trim()))throw Error("Digite os seis dígitos recebidos.");
  await request(API+"/confirm","POST",{code:$("otpInput").value.trim()});
  $("confirmBox").hidden=true;$("phoneInput").value="";started=false;
  stateDisplay((await request(API)).subscription);
  notify("Seu WhatsApp foi confirmado e as preferências foram salvas.");
 }catch(e){notify(e.message,true)}finally{busy(false)}
});
$("savePrefs").addEventListener("click",async()=>{
 if(loading)return;
 try{
  if(digits($("phoneInput").value))throw Error("Para mudar de número, use 'Trocar WhatsApp' e confirme o novo código.");
  busy(true);await request(API,"PUT",preferences());
  stateDisplay((await request(API)).subscription);
  notify("Preferências atualizadas.");
 }catch(e){notify(e.message,true)}finally{busy(false)}
});
$("testMessage").addEventListener("click",async()=>{
 if(loading||!active)return;
 try{
  busy(true);notify("Montando relatório real e enviando ao WhatsApp confirmado...");
  const report=await buildPreview();
  if(!report)throw Error("A prévia mudou durante a consulta. Tente novamente.");
  const response=await request(API+"/test","POST",{message:report.text});
  notify(response.status==="ACCEPTED"
   ?"AUVRIUN aceitou o envio da prévia real para o WhatsApp final "+response.phoneFinal+". Confira a mensagem no celular."
   :"Não foi possível confirmar o envio.");
 }catch(e){notify(e.message,true)}finally{busy(false)}
});
$("unsubscribe").addEventListener("click",async()=>{
 if(loading||!confirm("Cancelar o recebimento de relatórios no WhatsApp?"))return;
 try{
  busy(true);await request(API,"DELETE");stateDisplay(null);
  notify("Assinatura cancelada. Nenhuma outra mensagem programada deve ser enviada.");
 }catch(e){notify(e.message,true)}finally{busy(false)}
});
document.querySelectorAll(".picker").forEach(el=>{
 el.querySelector(".picker-search").addEventListener("input",e=>{
  const q=norm(e.target.value);
  el.querySelectorAll(".picker-options label").forEach(label=>label.hidden=!norm(label.textContent).includes(q));
 });
});
$("reloadPreview").addEventListener("click",()=>{void buildPreview().catch(e=>notify(e.message,true))});
document.querySelectorAll("#topicMetas,#topicResumo,input[name=frequency]").forEach(el=>el.addEventListener("change",schedulePreview));
document.addEventListener("DOMContentLoaded",boot);
