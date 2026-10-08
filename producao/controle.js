
        const API_URL = 'https://columbia.consultoriarf.net/producao';
        const API_HR_A_MAIS = 'https://columbia.consultoriarf.net/hr-a-mais';
        const API_FATURAMENTO = 'https://columbia.consultoriarf.net/faturamento_prod';

        let rawData = [];
        let rawConferenciaData = [];
        let rawFaturamentoData = [];
        let rawAnexosPendentes = [];
        let currentDate = new Date();
        let selectedItemModal = null; 

        let currentView = 'week';
        let abaAtiva = 'dashboard';

        let showConcluidas = false; 
        let isFaturamentoLoading = false; 
        let onlyCurrentMonth = true;
        let onlyWithBudget = false;
        let isValuesUnlocked = false;

        function inicializarProducao() {
            const nomeUser = localStorage.getItem('columbia_analista_usuario');
            if (nomeUser) {
                const displayEl = document.getElementById('userDisplayName');
                if (displayEl) displayEl.textContent = nomeUser;
            }

            // V7.6.7: Se u_vendedor == 1 no CSENHA, exibe valores automaticamente sem pedir senha
            const isVendedorVal = String((window.__COL_PROD_PERMISSIONS?.u_vendedor??0) || '').trim();
            if (isVendedorVal === '1') {
                isValuesUnlocked = true;
                updateValueVisibilityUI();
            }

            configurarVisibilidadeAbas();

            lucide.createIcons();
            setViewMode('week', false);
            fetchData();

            fetchFaturamentoData(true);

            // AUTO-REFRESH SILENCIOSO A CADA 30 SEGUNDOS
            setInterval(() => {
                const isModalOpen = !document.getElementById('osModal').classList.contains('hidden') ||
                                    !document.getElementById('altRenegociationFormModal').classList.contains('hidden') ||
                                    !document.getElementById('passwordModal').classList.contains('hidden');
                
                if (!isModalOpen) {
                    if (abaAtiva === 'dashboard' || abaAtiva === 'limbo') {
                        fetchData(true);
                    } else if (abaAtiva === 'conferencia') {
                        fetchConferenciaData(true);
                    } else if (abaAtiva === 'faturamento') {
                        fetchFaturamentoData(true);
                    } else if (abaAtiva === 'anexos') {
                        fetchAnexosPendentData();
                    }
                }
            }, 30000);
        }

        window.setElText = function(id, text) {
            const el = document.getElementById(id);
            if (el) el.textContent = text;
        };

        window.openModal = function(n_os) {
            const osTarget = String(n_os).trim();
            const item = rawData.find(i => String(i.n_os).trim() === osTarget);
            
            if (!item) {
                console.warn('Item não localizado na lista rawData para OS:', osTarget);
                return;
            }
            selectedItemModal = item;

            const safeText = (val) => (!val || val === 'NaT' || val === 'None' || val === 'null' || String(val).trim() === '') ? '-' : val;

            setElText('mOS', `OS ${item.n_os || 'N/A'}`);
            setElText('mTitulo', item.titulo || 'Sem Título');
            setElText('mPedido', safeText(item.n_pedido));
            setElText('mCliente', safeText(item.cliente));
            setElText('mSegmento', safeText(item.segmento));
            setElText('mCodInterno', safeText(item.cod_interno));
            setElText('mOrigem', safeText(item.origem));
            setElText('mEngenhariaStatus', safeText(item.engenharia_status));
            setElText('mOsFilhosQuais', safeText(item.os_filhos_quais));
            setElText('mPossuiOrcamento', safeText(item.possui_orcamento));
            setElText('mPreco', formatBRL(parseValue(item.preco_geral_a_vista || item.orcamento)));
            setElText('mNumOrcamento', safeText(item.orcamento));

            setElText('mCompras', safeText(item.status_compras));
            setElText('mTerceiros', safeText(item.status_terceiros));
            setElText('mProducao', safeText(item.status_producao));
            setElText('mPpPendentes', safeText(item.pp_pendentes));
            setElText('mJustificativa', safeText(item.justificativa));

            const containerAnexos = document.getElementById('mAnexosContainer');
            const listAnexos = document.getElementById('mAnexosList');
            const anexos = Array.isArray(item.anexos) ? item.anexos : [];

            if (containerAnexos && listAnexos) {
                if (anexos.length > 0) {
                    containerAnexos.classList.remove('hidden');
                    listAnexos.innerHTML = anexos.map((anx, idx) => `
                        <button onclick="abrirDesenhoAnexo(event, ${item.cod_empresa}, ${item.cod_os}, ${anx.cod_os_aux})" 
                                class="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold text-xs transition shadow-xs flex items-center gap-1.5">
                            <i data-lucide="file-text" class="w-4 h-4"></i>
                            <span>Abrir Desenho ${idx + 1} (Aux ${anx.cod_os_aux})</span>
                        </button>
                    `).join('');
                } else {
                    containerAnexos.classList.add('hidden');
                    listAnexos.innerHTML = '';
                }
            }

            const estaNoLimbo = String(item.u_limbo) === '1' || item.u_limbo === 1;
            const btnLimbo = document.getElementById('btnEnviarLimbo');
            const txtLabelBtnLimbo = document.getElementById('txtLabelBtnLimbo');

            if (btnLimbo && txtLabelBtnLimbo) {
                if (estaNoLimbo) {
                    btnLimbo.className = "px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold text-xs transition shadow-sm flex items-center gap-1.5";
                    txtLabelBtnLimbo.textContent = "Tirar do Limbo 🟢";
                } else {
                    btnLimbo.className = "px-3.5 py-1.5 bg-slate-800 hover:bg-slate-900 text-amber-400 border border-slate-700 rounded-xl font-bold text-xs transition shadow-sm flex items-center gap-1.5";
                    txtLabelBtnLimbo.textContent = "Enviar ao Limbo";
                }
            }

            const temAberto = String(item.tem_apontamento_aberto || '').toLowerCase() === 'sim';
            const containerAp = document.getElementById('mApontamentoContainer');
            const titleAp = document.getElementById('mApontamentoStatusTitle');
            const badgeAp = document.getElementById('mApontamentoBadge');
            const textAp = document.getElementById('mApontamentoDetalheText');

            if (containerAp && titleAp && badgeAp && textAp) {
                if (temAberto) {
                    containerAp.className = "p-3 rounded-xl border border-emerald-300 bg-emerald-50/80 flex flex-col gap-1.5";
                    titleAp.textContent = "Apontamento Aberto no Momento";
                    titleAp.className = "font-extrabold text-xs text-emerald-900";
                    badgeAp.innerHTML = `<span class="bg-emerald-200 text-emerald-900 border border-emerald-300 text-[10px] font-black px-2 py-0.5 rounded-md animate-pulse">EM ANDAMENTO ⚙️</span>`;
                    textAp.textContent = safeText(item.apontamentos_abertos_detalhe);
                    textAp.className = "text-[11px] font-mono leading-relaxed text-emerald-900 font-bold";
                } else {
                    containerAp.className = "p-3 rounded-xl border border-red-200 bg-red-50/60 flex flex-col gap-1.5";
                    titleAp.textContent = "Sem Apontamentos em Andamento";
                    titleAp.className = "font-bold text-xs text-red-800";
                    badgeAp.innerHTML = `<span class="bg-red-200 text-red-800 border border-red-300 text-[10px] font-bold px-2 py-0.5 rounded-md">PARADO</span>`;
                    textAp.textContent = "Nenhum operador realizando apontamento nesta OS atualmente.";
                    textAp.className = "text-[11px] font-mono leading-relaxed text-red-600 italic";
                }
            }

            const elAtrasada = document.getElementById('mAtrasada');
            if (elAtrasada) {
                const isAtrasada = String(item.atrasada).toLowerCase() === 'sim' || String(item.atrasada).toLowerCase() === 's';
                elAtrasada.textContent = isAtrasada ? 'Sim' : 'Não';
                elAtrasada.className = `font-bold ${isAtrasada ? 'text-red-600' : 'text-emerald-600'}`;
            }

            setElText('mAbertura', formatDate(item.abertura_os));
            setElText('mDtRenegociada', formatDate(item.dt_renegociada || item.u_data_renegociacao));
            setElText('mPrevEntregaOrcamento', formatDate(item.prev_entrega_orcamento));
            setElText('mPrevEntregaOS', formatDate(item.prev_entrega_os));
            setElText('mApontamento', formatDate(item.ultimo_apontamento));
            setElText('mEntregaNorm', formatDate(item.entrega_normalizada));

            const modal = document.getElementById('osModal');
            if (modal) {
                modal.classList.remove('hidden');
                modal.classList.add('flex');
            }
            lucide.createIcons();
        };

        window.closeModal = function() {
            const modal = document.getElementById('osModal');
            if (modal) {
                modal.classList.add('hidden');
                modal.classList.remove('flex');
            }
            selectedItemModal = null;
        };

        window.abrirModalRenegociacaoPelaOS = function(n_os) {
            const osTarget = String(n_os).trim();
            let item = rawData.find(i => String(i.n_os).trim() === osTarget);
            
            if (!item) {
                const fatMatch = rawFaturamentoData.find(i => String(i.n_os).trim() === osTarget);
                item = { 
                    n_os: osTarget, 
                    dt_renegociada: null, 
                    u_data_renegociacao: null,
                    cliente: fatMatch ? fatMatch.cliente : '',
                    titulo: fatMatch ? fatMatch.descricao : ''
                };
            }
            
            selectedItemModal = item;
            openAltRenegociationFormModal();
        };

        window.openAltRenegociationFormModal = function() {
            if (!selectedItemModal) return;

            setElText('altRenHeaderTitle', `OS ${selectedItemModal.n_os} - Alterar Renegociação`);
            
            const currentDt = selectedItemModal.dt_renegociada || selectedItemModal.u_data_renegociacao || '';
            const inputDate = document.getElementById('inputNewRenegociationDate');
            if (inputDate) {
                if (currentDt && currentDt.length >= 10 && currentDt !== 'NaT') {
                    inputDate.value = currentDt.substring(0, 10);
                } else {
                    inputDate.value = '';
                }
            }

            const txtJust = document.getElementById('textareaJustification');
            if (txtJust) txtJust.value = '';
            
            const err = document.getElementById('altRenegociationFormError');
            if (err) err.classList.add('hidden');

            const modal = document.getElementById('altRenegociationFormModal');
            if (modal) {
                modal.classList.remove('hidden');
                modal.classList.add('flex');
            }
            lucide.createIcons();
        };

        window.closeAltRenegociationFormModal = function() {
            const modal = document.getElementById('altRenegociationFormModal');
            if (modal) {
                modal.classList.add('hidden');
                modal.classList.remove('flex');
            }
        };

        window.submitAltRenegociation = async function() {
            if (!selectedItemModal) return;

            const newDate = document.getElementById('inputNewRenegociationDate').value;
            const userTexto = document.getElementById('textareaJustification').value.trim();
            const err = document.getElementById('altRenegociationFormError');
            const btnSave = document.getElementById('btnSaveRenegociation');

            if (!userTexto) {
                if (err) {
                    err.textContent = 'A justificativa é obrigatória.';
                    err.classList.remove('hidden');
                }
                return;
            }

            const usuarioLogado = localStorage.getItem('columbia_analista_usuario') || 'SISTEMA';
            const justificativaComUsuario = `[${usuarioLogado.toUpperCase()}] ${userTexto}`;

            try {
                if (btnSave) {
                    btnSave.disabled = true;
                    btnSave.classList.add('opacity-50');
                }

                const patchUrl = `${API_URL}/${selectedItemModal.n_os}/alterar-renegociacao`;

                const response = await fetch(patchUrl, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        u_data_renegociacao: newDate || null,
                        U_JUST_ALT_DT_REN: justificativaComUsuario
                    })
                });

                if (!response.ok) {
                    const errorData = await response.json();
                    throw new Error(errorData.detail || 'Falha ao salvar a alteração no banco.');
                }

                // ATUALIZAÇÃO IMEDIATA NA MEMÓRIA LOCAL
                const updatedOSStr = String(selectedItemModal.n_os).trim();
                rawData.forEach(i => {
                    if (String(i.n_os).trim() === updatedOSStr) {
                        i.dt_renegociada = newDate || null;
                        i.u_data_renegociacao = newDate || null;
                        i.entrega_normalizada = newDate || i.entrega_normalizada;
                        i.justificativa = justificativaComUsuario;
                    }
                });

                rawFaturamentoData.forEach(i => {
                    if (String(i.n_os).trim() === updatedOSStr) {
                        i.entrega_normalizada = newDate || i.entrega_normalizada;
                    }
                });

                closeAltRenegociationFormModal();
                closeModal();
                
                renderView();

                fetchData(true);
                fetchFaturamentoData(true);

            } catch (error) {
                console.error('Erro ao salvar renegociação:', error);
                if (err) {
                    err.textContent = error.message;
                    err.classList.remove('hidden');
                }
            } finally {
                if (btnSave) {
                    btnSave.disabled = false;
                    btnSave.classList.remove('opacity-50');
                }
            }
        };

        // ABERTURA DE ANEXOS DESENHO TÉCNICO PDF
        async function abrirDesenhoAnexo(event, cod_empresa, cod_os, cod_os_aux) {
            if (event && typeof event.stopPropagation === 'function') {
                event.stopPropagation();
            }

            try {
                const btnTarget = event ? event.currentTarget : null;
                if (btnTarget) {
                    btnTarget.disabled = true;
                    btnTarget.classList.add('opacity-50');
                }

                const url = `${API_URL}/desenho-anexo?cod_empresa=${cod_empresa}&cod_os=${cod_os}&cod_os_aux=${cod_os_aux}`;
                const response = await fetch(url);

                if (!response.ok) {
                    const err = await response.json();
                    throw new Error(err.detail || 'Não foi possível carregar o anexo.');
                }

                const data = await response.json();

                if (!data.pdf_base64) {
                    alert('Arquivo não encontrado ou corrompido.');
                    return;
                }

                const byteCharacters = atob(data.pdf_base64);
                const byteNumbers = new Array(byteCharacters.length);
                for (let i = 0; i < byteCharacters.length; i++) {
                    byteNumbers[i] = byteCharacters.charCodeAt(i);
                }
                const byteArray = new Uint8Array(byteNumbers);
                const fileBlob = new Blob([byteArray], { type: 'application/pdf' });

                const fileURL = URL.createObjectURL(fileBlob);
                window.open(fileURL, '_blank');

            } catch (error) {
                console.error('Erro ao abrir anexo:', error);
                alert(`Erro ao abrir o anexo: ${error.message}`);
            } finally {
                if (event && event.currentTarget) {
                    event.currentTarget.disabled = false;
                    event.currentTarget.classList.remove('opacity-50');
                }
            }
        }

        function configurarVisibilidadeAbas() {
            const valFaturamento = (window.__COL_PROD_PERMISSIONS?.u_faturamento??0);
            const valFinalizacao = (window.__COL_PROD_PERMISSIONS?.u_finalizacao??0);
            const valAnexo = (window.__COL_PROD_PERMISSIONS?.u_anexo??0);

            const permFaturamento = valFaturamento !== null && String(valFaturamento).trim() === '1';
            const permFinalizacao = valFinalizacao !== null && String(valFinalizacao).trim() === '1';
            const permAnexo = valAnexo !== null && String(valAnexo).trim() === '1';

            const btnAbaFaturamento = document.getElementById('btnAbaFaturamento');
            const btnAbaConferencia = document.getElementById('btnAbaConferencia');
            const btnAbaAnexos = document.getElementById('btnAbaAnexos');

            if (btnAbaFaturamento) btnAbaFaturamento.classList.toggle('hidden', !permFaturamento);
            if (btnAbaConferencia) btnAbaConferencia.classList.toggle('hidden', !permFinalizacao);
            if (btnAbaAnexos) btnAbaAnexos.classList.toggle('hidden', !permAnexo);
        }

        function setAbaAtiva(novaAba) {
            abaAtiva = novaAba;

            const metricsBar = document.getElementById('metricsBar');
            const filtersBar = document.getElementById('filtersBar');
            const navigationBar = document.getElementById('navigationBar');

            const btnDashboard = document.getElementById('btnAbaDashboard');
            const btnFaturamento = document.getElementById('btnAbaFaturamento');
            const btnConferencia = document.getElementById('btnAbaConferencia');
            const btnAnexos = document.getElementById('btnAbaAnexos');
            const btnLimbo = document.getElementById('btnVerLimbo');

            const atrasadaContainer = document.getElementById('atrasadaContainer');
            const apontamentoContainer = document.getElementById('apontamentoContainer');
            const producaoContainer = document.getElementById('producaoContainer');
            const segmentoContainer = document.getElementById('segmentoContainer');
            const clienteContainer = document.getElementById('clienteContainer');
            const engenhariaContainer = document.getElementById('engenhariaContainer');
            const comprasContainer = document.getElementById('comprasContainer');
            const terceirosContainer = document.getElementById('terceirosContainer');
            const extraButtonsContainer = document.getElementById('extraButtonsContainer');
            const viewModeContainer = document.getElementById('viewModeContainer');

            if (btnDashboard) btnDashboard.className = "flex items-center gap-1.5 px-3 py-2 bg-columbia-800 hover:bg-columbia-900 text-white font-extrabold rounded-xl text-xs transition shadow-md shrink-0";
            if (btnFaturamento) btnFaturamento.className = "flex items-center gap-1.5 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white font-extrabold rounded-xl text-xs transition shadow-md shrink-0";
            if (btnConferencia) btnConferencia.className = "flex items-center gap-1.5 px-3 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold rounded-xl text-xs transition shadow-md shrink-0";
            if (btnAnexos) btnAnexos.className = "flex items-center gap-1.5 px-3 py-2 bg-teal-600 hover:bg-teal-700 text-white font-extrabold rounded-xl text-xs transition shadow-md shrink-0";
            if (btnLimbo) btnLimbo.className = "flex items-center gap-1.5 px-3 py-2 bg-amber-500 hover:bg-amber-600 text-slate-950 font-black rounded-xl text-xs transition shadow-md shrink-0";

            configurarVisibilidadeAbas();

            if (abaAtiva === 'dashboard') {
                if (btnDashboard) btnDashboard.className = "flex items-center gap-1.5 px-3 py-2 bg-columbia-900 border border-emerald-400 text-white font-black rounded-xl text-xs transition shadow-md shrink-0";
                if (metricsBar) metricsBar.classList.remove('hidden');
                if (filtersBar) filtersBar.classList.remove('hidden');
                if (navigationBar) navigationBar.classList.remove('hidden');

                if (atrasadaContainer) atrasadaContainer.classList.remove('hidden');
                if (apontamentoContainer) apontamentoContainer.classList.remove('hidden');
                if (producaoContainer) producaoContainer.classList.remove('hidden');
                if (segmentoContainer) segmentoContainer.classList.remove('hidden');
                if (clienteContainer) clienteContainer.classList.remove('hidden');
                if (engenhariaContainer) engenhariaContainer.classList.remove('hidden');
                if (comprasContainer) comprasContainer.classList.remove('hidden');
                if (terceirosContainer) terceirosContainer.classList.remove('hidden');
                if (extraButtonsContainer) extraButtonsContainer.classList.remove('hidden');
                if (viewModeContainer) viewModeContainer.classList.add('hidden');

                currentView = 'week';
            } else if (abaAtiva === 'faturamento') {
                if (btnFaturamento) btnFaturamento.className = "flex items-center gap-1.5 px-3 py-2 bg-blue-900 border border-blue-400 text-white font-black rounded-xl text-xs transition shadow-md shrink-0";
                if (metricsBar) metricsBar.classList.add('hidden');
                if (filtersBar) filtersBar.classList.remove('hidden');
                if (navigationBar) navigationBar.classList.remove('hidden');

                if (atrasadaContainer) atrasadaContainer.classList.add('hidden');
                if (apontamentoContainer) apontamentoContainer.classList.add('hidden');
                if (producaoContainer) producaoContainer.classList.add('hidden');
                if (segmentoContainer) segmentoContainer.classList.remove('hidden');
                if (clienteContainer) clienteContainer.classList.remove('hidden');
                if (engenhariaContainer) engenhariaContainer.classList.add('hidden');
                if (comprasContainer) comprasContainer.classList.add('hidden');
                if (terceirosContainer) terceirosContainer.classList.add('hidden');
                if (extraButtonsContainer) extraButtonsContainer.classList.add('hidden');
                if (viewModeContainer) viewModeContainer.classList.add('hidden');

                currentView = 'month'; 
                fetchFaturamentoData();

            } else if (abaAtiva === 'conferencia') {
                if (btnConferencia) btnConferencia.className = "flex items-center gap-1.5 px-3 py-2 bg-indigo-900 border border-indigo-400 text-white font-black rounded-xl text-xs transition shadow-md shrink-0";
                if (metricsBar) metricsBar.classList.add('hidden');
                if (filtersBar) filtersBar.classList.add('hidden');
                if (navigationBar) navigationBar.classList.remove('hidden'); 
                if (viewModeContainer) viewModeContainer.classList.add('hidden');
                fetchConferenciaData();
            } else if (abaAtiva === 'anexos') {
                if (btnAnexos) btnAnexos.className = "flex items-center gap-1.5 px-3 py-2 bg-teal-900 border border-teal-400 text-white font-black rounded-xl text-xs transition shadow-md shrink-0";
                if (metricsBar) metricsBar.classList.add('hidden');
                
                if (filtersBar) filtersBar.classList.remove('hidden');
                if (navigationBar) navigationBar.classList.add('hidden');

                if (atrasadaContainer) atrasadaContainer.classList.add('hidden');
                if (apontamentoContainer) apontamentoContainer.classList.add('hidden');
                if (producaoContainer) producaoContainer.classList.add('hidden');
                if (segmentoContainer) segmentoContainer.classList.remove('hidden');
                if (clienteContainer) clienteContainer.classList.remove('hidden');
                if (engenhariaContainer) engenhariaContainer.classList.add('hidden');
                if (comprasContainer) comprasContainer.classList.add('hidden');
                if (terceirosContainer) terceirosContainer.classList.add('hidden');
                if (extraButtonsContainer) extraButtonsContainer.classList.add('hidden');
                if (viewModeContainer) viewModeContainer.classList.add('hidden');

                fetchAnexosPendentData();
            } else {
                if (metricsBar) metricsBar.classList.add('hidden');
                if (filtersBar) filtersBar.classList.add('hidden');
                if (navigationBar) navigationBar.classList.add('hidden');

                if (abaAtiva === 'limbo' && btnLimbo) {
                    btnLimbo.className = "flex items-center gap-1.5 px-3 py-2 bg-columbia-900 border border-amber-400 text-amber-400 font-black rounded-xl text-xs transition shadow-md shrink-0";
                }
            }

            renderView();
        }

        function efetuarLogout() {
            ['columbia_analista_token','columbia_permissoes','columbia_analista_usuario',
             'columbia_analista_cod_responsavel'].forEach(k=>localStorage.removeItem(k));
            window.location.href = '../login.html';
        }

        function initializeCurrentDate() {
            if (!rawData || rawData.length === 0) return;

            const currMonthKey = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}`;
            const hasDataInCurrMonth = rawData.some(item => item.entrega_normalizada && String(item.entrega_normalizada).substring(0, 7) === currMonthKey);

            if (!hasDataInCurrMonth) {
                const monthCounts = {};
                rawData.forEach(item => {
                    if (item.entrega_normalizada && String(item.entrega_normalizada).length >= 7) {
                        const mKey = String(item.entrega_normalizada).substring(0, 7);
                        monthCounts[mKey] = (monthCounts[mKey] || 0) + 1;
                    }
                });

                const sortedMonths = Object.entries(monthCounts).sort((a, b) => b[1] - a[1]);
                if (sortedMonths.length > 0) {
                    const [bestYear, bestMonth] = sortedMonths[0][0].split('-');
                    currentDate = new Date(parseInt(bestYear), parseInt(bestMonth) - 1, 1);
                }
            }
        }

        function formatDate(dtStr) {
            if (!dtStr || dtStr === 'NaT' || dtStr === 'None' || dtStr === 'null') return '-';
            const cleanStr = String(dtStr).trim();
            if (cleanStr.length < 10) return '-';
            const yyyyMmDd = cleanStr.substring(0, 10);
            const parts = yyyyMmDd.split('-');
            if (parts.length === 3) {
                return `${parts[2]}/${parts[1]}/${parts[0]}`;
            }
            return cleanStr;
        }

        function formatHours(val) {
            const num = parseFloat(val);
            if (isNaN(num)) return '0.00 hrs';
            return `${num.toFixed(2)} hrs`;
        }

        function getISOWeekNumber(d) {
            let date;
            if (typeof d === 'string') {
                const yyyyMmDd = d.substring(0, 10).split('-');
                if (yyyyMmDd.length === 3) {
                    date = new Date(Date.UTC(parseInt(yyyyMmDd[0]), parseInt(yyyyMmDd[1]) - 1, parseInt(yyyyMmDd[2])));
                } else {
                    date = new Date(d);
                }
            } else {
                date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
            }

            const dayNum = date.getUTCDay() || 7;
            date.setUTCDate(date.getUTCDate() + 4 - dayNum);
            const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
            return Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
        }

        function getWeekDateRangeStr(d) {
            let targetDate;
            if (typeof d === 'string') {
                const parts = d.substring(0, 10).split('-');
                targetDate = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
            } else {
                targetDate = new Date(d);
            }

            let dayOfWeek = targetDate.getDay() - 1;
            if (dayOfWeek === -1) dayOfWeek = 6;

            const wStart = new Date(targetDate);
            wStart.setDate(wStart.getDate() - dayOfWeek);
            const wEnd = new Date(wStart);
            wEnd.setDate(wEnd.getDate() + 6);

            const fmtDay = (date) => String(date.getDate()).padStart(2, '0');
            const fmtMonth = (date) => String(date.getMonth() + 1).padStart(2, '0');

            return `${fmtDay(wStart)}/${fmtMonth(wStart)} - ${fmtDay(wEnd)}/${fmtMonth(wEnd)}`;
        }

        async function fetchData(isSilent = false) {
            const refreshIcon = document.getElementById('refreshIcon');
            const btnRefresh = document.getElementById('btnRefresh');
            
            if (!isSilent && refreshIcon) {
                refreshIcon.classList.add('animate-spin');
            }
            if (!isSilent && btnRefresh) {
                btnRefresh.disabled = true;
            }

            const savedFilters = {
                search: document.getElementById('searchInput')?.value || '',
                atrasada: document.getElementById('atrasadaFilter')?.value || '',
                apontamento: document.getElementById('apontamentoAbertoFilter')?.value || '',
                segmento: document.getElementById('segmentoFilter')?.value || '',
                producao: document.getElementById('producaoFilter')?.value || '',
                cliente: document.getElementById('clientFilter')?.value || '',
                engenharia: document.getElementById('engenhariaFilter')?.value || '',
                compras: document.getElementById('comprasFilter')?.value || '',
                terceiros: document.getElementById('terceirosFilter')?.value || ''
            };

            try {
                const cacheBusterUrl = `${API_URL}?_t=${Date.now()}`;
                const response = await fetch(cacheBusterUrl, { cache: 'no-store' });

                if (!response.ok) {
                    throw new Error(`Erro na requisição: ${response.status} ${response.statusText}`);
                }

                rawData = await response.json();

                initializeCurrentDate();

                if (!isSilent) {
                    populateSelectOptions(savedFilters);
                }

                const searchInput = document.getElementById('searchInput');
                if (searchInput && searchInput.value !== savedFilters.search && !isSilent) {
                    searchInput.value = savedFilters.search;
                }

                if (abaAtiva === 'dashboard' || abaAtiva === 'limbo') {
                    renderView();
                }

            } catch (error) {
                console.error('Erro ao buscar dados da API:', error);
                if (!isSilent) {
                    alert('Não foi possível atualizar os dados de produção. Verifique a conexão com o servidor.');
                }
            } finally {
                if (refreshIcon) refreshIcon.classList.remove('animate-spin');
                if (btnRefresh) btnRefresh.disabled = false;
                lucide.createIcons();
            }
        }

        async function fetchConferenciaData(isSilent = false) {
            try {
                const cacheBusterUrl = `${API_HR_A_MAIS}?_t=${Date.now()}`;
                const response = await fetch(cacheBusterUrl, { cache: 'no-store' });
                if (!response.ok) throw new Error('Erro na requisição da API de horas a mais');
                rawConferenciaData = await response.json();
                if (abaAtiva === 'conferencia') renderPaginaConferenciaView();
            } catch (err) {
                console.error('Erro ao buscar dados de conferência:', err);
            }
        }

        async function fetchFaturamentoData(isSilent = false) {
            try {
                if (rawFaturamentoData.length === 0 && !isSilent) {
                    isFaturamentoLoading = true;
                    if (abaAtiva === 'faturamento') renderPaginaFaturamentoView();
                }

                const cacheBusterUrl = `${API_FATURAMENTO}?_t=${Date.now()}`;
                const response = await fetch(cacheBusterUrl, { cache: 'no-store' });
                if (!response.ok) throw new Error('Erro na requisição da API de faturamento');
                rawFaturamentoData = await response.json();
                
            } catch (err) {
                console.error('Erro ao buscar dados de faturamento:', err);
            } finally {
                isFaturamentoLoading = false;
                if (abaAtiva === 'faturamento') renderPaginaFaturamentoView();
            }
        }

        async function fetchAnexosPendentData() {
            const grid = document.getElementById('calendarGrid');
            if (grid && rawAnexosPendentes.length === 0) {
                grid.innerHTML = `
                    <div class="bg-white rounded-2xl border border-slate-200 p-12 text-center text-slate-500 flex flex-col items-center gap-3">
                        <i data-lucide="loader-2" class="w-8 h-8 text-teal-600 animate-spin"></i>
                        <p class="text-xs font-bold">Buscando anexos pendentes de liberação...</p>
                    </div>
                `;
                lucide.createIcons();
            }

            try {
                const response = await fetch(`${API_URL}/anexo?_t=${Date.now()}`);
                if (!response.ok) throw new Error('Erro ao buscar anexos pendentes.');
                rawAnexosPendentes = await response.json();
                
                populateSelectOptionsAnexos();

                if (abaAtiva === 'anexos') renderPaginaAnexosView();
            } catch (err) {
                console.error('Erro ao buscar anexos pendentes:', err);
                if (grid) {
                    grid.innerHTML = `<p class="text-red-600 text-xs text-center font-bold p-6">Erro ao carregar os dados de anexos.</p>`;
                }
            }
        }

        function populateSelectOptionsAnexos() {
            if (!rawAnexosPendentes || rawAnexosPendentes.length === 0) return;

            const segSel = document.getElementById('segmentoFilter');
            const cliSel = document.getElementById('clientFilter');

            if (segSel) {
                const curSeg = segSel.value;
                const segs = [...new Set(rawAnexosPendentes.map(a => a.segmento).filter(Boolean))].sort();
                segSel.innerHTML = '<option value="">Segmento (Todos)</option>' + segs.map(s => `<option value="${s}">${s}</option>`).join('');
                segSel.value = curSeg;
            }

            if (cliSel) {
                const curCli = cliSel.value;
                const clis = [...new Set(rawAnexosPendentes.map(a => a.cliente).filter(Boolean))].sort();
                cliSel.innerHTML = '<option value="">Todos os Clientes</option>' + clis.map(c => `<option value="${c}">${c}</option>`).join('');
                cliSel.value = curCli;
            }
        }

        function populateSelectOptions(savedFilters = {}) {
            const getUniqueOptions = (key) => {
                const values = rawData
                    .map(item => item[key])
                    .filter(val => val !== null && val !== undefined && String(val).trim() !== '');
                return [...new Set(values)].sort();
            };

            const fillSelect = (elementId, options, defaultLabel, savedValue) => {
                const select = document.getElementById(elementId);
                if (!select) return;

                select.innerHTML = `<option value="">${defaultLabel}</option>`;
                options.forEach(opt => {
                    const optionEl = document.createElement('option');
                    optionEl.value = opt;
                    optionEl.textContent = opt;
                    select.appendChild(optionEl);
                });

                if (savedValue && options.includes(savedValue)) {
                    select.value = savedValue;
                } else if (savedValue) {
                    select.value = savedValue;
                }
            };

            fillSelect('segmentoFilter', getUniqueOptions('segmento'), 'Segmento (Todos)', savedFilters.segmento);
            fillSelect('clientFilter', getUniqueOptions('cliente'), 'Todos os Clientes', savedFilters.cliente);
            fillSelect('engenhariaFilter', getUniqueOptions('engenharia_status'), 'Engenharia (Todos)', savedFilters.engenharia);
            fillSelect('comprasFilter', getUniqueOptions('status_compras'), 'Compras (Todos)', savedFilters.compras);
            fillSelect('terceirosFilter', getUniqueOptions('status_terceiros'), 'Terceiros (Todos)', savedFilters.terceiros);

            const producaoSelect = document.getElementById('producaoFilter');
            if (producaoSelect && savedFilters.producao) {
                producaoSelect.value = savedFilters.producao;
            }

            const apontamentoSelect = document.getElementById('apontamentoAbertoFilter');
            if (apontamentoSelect && savedFilters.apontamento) {
                apontamentoSelect.value = savedFilters.apontamento;
            }

            const atrasadaSelect = document.getElementById('atrasadaFilter');
            if (atrasadaSelect && savedFilters.atrasada) {
                atrasadaSelect.value = savedFilters.atrasada;
            }
        }

        function setViewMode(mode, triggerRender = true) {
            currentView = 'week';
            localStorage.setItem('columbia_preferred_view', 'week');

            const btnW = document.getElementById('viewBtnWeek');
            if (btnW) btnW.className = "px-3 py-1 rounded-lg text-xs font-bold transition bg-columbia-700 text-white shadow-sm";

            if (triggerRender) renderView();
        }

        function navigateDate(delta) {
            if (abaAtiva === 'faturamento') {
                currentDate.setMonth(currentDate.getMonth() + delta);
            } else if (currentView === 'week') {
                currentDate.setDate(currentDate.getDate() + (delta * 7));
            } else {
                currentDate.setDate(currentDate.getDate() + delta);
            }
            renderView();
        }

        function resetToToday() {
            currentDate = new Date();
            initializeCurrentDate();
            renderView();
        }

        function updateDateLabel() {
            const label = document.getElementById('currentDateLabel');
            if (!label) return;

            const search = (document.getElementById('searchInput')?.value || '').trim();
            if (search && abaAtiva === 'dashboard') {
                label.textContent = "Busca Geral Ativa";
                return;
            }
            
            if (abaAtiva === 'faturamento') {
                const monthStr = currentDate.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
                label.textContent = monthStr.charAt(0).toUpperCase() + monthStr.slice(1);
            } else {
                const targetDate = new Date(currentDate);
                let dayOfWeek = targetDate.getDay() - 1;
                if (dayOfWeek === -1) dayOfWeek = 6;
                const wStart = new Date(targetDate);
                wStart.setDate(wStart.getDate() - dayOfWeek);
                const wEnd = new Date(wStart);
                wEnd.setDate(wEnd.getDate() + 6);

                const weekNum = getISOWeekNumber(wStart);
                const fmtDay = (d) => String(d.getDate()).padStart(2, '0');
                const fmtMonth = (d) => String(d.getMonth() + 1).padStart(2, '0');

                label.textContent = `Semana ${weekNum} (${fmtDay(wStart)}/${fmtMonth(wStart)} - ${fmtDay(wEnd)}/${fmtMonth(wEnd)})`;
            }
        }

        function parseValue(val) {
            if (val === null || val === undefined) return 0;
            if (typeof val === 'number') return val;
            let str = String(val).trim().replace('R$', '').replace(/\s/g, '');
            if (str.includes(',') && str.includes('.')) {
                str = str.replace(/\./g, '').replace(',', '.');
            } else if (str.includes(',')) {
                str = str.replace(',', '.');
            }
            const parsed = parseFloat(str);
            return isNaN(parsed) ? 0 : parsed;
        }

        function formatBRL(value) {
            if (abaAtiva === 'faturamento') {
                return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value || 0);
            }
            if (!isValuesUnlocked) return 'R$ *****';
            return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value || 0);
        }

        function getFilteredData() {
            const search = (document.getElementById('searchInput')?.value || '').toLowerCase();
            const atrasadaFiltro = document.getElementById('atrasadaFilter')?.value || '';
            const apontamentoFiltro = document.getElementById('apontamentoAbertoFilter')?.value || '';
            const segmento = document.getElementById('segmentoFilter')?.value || '';
            const producao = document.getElementById('producaoFilter')?.value || '';
            const cliente = document.getElementById('clientFilter')?.value || '';
            const engenharia = document.getElementById('engenhariaFilter')?.value || '';
            const compras = document.getElementById('comprasFilter')?.value || '';
            const terceiros = document.getElementById('terceirosFilter')?.value || '';

            const isVendedor = String((window.__COL_PROD_PERMISSIONS?.u_vendedor??0) || '').trim() === '1';
            const userCodResponsavel = String((window.__COL_PROD_PERMISSIONS?.cod_responsavel??'') || '').trim();

            return rawData.filter(item => {
                const estaNoLimbo = String(item.u_limbo) === '1' || item.u_limbo === 1;
                if (estaNoLimbo) return false;

                if (isVendedor && userCodResponsavel !== '') {
                    const osCodResp = String(item.cod_responsavel ?? '').trim();
                    if (osCodResp !== userCodResponsavel) {
                        return false;
                    }
                }

                const isConcluido = String(item.concluido || '').toLowerCase() === 'sim' || String(item.concluido || '').toLowerCase() === 's' || String(item.concluido || '') === '1';
                if (!showConcluidas && isConcluido) {
                    return false;
                }

                if (search) {
                    const matchOS = String(item.n_os || '').toLowerCase().includes(search);
                    const matchTitulo = String(item.titulo || '').toLowerCase().includes(search);
                    const matchCliente = String(item.cliente || '').toLowerCase().includes(search);
                    const matchOrigem = String(item.origem || '').toLowerCase().includes(search);
                    const matchCod = String(item.cod_interno || '').toLowerCase().includes(search);
                    const matchPedido = String(item.n_pedido || '').toLowerCase().includes(search);
                    const matchPP = String(item.pp_pendentes || '').toLowerCase().includes(search);
                    const matchApontamento = String(item.apontamentos_abertos_detalhe || '').toLowerCase().includes(search);
                    const matchJustificativa = String(item.justificativa || '').toLowerCase().includes(search);
                    
                    if (!matchOS && !matchTitulo && !matchCliente && !matchOrigem && !matchCod && !matchPedido && !matchPP && !matchApontamento && !matchJustificativa) return false;
                }

                if (atrasadaFiltro) {
                    const isAtrasada = String(item.atrasada || '').toLowerCase() === 'sim' || String(item.atrasada || '').toLowerCase() === 's';
                    if (atrasadaFiltro === 'sim' && !isAtrasada) return false;
                    if (atrasadaFiltro === 'nao' && isAtrasada) return false;
                }

                if (apontamentoFiltro) {
                    const temAberto = String(item.tem_apontamento_aberto || '').toLowerCase() === 'sim';
                    if (apontamentoFiltro === 'sim' && !temAberto) return false;
                    if (apontamentoFiltro === 'nao' && temAberto) return false;
                }

                if (segmento && (item.segmento || '') !== segmento) return false;
                if (cliente && (item.cliente || '') !== cliente) return false;
                if (engenharia && (item.engenharia_status || '') !== engenharia) return false;
                if (compras && (item.status_compras || '') !== compras) return false;
                if (terceiros && (item.status_terceiros || '') !== terceiros) return false;

                if (producao === 'finalizado') {
                    const st = String(item.status_producao || '').toLowerCase();
                    if (!st.includes('100%') && !st.includes('finalizado')) return false;
                } else if (producao === 'nao_finalizado') {
                    const st = String(item.status_producao || '').toLowerCase();
                    if (st.includes('100%') || st.includes('finalizado')) return false;
                }

                if (onlyWithBudget) {
                    const hasB = String(item.possui_orcamento || '').toLowerCase();
                    if (hasB !== 'sim' && hasB !== 's' && hasB !== '1') return false;
                }

                return true;
            });
        }

        function updateMetrics(filtered) {
            const totalOS = filtered.length;
            const atrasadas = filtered.filter(i => String(i.atrasada || '').toLowerCase() === 'sim' || String(i.atrasada || '').toLowerCase() === 's').length;
            const semOrcamento = filtered.filter(i => {
                const hasB = String(i.possui_orcamento || '').toLowerCase();
                return hasB !== 'sim' && hasB !== 's' && hasB !== '1';
            }).length;

            const valorTotal = filtered.reduce((acc, i) => acc + parseValue(i.preco_geral_a_vista || i.orcamento), 0);

            setElText('metricTotalOS', totalOS);
            setElText('metricAtrasadas', atrasadas);
            setElText('metricSemOrcamento', semOrcamento);
            setElText('metricValorTotal', formatBRL(valorTotal));

            const totalLimbo = rawData.filter(i => String(i.u_limbo) === '1' || i.u_limbo === 1).length;
            setElText('txtBtnLimbo', `Limbo (${totalLimbo})`);
        }

        function renderView() {
            if (abaAtiva === 'limbo') {
                renderPaginaLimboView();
                lucide.createIcons();
                return;
            }

            if (abaAtiva === 'faturamento') {
                renderPaginaFaturamentoView();
                lucide.createIcons();
                return;
            }

            if (abaAtiva === 'conferencia') {
                renderPaginaConferenciaView();
                lucide.createIcons();
                return;
            }

            if (abaAtiva === 'anexos') {
                renderPaginaAnexosView();
                lucide.createIcons();
                return;
            }

            updateDateLabel();
            const filtered = getFilteredData();
            updateMetrics(filtered);

            const search = (document.getElementById('searchInput')?.value || '').trim();

            if (search) {
                renderSearchResultsView(filtered);
            } else {
                renderWeekGrid(filtered);
            }
            lucide.createIcons();
        }

        function renderPaginaAnexosView() {
            const grid = document.getElementById('calendarGrid');
            if (!grid) return;

            if (!rawAnexosPendentes || rawAnexosPendentes.length === 0) {
                grid.innerHTML = `
                    <div class="bg-white rounded-2xl border border-slate-200 p-8 sm:p-12 text-center text-slate-400 flex flex-col items-center gap-3 shadow-sm">
                        <i data-lucide="check-circle" class="w-10 h-10 sm:w-12 sm:h-12 text-emerald-400 stroke-1"></i>
                        <p class="text-xs font-bold text-slate-600">Não há nenhum anexo pendente para liberação no momento!</p>
                    </div>
                `;
                return;
            }

            const search = (document.getElementById('searchInput')?.value || '').toLowerCase().trim();
            const segmentoFiltro = document.getElementById('segmentoFilter')?.value || '';
            const clienteFiltro = document.getElementById('clientFilter')?.value || '';

            const anexosFiltrados = rawAnexosPendentes.filter(item => {
                if (segmentoFiltro && String(item.segmento || '') !== segmentoFiltro) return false;
                if (clienteFiltro && String(item.cliente || '') !== clienteFiltro) return false;

                if (search) {
                    const matchOrcamento = String(item.n_orcamento || '').toLowerCase().includes(search);
                    const matchCliente = String(item.cliente || '').toLowerCase().includes(search);
                    const matchOS = String(item.cod_os_completo || '').toLowerCase().includes(search);
                    const matchArquivo = String(item.nome_arquivo || '').toLowerCase().includes(search);
                    const matchSubtitulo = String(item.subtitulo || '').toLowerCase().includes(search);
                    if (!matchOrcamento && !matchCliente && !matchOS && !matchArquivo && !matchSubtitulo) return false;
                }

                return true;
            });

            if (anexosFiltrados.length === 0) {
                grid.innerHTML = `
                    <div class="bg-white rounded-2xl border border-teal-200 p-8 sm:p-12 text-center text-slate-400 flex flex-col items-center gap-2 shadow-sm">
                        <i data-lucide="file-x" class="w-10 h-10 text-teal-300 stroke-1"></i>
                        <p class="text-xs font-bold text-slate-600">Nenhum anexo encontrado para os filtros selecionados.</p>
                    </div>
                `;
                return;
            }

            const agrupadoPorOrcamento = {};
            anexosFiltrados.forEach(item => {
                const orc = item.n_orcamento;
                if (!agrupadoPorOrcamento[orc]) {
                    agrupadoPorOrcamento[orc] = {
                        n_orcamento: orc,
                        cliente: item.cliente,
                        arquivos: []
                    };
                }
                agrupadoPorOrcamento[orc].arquivos.push(item);
            });

            const listaOrcamentos = Object.values(agrupadoPorOrcamento);

            let html = `
                <div class="bg-white rounded-2xl border border-teal-200 p-3.5 sm:p-5 shadow-sm mb-4 flex flex-wrap justify-between items-center gap-3">
                    <div class="flex items-center gap-2.5 sm:gap-3">
                        <div class="p-2 sm:p-2.5 bg-teal-100 text-teal-800 rounded-xl">
                            <i data-lucide="paperclip" class="w-5 h-5 sm:w-6 sm:h-6"></i>
                        </div>
                        <div>
                            <h3 class="font-extrabold text-slate-900 text-xs sm:text-base">Anexos Pendentes de Liberação</h3>
                            <p class="text-[10px] sm:text-xs text-slate-500 font-medium">Selecione os arquivos individualmente ou marque a caixa do orçamento.</p>
                        </div>
                    </div>

                    <div class="flex items-center gap-2 flex-wrap">
                        <button onclick="liberarAnexosSelecionados()" 
                                class="px-3.5 py-2 bg-teal-600 hover:bg-teal-700 text-white rounded-xl font-extrabold text-xs transition shadow-sm flex items-center gap-1.5">
                            <i data-lucide="check-square" class="w-4 h-4"></i>
                            <span>Liberar Anexos Selecionados</span>
                        </button>
                    </div>
                </div>

                <div class="space-y-4">
            `;

            listaOrcamentos.forEach(grupo => {
                html += `
                    <div class="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
                        <div class="bg-slate-800 text-white px-3.5 sm:px-4 py-2.5 flex justify-between items-center flex-wrap gap-2">
                            <div class="flex items-center gap-3">
                                <input type="checkbox" onchange="toggleMarcarAnexosDoOrcamento(this, ${grupo.n_orcamento})" 
                                       title="Marcar/Desmarcar todos os arquivos deste orçamento"
                                       class="w-4 h-4 rounded text-teal-500 focus:ring-teal-400 cursor-pointer">
                                <div>
                                    <span class="font-bold text-xs text-teal-400 font-mono">ORÇAMENTO Nº ${grupo.n_orcamento}</span>
                                    <h4 class="font-bold text-xs text-slate-200 uppercase truncate max-w-[260px] sm:max-w-none">${grupo.cliente}</h4>
                                </div>
                            </div>
                            <span class="bg-slate-700 text-teal-300 font-mono text-[10px] font-bold px-2.5 py-1 rounded-lg border border-slate-600">
                                ${grupo.arquivos.length} arquivo(s)
                            </span>
                        </div>

                        <div class="p-3 bg-slate-50/50 space-y-2">
                            ${grupo.arquivos.map(arq => {
                                const itemJson = JSON.stringify({
                                    cod_empresa: arq.cod_empresa,
                                    cod_os_principal: arq.cod_os_principal,
                                    cod_os_aux_principal: arq.cod_os_aux_principal,
                                    cod_os_origem_anexo: arq.cod_os_origem_anexo,
                                    cod_anexo: arq.cod_anexo
                                }).replace(/"/g, '&quot;');

                                const badgeOrigem = arq.origem_anexo === 'ESTRUTURA' 
                                    ? `<span class="bg-purple-100 text-purple-800 border border-purple-300 text-[9px] font-black px-2 py-0.5 rounded-md">ESTRUTURA (OS ${arq.cod_os_origem_anexo})</span>`
                                    : `<span class="bg-blue-100 text-blue-800 border border-blue-300 text-[9px] font-black px-2 py-0.5 rounded-md">OS PRINCIPAL</span>`;

                                return `
                                    <div class="bg-white p-2.5 rounded-xl border border-slate-200 flex flex-wrap items-center justify-between gap-2 text-xs hover:border-teal-300 transition">
                                        <div class="flex items-center gap-3">
                                            <input type="checkbox" 
                                                   data-orcamento="${grupo.n_orcamento}" 
                                                   value="${itemJson}" 
                                                   class="chkAnexoItem w-4 h-4 rounded text-teal-600 focus:ring-teal-500 cursor-pointer">
                                            <div>
                                                <div class="flex items-center gap-2 mb-0.5">
                                                    <span class="font-mono font-bold text-columbia-700">OS ${arq.cod_os_completo}</span>
                                                    ${badgeOrigem}
                                                </div>
                                                <p class="font-bold text-slate-800">${arq.nome_arquivo}</p>
                                                <span class="text-[10px] text-slate-400 font-medium">${arq.subtitulo || ''}</span>
                                            </div>
                                        </div>

                                        <div class="flex items-center gap-2">
                                            <button onclick="visualizarAnexoPendente(event, ${arq.cod_empresa}, ${arq.cod_os_origem_anexo}, ${arq.cod_anexo})" 
                                                    class="px-2.5 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-bold text-[11px] transition flex items-center gap-1 shadow-xs">
                                                <i data-lucide="eye" class="w-3.5 h-3.5"></i>
                                                <span>Ver Anexo</span>
                                            </button>

                                            <button onclick="copiarAnexoParaDesenhos(event, ${arq.cod_empresa}, ${arq.cod_os_principal}, ${arq.cod_os_aux_principal}, ${arq.cod_os_origem_anexo}, ${arq.cod_anexo})" 
                                                    class="px-2.5 py-1 bg-amber-600 hover:bg-amber-700 text-white rounded-lg font-bold text-[11px] transition flex items-center gap-1 shadow-xs">
                                                <i data-lucide="copy" class="w-3.5 h-3.5"></i>
                                                <span>Copiar p/ Desenhos</span>
                                            </button>
                                        </div>
                                    </div>
                                `;
                            }).join('')}
                        </div>
                    </div>
                `;
            });

            html += `</div>`;
            grid.innerHTML = html;
            lucide.createIcons();
        }

        function toggleMarcarAnexosDoOrcamento(masterChk, n_orcamento) {
            const checkboxes = document.querySelectorAll(`.chkAnexoItem[data-orcamento="${n_orcamento}"]`);
            checkboxes.forEach(chk => chk.checked = masterChk.checked);
        }

        async function liberarAnexosSelecionados() {
            const marcados = Array.from(document.querySelectorAll('.chkAnexoItem:checked')).map(chk => JSON.parse(chk.value));

            if (marcados.length === 0) {
                alert("Selecione pelo menos um anexo individual para liberar.");
                return;
            }

            if (!confirm(`Deseja liberar os ${marcados.length} anexo(s) selecionado(s)?`)) return;

            await enviarRequisicaoLiberacao({ anexos: marcados });
        }

        async function copiarAnexoParaDesenhos(event, cod_empresa, cod_os_principal, cod_os_aux_principal, cod_os_origem_anexo, cod_anexo) {
            if (event) event.stopPropagation();

            if (!confirm('Deseja copiar este anexo para a OS Principal e para a Estrutura?')) return;

            try {
                const btnTarget = event ? event.currentTarget : null;
                if (btnTarget) { btnTarget.disabled = true; btnTarget.classList.add('opacity-50'); }

                const response = await fetch(`${API_URL}/copiar-para-desenhos`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        cod_empresa,
                        cod_os_principal,
                        cod_os_aux_principal,
                        cod_os_origem_anexo,
                        cod_anexo
                    })
                });

                if (!response.ok) {
                    const err = await response.json();
                    throw new Error(err.detail || 'Erro ao copiar anexo.');
                }

                const data = await response.json();
                alert(data.mensagem || 'Anexo copiado com sucesso!');
                
                fetchAnexosPendentData();

            } catch (error) {
                alert(`Falha ao copiar anexo: ${error.message}`);
            } finally {
                if (event && event.currentTarget) {
                    event.currentTarget.disabled = false;
                    event.currentTarget.classList.remove('opacity-50');
                }
            }
        }

        async function visualizarAnexoPendente(event, cod_empresa, cod_os_origem_anexo, cod_anexo) {
            if (event) event.stopPropagation();

            try {
                const btnTarget = event ? event.currentTarget : null;
                if (btnTarget) { btnTarget.disabled = true; btnTarget.classList.add('opacity-50'); }

                const url = `${API_URL}/anexo-visualizar?cod_empresa=${cod_empresa}&cod_os=${cod_os_origem_anexo}&cod_os_aux=1&codigo=${cod_anexo}`;
                const response = await fetch(url);

                if (!response.ok) {
                    const err = await response.json();
                    throw new Error(err.detail || 'Não foi possível carregar o anexo de origem.');
                }

                const data = await response.json();
                if (!data.pdf_base64) { alert('Arquivo não encontrado.'); return; }

                const byteCharacters = atob(data.pdf_base64);
                const byteNumbers = new Array(byteCharacters.length);
                for (let i = 0; i < byteCharacters.length; i++) {
                    byteNumbers[i] = byteCharacters.charCodeAt(i);
                }
                const byteArray = new Uint8Array(byteNumbers);
                const fileBlob = new Blob([byteArray], { type: 'application/pdf' });

                const fileURL = URL.createObjectURL(fileBlob);
                window.open(fileURL, '_blank');

            } catch (error) {
                alert(`Erro ao visualizar anexo: ${error.message}`);
            } finally {
                if (event && event.currentTarget) {
                    event.currentTarget.disabled = false;
                    event.currentTarget.classList.remove('opacity-50');
                }
            }
        }

        async function enviarRequisicaoLiberacao(payload) {
            try {
                const response = await fetch(`${API_URL}/liberar-anexos-orcamento`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });

                if (!response.ok) {
                    const err = await response.json();
                    throw new Error(err.detail || 'Erro ao processar liberação.');
                }

                const resData = await response.json();
                alert(`Sucesso! ${resData.registros_afetados || ''} anexo(s) liberado(s).`);
                fetchAnexosPendentData();
            } catch (error) {
                console.error('Erro ao liberar anexos:', error);
                alert(`Falha: ${error.message}`);
            }
        }

        function renderPaginaConferenciaView() {
            const grid = document.getElementById('calendarGrid');
            if (!grid) return;

            updateDateLabel();

            const targetDate = new Date(currentDate);
            let dayOfWeek = targetDate.getDay() - 1;
            if (dayOfWeek === -1) dayOfWeek = 6;

            const wStart = new Date(targetDate);
            wStart.setDate(wStart.getDate() - dayOfWeek);
            wStart.setHours(0,0,0,0);

            const wEnd = new Date(wStart);
            wEnd.setDate(wEnd.getDate() + 6);
            wEnd.setHours(23,59,59,999);

            const filteredConferencia = rawConferenciaData.filter(item => {
                const dtBaseStr = item.dt_finalizacao || item.data_fim || '';
                if (!dtBaseStr) return false;
                const itemDateStr = String(dtBaseStr).substring(0, 10);

                const parts = itemDateStr.split('-');
                if (parts.length === 3) {
                    const itemDate = new Date(parts[0], parts[1] - 1, parts[2]);
                    return itemDate >= wStart && itemDate <= wEnd;
                }
                return false;
            });

            const totalHorasAMaisPeriodo = filteredConferencia.reduce((acc, i) => acc + (parseFloat(i.horas_a_mais) || 0), 0);

            if (filteredConferencia.length === 0) {
                grid.innerHTML = `
                    <div class="bg-white rounded-2xl border border-indigo-200 p-8 sm:p-12 text-center text-slate-400 flex flex-col items-center gap-3 shadow-sm">
                        <i data-lucide="clipboard-x" class="w-10 h-10 sm:w-12 sm:h-12 text-indigo-300 stroke-1"></i>
                        <p class="text-xs font-bold text-slate-600">Nenhum apontamento com horas a mais no período selecionado.</p>
                    </div>
                `;
                return;
            }

            const groupedByDay = {};
            filteredConferencia.forEach(item => {
                const dtBaseStr = item.dt_finalizacao || item.data_fim || 'Sem Data';
                const dateKey = String(dtBaseStr).substring(0, 10);
                if (!groupedByDay[dateKey]) groupedByDay[dateKey] = [];
                groupedByDay[dateKey].push(item);
            });

            const sortedDays = Object.keys(groupedByDay).sort((a, b) => b.localeCompare(a));

            let html = `
                <div class="bg-white rounded-2xl border border-indigo-200 p-3.5 sm:p-5 shadow-sm mb-4 flex flex-wrap justify-between items-center gap-3">
                    <div class="flex items-center gap-2.5 sm:gap-3">
                        <div class="p-2 sm:p-2.5 bg-indigo-100 text-indigo-800 rounded-xl">
                            <i data-lucide="clipboard-check" class="w-5 h-5 sm:w-6 sm:h-6"></i>
                        </div>
                        <div>
                            <h3 class="font-extrabold text-slate-900 text-xs sm:text-base">Conferência de Apontamentos (Horas a Mais)</h3>
                            <p class="text-[10px] sm:text-xs text-slate-500 font-medium">Análise e auditoria dos tempos apontados em excesso.</p>
                        </div>
                    </div>
                    <div class="flex items-center gap-2 sm:gap-3 flex-wrap">
                        <span class="text-[10px] sm:text-xs font-black text-indigo-900 bg-indigo-100 border border-indigo-300 px-2.5 sm:px-3 py-1 sm:py-1.5 rounded-xl">
                            Total: ${filteredConferencia.length} Registro${filteredConferencia.length === 1 ? '' : 's'}
                        </span>
                        <span class="text-[10px] sm:text-xs font-extrabold text-red-600 font-mono bg-red-50 px-2.5 sm:px-3 py-1 sm:py-1.5 rounded-xl border border-red-200">
                            Excesso: ${formatHours(totalHorasAMaisPeriodo)}
                        </span>
                    </div>
                </div>
                <div class="space-y-4">
            `;

            sortedDays.forEach(dateKey => {
                const dayItems = groupedByDay[dateKey];
                dayItems.sort((a, b) => (parseFloat(b.horas_a_mais) || 0) - (parseFloat(a.horas_a_mais) || 0));

                const totalHrsDiaAMais = dayItems.reduce((acc, i) => acc + (parseFloat(i.horas_a_mais) || 0), 0);

                html += `
                    <div class="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
                        <div class="bg-columbia-700 text-white px-3.5 sm:px-4 py-2.5 sm:py-3 flex justify-between items-center flex-wrap gap-2">
                            <div class="flex items-center gap-2 font-bold text-xs tracking-wide">
                                <i data-lucide="calendar-days" class="w-4 h-4 text-columbia-100"></i>
                                <span class="capitalize">${formatDate(dateKey)}</span>
                                <span class="bg-columbia-900 text-columbia-100 px-2 py-0.5 rounded-lg border border-columbia-600 text-[10px]">
                                    ${dayItems.length}
                                </span>
                            </div>
                            <div class="text-[11px] sm:text-xs font-extrabold text-amber-300 font-mono">
                                Dia: ${formatHours(totalHrsDiaAMais)}
                            </div>
                        </div>

                        <div class="p-3 sm:p-4 bg-slate-50/50 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                            ${dayItems.map(item => renderApontamentoCard(item)).join('')}
                        </div>
                    </div>
                `;
            });

            html += `</div>`;
            grid.innerHTML = html;
        }

        function renderApontamentoCard(item) {
            const osCod = item.cod_os_completo || item.n_os || 'S/ OS';
            const funcionario = item.funcionario || 'NÃO INFORMADO';
            const maquina = item.maquina || 'NÃO INFORMADA';
            const servico = item.tiposervico || 'GERAL';
            const titulo = item.titulo || item.subtitulo || 'SEM TÍTULO';
            
            const hrsPrevistas = parseFloat(item.total_hrs) || 0;
            const hrsRealizadas = parseFloat(item.hs_realizadas) || 0;
            const hrsAMais = parseFloat(item.horas_a_mais) || 0;

            return `
                <div class="bg-white border border-slate-200 hover:border-red-400 hover:shadow-md p-3 sm:p-3.5 rounded-2xl transition-all duration-200 flex flex-col justify-between gap-3 relative overflow-hidden">
                    <div class="absolute left-0 top-0 bottom-0 w-1.5 bg-red-500"></div>

                    <div>
                        <div class="flex justify-between items-center mb-1.5 pl-1">
                            <span class="font-mono text-xs font-extrabold text-columbia-700 bg-columbia-50 px-2 py-0.5 rounded-lg border border-columbia-100">
                                OS ${osCod}
                            </span>
                            <span class="text-[10px] font-extrabold px-2 py-0.5 rounded-md bg-red-50 text-red-700 border border-red-200 font-mono">
                                +${formatHours(hrsAMais)}
                            </span>
                        </div>

                        <div class="pl-1 space-y-0.5">
                            <p class="text-xs font-black text-slate-800 line-clamp-1 uppercase" title="${funcionario}">
                                👤 ${funcionario}
                            </p>
                            <p class="text-[11px] font-bold text-slate-600 line-clamp-2 leading-snug" title="${titulo}">
                                ${titulo}
                            </p>
                        </div>
                    </div>

                    <div class="space-y-2 pl-1">
                        <div class="bg-slate-50 p-2 sm:p-2.5 rounded-xl border border-slate-100 text-[10px] space-y-1 font-medium">
                            <div class="flex justify-between items-center"><span class="text-slate-400 font-bold">Máquina:</span> <span class="font-bold text-slate-700 truncate max-w-[120px] sm:max-w-[140px]" title="${maquina}">${maquina}</span></div>
                            <div class="flex justify-between items-center"><span class="text-slate-400 font-bold">Serviço:</span> <span class="font-bold text-columbia-700 truncate max-w-[120px] sm:max-w-[140px]" title="${servico}">${servico}</span></div>
                        </div>

                        <div class="grid grid-cols-2 gap-1.5 text-[10px] bg-red-50/60 p-2 rounded-xl border border-red-100 font-mono">
                            <div>
                                <span class="text-slate-500 block text-[9px]">Previsto:</span>
                                <strong class="text-slate-700 font-bold">${formatHours(hrsPrevistas)}</strong>
                            </div>
                            <div>
                                <span class="text-slate-500 block text-[9px]">Realizado:</span>
                                <strong class="text-red-700 font-extrabold">${formatHours(hrsRealizadas)}</strong>
                            </div>
                        </div>
                    </div>
                </div>
            `;
        }

        function renderPaginaFaturamentoView() {
            const grid = document.getElementById('calendarGrid');
            if (!grid) return;

            updateDateLabel();

            if (isFaturamentoLoading) {
                grid.innerHTML = `
                    <div class="bg-white rounded-2xl border border-blue-200 p-12 text-center text-slate-500 flex flex-col items-center gap-3 shadow-sm">
                        <i data-lucide="loader-2" class="w-10 h-10 text-columbia-600 animate-spin"></i>
                        <div>
                            <h4 class="font-extrabold text-sm text-slate-800">Carregando dados de faturamento...</h4>
                            <p class="text-xs text-slate-400 font-medium mt-1">Buscando as notas e orçamentos atualizados.</p>
                        </div>
                    </div>
                `;
                lucide.createIcons();
                return;
            }

            const selectedYear = currentDate.getFullYear();
            const selectedMonth = currentDate.getMonth() + 1;
            const monthKey = `${selectedYear}-${String(selectedMonth).padStart(2, '0')}`;

            const nowObj = new Date();
            const currYear = nowObj.getFullYear();
            const currMonth = nowObj.getMonth() + 1;
            const currWeekNum = getISOWeekNumber(nowObj);

            const isMesPassado = (selectedYear < currYear) || (selectedYear === currYear && selectedMonth < currMonth);

            const search = (document.getElementById('searchInput')?.value || '').toLowerCase().trim();
            const segmentoFiltro = document.getElementById('segmentoFilter')?.value || '';
            const clienteFiltro = document.getElementById('clientFilter')?.value || '';

            const filteredFat = rawFaturamentoData.filter(item => {
                const fat = parseFloat(item.vl_faturado) || 0;
                const temNF = item.numero_nf && String(item.numero_nf).trim() !== '' && String(item.numero_nf) !== 'None';
                const isFaturado = fat > 0 || temNF;

                let dtRefStr = '';
                if (isFaturado && item.dt_emissao && String(item.dt_emissao).trim() !== 'NaT' && String(item.dt_emissao).trim() !== 'None') {
                    dtRefStr = item.dt_emissao;
                } else {
                    dtRefStr = (item.entrega_normalizada && String(item.entrega_normalizada).trim() !== 'NaT') 
                        ? item.entrega_normalizada 
                        : item.dt_previsao_entrega;
                }

                if (!dtRefStr) return false;
                const itemDateStr = String(dtRefStr).substring(0, 10);

                if (itemDateStr.substring(0, 7) !== monthKey) return false;
                if (segmentoFiltro && String(item.segmento || '') !== segmentoFiltro) return false;
                if (clienteFiltro && String(item.cliente || '') !== clienteFiltro) return false;

                if (search) {
                    const mCliente = String(item.cliente || '').toLowerCase().includes(search);
                    const mOrcamento = String(item.n_orcamento || '').toLowerCase().includes(search);
                    const mOS = String(item.n_os || '').toLowerCase().includes(search);
                    const mCod = String(item.cod_interno || '').toLowerCase().includes(search);
                    const mDesc = String(item.descricao || '').toLowerCase().includes(search);
                    const mNF = String(item.numero_nf || '').toLowerCase().includes(search);
                    if (!mCliente && !mOrcamento && !mOS && !mCod && !mDesc && !mNF) return false;
                }

                return true;
            });

            if (filteredFat.length === 0) {
                grid.innerHTML = `
                    <div class="bg-white rounded-2xl border border-blue-200 p-8 sm:p-12 text-center text-slate-400 flex flex-col items-center gap-3 shadow-sm">
                        <i data-lucide="package-x" class="w-10 h-10 sm:w-12 sm:h-12 text-blue-300 stroke-1"></i>
                        <p class="text-xs font-bold text-slate-600">Nenhum registro de faturamento encontrado para o mês selecionado com os filtros atuais.</p>
                    </div>
                `;
                return;
            }

            const budgetGrouped = {};
            filteredFat.forEach(item => {
                const fat = parseFloat(item.vl_faturado) || 0;
                const temNF = item.numero_nf && String(item.numero_nf).trim() !== '' && String(item.numero_nf) !== 'None';
                const isFaturado = fat > 0 || temNF;

                const statusKey = isFaturado ? 'FATURADO' : 'PENDENTE';
                const groupKey = `${String(item.n_orcamento || 'SEM_ORCAMENTO').trim()}_${statusKey}`;

                let dtRefStr = '';
                if (isFaturado && item.dt_emissao && String(item.dt_emissao).trim() !== 'NaT' && String(item.dt_emissao).trim() !== 'None') {
                    dtRefStr = item.dt_emissao;
                } else {
                    dtRefStr = (item.entrega_normalizada && String(item.entrega_normalizada).trim() !== 'NaT') 
                        ? item.entrega_normalizada 
                        : item.dt_previsao_entrega;
                }

                const nfNum = (temNF) ? String(item.numero_nf).trim() : '';

                if (!budgetGrouped[groupKey]) {
                    budgetGrouped[groupKey] = {
                        n_orcamento: item.n_orcamento || '-',
                        cliente: item.cliente || '-',
                        cod_interno: item.cod_interno || '-',
                        dt_previsao_entrega: item.dt_previsao_entrega,
                        entrega_normalizada: item.entrega_normalizada,
                        dt_emissao: item.dt_emissao,
                        dt_referencia: dtRefStr,
                        os_set: new Set(),
                        primeira_os: item.n_os ? String(item.n_os).trim() : '',
                        vl_faturado: 0,
                        vl_a_faturar: 0,
                        numero_nf: nfNum,
                        is_faturado: isFaturado
                    };
                }

                if (item.n_os) {
                    budgetGrouped[groupKey].os_set.add(String(item.n_os).trim());
                    if (!budgetGrouped[groupKey].primeira_os) {
                        budgetGrouped[groupKey].primeira_os = String(item.n_os).trim();
                    }
                }

                let aFat = parseFloat(item.vl_a_faturar) || 0;
                if (isMesPassado) {
                    aFat = 0;
                }

                budgetGrouped[groupKey].vl_faturado += fat;
                budgetGrouped[groupKey].vl_a_faturar += aFat;

                if (nfNum && !budgetGrouped[groupKey].numero_nf) {
                    budgetGrouped[groupKey].numero_nf = nfNum;
                }
            });

            const consolidatedList = Object.values(budgetGrouped);

            const totalFaturadoVal = consolidatedList.reduce((acc, i) => acc + i.vl_faturado, 0);
            const totalAFaturarVal = isMesPassado ? 0 : consolidatedList.reduce((acc, i) => acc + i.vl_a_faturar, 0);
            const totalGeralVal = totalFaturadoVal + totalAFaturarVal;

            const groupedByWeek = {};
            consolidatedList.forEach(item => {
                const dtRef = item.dt_referencia;
                const weekNum = getISOWeekNumber(dtRef);
                const weekDateRange = getWeekDateRangeStr(dtRef);
                const weekName = `SEMANA ${weekNum} (${weekDateRange})`;

                if (!groupedByWeek[weekName]) {
                    groupedByWeek[weekName] = {
                        num: weekNum,
                        name: weekName,
                        items: []
                    };
                }
                groupedByWeek[weekName].items.push(item);
            });

            let html = `
                <div class="bg-white rounded-2xl border border-blue-200 p-3.5 sm:p-5 shadow-sm mb-4 flex flex-wrap justify-between items-center gap-3">
                    <div class="flex items-center gap-2.5 sm:gap-3">
                        <div class="p-2 sm:p-2.5 bg-blue-100 text-blue-800 rounded-xl">
                            <i data-lucide="package-check" class="w-5 h-5 sm:w-6 sm:h-6"></i>
                        </div>
                        <div>
                            <h3 class="font-extrabold text-slate-900 text-xs sm:text-base">Controle de Faturamento & Entregas</h3>
                            <p class="text-[10px] sm:text-xs text-slate-500 font-medium">Previsão e status de faturamento por cliente e orçamento.</p>
                        </div>
                    </div>
                    <div class="flex items-center gap-2 sm:gap-3 flex-wrap">
                        <div class="bg-slate-50 px-2.5 sm:px-3.5 py-1.5 sm:py-2 rounded-xl border border-slate-200 text-right">
                            <span class="text-[8px] sm:text-[9px] uppercase font-bold text-slate-400 block">Total Faturado</span>
                            <span class="text-xs sm:text-sm font-black text-emerald-600 font-mono">${formatBRL(totalFaturadoVal)}</span>
                        </div>
                        <div class="bg-slate-50 px-2.5 sm:px-3.5 py-1.5 sm:py-2 rounded-xl border border-slate-200 text-right">
                            <span class="text-[8px] sm:text-[9px] uppercase font-bold text-slate-400 block">A Faturar</span>
                            <span class="text-xs sm:text-sm font-black text-blue-600 font-mono">${formatBRL(totalAFaturarVal)}</span>
                        </div>
                        <div class="bg-columbia-700 text-white px-3 sm:px-4 py-1.5 sm:py-2 rounded-xl text-right shadow-xs">
                            <span class="text-[8px] sm:text-[9px] uppercase font-bold text-columbia-100 block">Total Geral</span>
                            <span class="text-xs sm:text-base font-extrabold text-amber-300 font-mono">${formatBRL(totalGeralVal)}</span>
                        </div>
                    </div>
                </div>

                <div class="space-y-4">
            `;

            const sortedWeeks = Object.values(groupedByWeek).sort((a, b) => a.num - b.num);

            sortedWeeks.forEach(weekGroup => {
                const weekNum = weekGroup.num;
                const items = weekGroup.items;

                if (weekNum === currWeekNum && !isMesPassado) {
                    items.sort((a, b) => {
                        if (a.is_faturado === b.is_faturado) {
                            return String(a.dt_referencia).localeCompare(String(b.dt_referencia));
                        }
                        return a.is_faturado ? -1 : 1;
                    });
                } else {
                    items.sort((a, b) => String(a.dt_referencia).localeCompare(String(b.dt_referencia)));
                }

                const subtotalSemana = items.reduce((acc, i) => acc + (i.is_faturado ? i.vl_faturado : i.vl_a_faturar), 0);

                html += `
                    <div class="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
                        <div class="bg-columbia-800 text-white px-3.5 sm:px-4 py-2.5 flex justify-between items-center flex-wrap gap-2 border-b border-columbia-900">
                            <div class="flex items-center gap-2 font-bold text-xs">
                                <i data-lucide="layers" class="w-4 h-4 text-columbia-100"></i>
                                <span class="uppercase tracking-wider font-extrabold text-[11px] sm:text-xs">${weekGroup.name}</span>
                                <span class="bg-columbia-900 text-columbia-100 px-2 py-0.5 rounded-md text-[10px] font-mono">
                                    ${items.length}
                                </span>
                            </div>
                            <div class="text-[11px] sm:text-xs font-extrabold text-emerald-300 font-mono">
                                TOTAL: ${formatBRL(subtotalSemana)}
                            </div>
                        </div>

                        <div class="overflow-x-auto custom-scroll">
                            <table class="w-full text-left text-[11px] border-collapse min-w-[650px]">
                                <thead>
                                    <tr class="bg-slate-100 text-slate-600 font-bold border-b border-slate-200 uppercase text-[9.5px]">
                                        <th class="p-2.5">Orçamento</th>
                                        <th class="p-2.5">Cliente</th>
                                        <th class="p-2.5">Caixa exportação</th>
                                        <th class="p-2.5">OS</th>
                                        <th class="p-2.5 text-center">Data Inicial</th>
                                        <th class="p-2.5 text-center">Faturado</th>
                                        <th class="p-2.5 text-center">Data Prevista / Emissão</th>
                                        <th class="p-2.5 text-right">Valor</th>
                                        <th class="p-2.5 text-center">Ação</th>
                                    </tr>
                                </thead>
                                <tbody class="divide-y divide-slate-100 font-medium">
                                    ${items.map(item => {
                                        const isFaturado = item.is_faturado;
                                        const valorExibir = isFaturado ? item.vl_faturado : item.vl_a_faturar;
                                        const dtInicial = formatDate(item.dt_previsao_entrega);
                                        
                                        const dtPrevistaOuEmissao = isFaturado ? formatDate(item.dt_emissao || item.entrega_normalizada) : formatDate(item.entrega_normalizada);
                                        
                                        const osListStr = Array.from(item.os_set).map(o => `OS ${o}`).join(' - ');
                                        const nfBadgeText = (isFaturado && item.numero_nf) ? `FATURADO (NF ${item.numero_nf})` : 'FATURADO';

                                        return `
                                            <tr class="${isFaturado ? 'bg-emerald-50/80 hover:bg-emerald-100/70' : 'hover:bg-slate-50'} transition-colors">
                                                <td class="p-2.5 font-bold font-mono text-columbia-700">${item.n_orcamento}</td>
                                                <td class="p-2.5 font-bold text-slate-800 uppercase max-w-[180px] truncate" title="${item.cliente}">${item.cliente}</td>
                                                <td class="p-2.5 font-mono text-slate-600">${item.cod_interno !== '-' ? item.cod_interno : ''}</td>
                                                <td class="p-2.5 font-mono font-bold text-slate-700 max-w-[200px] truncate" title="${osListStr}">${osListStr}</td>
                                                <td class="p-2.5 text-center font-bold text-slate-600">${dtInicial}</td>
                                                <td class="p-2.5 text-center whitespace-nowrap">
                                                    <span class="px-2 py-0.5 rounded-md text-[9px] font-black uppercase ${isFaturado ? 'bg-emerald-200 text-emerald-900 border border-emerald-300' : 'bg-slate-100 text-slate-500 border border-slate-200'}">
                                                        ${isFaturado ? nfBadgeText : '-'}
                                                    </span>
                                                </td>
                                                <td class="p-2.5 text-center font-bold ${isFaturado ? 'text-emerald-700' : 'text-red-600'}">${dtPrevistaOuEmissao}</td>
                                                <td class="p-2.5 text-right font-mono font-bold ${isFaturado ? 'text-emerald-700' : 'text-slate-800'}">${formatBRL(valorExibir)}</td>
                                                <td class="p-2.5 text-center whitespace-nowrap">
                                                    ${item.primeira_os ? `
                                                        <button onclick="abrirModalRenegociacaoPelaOS('${item.primeira_os}')" 
                                                                class="p-1.5 bg-purple-100 hover:bg-purple-200 text-purple-800 rounded-lg font-bold text-[10px] transition border border-purple-200 flex items-center justify-center gap-1 mx-auto shadow-xs"
                                                                title="Alterar Data Renegociada da OS ${item.primeira_os}">
                                                            <i data-lucide="calendar-cog" class="w-3.5 h-3.5 text-purple-700"></i>
                                                            <span class="hidden sm:inline">Renegociar</span>
                                                        </button>
                                                    ` : '-'}
                                                </td>
                                            </tr>
                                        `;
                                    }).join('')}
                                </tbody>
                            </table>
                        </div>
                    </div>
                `;
            });

            html += `</div>`;
            grid.innerHTML = html;
        }

        function renderPaginaLimboView() {
            const grid = document.getElementById('calendarGrid');
            if (!grid) return;

            let limboItems = rawData.filter(i => String(i.u_limbo) === '1' || i.u_limbo === 1);

            limboItems.sort((a, b) => {
                const dateA = a.entrega_normalizada || '';
                const dateB = b.entrega_normalizada || '';
                return dateA.localeCompare(dateB);
            });

            const totalValorLimbo = limboItems.reduce((acc, i) => acc + parseValue(i.preco_geral_a_vista || i.orcamento), 0);

            let html = `
                <div class="bg-white rounded-2xl border border-amber-300 p-4 sm:p-5 shadow-md">
                    <div class="flex flex-wrap justify-between items-center border-b border-amber-100 pb-4 mb-5 gap-3">
                        <div class="flex items-center gap-3">
                            <div class="p-2 bg-amber-100 text-amber-900 rounded-xl">
                                <i data-lucide="ghost" class="w-6 h-6"></i>
                            </div>
                            <div>
                                <h3 class="font-extrabold text-slate-900 text-sm sm:text-base">Ordens de Serviço no Limbo (Arquivadas)</h3>
                                <p class="text-[11px] sm:text-xs text-slate-500 font-medium">Lista de OSs removidas temporariamente do planejamento de produção.</p>
                            </div>
                        </div>
                        <div class="flex items-center gap-2 sm:gap-3 flex-wrap">
                            <span class="text-xs font-black text-amber-900 bg-amber-100 border border-amber-300 px-3 py-1.5 rounded-xl">
                                Total: ${limboItems.length} OS${limboItems.length === 1 ? '' : 's'}
                            </span>
                            <span class="text-xs font-extrabold text-emerald-600 font-mono bg-emerald-50 px-3 py-1.5 rounded-xl border border-emerald-200">
                                ${formatBRL(totalValorLimbo)}
                            </span>
                        </div>
                    </div>

                    ${limboItems.length === 0 ? `
                        <div class="flex flex-col items-center justify-center py-12 sm:py-16 text-slate-400 gap-3">
                            <i data-lucide="sparkles" class="w-10 h-10 sm:w-12 sm:h-12 stroke-1 text-amber-400"></i>
                            <p class="text-xs font-bold text-slate-600">Nenhuma Ordem de Serviço no Limbo no momento!</p>
                        </div>
                    ` : `
                        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3.5">
                            ${limboItems.map(item => renderOSCard(item)).join('')}
                        </div>
                    `}
                </div>
            `;
            grid.innerHTML = html;
        }

        function renderSearchResultsView(filtered) {
            const grid = document.getElementById('calendarGrid');
            if (!grid) return;

            filtered.sort((a, b) => {
                const dateA = a.entrega_normalizada || '';
                const dateB = b.entrega_normalizada || '';
                return dateA.localeCompare(dateB);
            });

            const totalValorBusca = filtered.reduce((acc, i) => acc + parseValue(i.preco_geral_a_vista || i.orcamento), 0);

            let html = `
                <div class="bg-white rounded-2xl border border-slate-200 p-3.5 sm:p-4 shadow-sm">
                    <div class="flex flex-wrap justify-between items-center border-b border-slate-100 pb-3 mb-4 gap-2">
                        <div class="flex items-center gap-2">
                            <i data-lucide="search-check" class="w-5 h-5 text-columbia-700"></i>
                            <h3 class="font-extrabold text-slate-800 text-xs sm:text-sm">
                                Resultado da Busca Global (${filtered.length} OS${filtered.length === 1 ? '' : 's'})
                            </h3>
                        </div>
                        <span class="text-xs font-extrabold text-emerald-600 font-mono">
                            Total: ${formatBRL(totalValorBusca)}
                        </span>
                    </div>

                    ${filtered.length === 0 ? `
                        <div class="flex flex-col items-center justify-center py-10 sm:py-12 text-slate-400 gap-2">
                            <i data-lucide="file-x" class="w-10 h-10 stroke-1 text-slate-300"></i>
                            <p class="text-xs font-semibold">Nenhuma Ordem de Serviço encontrada para o termo pesquisado.</p>
                        </div>
                    ` : `
                        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3.5">
                            ${filtered.map(item => renderOSCard(item)).join('')}
                        </div>
                    `}
                </div>
            `;
            grid.innerHTML = html;
        }

        function renderOSCard(item) {
            const isAtrasado = String(item.atrasada || '').toLowerCase() === 'sim' || String(item.atrasada || '').toLowerCase() === 's';
            const prodStatus = item.status_producao || '0%';
            const clienteNome = item.cliente || 'CLIENTE NÃO INFORMADO';
            const origem = item.origem || 'SEM ORIGEM';
            const osNome = item.titulo || 'SEM NOME';
            const segmento = item.segmento || 'GERAL';

            const compras = item.status_compras || 'N/A';
            const terceiros = item.status_terceiros || 'N/A';
            const engenharia = item.engenharia_status || 'N/A';
            const ppPendentes = item.pp_pendentes || 'Nenhum processo pendente';

            const temApontamentoAberto = String(item.tem_apontamento_aberto || '').toLowerCase() === 'sim';
            const detalheApontamento = item.apontamentos_abertos_detalhe || 'Nenhum operador apontando no momento';

            const dtAbertura = formatDate(item.abertura_os);
            const dtPrevOrcamento = formatDate(item.prev_entrega_orcamento);
            const dtRenegociada = formatDate(item.dt_renegociada || item.u_data_renegociacao);
            const dtUltimoApontamento = formatDate(item.ultimo_apontamento);

            const anexos = Array.isArray(item.anexos) ? item.anexos : [];
            const temAnexoPdf = anexos.length > 0;

            const nOsClean = String(item.n_os).trim();

            return `
                <div onclick="openModal('${nOsClean}')" class="group bg-white border border-slate-200 hover:border-columbia-500 hover:shadow-md p-3.5 rounded-2xl cursor-pointer transition-all duration-200 flex flex-col justify-between gap-2.5 relative overflow-hidden">
                    <div class="absolute left-0 top-0 bottom-0 w-1.5 ${isAtrasado ? 'bg-red-500' : 'bg-emerald-500'}"></div>

                    <div>
                        <div class="flex justify-between items-center mb-1 pl-1">
                            <span class="font-mono text-xs font-extrabold text-columbia-700 bg-columbia-50 px-2 py-0.5 rounded-lg border border-columbia-100">
                                OS ${item.n_os}
                            </span>

                            <div class="flex items-center gap-1.5">
                                ${temAnexoPdf ? `
                                    <button onclick="abrirDesenhoAnexo(event, ${item.cod_empresa}, ${item.cod_os}, ${anexos[0].cod_os_aux})" 
                                            class="bg-blue-600 hover:bg-blue-700 text-white text-[10px] font-black px-2 py-0.5 rounded-md flex items-center gap-1 shadow-xs transition animate-pulse" 
                                            title="Abrir Desenho Técnico PDF">
                                        <i data-lucide="paperclip" class="w-3 h-3"></i>
                                        <span>PDF</span>
                                    </button>
                                ` : ''}

                                <span class="text-[10px] font-extrabold px-2 py-0.5 rounded-full ${isAtrasado ? 'bg-red-50 text-red-600 border border-red-200' : 'bg-emerald-50 text-emerald-600 border border-emerald-200'}">
                                    ${isAtrasado ? 'Atrasado' : 'No prazo'}
                                </span>
                            </div>
                        </div>

                        <div class="pl-1 space-y-0.5">
                            <p class="text-xs font-black text-slate-800 tracking-tight group-hover:text-columbia-600 transition-colors uppercase">
                                <span class="text-[9px] text-slate-400 font-normal">Origem:</span> ${origem}
                            </p>
                            <p class="text-[11px] font-bold text-slate-700 line-clamp-2 leading-snug" title="${osNome}">${osNome}</p>
                        </div>
                    </div>

                    <div class="space-y-2 pl-1">
                        <div class="flex items-center justify-between text-[10px] pt-1.5 border-t border-slate-100">
                            <span class="bg-slate-100 text-slate-700 font-bold px-2 py-0.5 rounded-md border border-slate-200 uppercase">${segmento}</span>
                            <span class="text-slate-500 font-semibold uppercase truncate max-w-[130px]" title="${clienteNome}">${clienteNome}</span>
                        </div>

                        <div class="grid grid-cols-1 gap-1 text-[10px] bg-slate-50/80 p-2.5 rounded-xl border border-slate-100 font-medium">
                            <div class="flex justify-between items-center"><span class="text-slate-400 font-bold">Compras:</span> <span class="font-bold text-slate-700 truncate max-w-[140px]">${compras}</span></div>
                            <div class="flex justify-between items-center"><span class="text-slate-400 font-bold">Terceiros:</span> <span class="font-bold text-slate-700 truncate max-w-[140px]">${terceiros}</span></div>
                            <div class="flex justify-between items-center"><span class="text-slate-400 font-bold">Engenharia:</span> <span class="font-bold text-slate-700 truncate max-w-[140px]">${engenharia}</span></div>
                            <div class="flex justify-between items-center pt-1 border-t border-slate-200/60 mt-0.5"><span class="text-slate-500 font-extrabold">Produção:</span> <span class="font-black text-columbia-700 font-mono text-xs">${prodStatus}</span></div>
                        </div>

                        <div class="bg-amber-50/70 border border-amber-200/70 p-2 rounded-xl text-[10px]">
                            <span class="font-extrabold text-amber-800 uppercase block text-[9px] mb-0.5">PP Pendentes:</span>
                            <p class="text-slate-700 font-medium line-clamp-2 leading-tight" title="${ppPendentes}">${ppPendentes}</p>
                        </div>

                        <div class="${temApontamentoAberto ? 'bg-emerald-50 border-emerald-300' : 'bg-red-50 border-red-200'} border p-2 rounded-xl text-[10px] transition-all">
                            <div class="flex items-center justify-between gap-1 mb-1">
                                <div class="flex items-center gap-1.5">
                                    <span class="relative flex h-2.5 w-2.5">
                                        ${temApontamentoAberto ? `<span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>` : ''}
                                        <span class="relative inline-flex rounded-full h-2.5 w-2.5 ${temApontamentoAberto ? 'bg-emerald-500' : 'bg-red-500'}"></span>
                                    </span>
                                    <span class="font-extrabold uppercase text-[9px] ${temApontamentoAberto ? 'text-emerald-800' : 'text-red-800'}">
                                        Apontamento
                                    </span>
                                </div>
                                <span class="text-[9px] font-black uppercase px-1.5 py-0.2 rounded ${temApontamentoAberto ? 'bg-emerald-200 text-emerald-900 animate-pulse' : 'bg-red-200 text-red-800'}">
                                    ${temApontamentoAberto ? 'Em Andamento ⚙️' : 'Parado'}
                                </span>
                            </div>
                            <p class="font-mono text-[9.5px] leading-tight ${temApontamentoAberto ? 'text-emerald-900 font-bold' : 'text-red-600 italic'}" title="${detalheApontamento}">
                                ${detalheApontamento}
                            </p>
                        </div>

                        <div class="grid grid-cols-2 gap-1 text-[9px] text-slate-400 border-t border-slate-100 pt-1.5 font-medium leading-tight">
                            <div><span>Abertura:</span> <strong class="text-slate-600">${dtAbertura}</strong></div>
                            <div><span>Prev. Orç:</span> <strong class="text-slate-600">${dtPrevOrcamento}</strong></div>
                            <div><span>Renegociada:</span> <strong class="text-purple-700 font-bold">${dtRenegociada}</strong></div>
                            <div><span>Últ. Apont:</span> <strong class="text-slate-600">${dtUltimoApontamento}</strong></div>
                        </div>
                    </div>
                </div>
            `;
        }

        function renderWeekGrid(filtered) {
            const grid = document.getElementById('calendarGrid');
            if (!grid) return;

            const targetDate = new Date(currentDate);
            let dayOfWeek = targetDate.getDay() - 1; 
            if (dayOfWeek === -1) dayOfWeek = 6;

            const wStart = new Date(targetDate);
            wStart.setDate(wStart.getDate() - dayOfWeek);

            const wEnd = new Date(wStart);
            wEnd.setDate(wEnd.getDate() + 6);

            const weekNum = getISOWeekNumber(wStart);

            const fmtDay = (d) => String(d.getDate()).padStart(2, '0');
            const fmtMonth = (d) => String(d.getMonth() + 1).padStart(2, '0');
            
            const startStr = `${wStart.getFullYear()}-${fmtMonth(wStart)}-${fmtDay(wStart)}`;
            const endStr = `${wEnd.getFullYear()}-${fmtMonth(wEnd)}-${fmtDay(wEnd)}`;
            const rangeText = `${fmtDay(wStart)}/${fmtMonth(wStart)} a ${fmtDay(wEnd)}/${fmtMonth(wEnd)}/${wStart.getFullYear()}`;

            const weekItems = filtered.filter(i => {
                if (!i.entrega_normalizada) return false;
                const dateKey = String(i.entrega_normalizada).substring(0, 10);
                return dateKey >= startStr && dateKey <= endStr;
            });

            weekItems.sort((a, b) => {
                const dateA = a.entrega_normalizada || '';
                const dateB = b.entrega_normalizada || '';
                return dateA.localeCompare(dateB);
            });

            const weekTotalVal = weekItems.reduce((acc, i) => acc + parseValue(i.preco_geral_a_vista || i.orcamento), 0);

            let html = `
                <div class="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-md flex flex-col">
                    <div class="bg-columbia-700 text-white p-3.5 sm:p-4 flex flex-wrap justify-between items-center gap-3">
                        <div class="flex items-center gap-3">
                            <span class="bg-columbia-900 border border-columbia-500 text-white font-extrabold text-xs sm:text-sm px-2.5 sm:px-3 py-1 rounded-xl shadow-xs">
                                Semana ${weekNum}
                            </span>
                            <div>
                                <h4 class="font-extrabold text-xs sm:text-sm tracking-wide">Programação Semanal</h4>
                                <p class="text-[10px] sm:text-xs text-columbia-100 font-medium">${rangeText}</p>
                            </div>
                        </div>

                        <div class="flex items-center gap-3 sm:gap-4">
                            <div class="text-right">
                                <span class="text-[9px] uppercase font-bold text-columbia-200 block">Total Previsto</span>
                                <span class="text-xs sm:text-base font-extrabold text-emerald-300 font-mono">${formatBRL(weekTotalVal)}</span>
                            </div>
                            <span class="bg-columbia-800 text-white text-[10px] sm:text-xs font-bold px-2.5 sm:px-3 py-1 sm:py-1.5 rounded-xl border border-columbia-600">
                                ${weekItems.length} OS${weekItems.length === 1 ? '' : 's'}
                            </span>
                        </div>
                    </div>

                    <div class="p-3 sm:p-4 bg-slate-50/50">
                        ${weekItems.length === 0 ? `
                            <div class="flex flex-col items-center justify-center py-12 sm:py-16 text-slate-400 gap-2">
                                <i data-lucide="calendar-x" class="w-10 h-10 stroke-1 text-slate-300"></i>
                                <p class="text-xs font-semibold">Nenhuma Ordem de Serviço agendada para esta semana.</p>
                            </div>
                        ` : `
                            <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3.5">
                                ${weekItems.map(item => renderOSCard(item)).join('')}
                            </div>
                        `}
                    </div>
                </div>
            `;

            grid.innerHTML = html;
        }

        function toggleConcluidasFilter() {
            showConcluidas = !showConcluidas;
            const btn = document.getElementById('btnToggleConcluidas');
            const txt = document.getElementById('txtToggleConcluidas');
            if (btn && txt) {
                if (showConcluidas) {
                    txt.textContent = 'Ocultar OS Concluída';
                    btn.className = "px-3 py-2 bg-columbia-700 text-white rounded-xl text-xs font-semibold transition flex items-center gap-1.5 shadow-sm";
                } else {
                    txt.textContent = 'Exibir OS Concluída';
                    btn.className = "px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-300 rounded-xl text-xs font-semibold transition flex items-center gap-1.5";
                }
            }
            renderView();
        }

        function toggleOrcamentoFilter() {
            onlyWithBudget = !onlyWithBudget;
            const btn = document.getElementById('btnToggleOrcamento');
            const txt = document.getElementById('txtToggleOrcamento');
            if (!onlyWithBudget) {
                txt.textContent = 'Exibir somente com Orçamentos';
                btn.className = "px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-300 rounded-xl text-xs font-semibold transition flex items-center gap-1.5";
            } else {
                txt.textContent = 'Exibir todas as OS';
                btn.className = "px-3 py-2 bg-emerald-600 text-white rounded-xl text-xs font-semibold transition flex items-center gap-1.5 shadow-sm";
            }
            renderView();
        }

        function clearAllFilters() {
            document.getElementById('searchInput').value = '';
            document.getElementById('atrasadaFilter').value = '';
            document.getElementById('apontamentoAbertoFilter').value = '';
            document.getElementById('segmentoFilter').value = '';
            document.getElementById('producaoFilter').value = '';
            document.getElementById('clientFilter').value = '';
            document.getElementById('engenhariaFilter').value = '';
            document.getElementById('comprasFilter').value = '';
            document.getElementById('terceirosFilter').value = '';
            showConcluidas = false;
            
            const btnC = document.getElementById('btnToggleConcluidas');
            const txtC = document.getElementById('txtToggleConcluidas');
            if (btnC && txtC) {
                txtC.textContent = 'Exibir OS Concluída';
                btnC.className = "px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-300 rounded-xl text-xs font-semibold transition flex items-center gap-1.5";
            }

            renderView();
        }

        function handleValueVisibility() {
            if (isValuesUnlocked) {
                isValuesUnlocked = false;
                updateValueVisibilityUI();
                renderView();
            } else {
                openPasswordModal();
            }
        }

        function updateValueVisibilityUI() {
            const txt = document.getElementById('txtValueVisibility');
            const icon = document.getElementById('iconValueVisibility');
            if (isValuesUnlocked) {
                txt.textContent = 'Ocultar Valores';
                icon.setAttribute('data-lucide', 'eye');
            } else {
                txt.textContent = 'Exibir Valores';
                icon.setAttribute('data-lucide', 'eye-off');
            }
            lucide.createIcons();
        }

        function openPasswordModal() {
            const modal = document.getElementById('passwordModal');
            const input = document.getElementById('inputPassword');
            const err = document.getElementById('passwordError');
            if (input) input.value = '';
            if (err) err.classList.add('hidden');
            if (modal) {
                modal.classList.remove('hidden');
                modal.classList.add('flex');
            }
        }

        function closePasswordModal() {
            const modal = document.getElementById('passwordModal');
            if (modal) {
                modal.classList.add('hidden');
                modal.classList.remove('flex');
            }
        }

        function validatePassword() {
            const input = document.getElementById('inputPassword').value;
            if (input === 'Colmac@2026') {
                isValuesUnlocked = true;
                closePasswordModal();
                updateValueVisibilityUI();
                renderView();
            } else {
                document.getElementById('passwordError').classList.remove('hidden');
            }
        }

        function checkPasswordKey(e) {
            if (e.key === 'Enter') validatePassword();
        }

        function togglePasswordVisibility() {
            const input = document.getElementById('inputPassword');
            const eye = document.getElementById('eyeIcon');
            if (input.type === 'password') {
                input.type = 'text';
                eye.setAttribute('data-lucide', 'eye-off');
            } else {
                input.type = 'password';
                eye.setAttribute('data-lucide', 'eye');
            }
            lucide.createIcons();
        }

        async function alterarStatusLimbo(n_os, valorLimbo) {
            const btnLimbo = document.getElementById('btnEnviarLimbo');
            const acaoTexto = valorLimbo === 1 ? 'enviar para o limbo' : 'tirar do limbo';
            
            if (!confirm(`Deseja realmente ${acaoTexto} a OS ${n_os}?`)) {
                return;
            }

            try {
                if (btnLimbo) {
                    btnLimbo.disabled = true;
                    btnLimbo.classList.add('opacity-50');
                }

                const limboUrl = `${API_URL}/${n_os}/limbo`;

                const response = await fetch(limboUrl, {
                    method: 'PATCH',
                    headers: { 
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ u_limbo: valorLimbo })
                });

                if (!response.ok) {
                    const errorData = await response.json();
                    throw new Error(errorData.detail || 'Falha ao alterar o status de limbo da OS.');
                }

                closeModal();
                fetchData();

            } catch (error) {
                console.error('Erro ao alterar limbo:', error);
                alert(`Erro: ${error.message}`);
            } finally {
                if (btnLimbo) {
                    btnLimbo.disabled = false;
                    btnLimbo.classList.remove('opacity-50');
                }
            }
        }

        function executarAcaoLimbo() {
            if (!selectedItemModal) return;
            const estaNoLimbo = String(selectedItemModal.u_limbo) === '1' || selectedItemModal.u_limbo === 1;
            const novoValor = estaNoLimbo ? 0 : 1;
            alterarStatusLimbo(selectedItemModal.n_os, novoValor);
        }
    