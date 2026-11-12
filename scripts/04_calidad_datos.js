// 04 - Calidad de datos: detección, registro de evidencia y corrección/justificación (IE8)
// Criterio general: NO se elimina nada sin dejar evidencia. Cada hallazgo se registra primero en la
// colección auditoria_calidad (con la consulta que lo detectó) y recién después se corrige o se marca.
load('scripts/lib.js');
titulo('04 · Calidad de datos: duplicados, inconsistencias y referencias');

db.auditoria_calidad.deleteMany({});   // la auditoría se regenera completa en cada ejecución

// Pipeline reutilizable: interacciones cuya fecha es anterior a la de la publicación referenciada
const antesDePublicacion = (col) => [
  { $lookup: { from: 'publicaciones', localField: 'publicacion_id', foreignField: '_id', as: 'pub' } },
  { $unwind: '$pub' },
  { $match: { $expr: { $lt: ['$fecha', '$pub.fecha_publicacion'] } } },
];
// Actividad cuya fecha es anterior al registro del usuario
const antesDeRegistro = (col, campoFecha) => [
  { $lookup: { from: 'usuarios', localField: 'usuario_id', foreignField: '_id', as: 'u' } },
  { $unwind: '$u' },
  { $match: { $expr: { $lt: ['$' + campoFecha, '$u.fecha_registro'] } } },
];
// Registra los hallazgos de un pipeline en auditoria_calidad con $merge
function auditar(col, pipeline, tipo, criterio, accion) {
  db[col].aggregate(pipeline.concat([
    { $project: { _id: { $concat: [tipo, ':', '$_id'] }, tipo: { $literal: tipo }, coleccion: { $literal: col },
                  documento_id: '$_id', criterio: { $literal: criterio }, accion: { $literal: accion },
                  detectado_en: '$$NOW' } },
    { $merge: { into: 'auditoria_calidad', whenMatched: 'replace', whenNotMatched: 'insert' } },
  ])).toArray();
  return db.auditoria_calidad.countDocuments({ tipo, coleccion: col });
}

// ---------------------------------------------------------------- DETECCIÓN
seccion('Q01', 'Duplicados: ¿un usuario reaccionó dos veces a la misma publicación?', () =>
  db.reacciones.aggregate([
    { $group: { _id: { usuario_id: '$usuario_id', publicacion_id: '$publicacion_id' },
                n: { $sum: 1 }, reacciones: { $push: { id: '$_id', tipo: '$tipo_reaccion', fecha: '$fecha' } } } },
    { $match: { n: { $gt: 1 } } },
  ]).toArray());

seccion('Q02', 'Duplicados: correos repetidos, nombres de usuario y nombres de campaña repetidos', () => ({
  correos_duplicados: db.usuarios.aggregate([{ $group: { _id: { $toLower: '$correo' }, n: { $sum: 1 } } }, { $match: { n: { $gt: 1 } } }, { $count: 'n' }]).toArray(),
  nombres_usuario_repetidos: db.usuarios.aggregate([{ $group: { _id: '$nombre', n: { $sum: 1 }, correos: { $push: '$correo' } } }, { $match: { n: { $gt: 1 } } }]).toArray(),
  nombres_campana_repetidos: db.campanas.aggregate([{ $group: { _id: '$nombre', n: { $sum: 1 } } }, { $match: { n: { $gt: 1 } } },
    { $group: { _id: null, nombres: { $sum: 1 }, campanas_afectadas: { $sum: '$n' } } }, { $project: { _id: 0 } }]).toArray(),
  misma_campana_y_fecha: db.campanas.aggregate([{ $group: { _id: { n: '$nombre', f: '$fecha_inicio' }, n: { $sum: 1 } } }, { $match: { n: { $gt: 1 } } }, { $count: 'n' }]).toArray(),
}));

seccion('Q03', 'Referencias inválidas (usuario o publicación inexistente) con $lookup', () => {
  const huerfanos = (col, campo, destino) => db[col].aggregate([
    { $lookup: { from: destino, localField: campo, foreignField: '_id', as: 'ref' } },
    { $match: { ref: { $size: 0 } } }, { $count: 'n' }]).toArray().map(x => x.n)[0] || 0;
  return {
    'publicaciones.usuario_id': huerfanos('publicaciones', 'usuario_id', 'usuarios'),
    'reacciones.usuario_id': huerfanos('reacciones', 'usuario_id', 'usuarios'),
    'reacciones.publicacion_id': huerfanos('reacciones', 'publicacion_id', 'publicaciones'),
    'comentarios.usuario_id': huerfanos('comentarios', 'usuario_id', 'usuarios'),
    'comentarios.publicacion_id': huerfanos('comentarios', 'publicacion_id', 'publicaciones'),
    'campanas.publicaciones_asociadas': db.campanas.aggregate([{ $unwind: '$publicaciones_asociadas' },
      { $lookup: { from: 'publicaciones', localField: 'publicaciones_asociadas', foreignField: '_id', as: 'ref' } },
      { $match: { ref: { $size: 0 } } }, { $count: 'n' }]).toArray().map(x => x.n)[0] || 0,
  };
});

seccion('Q04', 'Inconsistencia temporal: interacciones ANTES de que existiera la publicación', () => ({
  reacciones: db.reacciones.aggregate(antesDePublicacion('reacciones').concat([{ $count: 'n' }])).toArray()[0].n,
  comentarios: db.comentarios.aggregate(antesDePublicacion('comentarios').concat([{ $count: 'n' }])).toArray()[0].n,
  ejemplo: db.comentarios.aggregate(antesDePublicacion('comentarios').concat([{ $limit: 1 },
    { $project: { publicacion_id: 1, fecha_comentario: '$fecha', fecha_publicacion: '$pub.fecha_publicacion' } }])).toArray()[0],
}));

seccion('Q05', 'Inconsistencia temporal: actividad ANTES del registro del usuario', () => ({
  publicaciones: db.publicaciones.aggregate(antesDeRegistro('publicaciones', 'fecha_publicacion').concat([{ $count: 'n' }])).toArray()[0].n,
  reacciones: db.reacciones.aggregate(antesDeRegistro('reacciones', 'fecha').concat([{ $count: 'n' }])).toArray()[0].n,
  comentarios: db.comentarios.aggregate(antesDeRegistro('comentarios', 'fecha').concat([{ $count: 'n' }])).toArray()[0].n,
}));

seccion('Q06', 'Campañas: publicaciones asociadas publicadas fuera de la vigencia de la campaña', () =>
  db.campanas.aggregate([
    { $unwind: '$publicaciones_asociadas' },
    { $lookup: { from: 'publicaciones', localField: 'publicaciones_asociadas', foreignField: '_id', as: 'p' } },
    { $unwind: '$p' },
    { $group: { _id: null, asociaciones: { $sum: 1 },
                fuera_de_ventana: { $sum: { $cond: [{ $or: [{ $lt: ['$p.fecha_publicacion', '$fecha_inicio'] },
                                                             { $gt: ['$p.fecha_publicacion', '$fecha_fin'] }] }, 1, 0] } } } },
    { $project: { _id: 0, asociaciones: 1, fuera_de_ventana: 1,
                  porcentaje: { $round: [{ $multiply: [{ $divide: ['$fuera_de_ventana', '$asociaciones'] }, 100] }, 1] } } },
  ]).toArray());

seccion('Q07', 'Otras reglas: auto-reacciones, rangos inválidos y campos vacíos', () => ({
  auto_reacciones: db.reacciones.aggregate([
    { $lookup: { from: 'publicaciones', localField: 'publicacion_id', foreignField: '_id', as: 'p' } },
    { $match: { $expr: { $eq: ['$usuario_id', { $first: '$p.usuario_id' }] } } },
    { $project: { usuario_id: 1, publicacion_id: 1, tipo_reaccion: 1 } }]).toArray(),
  likes_negativos: db.comentarios.countDocuments({ likes: { $lt: 0 } }),
  campanas_fin_antes_de_inicio: db.campanas.countDocuments({ $expr: { $lt: ['$fecha_fin', '$fecha_inicio'] } }),
  contenido_vacio: db.publicaciones.countDocuments({ contenido: { $in: ['', null] } }),
  hashtags_sin_numeral: db.publicaciones.countDocuments({ hashtags: { $elemMatch: { $not: /^#/ } } }),
}));

// ---------------------------------------------------------------- REGISTRO DE EVIDENCIA
seccion('Q08', 'Registro de evidencia en auditoria_calidad ($merge) antes de corregir', () => ({
  reaccion_duplicada: auditar('reacciones', [
    { $group: { _id: { u: '$usuario_id', p: '$publicacion_id' }, ids: { $push: '$_id' }, n: { $sum: 1 } } },
    { $match: { n: { $gt: 1 } } }, { $unwind: '$ids' }, { $project: { _id: '$ids' } }],
    'reaccion_duplicada', 'Mismo usuario_id + publicacion_id más de una vez', 'Se conserva la más antigua; la otra pasa a reacciones_descartadas'),
  reaccion_antes_publicacion: auditar('reacciones', antesDePublicacion(), 'interaccion_antes_de_publicacion',
    'reacciones.fecha < publicaciones.fecha_publicacion', 'Se marca (calidad.flags) y se excluye de análisis temporales'),
  comentario_antes_publicacion: auditar('comentarios', antesDePublicacion(), 'interaccion_antes_de_publicacion',
    'comentarios.fecha < publicaciones.fecha_publicacion', 'Se marca (calidad.flags) y se excluye de análisis temporales'),
  publicacion_antes_registro: auditar('publicaciones', antesDeRegistro('publicaciones', 'fecha_publicacion'), 'actividad_antes_de_registro',
    'fecha_publicacion < usuarios.fecha_registro', 'Se marca (calidad.flags); se mantiene por ser contenido válido'),
  reaccion_antes_registro: auditar('reacciones', antesDeRegistro('reacciones', 'fecha'), 'actividad_antes_de_registro',
    'reacciones.fecha < usuarios.fecha_registro', 'Se marca (calidad.flags)'),
  comentario_antes_registro: auditar('comentarios', antesDeRegistro('comentarios', 'fecha'), 'actividad_antes_de_registro',
    'comentarios.fecha < usuarios.fecha_registro', 'Se marca (calidad.flags)'),
  auto_reaccion: auditar('reacciones', [
    { $lookup: { from: 'publicaciones', localField: 'publicacion_id', foreignField: '_id', as: 'p' } },
    { $match: { $expr: { $eq: ['$usuario_id', { $first: '$p.usuario_id' }] } } }], 'auto_reaccion',
    'El autor reacciona a su propia publicación', 'Se marca y se justifica: la plataforma lo permite'),
  campana_publicacion_fuera_de_vigencia: auditar('campanas', [
    { $unwind: '$publicaciones_asociadas' },
    { $lookup: { from: 'publicaciones', localField: 'publicaciones_asociadas', foreignField: '_id', as: 'p' } },
    { $unwind: '$p' },
    { $match: { $expr: { $or: [{ $lt: ['$p.fecha_publicacion', '$fecha_inicio'] }, { $gt: ['$p.fecha_publicacion', '$fecha_fin'] }] } } },
    { $project: { _id: { $concat: ['$_id', '/', '$publicaciones_asociadas'] } } }], 'campana_publicacion_fuera_de_vigencia',
    'Publicación asociada con fecha fuera de [fecha_inicio, fecha_fin]', 'Se registra en calidad.publicaciones_fuera_de_vigencia; las métricas cuentan solo interacciones dentro de la vigencia'),
}));

// ---------------------------------------------------------------- CORRECCIÓN
seccion('Q09', 'Corrección 1: reacción duplicada → se conserva la más antigua, la otra se respalda y elimina', () => {
  const dups = db.reacciones.aggregate([
    { $sort: { fecha: 1 } },
    { $group: { _id: { u: '$usuario_id', p: '$publicacion_id' }, docs: { $push: '$$ROOT' }, n: { $sum: 1 } } },
    { $match: { n: { $gt: 1 } } }]).toArray();
  let movidas = 0;
  for (const g of dups) {
    const [conservada, ...sobrantes] = g.docs;
    for (const d of sobrantes) {
      db.reacciones_descartadas.replaceOne({ _id: d._id },
        { ...d, motivo: 'duplicada', conservada: conservada._id, descartada_en: new Date() }, { upsert: true });
      movidas += db.reacciones.deleteOne({ _id: d._id }).deletedCount;
    }
  }
  return { grupos_duplicados: dups.length, reacciones_movidas: movidas,
           respaldo: db.reacciones_descartadas.find({}, { usuario_id: 1, publicacion_id: 1, fecha: 1, conservada: 1 }).toArray() };
});

seccion('Q10', 'Prevención: ahora sí se crea el índice único usuario_id + publicacion_id', () => ({
  indice: db.reacciones.createIndex({ usuario_id: 1, publicacion_id: 1 }, { unique: true, name: 'ux_usuario_publicacion' }),
  duplicados_restantes: db.reacciones.aggregate([{ $group: { _id: { u: '$usuario_id', p: '$publicacion_id' }, n: { $sum: 1 } } }, { $match: { n: { $gt: 1 } } }, { $count: 'n' }]).toArray().length,
}));

seccion('Q11', 'Corrección 2: marcar inconsistencias temporales con calidad.flags (sin inventar fechas)', () => {
  const marcar = (col, tipo) => {
    const ids = db.auditoria_calidad.distinct('documento_id', { coleccion: col, tipo });
    return db[col].updateMany({ _id: { $in: ids } }, { $addToSet: { 'calidad.flags': tipo } }).modifiedCount;
  };
  return {
    'reacciones.interaccion_antes_de_publicacion': marcar('reacciones', 'interaccion_antes_de_publicacion'),
    'comentarios.interaccion_antes_de_publicacion': marcar('comentarios', 'interaccion_antes_de_publicacion'),
    'publicaciones.actividad_antes_de_registro': marcar('publicaciones', 'actividad_antes_de_registro'),
    'reacciones.actividad_antes_de_registro': marcar('reacciones', 'actividad_antes_de_registro'),
    'comentarios.actividad_antes_de_registro': marcar('comentarios', 'actividad_antes_de_registro'),
    'reacciones.auto_reaccion': marcar('reacciones', 'auto_reaccion'),
  };
});

seccion('Q12', 'Corrección 3: campañas → lista de publicaciones fuera de vigencia (pérdida de contexto evitada)', () => {
  const r = db.campanas.aggregate([
    { $unwind: '$publicaciones_asociadas' },
    { $lookup: { from: 'publicaciones', localField: 'publicaciones_asociadas', foreignField: '_id', as: 'p' } },
    { $unwind: '$p' },
    { $match: { $expr: { $or: [{ $lt: ['$p.fecha_publicacion', '$fecha_inicio'] }, { $gt: ['$p.fecha_publicacion', '$fecha_fin'] }] } } },
    { $group: { _id: '$_id', fuera: { $push: '$publicaciones_asociadas' } } },
    { $project: { 'calidad.publicaciones_fuera_de_vigencia': '$fuera' } },
    { $merge: { into: 'campanas', on: '_id', whenMatched: 'merge', whenNotMatched: 'discard' } },
  ]).toArray();
  return {
    campanas_marcadas: db.campanas.countDocuments({ 'calidad.publicaciones_fuera_de_vigencia.0': { $exists: true } }),
    ejemplo: db.campanas.findOne({ 'calidad.publicaciones_fuera_de_vigencia.0': { $exists: true } },
      { nombre: 1, fecha_inicio: 1, fecha_fin: 1, publicaciones_asociadas: 1, calidad: 1 }),
  };
});

seccion('Q13', 'Prevención: índice único nombre + fecha_inicio en campañas (homónimas con fechas distintas siguen permitidas)', () =>
  db.campanas.createIndex({ nombre: 1, fecha_inicio: 1 }, { unique: true, name: 'ux_nombre_inicio' }));

seccion('Q14', 'Resumen final de la auditoría (evidencia conservada)', () =>
  db.auditoria_calidad.aggregate([
    { $group: { _id: { tipo: '$tipo', coleccion: '$coleccion' }, documentos: { $sum: 1 }, accion: { $first: '$accion' } } },
    { $project: { _id: 0, tipo: '$_id.tipo', coleccion: '$_id.coleccion', documentos: 1 } },
    { $sort: { documentos: -1 } },
  ]).toArray(), { tabla: true });

seccion('Q15', 'Verificación después de la limpieza', () => ({
  reacciones: db.reacciones.countDocuments(),
  reacciones_descartadas: db.reacciones_descartadas.countDocuments(),
  reacciones_marcadas: db.reacciones.countDocuments({ 'calidad.flags.0': { $exists: true } }),
  comentarios_marcados: db.comentarios.countDocuments({ 'calidad.flags.0': { $exists: true } }),
  publicaciones_marcadas: db.publicaciones.countDocuments({ 'calidad.flags.0': { $exists: true } }),
  reacciones_validas_para_analisis_temporal: db.reacciones.countDocuments({ 'calidad.flags': { $nin: ['interaccion_antes_de_publicacion', 'actividad_antes_de_registro'] } }),
}));
