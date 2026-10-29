let __firstCostTableRender=true;
let selectedYears=new Set(),selectedMonths=new Set(),periodInitialized=false;
const MONTH_NAMES=['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
function cell(r,c){const v=r[c[0]],t=c[3];if(t==='money')return money(v);if(t==='num')return number(v);if(t==='int')return String(v||'');if(t==='pct')return percent(v);if(t==='date')return dateBR(v);return String(v==null?'':v)}function fval(r,k){const c=columns().find(x=>x[0]===k);return c?cell(r,c):String(r[k]??'')}
function filteredRows(){let out=rows.slice();out=out.filter(r=>{const d=String(r.dt_emissao||''),y=Number(d.slice(0,4)||0),m=Number(d.slice(5,7)||0);if(selectedYears.size&&!selectedYears.has(y))return false;if(selectedMonths.size&&!selectedMonths.has(m))return false;for(const k in columnFilters){const s=columnFilters[k];if(s?.size&&!s.has(fval(r,k)))return false}return true});if(sortState.key){const k=sortState.key,dir=sortState.dir==='asc'?1:-1;out.sort((a,b)=>{let x=a[k],y=b[k];if(typeof x==='number'||typeof y==='number'){x=n(x);y=n(y)}else{x=norm(x);y=norm(y)}return x<y?-dir:x>y?dir:0})}return out}
function renderTable(){const data=filteredRows(),cols=columns(),tableWidth=cols.reduce((s,c)=>s+Number(c[2]||0),0);let h='<table class="gridt" style="width:'+tableWidth+'px;min-width:'+tableWidth+'px"><colgroup>'+cols.map(c=>'<col style="width:'+c[2]+'px">').join('')+'</colgroup><thead><tr>'+cols.map(c=>'<th><div class="flex items-center justify-between gap-1"><button onclick="sortBy(\''+c[0]+'\')" class="truncate">'+esc(c[1])+' '+(sortState.key===c[0]?(sortState.dir==='asc'?'▲':'▼'):'↕')+'</button><button class="fb '+(columnFilters[c[0]]?.size?'active':'')+'" onclick="event.stopPropagation();openColumnFilter(\''+c[0]+'\')">▼</button></div></th>').join('')+'</tr></thead><tbody>';h+=data.map(r=>'<tr>'+cols.map(c=>{const cls=(['money','num','int','pct'].includes(c[3])?'num ':'')+(c[3]==='os'?'os ':'')+((c[0]==='margem'||c[0]==='margem_pct')&&r.margem<0?'neg ':'');const clk=c[3]==='os'&&r.n_os?' onclick="openDetail(\''+String(r.n_os).replace(/'/g,'')+'\')"':'';return'<td class="'+cls+'" title="'+esc(cell(r,c))+'"'+clk+'>'+esc(cell(r,c))+'</td>'}).join('')+'</tr>').join('');const totals={};cols.forEach(c=>{if(['money','num','int'].includes(c[3]))totals[c[0]]=data.reduce((s,r)=>s+n(r[c[0]]),0)});const fat=data.reduce((s,r)=>s+r.fat_liquido,0),mar=data.reduce((s,r)=>s+r.margem,0);totals.margem_pct=fat?mar/fat:0;h+='</tbody><tfoot><tr>'+cols.map((c,i)=>'<td class="'+(['money','num','int','pct'].includes(c[3])?'num':'')+'">'+(i===0?'TOTAL':(['money','num','int','pct'].includes(c[3])?cell(totals,c):''))+'</td>').join('')+'</tr></tfoot></table>';costTable.innerHTML=h;if(__firstCostTableRender){costTable.scrollLeft=0;__firstCostTableRender=false}renderKpis(data)}
function renderKpis(d){const s=k=>d.reduce((a,r)=>a+n(r[k]),0),fat=s('fat_liquido'),m=s('margem');kFat.textContent=money(fat);kPrev.textContent=money(s('total_previsto'));kReal.textContent=money(s('total_realizado'));kMargem.textContent=money(m);kMargemPct.textContent=percent(fat?m/fat:0)}function sortBy(k){sortState={key:k,dir:sortState.key===k&&sortState.dir==='asc'?'desc':'asc'};renderTable()}
function openColumnFilter(k){activeFilterColumn=k;filterTitle.textContent=columns().find(c=>c[0]===k)?.[1]||k;tempFilter=new Set(columnFilters[k]||rows.map(r=>fval(r,k)));filterSearch.value='';renderFilterOptions();columnFilterModal.classList.remove('hidden')}function closeColumnFilter(){columnFilterModal.classList.add('hidden')}function renderFilterOptions(){const q=norm(filterSearch.value),vals=[...new Set(rows.map(r=>fval(r,activeFilterColumn)))].filter(v=>!q||norm(v).includes(q)).sort((a,b)=>String(a).localeCompare(String(b),'pt-BR',{numeric:true}));filterOptions.innerHTML=vals.map((v,i)=>'<label class="flex items-center gap-2 px-2 py-1.5 hover:bg-slate-50 rounded text-[11px]"><input id="fv'+i+'" type="checkbox" '+(tempFilter.has(v)?'checked':'')+'><span class="truncate">'+esc(v||'(vazio)')+'</span></label>').join('');vals.forEach((v,i)=>document.getElementById('fv'+i).onchange=e=>e.target.checked?tempFilter.add(v):tempFilter.delete(v))}function selectAllFilter(on){const q=norm(filterSearch.value);rows.map(r=>fval(r,activeFilterColumn)).filter(v=>!q||norm(v).includes(q)).forEach(v=>on?tempFilter.add(v):tempFilter.delete(v));renderFilterOptions()}function applyColumnFilter(){const all=new Set(rows.map(r=>fval(r,activeFilterColumn)));columnFilters[activeFilterColumn]=tempFilter.size===all.size?new Set():new Set(tempFilter);closeColumnFilter();renderTable()}
function setView(v){view=v;['Detalhe','Retrabalho','Graficos'].forEach(x=>document.getElementById('tab'+x).classList.toggle('active',x.toLowerCase()===v));tableViews.classList.toggle('hidden',v==='graficos');graphView.classList.toggle('hidden',v!=='graficos');columnFilters={};if(v==='graficos')renderCharts();else{__firstCostTableRender=true;renderTable();costTable.scrollLeft=0}}function renderAll(){view==='graficos'?renderCharts():renderTable()}function debounceRender(){clearTimeout(filterTimer);filterTimer=setTimeout(renderAll,180)}
function updatePeriodLabels(){const ys=[...selectedYears].sort((a,b)=>a-b),ms=[...selectedMonths].sort((a,b)=>a-b);yearLabel.textContent=!ys.length?'Todos':ys.length===1?String(ys[0]):ys.length+' anos';monthLabel.textContent=!ms.length?'Todos':ms.length===1?MONTH_NAMES[ms[0]-1]:ms.length+' meses'}
function populateTopFilters(){const years=[...new Set(rows.map(r=>Number(String(r.dt_emissao||'').slice(0,4))).filter(Boolean))].sort((a,b)=>b-a);if(!periodInitialized){selectedYears=years.includes(2026)?new Set([2026]):years.length?new Set([years[0]]):new Set();selectedMonths.clear();periodInitialized=true}else{selectedYears=new Set([...selectedYears].filter(y=>years.includes(y)))}yearOptions.innerHTML=years.map(y=>'<label class="period-option"><input type="checkbox" '+(selectedYears.has(y)?'checked':'')+' onchange="toggleYear('+y+',this.checked)"> '+y+'</label>').join('');monthOptions.innerHTML=MONTH_NAMES.map((name,i)=>{const m=i+1;return '<label class="period-option"><input type="checkbox" '+(selectedMonths.has(m)?'checked':'')+' onchange="toggleMonth('+m+',this.checked)"> '+name+'</label>'}).join('');updatePeriodLabels()}
function toggleYear(y,on){on?selectedYears.add(y):selectedYears.delete(y);updatePeriodLabels();renderAll()}
function toggleMonth(m,on){on?selectedMonths.add(m):selectedMonths.delete(m);updatePeriodLabels();renderAll()}
function clearPeriodFilters(){selectedYears.clear();selectedMonths.clear();updatePeriodLabels();renderAll()}
function exportXlsx(){const data=filteredRows(),cols=columns(),aoa=[cols.map(c=>c[1])];data.forEach(r=>aoa.push(cols.map(c=>c[3]==='date'?(r[c[0]]?new Date(String(r[c[0]]).slice(0,10)+'T00:00:00'):null):(['money','num','int','pct'].includes(c[3])?n(r[c[0]]):String(r[c[0]]??'')))));const ws=XLSX.utils.aoa_to_sheet(aoa,{cellDates:true}),rg=XLSX.utils.decode_range(ws['!ref']);for(let R=1;R<=rg.e.r;R++)for(let C=0;C<cols.length;C++){const x=ws[XLSX.utils.encode_cell({r:R,c:C})];if(!x)continue;const t=cols[C][3];if(t==='money')x.z='R$ #,##0.00;[Red]-R$ #,##0.00';else if(t==='pct')x.z='0.00%';else if(t==='num')x.z='#,##0.00';else if(t==='int')x.z='0';else if(t==='date')x.z='dd/mm/yyyy'}ws['!cols']=cols.map(c=>({wch:Math.max(8,Math.round(c[2]/7))}));ws['!autofilter']={ref:XLSX.utils.encode_range({r:0,c:0},{r:rg.e.r,c:rg.e.c})};const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,view==='retrabalho'?'Com Retrabalho':'Detalhamentos');XLSX.writeFile(wb,'columbia_custos_'+view+'.xlsx',{compression:true})}
function agg(d,k,v){const m=new Map();d.forEach(r=>m.set(String(r[k]||'SEM CLASSIFICAÇÃO'),(m.get(String(r[k]||'SEM CLASSIFICAÇÃO'))||0)+n(r[v])));return m}function renderCharts(){const d=filteredRows(),a=agg(d,'classificacao','vl_faturado'),b=agg(d,'classificacao','margem'),labels=[...new Set([...a.keys(),...b.keys()])];chartFat?.destroy();chartMargem?.destroy();chartGasto?.destroy();chartFat=new Chart(document.getElementById('chartFat'),{type:'pie',data:{labels,datasets:[{data:labels.map(x=>a.get(x)||0)}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'right'}}}});chartMargem=new Chart(document.getElementById('chartMargem'),{type:'pie',data:{labels,datasets:[{data:labels.map(x=>b.get(x)||0)}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'right'}}}});const series=(key,x)=>d.filter(r=>String(r.classificacao||'SEM CLASSIFICAÇÃO')===x).reduce((s,r)=>s+n(r[key]),0);chartGasto=new Chart(document.getElementById('chartGasto'),{type:'bar',data:{labels,datasets:[{label:'MP',data:labels.map(x=>series('mp_realizado',x))},{label:'ST',data:labels.map(x=>series('st_realizado',x))},{label:'MO',data:labels.map(x=>series('mo_realizado',x))}]},options:{responsive:true,maintainAspectRatio:false,scales:{y:{beginAtZero:true}}}})}

/* Modal de custos por OS: filtros por coluna, ordenação e exportação independente. */
const DETAIL_COLS=[
  {key:'tipo',label:'Tipo',type:'text',width:80},
  {key:'cod_os_completo',label:'OS completa',type:'text',width:112},
  {key:'os',label:'Subtítulo',type:'text',width:260},
  {key:'item',label:'Item',type:'text',width:300},
  {key:'qtde_previsto',label:'Qtde prev.',type:'num',width:100},
  {key:'qtde_realizado',label:'Qtde real.',type:'num',width:100},
  {key:'custo_unit_prev',label:'Custo unit. prev.',type:'money',width:136},
  {key:'custo_unit_real',label:'Custo unit. real',type:'money',width:136},
  {key:'custo_previsto',label:'Custo prev.',type:'money',width:128},
  {key:'custo_realizado',label:'Custo real',type:'money',width:128},
  {key:'desvio_custo',label:'Desvio',type:'money',width:125}
];
let detailRows=[],detailOS='',detailColumnFilters={},detailSort={key:null,dir:'asc'},detailSearch='',detailActiveColumn=null,detailTempSelection=new Set();
function detailCell(r,c){
  const v=r[c.key];
  return c.type==='num'?number(v):c.type==='money'?money(v):String(v==null?'':v);
}
function detailOptionsFor(key){
  const c=DETAIL_COLS.find(x=>x.key===key);
  return [...new Set(detailRows.map(r=>detailCell(r,c)))].sort((a,b)=>a.localeCompare(b,'pt-BR',{numeric:true,sensitivity:'base'}));
}
function visibleDetailRows(){
  const query=norm(detailSearch);
  const out=detailRows.filter(r=>{
    for(const key in detailColumnFilters){
      const chosen=detailColumnFilters[key];
      if(!chosen)continue;
      const col=DETAIL_COLS.find(c=>c.key===key);
      if(col&&!chosen.has(detailCell(r,col)))return false;
    }
    return !query||DETAIL_COLS.some(c=>norm(detailCell(r,c)).includes(query));
  });
  if(detailSort.key){
    const col=DETAIL_COLS.find(c=>c.key===detailSort.key);
    const dir=detailSort.dir==='asc'?1:-1;
    out.sort((a,b)=>{
      if(col.type==='num'||col.type==='money'){
        return (n(a[col.key])-n(b[col.key]))*dir;
      }
      return String(a[col.key]??'').localeCompare(String(b[col.key]??''),'pt-BR',{numeric:true,sensitivity:'base'})*dir;
    });
  }
  return out;
}
function detailFilterCount(){
  return Object.values(detailColumnFilters).filter(s=>s instanceof Set).length;
}
function renderDetailTable(){
  const data=visibleDetailRows();
  const cols=DETAIL_COLS;
  const count=document.getElementById('detailCount');
  const counter=detailFilterCount();
  count.textContent=data.length+' de '+detailRows.length+' itens'+(counter?' • '+counter+' filtro'+(counter===1?'':'s'):'');
  document.getElementById('detailExportBtn').disabled=!data.length;
  document.getElementById('detailClearBtn').disabled=!(counter||detailSearch||detailSort.key);
  const total=k=>data.reduce((s,r)=>s+n(r[k]),0);
  document.getElementById('detailPrevTotal').textContent=money(total('custo_previsto'));
  document.getElementById('detailRealTotal').textContent=money(total('custo_realizado'));
  const delta=total('desvio_custo'),deltaNode=document.getElementById('detailDeltaTotal');
  deltaNode.textContent=money(delta);
  deltaNode.classList.toggle('text-rose-700',delta>0);
  deltaNode.classList.toggle('text-emerald-700',delta<0);
  deltaNode.classList.toggle('text-slate-800',delta===0);
  let out='<table class="detail"><colgroup>'+cols.map(c=>'<col style="width:'+c.width+'px">').join('')+'</colgroup><thead><tr>';
  out+=cols.map(c=>{
    const selected=detailSort.key===c.key;
    const order=selected?(detailSort.dir==='asc'?'▲':'▼'):'↕';
    const filterActive=detailColumnFilters[c.key] instanceof Set;
    return '<th scope="col"><div class="detail-head"><button type="button" class="detail-sort" title="Ordenar por '+esc(c.label)+'" onclick="sortDetailBy(\''+c.key+'\')">'+esc(c.label)+' <span class="detail-order'+(selected?' active':'')+'">'+order+'</span></button><button type="button" class="detail-fbtn'+(filterActive?' active':'')+'" title="Filtrar '+esc(c.label)+'" aria-label="Filtrar '+esc(c.label)+'" onclick="openDetailFilter(\''+c.key+'\')">▼</button></div></th>';
  }).join('');
  out+='</tr></thead><tbody>';
  if(!data.length){
    out+='<tr><td class="detail-empty" colspan="'+cols.length+'">Nenhum item encontrado com os filtros selecionados.</td></tr>';
  }else{
    out+=data.map(r=>'<tr>'+cols.map(c=>{
      const value=detailCell(r,c);
      const numeric=c.type==='num'||c.type==='money';
      let cls=numeric?'detail-num':'';
      if(c.key==='desvio_custo'){
        const x=n(r[c.key]);
        cls+=' '+(x>0?'detail-delta-up':x<0?'detail-delta-down':'');
      }
      const body=c.key==='tipo'?'<span class="detail-type detail-type-'+(norm(value)==='HORAS'?'horas':norm(value)==='MP'?'mp':norm(value)==='ST'?'st':'other')+'">'+esc(value)+'</span>':esc(value);
      return '<td class="'+cls+'" title="'+esc(value)+'">'+body+'</td>';
    }).join('')+'</tr>').join('');
  }
  out+='</tbody></table>';
  const el=document.getElementById('detailBody');
  const x=el.scrollLeft,y=el.scrollTop;
  el.innerHTML=out;
  el.scrollLeft=x;el.scrollTop=y;
}
function sortDetailBy(key){
  detailSort={key,dir:detailSort.key===key&&detailSort.dir==='asc'?'desc':'asc'};
  renderDetailTable();
}
function searchDetail(q){
  detailSearch=q||'';
  renderDetailTable();
}
function clearDetailFilters(){
  detailColumnFilters={};
  detailSearch='';
  detailSort={key:null,dir:'asc'};
  document.getElementById('detailSearch').value='';
  renderDetailTable();
}
function openDetailFilter(key){
  detailActiveColumn=key;
  document.getElementById('detailFilterTitle').textContent=DETAIL_COLS.find(c=>c.key===key).label;
  detailTempSelection=new Set(detailColumnFilters[key]||detailOptionsFor(key));
  document.getElementById('detailFilterSearch').value='';
  renderDetailFilterOptions();
  document.getElementById('detailFilterModal').classList.remove('hidden');
  document.getElementById('detailFilterSearch').focus();
}
function renderDetailFilterOptions(){
  const q=norm(document.getElementById('detailFilterSearch').value);
  const vals=detailOptionsFor(detailActiveColumn).filter(v=>!q||norm(v).includes(q));
  document.getElementById('detailFilterOptions').innerHTML=vals.length?vals.map((v,i)=>'<label class="detail-filter-option"><input type="checkbox" data-detail-i="'+i+'" '+(detailTempSelection.has(v)?'checked':'')+'><span title="'+esc(v)+'">'+esc(v||'(em branco)')+'</span></label>').join(''):'<div class="p-3 text-xs text-slate-500">Nenhuma opção encontrada.</div>';
  document.getElementById('detailFilterOptions').querySelectorAll('input[data-detail-i]').forEach(box=>{
    const val=vals[Number(box.dataset.detailI)];
    box.addEventListener('change',()=>{if(box.checked)detailTempSelection.add(val);else detailTempSelection.delete(val);document.getElementById('detailFilterSelection').textContent=detailTempSelection.size+' de '+detailOptionsFor(detailActiveColumn).length+' selecionados'});
  });
  document.getElementById('detailFilterSelection').textContent=detailTempSelection.size+' de '+detailOptionsFor(detailActiveColumn).length+' selecionados';
}
function selectAllDetailFilter(on){
  const q=norm(document.getElementById('detailFilterSearch').value);
  detailOptionsFor(detailActiveColumn).filter(v=>!q||norm(v).includes(q)).forEach(v=>{if(on)detailTempSelection.add(v);else detailTempSelection.delete(v)});
  renderDetailFilterOptions();
}
function applyDetailFilter(){
  const all=detailOptionsFor(detailActiveColumn);
  if(detailTempSelection.size===all.length)delete detailColumnFilters[detailActiveColumn];else detailColumnFilters[detailActiveColumn]=new Set(detailTempSelection);
  closeDetailFilter();
  renderDetailTable();
}
function closeDetailFilter(){
  document.getElementById('detailFilterModal').classList.add('hidden');
}
function exportDetailXlsx(){
  const data=visibleDetailRows();
  if(!data.length)return;
  if(typeof XLSX==='undefined'){alert('Não foi possível carregar a biblioteca de Excel. Atualize a página e tente novamente.');return}
  const cols=DETAIL_COLS;
  const aoa=[cols.map(c=>c.label)].concat(data.map(r=>cols.map(c=>(c.type==='num'||c.type==='money')?n(r[c.key]):String(r[c.key]??''))));
  const ws=XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols']=cols.map(c=>({wch:Math.ceil(c.width/7)+2}));
  ws['!autofilter']={ref:XLSX.utils.encode_range({s:{r:0,c:0},e:{r:data.length,c:cols.length-1}})};
  for(let ri=1;ri<=data.length;ri++)cols.forEach((c,ci)=>{
    const cell=ws[XLSX.utils.encode_cell({r:ri,c:ci})];
    if(!cell)return;
    if(c.type==='money')cell.z='"R$" #,##0.00;[Red]-"R$" #,##0.00';
    else if(c.type==='num')cell.z='#,##0.00';
  });
  const wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,ws,'Previsto x Realizado');
  XLSX.writeFile(wb,'columbia_os_'+String(detailOS).replace(/[^a-zA-Z0-9_-]/g,'_')+'_custos.xlsx',{compression:true});
}
async function openDetail(os){
  detailOS=String(os);
  detailRows=[];
  detailColumnFilters={};
  detailSort={key:null,dir:'asc'};
  detailSearch='';
  document.getElementById('detailSearch').value='';
  document.getElementById('detailControls').classList.add('hidden');
  document.getElementById('detailModal').classList.remove('hidden');
  document.getElementById('detailTitle').textContent='OS '+detailOS;
  document.getElementById('detailSub').textContent='Carregando detalhamento...';
  document.getElementById('detailBody').innerHTML='<div class="detail-loading">Carregando custos...</div>';
  if(!detailLoaded)try{
    const resp=await fetchDataset('detalhe');
    if(resp.error)throw Error(resp.error);
    raw.detalhe=resp.data;
    detailLoaded=true;
    await cacheWrite({...raw,savedAt:new Date().toISOString()});
  }catch(e){
    document.getElementById('detailBody').innerHTML='<div class="detail-loading text-red-700">'+esc(e.message)+'</div>';
    document.getElementById('detailSub').textContent='Não foi possível carregar os dados';
    return;
  }
  // Protege contra resultados de um carregamento anterior após fechar ou trocar de OS.
  if(document.getElementById('detailModal').classList.contains('hidden')||detailOS!==String(os))return;
  detailRows=(raw.detalhe||[]).map(lower).filter(x=>String(x.n_servico||'')===detailOS);
  document.getElementById('detailSub').textContent='Custos previstos e realizados por item';
  document.getElementById('detailControls').classList.remove('hidden');
  document.getElementById('detailBody').scrollTop=0;
  document.getElementById('detailBody').scrollLeft=0;
  renderDetailTable();
}
function closeDetail(){
  closeDetailFilter();
  document.getElementById('detailModal').classList.add('hidden');
  detailOS='';
}
document.addEventListener('keydown',e=>{
  if(e.key!=='Escape')return;
  if(!document.getElementById('detailFilterModal').classList.contains('hidden'))closeDetailFilter();
  else if(!document.getElementById('detailModal').classList.contains('hidden'))closeDetail();
});
