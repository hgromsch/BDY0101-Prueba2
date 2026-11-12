// Utilidades comunes para los scripts de ContentFlow (se cargan con load('scripts/lib.js')).
// Cada "sección" imprime: identificador, requerimiento, el código ejecutado y su resultado real.
// Las salidas se guardan en evidencias/salidas y se convierten en capturas para el informe.

const DB_NAME = (typeof process !== 'undefined' && process.env.MONGODB_DB) || 'contentflow';
db = db.getSiblingDB(DB_NAME);

// Consistencia usada en todas las sesiones (ver informe, apartado 2.6)
db.getMongo().setReadConcern('majority');
db.getMongo().setWriteConcern({ w: 'majority', j: true, wtimeout: 10000 });

function seccion(id, titulo, fn, opciones) {
  opciones = opciones || {};
  print('\n### ' + id + ' | ' + titulo);
  if (opciones.negocio) print('// Requerimiento: ' + opciones.negocio);
  const src = fn.toString()
    .replace(/^\(\)\s*=>\s*\{\n?/, '')
    .replace(/\n?\}\s*$/, '')
    .replace(/^\(\)\s*=>\s*/, '');
  const lineas = src.split('\n');
  const sangria = Math.min(...lineas.filter(l => l.trim()).map(l => l.match(/^ */)[0].length));
  print(lineas.map((l, i) => (i === 0 ? 'contentflow> ' : '...          ') + l.slice(sangria)).join('\n'));
  const inicio = Date.now();
  let r;
  try {
    r = fn();
  } catch (e) {
    print((e.code !== undefined ? 'MongoServerError' : 'Error de validación (aplicación)') + ': ' + e.message);
    if (e.errInfo && e.errInfo.details) {
      const det = e.errInfo.details.schemaRulesNotSatisfied || e.errInfo.details;
      print('errInfo.details: ' + EJSON.stringify(det).slice(0, 700));
    }
    return null;
  }
  if (r !== undefined) {
    if (opciones.tabla && Array.isArray(r)) console.table(r); else printjson(r);
  }
  if (opciones.tiempo) print('// tiempo cliente: ' + (Date.now() - inicio) + ' ms');
  return r;
}

function titulo(texto) {
  print('\n' + '='.repeat(78) + '\n' + texto + '\n' + '='.repeat(78));
}

// Resumen de explain("executionStats") en una línea comparable
function resumenExplain(exp) {
  const es = exp.executionStats;
  const etapas = [];
  (function recorrer(p) {
    if (!p) return;
    etapas.push(p.stage + (p.indexName ? '(' + p.indexName + ')' : ''));
    recorrer(p.inputStage);
    (p.inputStages || []).forEach(recorrer);
  })(exp.queryPlanner.winningPlan.queryPlan || exp.queryPlanner.winningPlan);
  return {
    plan: etapas.join(' <- '),
    executionTimeMillis: es.executionTimeMillis,
    totalKeysExamined: es.totalKeysExamined,
    totalDocsExamined: es.totalDocsExamined,
    nReturned: es.nReturned,
  };
}
