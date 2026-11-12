// 07 - Operaciones CRUD combinadas que simulan casos de negocio de ContentFlow (IE7, IE8)
// Cada caso muestra el estado ANTES y DESPUÉS. Los documentos de demostración usan ids *_demo_*
// y el script es re-ejecutable (limpia los restos de una ejecución anterior).
load('scripts/lib.js');
titulo('07 · CRUD de negocio');

const ahora = () => new Date();
// limpieza de una ejecución anterior
db.usuarios.deleteMany({ _id: /^user_demo_/ });
db.publicaciones.deleteMany({ _id: /^pub_demo_/ });
db.reacciones.deleteMany({ $or: [{ _id: /^react_demo_/ }, { usuario_id: /^user_demo_/ }] });
db.comentarios.deleteMany({ $or: [{ _id: /^comm_demo_/ }, { usuario_id: /^user_demo_/ }] });
db.campanas.deleteMany({ _id: /^camp_demo_/ });
db.comentarios_eliminados.deleteMany({ _id: /^comm_demo_/ });

// Función de negocio: inserta una reacción solo si el usuario y la publicación existen (integridad referencial)
function reaccionar(id, usuario_id, publicacion_id, tipo_reaccion) {
  if (!db.usuarios.findOne({ _id: usuario_id }, { _id: 1 })) throw new Error('Referencia inválida: usuario ' + usuario_id + ' no existe');
  if (!db.publicaciones.findOne({ _id: publicacion_id }, { _id: 1 })) throw new Error('Referencia inválida: publicación ' + publicacion_id + ' no existe');
  db.reacciones.insertOne({ _id: id, usuario_id, publicacion_id, tipo_reaccion, fecha: ahora() });
  return db.publicaciones.updateOne({ _id: publicacion_id }, { $inc: { 'metricas.reacciones': 1 } });
}

// ------------------------------------------------------------ CREATE
seccion('U01', 'ANTES: la nueva creadora aún no existe', () => db.usuarios.findOne({ _id: 'user_demo_1' }),
  { negocio: 'Onboarding: una creadora se registra desde su móvil y publica su primer contenido' });

seccion('U02', 'CREATE: alta de usuaria + primera publicación (insertOne x2)', () => ({
  usuario: db.usuarios.insertOne({ _id: 'user_demo_1', nombre: 'Camila Rojas', correo: 'camila.rojas@contentflow.cl',
    pais: 'Chile', genero: 'Femenino', fecha_registro: ahora(), dispositivo: 'Móvil' }),
  publicacion: db.publicaciones.insertOne({ _id: 'pub_demo_1', usuario_id: 'user_demo_1',
    contenido: 'Mi primer video: 5 consejos para aprender bases de datos NoSQL', fecha_publicacion: ahora(),
    categoria: 'Educación', hashtags: ['#aprendizaje'], tipo: 'Video',
    metricas: { reacciones: 0, comentarios: 0 }, ultimos_comentarios: [] }),
}));

// ------------------------------------------------------------ READ
seccion('U03', 'READ: muro de la usuaria (find + proyección + orden)', () =>
  db.publicaciones.find({ usuario_id: 'user_demo_1' }, { contenido: 1, categoria: 1, hashtags: 1, metricas: 1 })
    .sort({ fecha_publicacion: -1 }).toArray());

// ------------------------------------------------------------ UPDATE con $inc y $push
seccion('U04', 'CREATE + UPDATE ($inc): dos usuarios reaccionan y el contador se incrementa', () => {
  reaccionar('react_demo_1', 'user_10', 'pub_demo_1', 'Me encanta');
  reaccionar('react_demo_2', 'user_20', 'pub_demo_1', 'Me gusta');
  return db.publicaciones.findOne({ _id: 'pub_demo_1' }, { metricas: 1 });
}, { negocio: 'Interacciones en tiempo real: cada reacción actualiza el contador desnormalizado de la publicación' });

seccion('U05', 'CREATE + UPDATE ($push con $slice, $inc): comentario y vista previa de los 3 últimos', () => {
  const c = { _id: 'comm_demo_1', usuario_id: 'user_30', publicacion_id: 'pub_demo_1',
              comentario: '¡Excelente explicación, gracias!', fecha: ahora(), likes: 0 };
  db.comentarios.insertOne(c);
  db.publicaciones.updateOne({ _id: 'pub_demo_1' }, {
    $inc: { 'metricas.comentarios': 1 },
    $push: { ultimos_comentarios: { $each: [{ id: c._id, usuario_id: c.usuario_id, texto: c.comentario }], $position: 0, $slice: 3 } },
  });
  return db.publicaciones.findOne({ _id: 'pub_demo_1' }, { metricas: 1, ultimos_comentarios: 1 });
});

seccion('U06', 'UPDATE ($inc): el comentario recibe 3 likes', () => {
  const antes = db.comentarios.findOne({ _id: 'comm_demo_1' }, { likes: 1 }).likes;
  for (let i = 0; i < 3; i++) db.comentarios.updateOne({ _id: 'comm_demo_1' }, { $inc: { likes: 1 } });
  return { antes, despues: db.comentarios.findOne({ _id: 'comm_demo_1' }, { likes: 1 }).likes };
});

seccion('U07', 'UPDATE ($set, $addToSet, $pull): edición de la publicación', () => {
  const antes = db.publicaciones.findOne({ _id: 'pub_demo_1' }, { contenido: 1, hashtags: 1 });
  db.publicaciones.updateOne({ _id: 'pub_demo_1' }, {
    $set: { contenido: 'Mi primer video: 5 consejos para aprender MongoDB Atlas', editado_en: ahora() },
    $addToSet: { hashtags: { $each: ['#innovacion', '#aprendizaje'] } },   // #aprendizaje ya existe: no se duplica
  });
  db.publicaciones.updateOne({ _id: 'pub_demo_1' }, { $pull: { hashtags: '#aprendizaje' } });
  db.publicaciones.updateOne({ _id: 'pub_demo_1' }, { $push: { hashtags: '#tecnologia' } });
  return { antes, despues: db.publicaciones.findOne({ _id: 'pub_demo_1' }, { contenido: 1, hashtags: 1, editado_en: 1 }) };
});

seccion('U08', 'CREATE + UPDATE ($addToSet): nueva campaña y asociación de la publicación', () => {
  db.campanas.insertOne({ _id: 'camp_demo_1', nombre: 'Campaña Aprende NoSQL', fecha_inicio: ahora(),
    fecha_fin: new Date(Date.now() + 30 * 864e5), objetivo: 'Promover contenido', publicaciones_asociadas: ['pub_237'],
    metricas_objetivo: { likes: 50, comentarios: 20, compartidos: 10 } });
  const antes = db.campanas.findOne({ _id: 'camp_demo_1' }, { publicaciones_asociadas: 1 });
  db.campanas.updateOne({ _id: 'camp_demo_1' }, { $addToSet: { publicaciones_asociadas: 'pub_demo_1' } });
  return { antes, despues: db.campanas.findOne({ _id: 'camp_demo_1' }, { publicaciones_asociadas: 1 }) };
}, { negocio: 'Marketing crea una campaña y suma la publicación de la nueva creadora' });

seccion('U09', 'UPDATE masivo (updateMany con pipeline): estado de cada campaña a una fecha de corte', () => {
  const corte = ISODate('2025-05-01T00:00:00Z');
  const r = db.campanas.updateMany({}, [{ $set: { estado: { $switch: { branches: [
    { case: { $gt: ['$fecha_inicio', corte] }, then: 'programada' },
    { case: { $lt: ['$fecha_fin', corte] }, then: 'finalizada' }], default: 'vigente' } } } }]);
  return { modificadas: r.modifiedCount,
           por_estado: db.campanas.aggregate([{ $group: { _id: '$estado', n: { $sum: 1 } } }, { $sort: { n: -1 } }]).toArray() };
});

seccion('U10', 'bulkWrite: varias operaciones de moderación en un solo viaje a Atlas', () =>
  db.publicaciones.bulkWrite([
    { updateOne: { filter: { _id: 'pub_demo_1' }, update: { $set: { 'moderacion.revisada': true } } } },
    { updateMany: { filter: { 'calidad.flags': 'actividad_antes_de_registro' }, update: { $set: { 'moderacion.requiere_revision': true } } } },
  ], { ordered: true }));

// ------------------------------------------------------------ ERRORES COMUNES (IE8)
seccion('U11', 'Error común 1 – duplicado: misma usuaria reacciona dos veces (índice único)', () =>
  db.reacciones.insertOne({ _id: 'react_demo_3', usuario_id: 'user_10', publicacion_id: 'pub_demo_1', tipo_reaccion: 'Me gusta', fecha: ahora() }));

seccion('U12', 'Error común 2 – correo ya registrado (índice único ux_correo)', () =>
  db.usuarios.insertOne({ _id: 'user_demo_2', nombre: 'Copia', correo: 'camila.rojas@contentflow.cl',
    pais: 'Chile', genero: 'Femenino', fecha_registro: ahora(), dispositivo: 'Móvil' }));

seccion('U13', 'Error común 3 – referencia inválida: reacción a una publicación que no existe', () =>
  reaccionar('react_demo_4', 'user_10', 'pub_99999', 'Me gusta'));

seccion('U14', 'Error común 4 – tipo incorrecto: likes como texto (validador $jsonSchema)', () =>
  db.comentarios.insertOne({ _id: 'comm_demo_2', usuario_id: 'user_30', publicacion_id: 'pub_demo_1',
    comentario: 'hola', fecha: ahora(), likes: 'diez' }));

// ------------------------------------------------------------ DELETE
seccion('U15', 'DELETE con respaldo: moderación elimina un comentario reportado', () => {
  const c = db.comentarios.findOne({ _id: 'comm_demo_1' });
  db.comentarios_eliminados.insertOne({ ...c, motivo: 'reportado por spam', eliminado_en: ahora() });
  const del = db.comentarios.deleteOne({ _id: 'comm_demo_1' });
  db.publicaciones.updateOne({ _id: 'pub_demo_1' },
    { $inc: { 'metricas.comentarios': -1 }, $pull: { ultimos_comentarios: { id: 'comm_demo_1' } } });
  return { eliminados: del.deletedCount, en_respaldo: db.comentarios_eliminados.countDocuments({ _id: 'comm_demo_1' }),
           publicacion: db.publicaciones.findOne({ _id: 'pub_demo_1' }, { metricas: 1, ultimos_comentarios: 1 }) };
});

seccion('U16', 'DELETE en cascada con transacción: la usuaria pide eliminar su cuenta', () => {
  const antes = {
    usuario: db.usuarios.countDocuments({ _id: 'user_demo_1' }),
    publicaciones: db.publicaciones.countDocuments({ usuario_id: 'user_demo_1' }),
    reacciones_a_sus_publicaciones: db.reacciones.countDocuments({ publicacion_id: 'pub_demo_1' }),
    campanas_que_la_referencian: db.campanas.countDocuments({ publicaciones_asociadas: 'pub_demo_1' }),
  };
  const sesion = db.getMongo().startSession();
  sesion.withTransaction(() => {
    const s = sesion.getDatabase(DB_NAME);
    const pubs = s.publicaciones.find({ usuario_id: 'user_demo_1' }, { _id: 1 }).toArray().map(p => p._id);
    s.reacciones.deleteMany({ $or: [{ usuario_id: 'user_demo_1' }, { publicacion_id: { $in: pubs } }] });
    s.comentarios.deleteMany({ $or: [{ usuario_id: 'user_demo_1' }, { publicacion_id: { $in: pubs } }] });
    s.campanas.updateMany({ publicaciones_asociadas: { $in: pubs } }, { $pull: { publicaciones_asociadas: { $in: pubs } } });
    s.publicaciones.deleteMany({ _id: { $in: pubs } });
    s.usuarios.deleteOne({ _id: 'user_demo_1' });
  }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } });
  sesion.endSession();
  const despues = {
    usuario: db.usuarios.countDocuments({ _id: 'user_demo_1' }),
    publicaciones: db.publicaciones.countDocuments({ usuario_id: 'user_demo_1' }),
    reacciones_a_sus_publicaciones: db.reacciones.countDocuments({ publicacion_id: 'pub_demo_1' }),
    campanas_que_la_referencian: db.campanas.countDocuments({ publicaciones_asociadas: 'pub_demo_1' }),
  };
  return { antes, despues };
});

seccion('U17', 'DELETE: se cierra la campaña de demostración', () => ({
  eliminada: db.campanas.deleteOne({ _id: 'camp_demo_1' }).deletedCount,
  conteos_finales: Object.fromEntries(['usuarios', 'publicaciones', 'reacciones', 'comentarios', 'campanas']
    .map(c => [c, db[c].countDocuments()])),
}));
