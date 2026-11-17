/* Prévia de WhatsApp para o Fechamento Columbia.
   Cálculo: mesma base de rateio do painel (horas totais do GRV por funcionário).
   Enquanto custos_apontamento não fornecer datas diárias, a prévia usa mês fechado. */
"use strict";
window.ColumbiaWhatsAppReport=(()=>{
 const norm=x=>String(x??"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-zA-Z0-9]/g,"").toLowerCase();
 const clean=x=>String(x??"").trim();
 const number=x=>{
  if(x===null||x===undefined||x==="")return 0;
  if(typeof x==="number")return Number.isFinite(x)?x:0;
  let s=String(x).replace(/\s/g,"");
  if(s.includes(",")&&s.includes("."))s=s.replace(/\./g,"").replace(",",".");
  else if(s.includes(","))s=s.replace(",",".");
  const n=Number(s);return Number.isFinite(n)?n:0;
 };
 const fmt=n=>number(n).toLocaleString("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2});
 const pct=n=>Number.isFinite(n)?(n*100).toLocaleString("pt-BR",{minimumFractionDigits:1,maximumFractionDigits:1})+"%":"—";
 const get=(r,keys)=>{
  if(!r||typeof r!=="object")return null;
  const vals=Object.fromEntries(Object.entries(r).map(([k,v])=>[norm(k),v]));
  for(const k of keys){const v=vals[norm(k)];if(v!==null&&v!==undefined&&v!=="")return v}
  return null;
 };
 const periodOf=r=>{
  const raw=clean(get(r,["ano_mes","periodo","competencia","mes_ano"]));
  let m=raw.match(/^(20\d{2})[-/]?(0?[1-9]|1[0-2])(?:[-/]\d{1,2})?$/);
  if(m)return m[1]+"-"+m[2].padStart(2,"0");
  const date=clean(get(r,["data","dt_apontamento","dt_inicio"]));
  m=date.match(/^(20\d{2})[-/](\d{2})(?:[-/]\d{2})?/);
  if(m)return m[1]+"-"+m[2];
  const year=Number(get(r,["ano"])),month=Number(get(r,["mes"]));
  return year>=2000&&month>=1&&month<=12?year+"-"+String(month).padStart(2,"0"):"";
 };
 const row=r=>{
  const total=number(get(r,["horas_apontadas","horas","total_horas"]));
  const pRaw=get(r,["hr_produtiva","horas_produtivas","produtivas"]);
  const sRaw=get(r,["horas_paradas","paradas"]);
  const prod=pRaw!==null?number(pRaw):sRaw!==null?total-number(sRaw):total;
  const stop=sRaw!==null?number(sRaw):Math.max(0,total-prod);
  const employee=clean(get(r,["funcionario","nome_funcionario","colaborador","nome"]));
  return {period:periodOf(r),person:norm(employee),segment:clean(get(r,["seguimento","segmento"]))||"Sem segmento",
    machine:clean(get(r,["maquina"]))||"Não informado",employee,
    total,prod,stop};
 };
 const asAvailable=a=>({period:clean(get(a,["period","periodo","ano_mes"])),
  person:norm(get(a,["employee","nome","funcionario"])),
  value:number(get(a,["available","horas_disponiveis"]))});
 const monthLabel=period=>{
  const [year,month]=period.split("-").map(Number);
  return new Intl.DateTimeFormat("pt-BR",{month:"long",year:"numeric",timeZone:"UTC"}).format(new Date(Date.UTC(year,month-1,1)));
 };
 const allScopes=(r,scopes)=>[
  ["segmentos","segment"],["maquinas","machine"],["funcionarios","employee"]
 ].every(([p,k])=>!(scopes?.[p]||[]).length||(scopes[p]||[]).some(v=>norm(v)===norm(r[k])));
 function calculate(rows,availableRows,scopes,period){
  const full=rows.filter(r=>r.period===period);
  const filtered=full.filter(r=>allScopes(r,scopes));
  const totals=new Map(),subtotals=new Map(),people=new Set();
  for(const r of full){totals.set(r.person,(totals.get(r.person)||0)+r.total)}
  for(const r of filtered){people.add(r.person);subtotals.set(r.person,(subtotals.get(r.person)||0)+r.total)}
  const hasSubgroup=(scopes.segmentos?.length||0)+(scopes.maquinas?.length||0)+(scopes.funcionarios?.length||0)>0;
  let available=0;
  for(const a of availableRows){
   if(a.period!==period||!people.has(a.person))continue;
   const denominator=totals.get(a.person)||0;
   if(hasSubgroup){if(denominator>0)available+=a.value*(subtotals.get(a.person)||0)/denominator}
   else available+=a.value;
  }
  const prod=filtered.reduce((s,r)=>s+r.prod,0);
  const stop=filtered.reduce((s,r)=>s+r.stop,0);
  const waste=available-prod-stop;
  return {available,prod,stop,waste,rows:filtered.length,pProd:available?prod/available:NaN,
   pStop:available?stop/available:NaN,pWaste:available?waste/available:NaN};
 }
 const bar=value=>{if(!Number.isFinite(value))return "░".repeat(10);
  const filled=Math.min(10,Math.max(0,Math.round(value*10)));
  return "█".repeat(filled)+"░".repeat(10-filled)};
 const grade=(kind,value)=>{
  if(!Number.isFinite(value))return "Sem base";
  if(kind==="prod")return value>=1?"Ótimo":value>=.8?"Bom":value>=.75?"Regular":"Ruim";
  if(kind==="stop")return value<=.1?"Ótimo":value<=.2?"Bom":value<=.4?"Regular":"Ruim";
  return value<=.02?"Ótimo":value<=.05?"Bom":value<=.3?"Regular":"Ruim";
 };
 const scopeLine=(label,vals)=>{
  if(!vals?.length)return label+": Todos";
  return label+": "+(vals.length<=3?vals.join(" | "):vals.slice(0,3).join(" | ")+" +"+(vals.length-3));
 };
 function build(rawRows,rawAvailable,preferences,period){
  const rows=rawRows.map(row),available=rawAvailable.map(asAvailable);
  if(!rows.some(r=>r.period===period))throw Error("Sem apontamentos GRV em "+monthLabel(period));
  if(!available.some(r=>r.period===period))throw Error("Sem horas do Aponta Fácil em "+monthLabel(period));
  const pref=preferences||{},scopes=pref.scopes||{};
  const result=calculate(rows,available,scopes,period);
  if(!result.rows)throw Error("Nenhum apontamento encontrado para os filtros selecionados");
  if(result.available<=0)throw Error("Não há horas disponíveis conciliadas para os filtros escolhidos");
  const lines=["*COLUMBIA MACHINE | PRÉVIA REAL*","*Fechamento de Horas*",
   "*Competência:* "+monthLabel(period).replace(/^./,x=>x.toUpperCase())+" (mês fechado)","",
   "*Filtros selecionados:*",
   scopeLine("Segmentos",scopes.segmentos),scopeLine("Máquinas",scopes.maquinas),
   scopeLine("Funcionários",scopes.funcionarios),""];
  if(pref.types?.includes("metas")){
   lines.push("*METAS E INDICADORES*");
   for(const [label,field,kind,goal] of [
    ["Produtividade","pProd","prod","≥ 75%"],
    ["Paradas","pStop","stop","≤ 10%"],
    ["Desperdício","pWaste","waste","≤ 2%"]
   ]){
    lines.push("*"+label+"*",""+bar(result[field])+" "+pct(result[field]),
     "Meta: "+goal+" | "+grade(kind,result[field]),"");
   }
  }
  if(pref.types?.includes("resumo")){
   lines.push("*RESUMO DE HORAS*",
    "Disponíveis: *"+fmt(result.available)+" h*",
    "Produtivas: *"+fmt(result.prod)+" h*",
    "Paradas: *"+fmt(result.stop)+" h*",
    "Desperdício: *"+fmt(result.waste)+" h*","");
  }
  // Quando múltiplas opções são escolhidas, mostrar cada item em vez de apenas a soma.
  for(const [scope,key,label] of [
   ["segmentos","segment","POR SEGMENTO"],
   ["maquinas","machine","POR MÁQUINA"],
   ["funcionarios","employee","POR FUNCIONÁRIO"]
  ]){
   const vals=scopes[scope]||[];
   if(vals.length<2)continue;
   lines.push("*"+label+"*");
   for(const name of vals.slice(0,8)){
    const sub={...scopes,[scope]:[name]},r=calculate(rows,available,sub,period);
    lines.push("• "+name+": "+pct(r.pProd)+" prod. | "+fmt(r.prod)+" h");
   }
   if(vals.length>8)lines.push("+"+(vals.length-8)+" outros selecionados");
   lines.push("");
  }
  lines.push("_Prévia com dados reais de um mês fechado. O envio diário/semanal exige dados por dia._",
   "_Envio automático ainda não ativado._");
  const text=lines.join("\n");
  if(text.length>3900)throw Error("Seleção extensa demais para mensagem única; reduza os filtros");
  return {text,result,period};
 }
 const lastClosedPeriod=()=>{const d=new Date();d.setDate(1);d.setMonth(d.getMonth()-1);
  return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")};
 return {build,lastClosedPeriod};
})();