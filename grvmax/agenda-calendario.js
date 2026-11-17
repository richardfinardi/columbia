(function () {
  'use strict';

  var activeMonth = null;
  var visibleTypes = {stage:true, activity:true, meeting:true};
  var stageFilter = '';
  var selected = null;
  var MS_DAY = 86400000;

  function safe(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
    });
  }
  function key(v) {
    var s = String(v || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return '';
    var d = new Date(s + 'T12:00:00Z');
    return isNaN(d.getTime()) || d.toISOString().slice(0,10) !== s ? '' : s;
  }
  function utc(y,m,d) { return new Date(Date.UTC(y,m,d,12)); }
  function dayKey(d) { return d.toISOString().slice(0,10); }
  function shift(d,n) { return new Date(d.getTime() + n * MS_DAY); }
  function fromKey(k) { return new Date(k + 'T12:00:00Z'); }
  function todayKey() {
    var p = {};
    new Intl.DateTimeFormat('en-US',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()).forEach(function(x){p[x.type]=x.value;});
    return p.year + '-' + p.month + '-' + p.day;
  }
  function nice(k) { return k ? k.slice(8,10)+'/'+k.slice(5,7)+'/'+k.slice(0,4) : '—'; }
  function limit(n) { return Math.min(100,Math.max(0,n)); }
  function statusProgress(status,kind) {
    var s = String(status||'').toLowerCase();
    if (/cancelad/.test(s)) return 0;
    if (/homologad|concluíd|concluid|aprovad/.test(s)) return 100;
    if (/aguardando valida/.test(s)) return 85;
    if (/devolvid/.test(s)) return 35;
    if (/em execu|em andamento/.test(s)) return kind==='meeting' ? 50 : 60;
    if (/orientad/.test(s)) return 25;
    return 0;
  }
  function normalizedRange(start,end) {
    var a = key(start), b = key(end) || a;
    if (!a && b) a = b;
    if (!a) return null;
    return a <= b ? {start:a,end:b} : {start:b,end:a};
  }
  function collect(S,ops) {
    var events = [],activities = S.activities || [], stages = S.stages || [], meetings = S.agenda || [];
    var me = S.me || {};
    var canAll = ops.can('activities.view_all');
    var allowedActivities = ops.can('activities.view') ? activities.filter(function(a) {
      return canAll || a.RESPONSAVEL_ID===me.ID ||
        (S.vinculos||[]).some(function(v){
          return v.ATIVIDADE_ID===a.ID && v.PESSOA_ID===me.ID && (v.TIPO==='PARTICIPANTE'||v.TIPO==='HOMOLOGADOR');
        });
    }) : [];
    var stageById = {};
    stages.forEach(function(s) { stageById[s.ID] = s; });
    var visibleById = {};
    allowedActivities.forEach(function(a){visibleById[a.ID]=a;});
    if (ops.can('stages.view')) stages.forEach(function(s) {
      var kids = activities.filter(function(a) {return a.ETAPA_ID===s.ID && a.STATUS!=='Cancelada';});
      var valid = kids.map(function(a){return normalizedRange(a.DATA_ORIENTACAO,a.PRAZO);}).filter(Boolean);
      var range = valid.length ? {
        start: valid.map(function(r){return r.start;}).sort()[0],
        end: valid.map(function(r){return r.end;}).sort().slice(-1)[0]
      } : normalizedRange(s.DATA_INICIO,s.DATA_FIM);
      if (!range) return;
      var pct = kids.length ? Math.round(kids.reduce(function(t,a){return t+statusProgress(a.STATUS,'activity');},0)/kids.length) : statusProgress(s.STATUS,'stage');
      if (s.STATUS==='Homologada') pct=100;
      if (s.STATUS==='Cancelada') pct=0;
      events.push({type:'stage',id:String(s.ID),title:String(s.ORDEM||'')+' · '+(s.TITULO||'Etapa'),start:range.start,end:range.end,
        status:s.STATUS||'Não iniciada', progress:limit(pct), responsible:s.RESPONSAVEL_ID, stageId:s.ID,
        description:s.DESCRICAO||s.ENTREGAVEL||'', record:s});
    });
    allowedActivities.forEach(function(a) {
      var range=normalizedRange(a.DATA_ORIENTACAO,a.PRAZO);
      if (!range) return;
      events.push({type:'activity',id:String(a.ID),title:a.TITULO||'Atividade',start:range.start,end:range.end,
        status:a.STATUS||'Não iniciada',progress:statusProgress(a.STATUS,'activity'),responsible:a.RESPONSAVEL_ID,
        stageId:a.ETAPA_ID,stageName:stageById[a.ETAPA_ID]&&stageById[a.ETAPA_ID].TITULO||'',
        description:a.DESCRICAO||'',record:a});
    });
    if (ops.can('agenda.view')) meetings.forEach(function(a) {
      var range=normalizedRange(a.INICIO,a.FIM);
      if (!range) return;
      var related=visibleById[a.ATIVIDADE_ID] || activities.find(function(x){return x.ID===a.ATIVIDADE_ID;});
      var stageId=related&&related.ETAPA_ID || '';
      if (a.ATIVIDADE_ID && !canAll && ops.can('activities.view') && !visibleById[a.ATIVIDADE_ID]) return;
      events.push({type:'meeting',id:String(a.ID),title:a.TITULO||'Compromisso',start:range.start,end:range.end,
        status:a.STATUS||'Agendado',progress:statusProgress(a.STATUS,'meeting'),responsible:a.RESPONSAVEL_ID,
        stageId:stageId,stageName:stageById[stageId]&&stageById[stageId].TITULO||'',description:a.DESCRICAO||'',
        subtype:a.TIPO||'Compromisso',record:a});
    });
    return events;
  }
  function kindLabel(t) {return t==='stage'?'Etapa':t==='activity'?'Atividade':'Compromisso';}
  function kindTable(t) {return t==='stage'?'ETAPAS':t==='activity'?'ATIVIDADES':'AGENDA';}
  function eventKey(e) {return e.type+':'+e.id;}
  function monthLabel(m) {
    var title=new Intl.DateTimeFormat('pt-BR',{month:'long',year:'numeric',timeZone:'UTC'}).format(utc(m.getUTCFullYear(),m.getUTCMonth(),1));
    return title.charAt(0).toUpperCase()+title.slice(1);
  }
  function buildCalendar(month,all) {
    var year=month.getUTCFullYear(), mo=month.getUTCMonth(), first=utc(year,mo,1);
    var monday=shift(first,-((first.getUTCDay()+6)%7));
    var last=utc(year,mo+1,0), end=shift(last,6-((last.getUTCDay()+6)%7));
    var result='', today=todayKey();
    for(var week=monday;week<=end;week=shift(week,7)) {
      var weekEnd=dayKey(shift(week,6)),weekStart=dayKey(week);
      var segments=all.filter(function(e){return e.start<=weekEnd && e.end>=weekStart;}).map(function(e){
        var start=e.start>weekStart?e.start:weekStart,finish=e.end<weekEnd?e.end:weekEnd;
        return {event:e,first:Math.round((fromKey(start)-week)/MS_DAY),last:Math.round((fromKey(finish)-week)/MS_DAY),
          left:e.start<weekStart,right:e.end>weekEnd};
      });
      var orders={stage:0,activity:1,meeting:2};
      segments.sort(function(a,b){
        return orders[a.event.type]-orders[b.event.type] || a.first-b.first || b.last-a.last ||
          a.event.title.localeCompare(b.event.title,'pt-BR');
      });
      var lanes=[];
      segments.forEach(function(s) {
        var index=lanes.findIndex(function(x){return x<s.first;});
        if(index<0){index=lanes.length;lanes.push(s.last);}else lanes[index]=s.last;
        s.lane=index;
      });
      result+='<div class="gcal-week" style="height:'+Math.max(66,36+lanes.length*28+5)+'px">';
      for(var d=0;d<7;d++) {
        var date=shift(week,d), k=dayKey(date);
        result+='<button type="button" class="gcal-day'+(date.getUTCMonth()!==mo?' gcal-outside':'')+(k===today?' gcal-today':'')+(d>4?' gcal-weekend':'')+'" data-day="'+k+'" style="left:'+(d*100/7)+'%;width:'+(100/7)+'%" aria-label="Ver compromissos de '+nice(k)+'"><span>'+date.getUTCDate()+'</span></button>';
      }
      segments.forEach(function(s){
        var e=s.event, span=s.last-s.first+1,shade=Math.round(limit(e.progress)*0.63),cls=e.status==='Cancelada'?' gcal-cancelled':'';
        var label=(s.left?'‹ ':'')+e.title+(s.right?' ›':'');
        result+='<button type="button" class="gcal-span gcal-'+e.type+cls+'" data-item="'+safe(eventKey(e))+'" '+
          'title="'+safe(kindLabel(e.type)+': '+e.title+' | '+nice(e.start)+' até '+nice(e.end)+' | '+e.status+' | '+e.progress+'%')+'" '+
          'aria-label="'+safe(kindLabel(e.type)+' '+e.title+', '+nice(e.start)+' até '+nice(e.end)+', '+e.status+', '+e.progress+'%')+'" '+
          'style="left:calc('+(s.first*100/7)+'% + 3px);width:calc('+(span*100/7)+'% - 6px);top:'+(34+s.lane*28)+'px;--gcal-shade:'+shade+'%;--gcal-progress:'+e.progress+'%">'+
          '<span class="gcal-span-label">'+safe(label)+'</span></button>';
      });
      result+='</div>';
    }
    return result;
  }
  function detailHtml(e,ops) {
    var person = (ops.person&&ops.person(e.responsible)) || '—';
    var canOpen=ops.can((e.type==='stage'?'stages':e.type==='activity'?'activities':'agenda')+'.view');
    return '<div class="gcal-detail-heading"><div><span class="gcal-kind gcal-'+e.type+'">'+kindLabel(e.type)+'</span><h3>'+safe(e.title)+'</h3>'+
      '<div class="small muted">'+safe(nice(e.start))+' até '+safe(nice(e.end))+' · '+safe(e.status||'Não iniciada')+'</div></div>'+
      (canOpen?'<button class="btn" type="button" data-open="'+safe(eventKey(e))+'">Abrir cadastro</button>':'')+'</div>'+
      '<div class="gcal-detail-meta"><span><b>Progresso</b> '+e.progress+'%</span><span><b>Responsável</b> '+safe(person)+'</span>'+
      (e.type==='activity'||e.type==='meeting'&&e.stageName?'<span><b>Etapa</b> '+safe(e.stageName||'—')+'</span>':'')+
      (e.type==='meeting'?'<span><b>Tipo</b> '+safe(e.subtype)+'</span>':'')+'</div>'+
      '<div class="gcal-detail-track"><span class="gcal-'+e.type+'" style="width:'+e.progress+'%"></span></div>'+
      (e.description?'<p class="gcal-detail-description">'+safe(e.description)+'</p>':'');
  }
  function render(root,S,ops) {
    if (!root || !S || !ops) return;
    var today=todayKey();
    if(!activeMonth)activeMonth=utc(Number(today.slice(0,4)),Number(today.slice(5,7))-1,1);
    var all=collect(S,ops);
    var stageOptions=(S.stages||[]).map(function(s) {return '<option value="'+safe(s.ID)+'"'+(stageFilter===s.ID?' selected':'')+'>'+safe(s.ORDEM+' · '+s.TITULO)+'</option>';}).join('');
    root.innerHTML='<div class="gcal-wrap">'+
      '<div class="gcal-toolbar"><div><h2>Calendário da implantação</h2><p class="small muted">Datas sincronizadas automaticamente com as etapas e atividades do projeto. Faixas contínuas incluem todos os dias do período.</p></div>'+
      '<div class="gcal-nav"><button class="btn" type="button" data-action="prev" aria-label="Mês anterior">‹</button>'+
      '<strong id="gcal-month-title"></strong><button class="btn" type="button" data-action="next" aria-label="Próximo mês">›</button>'+
      '<button class="btn" type="button" data-action="today">Hoje</button></div></div>'+
      '<div class="gcal-filters"><label><input type="checkbox" data-kind="stage"'+(visibleTypes.stage?' checked':'')+'><i class="gcal-legend-stage"></i>Etapas</label>'+
      '<label><input type="checkbox" data-kind="activity"'+(visibleTypes.activity?' checked':'')+'><i class="gcal-legend-activity"></i>Atividades</label>'+
      '<label><input type="checkbox" data-kind="meeting"'+(visibleTypes.meeting?' checked':'')+'><i class="gcal-legend-meeting"></i>Compromissos</label>'+
      '<select class="field" id="gcal-stage-filter" aria-label="Filtrar por etapa"><option value="">Todas as etapas</option>'+stageOptions+'</select>'+
      (ops.can('agenda.create')?'<button class="btn primary" type="button" data-action="new">+ Compromisso</button>':'')+'</div>'+
      '<div class="gcal-count small muted" id="gcal-count" aria-live="polite"></div>'+
      '<div class="gcal-scroll" tabindex="0" aria-label="Calendário. No celular, deslize horizontalmente para visualizar todos os dias.">'+
      '<div class="gcal-grid"><div class="gcal-weekdays"><span>Seg</span><span>Ter</span><span>Qua</span><span>Qui</span><span>Sex</span><span>Sáb</span><span>Dom</span></div>'+
      '<div id="gcal-body"></div></div></div>'+
      '<p class="gcal-hint small muted">Clique em uma faixa para consultar o progresso e abrir o cadastro. As faixas continuam nas semanas e nos meses seguintes.</p>'+
      '<div id="gcal-detail" class="gcal-detail" hidden aria-live="polite"></div>'+
      '</div><details class="gcal-records"><summary>Compromissos cadastrados ('+(S.agenda||[]).length+')</summary><div id="gcal-legacy-list"></div></details>';
    function redraw() {
      var mm=activeMonth.getUTCMonth(), yy=activeMonth.getUTCFullYear();
      var from=dayKey(utc(yy,mm,1)), to=dayKey(utc(yy,mm+1,0));
      var filtered=all.filter(function(e){
        return visibleTypes[e.type] && (!stageFilter || e.stageId===stageFilter) && e.start<=to && e.end>=from;
      });
      root.querySelector('#gcal-month-title').textContent=monthLabel(activeMonth);
      root.querySelector('#gcal-count').textContent=filtered.length+' itens no mês · '+filtered.filter(function(e){return e.type==='stage';}).length+
        ' etapas · '+filtered.filter(function(e){return e.type==='activity';}).length+' atividades · '+
        filtered.filter(function(e){return e.type==='meeting';}).length+' compromissos';
      root.querySelector('#gcal-body').innerHTML=buildCalendar(activeMonth,filtered);
      if(selected && !filtered.some(function(e){return eventKey(e)===selected})) {
        selected=null;
        var box=root.querySelector('#gcal-detail');box.hidden=true;box.innerHTML='';
      }
      if(selected) {
        var btn=root.querySelector('[data-item="'+CSS.escape(selected)+'"]');
        if(btn)btn.classList.add('gcal-selected');
      }
    }
    root.addEventListener('change',function(ev){
      var target=ev.target;
      if(target.matches('[data-kind]'))visibleTypes[target.dataset.kind]=target.checked;
      else if(target.id==='gcal-stage-filter')stageFilter=target.value;
      else return;
      selected=null;
      root.querySelector('#gcal-detail').hidden=true;
      redraw();
    });
    root.addEventListener('click',function(ev) {
      var t=ev.target.closest('[data-action],[data-item],[data-day],[data-open]');
      if(!t || !root.contains(t)) return;
      if(t.dataset.action) {
        if(t.dataset.action==='new') {ops.open('AGENDA');return;}
        if(t.dataset.action==='today') activeMonth=utc(Number(today.slice(0,4)),Number(today.slice(5,7))-1,1);
        else activeMonth=utc(activeMonth.getUTCFullYear(),activeMonth.getUTCMonth()+(t.dataset.action==='prev'?-1:1),1);
        selected=null;var detail=root.querySelector('#gcal-detail');detail.hidden=true;detail.innerHTML='';
        redraw();return;
      }
      if(t.dataset.open){
        var record=all.find(function(x){return eventKey(x)===t.dataset.open;});
        if(record)ops.open(kindTable(record.type),record.id);
        return;
      }
      if(t.dataset.item) {
        var e=all.find(function(x){return eventKey(x)===t.dataset.item;});
        if(!e)return;
        selected=eventKey(e);
        root.querySelectorAll('.gcal-selected').forEach(function(b){b.classList.remove('gcal-selected');});
        t.classList.add('gcal-selected');
        var box=root.querySelector('#gcal-detail');
        box.innerHTML=detailHtml(e,ops);box.hidden=false;
        return;
      }
      if(t.dataset.day){
        var list=all.filter(function(e){return visibleTypes[e.type] && (!stageFilter || e.stageId===stageFilter) &&
          e.start<=t.dataset.day && e.end>=t.dataset.day;});
        var panel=root.querySelector('#gcal-detail');selected=null;
        root.querySelectorAll('.gcal-selected').forEach(function(b){b.classList.remove('gcal-selected');});
        panel.innerHTML='<div class="gcal-detail-heading"><h3>'+nice(t.dataset.day)+'</h3><span class="small muted">'+list.length+' itens neste dia</span></div>'+
          (list.length?list.map(function(e){return '<button type="button" class="gcal-day-result" data-item="'+safe(eventKey(e))+'">'+
            '<span class="gcal-kind gcal-'+e.type+'">'+kindLabel(e.type)+'</span><b>'+safe(e.title)+'</b><span class="muted">'+safe(e.status)+'</span></button>';}).join(''):
            '<p class="small muted">Nenhuma atividade ou compromisso neste dia.</p>');
        panel.hidden=false;
      }
    });
    redraw();
  }
  window.GRVMAX_Agenda={render:render};
})();