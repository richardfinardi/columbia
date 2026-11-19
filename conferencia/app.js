"use strict";
(function () {
  const ROOT = "https://columbia.consultoriarf.net";
  const BASE_PRODUCAO = ROOT + "/producao";
  const API = {
    materiais: ROOT + "/revenda",
    ncm: ROOT + "/ncm",
    cbs: ROOT + "/cbsibs",
    salvar: ROOT + "/revenda/atualizar"
  };
  const TOKEN_KEY = "columbia_analista_token";
  const USER_KEY = "columbia_analista_usuario";
  const $ = (id) => document.getElementById(id);
  const state = {
    materials: [], ncm: [], cbs: [], loading: false, referenceReady: false,
    page: 1, pageSize: 50, query: "", status: "pending",
    sort: "nome", direction: 1, material: null,
    selectedNcm: null, selectedCbs: null, inFlight: false, toastTimer: null
  };

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
      u_revisado: value(row, "u_revisado") ?? 0
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
        const detail = body && body.detail;
        const message = typeof detail === "string" ? detail : "Erro HTTP " + res.status;
        const err = new Error(message);
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
  function filtered() {
    let rows = state.materials;
    if (state.status === "pending") rows = rows.filter((x) => !isDone(x));
    if (state.status === "done") rows = rows.filter(isDone);
    const search = normalized(state.query);
    if (search) {
      rows = rows.filter((r) => normalized([
        r.codigo, r.codigo_interno, r.nome, r.classificacao_fiscal,
        r.descricao_classi_fiscal, r.cean_i03,
        r.cclass_trib_ibscbs, r.desc_cclass_trib_ibscbs,
        r.cbenef_i05f
      ].join(" ")).includes(search));
    }
    return rows.slice().sort((a, b) => {
      const av = a[state.sort], bv = b[state.sort];
      if (state.sort === "u_revisado" || state.sort === "codigo") return (number(av) - number(bv)) * state.direction;
      return String(av ?? "").localeCompare(String(bv ?? ""), "pt-BR", { numeric: true, sensitivity: "base" }) * state.direction;
    });
  }
  function cell(v) { return escapeHtml(text(v) || "—"); }
  function render() {
    const all = state.materials.length;
    const reviewed = state.materials.filter(isDone).length;
    const pending = all - reviewed;
    const percent = all ? Math.round(100 * reviewed / all) : 0;
    $("kTotal").textContent = formatNumber(all);
    $("kPending").textContent = formatNumber(pending);
    $("kDone").textContent = formatNumber(reviewed);
    $("kRate").textContent = percent + "%";
    $("progressBar").style.width = percent + "%";
    const rows = filtered();
    $("showingCount").textContent = formatNumber(rows.length) + " registros";
    const pageCount = Math.max(1, Math.ceil(rows.length / state.pageSize));
    state.page = Math.max(1, Math.min(state.page, pageCount));
    const start = (state.page - 1) * state.pageSize;
    const items = rows.slice(start, start + state.pageSize);
    const tbody = $("rows");
    if (!items.length) {
      tbody.innerHTML = '<tr><td colspan="9" class="empty">Nenhum material encontrado para estes filtros.</td></tr>';
    } else {
      tbody.innerHTML = items.map((r) => '<tr>' +
        '<td><div class="item-code">' + cell(r.codigo_interno || r.codigo) + '</div><div class="item-sub">ID ' + cell(r.codigo) + '</div></td>' +
        '<td><div class="item-name">' + cell(r.nome) + '</div></td>' +
        '<td>' + cell(r.unidade) + '</td>' +
        '<td title="' + escapeHtml(r.descricao_classi_fiscal) + '">' + cell(r.classificacao_fiscal) + '</td>' +
        '<td>' + escapeHtml(formatIpi(r.ipi)) + '</td>' +
        '<td>' + cell(r.cean_i03) + '</td>' +
        '<td><div class="single-line" title="' + escapeHtml(r.desc_cclass_trib_ibscbs) + '">' + cell(r.cclass_trib_ibscbs) + '</div></td>' +
        '<td><span class="status ' + (isDone(r) ? "done" : "pending") + '">' + (isDone(r) ? "Revisado" : "Pendente") + '</span></td>' +
        '<td><button type="button" class="table-action" data-id="' + escapeHtml(r.codigo) + '">' + (isDone(r) ? "Reabrir" : "Conferir") + '</button></td>' +
        '</tr>').join("");
    }
    $("pageInfo").textContent = rows.length ? formatNumber(start + 1) + " a " + formatNumber(start + items.length) + " de " + formatNumber(rows.length) : "Nenhum registro";
    $("previous").disabled = state.page <= 1;
    $("next").disabled = state.page >= pageCount;
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
    if (gtin && !/^[0-9]{8,14}$/.test(gtin)) {
      alertBox("saveError", "O GTIN deve ter apenas números, entre 8 e 14 dígitos.");
      $("gtin").focus(); return;
    }
    const payload = {
      codigo: Number(state.material.codigo),
      ncm_codigo: Number(state.selectedNcm.codigo),
      cbs_codigo: state.selectedCbs ? state.selectedCbs.codigo : null,
      cean_i03: gtin,
      cbenef_i05f: $("benefit").value.trim(),
      revisado: !!revised,
      esperado: captureExpected(state.material)
    };
    if (!Number.isSafeInteger(payload.codigo) || payload.codigo <= 0) { alertBox("saveError", "Código de material inválido."); return; }
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
  function downloadCsv() {
    const cols = [
      ["Código interno", "codigo_interno"], ["ID", "codigo"], ["Nome", "nome"],
      ["Unidade", "unidade"], ["Unidade compra", "unidade_compra"],
      ["Cód. classificação fiscal", "cod_classificacao_fiscal"], ["NCM", "classificacao_fiscal"],
      ["Descrição NCM", "descricao_classi_fiscal"], ["IPI (%)", "ipi"], ["GTIN", "cean_i03"],
      ["Benefício fiscal UF", "cbenef_i05f"], ["CBS/IBS", "cclass_trib_ibscbs"],
      ["Descrição CBS/IBS", "desc_cclass_trib_ibscbs"], ["Revisado", "u_revisado"]
    ];
    function csv(value) { return '"' + text(value).replace(/"/g, '""') + '"'; }
    const lines = [cols.map((x) => csv(x[0])).join(";")];
    filtered().forEach((row) => lines.push(cols.map((x) => csv(row[x[1]])).join(";")));
    const blob = new Blob(["\uFEFF" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "conferencia_revenda_" + new Date().toISOString().slice(0, 10) + ".csv";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 6000);
  }
  function bind() {
    $("reload").addEventListener("click", loadAll);
    $("export").addEventListener("click", downloadCsv);
    $("search").addEventListener("input", (event) => { state.query = event.target.value; state.page = 1; render(); });
    $("statusFilter").addEventListener("change", (event) => { state.status = event.target.value; state.page = 1; render(); });
    $("pageSize").addEventListener("change", (event) => { state.pageSize = Number(event.target.value); state.page = 1; render(); });
    $("clearFilters").addEventListener("click", () => {
      state.query = ""; state.status = "all"; state.page = 1;
      $("search").value = ""; $("statusFilter").value = "all"; render();
    });
    $("previous").addEventListener("click", () => { state.page--; render(); });
    $("next").addEventListener("click", () => { state.page++; render(); });
    document.querySelectorAll("[data-sort]").forEach((button) => button.addEventListener("click", () => {
      const key = button.dataset.sort;
      state.direction = state.sort === key ? -state.direction : 1;
      state.sort = key; state.page = 1; render();
    }));
    $("rows").addEventListener("click", (event) => {
      const button = event.target.closest("button[data-id]");
      if (!button) return;
      const material = state.materials.find((x) => String(x.codigo) === button.dataset.id);
      if (material) openEditor(material);
    });
    $("closeEditor").addEventListener("click", closeEditor);
    $("cancelEdit").addEventListener("click", closeEditor);
    $("overlay").addEventListener("mousedown", (event) => { if (event.target === $("overlay")) closeEditor(); });
    document.addEventListener("keydown", (event) => {
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
    bind();
    if (!(await verifyAccess())) return;
    await loadAll();
  }
  init();
})();