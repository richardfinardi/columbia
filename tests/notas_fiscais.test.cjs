const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'notas_fiscais/index.html'), 'utf8');
const script = html.slice(html.indexOf("const API_NOTAS="), html.lastIndexOf('</script>'));
const ctx = vm.createContext({document:{addEventListener(){}}});
vm.runInContext(script, ctx); // Compile and run the actual application functions.
vm.runInContext(`
rawNotas = [
 {nf:'12026',data:'2026-09-03',tipo:'NF FATURADAS',status:'AUTORIZAÇÃO FORA DE PRAZO',vl_nota:123.45,vl_faturado:0,icms:14.81,segmento:'REMESSA EM GARANTIA'},
 {nf:'12005',data:'2026-09-01',tipo:'NF FATURADAS',status:'AUTORIZADA',vl_faturado:10,segmento:'SUCATAS'},
 {nf:'12020',data:'2026-09-03',tipo:'NF FATURADAS',status:'AUTORIZADA',vl_faturado:20,segmento:' sucatas '},
 {nf:'90001',data:'2026-09-03',tipo:'SUCATA',vl_faturado:30,segmento:''},
 {nf:'90002',data:'2026-09-03',tipo:'NF FATURADAS',vl_faturado:40,segmento:'SUCATA'},
 {nf:'90003',data:'2026-09-03',tipo:'EMISSAO DEVOLUCAO',tp_nf:'CLIENTE',vl_nota:5,vl_faturado:4},
 {nf:'90004',data:'2026-09-03',tipo:'EMISSAO DEVOLUCAO',tp_nf:'FORNECEDOR',vl_nota:6},
 {nf:'90005',data:'2026-09-03',tipo:'ENTRADA',vl_nota:7},
 {nf:'90006',data:'2026-09-03',tipo:'NF INUT/CANC',status:'CANCELADA'},
 {nf:'11825',data:'2026-09-03',tipo:'NF FATURADAS',vl_faturado:1000},
 {nf:'90007',data:'2023-09-03',tipo:'NF FATURADAS',vl_faturado:1000}
];
prepareData();
`, ctx);
function run(expr){return vm.runInContext(expr,ctx)}
assert.equal(run('notas.length'),9);
assert.equal(run("notasView='faturamento';baseNotasRows().some(r=>r.nf==='12026')"),true);
assert.equal(run("notasView='todas';baseNotasRows().some(r=>r.nf==='12026')"),true);
assert.equal(run("baseNotasRows().some(r=>r.tipo==='ENTRADA')"),false);
assert.equal(run("notasView='sucata';baseNotasRows().length"),4);
assert.equal(run("sum(baseNotasRows(),r=>r.vl_faturado)"),100);
assert.equal(run("notasView='devolucoes';baseNotasRows().length"),2);
assert.equal(run('metrics(notas).bruto'),100);
assert.equal(run('metrics(notas).devol'),12);
assert.equal(run('metrics(notas).liquido'),88);
assert.equal(run("notasView='canceladas';baseNotasRows().length"),1);
assert.equal(run("selectedMonths=new Set([10]);filteredRows().length"),0);
assert.equal(run("selectedMonths=new Set([9]);selectedYears=new Set([2026]);filteredRows().length"),9);
assert.equal(run("notasView='faturamento';columnFilters={nf:new Set(['12026'])};notasRows().length"),1);
assert.equal(run('notasRows()[0].vl_faturado'),0); // Warranty remittance must not become revenue.
assert.equal(run('notasRows()[0].vl_nota'),123.45);
assert.equal(run('notasRows()[0].icms'),14.81);
const sql=fs.readFileSync(path.join(root,'sql/notas_fiscais.sql'),'utf8');
assert.equal((sql.match(/WHEN '150' THEN/g)||[]).length,5);
assert.ok(sql.includes("NFE_COD_STATUS IN ('100', '150')"));
assert.equal(/NFE_COD_STATUS = '100'/.test(sql),false);
assert.ok(sql.includes("NOT LIKE '%11825%'"));
assert.ok(sql.includes('EXTRACT(YEAR FROM teste.data) > 2023'));
assert.ok(sql.includes("NOT IN ('102','101','105')"));
console.log('23 regression checks passed; SQL database execution still requires the CPS connection.');
