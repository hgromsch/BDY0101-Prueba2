// 05 - Consultas de lectura y pipelines de agregación para la gerencia de ContentFlow (IE4, IE5)
load('scripts/lib.js');
titulo('05 · Consultas de negocio');

const DIAS = ['', 'Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
// Interacciones con fecha confiable (ver 04_calidad_datos.js)
const FECHA_CONFIABLE = { 'calidad.flags': { $nin: ['interaccion_antes_de_publicacion', 'actividad_antes_de_registro'] } };

// ------------------------------------------------------------------ CONSULTAS find()
seccion('L01', 'Filtro + proyección + orden: últimos videos de Tecnología', () =>
  db.publicaciones.find(
    { categoria: 'Tecnología', tipo: 'Video', fecha_publicacion: { $gte: ISODate('2025-06-01T00:00:00Z') } },
    { _id: 1, usuario_id: 1, fecha_publicacion: 1, hashtags: 1 }
  ).sort({ fecha_publicacion: -1 }).limit(5).toArray(),
  { negocio: 'Diseño de contenido: ¿qué videos de Tecnología se publicaron desde junio 2025? (los más recientes primero)' });

seccion('L02', 'Operadores de comparación y lógicos: comentarios destacados de junio', () =>
  db.comentarios.find(
    { $and: [
      { likes: { $gte: 95 } },
      { fecha: { $gte: ISODate('2025-06-01T00:00:00Z'), $lt: ISODate('2025-07-01T00:00:00Z') } },
    ] },
    { _id: 0, usuario_id: 1, publicacion_id: 1, comentario: 1, likes: 1 }
  ).sort({ likes: -1, fecha: -1 }).toArray(),
  { negocio: 'Moderación/comunidad: comentarios con 95 o más likes en junio 2025 para destacarlos' });

const IBEROAMERICA = ['Chile', 'Argentina', 'Peru', 'Mexico', 'Spain', 'Brazil', 'Colombia', 'Uruguay',
                      'Venezuela', 'Ecuador', 'Bolivia', 'Paraguay'];
seccion('L03', '$in y $or: audiencia objetivo para una campaña móvil', () => ({
  total: db.usuarios.countDocuments({
    dispositivo: 'Móvil',
    $or: [{ genero: 'Femenino' }, { fecha_registro: { $gte: ISODate('2025-01-01T00:00:00Z') } }],
    pais: { $in: IBEROAMERICA },
  }),
  muestra: db.usuarios.find({
    dispositivo: 'Móvil',
    $or: [{ genero: 'Femenino' }, { fecha_registro: { $gte: ISODate('2025-01-01T00:00:00Z') } }],
    pais: { $in: IBEROAMERICA },
  }, { _id: 0, nombre: 1, pais: 1, genero: 1, fecha_registro: 1 }).sort({ pais: 1, nombre: 1 }).toArray(),
}), { negocio: 'Perfil de audiencia: usuarios móviles de Iberoamérica que son mujeres o se registraron en 2025' });

seccion('L04', 'Búsqueda compuesta: hashtags ($all), categoría ($nin), texto (regex) y tipo', () =>
  db.publicaciones.find(
    { hashtags: { $all: ['#cultura', '#series'] }, categoria: { $nin: ['Deportes'] },
      tipo: { $ne: 'Texto' }, contenido: { $regex: /movie|film|show/i } },
    { contenido: 1, categoria: 1, tipo: 1, hashtags: 1 }
  ).sort({ fecha_publicacion: -1 }).limit(5).toArray(),
  { negocio: 'Curaduría: piezas visuales con #cultura y #series que hablan de cine/espectáculos, fuera de Deportes' });

seccion('L05', 'Arreglos y subdocumentos: $size y notación de punto', () =>
  db.campanas.find(
    { publicaciones_asociadas: { $size: 5 }, 'metricas_objetivo.likes': { $gt: 900 }, objetivo: 'Aumentar engagement' },
    { _id: 1, nombre: 1, 'metricas_objetivo.likes': 1, fecha_fin: 1 }
  ).sort({ 'metricas_objetivo.likes': -1 }).toArray(),
  { negocio: 'Campañas de engagement grandes (5 publicaciones) con meta de más de 900 likes' });

// ------------------------------------------------------------------ AGREGACIONES
seccion('A01', 'Usuarios más activos ($unionWith + $group + $lookup)', () =>
  db.publicaciones.aggregate([
    { $project: { usuario_id: 1, tipo: { $literal: 'publicacion' } } },
    { $unionWith: { coll: 'reacciones', pipeline: [{ $project: { usuario_id: 1, tipo: { $literal: 'reaccion' } } }] } },
    { $unionWith: { coll: 'comentarios', pipeline: [{ $project: { usuario_id: 1, tipo: { $literal: 'comentario' } } }] } },
    { $group: { _id: '$usuario_id', total: { $sum: 1 },
                publicaciones: { $sum: { $cond: [{ $eq: ['$tipo', 'publicacion'] }, 1, 0] } },
                reacciones: { $sum: { $cond: [{ $eq: ['$tipo', 'reaccion'] }, 1, 0] } },
                comentarios: { $sum: { $cond: [{ $eq: ['$tipo', 'comentario'] }, 1, 0] } } } },
    { $sort: { total: -1, _id: 1 } },
    { $limit: 10 },
    { $lookup: { from: 'usuarios', localField: '_id', foreignField: '_id', as: 'u' } },
    { $project: { usuario: '$_id', _id: 0, nombre: { $first: '$u.nombre' }, pais: { $first: '$u.pais' },
                  total: 1, publicaciones: 1, reacciones: 1, comentarios: 1 } },
  ]).toArray(), { tabla: true, negocio: 'Retención: identificar a los 10 usuarios más activos (publican, reaccionan y comentan)' });

seccion('A02', 'Contenidos más populares ($lookup con pipeline + $addFields + $sort)', () =>
  db.publicaciones.aggregate([
    { $lookup: { from: 'reacciones', localField: '_id', foreignField: 'publicacion_id', as: 'r',
                 pipeline: [{ $project: { tipo_reaccion: 1 } }] } },
    { $lookup: { from: 'comentarios', localField: '_id', foreignField: 'publicacion_id', as: 'c',
                 pipeline: [{ $project: { likes: 1 } }] } },
    { $addFields: { reacciones: { $size: '$r' }, comentarios: { $size: '$c' }, likes_en_comentarios: { $sum: '$c.likes' } } },
    { $addFields: { engagement: { $add: ['$reacciones', { $multiply: ['$comentarios', 2] }] } } },
    { $sort: { engagement: -1, likes_en_comentarios: -1 } },
    { $limit: 10 },
    { $project: { _id: 1, categoria: 1, tipo: 1, reacciones: 1, comentarios: 1, likes_en_comentarios: 1, engagement: 1 } },
  ]).toArray(), { tabla: true, negocio: 'Contenidos más populares (engagement = reacciones + 2 × comentarios)' });

seccion('A03', 'Diseño de contenido: rendimiento promedio por categoría y tipo', () =>
  db.publicaciones.aggregate([
    { $lookup: { from: 'reacciones', localField: '_id', foreignField: 'publicacion_id', as: 'r', pipeline: [{ $project: { _id: 1 } }] } },
    { $lookup: { from: 'comentarios', localField: '_id', foreignField: 'publicacion_id', as: 'c', pipeline: [{ $project: { _id: 1 } }] } },
    { $group: { _id: { categoria: '$categoria', tipo: '$tipo' }, publicaciones: { $sum: 1 },
                interacciones_promedio: { $avg: { $add: [{ $size: '$r' }, { $size: '$c' }] } } } },
    { $project: { _id: 0, categoria: '$_id.categoria', tipo: '$_id.tipo', publicaciones: 1,
                  interacciones_promedio: { $round: ['$interacciones_promedio', 2] } } },
    { $sort: { interacciones_promedio: -1 } },
    { $limit: 8 },
  ]).toArray(), { tabla: true, negocio: '¿Qué combinación categoría × formato genera más interacciones por publicación?' });

seccion('A04', 'Horarios: interacciones por franja horaria (hora de Chile) con $hour', () =>
  db.reacciones.aggregate([
    { $match: FECHA_CONFIABLE },
    { $project: { fecha: 1 } },
    { $unionWith: { coll: 'comentarios', pipeline: [{ $match: FECHA_CONFIABLE }, { $project: { fecha: 1 } }] } },
    { $group: { _id: { $hour: { date: '$fecha', timezone: 'America/Santiago' } }, interacciones: { $sum: 1 } } },
    { $bucket: { groupBy: '$_id', boundaries: [0, 3, 6, 9, 12, 15, 18, 21, 24],
                 output: { interacciones: { $sum: '$interacciones' } } } },
    { $project: { _id: 0, franja: { $concat: [{ $toString: '$_id' }, ':00 a ', { $toString: { $add: ['$_id', 2] } }, ':59 h'] },
                  interacciones: 1 } },
    { $sort: { interacciones: -1 } },
  ]).toArray(), { tabla: true, negocio: 'Horarios de publicación: ¿en qué franja del día interactúa más la audiencia?' });

seccion('A05', 'Horarios: mejor día de la semana para publicar ($dayOfWeek)', () =>
  db.publicaciones.aggregate([
    { $lookup: { from: 'reacciones', localField: '_id', foreignField: 'publicacion_id', as: 'r', pipeline: [{ $project: { _id: 1 } }] } },
    { $group: { _id: { $dayOfWeek: { date: '$fecha_publicacion', timezone: 'America/Santiago' } },
                publicaciones: { $sum: 1 }, reacciones_promedio: { $avg: { $size: '$r' } } } },
    { $sort: { reacciones_promedio: -1 } },
    { $project: { _id: 0, dia: { $arrayElemAt: [DIAS, '$_id'] }, publicaciones: 1,
                  reacciones_promedio: { $round: ['$reacciones_promedio', 2] } } },
  ]).toArray(), { tabla: true, negocio: 'Horarios de publicación: día de la semana con más reacciones por publicación' });

seccion('A06', 'Perfil de audiencia: quién reacciona, por género, dispositivo y país ($lookup + $facet)', () =>
  db.reacciones.aggregate([
    { $lookup: { from: 'usuarios', localField: 'usuario_id', foreignField: '_id', as: 'u' } },
    { $unwind: '$u' },
    { $facet: {
      por_genero: [{ $group: { _id: '$u.genero', reacciones: { $sum: 1 } } }, { $sort: { reacciones: -1 } }],
      por_dispositivo: [{ $group: { _id: '$u.dispositivo', reacciones: { $sum: 1 } } }, { $sort: { reacciones: -1 } }],
      top_paises: [{ $group: { _id: '$u.pais', reacciones: { $sum: 1 } } }, { $sort: { reacciones: -1, _id: 1 } }, { $limit: 5 }],
      tono: [{ $group: { _id: '$tipo_reaccion', n: { $sum: 1 } } }, { $sort: { n: -1 } }],
    } },
  ]).toArray(), { negocio: 'Perfil de audiencia para personalizar experiencias' });

seccion('A07', 'Hashtags más usados y su engagement ($unwind + $group)', () =>
  db.publicaciones.aggregate([
    { $lookup: { from: 'reacciones', localField: '_id', foreignField: 'publicacion_id', as: 'r', pipeline: [{ $project: { _id: 1 } }] } },
    { $unwind: '$hashtags' },
    { $group: { _id: '$hashtags', publicaciones: { $sum: 1 }, reacciones: { $sum: { $size: '$r' } } } },
    { $project: { _id: 0, hashtag: '$_id', publicaciones: 1, reacciones: 1,
                  reacciones_por_publicacion: { $round: [{ $divide: ['$reacciones', '$publicaciones'] }, 2] } } },
    { $sort: { publicaciones: -1 } },
  ]).toArray(), { tabla: true, negocio: 'Diseño de contenido: hashtags más usados y cuánto rinden' });

seccion('A08', 'Éxito de campañas: logro vs metas ($unwind + $lookup con vigencia + $group)', () =>
  db.campanas.aggregate([
    { $unwind: '$publicaciones_asociadas' },
    { $lookup: { from: 'reacciones', as: 'r',
                 let: { pub: '$publicaciones_asociadas', ini: '$fecha_inicio', fin: '$fecha_fin' },
                 pipeline: [{ $match: { $expr: { $and: [{ $eq: ['$publicacion_id', '$$pub'] },
                   { $gte: ['$fecha', '$$ini'] }, { $lte: ['$fecha', '$$fin'] },
                   { $in: ['$tipo_reaccion', ['Me gusta', 'Me encanta']] }] } } }, { $project: { _id: 1 } }] } },
    { $lookup: { from: 'comentarios', as: 'c',
                 let: { pub: '$publicaciones_asociadas', ini: '$fecha_inicio', fin: '$fecha_fin' },
                 pipeline: [{ $match: { $expr: { $and: [{ $eq: ['$publicacion_id', '$$pub'] },
                   { $gte: ['$fecha', '$$ini'] }, { $lte: ['$fecha', '$$fin'] }] } } }, { $project: { _id: 1 } }] } },
    { $group: { _id: '$_id', nombre: { $first: '$nombre' }, objetivo: { $first: '$objetivo' },
                meta: { $first: '$metricas_objetivo' },
                likes_reales: { $sum: { $size: '$r' } }, comentarios_reales: { $sum: { $size: '$c' } } } },
    { $addFields: {
      pct_likes: { $round: [{ $multiply: [{ $divide: ['$likes_reales', '$meta.likes'] }, 100] }, 2] },
      pct_comentarios: { $round: [{ $multiply: [{ $divide: ['$comentarios_reales', '$meta.comentarios'] }, 100] }, 2] } } },
    { $sort: { pct_likes: -1, pct_comentarios: -1 } },
    { $limit: 8 },
    { $project: { nombre: 1, objetivo: 1, likes_reales: 1, meta_likes: '$meta.likes', pct_likes: 1,
                  comentarios_reales: 1, meta_comentarios: '$meta.comentarios', pct_comentarios: 1 } },
  ]).toArray(), { tabla: true, negocio: 'Éxito de campañas: likes (Me gusta/Me encanta) y comentarios logrados DURANTE la vigencia vs metas' });

seccion('A09', 'Éxito de campañas por objetivo (resumen gerencial)', () =>
  db.campanas.aggregate([
    { $lookup: { from: 'reacciones', as: 'r',
                 let: { pubs: '$publicaciones_asociadas', ini: '$fecha_inicio', fin: '$fecha_fin' },
                 pipeline: [{ $match: { $expr: { $and: [{ $in: ['$publicacion_id', '$$pubs'] },
                   { $gte: ['$fecha', '$$ini'] }, { $lte: ['$fecha', '$$fin'] }] } } }, { $project: { _id: 1 } }] } },
    { $group: { _id: '$objetivo', campanas: { $sum: 1 },
                interacciones_promedio: { $avg: { $size: '$r' } },
                meta_likes_promedio: { $avg: '$metricas_objetivo.likes' },
                sin_ninguna_interaccion: { $sum: { $cond: [{ $eq: [{ $size: '$r' }, 0] }, 1, 0] } } } },
    { $project: { _id: 0, objetivo: '$_id', campanas: 1, interacciones_promedio: { $round: ['$interacciones_promedio', 2] },
                  meta_likes_promedio: { $round: ['$meta_likes_promedio', 0] }, sin_ninguna_interaccion: 1 } },
    { $sort: { interacciones_promedio: -1 } },
  ]).toArray(), { tabla: true, negocio: 'Impacto de las campañas según su objetivo' });

seccion('A10', 'Campañas vigentes a una fecha dada (rango de fechas + $group)', () =>
  db.campanas.aggregate([
    { $match: { fecha_inicio: { $lte: ISODate('2025-05-01T00:00:00Z') }, fecha_fin: { $gte: ISODate('2025-05-01T00:00:00Z') } } },
    { $group: { _id: '$objetivo', vigentes: { $sum: 1 }, publicaciones: { $sum: { $size: '$publicaciones_asociadas' } } } },
    { $sort: { vigentes: -1 } },
  ]).toArray(), { tabla: true, negocio: '¿Cuántas campañas estaban activas el 1 de mayo de 2025 y con cuántas publicaciones?' });
