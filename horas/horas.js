"use strict";
// Columbia / Fechamento de Horas
// Horas disponíveis: Aponta Fácil, exclusivamente via backend autenticado.
// Metas: leitura da planilha quando publicada para consulta; parâmetros locais verificados como fallback.
const BASE="https://columbia.consultoriarf.net";
const ME=BASE+"/producao/portal/me";
const APONTAMENTOS=BASE+"/custos_apontamento";
const DISPONIVEIS=BASE+"/horas_disponiveis";
const META_SHEET="https://docs.google.com/spreadsheets/d/1zUhza1A-dpdw2pnqXjKr_HAYHW0nEVi4QZFa_UMI_S8/gviz/tq?tqx=out:json&sheet=META_PRODUTIVIDADE";
const TOKEN_KEY="columbia_analista_token";
const now=new Date();
const state={rows:[],available:[],targets:[],loaded:false,loading:false,selected:"segmentos",sort:{},charts:{},issues:[],metaLive:false,availabilityLive:false,sourceData:null};
const $=id=>document.getElementById(id);
const FILTERS=["yearFilter","monthFilter","segmentFilter","machineFilter","employeeFilter","serviceFilter"];
const MONTHS=["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];
const DEFAULT_METAS=[{periodo:"2026",prod_ruim:.6,prod_regular:.75,prod_bom:.8,prod_otimo:1,desp_ruim:1,desp_regular:.3,desp_bom:.05,desp_otimo:.02,para_ruim:1,para_regular:.4,para_bom:.2,para_otimo:.1}];
const num=(v)=>{if(v==null||v==="")return 0;if(typeof v==="number")return Number.isFinite(v)?v:0;let x=String(v).trim().replace(/\s/g,"").replace(/%$/,"");if(x.includes(",")&&x.includes("."))x=x.replace(/\./g,"").replace(",",".");else if(x.includes(","))x=x.replace(",",".");let n=Number(x);return Number.isFinite(n)?n:0};
const fmt=v=>Number.isFinite(v)?v.toLocaleString("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2}):"—";
const percent=v=>Number.isFinite(v)?(v*100).toLocaleString("pt-BR",{maximumFractionDigits:1,minimumFractionDigits:1})+"%":"—";
const norm=s=>String(s??"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-zA-Z0-9]/g,"").toLowerCase();
const clean=s=>String(s??"").trim();
const key=s=>norm(s);
function entry(r){const m={};for(const [k,v]of Object.entries(r||{}))m[key(k)]=v;return m}
function pick(m,keys){for(const k of keys){let v=m[key(k)];if(v!==undefined&&v!==null&&v!=="")return v}return null}
function nPick(m,k){let v=pick(m,k);return v==null?null:num(v)}
function escapeHtml(v){return String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
function dateOf(v){
 if(v==null||v==="")return "";
 if(typeof v==="number"&&v>20000101&&v<21000101)return String(v).slice(0,4)+"-"+String(v).slice(4,6)+"-"+String(v).slice(6,8);
 const s=clean(v);let m;
 if((m=s.match(/^(\d{2})\/(\d{2})\/(\d{4})/)))return m[3]+"-"+m[2]+"-"+m[1];
 if((m=s.match(/^(\d{4})-(\d{2})-(\d{2})/)))return m[1]+"-"+m[2]+"-"+m[3];
 if((m=s.match(/^(\d{4})(\d{2})(\d{2})$/)))return m[1]+"-"+m[2]+"-"+m[3];
 return "";
}
function ymonth(r){return (r.date||"").slice(0,7)}
function code(v){return clean(v).replace(/^0+(?=\d)/,"").toUpperCase()}
function idOf(r){return code(r.employeeCode)||norm(r.employee)}
async function getJson(url,{signal}={}){
 const token=localStorage.getItem(TOKEN_KEY);
 if(!token)throw new Error("Sessão não encontrada. Entre novamente no portal.");
 let res=await fetch(url,{headers:{Authorization:"Bearer "+token,Accept:"application/json"},cache:"no-store",signal});
 if(res.status===401)throw new Error("Sessão expirada. Faça login novamente no portal.");
 if(res.status===403)throw new Error("Usuário sem permissão para consultar estes dados.");
 if(!res.ok)throw new Error("Falha na API ("+res.status+"): "+url.split("/").pop());
 return await res.json();
}
function extractArray(data,labels=[]){
 if(Array.isArray(data))return data;
 for(const label of [...labels,"data","dados","registros","rows","results","items","apontamentos","produtos"]){
  const value=data?.[label];if(Array.isArray(value))return value;
  if(value&&typeof value==="object"){for(const nested of ["data","dados","registros","items","rows"])if(Array.isArray(value[nested]))return value[nested]}
 }
 return [];
}
function isStop(m){
 let classification=norm(pick(m,["tipo_apontamento","classificacao","tipo_servico","tipo_hora","natureza","tipo","descricao_tp_maquina","tp_maquina","status","situacao"]));
 return /(parad|setup|aguard|ocios|improdut|manutenc|interrup)/.test(classification);
}
function normalizeApontamento(r){
 const m=entry(r);
 const date=dateOf(pick(m,["data","data_apontamento","dt_apontamento","dt_inicio","data_inicio","dataaponta","dt_inicio_producao","data_aponta","dt_producao","data_lancamento","dt_data","dia","dataref","dt_ref","datahora","data_hora"]));
 const employee=clean(pick(m,["funcionario","nome_funcionario","colaborador","operador","nome","nm_funcionario","funcionario_nome","nome_colaborador","responsavel","recurso_humano"]));
 const employeeCode=code(pick(m,["cod_funcionario","codigo_funcionario","cod_funcion","cod_operador","codigo_operador","matricula","codigo","cod_colaborador"]));
 const segment=clean(pick(m,["segmento","nome_segmento","grupo_maquina","setor","departamento","centro_custo","centrocusto"]))||"Sem segmento";
 const machine=clean(pick(m,["maquina","nome_maquina","recurso","equipamento","descricao_maquina","tp_maquina","maquina_nome"]))||"Não informado";
 const service=clean(pick(m,["servico","descricao_servico","tipo_servico","servico_nome","descricao","processo"]))||"Não informado";
 const explicitProd=nPick(m,["horas_produtivas","produtivas","hr_produtiva","horas_producao","horas_prod","tempo_produtivo","horas_produtiva"]);
 const explicitStop=nPick(m,["horas_paradas","paradas","horas_parada","hr_paradas","tempo_parada","horas_improdutivas","tempo_improdutivo"]);
 let total=nPick(m,["horas_apontadas","horas","horas_trabalhadas","qtd_horas","qtde_horas","quantidade_horas","total_horas","horas_realizadas","tempo_total","tempo","qtde","quantidade"]);
 let prod=explicitProd??0, stop=explicitStop??0;
 if(explicitProd===null && explicitStop===null && total!==null){if(isStop(m))stop=total;else prod=total}
 else if(total!==null && explicitProd===null && explicitStop!==null)prod=Math.max(0,total-stop);
 else if(total!==null && explicitStop===null && explicitProd!==null)stop=Math.max(0,total-prod);
 return {date,employee,employeeCode,segment,machine,service,prod,stop,
  sourceType:clean(pick(m,["tipo_apontamento","tp_maquina","classificacao","tipo_hora"]))||"—",
  os:clean(pick(m,["os","cod_os","numero_os","ordem_servico"]))||"—",
  recognized:explicitProd!==null||explicitStop!==null||total!==null,
  raw:r
 };
}
function normalizeAvailable(r){
 const m=entry(r);
 const month=clean(pick(m,["mes_ano","mesano","mesref","periodo","competencia","ano_mes","anomes","mes"])) ;
 let y=clean(pick(m,["ano","ano_referencia"])),mo=clean(pick(m,["mes_numero","mes_referencia"]));
 if(/^\d{6}$/.test(month)){y=month.slice(0,4);mo=month.slice(4)}
 else if(/^\d{4}-\d{2}$/.test(month)){y=month.slice(0,4);mo=month.slice(5)}
 else if(/^\d{4}$/.test(month)&&!y)y=month;
 const date=dateOf(pick(m,["data","data_referencia","dt_referencia"]));
 if(date){y=y||date.slice(0,4);mo=mo||date.slice(5,7)}
 let normal=nPick(m,["horas_normais","normais","horas_normais_trabalhadas"]);
 let extra=nPick(m,["horas_extras","horas_extra","total_horas_extras","hr_extra","extra"]);
 let available=nPick(m,["horas_disponiveis","disponiveis","available","total_disponivel"]);
 if(available===null&&normal!==null)available=normal+(extra||0);
 return {period:y&&mo?y+"-"+String(Number(mo)).padStart(2,"0"):"",
  employee:clean(pick(m,["nome","funcionario","colaborador","nome_funcionario"])),
  employeeCode:code(pick(m,["codigo","cod_funcionario","matricula","cod_colaborador","id_funcionario"])),available:Math.max(0,available??0)};
}
function normalizeMetas(rows){
 return rows.map(r=>{let m=entry(r);
 return {periodo:clean(pick(m,["periodo","ano"])),prod_ruim:num(pick(m,["prod_ruim"])),prod_regular:num(pick(m,["prod_regular"])),prod_bom:num(pick(m,["prod_bom"])),prod_otimo:num(pick(m,["prod_otimo"])),desp_ruim:num(pick(m,["desp_ruim"])),desp_regular:num(pick(m,["des_regular","desp_regular"])),desp_bom:num(pick(m,["desp_bom"])),desp_otimo:num(pick(m,["desp_otimo"])),para_ruim:num(pick(m,["para_ruim"])),para_regular:num(pick(m,["para_regular"])),para_bom:num(pick(m,["para_bom"])),para_otimo:num(pick(m,["para_otimo"]))}
 }).filter(x=>/^\d{4}$/.test(x.periodo))}
async function getMetas(){
 // Esta aba pode ser consultada pelo Google Visualization quando compartilhada para leitura.
 // Em planilhas privadas o navegador não recebe dados; usa último conjunto de metas conhecido (2026).
 try{
  const res=await fetch(META_SHEET,{cache:"no-store"});
  if(!res.ok)throw Error("Google Sheets não acessível");
  const src=await res.text();
  const match=src.match(/google\.visualization\.Query\.setResponse\(([\s\S]*?)\);?\s*$/);
  if(!match)throw Error("Resposta inválida do Google Sheets");
  const parsed=JSON.parse(match[1]);
  const cols=parsed.table.cols.map(c=>c.label||c.id||"");
  const rows=(parsed.table.rows||[]).map(r=>Object.fromEntries(cols.map((c,i)=>[c,r.c?.[i]?.v??null])));
  const metas=normalizeMetas(rows);
  if(!metas.length)throw Error("Metas vazias");
  state.metaLive=true;return metas;
 }catch(_){state.metaLive=false;return DEFAULT_METAS}
}
function parseAvailableResponse(data){
 const rows=extractArray(data,["funcionarios","horas_disponiveis"]);
 if(rows.length)return rows.map(normalizeAvailable).filter(r=>r.period);
 return [];
}
function yearsInData(){
 return [...new Set([...state.rows.map(r=>r.date.slice(0,4)),...state.available.map(r=>r.period.slice(0,4))].filter(x=>/^\d{4}$/.test(x)))].sort((a,b)=>b.localeCompare(a))
}
function selected(){return Object.fromEntries(FILTERS.map(id=>[id,$(id).value]))}
function selectedMonths(){const f=selected();const months=new Set(state.rows.map(ymonth).concat(state.available.map(r=>r.period)).filter(Boolean));return [...months].filter(v=>(!f.yearFilter||v.slice(0,4)===f.yearFilter)&&(!f.monthFilter||v.slice(5,7)===f.monthFilter)).sort()}
function rowsFiltered(){
 const f=selected();return state.rows.filter(r=>(!f.yearFilter||r.date.slice(0,4)===f.yearFilter)&&(!f.monthFilter||r.date.slice(5,7)===f.monthFilter)&&(!f.segmentFilter||r.segment===f.segmentFilter)&&(!f.machineFilter||r.machine===f.machineFilter)&&(!f.employeeFilter||idOf(r)===f.employeeFilter)&&(!f.serviceFilter||r.service===f.serviceFilter))
}
function opt(id,items,label,display){
 let select=$(id);let value=select.value;
 select.replaceChildren();let first=new Option(label,"");select.add(first);
 for(const item of items){const v=typeof item==="string"?item:item.value;const text=typeof item==="string"?item:item.label;select.add(new Option(text,v))}
 if([...select.options].some(o=>o.value===value))select.value=value;
}
function buildFilters(){
 const year=$("yearFilter").value,month=$("monthFilter").value;
 opt("yearFilter",yearsInData(),"Todos");
 if(!year && yearsInData().includes(String(now.getFullYear())))$("yearFilter").value=String(now.getFullYear());
 opt("monthFilter",MONTHS.map((m,i)=>({value:String(i+1).padStart(2,"0"),label:m})),"Todos");
 if(!month){const inYear=state.rows.map(ymonth).concat(state.available.map(r=>r.period)).filter(m=>m.startsWith($("yearFilter").value+"-")).sort();if(inYear.length)$("monthFilter").value=inYear.at(-1).slice(5,7)}
 const f=selected();
 const visible=state.rows.filter(r=>(!f.yearFilter||r.date.slice(0,4)===f.yearFilter)&&(!f.monthFilter||r.date.slice(5,7)===f.monthFilter));
 opt("segmentFilter",[...new Set(visible.map(r=>r.segment))].sort(),"Todos");
 opt("machineFilter",[...new Set(visible.map(r=>r.machine))].sort(),"Todas");
 let people=new Map();for(const r of visible)people.set(idOf(r),r.employee||"Cód. "+r.employeeCode);
 opt("employeeFilter",[...people].map(([value,label])=>({value,label})).sort((a,b)=>a.label.localeCompare(b.label,"pt-BR")),"Todos");
 opt("serviceFilter",[...new Set(visible.map(r=>r.service))].sort(),"Todos");
}
const sum=(rows,field)=>rows.reduce((s,r)=>s+(Number(r[field])||0),0);
function calculate(rows,availability){
 const prod=sum(rows,"prod"),stop=sum(rows,"stop");
 const available=sum(availability,"available");
 const waste=available-prod-stop;
 return {available,prod,stop,waste,pProd:available?prod/available:NaN,pStop:available?stop/available:NaN,pWaste:available?waste/available:NaN,pDisp:available? (prod+stop)/available:NaN};
}
// Rateia a capacidade de cada funcionário proporcionalmente às horas apontadas
// em cada segmento/máquina. Evita multiplicar o mesmo total mensal em cada grupo.
function rateGroups(rows,dimension,available){
 let map=new Map(),usage=new Map();
 for(const r of rows){
  const group=r[dimension]||"Não informado",person=idOf(r),pk=r.date.slice(0,7)+"|"+person;
  let a=map.get(group);if(!a){a={name:group,available:0,prod:0,stop:0};map.set(group,a)}
  a.prod+=r.prod;a.stop+=r.stop;
  usage.set(pk,(usage.get(pk)||0)+r.prod+r.stop);
 }
 const availMap=new Map();for(const a of available)availMap.set(a.period+"|"+idOf(a),(availMap.get(a.period+"|"+idOf(a))||0)+a.available);
 for(const r of rows){
  let a=map.get(r[dimension]||"Não informado"),pk=r.date.slice(0,7)+"|"+idOf(r),weight=r.prod+r.stop,den=usage.get(pk)||0;
  if(den>0)a.available+=(availMap.get(pk)||0)*weight/den;
 }
 return [...map.values()].map(a=>({...a,...calculate([a],[a])})); // reuses available/prod/stop
}
function rateEmployee(rows,available){
 const groups=new Map();for(const r of rows){const k=idOf(r);let a=groups.get(k);if(!a){a={name:r.employee||r.employeeCode||"Sem identificação",employeeCode:r.employeeCode,prod:0,stop:0,available:0};groups.set(k,a)}a.prod+=r.prod;a.stop+=r.stop}
 let selectedByEmployee=new Set(rows.map(r=>r.date.slice(0,7)+"|"+idOf(r)));
 for(const a of available){if(!selectedByEmployee.has(a.period+"|"+idOf(a)))continue;const k=idOf(a),g=groups.get(k);if(g)g.available+=a.available}
 return [...groups.values()].map(g=>({...g,...calculate([g],[g])}));
}
function availabilityFor(rows){
 const f=selected(),months=new Set(selectedMonths());
 const employees=new Set(rows.map(idOf).filter(Boolean));
 // With subgroup filters (segment/machine/service), rate available by worked time in that group.
 const restricting=!!(f.segmentFilter||f.machineFilter||f.serviceFilter);
 if(!restricting) return state.available.filter(r=>months.has(r.period)&&(!f.employeeFilter||idOf(r)===f.employeeFilter)&&(!employees.size||employees.has(idOf(r))));
 const full=state.rows.filter(r=>months.has(ymonth(r))&&(!f.employeeFilter||idOf(r)===f.employeeFilter));
 const totals=new Map(),subset=new Map();
 for(const r of full){const k=ymonth(r)+"|"+idOf(r);totals.set(k,(totals.get(k)||0)+r.prod+r.stop)}
 for(const r of rows){const k=ymonth(r)+"|"+idOf(r);subset.set(k,(subset.get(k)||0)+r.prod+r.stop)}
 return state.available.filter(a=>months.has(a.period)).map(a=>({...a,available:a.available*(subset.get(a.period+"|"+idOf(a))||0)/(totals.get(a.period+"|"+idOf(a))||Infinity)})).filter(a=>a.available>0);
}
function columnDefs(){
 return [{k:"name",t:"Nome / Descrição"},{k:"available",t:"Disponíveis",num:true},{k:"pDisp",t:"% disponível",pct:true},{k:"prod",t:"Produtivas",num:true},{k:"pProd",t:"% produtiva",pct:true},{k:"stop",t:"Paradas",num:true},{k:"pStop",t:"% parada",pct:true},{k:"waste",t:"Desperdício",num:true},{k:"pWaste",t:"% desperdício",pct:true}]
}
function sortData(id,rows,defs){
 const s=state.sort[id]||{col:"prod",dir:-1};const d=defs.find(d=>d.k===s.col)||defs[0];
 rows.sort((a,b)=>{let av=a[d.k],bv=b[d.k];return (d.num||d.pct)?(Number.isFinite(av)?av:-Infinity)-(Number.isFinite(bv)?bv:-Infinity) < 0? -s.dir : (Number.isFinite(av)?av:-Infinity)-(Number.isFinite(bv)?bv:-Infinity)>0?s.dir:0 :String(av??"").localeCompare(String(bv??""),"pt-BR")*s.dir});
 return rows;
}
function renderTable(id,rows,defs,{total=true,limit=1000}={}){
 const table=$("table-"+id);let sorted=sortData(id,rows.slice(),defs);let body=sorted.slice(0,limit);
 const header="<thead><tr>"+defs.map(d=>'<th class="'+(d.num||d.pct?"num ":"")+'sortable" data-column="'+escapeHtml(d.k)+'">'+escapeHtml(d.t)+' '+(state.sort[id]?.col===d.k?(state.sort[id].dir>0?"↑":"↓"):"↕")+"</th>").join("")+"</tr></thead>";
 const formatCell=(r,d)=>{let v=r[d.k];let label=d.pct?percent(v):d.num?fmt(v):String(v??"—");
 return '<td class="'+(d.num||d.pct?"num ":"")+(d.k==="name"?"name":"")+'">'+(d.pct?'<span class="pct '+(!Number.isFinite(v)?"":(v>=.8?"high":v>=.5?"mid":"low"))+'">':"")+escapeHtml(label)+(d.pct?"</span>":"")+"</td>"};
 const trs=body.map(r=>"<tr>"+defs.map(d=>formatCell(r,d)).join("")+"</tr>").join("");
 let totals="";
 if(total&&rows.length&&defs.some(d=>d.k==="available")){
  const t={name:"TOTAL",...calculate([{prod:sum(rows,"prod"),stop:sum(rows,"stop")}],[{available:sum(rows,"available")}])};
  totals='<tr class="total">'+defs.map(d=>formatCell(t,d)).join("")+"</tr>";
 }
 table.innerHTML=header+"<tbody>"+(trs||'<tr><td colspan="'+defs.length+'">Sem registros para os filtros selecionados.</td></tr>')+totals+"</tbody>";
 table.querySelectorAll("th[data-column]").forEach(th=>th.addEventListener("click",()=>{const k=th.dataset.column;const previous=state.sort[id];state.sort[id]={col:k,dir:previous?.col===k?-previous.dir:(defs.find(d=>d.k===k)?.num?-1:1)};renderAll()}));
}
function chart(id,config){
 if(!window.Chart)return;
 state.charts[id]?.destroy();
 state.charts[id]=new Chart($(id).getContext("2d"),config);
}
function charts(rows,available,groups){
 const groupMonth=new Map();
 for(const m of selectedMonths())groupMonth.set(m,{month:m,prod:0,stop:0,available:0});
 for(const a of available){let g=groupMonth.get(a.period);if(g)g.available+=a.available}
 for(const r of rows){let g=groupMonth.get(ymonth(r));if(g){g.prod+=r.prod;g.stop+=r.stop}}
 const data=[...groupMonth.values()];
 const colors={prod:"#059669",stop:"#f59e0b",waste:"#ef4444"};
 chart("monthlyChart",{type:"bar",data:{labels:data.map(d=>d.month.split("-").reverse().join("/")),datasets:[{label:"Produtivas",data:data.map(d=>d.available?d.prod/d.available*100:0),backgroundColor:colors.prod},{label:"Paradas",data:data.map(d=>d.available?d.stop/d.available*100:0),backgroundColor:colors.stop},{label:"Desperdício",data:data.map(d=>d.available?Math.max(0,d.available-d.prod-d.stop)/d.available*100:0),backgroundColor:colors.waste}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:"bottom"}},scales:{x:{stacked:true},y:{stacked:true,title:{display:true,text:"% da capacidade"},suggestedMax:100}}}});
 const result=calculate(rows,available);chart("mixChart",{type:"doughnut",data:{labels:["Produtivas","Paradas","Desperdício"],datasets:[{data:[result.prod,result.stop,Math.max(0,result.waste)],backgroundColor:[colors.prod,colors.stop,colors.waste],borderWidth:0}]},options:{responsive:true,maintainAspectRatio:false,cutout:"66%",plugins:{legend:{position:"bottom"}}}});
 const tops=groups.slice().sort((a,b)=>b.stop-a.stop).slice(0,12);
 chart("machineChart",{type:"bar",data:{labels:tops.map(t=>t.name.length>32?t.name.slice(0,32)+"…":t.name),datasets:[{label:"Horas de parada",data:tops.map(x=>x.stop),backgroundColor:colors.stop}]},options:{indexAxis:"y",responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}}}});
}
function grade(value,kind,target){
 if(!Number.isFinite(value))return "Sem base";
 let configs=kind==="prod"?[["Ótimo",target.prod_otimo],["Bom",target.prod_bom],["Regular",target.prod_regular]]:kind==="stop"?[["Ótimo",target.para_otimo],["Bom",target.para_bom],["Regular",target.para_regular]]:[["Ótimo",target.desp_otimo],["Bom",target.desp_bom],["Regular",target.desp_regular]];
 if(kind==="prod"){for(const [label,x]of configs)if(value>=x-1e-9)return label}
 else{for(const [label,x]of configs)if(value<=x+1e-9)return label}
 return "Ruim";
}
function showMetas(result){
 const ano=$("yearFilter").value||String(now.getFullYear());
 const target=state.targets.find(m=>m.periodo===ano)||state.targets.at(-1);
 if(!target)return;
 [["Prod",result.pProd,"prod"],["Stop",result.pStop,"stop"],["Waste",result.pWaste,"waste"]].forEach(([key,v,kind])=>{
   $( "target"+key).textContent=percent(v);
   const g=grade(v,kind,target),status=$("status"+key);status.textContent=g;status.className="grade "+norm(g);
   $("bar"+key).style.width=(Number.isFinite(v)?Math.max(0,Math.min(v*100,100)):0)+"%";
 });
 const detail=[
 ["Produtividade","Mínimo para cada faixa",target.prod_ruim,target.prod_regular,target.prod_bom,target.prod_otimo],
 ["Paradas","Máximo para cada faixa",target.para_ruim,target.para_regular,target.para_bom,target.para_otimo],
 ["Desperdício","Máximo para cada faixa",target.desp_ruim,target.desp_regular,target.desp_bom,target.desp_otimo]
 ].map(r=>({name:r[0],regra:r[1],ruim:r[2],regular:r[3],bom:r[4],otimo:r[5]}));
 renderTable("metas",detail,[{k:"name",t:"Indicador"},{k:"regra",t:"Critério"},{k:"ruim",t:"Ruim",pct:true},{k:"regular",t:"Regular",pct:true},{k:"bom",t:"Bom",pct:true},{k:"otimo",t:"Ótimo",pct:true}],{total:false})
}
function renderDetails(rows){
 const input=norm($("detailSearch").value);
 const filtered=input?rows.filter(r=>[r.employee,r.employeeCode,r.machine,r.segment,r.service,r.os,r.sourceType,r.date].some(v=>norm(v).includes(input))):rows;
 const ds=filtered.map(r=>({date:r.date,name:r.employee||r.employeeCode,segment:r.segment,machine:r.machine,service:r.service,os:r.os,sourceType:r.sourceType,prod:r.prod,stop:r.stop}));
 renderTable("detalhamento",ds,[{k:"date",t:"Data"},{k:"name",t:"Funcionário"},{k:"segment",t:"Segmento"},{k:"machine",t:"Máquina"},{k:"service",t:"Serviço"},{k:"os",t:"OS"},{k:"sourceType",t:"Tipo"},{k:"prod",t:"Produtivas",num:true},{k:"stop",t:"Paradas",num:true}],{total:false,limit:1500});
 $("detailCount").textContent=filtered.length>1500? "Exibindo 1.500 de "+filtered.length+" registros. A exportação inclui todos.":filtered.length+" registros no detalhamento.";
 return ds;
}
function renderAll(){
 const rows=rowsFiltered(),available=availabilityFor(rows),r=calculate(rows,available);
 $("kpiAvailable").textContent=state.availabilityLive?fmt(r.available):"—";
 $("kpiProd").textContent=fmt(r.prod);
 $("kpiStop").textContent=fmt(r.stop);
 $("kpiWaste").textContent=state.availabilityLive?fmt(r.waste):"—";
 $("hintProd").textContent=state.availabilityLive?percent(r.pProd)+" das horas disponíveis":"Apontamentos GRV";
 $("hintStop").textContent=state.availabilityLive?percent(r.pStop)+" das horas disponíveis":"Apontamentos GRV";
 $("hintWaste").textContent=state.availabilityLive?percent(r.pWaste)+" das horas disponíveis":"Aguardando Aponta Fácil";
 $("hintAvailable").textContent=state.availabilityLive?"Aponta Fácil · proporcional aos filtros":"Integração Aponta Fácil pendente";
 $("periodLabel").textContent=$("monthFilter").value?MONTHS[Number($("monthFilter").value)-1]+"/"+($("yearFilter").value||"todos"):"Período selecionado";
 $("rowCounter").textContent=rows.length.toLocaleString("pt-BR")+" apontamentos";
 const groups=rateGroups(rows,"segment",available),machines=rateGroups(rows,"machine",available),employees=rateEmployee(rows,available);
 const cols=columnDefs();
 renderTable("segmentos",groups,cols);
 renderTable("maquinas",machines,cols);
 renderTable("funcionarios",employees,cols);
 showMetas({...r,pProd:state.availabilityLive?r.pProd:NaN,pStop:state.availabilityLive?r.pStop:NaN,pWaste:state.availabilityLive?r.pWaste:NaN});
 const details=renderDetails(rows);
 state.exports={segmentos:groups,maquinas:machines,funcionarios:employees,metas:state.targets,detalhamento:details};
 charts(rows,available,machines);
 const missing=rows.filter(x=>!x.recognized);
 $("qualityNote").textContent=(missing.length?"Atenção: "+missing.length+" apontamentos sem campo de horas reconhecido. ":"")+"Comparativos dependem da correspondência de código de funcionário entre Aponta Fácil e GRV. Horas disponíveis são rateadas proporcionalmente às horas apontadas.";
 $("sourceStatus").className="status "+(state.availabilityLive?"ok":"warn");
 $("sourceStatus").textContent="GRV "+(rows.length?"conectado":"sem registros")+" · Aponta Fácil "+(state.availabilityLive?"conectado":"pendente")+" · Metas "+(state.metaLive?"online":"referência 2026");
}
function warning(text,kind="warn"){
 const div=document.createElement("div");div.className="alert "+(kind==="error"?"error":"");
 div.textContent=text;$("alertArea").appendChild(div);
}
function persist(){try{localStorage.setItem("columbia_horas_filters",JSON.stringify(selected()))}catch(_){}}
function restore(){
 try{const v=JSON.parse(localStorage.getItem("columbia_horas_filters")||"{}");for(const id of FILTERS)if(v[id])$(id).dataset.restore=v[id]}catch(_){}
}
function restorePending(){
 for(const id of FILTERS){const e=$(id);if(e.dataset.restore&&[...e.options].some(o=>o.value===e.dataset.restore))e.value=e.dataset.restore;delete e.dataset.restore}
}
async function load(){
 if(state.loading)return;state.loading=true;$("refreshBtn").disabled=true;$("alertArea").replaceChildren();
 $("sourceStatus").textContent="Atualizando fontes...";
 try{
  const [data,metas]=await Promise.all([getJson(APONTAMENTOS),getMetas()]);
  const orig=extractArray(data,["apontamentos","dados_apontamentos","custos_apontamento"]);
  state.rows=orig.map(normalizeApontamento);
  state.targets=metas;
  if(!orig.length)warning("A API custos_apontamento não retornou registros. Confira se esse endpoint exige parâmetros ou retorna outra estrutura.");
  if(orig.length&&!state.rows.some(r=>r.recognized))warning("A API retornou registros, mas os campos de horas não foram reconhecidos. É necessário conferir o JSON real antes de usar os indicadores.", "error");
  if(orig.length&&!state.rows.some(r=>r.date))warning("A API não retornou data em formato reconhecido; os filtros mensais não funcionarão corretamente.","error");
  if(!state.metaLive)warning("Metas: planilha não está acessível diretamente pelo navegador. Usando a referência de 2026 lida da planilha. Alterações futuras precisam de publicação/integração da planilha.");
  // Carregamento de horas disponíveis por meses ativos. Executado sempre no servidor Columbia.
  state.available=[];state.availabilityLive=false;
  const months=[...new Set(state.rows.map(ymonth).filter(Boolean))].sort().reverse();
  if(!months.length)months.push(now.getFullYear()+"-"+String(now.getMonth()+1).padStart(2,"0"));
  const validMonths=months.slice(0,24);
  let failed=false;
  // Se o backend ainda não possui a rota nova, evita diversas chamadas desnecessárias.
  for(const m of validMonths){
   const [ano,mes]=m.split("-");
   try{
    const payload=await getJson(DISPONIVEIS+"?ano="+ano+"&mes="+Number(mes));
    state.available.push(...parseAvailableResponse(payload));
    state.availabilityLive=true;
   }catch(e){failed=true;state.availabilityLive=false;state.available=[];warning("Aponta Fácil: "+e.message+". As horas disponíveis e os percentuais ficam ocultos até configurar a integração no backend.");break}
  }
  if(!failed&&state.available.length===0){state.availabilityLive=false;warning("Aponta Fácil não retornou horas disponíveis para os períodos consultados.");}
  state.loaded=true;
  buildFilters();restorePending();renderAll();
  $("updatedAt").textContent="Atualizado "+new Date().toLocaleString("pt-BR");
 }catch(e){warning(e.message,"error");$("sourceStatus").textContent="Falha na atualização";}
 finally{state.loading=false;$("refreshBtn").disabled=false}
}
async function boot(){
 const token=localStorage.getItem(TOKEN_KEY);
 if(!token)return location.replace("../login.html");
 try{
  const me=await getJson(ME);
  if(!(me.u_horas===true||Number(me.u_horas??me.U_HORAS??me.permissoes?.u_horas)===1)){
   $("accessGate").innerHTML='<strong>Acesso não autorizado</strong><p>Seu cadastro não possui CSENHA.U_HORAS = 1.</p><a href="../">Voltar ao portal</a>';
   return;
  }
  $("userName").textContent=me.usuario||localStorage.getItem("columbia_analista_usuario")||"Usuário";
  $("accessGate").hidden=true;$("app").hidden=false;
  restore();init();await load();
 }catch(e){$("accessGate").innerHTML='<strong>Não foi possível validar o acesso</strong><p>'+escapeHtml(e.message)+'</p><a href="../login.html">Entrar novamente</a>'}
}
function init(){
 FILTERS.forEach(id=>$(id).addEventListener("change",()=>{buildFiltersDependents(id);persist();renderAll()}));
 $("refreshBtn").addEventListener("click",load);
 $("clearFilters").addEventListener("click",()=>{FILTERS.forEach(id=>$(id).value="");localStorage.removeItem("columbia_horas_filters");buildFiltersDependents("yearFilter");renderAll()});
 $("detailSearch").addEventListener("input",renderAll);
 document.querySelectorAll(".tab").forEach(btn=>btn.addEventListener("click",()=>{
  state.selected=btn.dataset.view;document.querySelectorAll(".tab").forEach(t=>{t.classList.toggle("active",t===btn);t.setAttribute("aria-selected",t===btn?"true":"false")});
  document.querySelectorAll(".view").forEach(v=>v.hidden=v.id!=="view-"+state.selected);
  // Canvas requer container visível para calcular dimensão.
  renderAll();
 }));
 document.querySelectorAll("[data-export]").forEach(btn=>btn.addEventListener("click",()=>{
  if(!window.XLSX)return warning("Biblioteca de exportação Excel indisponível.");
  const source=state.exports?.[btn.dataset.export]||[];let book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,XLSX.utils.json_to_sheet(source),btn.dataset.export.slice(0,31));
  XLSX.writeFile(book,"Columbia_Horas_"+btn.dataset.export+"_"+new Date().toISOString().slice(0,10)+".xlsx");
 }));
}
function buildFiltersDependents(id){
 const f=selected();const visible=state.rows.filter(r=>(!f.yearFilter||r.date.slice(0,4)===f.yearFilter)&&(!f.monthFilter||r.date.slice(5,7)===f.monthFilter));
 if(id==="yearFilter"||id==="monthFilter"){
  opt("segmentFilter",[...new Set(visible.map(r=>r.segment))].sort(),"Todos");
  opt("machineFilter",[...new Set(visible.map(r=>r.machine))].sort(),"Todas");
  const people=new Map();for(const r of visible)people.set(idOf(r),r.employee||"Cód. "+r.employeeCode);
  opt("employeeFilter",[...people].map(([value,label])=>({value,label})).sort((a,b)=>a.label.localeCompare(b.label,"pt-BR")),"Todos");
  opt("serviceFilter",[...new Set(visible.map(r=>r.service))].sort(),"Todos");
 }
}
document.addEventListener("DOMContentLoaded",boot);