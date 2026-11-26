"use strict";
(function () {
  const ROOT = "https://columbia.consultoriarf.net";
  const BASE_PRODUCAO = ROOT + "/producao";
  const API = {
    materiais: ROOT + "/revenda",
    ncm: ROOT + "/ncm",
    cbs: ROOT + "/cbsibs",
    salvar: ROOT + "/revenda/atualizar",
    salvarLote: ROOT + "/revenda/atualizar-lote",
    sincronizarNcm: ROOT + "/revenda/sincronizar-ncm-ultima-entrada"
  };
  const TOKEN_KEY = "columbia_analista_token";
  const USER_KEY = "columbia_analista_usuario";
  const $ = (id) => document.getElementById(id);
  const state = {
    materials: [], ncm: [], cbs: [], loading: false, referenceReady: false,
    page: 1, pageSize: 50, query: "", status: "pending", ncmCompareFilter: "all",
    sort: "nome", direction: 1, material: null,
    selectedNcm: null, selectedCbs: null, inFlight: false, toastTimer: null,
    selected: new Set(), columnFilters: {}, openFilter: null, filterDraft: null, searchTimer: null,
    bulkNcm: null, bulkCbs: null, bulkInFlight: false,
    syncPending: null, syncInFlight: false
  };


  const COLS = [
    ["codigo_interno","Código interno"],
    ["nome","Material"],
    ["grupo","Grupo"],
    ["subgrupo1","Subgrupo 1"],
    ["subgrupo2","Subgrupo 2"],
    ["unidade","Unidade"],
    ["classificacao_fiscal","NCM"],
    ["ncm_ultima_entrada","NCM última entrada"],
    ["status_ncm","Comparação NCM"],
    ["ultima_nf_detalhe","Última NF / datas"],
    ["ipi","IPI (%)"],
    ["cean_i03","GTIN"],
    ["cbenef_i05f","Benefício fiscal"],
    ["cclass_trib_ibscbs","CBS / IBS"],
    ["u_revisado","Situação"]
  ];
  const BULK_MAX = 5000;

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }
  function value(obj, ...keys) {
    if (!obj || typeof obj !== "object") return undefined;
    for (const key of keys) if (Object.prototype.hasOwnProperty.call(obj, key)) return obj[key];
    const low = Object.fromEntries(Object.keys(obj).map((key) => [key.toLowerCase(), key]));
    for (const key of keys) if (low[key.toLowerCase()] !== undefined) return obj[low[key.toLowerCase()]];
    return undefined;
  }
  function text(v) { return v == null ? "" : String(v).trim(); }
  function number(v) {
    if (typeof v === "number") return v;
    const s = text(v);
    if (!s) return 0;
    const num = Number(s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s);
    return Number.isFinite(num) ? num : 0;
  }
  function normalized(s) { return text(s).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase(); }
  function formatEntryDate(raw) {
    const dateText = text(raw);
    const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateText);
    return iso ? iso[3] + "/" + iso[2] + "/" + iso[1] : dateText;
  }
  // Compara apenas NCMs informados. Aceita pontuação (84.74.90.00)
  // e eventuais zeros à esquerda perdidos ao importar números.
  function normalizeNcmCompare(raw) {
    const str = text(raw);
    if (!str || !/^[\d.\s-]+$/.test(str)) return "";
    const digits = str.replace(/\D/g, "");
    return digits && digits.length <= 8 ? digits.padStart(8, "0") : digits;
  }
  function hasNcmDivergence(row) {
    const ncmProduto = normalizeNcmCompare(row.classificacao_fiscal);
    const ncmEntrada = normalizeNcmCompare(row.ncm_ultima_entrada);
    // A NF possui NCM e o cadastro está vazio? Também é divergente.
    // Sem NCM na NF não existe valor seguro a ser copiado.
    return Boolean(ncmEntrada && ncmProduto !== ncmEntrada);
  }
  function ncmComparisonStatus(row) {
    const produto = normalizeNcmCompare(row.classificacao_fiscal);
    const entrada = normalizeNcmCompare(row.ncm_ultima_entrada);
    if (!entrada) return "Sem comparação";
    return produto === entrada ? "Igual" : "Diferente";
  }
  function isDone(row) { return number(row.u_revisado) === 1; }
  function formatNumber(v) { return new Intl.NumberFormat("pt-BR").format(v); }
  function formatIpi(v) { return v === null || v === undefined || text(v) === "" ? "—" : number(v).toLocaleString("pt-BR", { maximumFractionDigits: 4 }) + "%"; }
  function rowList(payload, label) {
    if (Array.isArray(payload)) return payload;
    for (const key of ["data", "dados", "itens", "items", "produtos", "materiais", "resultados", "rows", "result"]) {
      if (Array.isArray(payload && payload[key])) return payload[key];
      if (payload && payload[key] && Array.isArray(payload[key].rows)) return payload[key].rows;
    }
    throw new Error("O endpoint " + label + " não retornou uma lista reconhecida.");
  }
  function normalizeMaterial(row) {
    return {
      codigo: value(row, "codigo"),
      codigo_interno: text(value(row, "codigo_interno")),
      nome: text(value(row, "nome")),
      unidade: text(value(row, "unidade")),
      unidade_compra: text(value(row, "unidade_compra")),
      cod_classificacao_fiscal: value(row, "cod_classificacao_fiscal"),
      classificacao_fiscal: text(value(row, "ncm", "classificacao_fiscal")),
      descricao_classi_fiscal: text(value(row, "descricao_ncm", "descricao_classi_fiscal")),
      ipi: value(row, "IPI do NCM (%)", "ipi"),
      cean_i03: text(value(row, "GTIN", "cean_i03")),
      cbenef_i05f: text(value(row, "Cód. de Beneficio Fiscal na UF", "cbenef_i05f")),
      cclass_trib_ibscbs: text(value(row, "Cód. Da Classificação Tributária CBS/IBS", "cclass_trib_ibscbs")),
      desc_cclass_trib_ibscbs: text(value(row, "Descrição Da Classificação Tributária CBS/IBS", "desc_cclass_trib_ibscbs")),
      u_revisado: value(row, "u_revisado") ?? 0,
      grupo: text(value(row, "grupo")),
      subgrupo1: text(value(row, "subgrupo1")),
      subgrupo2: text(value(row, "subgrupo2")),
      // Campos informativos da última NF de entrada. Não participam das gravações.
      ncm_ultima_entrada: text(value(row, "ncm_ultima_entrada")),
      ultima_nf_entrada: text(value(row, "ultima_nf_entrada")),
      fornecedor_ultima_entrada: text(value(row, "fornecedor_ultima_entrada", "ultimo_fornecedor", "fornecedor_ultima_nf", "fornecedor")),
      dt_emissao_ultima_nf: text(value(row, "dt_emissao_ultima_nf")),
      dt_recebimento_ultima_nf: text(value(row, "dt_recebimento_ultima_nf")),
      // Agrupa NF e datas para a filtragem individual da coluna.
      ultima_nf_detalhe: [
        text(value(row, "ultima_nf_entrada")),
        text(value(row, "fornecedor_ultima_entrada", "ultimo_fornecedor", "fornecedor_ultima_nf", "fornecedor")),
        formatEntryDate(value(row, "dt_emissao_ultima_nf")),
        formatEntryDate(value(row, "dt_recebimento_ultima_nf"))
      ].filter(Boolean).join(" · ")
    };
  }
  function normalizeNcm(row) {
    return {
      codigo: value(row, "codigo"),
      numero: text(value(row, "numero")),
      descricao: text(value(row, "descricao")),
      ipi: value(row, "ipi")
    };
  }
  function normalizeCbs(row) {
    return {
      codigo: text(value(row, "codigo_cclastrib")),
      descricao: text(value(row, "descricao"))
    };
  }
  function authHeaders() {
    const t = localStorage.getItem(TOKEN_KEY);
    if (!t) throw new Error("Sessão encerrada. Entre novamente.");
    return { "Authorization": "Bearer " + t, "Accept": "application/json" };
  }
  // FastAPI retorna detail como texto nas regras de negocio e como lista
  // nas falhas de validacao (HTTP 422). Mostrar a causa exata ao usuario.
  function describeApiError(body, status) {
    const details = body && body.detail;
    if (typeof details === "string" && details.trim()) return details.trim();
    if (Array.isArray(details) && details.length) {
      const reasons = details.map((item) => {
        if (typeof item === "string") return item;
        if (!item || typeof item !== "object") return "";
        const path = Array.isArray(item.loc) ? item.loc.filter((p) => p !== "body").join(" → ") : "";
        return (path ? path + ": " : "") + (item.msg || item.message || "valor inválido");
      }).filter(Boolean);
      if (reasons.length) return "Erro de validação: " + reasons.slice(0, 4).join("; ");
    }
    if (body && typeof body.message === "string") return body.message;
    if (body && typeof body.erro === "string") return body.erro;
    return "A API retornou HTTP " + status + " sem descrever o motivo.";
  }
  async function apiFetch(url, options) {
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), 45000);
    try {
      const o = options || {};
      const headers = Object.assign({}, authHeaders(), o.headers || {});
      if (o.body) headers["Content-Type"] = "application/json";
      const res = await fetch(url, Object.assign({}, o, { headers, cache: "no-store", signal: timeout.signal }));
      const body = await res.json().catch(() => null);
      if (res.status === 401) {
        localStorage.removeItem(TOKEN_KEY);
        throw new Error("Sessão expirada. Faça login novamente.");
      }
      if (!res.ok) {
        const err = new Error(describeApiError(body, res.status));
        err.status = res.status;
        throw err;
      }
      return body;
    } catch (error) {
      if (error.name === "AbortError") throw new Error("Tempo limite da consulta excedido.");
      throw error;
    } finally { clearTimeout(timer); }
  }
  function setAccess(message, error) {
    $("accessStatus").textContent = message;
    $("accessStatus").classList.toggle("error-message", !!error);
    $("accessStatus").hidden = false;
  }
  async function verifyAccess() {
    if (!localStorage.getItem(TOKEN_KEY)) {
      window.location.replace("../login.html");
      return false;
    }
    try {
      const me = await apiFetch(BASE_PRODUCAO + "/portal/me");
      if (number(value(me, "u_analista_cadastro")) !== 1) {
        setAccess("Você não possui a permissão de Conferência de Revenda.", true);
        return false;
      }
      $("userName").textContent = text(value(me, "usuario")) || localStorage.getItem(USER_KEY) || "";
      $("accessStatus").hidden = true;
      $("app").hidden = false;
      return true;
    } catch (error) {
      setAccess("Não foi possível validar sua permissão: " + error.message, true);
      return false;
    }
  }
  function alertBox(id, msg) {
    $(id).textContent = msg || "";
    $(id).hidden = !msg;
  }
  function showToast(message, error) {
    const toast = $("toast");
    clearTimeout(state.toastTimer);
    toast.textContent = message;
    toast.classList.toggle("error", !!error);
    toast.hidden = false;
    state.toastTimer = setTimeout(() => { toast.hidden = true; }, 5000);
  }
  async function loadAll() {
    if (state.loading) return;
    state.loading = true;
    $("reload").disabled = true;
    alertBox("dataError", "");
    $("lastUpdate").textContent = "Consultando os materiais e as tabelas fiscais...";
    try {
      const results = await Promise.allSettled([
        apiFetch(API.materiais), apiFetch(API.ncm), apiFetch(API.cbs)
      ]);
      const [materialsResult, ncmResult, cbsResult] = results;
      if (materialsResult.status === "fulfilled") {
        state.materials = rowList(materialsResult.value, "Revenda").map(normalizeMaterial)
          .filter((r) => r.codigo !== undefined && r.codigo !== null);
        state.selected.clear();
      } else {
        alertBox("dataError", "Falha na consulta de materiais: " + materialsResult.reason.message);
      }
      if (ncmResult.status === "fulfilled" && cbsResult.status === "fulfilled") {
        state.ncm = rowList(ncmResult.value, "NCM").map(normalizeNcm).filter((r) => r.codigo !== null && r.codigo !== undefined);
        state.cbs = rowList(cbsResult.value, "CBS/IBS").map(normalizeCbs).filter((r) => r.codigo);
        state.referenceReady = true;
      } else {
        state.referenceReady = false;
        state.ncm = [];
        state.cbs = [];
        alertBox("dataError", [
          $("dataError").hidden ? "" : $("dataError").textContent,
          "Tabelas de referência indisponíveis. A edição fica bloqueada até que NCM e CBS/IBS estejam acessíveis."
        ].filter(Boolean).join(" "));
      }
      $("lastUpdate").textContent = "Última consulta: " + new Date().toLocaleString("pt-BR");
      state.page = 1;
      render();
    } catch (error) {
      alertBox("dataError", error.message);
      $("lastUpdate").textContent = "Erro ao carregar";
    } finally {
      state.loading = false;
      $("reload").disabled = false;
    }
  }
  function columnValue(row, key) {
    if (key === "u_revisado") return isDone(row) ? "Revisado" : "Pendente";
    if (key === "status_ncm") return ncmComparisonStatus(row);
    return text(row[key]) || "(Vazio)";
  }
  function matchesGlobal(row) {
    if (state.status === "pending" && isDone(row)) return false;
    if (state.status === "done" && !isDone(row)) return false;
    if (state.ncmCompareFilter !== "all") {
      const status = ncmComparisonStatus(row);
      if (state.ncmCompareFilter === "equal" && status !== "Igual") return false;
      if (state.ncmCompareFilter === "different" && status !== "Diferente") return false;
      if (state.ncmCompareFilter === "missing" && status !== "Sem comparação") return false;
    }
    const q = normalized(state.query);
    if (!q) return true;
    return normalized([
      row.codigo, row.codigo_interno, row.nome, row.grupo, row.subgrupo1,
      row.subgrupo2, row.classificacao_fiscal, row.descricao_classi_fiscal,
      row.ncm_ultima_entrada, row.ultima_nf_entrada, row.fornecedor_ultima_entrada,
      row.dt_emissao_ultima_nf, row.dt_recebimento_ultima_nf, row.ultima_nf_detalhe,
      row.cean_i03, row.cbenef_i05f, row.cclass_trib_ibscbs,
      row.desc_cclass_trib_ibscbs
    ].join(" ")).includes(q);
  }
  function matchesColumns(row, except) {
    return Object.entries(state.columnFilters).every(([key, items]) =>
      key === except || !(items && items.size) || items.has(columnValue(row, key)));
  }
  function filtered() {
    const rows = state.materials.filter((r) => matchesGlobal(r) && matchesColumns(r));
    return rows.sort((a,b) => {
      const av = columnValue(a,state.sort), bv = columnValue(b,state.sort);
      if (state.sort === "u_revisado" || state.sort === "codigo" || state.sort === "ipi") {
        return (number(av)-number(bv))*state.direction;
      }
      return String(av ?? "").localeCompare(String(bv ?? ""), "pt-BR", {numeric:true,sensitivity:"base"})*state.direction;
    });
  }
  function pageRows(rows) {
    const start=(state.page-1)*state.pageSize;
    return rows.slice(start,start+state.pageSize);
  }
  function cell(v) { return escapeHtml(text(v) || "—"); }
  function tableCell(row,key) {
    if (key==="codigo_interno") return '<div class="item-code">'+cell(row.codigo_interno||row.codigo)+'</div><div class="item-sub">ID '+cell(row.codigo)+'</div>';
    if (key==="nome") return '<div class="item-name">'+cell(row.nome)+'</div>';
    if (key==="ncm_ultima_entrada") {
      const informacoes=[];
      if(row.ultima_nf_entrada) informacoes.push("NF "+row.ultima_nf_entrada);
      const data=row.dt_recebimento_ultima_nf||row.dt_emissao_ultima_nf;
      if(data) informacoes.push("Data "+formatEntryDate(data));
      const divergence = hasNcmDivergence(row);
      const title = divergence
        ? "NCM divergente do cadastro: "+(row.classificacao_fiscal||"não informado")+
          " × "+row.ncm_ultima_entrada+". "+informacoes.join(" · ")
        : (informacoes.join(" · ")||"Última NF de entrada · somente consulta");
      return '<div class="single-line ncm-entry-cell'+(divergence?' ncm-divergente':'')+'" title="'+
        escapeHtml(title)+'">'+cell(row.ncm_ultima_entrada)+'</div>';
    }
    if (key==="ultima_nf_detalhe") {
      if (!row.ultima_nf_entrada && !row.dt_recebimento_ultima_nf && !row.dt_emissao_ultima_nf && !row.fornecedor_ultima_entrada)
        return '<span class="nf-sem-dados">Sem entrada</span>';
      const nr = row.ultima_nf_entrada ? 'NF '+escapeHtml(row.ultima_nf_entrada) : 'NF não informada';
      const emissao = row.dt_emissao_ultima_nf ? 'Emissão: '+escapeHtml(formatEntryDate(row.dt_emissao_ultima_nf)) : '';
      const recebimento = row.dt_recebimento_ultima_nf ? 'Entrada: '+escapeHtml(formatEntryDate(row.dt_recebimento_ultima_nf)) : '';
      const fornecedor = row.fornecedor_ultima_entrada ? escapeHtml(row.fornecedor_ultima_entrada) : "";
      return '<div class="nf-ultima-cell" title="Dados da última nota fiscal de entrada · somente consulta">'+
        '<strong>'+nr+'</strong>'+
        '<span class="nf-fornecedor" title="'+(fornecedor||'Não informado')+'">Fornecedor: '+(fornecedor||'Não informado')+'</span>'+
        (emissao?'<small>'+emissao+'</small>':'')+
        (recebimento?'<small>'+recebimento+'</small>':'')+
        '</div>';
    }
    if (key==="status_ncm") {
      const compare=ncmComparisonStatus(row);
      const kind=compare==="Igual"?"ncm-igual":compare==="Diferente"?"ncm-diferente":"ncm-indefinido";
      return '<span class="ncm-comparison '+kind+'">'+escapeHtml(compare)+'</span>';
    }
    if (key==="ipi") return escapeHtml(formatIpi(row.ipi));
    if (key==="u_revisado") return '<span class="status '+(isDone(row)?"done":"pending")+'">'+(isDone(row)?"Revisado":"Pendente")+'</span>';
    let title="";
    if (key==="classificacao_fiscal") title=row.descricao_classi_fiscal;
    if (key==="cclass_trib_ibscbs") title=row.desc_cclass_trib_ibscbs;
    return '<div class="single-line" title="'+escapeHtml(title||row[key]||"")+'">'+cell(row[key])+'</div>';
  }
  function filterIcon() {
    return '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M7 12h10m-7 5h4"/></svg>';
  }
  function initHeaders() {
    const head=$("materialHead");
    head.innerHTML='<tr><th class="check-col"><input id="pageSelectToggle" class="head-check" type="checkbox" title="Selecionar/desmarcar materiais desta página" aria-label="Selecionar materiais desta página"></th>'+
      COLS.map(([key,label])=>'<th class="fiscal-column"><div class="th-layout">'+
        '<button type="button" class="th-sort" data-sort="'+key+'" title="Ordenar '+escapeHtml(label)+'">'+escapeHtml(label)+' <span class="sort-glyph">↕</span></button>'+
        '<button type="button" class="th-filter" data-filter-open="'+key+'" title="Filtrar '+escapeHtml(label)+'" aria-label="Filtrar '+escapeHtml(label)+'">'+filterIcon()+'</button>'+
        '</div></th>').join("")+
      '<th>Ação</th></tr>';
  }
  function render() {
    const all=state.materials.length;
    const reviewed=state.materials.filter(isDone).length;
    const percent=all?Math.round(100*reviewed/all):0;
    $("kTotal").textContent=formatNumber(all);
    $("kPending").textContent=formatNumber(all-reviewed);
    $("kDone").textContent=formatNumber(reviewed);
    $("kRate").textContent=percent+"%";
    $("progressBar").style.width=percent+"%";
    const rows=filtered();
    $("showingCount").textContent=formatNumber(rows.length)+" registros";
    const pageCount=Math.max(1,Math.ceil(rows.length/state.pageSize));
    state.page=Math.max(1,Math.min(state.page,pageCount));
    const start=(state.page-1)*state.pageSize, items=pageRows(rows);
    $("rows").innerHTML=items.length?items.map((row)=>
      '<tr><td class="check-col"><input type="checkbox" class="row-check" data-select-id="'+escapeHtml(row.codigo)+'" aria-label="Selecionar '+escapeHtml(row.codigo_interno||row.codigo)+'" '+(state.selected.has(String(row.codigo))?"checked":"")+'></td>'+
      COLS.map(([key])=>'<td'+(key==="ncm_ultima_entrada" && hasNcmDivergence(row) ? ' class="ncm-td-divergente"' : '')+'>'+tableCell(row,key)+'</td>').join("")+
      '<td><button type="button" class="table-action" data-id="'+escapeHtml(row.codigo)+'">'+(isDone(row)?"Reabrir":"Conferir")+'</button></td></tr>'
    ).join(""):'<tr><td colspan="'+(COLS.length+2)+'" class="empty">Nenhum material encontrado para estes filtros.</td></tr>';
    $("pageInfo").textContent=rows.length?formatNumber(start+1)+" a "+formatNumber(start+items.length)+" de "+formatNumber(rows.length):"Nenhum registro";
    $("previous").disabled=state.page<=1;
    $("next").disabled=state.page>=pageCount;
    const pageCheck=$("pageSelectToggle"), numSelected=items.filter((x)=>state.selected.has(String(x.codigo))).length;
    pageCheck.checked=items.length>0&&numSelected===items.length;
    pageCheck.indeterminate=numSelected>0&&numSelected<items.length;
    $("selectedCount").textContent=formatNumber(state.selected.size)+" materiais selecionados";
    $("openBulk").disabled=!state.selected.size||!state.referenceReady||state.selected.size>BULK_MAX;
    $("openBulk").title=state.selected.size>BULK_MAX?"Máximo de "+BULK_MAX+" materiais por lote":"";
    // Apenas registros MARCADOS, ainda visíveis nos filtros e com NCM divergente.
    const syncRows = rows.filter((row) =>
      state.selected.has(String(row.codigo)) && hasNcmDivergence(row));
    const selectedFiltered = rows.filter((row) =>
      state.selected.has(String(row.codigo))).length;
    $("syncNcmCount").textContent =
      formatNumber(syncRows.length)+" selecionado(s) divergente(s) de "+
      formatNumber(selectedFiltered)+" selecionado(s) nos filtros ("+
      formatNumber(rows.length)+" material(is) filtrado(s))";
    $("syncLastNcm").disabled = syncRows.length===0 || syncRows.length>BULK_MAX ||
      state.loading || state.syncInFlight;
    $("syncLastNcm").title = syncRows.length>BULK_MAX
      ? "Selecione no máximo "+BULK_MAX+" materiais divergentes por operação." : "";
    document.querySelectorAll("[data-filter-open]").forEach((button)=>{
      const selected=state.columnFilters[button.dataset.filterOpen];
      const active=selected instanceof Set;
      button.classList.toggle("active",active);
      button.title=active?"Filtro ativo: "+selected.size+" opções. Clique para alterar.":"Filtrar esta coluna";
    });
  }
  function availableColumnValues(key) {
    const counts=new Map();
    state.materials.forEach((row)=>{
      if (!matchesGlobal(row)||!matchesColumns(row,key)) return;
      const v=columnValue(row,key);
      counts.set(v,(counts.get(v)||0)+1);
    });
    const selected=state.columnFilters[key]||new Set();
    selected.forEach((val)=>{if(!counts.has(val))counts.set(val,0)});
    return [...counts].sort((a,b)=>a[0].localeCompare(b[0],"pt-BR",{numeric:true,sensitivity:"base"}));
  }
  function positionFilter(anchor) {
    const pop=$("filterPopover"), rect=anchor.getBoundingClientRect();
    const w=Math.min(306,window.innerWidth-16), h=Math.min(420,window.innerHeight*.78);
    pop.style.left=Math.max(8,Math.min(rect.left,window.innerWidth-w-8))+"px";
    pop.style.top=(rect.bottom+8+h>window.innerHeight?Math.max(8,rect.top-h-8):rect.bottom+8)+"px";
  }
  function openColumnFilter(key,anchor) {
    state.openFilter=key;
    state.filterDraft=state.columnFilters[key] instanceof Set ? new Set(state.columnFilters[key]) : null;
    $("filterPopoverTitle").textContent=(COLS.find((x)=>x[0]===key)||[])[1]||"Coluna";
    $("filterOptionSearch").value="";
    $("filterPopover").hidden=false;
    positionFilter(anchor);
    renderColumnOptions();
    $("filterOptionSearch").focus();
  }
  function closeColumnFilter() {
    state.openFilter=null;
    state.filterDraft=null;
    $("filterPopover").hidden=true;
  }
  function matchingColumnValues() {
    if (!state.openFilter)return [];
    const q=normalized($("filterOptionSearch").value);
    return availableColumnValues(state.openFilter).filter(([v])=>!q||normalized(v).includes(q));
  }
  function renderColumnOptions() {
    const key=state.openFilter;if(!key)return;
    const entries=matchingColumnValues(), shown=entries.slice(0,350);
    const draft=state.filterDraft;
    $("filterOptionList").innerHTML=shown.length?shown.map(([v,count])=>
      '<label class="filter-option"><input type="checkbox" data-filter-value="'+escapeHtml(v)+'" '+(draft===null||draft.has(v)?"checked":"")+'><span class="option-text">'+escapeHtml(v)+'</span><span class="option-qty">'+count+'</span></label>'
    ).join(""):'<div class="lookup-empty">Nenhuma opção encontrada</div>';
    if(entries.length>350)$("filterOptionList").insertAdjacentHTML("beforeend",
      '<div class="lookup-empty">Exibindo 350 de '+formatNumber(entries.length)+'. Digite para refinar.</div>');
    const chosen=entries.filter(([value])=>draft===null||draft.has(value)).length;
    $("filterOptionInfo").textContent=chosen+" de "+formatNumber(entries.length)+" selecionados";
    $("filterPickVisible").textContent=entries.length&&chosen===entries.length?"Desmarcar tudo":"Selecionar tudo";
  }
  function applyColumnFilter() {
    const key=state.openFilter;if(!key)return;
    const draft=state.filterDraft;
    if(draft!==null&&draft.size===0){
      showToast("Selecione pelo menos uma opção ou use Limpar filtro.",true);return;
    }
    const universe=availableColumnValues(key);
    if(draft===null||draft.size===universe.length)delete state.columnFilters[key];
    else state.columnFilters[key]=new Set(draft);
    state.page=1;
    closeColumnFilter();
    render();
  }
  function selectPage(checked) {
    pageRows(filtered()).forEach((row)=>{
      if(checked)state.selected.add(String(row.codigo));
      else state.selected.delete(String(row.codigo));
    });render();
  }
  function ncmLabel(ncm) { return ncm.numero + " · " + ncm.descricao; }
  function cbsLabel(cbs) { return cbs.codigo + " · " + cbs.descricao; }
  function setNcm(ncm) {
    state.selectedNcm = ncm;
    $("ncmSearch").value = ncm ? ncmLabel(ncm) : "";
    $("ncmId").value = ncm ? text(ncm.codigo) : "";
    $("ncmNumber").value = ncm ? ncm.numero : "";
    $("ncmDescription").value = ncm ? ncm.descricao : "";
    $("ncmIpi").value = ncm ? text(ncm.ipi) : "";
    $("ncmResults").hidden = true;
  }
  function setCbs(cbs) {
    state.selectedCbs = cbs;
    $("cbsSearch").value = cbs ? cbsLabel(cbs) : "";
    $("cbsCode").value = cbs ? cbs.codigo : "";
    $("cbsDescription").value = cbs ? cbs.descricao : "";
    $("cbsResults").hidden = true;
  }
  function openEditor(material) {
    if (!state.referenceReady) return showToast("As tabelas de referência ainda não estão disponíveis.", true);
    state.material = material;
    state.selectedNcm = state.ncm.find((n) => String(n.codigo) === text(material.cod_classificacao_fiscal)) ||
      state.ncm.find((n) => n.numero === material.classificacao_fiscal) || null;
    state.selectedCbs = state.cbs.find((n) => n.codigo === material.cclass_trib_ibscbs) || null;
    $("editTitle").textContent = material.nome || "Material " + material.codigo;
    $("editSubtitle").textContent = "Código interno: " + (material.codigo_interno || "—") + " · ID " + material.codigo;
    setNcm(state.selectedNcm);
    setCbs(state.selectedCbs);
    if (!state.selectedNcm && material.classificacao_fiscal) {
      $("ncmSearch").value = material.classificacao_fiscal + " (não encontrado na tabela NCM)";
      $("ncmId").value = text(material.cod_classificacao_fiscal);
      $("ncmNumber").value = material.classificacao_fiscal;
      $("ncmDescription").value = material.descricao_classi_fiscal;
      $("ncmIpi").value = text(material.ipi);
    }
    if (!state.selectedCbs && material.cclass_trib_ibscbs) {
      $("cbsSearch").value = material.cclass_trib_ibscbs + " (não encontrado na tabela CBS/IBS)";
      $("cbsCode").value = material.cclass_trib_ibscbs;
      $("cbsDescription").value = material.desc_cclass_trib_ibscbs;
    }
    $("lastEntryNcm").value = material.ncm_ultima_entrada || "Não informado";
    const dadosUltimaEntrada = [];
    if (material.ultima_nf_entrada) dadosUltimaEntrada.push("NF " + material.ultima_nf_entrada);
    if (material.fornecedor_ultima_entrada) dadosUltimaEntrada.push("Fornecedor: " + material.fornecedor_ultima_entrada);
    const dataUltimaEntrada = material.dt_recebimento_ultima_nf || material.dt_emissao_ultima_nf;
    if (dataUltimaEntrada) dadosUltimaEntrada.push("Data " + formatEntryDate(dataUltimaEntrada));
    $("lastEntryInfo").textContent = [
      ...dadosUltimaEntrada,
      "Somente consulta: não altera o cadastro."
    ].join(" · ");
    $("gtin").value = material.cean_i03;
    $("benefit").value = material.cbenef_i05f;
    $("reviewCurrent").textContent = isDone(material) ? "Material já revisado" : "Pendente de revisão";
    $("editBadge").textContent = isDone(material) ? "Revisado" : "Pendente";
    $("editBadge").classList.toggle("done", isDone(material));
    alertBox("saveError", "");
    $("overlay").hidden = false;
    document.body.style.overflow = "hidden";
    $("closeEditor").focus();
  }
  function closeEditor() {
    if (state.inFlight) return;
    $("overlay").hidden = true;
    $("ncmResults").hidden = true;
    $("cbsResults").hidden = true;
    state.material = null;
    document.body.style.overflow = "";
  }
  function renderLookup(type) {
    const isNcm = type === "ncm";
    const input = $(isNcm ? "ncmSearch" : "cbsSearch");
    const list = $(isNcm ? "ncmResults" : "cbsResults");
    const q = normalized(input.value);
    const candidates = isNcm ? state.ncm : state.cbs;
    let matches = [];
    if (q) matches = candidates.filter((x) => normalized(isNcm ? x.numero + " " + x.descricao : x.codigo + " " + x.descricao).includes(q)).slice(0, 35);
    list.innerHTML = matches.length ? matches.map((row) => {
      const id = isNcm ? text(row.codigo) : row.codigo;
      return '<button type="button" role="option" class="lookup-item" data-code="' + escapeHtml(id) + '">' +
        '<strong>' + escapeHtml(isNcm ? row.numero : row.codigo) + '</strong>' +
        '<span>' + escapeHtml(row.descricao) + (isNcm ? " · IPI " + escapeHtml(formatIpi(row.ipi)) : "") + '</span></button>';
    }).join("") : '<div class="lookup-empty">' + (q ? "Nenhum código encontrado." : "Digite para pesquisar.") + '</div>';
    list.hidden = false;
  }
  function captureExpected(material) {
    return {
      cod_classificacao_fiscal: material.cod_classificacao_fiscal,
      classificacao_fiscal: material.classificacao_fiscal,
      descricao_classi_fiscal: material.descricao_classi_fiscal,
      ipi: material.ipi,
      cean_i03: material.cean_i03,
      cbenef_i05f: material.cbenef_i05f,
      cclass_trib_ibscbs: material.cclass_trib_ibscbs,
      desc_cclass_trib_ibscbs: material.desc_cclass_trib_ibscbs,
      u_revisado: material.u_revisado
    };
  }
  function buttonsDisabled(disabled) {
    ["saveReviewed", "saveOnly", "cancelEdit", "closeEditor"].forEach((id) => { $(id).disabled = disabled; });
  }
  async function save(revised) {
    if (state.inFlight || !state.material) return;
    if (!state.selectedNcm) { alertBox("saveError", "Selecione um NCM válido na lista do CPS."); $("ncmSearch").focus(); return; }
    if ($("cbsSearch").value.trim() && !state.selectedCbs) {
      alertBox("saveError", "Selecione uma classificação CBS/IBS válida ou clique em Limpar classificação.");
      $("cbsSearch").focus(); return;
    }
    const gtin = $("gtin").value.trim();
    const payload = {
      codigo: Number(state.material.codigo),
      ncm_codigo: text(state.selectedNcm.codigo),
      cbs_codigo: state.selectedCbs ? state.selectedCbs.codigo : null,
      cean_i03: gtin,
      cbenef_i05f: $("benefit").value.trim(),
      revisado: !!revised,
      esperado: captureExpected(state.material)
    };
    if (!Number.isSafeInteger(payload.codigo) || payload.codigo <= 0) { alertBox("saveError", "Código de material inválido."); return; }
    if (!payload.ncm_codigo || payload.ncm_codigo.length > 64) { alertBox("saveError", "Código interno de NCM inválido."); return; }
    state.inFlight = true;
    buttonsDisabled(true);
    alertBox("saveError", "");
    const currentButton = revised ? $("saveReviewed") : $("saveOnly");
    const oldText = currentButton.textContent;
    currentButton.textContent = "Salvando...";
    try {
      const response = await apiFetch(API.salvar, { method: "POST", body: JSON.stringify(payload) });
      if (!response || response.ok === false) throw new Error("Não foi possível confirmar a gravação no CPS.");
      closeAfterSave();
      await loadAll();
      showToast("Material atualizado no CPS e " + (revised ? "marcado como revisado." : "mantido pendente."));
    } catch (error) {
      let message = error.message;
      if (error.status === 404 || error.status === 405) message =
        "A consulta já está pronta, mas o servidor ainda não disponibilizou POST /revenda/atualizar. A gravação não foi realizada.";
      if (error.status === 409) message += " Atualize a consulta antes de tentar novamente.";
      alertBox("saveError", message);
      showToast("Material não foi gravado.", true);
    } finally {
      currentButton.textContent = oldText;
      state.inFlight = false;
      buttonsDisabled(false);
    }
  }
  function closeAfterSave() {
    $("overlay").hidden = true;
    $("ncmResults").hidden = true;
    $("cbsResults").hidden = true;
    state.material = null;
    document.body.style.overflow = "";
  }
  // O lote considera a INTERSEÇÃO entre linhas marcadas, filtros atuais e divergência.
  // Nunca inclui linhas apenas filtradas que não foram selecionadas pelo usuário.
  function syncCandidates() {
    return filtered().filter((row) =>
      state.selected.has(String(row.codigo)) && hasNcmDivergence(row));
  }
  function closeSyncModal() {
    if(state.syncInFlight)return;
    $("syncOverlay").hidden=true;
    $("syncPhraseInput").value="";
    $("syncConfirm").disabled=true;
    state.syncPending=null;
    document.body.style.overflow="";
  }
  function openSyncLastNcm() {
    if(state.syncInFlight || state.loading)return;
    const visible=filtered();
    const candidates=syncCandidates();
    if(!candidates.length)
      return showToast("Selecione pelo menos um material divergente nos filtros atuais.",true);
    if(candidates.length>BULK_MAX)
      return showToast("Selecione no máximo "+BULK_MAX+" materiais divergentes.",true);
    const count=candidates.length;
    if(!window.confirm(
      "TEM CERTEZA????\n\n"+
      "Você vai corrigir o NCM de SOMENTE "+formatNumber(count)+
      " material(is) MARCADO(S) E DIVERGENTE(S).\n"+
      "Existem "+formatNumber(visible.length)+" materiais filtrados, mas os não selecionados NÃO serão alterados.\n\n"+
      "O NCM, código fiscal, descrição e IPI serão substituídos pelos dados"+
      " correspondentes à última NF de entrada.\n"+
      "Nenhum material sem check marcado será enviado para atualização."
    ))return;
    // Congela a lista e os valores vistos no momento da primeira confirmação.
    // O servidor conferirá novamente a última NF e o cadastro de cada item.
    state.syncPending=candidates.map((row)=>({
      codigo:Number(row.codigo),
      ncm_cadastrado:row.classificacao_fiscal,
      ncm_ultima_entrada:row.ncm_ultima_entrada
    }));
    $("syncSummary").textContent =
      "Apenas "+formatNumber(count)+" material(is) MARCADO(S) e divergente(s) serão alterados,"+
      " entre "+formatNumber(visible.length)+" materiais filtrados. "+
      "Itens desmarcados NÃO serão alterados. CBS/IBS, GTIN, benefício fiscal e revisão serão preservados.";
    $("syncPhraseInput").value="";
    $("syncConfirm").disabled=true;
    $("syncError").textContent="";
    $("syncError").hidden=true;
    $("syncOverlay").hidden=false;
    document.body.style.overflow="hidden";
    $("syncPhraseInput").focus();
  }
  async function confirmSyncLastNcm(event) {
    event.preventDefault();
    if(state.syncInFlight || !state.syncPending)return;
    if($("syncPhraseInput").value!=="SIM, TENHO CERTEZA"){
      alertBox("syncError","Digite exatamente SIM, TENHO CERTEZA, sem copiar e colar.");
      return;
    }
    const items=state.syncPending.slice();
    if(!items.length || items.length>BULK_MAX)return;
    state.syncInFlight=true;
    const controls=["syncConfirm","syncCancel","syncClose"];
    controls.forEach((id)=>$(id).disabled=true);
    $("syncPhraseInput").disabled=true;
    alertBox("syncError","");
    const button=$("syncConfirm"),old=button.textContent;
    button.textContent="Corrigindo "+formatNumber(items.length)+" materiais...";
    try {
      const response=await apiFetch(API.sincronizarNcm,{
        method:"POST",
        body:JSON.stringify({itens:items})
      });
      if(!response || response.ok!==true || Number(response.quantidade)!==items.length)
        throw new Error("A API não confirmou todas as alterações. Confira os dados antes de repetir.");
      state.syncInFlight=false;
      closeSyncModal();
      await loadAll();
      showToast(formatNumber(items.length)+" NCMs corrigidos conforme a última NF de entrada.");
    } catch(error) {
      let msg=error.message;
      if(error.status===404 || error.status===405)
        msg="O servidor ainda não possui a rota POST /revenda/sincronizar-ncm-ultima-entrada. "+
          "É necessário instalar a API Python atualizada.";
      if(error.status===409)
        msg+=" A correção foi cancelada. Recarregue o portal e confira novamente.";
      alertBox("syncError",msg);
      showToast("A correção do NCM não foi confirmada.",true);
    } finally {
      state.syncInFlight=false;
      $("syncPhraseInput").disabled=false;
      button.textContent=old;
      controls.forEach((id)=>$(id).disabled=false);
      $("syncConfirm").disabled=$("syncPhraseInput").value!=="SIM, TENHO CERTEZA";
    }
  }
  function bindSyncLastNcm() {
    $("syncLastNcm").addEventListener("click",openSyncLastNcm);
    $("syncClose").addEventListener("click",closeSyncModal);
    $("syncCancel").addEventListener("click",closeSyncModal);
    $("syncOverlay").addEventListener("mousedown",(event)=>{
      if(event.target===$("syncOverlay"))closeSyncModal();
    });
    $("syncForm").addEventListener("submit",confirmSyncLastNcm);
    const field=$("syncPhraseInput"), phrase=$("syncPhraseText");
    // Evita colar, arrastar, atalhos e preenchimento automático no campo.
    ["paste","drop"].forEach((name)=>field.addEventListener(name,(event)=>event.preventDefault()));
    field.addEventListener("beforeinput",(event)=>{
      if(["insertFromPaste","insertFromDrop","insertReplacementText","insertFromYank"].includes(event.inputType))
        event.preventDefault();
    });
    field.addEventListener("keydown",(event)=>{
      if((event.ctrlKey||event.metaKey)&&["v","c","x"].includes(event.key.toLowerCase()))
        event.preventDefault();
    });
    field.addEventListener("input",()=>{
      $("syncConfirm").disabled=field.value!=="SIM, TENHO CERTEZA";
      alertBox("syncError","");
    });
    // O texto da confirmação não pode ser selecionado ou copiado na janela.
    ["copy","cut","dragstart","contextmenu"].forEach((name)=>
      phrase.addEventListener(name,(event)=>event.preventDefault()));
    $("syncOverlay").addEventListener("copy",(event)=>event.preventDefault());
    document.addEventListener("keydown",(event)=>{
      if(event.key==="Escape"&&!$("syncOverlay").hidden)closeSyncModal();
    });
  }

  function selectedMaterials() {
    return state.materials.filter((row)=>state.selected.has(String(row.codigo)));
  }
  function toggleBulkField(key,enabled) {
    const id={
      ncm_codigo:"bulkNcmSearch", cbs_codigo:"bulkCbsSearch",
      cean_i03:"bulkGtin",cbenef_i05f:"bulkBenefit",revisado:"bulkReviewed"
    }[key];
    if(id)$(id).disabled=!enabled;
    if(key==="cbs_codigo")$("bulkClearCbs").disabled=!enabled;
  }
  function closeBulk() {
    if(state.bulkInFlight)return;
    $("bulkOverlay").hidden=true;
    $("bulkNcmResults").hidden=true;
    $("bulkCbsResults").hidden=true;
    document.body.style.overflow="";
  }
  function openBulk() {
    const rows=selectedMaterials();
    if(!rows.length)return showToast("Selecione materiais para editar.",true);
    if(rows.length>BULK_MAX)return showToast("Limite de "+BULK_MAX+" itens. Refine o filtro.",true);
    if(!state.referenceReady)return showToast("Catálogos fiscais indisponíveis.",true);
    state.bulkNcm=null;state.bulkCbs=null;
    document.querySelectorAll("[data-bulk-check]").forEach((ch)=>{
      ch.checked=false;toggleBulkField(ch.dataset.bulkCheck,false);
    });
    ["bulkNcmSearch","bulkCbsSearch","bulkGtin","bulkBenefit"].forEach((id)=>$(id).value="");
    $("bulkReviewed").value="1";
    $("bulkNcmPicked").textContent="Selecione um código da tabela CPS.";
    $("bulkCbsPicked").textContent="Selecione um código ou limpe a classificação.";
    $("bulkSubtitle").textContent=formatNumber(rows.length)+" materiais selecionados. Campos não marcados não serão alterados.";
    alertBox("bulkError","");
    alertBox("bulkFooterError","");
    $("bulkOverlay").hidden=false;
    document.body.style.overflow="hidden";
    $("closeBulk").focus();
  }
  function setBulkNcm(value) {
    state.bulkNcm=value;
    $("bulkNcmSearch").value=value?ncmLabel(value):"";
    $("bulkNcmPicked").textContent=value?"IPI do NCM: "+formatIpi(value.ipi):"Selecione um NCM da lista.";
    $("bulkNcmResults").hidden=true;
  }
  function setBulkCbs(value) {
    state.bulkCbs=value;
    $("bulkCbsSearch").value=value?cbsLabel(value):"";
    $("bulkCbsPicked").textContent=value?"Selecionado: "+value.codigo:"A classificação será limpa se este campo estiver marcado.";
    $("bulkCbsResults").hidden=true;
  }
  function renderBulkLookup(type) {
    const isNcm=type==="ncm";
    const input=$(isNcm?"bulkNcmSearch":"bulkCbsSearch");
    const list=$(isNcm?"bulkNcmResults":"bulkCbsResults");
    const query=normalized(input.value);
    const options=isNcm?state.ncm:state.cbs;
    const filtered=query?options.filter((row)=>normalized((isNcm?row.numero:row.codigo)+" "+row.descricao).includes(query)).slice(0,50):[];
    list.innerHTML=filtered.length?filtered.map((row)=>{
      const id=isNcm?text(row.codigo):row.codigo;
      return '<button type="button" role="option" class="lookup-item" data-code="'+escapeHtml(id)+'">'+
        '<strong>'+escapeHtml(isNcm?row.numero:row.codigo)+'</strong>'+
        '<span>'+escapeHtml(row.descricao)+(isNcm?' · IPI '+escapeHtml(formatIpi(row.ipi)):"")+'</span></button>';
    }).join(""):'<div class="lookup-empty">'+(query?"Nenhum código encontrado.":"Digite para pesquisar.")+'</div>';
    list.hidden=false;
  }
  function bulkPayload() {
    const changes={};
    const checked=new Set([...document.querySelectorAll("[data-bulk-check]:checked")].map((el)=>el.dataset.bulkCheck));
    if(!checked.size)throw new Error("Marque pelo menos um campo para alterar.");
    if(checked.has("ncm_codigo")) {
      if(!state.bulkNcm)throw new Error("Selecione um NCM válido na lista CPS.");
      const ncmIdText=text(state.bulkNcm.codigo);
      if(!ncmIdText || ncmIdText.length>64)
        throw new Error("O NCM escolhido não possui código interno válido no CPS.");
      // Preservar o codigo CPS exatamente como recebido. Number() remove zeros
      // a esquerda e pode invalidar identificadores armazenados como texto.
      changes.ncm_codigo=ncmIdText;
    }
    if(checked.has("cbs_codigo")) {
      if($("bulkCbsSearch").value.trim()&&!state.bulkCbs)throw new Error("Selecione a classificação CBS/IBS ou limpe o campo.");
      changes.cbs_codigo=state.bulkCbs?state.bulkCbs.codigo:"";
    }
    if(checked.has("cean_i03"))changes.cean_i03=$("bulkGtin").value.trim();
    if(checked.has("cbenef_i05f"))changes.cbenef_i05f=$("bulkBenefit").value.trim();
    if(checked.has("revisado"))changes.revisado=$("bulkReviewed").value==="1";
    const selected=selectedMaterials();
    if(!selected.length)throw new Error("Nenhum material selecionado.");
    if(selected.length>BULK_MAX)throw new Error("Máximo de "+BULK_MAX+" materiais por lote.");
    const itens=selected.map((row)=>{
      const codigo=Number(row.codigo);
      if(!Number.isSafeInteger(codigo)||codigo<=0)
        throw new Error("Material com código inválido: "+(row.codigo_interno||row.nome));
      return {codigo,esperado:captureExpected(row)};
    });
    return {itens,alteracoes:changes};
  }

  function showBulkError(message) {
    alertBox("bulkError",message);
    alertBox("bulkFooterError",message);
  }
  async function submitBulk(event) {
    event.preventDefault();
    if(state.bulkInFlight)return;
    let payload;
    try{payload=bulkPayload()}catch(error){showBulkError(error.message);return}
    const count=payload.itens.length,fields=Object.keys(payload.alteracoes);
    if(!window.confirm("Aplicar "+fields.length+" campo(s) em "+count+" material(is)?\nOs campos marcados substituirão os valores atuais no CPS, mesmo que o cadastro tenha sido alterado após a consulta. Campos não marcados serão preservados."))return;
    state.bulkInFlight=true;
    showBulkError("");
    ["applyBulk","cancelBulk","closeBulk"].forEach((id)=>$(id).disabled=true);
    const button=$("applyBulk"),old=button.textContent;
    button.textContent="Gravando "+formatNumber(count)+" materiais...";
    try {
      const response=await apiFetch(API.salvarLote,{method:"POST",body:JSON.stringify(payload)});
      if(!response||response.ok!==true||number(response.quantidade)!==count)
        throw new Error("O servidor não confirmou a quantidade completa. Verifique os dados antes de repetir.");
      state.bulkInFlight=false;closeBulk();
      state.selected.clear();
      await loadAll();
      showToast(formatNumber(count)+" materiais atualizados no CPS.");
    } catch(error) {
      let msg=error.message;
      if(error.status===404||error.status===405)msg="A API ainda não possui POST /revenda/atualizar-lote. Nenhum material foi alterado.";
      if(error.status===409)msg+=" O lote inteiro foi cancelado para evitar sobrescrever alterações de outros usuários.";
      showBulkError("Gravação não concluída (HTTP "+(error.status||"falha")+"): "+msg);
      showToast("Falha na atualização. Veja o motivo abaixo.",true);
    } finally {
      state.bulkInFlight=false;
      button.textContent=old;
      ["applyBulk","cancelBulk","closeBulk"].forEach((id)=>$(id).disabled=false);
    }
  }
  function bind() {
    $("reload").addEventListener("click", loadAll);
    $("search").addEventListener("input", (event) => {
      clearTimeout(state.searchTimer);
      const query=event.target.value;
      state.searchTimer=setTimeout(()=>{state.query=query;state.page=1;render();},140);
    });
    $("statusFilter").addEventListener("change", (event) => { state.status = event.target.value; state.page = 1; render(); });
    $("ncmCompareFilter").addEventListener("change", (event) => {
      state.ncmCompareFilter = event.target.value; state.page = 1; render();
    });
    $("pageSize").addEventListener("change", (event) => { state.pageSize = Number(event.target.value); state.page = 1; render(); });
    $("clearFilters").addEventListener("click", () => {
      state.query = ""; state.status = "all"; state.ncmCompareFilter = "all";
      state.page = 1; state.columnFilters = {};
      $("search").value = ""; $("statusFilter").value = "all";
      $("ncmCompareFilter").value = "all"; closeColumnFilter(); render();
    });
    $("previous").addEventListener("click", () => { state.page--; render(); });
    $("next").addEventListener("click", () => { state.page++; render(); });
    document.querySelectorAll("[data-sort]").forEach((button) => button.addEventListener("click", () => {
      const key = button.dataset.sort;
      state.direction = state.sort === key ? -state.direction : 1;
      state.sort = key; state.page = 1; render();
    }));
    $("materialHead").addEventListener("click",(event)=>{
      const button=event.target.closest("[data-filter-open]");
      if(button){
        const key=button.dataset.filterOpen;
        if(state.openFilter===key)closeColumnFilter();
        else openColumnFilter(key,button);
      }
    });
    $("pageSelectToggle").addEventListener("change",(event)=>selectPage(event.target.checked));
    $("selectPage").addEventListener("click",()=>selectPage(true));
    $("selectFiltered").addEventListener("click",()=>{
      const rows=filtered();
      if(rows.length>BULK_MAX){
        showToast("Há "+formatNumber(rows.length)+" filtrados. Refine para no máximo "+BULK_MAX+" por lote.",true);
        return;
      }
      rows.forEach((row)=>state.selected.add(String(row.codigo)));
      render();
    });
    $("clearSelection").addEventListener("click",()=>{state.selected.clear();render();});
    $("rows").addEventListener("change",(event)=>{
      const box=event.target.closest("[data-select-id]");
      if(!box)return;
      if(box.checked)state.selected.add(box.dataset.selectId);
      else state.selected.delete(box.dataset.selectId);
      render();
    });
    $("filterOptionSearch").addEventListener("input",()=>{
      // Mesmo comportamento da tabela Material Cliente: a pesquisa incremental
      // inicia uma seleção de opções, sem carregar previamente todas elas.
      state.filterDraft=new Set();
      renderColumnOptions();
    });
    $("filterOptionList").addEventListener("change",(event)=>{
      const box=event.target.closest("input[data-filter-value]");
      if(!box||!state.openFilter)return;
      if(state.filterDraft===null)
        state.filterDraft=new Set(availableColumnValues(state.openFilter).map(([v])=>v));
      if(box.checked)state.filterDraft.add(box.dataset.filterValue);
      else state.filterDraft.delete(box.dataset.filterValue);
      renderColumnOptions();
    });
    $("filterPickVisible").addEventListener("click",()=>{
      if(!state.openFilter)return;
      const values=matchingColumnValues().map(([v])=>v);
      if(!values.length)return;
      const draft=state.filterDraft;
      const all=values.every((v)=>draft===null||draft.has(v));
      if(draft===null)state.filterDraft=new Set(availableColumnValues(state.openFilter).map(([v])=>v));
      values.forEach((v)=>all?state.filterDraft.delete(v):state.filterDraft.add(v));
      renderColumnOptions();
    });
    $("filterReset").addEventListener("click",()=>{
      if(!state.openFilter)return;
      delete state.columnFilters[state.openFilter];
      state.page=1;closeColumnFilter();render();
    });
    $("filterApply").addEventListener("click",applyColumnFilter);
    $("closeFilter").addEventListener("click",closeColumnFilter);
    document.addEventListener("pointerdown",(event)=>{
      if(!state.openFilter)return;
      if($("filterPopover").contains(event.target)||event.target.closest("[data-filter-open]"))return;
      closeColumnFilter();
    });
    $("rows").addEventListener("click", (event) => {
      const button = event.target.closest("button[data-id]");
      if (!button) return;
      const material = state.materials.find((x) => String(x.codigo) === button.dataset.id);
      if (material) openEditor(material);
    });
    $("openBulk").addEventListener("click",openBulk);
    $("closeBulk").addEventListener("click",closeBulk);
    $("cancelBulk").addEventListener("click",closeBulk);
    $("bulkForm").addEventListener("submit",submitBulk);
    $("bulkOverlay").addEventListener("mousedown",(event)=>{
      if(event.target===$("bulkOverlay"))closeBulk();
    });
    document.querySelectorAll("[data-bulk-check]").forEach((checkbox)=>{
      checkbox.addEventListener("change",()=>toggleBulkField(checkbox.dataset.bulkCheck,checkbox.checked));
    });
    $("bulkClearCbs").addEventListener("click",()=>setBulkCbs(null));
    ["ncm","cbs"].forEach((type)=>{
      const input=$(type==="ncm"?"bulkNcmSearch":"bulkCbsSearch");
      const list=$(type==="ncm"?"bulkNcmResults":"bulkCbsResults");
      input.addEventListener("input",()=>{
        if(type==="ncm")state.bulkNcm=null;else state.bulkCbs=null;
        renderBulkLookup(type);
      });
      input.addEventListener("focus",()=>renderBulkLookup(type));
      input.addEventListener("keydown",(event)=>{
        if(event.key==="Enter"&&!list.hidden){
          event.preventDefault();
          list.querySelector("button[data-code]")?.click();
        }
      });
      list.addEventListener("mousedown",(event)=>event.preventDefault());
      list.addEventListener("click",(event)=>{
        const button=event.target.closest("button[data-code]");
        if(!button)return;
        if(type==="ncm")setBulkNcm(state.ncm.find((row)=>text(row.codigo)===button.dataset.code)||null);
        else setBulkCbs(state.cbs.find((row)=>row.codigo===button.dataset.code)||null);
        showBulkError("");
      });
      input.addEventListener("blur",()=>setTimeout(()=>{list.hidden=true;},140));
    });
    $("closeEditor").addEventListener("click", closeEditor);
    $("cancelEdit").addEventListener("click", closeEditor);
    $("overlay").addEventListener("mousedown", (event) => { if (event.target === $("overlay")) closeEditor(); });
    document.addEventListener("keydown", (event) => {
      if(event.key==="Escape"&&state.openFilter)closeColumnFilter();
      if(event.key==="Escape"&&!$("bulkOverlay").hidden){
        if(!$("bulkNcmResults").hidden||!$("bulkCbsResults").hidden){
          $("bulkNcmResults").hidden=true;$("bulkCbsResults").hidden=true;
        }else closeBulk();
        return;
      }
      if (event.key === "Escape" && !$("overlay").hidden) {
        if (!$("ncmResults").hidden || !$("cbsResults").hidden) {
          $("ncmResults").hidden = true; $("cbsResults").hidden = true;
        } else closeEditor();
      }
    });
    $("editForm").addEventListener("submit", (event) => event.preventDefault());
    $("saveOnly").addEventListener("click", () => save(false));
    $("saveReviewed").addEventListener("click", () => save(true));
    $("clearCbs").addEventListener("click", () => setCbs(null));
    ["ncm", "cbs"].forEach((type) => {
      const isNcm = type === "ncm";
      const input = $(isNcm ? "ncmSearch" : "cbsSearch");
      const list = $(isNcm ? "ncmResults" : "cbsResults");
      input.addEventListener("input", () => {
        if (isNcm) state.selectedNcm = null; else state.selectedCbs = null;
        renderLookup(type);
      });
      input.addEventListener("focus", () => renderLookup(type));
      input.addEventListener("keydown", (event) => {
        if (event.key === "Enter" && !list.hidden) {
          event.preventDefault();
          const first = list.querySelector("button[data-code]");
          if (first) first.click();
        }
      });
      list.addEventListener("mousedown", (event) => event.preventDefault());
      list.addEventListener("click", (event) => {
        const button = event.target.closest("button[data-code]");
        if (!button) return;
        if (isNcm) setNcm(state.ncm.find((row) => text(row.codigo) === button.dataset.code) || null);
        else setCbs(state.cbs.find((row) => row.codigo === button.dataset.code) || null);
        alertBox("saveError", "");
      });
      input.addEventListener("blur", () => setTimeout(() => { list.hidden = true; }, 140));
    });
  }
  async function init() {
    initHeaders();
    bind();
    bindSyncLastNcm();
    if (!(await verifyAccess())) return;
    await loadAll();
  }
  init();
})();