// 06 - Eficiencia de consultas con explain("executionStats"): antes y después de crear el índice (IE6)
// Para cada caso: se elimina el índice, se mide (COLLSCAN), se crea el índice y se vuelve a medir (IXSCAN).
load('scripts/lib.js');
titulo('06 · Evaluación de eficiencia con explain("executionStats")');

const comparativa = [];
function medir(caso, col, indice, nombre, consulta) {
  try { db[col].dropIndex(nombre); } catch (e) { /* no existía */ }
  const antes = resumenExplain(consulta().explain('executionStats'));
  db[col].createIndex(indice, { name: nombre });
  const despues = resumenExplain(consulta().explain('executionStats'));
  comparativa.push({
    caso, indice: nombre,
    plan_antes: antes.plan, plan_despues: despues.plan,
    ms_antes: antes.executionTimeMillis, ms_despues: despues.executionTimeMillis,
    docs_examinados_antes: antes.totalDocsExamined, docs_examinados_despues: despues.totalDocsExamined,
    claves_examinadas_despues: despues.totalKeysExamined,
    retornados: despues.nReturned,
  });
  return { antes, despues };
}

seccion('E1', 'Reacciones de una publicación (lo usa el $lookup de popularidad)', () =>
  medir('E1', 'reacciones', { publicacion_id: 1, tipo_reaccion: 1 }, 'ix_pub_tipo',
    () => db.reacciones.find({ publicacion_id: 'pub_237' })));

seccion('E2', 'Publicaciones de una categoría desde una fecha, ordenadas (regla ESR)', () =>
  medir('E2', 'publicaciones', { categoria: 1, fecha_publicacion: -1 }, 'ix_categoria_fecha',
    () => db.publicaciones.find({ categoria: 'Tecnología', fecha_publicacion: { $gte: ISODate('2025-06-01T00:00:00Z') } })
                          .sort({ fecha_publicacion: -1 })));

seccion('E3', 'Comentarios de un usuario (perfil / ranking de actividad)', () =>
  medir('E3', 'comentarios', { usuario_id: 1 }, 'ix_usuario',
    () => db.comentarios.find({ usuario_id: 'user_300' })));

seccion('E4', 'Usuarios por país y género (perfil de audiencia)', () =>
  medir('E4', 'usuarios', { pais: 1, genero: 1 }, 'ix_pais_genero',
    () => db.usuarios.find({ pais: 'Korea', genero: { $in: ['Femenino', 'Otro'] } })));

seccion('E5', 'Mejora propuesta: consulta cubierta (solo lee el índice, 0 documentos)', () => ({
  normal: resumenExplain(db.publicaciones.find({ categoria: 'Cultura' }).explain('executionStats')),
  cubierta: resumenExplain(db.publicaciones.find({ categoria: 'Cultura' }, { _id: 0, categoria: 1, fecha_publicacion: 1 })
                           .explain('executionStats')),
}));

seccion('E6', 'Agregación con $lookup (popularidad): estrategia de join sin y con índice', () => {
  const pipeline = [
    { $lookup: { from: 'reacciones', localField: '_id', foreignField: 'publicacion_id', as: 'r' } },
    { $project: { n: { $size: '$r' } } }];
  const buscar = (o) => { if (!o || typeof o !== 'object') return null; if (o.stage === 'EQ_LOOKUP') return o;
    for (const v of Object.values(o)) { const r = buscar(v); if (r) return r; } return null; };
  const medirLookup = () => {
    const c = db.publicaciones.explain('executionStats').aggregate(pipeline).stages[0].$cursor;
    const lk = buscar(c.queryPlanner.winningPlan);
    return { estrategia: lk.strategy, indice: lk.indexName || '(ninguno)',
             executionTimeMillis: c.executionStats.executionTimeMillis,
             totalDocsExamined: c.executionStats.totalDocsExamined, totalKeysExamined: c.executionStats.totalKeysExamined };
  };
  db.reacciones.dropIndex('ix_pub_tipo');
  const sinIndice = medirLookup();
  db.reacciones.createIndex({ publicacion_id: 1, tipo_reaccion: 1 }, { name: 'ix_pub_tipo' });
  const conIndice = medirLookup();
  comparativa.push({ caso: 'E6', indice: 'ix_pub_tipo', plan_antes: 'EQ_LOOKUP ' + sinIndice.estrategia, plan_despues: 'EQ_LOOKUP ' + conIndice.estrategia,
    ms_antes: sinIndice.executionTimeMillis, ms_despues: conIndice.executionTimeMillis,
    docs_examinados_antes: sinIndice.totalDocsExamined, docs_examinados_despues: conIndice.totalDocsExamined,
    claves_examinadas_despues: conIndice.totalKeysExamined, retornados: 500 });
  return { sinIndice, conIndice };
});

seccion('E7', 'Prueba de volumen: 199.600 reacciones sintéticas generadas en el servidor ($lookup + $unwind + $out)', () => {
  db.reacciones_volumen.drop();
  db.reacciones.aggregate([
    { $project: { usuario_id: 1, tipo_reaccion: 1, fecha: 1 } },
    { $lookup: { from: 'publicaciones', pipeline: [{ $limit: 400 }, { $project: { _id: 1 } }], as: 'k' } },
    { $unwind: '$k' },
    { $project: { _id: { $concat: ['$_id', '-', '$k._id'] }, usuario_id: 1, publicacion_id: '$k._id', tipo_reaccion: 1, fecha: 1 } },
    { $out: 'reacciones_volumen' },
  ]).toArray();
  return { documentos: db.reacciones_volumen.countDocuments(),
           tamano_MB: Math.round(db.reacciones_volumen.stats().size / 1048576 * 10) / 10 };
});

seccion('E8', 'Misma consulta sobre el volumen grande: sin índice vs con índice', () => {
  const r = medir('E8 (volumen)', 'reacciones_volumen', { publicacion_id: 1 }, 'ix_pub',
    () => db.reacciones_volumen.find({ publicacion_id: 'pub_237', tipo_reaccion: 'Me gusta' }));
  // Mejora propuesta: índice compuesto con el segundo filtro (igualdad) → claves examinadas = documentos retornados
  db.reacciones_volumen.createIndex({ publicacion_id: 1, tipo_reaccion: 1 }, { name: 'ix_pub_tipo' });
  r.mejora_indice_compuesto = resumenExplain(db.reacciones_volumen
    .find({ publicacion_id: 'pub_237', tipo_reaccion: 'Me gusta' }).hint('ix_pub_tipo').explain('executionStats'));
  comparativa.push({ caso: 'E8 (mejora)', indice: 'ix_pub_tipo', plan_antes: 'FETCH <- IXSCAN(ix_pub)',
    plan_despues: r.mejora_indice_compuesto.plan, ms_antes: r.despues.executionTimeMillis,
    ms_despues: r.mejora_indice_compuesto.executionTimeMillis, docs_examinados_antes: r.despues.totalDocsExamined,
    docs_examinados_despues: r.mejora_indice_compuesto.totalDocsExamined,
    claves_examinadas_despues: r.mejora_indice_compuesto.totalKeysExamined, retornados: r.mejora_indice_compuesto.nReturned });
  db.reacciones_volumen.drop();   // colección temporal: se elimina para no ocupar el cupo de 512 MB del M0
  return r;
});

seccion('E9', 'Tabla comparativa antes / después', () => comparativa, { tabla: true });
