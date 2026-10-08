(() => {
  "use strict";

  const API = "https://columbia.consultoriarf.net/producao";
  const TOKEN_KEY = "columbia_analista_token";
  const PERM_KEY = "columbia_permissoes";
  const FILTER_KEY = "columbia_pcp_filters_v1";
  const moneyFormatter = new Intl.NumberFormat("pt-BR", {style:"currency",currency:"BRL"});
  const countFormatter = new Intl.NumberFormat("pt-BR");
  const labels = {os:"Nº OS",orc:"Orçamento",item:"Item",cliente:"Cliente",segmento:"Segmento",original:"Previsão original OS",reneg:"Data renegociada",valor:"Valor",pend:"Processos pendentes"};
  const cols = Object.keys(labels);
  const $ = id => document.getElementById(id);
  const str = v => v == null ? "" : String(v).trim();
  const blank = v => !str(v) || ["null","none","nat","nan","undefined","-"].includes(str(v).toLowerCase());
  const esc = v => String(v == null ? "" : v).replace(/[&<>"']/g, x => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[x]));
  const localToday = () => { const d = new Date(); return [d.getFullYear(),String(d.getMonth()+1).padStart(2,"0"),String(d.getDate()).padStart(2,"0")].join("-"); };
  const money = v => v == null ? "—" : moneyFormatter.format(v);
  const store = {rows:[],filtered:[],selected:new Set(),authorized:false,ready:false,editOS:null,pageSize:100,shown:100,sortKey:"original",sortAsc:true,shareIds:null,filters:{},popupKey:null,popupChoices:null};
  const numberFields = new Set(["valor"]);
  const dateFields = new Set(["original","reneg"]);

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
  function normalizeRows(raw) {
    if (!Array.isArray(raw)) throw new Error("O JSON de produção não retornou uma lista de OS.");
    const seen=new Map();
    for (const item of raw) {
      if (!item || typeof item!=="object") continue;
      const lower={};
      for (const [k,v] of Object.entries(item)) lower[k.toLowerCase()]=v;
      const os=str(first(lower,["n_os","numero_os"]));
      if (!os) continue;
      const row={
        os,
        orc:str(first(lower,["n_orcamento","orcamento","numero_orcamento"])),
        item:str(first(lower,["titulo","descricao","cod_interno","tiposervico"])),
        cliente:str(first(lower,["cliente","nome_cliente"])),
        segmento:str(first(lower,["segmento","segmento_cliente","classificacao_segmento"])),
        original:normalizeDate(first(lower,["prev_entrega_os","dt_previsao_entrega","dt_prevista"])),
        reneg:normalizeDate(first(lower,["dt_renegociada","u_data_renegociacao"])),
        valor:parseMoney(first(lower,["preco_geral_a_vista","valor","vl_a_faturar"])),
        pend:proc(first(lower,["pp_pendentes","processos_pendentes"]))
      };
      if (!seen.has(os)) {seen.set(os,row);continue;}
      const old=seen.get(os);
      for (const f of ["orc","item","cliente","segmento","original","reneg"]) if (!old[f] && row[f]) old[f]=row[f];
      if (old.valor==null && row.valor!=null) old.valor=row.valor;
      if (hasPend(row) && !old.pend.includes(row.pend)) old.pend=hasPend(old) ? old.pend+" | "+row.pend : row.pend;
    }
    return [...seen.values()];
  }
  function filterValue(r,k) {
    if (dateFields.has(k)) return r[k] ? dateBR(r[k]) : "—";
    if (k==="valor") return money(r.valor);
    return str(r[k]) || "—";
  }
  function clean(s) { return str(s).normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase(); }
  function getSavedFilters() {
    if (new URL(location.href).searchParams.has("os")) return;
    try {
      const s=JSON.parse(localStorage.getItem(FILTER_KEY)||"null");
      if (!s || typeof s!=="object") return;
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
    const param=new URL(location.href).searchParams.get("os");
    if (param===null) {store.shareIds=null;return;}
    const ids=param.split(",").map(x=>x.trim()).filter(x=>/^[\w./-]{1,45}$/.test(x));
    if (!ids.length || ids.length>700 || param.length>7000) throw new Error("O link contém uma seleção de OS inválida ou grande demais.");
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
    $("rows").innerHTML='<tr><td colspan="10" class="p-12 text-center text-red-700 font-bold text-sm">'+esc(msg)+'</td></tr>';
  }
  async function authorize() {
    const token=localStorage.getItem(TOKEN_KEY);
    if (!token) {loginRedirect();return false;}
    const response=await fetch(API+"/portal/me",{cache:"no-store",headers:{Authorization:"Bearer "+token}});
    if (response.status===401) {loginRedirect();return false;}
    if (response.status===403) {deny("Sua conta não possui autorização para este módulo.");return false;}
    if (!response.ok) {
      deny("Não foi possível verificar a permissão U_PCP com o servidor (HTTP "+response.status+"). A consulta está bloqueada por segurança.");
      return false;
    }
    const data=await response.json();
    if (Number(data.u_pcp)!==1) {deny("Acesso exclusivo a usuários com U_PCP = 1 no GRV.");return false;}
    store.authorized=true;
    const previous=JSON.parse(localStorage.getItem(PERM_KEY)||"{}");
    localStorage.setItem(PERM_KEY,JSON.stringify({...previous,...data}));
    $("usuario").textContent=localStorage.getItem("columbia_analista_usuario")||data.usuario||"PCP";
    return true;
  }
  function updateClientOptions() {
    const selected=$("client").value;
    const opts=[...new Set(store.rows.map(x=>x.cliente).filter(Boolean))].sort((a,b)=>a.localeCompare(b,"pt-BR"));
    $("client").innerHTML='<option value="">Todos os clientes</option>'+opts.map(x=>'<option value="'+esc(x)+'">'+esc(x)+'</option>').join("");
    $("client").value=opts.includes(selected)?selected:"";
    const selectedSegment=$("segment").value;
    const segments=[...new Set(store.rows.map(x=>x.segmento).filter(Boolean))].sort((a,b)=>a.localeCompare(b,"pt-BR"));
    $("segment").innerHTML='<option value="">Todos os segmentos</option>'+segments.map(x=>'<option value="'+esc(x)+'">'+esc(x)+'</option>').join("");
    $("segment").value=segments.includes(selectedSegment)?selectedSegment:"";
  }
  function isOverdue(r) {return !!(r.reneg||r.original) && (r.reneg||r.original)<localToday();}
  function passBase(r) {
    if (store.shareIds && !store.shareIds.has(r.os)) return false;
    const q=clean($("search").value);
    if (q && ![r.os,r.orc,r.item,r.cliente,r.segmento,dateBR(r.original),dateBR(r.reneg),money(r.valor),r.pend].some(v=>clean(v).includes(q))) return false;
    if ($("client").value && r.cliente!==$("client").value) return false;
    if ($("segment").value && r.segmento!==$("segment").value) return false;
    if ($("from").value && (!r.original || r.original<$("from").value)) return false;
    if ($("to").value && (!r.original || r.original>$("to").value)) return false;
    const s=$("status").value;
    if (s==="overdue"&&!isOverdue(r)) return false;
    if (s==="ontime"&&(isOverdue(r)||!(r.reneg||r.original))) return false;
    if (s==="reneg"&&!r.reneg) return false;
    if (s==="notreneg"&&r.reneg) return false;
    if (s==="pending"&&!hasPend(r)) return false;
    return true;
  }
  function computeFiltered(skipCol) {
    const list=store.rows.filter(r=>{
      if (!passBase(r)) return false;
      for (const [key,values] of Object.entries(store.filters)) {
        if (key===skipCol || !values || !values.size) continue;
        if (!values.has(filterValue(r,key))) return false;
      }
      return true;
    });
    const key=store.sortKey,dir=store.sortAsc?1:-1;
    list.sort((a,b)=>{
      if (key==="valor") return ((a.valor==null?Infinity:a.valor)-(b.valor==null?Infinity:b.valor))*dir;
      const va=str(a[key]),vb=str(b[key]);
      return va.localeCompare(vb,"pt-BR",{numeric:true,sensitivity:"base"})*dir;
    });
    return list;
  }
  function render() {
    if (!store.ready || !store.authorized) return;
    store.filtered=computeFiltered();
    const count=store.filtered.length;
    const overdue=store.filtered.filter(isOverdue).length;
    const reneg=store.filtered.filter(x=>!!x.reneg).length;
    const value=store.filtered.reduce((sum,x)=>sum+(x.valor||0),0);
    $("kpiCount").textContent=countFormatter.format(count);
    $("kpiOverdue").textContent=countFormatter.format(overdue);
    $("kpiReneg").textContent=countFormatter.format(reneg);
    $("kpiValue").textContent=money(value);
    $("countText").textContent="· "+countFormatter.format(count)+" de "+countFormatter.format(store.rows.length);
    $("selectedCount").textContent=countFormatter.format(store.selected.size)+" selecionadas";
    const visible=store.filtered.slice(0,store.shown);
    if (!visible.length) $("rows").innerHTML='<tr><td colspan="10" class="p-12 text-center text-slate-500 text-sm">Nenhuma OS encontrada com os filtros atuais.</td></tr>';
    else $("rows").innerHTML=visible.map(r=>{
      const overdueClass=isOverdue(r)?"text-red-700 font-extrabold":"text-slate-700";
      const selected=store.selected.has(r.os);
      return '<tr class="hover:bg-blue-50/40">'+
        '<td class="cell"><input class="os-check w-4 h-4 accent-blue-800" type="checkbox" data-os="'+esc(r.os)+'" '+(selected?"checked":"")+'></td>'+
        '<td class="cell font-mono font-black text-columbia-700">'+esc(r.os)+'</td>'+
        '<td class="cell font-semibold">'+esc(r.orc||"—")+'</td>'+
        '<td class="cell max-w-[350px] whitespace-normal">'+esc(r.item||"—")+'</td>'+
        '<td class="cell whitespace-normal">'+esc(r.cliente||"—")+'</td>'+
        '<td class="cell whitespace-normal">'+esc(r.segmento||"—")+'</td>'+
        '<td class="cell whitespace-nowrap '+overdueClass+'">'+esc(dateBR(r.original))+'</td>'+
        '<td class="cell whitespace-nowrap"><button class="edit-date text-purple-700 font-bold hover:bg-purple-50 rounded-lg px-2 py-1 border border-transparent hover:border-purple-200" data-edit="'+esc(r.os)+'" title="Alterar data renegociada">'+esc(dateBR(r.reneg))+' ✎</button></td>'+
        '<td class="cell text-right whitespace-nowrap font-semibold text-emerald-800">'+esc(money(r.valor))+'</td>'+
        '<td class="cell max-w-[450px] whitespace-normal text-slate-600" title="'+esc(r.pend)+'">'+esc(r.pend||"—")+'</td>'+
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
    setMessage("Carregando os dados atuais do JSON de produção...");
    try {
      const response=await fetch(API+"?_t="+Date.now(),{cache:"no-store",headers:{Authorization:"Bearer "+localStorage.getItem(TOKEN_KEY),"Cache-Control":"no-cache"}});
      if (response.status===401) {loginRedirect();return;}
      if (response.status===403) {deny("A API recusou o acesso aos dados de produção.");return;}
      if (!response.ok) throw new Error("Falha na API: HTTP "+response.status);
      const data=await response.json();
      store.rows=normalizeRows(data);
      store.selected=new Set([...store.selected].filter(id=>store.rows.some(r=>r.os===id)));
      store.ready=true;
      updateClientOptions();
      render();
      $("sync").textContent="ATUALIZADO "+new Date().toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"});
      setMessage("Dados carregados do mesmo JSON da Produção Columbia. Alterações de datas são gravadas no sistema.");
    } catch(e) {
      $("sync").textContent=store.ready?"DADOS ANTERIORES":"ERRO NA API";
      setMessage("Não foi possível atualizar: "+e.message+(store.ready?". Mantendo dados em memória.":""),true);
      if (!store.ready) $("rows").innerHTML='<tr><td colspan="10" class="p-12 text-center text-red-700">'+esc(e.message)+'</td></tr>';
    } finally {$("refresh").disabled=false;}
  }
  function resetFilters() {
    for (const id of ["search","client","segment","status","from","to"]) $(id).value="";
    store.filters={};store.sortKey="original";store.sortAsc=true;store.shown=100;
    saveFilters();render();
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
    store.shown=100;saveFilters();closePopup();render();
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
      if (!await authorize()) throw new Error("Permissão não validada. Alteração bloqueada.");
      const user=localStorage.getItem("columbia_analista_usuario")||"PCP";
      const response=await fetch(API+"/"+encodeURIComponent(os)+"/alterar-renegociacao",{
        method:"PATCH",
        cache:"no-store",
        headers:{"Content-Type":"application/json",Authorization:"Bearer "+localStorage.getItem(TOKEN_KEY)},
        body:JSON.stringify({u_data_renegociacao:date||null,U_JUST_ALT_DT_REN:"["+user.toUpperCase()+"] "+reason})
      });
      if (response.status===401) {loginRedirect();return;}
      const body=await response.json().catch(()=>({}));
      if (!response.ok) throw new Error(body.detail||body.message||"Falha ao atualizar no sistema (HTTP "+response.status+").");
      r.reneg=date; $("editModal").hidden=true; store.editOS=null;render();
      setMessage("Data renegociada da OS "+os+" gravada com justificativa. Atualizando dados...");
      await refresh();
    } catch(e) {showEditError(e.message||"Erro ao salvar renegociação.");}
    finally {$("saveEdit").disabled=false;$("saveEdit").textContent="Salvar no sistema";}
  }
  function openShare() {
    $("filterQty").textContent=countFormatter.format(store.filtered.length);
    $("selectedQty").textContent=countFormatter.format(store.selected.size);
    document.querySelector('input[name="shareScope"][value="filtered"]').checked=true;
    $("shareResult").hidden=true;$("shareError").hidden=true;
    $("shareModal").hidden=false;
  }
  function shareError(msg) {$("shareError").textContent=msg;$("shareError").hidden=false;}
  function generateShare() {
    $("shareError").hidden=true;
    const scope=document.querySelector('input[name="shareScope"]:checked')?.value;
    const ids=[...new Set(scope==="selected"?[...store.selected]:store.filtered.map(r=>r.os))];
    if (!ids.length) return shareError("Não existem OS nesta seleção.");
    if (ids.length>700) return shareError("Esta seleção possui muitas OS para um link direto. Reduza com os filtros.");
    const url=new URL(location.href);
    url.search="";url.hash="";
    url.searchParams.set("os",ids.join(","));
    if (url.href.length>7000) return shareError("O link ficou muito longo. Refine os filtros e gere novamente.");
    $("shareURL").value=url.href;
    $("shareResult").hidden=false;
    $("shareURL").select();
  }
  async function copyShare() {
    try {
      await navigator.clipboard.writeText($("shareURL").value);
    } catch(e) {
      $("shareURL").select();
      try {document.execCommand("copy");}catch(err) {return shareError("Selecione e copie o link manualmente.");}
    }
    $("copyShare").textContent="Copiado!";
    setTimeout(()=>$("copyShare").textContent="Copiar",1600);
  }
  function exportExcel() {
    if (!store.filtered.length) return alert("Nenhuma OS filtrada para exportar.");
    if (!window.XLSX) return alert("A biblioteca de Excel não carregou. Verifique a conexão.");
    const records=store.filtered.map(r=>({
      "Nº OS":r.os,"Orçamento":r.orc,"Item":r.item,"Cliente":r.cliente,"Segmento":r.segmento,
      "Previsão original OS":dateBR(r.original),"Data renegociada":dateBR(r.reneg),
      "Valor":r.valor,"Processos pendentes":r.pend
    }));
    const sheet=XLSX.utils.json_to_sheet(records);
    sheet["!cols"]=[{wch:13},{wch:15},{wch:38},{wch:29},{wch:24},{wch:19},{wch:20},{wch:16},{wch:45}];
    const book=XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book,sheet,"Carteira PCP");
    XLSX.writeFile(book,"Carteira_PCP_Columbia_"+localToday()+".xlsx");
  }
  function bind() {
    $("refresh").addEventListener("click",refresh);
    $("export").addEventListener("click",exportExcel);
    $("share").addEventListener("click",openShare);
    $("generateShare").addEventListener("click",generateShare);
    $("copyShare").addEventListener("click",copyShare);
    $("logout").addEventListener("click",()=>{
      [TOKEN_KEY,PERM_KEY,"columbia_analista_usuario","columbia_analista_cod_responsavel"].forEach(k=>localStorage.removeItem(k));
      location.href="../login.html";
    });
    let debounce;
    for (const id of ["search","client","segment","status","from","to"]) {
      $(id).addEventListener(id==="search"?"input":"change",()=>{
        clearTimeout(debounce);
        debounce=setTimeout(()=>{store.shown=100;saveFilters();render();},id==="search"?180:0);
      });
    }
    $("clear").addEventListener("click",resetFilters);
    $("clearShare").addEventListener("click",()=>{
      const url=new URL(location.href);url.searchParams.delete("os");location.href=url.href;
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
      const b=e.target.closest("[data-edit]");
      if (b) openEdit(b.dataset.edit);
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
    $("filterReset").addEventListener("click",()=>{if (!store.popupKey)return;delete store.filters[store.popupKey];saveFilters();closePopup();render();});
    $("filterApply").addEventListener("click",saveCol);
    document.addEventListener("click",e=>{
      if (!store.popupKey)return;
      if (!e.target.closest("#colFilter")&&!e.target.closest("[data-filter]")) closePopup();
    });
    document.querySelectorAll("[data-close]").forEach(b=>b.addEventListener("click",()=>{$(b.dataset.close).hidden=true;}));
    $("saveEdit").addEventListener("click",saveEdit);
    for (const id of ["editModal","shareModal"]) $(id).addEventListener("click",e=>{if (e.target===$(id))$(id).hidden=true;});
    document.addEventListener("keydown",e=>{if(e.key==="Escape"){closePopup();$("editModal").hidden=true;$("shareModal").hidden=true;}});
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