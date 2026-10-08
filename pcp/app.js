(() => {
  "use strict";

  const API = "https://columbia.consultoriarf.net/producao";
  const TOKEN_KEY = "columbia_analista_token";
  const PERM_KEY = "columbia_permissoes";
  const FILTER_KEY = "columbia_pcp_filters_v1";
  const SEGMENT_EMPTY = "Sem segmento";
  const moneyFormatter = new Intl.NumberFormat("pt-BR", {style:"currency",currency:"BRL"});
  const countFormatter = new Intl.NumberFormat("pt-BR");
  const labels = {os:"Nº OS",orc:"Orçamento",item:"Item",cliente:"Cliente",segmento:"Segmento",entrega:"Entrega vigente",original:"Original (referência)",valor:"Valor",pend:"Processos pendentes"};
  const cols = Object.keys(labels);
  const $ = id => document.getElementById(id);
  const str = v => v == null ? "" : String(v).trim();
  const blank = v => !str(v) || ["null","none","nat","nan","undefined","-"].includes(str(v).toLowerCase());
  const esc = v => String(v == null ? "" : v).replace(/[&<>"']/g, x => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[x]));
  const localToday = () => { const d = new Date(); return [d.getFullYear(),String(d.getMonth()+1).padStart(2,"0"),String(d.getDate()).padStart(2,"0")].join("-"); };
  const money = v => v == null ? "—" : moneyFormatter.format(v);
  const store = {rows:[],filtered:[],selected:new Set(),authorized:false,ready:false,editOS:null,pageSize:100,shown:100,sortKey:"entrega",sortAsc:true,shareIds:null,filters:{},popupKey:null,popupChoices:null,attachmentOS:null,attachmentBlobUrl:null,weekLinks:[],view:"planilha",month:new Date(new Date().getFullYear(),new Date().getMonth(),1),movingOS:new Set()};
  const numberFields = new Set(["valor"]);
  const dateFields = new Set(["original","entrega"]);

  function normalizeDate(v) {
    if (blank(v)) return "";
    const s = str(v);
    let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
    if (!m) { m = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(s); if (m) return isCalendarDate(m[3]+"-"+m[2]+"-"+m[1]) ? m[3]+"-"+m[2]+"-"+m[1] : ""; return ""; }
    const d = m[1]+"-"+m[2]+"-"+m[3];
    return isCalendarDate(d) ? d : "";
  }
  function isCalendarDate(iso) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
    const dt = new Date(iso+"T12:00:00");
    return !isNaN(dt) && dt.getFullYear()===Number(iso.slice(0,4)) && dt.getMonth()+1===Number(iso.slice(5,7)) && dt.getDate()===Number(iso.slice(8,10));
  }
  function dateBR(s) { return s ? s.slice(8,10)+"/"+s.slice(5,7)+"/"+s.slice(0,4) : "—"; }
  function parseMoney(v) {
    if (blank(v)) return null;
    if (typeof v==="number") return Number.isFinite(v) ? v : null;
    let s=str(v).replace(/R\$/gi,"").replace(/\s/g,"");
    if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s=s.replace(/\./g,"").replace(",",".");
    else if (s.includes(",")) s=s.replace(/\./g,"").replace(",",".");
    const n=Number(s);
    return Number.isFinite(n) ? n : null;
  }
  function first(obj, keys) {
    for (const k of keys) if (!blank(obj[k])) return obj[k];
    return null;
  }
  function proc(v) {
    if (Array.isArray(v)) return v.map(proc).filter(Boolean).join(" | ");
    if (v && typeof v==="object") return Object.values(v).map(proc).filter(Boolean).join(" | ");
    return blank(v) ? "" : str(v);
  }
  function hasPend(r) { return !!r.pend && !/^(nenhum|nenhuma|sem processos?|n[aã]o h[aá]|0)$/i.test(r.pend); }
  function normalizeAttachments(item) {
    const arr=Array.isArray(item.anexos)?item.anexos:(Array.isArray(item.anexo)?item.anexo:[]);
    return arr.map(x=>{
      if (!x || typeof x!=="object") return null;
      const o=Object.fromEntries(Object.entries(x).map(([k,v])=>[k.toLowerCase(),v]));
      const empresa=str(first(o,["cod_empresa"]))||str(item.cod_empresa);
      const os=str(first(o,["cod_os"]))||str(item.cod_os);
      const aux=str(first(o,["cod_os_aux","cod_aux"]));
      if (!/^[0-9]+$/.test(empresa)|| !/^[0-9]+$/.test(os)|| !/^[0-9]+$/.test(aux))return null;
      return {empresa,os,aux,nome:str(first(o,["nome_arquivo","titulo","descricao","codigo"]))};
    }).filter(Boolean);
  }
  function mergeAttachments(into,from) {
    const map=new Map(into.map(a=>[a.empresa+"-"+a.os+"-"+a.aux,a]));
    for(const a of from)map.set(a.empresa+"-"+a.os+"-"+a.aux,a);
    return [...map.values()];
  }
  function normalizeRows(raw) {
    if (!Array.isArray(raw)) throw new Error("Não foi possível obter a relação de ordens de serviço.");
    const seen=new Map();
    for (const item of raw) {
      if (!item || typeof item!=="object") continue;
      const lower={};
      for (const [k,v] of Object.entries(item)) lower[k.toLowerCase()]=v;
      const os=str(first(lower,["n_os","numero_os"]));
      if (!os) continue;
      const row={
        os,
        empresa:str(first(lower,["cod_empresa"])),
        codOS:str(first(lower,["cod_os"])),
        orc:str(first(lower,["n_orcamento","orcamento","numero_orcamento"])),
        item:str(first(lower,["titulo","descricao","cod_interno","tiposervico"])),
        cliente:str(first(lower,["cliente","nome_cliente"])),
        segmento:str(first(lower,["segmento","segmento_cliente","u_segmento","classificacao_segmento"])),
        original:normalizeDate(first(lower,["prev_entrega_os","dt_previsao_entrega","dt_prevista"])),
        reneg:normalizeDate(first(lower,["dt_renegociada","u_data_renegociacao"])),
        manual:normalizeDate(first(lower,["u_dt_rep_manual"])),
        manualFlag:Number(first(lower,["u_reprogramado_manual"]))===1,
        valor:parseMoney(first(lower,["preco_geral_a_vista","valor","vl_a_faturar"])),
        pend:proc(first(lower,["pp_pendentes","processos_pendentes"])),
        anexos:normalizeAttachments(lower)
      };
      row.entrega=deliveryDate(row);row.fonte=deliverySource(row);
      if (!seen.has(os)) {seen.set(os,row);continue;}
      const old=seen.get(os);
      for (const f of ["empresa","codOS","orc","item","cliente","segmento","original","reneg","manual"]) if (!old[f] && row[f]) old[f]=row[f];
      if(!old.manualFlag && row.manualFlag)old.manualFlag=true;
      old.entrega=deliveryDate(old);old.fonte=deliverySource(old);
      if (old.valor==null && row.valor!=null) old.valor=row.valor;
      old.anexos=mergeAttachments(old.anexos,row.anexos);
      if (hasPend(row) && !old.pend.includes(row.pend)) old.pend=hasPend(old) ? old.pend+" | "+row.pend : row.pend;
    }
    return [...seen.values()];
  }
  function applySegmentFallback(rows,extra) {
    const byOS=new Map(),byClient=new Map();
    // Não atribui segmento de outro cliente: nome precisa coincidir,
    // e só aplica fallback por cliente se houver um único segmento possível.
    const track=(cliente,segmento)=>{
      const key=clean(cliente).replace(/\s+/g," ").trim();
      if (!key || !segmento) return;
      if(!byClient.has(key))byClient.set(key,new Set());
      byClient.get(key).add(segmento);
    };
    for(const r of rows)track(r.cliente,r.segmento);
    for(const raw of extra||[]) {
      if (!raw || typeof raw!=="object") continue;
      const a=Object.fromEntries(Object.entries(raw).map(([k,v])=>[k.toLowerCase(),v]));
      const segmento=str(first(a,["segmento","segmento_cliente","u_segmento"]));
      if (!segmento)continue;
      const os=str(first(a,["n_os","numero_os"]));
      if(os){if(!byOS.has(os))byOS.set(os,new Set());byOS.get(os).add(segmento);}
      track(first(a,["cliente","nome_cliente"]),segmento);
    }
    for(const r of rows) {
      if(r.segmento)continue;
      const osOptions=byOS.get(r.os);
      const clientOptions=byClient.get(clean(r.cliente).replace(/\s+/g," ").trim());
      if(osOptions?.size===1) r.segmento=[...osOptions][0];
      else if(clientOptions?.size===1) r.segmento=[...clientOptions][0];
    }
    return rows.filter(r=>!r.segmento).length;
  }
  async function enrichSegments(rows) {
    if (!rows.some(r=>!r.segmento))return 0;
    let extra=[];
    const ctl=new AbortController(),timer=setTimeout(()=>ctl.abort(),8000);
    try {
      const response=await fetch("https://columbia.consultoriarf.net/faturamento_prod?_t="+Date.now(),{
        cache:"no-store",signal:ctl.signal
      });
      if(!response.ok)throw Error("HTTP "+response.status);
      const data=await response.json();
      if (!Array.isArray(data))throw Error("Não foi possível complementar os dados do planejamento");
      extra=data;
    }catch(e){console.warn("Segmentos não disponíveis no JSON complementar:",e);}
    finally {clearTimeout(timer);}
    return applySegmentFallback(rows,extra);
  }
  function filterValue(r,k) {
    if (dateFields.has(k)) return r[k] ? dateBR(r[k]) : "—";
    if (k==="valor") return money(r.valor);
    return str(r[k]) || (k==="segmento"?SEGMENT_EMPTY:"—");
  }
  function clean(s) { return str(s).normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase(); }
  function getSavedFilters() {
    if (["os","osv"].some(k=>new URL(location.href).searchParams.has(k))) return;
    try {
      const s=JSON.parse(localStorage.getItem(FILTER_KEY)||"null");
      if (!s || typeof s!=="object") return;
      store.savedSelections={client:str(s.client),segment:str(s.segment)};
      for (const id of ["search","client","segment","status","from","to"]) if (typeof s[id]==="string") $(id).value=s[id];
      if (cols.includes(s.sortKey)) store.sortKey=s.sortKey;
      store.sortAsc=!!s.sortAsc;
      if (s.columns && typeof s.columns==="object") for (const k of cols)
        if (Array.isArray(s.columns[k])) store.filters[k]=new Set(s.columns[k].map(str));
    } catch(e) { console.warn("Filtros salvos ignorados:",e); }
  }
  function saveFilters() {
    const data={sortKey:store.sortKey,sortAsc:store.sortAsc,columns:{}};
    for (const id of ["search","client","segment","status","from","to"]) data[id]=$(id).value;
    for (const k of cols) data.columns[k]=[...(store.filters[k]||[])];
    try { localStorage.setItem(FILTER_KEY,JSON.stringify(data)); } catch(e) {}
  }
  function parseShare() {
    const params=new URL(location.href).searchParams;
    const packed=params.get("osv"),legacy=params.get("os");
    if(packed===null && legacy===null){store.shareIds=null;return;}
    let ids=[];
    if(packed!==null){
      if(!/^1\.[0-9a-z]+(?:\.[0-9a-z]+)*$/.test(packed))throw Error("Link de planejamento inválido.");
      const parts=packed.split(".").slice(1);
      if(parts.length>5000)throw Error("O link contém OS demais.");
      let last=0;
      for(const part of parts){
        const delta=parseInt(part,36);
        if(!Number.isSafeInteger(delta)||delta<1)throw Error("Seleção de OS inválida.");
        last+=delta;
        if(!Number.isSafeInteger(last))throw Error("Numeração de OS inválida.");
        ids.push(String(last));
      }
    }else{
      if(legacy.length>10000)throw Error("O link é muito longo.");
      ids=legacy.split(",").map(x=>x.trim());
      if(!ids.length||ids.length>5000||ids.some(x=>!/^[\w./-]{1,45}$/.test(x)))throw Error("Seleção compartilhada inválida.");
    }
    store.shareIds=new Set(ids);
    $("sharedBadge").hidden=false;
    $("clearShare").hidden=false;
  }
  function setMessage(m,error) {
    $("message").textContent=m;
    $("message").className="mt-3 border rounded-xl px-3 py-2 text-xs "+(error?"bg-red-50 border-red-200 text-red-700 font-bold":"bg-slate-50 text-slate-600");
  }
  function iconize() { if (window.lucide) window.lucide.createIcons(); }
  function loginRedirect() {
    try {sessionStorage.setItem("columbia_login_next",location.href);}catch(e){}
    location.href="../login.html";
  }
  function deny(msg) {
    store.authorized=false;store.ready=false;store.rows=[];store.filtered=[];
    ["refresh","export","share","selectAll","checkAll"].forEach(id=>$(id).disabled=true);
    $("sync").textContent="ACESSO BLOQUEADO";
    setMessage(msg,true);
    $("rows").innerHTML='<tr><td colspan="11" class="p-12 text-center text-red-700 font-bold text-sm">'+esc(msg)+'</td></tr>';
  }
  async function authorize() {
    const token=localStorage.getItem(TOKEN_KEY);
    if (!token) {loginRedirect();return false;}
    const response=await fetch(API+"/portal/me",{cache:"no-store",headers:{Authorization:"Bearer "+token}});
    if (response.status===401) {loginRedirect();return false;}
    if (response.status===403) {deny("Sua conta não possui autorização para este módulo.");return false;}
    if (!response.ok) {
      deny("Não foi possível conferir sua autorização (código "+response.status+"). Entre novamente ou procure o responsável pelo sistema.");
      return false;
    }
    const data=await response.json();
    if (Number(data.u_pcp)!==1) {deny("Seu usuário não tem acesso ao Planejamento PCP. Procure o responsável pelo sistema.");return false;}
    store.authorized=true;
    const previous=JSON.parse(localStorage.getItem(PERM_KEY)||"{}");
    localStorage.setItem(PERM_KEY,JSON.stringify({...previous,...data}));
    $("usuario").textContent=localStorage.getItem("columbia_analista_usuario")||data.usuario||"PCP";
    return true;
  }
  function updateClientOptions() {
    const selected=$("client").value || store.savedSelections?.client || "";
    const opts=[...new Set(store.rows.map(x=>x.cliente).filter(Boolean))].sort((a,b)=>a.localeCompare(b,"pt-BR"));
    $("client").innerHTML='<option value="">Todos os clientes</option>'+opts.map(x=>'<option value="'+esc(x)+'">'+esc(x)+'</option>').join("");
    $("client").value=opts.includes(selected)?selected:"";
    const selectedSegment=$("segment").value || store.savedSelections?.segment || "";
    const segments=[...new Set(store.rows.map(x=>x.segmento||SEGMENT_EMPTY))].sort((a,b)=>a.localeCompare(b,"pt-BR"));
    $("segment").innerHTML='<option value="">Todos os segmentos</option>'+segments.map(x=>'<option value="'+esc(x)+'">'+esc(x)+'</option>').join("");
    $("segment").value=segments.includes(selectedSegment)?selectedSegment:"";
    store.savedSelections=null;
    syncKanbanFilters();
  }
  function deliveryDate(r) {return (r.manualFlag&&r.manual)?r.manual:(r.reneg||r.original||"");}
  function deliverySource(r) {return (r.manualFlag&&r.manual)?"manual":r.reneg?"grv":r.original?"original":"sem_data";}
  function isoDate(d) {return [d.getFullYear(),String(d.getMonth()+1).padStart(2,"0"),String(d.getDate()).padStart(2,"0")].join("-");}
  // Semana de entrega: segunda a domingo, sempre pela data reprogramada quando existir.
  function deliveryWeek(r) {
    const dt=deliveryDate(r);
    if(!dt || !isCalendarDate(dt))return {key:"9999-12-31",label:"Sem data de entrega"};
    const start=new Date(dt+"T12:00:00");
    start.setDate(start.getDate()-((start.getDay()+6)%7));
    const end=new Date(start);
    end.setDate(end.getDate()+6);
    const initial=isoDate(start);
    return {key:initial,label:"Semana de "+dateBR(initial)+" a "+dateBR(isoDate(end))};
  }
  function groupByDeliveryWeek(rows) {
    const map=new Map();
    for(const r of rows){
      const week=deliveryWeek(r);
      if(!map.has(week.key))map.set(week.key,{...week,rows:[],value:0});
      const group=map.get(week.key);
      group.rows.push(r);
      group.value+=r.valor||0;
    }
    return [...map.values()].sort((a,b)=>a.key.localeCompare(b.key));
  }
  function isOverdue(r) {return !!deliveryDate(r) && deliveryDate(r)<localToday();}
  function passBase(r, ignoreDates=false) {
    if (store.shareIds && !store.shareIds.has(r.os)) return false;
    const q=clean($("search").value);
    if (q && ![r.os,r.orc,r.item,r.cliente,r.segmento||SEGMENT_EMPTY,dateBR(r.original),dateBR(deliveryDate(r)),money(r.valor),r.pend].some(v=>clean(v).includes(q))) return false;
    if ($("client").value && r.cliente!==$("client").value) return false;
    if ($("segment").value && (r.segmento||SEGMENT_EMPTY)!==$("segment").value) return false;
    // Filtra pela data de entrega vigente: reprogramada primeiro; original só se não houver reprogramação.
    // Manter ambas as datas na tabela não significa somá-las como alternativas de entrega.
    const start=$("from").value,end=$("to").value;
    if(!ignoreDates && (start||end)){
      const delivery=deliveryDate(r);
      if(!delivery || (start&&delivery<start) || (end&&delivery>end))return false;
    }
    const s=$("status").value;
    if (s==="overdue"&&!isOverdue(r)) return false;
    if (s==="ontime"&&(isOverdue(r)||!deliveryDate(r))) return false;
    if (s==="reneg"&&!(r.reneg||(r.manualFlag&&r.manual))) return false;
    if (s==="notreneg"&&(r.reneg||(r.manualFlag&&r.manual))) return false;
    if (s==="pending"&&!hasPend(r)) return false;
    return true;
  }
  function passesColumnFilters(row,skipCol,ignoreDates=false){
    for(const [key,values] of Object.entries(store.filters)){
      if(key===skipCol || !values || !values.size)continue;
      if(ignoreDates&&dateFields.has(key))continue;
      if(!values.has(filterValue(row,key)))return false;
    }
    return true;
  }
  function computeFiltered(skipCol) {
    const list=store.rows.filter(r=>passBase(r)&&passesColumnFilters(r,skipCol));
    const key=store.sortKey,dir=store.sortAsc?1:-1;
    list.sort((a,b)=>{
      if (key==="valor") return ((a.valor==null?Infinity:a.valor)-(b.valor==null?Infinity:b.valor))*dir;
      const va=str(a[key]),vb=str(b[key]);
      return va.localeCompare(vb,"pt-BR",{numeric:true,sensitivity:"base"})*dir;
    });
    return list;
  }

  const syncedFilters = {search:"kbSearch",client:"kbClient",segment:"kbSegment",status:"kbStatus"};
  function syncKanbanFilters(){
    // A Planilha mantém os valores centrais e sua persistência em localStorage.
    // No Kanban não copiamos os filtros from/to: o mês das setas é independente.
    for(const [sheet,kanban] of Object.entries(syncedFilters)){
      const source=$(sheet),target=$(kanban);
      if(source.tagName==="SELECT"){
        target.innerHTML=source.innerHTML;
      }
      target.value=source.value;
    }
  }
  function changeKanbanFilter(kanbanId){
    const entry=Object.entries(syncedFilters).find(([,id])=>id===kanbanId);
    if(!entry)return;
    const sheetId=entry[0];
    $(sheetId).value=$(kanbanId).value;
    store.shown=100;
    saveFilters();
    renderKanban();
  }
  function resetKanbanFilters(){
    // Não apaga o mês ativo, os campos from/to nem os filtros por coluna de datas.
    for(const sheetId of Object.keys(syncedFilters))$(sheetId).value="";
    for(const key of Object.keys(store.filters)){
      if(!dateFields.has(key))delete store.filters[key];
    }
    store.shown=100;
    syncKanbanFilters();
    saveFilters();
    renderKanban();
  }
  function setView(target){
    if(target!=="planilha"&&target!=="kanban")return;
    store.view=target;
    syncKanbanFilters();
    $("sheetView").hidden=target!=="planilha";
    $("kanbanView").hidden=target!=="kanban";
    $("share").hidden=target==="kanban";
    $("export").hidden=target==="kanban";
    $("sheetTab").className="action-btn px-5 py-2.5 "+(target==="planilha"?"bg-columbia-700 text-white":"bg-white text-columbia-700 border border-blue-200");
    $("kanbanTab").className="action-btn px-5 py-2.5 "+(target==="kanban"?"bg-columbia-700 text-white":"bg-white text-columbia-700 border border-blue-200");
    $("sheetTab").setAttribute("aria-pressed",String(target==="planilha"));
    $("kanbanTab").setAttribute("aria-pressed",String(target==="kanban"));
    $("tabHint").textContent=target==="kanban"?"Movimentação semanal com registro na TOS.":"Carteira completa com pesquisa e filtros.";
    if(store.ready)render();
  }
  function shiftMonth(direction){
    store.month=new Date(store.month.getFullYear(),store.month.getMonth()+direction,1);
    if(store.view==="kanban")renderKanban();
  }
  function renderKanban(){
    const y=store.month.getFullYear(),m=store.month.getMonth();
    const monthPrefix=y+"-"+String(m+1).padStart(2,"0");
    $("kbMonth").textContent=store.month.toLocaleDateString("pt-BR",{month:"long",year:"numeric"});
    const first=new Date(y,m,1,12),last=new Date(y,m+1,0,12),cursor=new Date(first);
    cursor.setDate(cursor.getDate()-((cursor.getDay()+6)%7));
    const keys=[];
    while(cursor<=last){
      const monday=isoDate(cursor),sunday=new Date(cursor);
      sunday.setDate(sunday.getDate()+6);
      keys.push({start:monday,end:isoDate(sunday),rows:[],value:0});
      cursor.setDate(cursor.getDate()+7);
    }
    const byWeek=new Map(keys.map(w=>[w.start,w]));
    let count=0;
    for(const row of store.rows){
      const dt=deliveryDate(row);
      if(!dt.startsWith(monthPrefix))continue; // obrigatório filtrar UM mês de entrega vigente.
      if(!passBase(row,true)||!passesColumnFilters(row,undefined,true))continue;
      const group=byWeek.get(deliveryWeek(row).key);
      if(!group)continue;
      group.rows.push(row);group.value+=row.valor||0;count++;
    }
    $("kbCount").textContent=countFormatter.format(count)+" OS · "+keys.length+" semanas";
    const activeColumns=Object.entries(store.filters)
      .filter(([key,values])=>!dateFields.has(key)&&values?.size)
      .map(([key])=>labels[key]||key);
    $("kbFilterInfo").textContent=activeColumns.length
      ?"Além dos filtros acima, aplicando "+activeColumns.length+" filtro(s) por coluna da Planilha: "+activeColumns.join(", ")+". Filtros de data são ignorados no Kanban."
      :"Filtros sincronizados com a Planilha. Filtros de datas da Planilha não afetam o Kanban.";
    $("kbBoard").innerHTML=keys.map((g,index)=>{
      g.rows.sort((a,b)=>(deliveryDate(a)||"").localeCompare(deliveryDate(b)||"")||a.os.localeCompare(b.os,"pt-BR",{numeric:true}));
      const cards=g.rows.map(r=>{
        const busy=store.movingOS.has(r.os),hasID=/^\d+$/.test(r.empresa)&&/^\d+$/.test(r.codOS);
        return '<article class="kb-card">'+
          '<div class="flex items-center justify-between gap-2 mb-2"><strong class="text-columbia-700 text-sm font-black">OS '+esc(r.os)+'</strong>'+
          '<span class="kb-badge">'+(r.fonte==="manual"?"MANUAL":r.fonte==="grv"?"GRV":"ORIGINAL")+'</span></div>'+
          '<p class="text-xs font-bold text-slate-800 break-words">'+esc(r.item||"Sem descrição")+'</p>'+
          '<p class="text-[11px] text-slate-600 mt-1 break-words">'+esc(r.cliente||"Cliente não informado")+'</p>'+
          '<div class="mt-2 text-[10px] text-slate-500">Entrega <strong class="text-columbia-700">'+esc(dateBR(deliveryDate(r)))+'</strong> · Orig. '+esc(dateBR(r.original))+'</div>'+
          '<div class="mt-1 text-[11px] font-black text-emerald-800">'+esc(money(r.valor))+'</div>'+
          '<div class="flex items-center justify-between gap-2 mt-3 border-t pt-2">'+
           '<button data-kb-os="'+esc(r.os)+'" data-dir="-1" class="kb-move" title="Voltar uma semana" '+(busy||!hasID?"disabled":"")+'>←</button>'+
           '<span class="text-[10px] font-semibold text-slate-500">'+(busy?"Salvando...":hasID?"Mover semana":"ID da OS ausente")+'</span>'+
           '<button data-kb-os="'+esc(r.os)+'" data-dir="1" class="kb-move" title="Avançar uma semana" '+(busy||!hasID?"disabled":"")+'>→</button>'+
          '</div></article>';
      }).join("");
      return '<section class="kb-col"><header class="kb-head"><div class="flex flex-wrap justify-between gap-2"><strong class="text-xs">Semana '+(index+1)+'</strong><span class="text-[10px]">'+g.rows.length+' OS</span></div>'+
        '<p class="font-bold text-xs mt-1">'+esc(dateBR(g.start))+' a '+esc(dateBR(g.end))+'</p>'+
        '<p class="text-xs text-blue-100 mt-1">'+esc(money(g.value))+'</p></header>'+
        '<div class="kb-cards">'+(cards||'<p class="kb-empty">Nenhuma OS nesta semana</p>')+'</div></section>';
    }).join("");
  }
  async function moveKanban(os,dir){
    const row=store.rows.find(r=>r.os===os);
    if(!row||store.movingOS.has(os)||![1,-1].includes(dir))return;
    if(!/^\d+$/.test(row.empresa)||!/^\d+$/.test(row.codOS))return;
    store.movingOS.add(os);
    $("kbMessage").textContent="Gravando a movimentação da OS "+os+" no GRV...";
    renderKanban();
    try{
      const response=await fetch(API+"/pcp/kanban/mover",{
        method:"PATCH",cache:"no-store",
        headers:{"Content-Type":"application/json",Authorization:"Bearer "+localStorage.getItem(TOKEN_KEY)},
        body:JSON.stringify({cod_empresa:Number(row.empresa),cod_os:Number(row.codOS),direcao:dir})
      });
      if(response.status===401){loginRedirect();return;}
      const data=await response.json().catch(()=>({}));
      if(!response.ok)throw Error(data.detail||("Falha ao reprogramar a OS (HTTP "+response.status+")."));
      row.manual=normalizeDate(data.u_dt_rep_manual);
      row.manualFlag=true;row.entrega=deliveryDate(row);row.fonte="manual";
      $("kbMessage").textContent="OS "+os+" reprogramada para sexta-feira "+dateBR(row.manual)+". Campo u_reprogramado_manual = 1.";
      renderKanban();
      // A API ja corrige o cache, refresh preserva a visao e o mes selecionado.
      await refresh();
    }catch(e){
      $("kbMessage").textContent="Não foi possível mover a OS "+os+": "+(e.message||"Erro na API");
      renderKanban();
    }finally{store.movingOS.delete(os);renderKanban();}
  }
  function render() {
    if (!store.ready || !store.authorized) return;
    if(store.view==="kanban"){renderKanban();return;}
    store.filtered=computeFiltered();
    const count=store.filtered.length;
    const overdue=store.filtered.filter(isOverdue).length;
    const reneg=store.filtered.filter(x=>!!x.reneg||(x.manualFlag&&x.manual)).length;
    const value=store.filtered.reduce((sum,x)=>sum+(x.valor||0),0);
    $("kpiCount").textContent=countFormatter.format(count);
    $("kpiOverdue").textContent=countFormatter.format(overdue);
    $("kpiReneg").textContent=countFormatter.format(reneg);
    $("kpiValue").textContent=money(value);
    $("countText").textContent="· "+countFormatter.format(count)+" de "+countFormatter.format(store.rows.length);
    $("selectedCount").textContent=countFormatter.format(store.selected.size)+" selecionadas";
    const visible=store.filtered.slice(0,store.shown);
    if(!visible.length) $("rows").innerHTML='<tr><td colspan="11" class="p-12 text-center text-slate-500 text-sm">Nenhuma OS encontrada com os filtros atuais.</td></tr>';
    else $("rows").innerHTML=visible.map(r=>{
      const overdueClass=isOverdue(r)?"text-red-700 font-extrabold":"text-slate-700";
      const selected=store.selected.has(r.os);
      return '<tr class="hover:bg-blue-50/40">'+
        '<td class="cell"><input class="os-check w-4 h-4 accent-blue-800" type="checkbox" data-os="'+esc(r.os)+'" '+(selected?"checked":"")+'></td>'+
        '<td class="cell font-mono font-black text-columbia-700">'+esc(r.os)+'</td>'+
        '<td class="cell font-semibold">'+esc(r.orc||"—")+'</td>'+
        '<td class="cell max-w-[350px] whitespace-normal">'+esc(r.item||"—")+'</td>'+
        '<td class="cell whitespace-normal">'+esc(r.cliente||"—")+'</td>'+
        '<td class="cell whitespace-normal">'+(r.segmento?esc(r.segmento):'<span class="inline-block bg-amber-50 text-amber-700 rounded-lg px-2 py-1 text-[11px] font-bold">Sem segmento</span>')+'</td>'+
        '<td class="cell whitespace-nowrap '+overdueClass+'"><div class="font-black">'+esc(dateBR(deliveryDate(r)))+'</div>'+
          '<span class="kb-badge">'+(r.fonte==="manual"?"MANUAL":r.fonte==="grv"?"GRV":"ORIGINAL")+'</span>'+
          (r.fonte!=="manual"?'<button class="text-[10px] text-purple-700 underline ml-1" data-edit="'+esc(r.os)+'" title="Alterar reprogramação GRV">Editar GRV</button>':'')+'</td>'+
        '<td class="cell whitespace-nowrap text-slate-500">'+esc(dateBR(r.original))+'</td>'+
        '<td class="cell text-right whitespace-nowrap font-semibold text-emerald-800">'+esc(money(r.valor))+'</td>'+
        '<td class="cell max-w-[450px] whitespace-normal text-slate-600" title="'+esc(r.pend)+'"><div class="process-clamp">'+esc(r.pend||"—")+'</div></td>'+
        '<td class="cell text-center whitespace-nowrap">'+
          (r.anexos.length?'<button data-attachments="'+esc(r.os)+'" title="Visualizar desenhos técnicos da OS" class="action-btn border border-blue-200 bg-blue-50 text-blue-800 hover:bg-blue-100">Anexos ('+r.anexos.length+')</button>':'<span class="text-slate-400">—</span>')+'</td>'+
        '</tr>';
    }).join("");
    $("pagingInfo").textContent="Exibindo "+countFormatter.format(visible.length)+" de "+countFormatter.format(count)+" OS filtradas";
    $("more").hidden=visible.length>=count;
    const allVisible=visible.length>0&&visible.every(x=>store.selected.has(x.os));
    $("checkAll").checked=allVisible;
    $("checkAll").indeterminate=!allVisible&&visible.some(x=>store.selected.has(x.os));
    for (const k of cols) {
      const a=document.querySelector('[data-arrow="'+k+'"]');
      if (a) a.textContent=k===store.sortKey?(store.sortAsc?"▲":"▼"):"↕";
      const b=document.querySelector('[data-filter="'+k+'"]');
      if (b) b.classList.toggle("on",!!store.filters[k]?.size);
    }
    iconize();
  }
  async function refresh() {
    if (!store.authorized) return;
    $("refresh").disabled=true;
    $("sync").textContent="ATUALIZANDO...";
    setMessage("Atualizando as ordens de serviço...");
    try {
      const response=await fetch(API+"?_t="+Date.now(),{cache:"no-store",headers:{Authorization:"Bearer "+localStorage.getItem(TOKEN_KEY),"Cache-Control":"no-cache"}});
      if (response.status===401) {loginRedirect();return;}
      if (response.status===403) {deny("Seu usuário não tem autorização para consultar estas ordens de serviço.");return;}
      if (!response.ok) throw new Error("Falha ao atualizar os dados. Código: "+response.status);
      const data=await response.json();
      store.rows=normalizeRows(data);
      store.selected=new Set([...store.selected].filter(id=>store.rows.some(r=>r.os===id)));
      store.ready=true;
      updateClientOptions();
      render();
      $("sync").textContent="ATUALIZADO "+new Date().toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"});
      const initialMissing=store.rows.filter(r=>!r.segmento).length;
      let missing=initialMissing;
      if(initialMissing) {
        setMessage("Complementando "+countFormatter.format(initialMissing)+" ordens de serviço...");
        missing=await enrichSegments(store.rows);
        updateClientOptions();
        render();
      }
      if(missing)setMessage("Atenção: "+countFormatter.format(missing)+" OS estão sem segmento cadastrado. Utilize o filtro Sem segmento para identificá-las.",true);
      else setMessage("Dados atualizados. Segmentos carregados, datas editáveis e desenhos técnicos disponíveis.");
    } catch(e) {
      $("sync").textContent=store.ready?"DADOS ANTERIORES":"FALHA NA ATUALIZAÇÃO";
      setMessage("Não foi possível atualizar: "+e.message+(store.ready?". Mantendo dados em memória.":""),true);
      if (!store.ready) $("rows").innerHTML='<tr><td colspan="11" class="p-12 text-center text-red-700">'+esc(e.message)+'</td></tr>';
    } finally {$("refresh").disabled=false;}
  }
  function resetFilters() {
    for (const id of ["search","client","segment","status","from","to"]) $(id).value="";
    store.filters={};store.sortKey="entrega";store.sortAsc=true;store.shown=100;
    syncKanbanFilters();saveFilters();render();
  }
  function optionsFor(key) {
    return [...new Set(computeFiltered(key).map(r=>filterValue(r,key)))].sort((a,b)=>a.localeCompare(b,"pt-BR",{numeric:true}));
  }
  function openPopup(key,button) {
    if (!store.ready) return;
    store.popupKey=key;
    store.popupChoices=new Set(store.filters[key]||[]);
    $("colFilterTitle").textContent="Filtrar: "+labels[key];
    $("colFilterSearch").value="";
    $("colFilter").hidden=false;
    const box=$("colFilter"),rect=button.getBoundingClientRect();
    box.style.left=Math.max(12,Math.min(rect.left,innerWidth-342))+"px";
    box.style.top=Math.min(rect.bottom+8,innerHeight-Math.min(430,innerHeight-30))+"px";
    buildPopupOptions();
  }
  function buildPopupOptions() {
    if (!store.popupKey) return;
    const all=optionsFor(store.popupKey);
    const q=clean($("colFilterSearch").value);
    const values=all.filter(x=>clean(x).includes(q));
    $("colOptions").innerHTML=values.length?values.map(x=>
      '<label class="flex gap-2 items-center p-2 hover:bg-slate-50"><input type="checkbox" class="option-check accent-blue-800" data-value="'+esc(x)+'" '+(store.popupChoices.has(x)?"checked":"")+'><span class="break-all">'+esc(x)+'</span></label>'
    ).join(""):'<div class="p-3 text-slate-400">Sem opções</div>';
  }
  function closePopup() {$("colFilter").hidden=true;store.popupKey=null;store.popupChoices=null;}
  function saveCol() {
    if (!store.popupKey) return;
    const choices=store.popupChoices;
    const all=optionsFor(store.popupKey);
    if (!choices.size || all.every(x=>choices.has(x))) delete store.filters[store.popupKey];
    else store.filters[store.popupKey]=new Set(choices);
    store.shown=100;saveFilters();syncKanbanFilters();closePopup();render();
  }
  function openEdit(os) {
    const r=store.rows.find(x=>x.os===os);
    if (!r) return;
    store.editOS=os;
    $("editOS").textContent="OS "+os+" · "+r.cliente+" · Original: "+dateBR(r.original);
    $("newDate").value=r.reneg||"";
    $("justification").value="";
    $("editError").hidden=true;
    $("editModal").hidden=false;
    $("newDate").focus();
  }
  function showEditError(text) {$("editError").textContent=text;$("editError").hidden=false;}
  async function saveEdit() {
    const os=store.editOS, r=store.rows.find(x=>x.os===os);
    const date=$("newDate").value, reason=$("justification").value.trim();
    if (!r || !os) return;
    if (date && !isCalendarDate(date)) return showEditError("Informe uma data válida.");
    if (!reason) return showEditError("A justificativa é obrigatória.");
    if ((r.reneg||"")===date) return showEditError("A nova data é igual à atual.");
    $("saveEdit").disabled=true;
    $("saveEdit").textContent="Salvando...";
    $("editError").hidden=true;
    try {
      if (!await authorize()) throw new Error("Não foi possível confirmar seu acesso. Entre novamente.");
      const user=localStorage.getItem("columbia_analista_usuario")||"PCP";
      const response=await fetch(API+"/"+encodeURIComponent(os)+"/alterar-renegociacao",{
        method:"PATCH",
        cache:"no-store",
        headers:{"Content-Type":"application/json",Authorization:"Bearer "+localStorage.getItem(TOKEN_KEY)},
        body:JSON.stringify({u_data_renegociacao:date||null,U_JUST_ALT_DT_REN:"["+user.toUpperCase()+"] "+reason})
      });
      if (response.status===401) {loginRedirect();return;}
      const body=await response.json().catch(()=>({}));
      if (!response.ok) throw new Error(body.detail||body.message||"Não foi possível salvar a nova data (código "+response.status+").");
      r.reneg=date;r.entrega=deliveryDate(r);r.fonte=deliverySource(r);
      $("editModal").hidden=true; store.editOS=null;render();
      setMessage("Data reprogramada da OS "+os+" gravada com justificativa. Atualizando dados...");
      await refresh();
    } catch(e) {showEditError(e.message||"Erro ao salvar a reprogramação.");}
    finally {$("saveEdit").disabled=false;$("saveEdit").textContent="Salvar no sistema";}
  }

  function closeAttachments(){
    $("attachmentsModal").hidden=true;
    store.attachmentOS=null;
  }
  function showAttachments(os){
    const row=store.rows.find(r=>r.os===os);
    if(!row)return;
    store.attachmentOS=os;
    $("attachmentError").hidden=true;
    $("attachmentOS").textContent="OS "+os+" · "+row.cliente+" · "+row.anexos.length+" anexo(s)";
    $("attachmentList").innerHTML=row.anexos.length
      ?row.anexos.map((a,index)=>'<button data-open-anexo="'+index+'" class="action-btn border border-blue-200 text-blue-800 bg-blue-50 hover:bg-blue-100">PDF '+(index+1)+' · '+esc(a.nome||("Desenho "+a.aux))+'</button>').join("")
      :'<p class="text-xs text-slate-500">Nenhum desenho técnico identificado para esta OS.</p>';
    $("attachmentsModal").hidden=false;
  }
  function attachmentError(text){$("attachmentError").textContent=text;$("attachmentError").hidden=false;}
  async function openAttachment(index,button){
    const row=store.rows.find(r=>r.os===store.attachmentOS);
    const attachment=row?.anexos[index];
    if (!attachment)return attachmentError("Anexo não encontrado.");
    // A aba precisa ser aberta no clique, antes da consulta ao servidor.
    // Abrir somente depois do await faria navegadores bloquearem o PDF.
    const tab=window.open("about:blank","_blank");
    if(!tab)return attachmentError("O navegador bloqueou a nova aba. Permita abrir novas abas para visualizar os desenhos.");
    try{tab.opener=null;tab.document.title="Carregando desenho técnico";tab.document.body.textContent="Abrindo desenho técnico...";}catch(_){}
    const original=button.textContent;
    button.disabled=true;button.textContent="Abrindo PDF...";
    $("attachmentError").hidden=true;
    try{
      const url=new URL(API+"/desenho-anexo");
      url.searchParams.set("cod_empresa",attachment.empresa);
      url.searchParams.set("cod_os",attachment.os);
      url.searchParams.set("cod_os_aux",attachment.aux);
      const response=await fetch(url.href,{cache:"no-store",headers:{Authorization:"Bearer "+localStorage.getItem(TOKEN_KEY)}});
      if(response.status===401){tab.close();loginRedirect();return;}
      if(!response.ok){
        const error=await response.json().catch(()=>({}));
        throw Error(error.detail||"Não foi possível abrir o desenho técnico (código "+response.status+")");
      }
      const payload=await response.json();
      if(!payload.pdf_base64)throw Error("O desenho técnico não está disponível neste momento.");
      const chars=atob(payload.pdf_base64.replace(/^data:application\/pdf;base64,/i,""));
      const bytes=new Uint8Array(chars.length);
      for(let i=0;i<chars.length;i++)bytes[i]=chars.charCodeAt(i);
      const objectUrl=URL.createObjectURL(new Blob([bytes],{type:"application/pdf"}));
      // Não revoga antes de a nova aba carregar o documento.
      if(!store.attachmentBlobUrls)store.attachmentBlobUrls=[];
      store.attachmentBlobUrls.push(objectUrl);
      tab.location.replace(objectUrl);
    }catch(e){tab.close();attachmentError(e.message||"Não foi possível abrir o desenho técnico.");}
    finally{button.disabled=false;button.textContent=original;}
  }
  function openShare(){
    $("filterQty").textContent=countFormatter.format(store.filtered.length);
    $("selectedQty").textContent=countFormatter.format(store.selected.size);
    document.querySelector('input[name="shareScope"][value="filtered"]').checked=true;
    $("shareResult").hidden=true;
    $("portalName").value="Planejamento de entrega · "+new Date().toLocaleDateString("pt-BR",{month:"long",year:"numeric"});
    $("shareWeekSummary").innerHTML="";
    $("shareError").hidden=true;
    $("shareModal").hidden=false;
  }
  function shareError(msg){$("shareError").textContent=msg;$("shareError").hidden=false;}
  const PORTAL_API=API+"/pcp";
  const portalHeaders=(extra={})=>({
    Authorization:"Bearer "+(localStorage.getItem(TOKEN_KEY)||""),
    ...extra
  });
  async function portalRequest(path,opts={}){
    const response=await fetch(PORTAL_API+path,{
      cache:"no-store",
      ...opts,
      headers:portalHeaders(opts.headers)
    });
    if(response.status===401){loginRedirect();throw Error("Sua sessão expirou. Entre novamente.");}
    const data=await response.json().catch(()=>({}));
    if(!response.ok)throw Error(data.detail||data.message||(response.status===404?"O compartilhamento ainda não está habilitado no servidor.":("Não foi possível concluir a operação (código "+response.status+").")));
    return data;
  }
  function publicUrl(id,token){
    if(!id||!token)throw Error("Não foi possível obter o endereço de compartilhamento.");
    const link=new URL("./portal.html",location.href);
    link.searchParams.set("id",String(id));
    link.searchParams.set("token",String(token));
    return link.href;
  }
  async function generateShare(){
    $("shareError").hidden=true;
    const selected=document.querySelector('input[name="shareScope"]:checked')?.value==="selected";
    const rows=selected
      ?store.rows.filter(r=>store.selected.has(r.os)&&(!store.shareIds||store.shareIds.has(r.os)))
      :store.filtered;
    if(!rows.length)return shareError("Não existem OS nessa seleção.");
    const name=$("portalName").value.trim();
    if(!name)return shareError("Informe o nome do planejamento.");
    const validade=Number($("portalValidity").value);
    if(![0,7,30,90,365].includes(validade))return shareError("Escolha a validade.");
    const btn=$("generateShare");
    btn.disabled=true;btn.textContent="Criando link...";
    $("shareResult").hidden=true;
    try{
      if(!await authorize())throw Error("Seu acesso não pôde ser confirmado.");
      const data=await portalRequest("/portal",{
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({
          nome:name,validade_dias:validade,
          mostrar_valores:$("portalValues").checked,
          permitir_excel:$("portalExcel").checked,
          os:[...new Set(rows.map(r=>r.os))]
        })
      });
      const created=data.portal||data;
      // Nunca criar um link compartilhável sem token de acesso emitido pelo servidor.
      const link=publicUrl(created.id,created.token);
      $("shareURL").value=link;
      $("shareWeekSummary").innerHTML='<div class="text-xs bg-blue-50 border border-blue-200 rounded-lg p-3 font-bold text-columbia-700">'+
        'Planejamento: '+countFormatter.format(rows.length)+' OS · '+
        esc($("portalValues").checked?money(rows.reduce((sum,r)=>sum+(r.valor||0),0)):"valores ocultos")+
        ' · '+(validade?validade+" dias":"sem vencimento")+'</div>';
      $("shareResult").hidden=false;
    }catch(e){shareError(e.message||"Não foi possível gerar o link.");}
    finally{btn.disabled=false;btn.textContent="Criar link público";}
  }
  function portalDate(v){
    if(!v)return"Sem vencimento";
    const d=new Date(v);
    return Number.isFinite(d.getTime())?d.toLocaleString("pt-BR"):"Sem vencimento";
  }
  function showManageError(message){
    $("managePortalList").innerHTML='<p class="text-xs rounded-xl border border-red-200 bg-red-50 text-red-700 p-4">'+esc(message)+'</p>';
  }
  async function managePortals(){
    $("shareModal").hidden=true;
    $("managePortalModal").hidden=false;
    $("managePortalList").textContent="Carregando links do planejamento...";
    try{
      const data=await portalRequest("/portais");
      const list=Array.isArray(data)?data:(data.portais||[]);
      if(!list.length){$("managePortalList").textContent="Nenhum link criado até o momento.";return;}
      $("managePortalList").innerHTML='<div class="space-y-3">'+list.map(p=>{
        const active=p.ativo===true||p.ativo===1;
        const expired=!!p.validade_ate&&Date.parse(p.validade_ate)<Date.now();
        return '<div class="rounded-xl border p-3 flex flex-wrap items-center justify-between gap-3">'+
          '<div><p class="font-extrabold text-sm text-columbia-700">'+esc(p.nome||"Planejamento")+'</p>'+
          '<p class="text-[11px] text-slate-500">'+Number(p.qtd_os||0).toLocaleString("pt-BR")+' OS · Validade: '+esc(portalDate(p.validade_ate))+'</p>'+
          '<p class="text-[11px] font-bold '+(active&&!expired?'text-emerald-700':'text-red-700')+'">'+(expired?"VENCIDO":active?"ATIVO":"DESATIVADO")+'</p></div>'+
          '<div class="flex gap-1 flex-wrap">'+
          (p.url?'<button data-copy-portal="'+esc(p.id)+'" class="action-btn border text-columbia-700" title="Copiar link">Copiar</button>':'')+
          '<button data-status-portal="'+esc(p.id)+'" data-active="'+(active?"1":"0")+'" class="action-btn '+(active?'bg-red-50 text-red-700':'bg-emerald-50 text-emerald-700')+'">'+(active?'Desativar':'Reativar')+'</button>'+
          '</div></div>';
      }).join("")+'</div>';
      store.managePortals=list;
    }catch(e){showManageError(e.message);}
  }
  async function managePortalAction(event){
    const copy=event.target.closest("[data-copy-portal]");
    const change=event.target.closest("[data-status-portal]");
    if(copy){
      const p=(store.managePortals||[]).find(v=>String(v.id)===copy.dataset.copyPortal);
      if(!p?.url)return showManageError("Não foi possível recuperar este link. Crie um novo.");
      if(await copyText(p.url)){copy.textContent="Copiado!";setTimeout(()=>copy.textContent="Copiar",1500);}
      return;
    }
    if(!change)return;
    const id=change.dataset.statusPortal,ativo=change.dataset.active==="0";
    change.disabled=true;
    try{
      await portalRequest("/portal/"+encodeURIComponent(id)+"/status",{
        method:"PATCH",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({ativo})
      });
      await managePortals();
    }catch(e){showManageError(e.message);}
    finally{change.disabled=false;}
  }
  async function copyText(value){
    try{await navigator.clipboard.writeText(value);return true;}
    catch(e){
      const el=document.createElement("textarea");
      el.value=value;el.style.position="fixed";el.style.opacity="0";
      document.body.appendChild(el);el.select();
      const ok=document.execCommand("copy");el.remove();return !!ok;
    }
  }
  async function copyShare(){
    const value=$("shareURL").value;
    if(!value)return shareError("Gere o link primeiro.");
    if(!await copyText(value))return shareError("Não foi possível copiar. Selecione o link e copie manualmente.");
    $("copyShare").textContent="Copiado!";
    setTimeout(()=>$("copyShare").textContent="Copiar link",1500);
  }
  function exportExcel() {
    if (!store.filtered.length) return alert("Nenhuma OS filtrada para exportar.");
    if (!window.XLSX) return alert("Não foi possível preparar a planilha. Atualize a página e tente novamente.");
    const records=store.filtered.map(r=>({
      "Nº OS":r.os,"Orçamento":r.orc,"Item":r.item,"Cliente":r.cliente,"Segmento":r.segmento||SEGMENT_EMPTY,
      "Semana de entrega":deliveryWeek(r).label,"Entrega vigente":dateBR(deliveryDate(r)),
      "Fonte da data":r.fonte,"Original (referência)":dateBR(r.original),
      "Valor":r.valor,"Processos pendentes":r.pend
    }));
    const sheet=XLSX.utils.json_to_sheet(records);
    sheet["!cols"]=[{wch:13},{wch:15},{wch:38},{wch:29},{wch:24},{wch:35},{wch:19},{wch:19},{wch:20},{wch:16},{wch:45}];
    const book=XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book,sheet,"Carteira PCP");
    XLSX.writeFile(book,"Carteira_PCP_Columbia_"+localToday()+".xlsx");
  }
  function bind() {
    $("sheetTab").addEventListener("click",()=>setView("planilha"));
    $("kanbanTab").addEventListener("click",()=>setView("kanban"));
    $("kbPrev").addEventListener("click",()=>shiftMonth(-1));
    $("kbNext").addEventListener("click",()=>shiftMonth(1));
    let kbDebounce;
    for(const kanbanId of Object.values(syncedFilters)){
      $(kanbanId).addEventListener(kanbanId==="kbSearch"?"input":"change",()=>{
        clearTimeout(kbDebounce);
        kbDebounce=setTimeout(()=>changeKanbanFilter(kanbanId),kanbanId==="kbSearch"?150:0);
      });
    }
    $("kbClear").addEventListener("click",resetKanbanFilters);
    $("kbBoard").addEventListener("click",e=>{
      const b=e.target.closest("[data-kb-os]");
      if(b)moveKanban(b.dataset.kbOs,Number(b.dataset.dir));
    });
    $("refresh").addEventListener("click",refresh);
    $("export").addEventListener("click",exportExcel);
    $("share").addEventListener("click",openShare);
    $("generateShare").addEventListener("click",generateShare);
    $("manageShare").addEventListener("click",managePortals);
    $("managePortalList").addEventListener("click",managePortalAction);
    $("copyShare").addEventListener("click",copyShare);
    $("openShared").addEventListener("click",()=>{const url=$("shareURL").value;if(url)window.open(url,"_blank","noopener,noreferrer");});
    $("logout").addEventListener("click",()=>{
      [TOKEN_KEY,PERM_KEY,"columbia_analista_usuario","columbia_analista_cod_responsavel"].forEach(k=>localStorage.removeItem(k));
      location.href="../login.html";
    });
    let debounce;
    for (const id of ["search","client","segment","status","from","to"]) {
      $(id).addEventListener(id==="search"?"input":"change",()=>{
        clearTimeout(debounce);
        debounce=setTimeout(()=>{
          store.shown=100;saveFilters();
          if(Object.hasOwn(syncedFilters,id))syncKanbanFilters();
          render();
        },id==="search"?180:0);
      });
    }
    $("clear").addEventListener("click",resetFilters);
    $("clearShare").addEventListener("click",()=>{
      const url=new URL(location.href);url.searchParams.delete("os");url.searchParams.delete("osv");location.href=url.href;
    });
    $("selectAll").addEventListener("click",()=>{
      const all=store.filtered.every(r=>store.selected.has(r.os));
      for (const row of store.filtered) all?store.selected.delete(row.os):store.selected.add(row.os);
      render();
    });
    $("checkAll").addEventListener("change",e=>{
      for (const row of store.filtered.slice(0,store.shown)) e.target.checked?store.selected.add(row.os):store.selected.delete(row.os);
      render();
    });
    $("more").addEventListener("click",()=>{store.shown+=100;render();});
    $("rows").addEventListener("change",e=>{
      const cb=e.target.closest(".os-check");
      if (!cb) return;
      cb.checked?store.selected.add(cb.dataset.os):store.selected.delete(cb.dataset.os);
      render();
    });
    $("rows").addEventListener("click",e=>{
      const anexos=e.target.closest("[data-attachments]");
      if(anexos){
        const r=store.rows.find(x=>x.os===anexos.dataset.attachments);
        if(r?.anexos.length===1){store.attachmentOS=r.os;openAttachment(0,anexos);}
        else showAttachments(anexos.dataset.attachments);
        return;
      }
      const b=e.target.closest("[data-edit]");
      if (b) openEdit(b.dataset.edit);
    });
    $("attachmentList").addEventListener("click",e=>{
      const btn=e.target.closest("[data-open-anexo]");
      if(btn)openAttachment(Number(btn.dataset.openAnexo),btn);
    });
    document.querySelectorAll("[data-sort]").forEach(b=>b.addEventListener("click",()=>{
      const k=b.dataset.sort;
      if (store.sortKey===k) store.sortAsc=!store.sortAsc;
      else {store.sortKey=k;store.sortAsc=true;}
      saveFilters();render();
    }));
    document.querySelectorAll("[data-filter]").forEach(b=>b.addEventListener("click",e=>{
      e.stopPropagation();openPopup(b.dataset.filter,b);
    }));
    $("filterClose").addEventListener("click",closePopup);
    $("colFilterSearch").addEventListener("input",buildPopupOptions);
    $("colOptions").addEventListener("change",e=>{
      const c=e.target.closest(".option-check");if (!c) return;
      c.checked?store.popupChoices.add(c.dataset.value):store.popupChoices.delete(c.dataset.value);
    });
    $("filterToggle").addEventListener("click",()=>{
      if (!store.popupKey) return;
      const all=optionsFor(store.popupKey).filter(x=>clean(x).includes(clean($("colFilterSearch").value)));
      const allSelected=all.length&&all.every(x=>store.popupChoices.has(x));
      for (const x of all) allSelected?store.popupChoices.delete(x):store.popupChoices.add(x);
      buildPopupOptions();
    });
    $("filterReset").addEventListener("click",()=>{if (!store.popupKey)return;delete store.filters[store.popupKey];saveFilters();syncKanbanFilters();closePopup();render();});
    $("filterApply").addEventListener("click",saveCol);
    document.addEventListener("click",e=>{
      if (!store.popupKey)return;
      if (!e.target.closest("#colFilter")&&!e.target.closest("[data-filter]")) closePopup();
    });
    document.querySelectorAll("[data-close]").forEach(b=>b.addEventListener("click",()=>{
      if(b.dataset.close==="attachmentsModal")closeAttachments();
      else $(b.dataset.close).hidden=true;
    }));
    $("saveEdit").addEventListener("click",saveEdit);
    for (const id of ["editModal","shareModal","attachmentsModal","managePortalModal"]) $(id).addEventListener("click",e=>{
      if(e.target!==$(id))return;
      if(id==="attachmentsModal")closeAttachments();else $(id).hidden=true;
    });
    document.addEventListener("keydown",e=>{if(e.key==="Escape"){closePopup();$("editModal").hidden=true;$("shareModal").hidden=true;$("managePortalModal").hidden=true;closeAttachments();}});
    window.addEventListener("pagehide",()=>{for(const url of store.attachmentBlobUrls||[])URL.revokeObjectURL(url);});
  }
  async function init() {
    bind();iconize();
    try {
      parseShare();
      getSavedFilters();
      if (!await authorize()) return;
      ["refresh","export","share","selectAll","checkAll"].forEach(id=>$(id).disabled=false);
      await refresh();
    } catch(e) { deny("Falha ao iniciar a Carteira PCP: "+e.message); }
  }
  document.addEventListener("DOMContentLoaded",init);
})();