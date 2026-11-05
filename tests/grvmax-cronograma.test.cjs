'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const code=fs.readFileSync(path.join(__dirname,'../grvmax/Code.gs'),'utf8');
const ctx=vm.createContext({Utilities:{formatDate:()=> '2026-11-05T10:00:00-03:00'}});
vm.runInContext(code+'\nthis.helpers={check:grvPlanCheckDirectActivity,plan:grvPlanActivityChain,validation:grvPlanValidation,stageRange:grvStageActivityRange}',ctx);
const {check,plan,validation,stageRange}=ctx.helpers;
const task=(id,start,end,dep='',status='Não iniciada')=>({
  ID:id,TITULO:id,DATA_ORIENTACAO:start,PRAZO:end,DEPENDE_DE:dep,STATUS:status
});

assert.equal(validation('2026-11-03'),'2026-11-19');
assert.equal(validation('2026-12-15'),'2027-01-07'); // Recesso anual
const a=task('A','2026-11-10','2026-11-12');
const b=task('B','2026-10-20','2026-10-29','A');
const c=task('C','2026-10-27','2026-11-12','B');

assert.throws(()=>check(b,[a,b,c]),/Dependência inválida/);
const fixed=plan([a,b,c],'',null,true);
assert.equal(fixed.length,2);
assert.equal(fixed[0].after.DATA_ORIENTACAO,'2026-11-17');
assert.equal(fixed[0].after.PRAZO,'2026-12-03');
assert.equal(fixed[1].after.DATA_ORIENTACAO,'2026-12-08');
assert.equal(fixed[1].after.PRAZO,'2027-01-07');

const delayed=plan([{...a,PRAZO:'2026-11-26'},b,c],'A',a,false);
assert.equal(delayed[0].after.DATA_ORIENTACAO,'2026-12-01');
assert.equal(delayed[0].after.PRAZO,'2026-12-17');
assert.equal(delayed[1].after.DATA_ORIENTACAO,'2027-01-05');

const earlierParent=task('A','2026-11-10','2026-11-26');
const earlierChild=task('B','2026-12-01','2026-12-17','A');
const earlier=plan([{...earlierParent,PRAZO:'2026-11-19'},earlierChild],'A',earlierParent,false);
assert.equal(earlier[0].after.DATA_ORIENTACAO,'2026-11-24');

assert.throws(()=>plan([{...a,DEPENDE_DE:'C'},b,c],'A',a,false),/circular/);
const completed=task('B','2026-11-17','2026-12-03','A','Homologada');
assert.throws(()=>plan([{...a,PRAZO:'2026-11-26'},completed],'A',a,false),/concluída\/cancelada/);

const mapping=[
  {...a,ETAPA_ID:'ETP-02'},
  {...b,ETAPA_ID:'ETP-02'},
  {...c,ETAPA_ID:'ETP-03'}
];
const m=stageRange('ETP-02',mapping);
assert.equal(m.DATA_INICIO,'2026-10-20');
assert.equal(m.DATA_FIM,'2026-11-12');
const afterRepair=mapping.map(x=>fixed.find(p=>p.after.ID===x.ID)?.after||x);
const repairedStage=stageRange('ETP-02',afterRepair);
assert.equal(repairedStage.DATA_INICIO,'2026-11-10');
assert.equal(repairedStage.DATA_FIM,'2026-12-03');
assert.equal(stageRange('ETP-99',afterRepair),null);
assert.equal(stageRange('ETP-02',mapping.map(x=>({...x,STATUS:'Cancelada'}))),null);
console.log('GRVMAX: validação de dependências e datas automáticas das etapas passou.');

