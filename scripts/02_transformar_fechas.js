// 02 - Conversión de fechas de texto ISO a tipo Date + documentos de prueba (IE1, IE3)
// Supuesto documentado: los textos ("2025-03-13T06:37:59") no traen zona horaria; se interpretan
// como hora UTC del servidor de ContentFlow y se guardan como Date (UTC). Los reportes por hora
// pueden mostrarse en hora de Chile con { timezone: "America/Santiago" }.
// Es idempotente: solo convierte documentos cuyo campo todavía sea string.
load('scripts/lib.js');
titulo('02 · Transformación de fechas (string → Date)');

const CAMPOS = {
  usuarios: ['fecha_registro'],
  publicaciones: ['fecha_publicacion'],
  reacciones: ['fecha'],
  comentarios: ['fecha'],
  campanas: ['fecha_inicio', 'fecha_fin'],
};

seccion('F01', 'Antes: ejemplo de documento con fecha como texto', () =>
  db.publicaciones.findOne({ _id: 'pub_1' }, { fecha_publicacion: 1, categoria: 1 }));

seccion('F02', 'Conversión con updateMany + pipeline $dateFromString', () => {
  const resultado = {};
  for (const [col, campos] of Object.entries(CAMPOS)) {
    for (const campo of campos) {
      const r = db[col].updateMany(
        { [campo]: { $type: 'string' } },
        [{ $set: { [campo]: {
          $dateFromString: {
            dateString: '$' + campo,
            format: '%Y-%m-%dT%H:%M:%S',
            timezone: 'UTC',
            onError: '$' + campo,   // si un texto no es fecha válida queda intacto y se detecta abajo
          } } } }]
      );
      resultado[col + '.' + campo] = { encontrados: r.matchedCount, convertidos: r.modifiedCount };
    }
  }
  return resultado;
});

seccion('F03', 'Después: verificación de tipos con $type (no debe quedar ningún string)', () => {
  const filas = [];
  for (const [col, campos] of Object.entries(CAMPOS)) for (const campo of campos) {
    filas.push({
      campo: col + '.' + campo,
      date: db[col].countDocuments({ [campo]: { $type: 'date' } }),
      string: db[col].countDocuments({ [campo]: { $type: 'string' } }),
    });
  }
  return filas;
});

seccion('F04', 'Después: el mismo documento ya con ISODate', () =>
  db.publicaciones.findOne({ _id: 'pub_1' }, { fecha_publicacion: 1, categoria: 1 }));

seccion('F05', 'Ahora funcionan los operadores de fecha ($hour, $dayOfWeek, $month)', () =>
  db.publicaciones.aggregate([
    { $match: { _id: { $in: ['pub_1', 'pub_2', 'pub_3'] } } },
    { $project: { fecha_publicacion: 1, hora: { $hour: '$fecha_publicacion' },
                  diaSemana: { $dayOfWeek: '$fecha_publicacion' }, mes: { $month: '$fecha_publicacion' } } },
  ]).toArray());

seccion('F06', 'Inserción de un documento de prueba con tipos correctos', () =>
  db.usuarios.insertOne({
    _id: 'user_prueba_1', nombre: 'Usuario de Prueba', correo: 'prueba.carga@contentflow.cl',
    pais: 'Chile', genero: 'Otro', fecha_registro: new Date('2025-07-15T12:00:00Z'), dispositivo: 'Móvil',
  }));

seccion('F07', 'Verificación del documento de prueba (tipo de la fecha incluido)', () =>
  db.usuarios.aggregate([
    { $match: { _id: 'user_prueba_1' } },
    { $addFields: { tipo_fecha: { $type: '$fecha_registro' } } },
  ]).toArray());

seccion('F08', 'Limpieza del documento de prueba y conteo final', () => ({
  eliminado: db.usuarios.deleteOne({ _id: 'user_prueba_1' }).deletedCount,
  usuarios: db.usuarios.countDocuments(),
}));
