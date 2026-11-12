// 03 - Índices (mecanismo de optimización en M0, sin sharding) y validadores $jsonSchema (IE2)
load('scripts/lib.js');
titulo('03 · Índices y reglas de validación');

const INDICES = [
  // [colección, clave, opciones, justificación]
  ['usuarios', { correo: 1 }, { unique: true, name: 'ux_correo' }, 'Login/alta por correo y evitar usuarios duplicados'],
  ['usuarios', { pais: 1, genero: 1 }, { name: 'ix_pais_genero' }, 'Perfil de audiencia por país y género'],
  ['publicaciones', { usuario_id: 1, fecha_publicacion: -1 }, { name: 'ix_usuario_fecha' }, 'Muro de un usuario (sus publicaciones más recientes)'],
  ['publicaciones', { categoria: 1, fecha_publicacion: -1 }, { name: 'ix_categoria_fecha' }, 'Contenido por categoría ordenado por fecha (regla ESR)'],
  ['publicaciones', { hashtags: 1 }, { name: 'ix_hashtags' }, 'Búsqueda por hashtag (índice multiclave)'],
  ['reacciones', { publicacion_id: 1, tipo_reaccion: 1 }, { name: 'ix_pub_tipo' }, '$lookup de reacciones por publicación y conteo por tipo'],
  ['reacciones', { usuario_id: 1, publicacion_id: 1 }, { unique: true, name: 'ux_usuario_publicacion' }, 'Un usuario reacciona una sola vez por publicación'],
  ['comentarios', { publicacion_id: 1, fecha: -1 }, { name: 'ix_pub_fecha' }, 'Comentarios de una publicación, más recientes primero'],
  ['comentarios', { usuario_id: 1 }, { name: 'ix_usuario' }, 'Actividad de un usuario (ranking de usuarios activos)'],
  ['campanas', { fecha_inicio: 1, fecha_fin: 1 }, { name: 'ix_vigencia' }, 'Campañas vigentes en una fecha'],
  ['campanas', { publicaciones_asociadas: 1 }, { name: 'ix_pubs_asociadas' }, '¿En qué campañas participa una publicación?'],
];

seccion('X01', 'Creación de índices', () => {
  const r = [];
  for (const [col, clave, opts, por] of INDICES) {
    try {
      db[col].createIndex(clave, opts);
      r.push({ coleccion: col, indice: opts.name, estado: 'OK' });
    } catch (e) {
      r.push({ coleccion: col, indice: opts.name, estado: 'ERROR ' + e.codeName + ' → ' + (e.message.match(/dup key: .*/) || [e.message])[0] });
    }
  }
  return r;
}, { tabla: true });

seccion('X02', 'Índices existentes por colección', () => {
  const r = {};
  for (const c of ['usuarios', 'publicaciones', 'reacciones', 'comentarios', 'campanas'])
    r[c] = db[c].getIndexes().map(i => i.name + (i.unique ? ' (único)' : '') + ' ' + JSON.stringify(i.key));
  return r;
});

const NUM = { bsonType: ['int', 'long', 'double'], minimum: 0 };
const VALIDADORES = {
  usuarios: { $jsonSchema: {
    bsonType: 'object', required: ['_id', 'nombre', 'correo', 'pais', 'genero', 'fecha_registro', 'dispositivo'],
    properties: {
      _id: { bsonType: 'string', pattern: '^user_' },
      nombre: { bsonType: 'string', minLength: 1 },
      correo: { bsonType: 'string', pattern: '^[^@\\s]+@[^@\\s]+\\.[a-zA-Z]{2,}$' },
      genero: { enum: ['Femenino', 'Masculino', 'Otro'] },
      dispositivo: { enum: ['Móvil', 'Desktop', 'Tablet'] },
      fecha_registro: { bsonType: 'date' },
    } } },
  publicaciones: { $jsonSchema: {
    bsonType: 'object', required: ['_id', 'usuario_id', 'contenido', 'fecha_publicacion', 'categoria', 'tipo'],
    properties: {
      _id: { bsonType: 'string', pattern: '^pub_' },
      usuario_id: { bsonType: 'string', pattern: '^user_' },
      contenido: { bsonType: 'string', minLength: 1 },
      fecha_publicacion: { bsonType: 'date' },
      categoria: { enum: ['Tecnología', 'Cultura', 'Educación', 'Deportes', 'Entretenimiento'] },
      hashtags: { bsonType: 'array', items: { bsonType: 'string', pattern: '^#' } },
      tipo: { enum: ['Imagen', 'Video', 'Texto'] },
    } } },
  reacciones: { $jsonSchema: {
    bsonType: 'object', required: ['_id', 'usuario_id', 'publicacion_id', 'tipo_reaccion', 'fecha'],
    properties: {
      usuario_id: { bsonType: 'string', pattern: '^user_' },
      publicacion_id: { bsonType: 'string', pattern: '^pub_' },
      tipo_reaccion: { enum: ['Me gusta', 'Me encanta', 'Me entristece', 'Me enoja'] },
      fecha: { bsonType: 'date' },
    } } },
  comentarios: { $jsonSchema: {
    bsonType: 'object', required: ['_id', 'usuario_id', 'publicacion_id', 'comentario', 'fecha', 'likes'],
    properties: {
      usuario_id: { bsonType: 'string', pattern: '^user_' },
      publicacion_id: { bsonType: 'string', pattern: '^pub_' },
      comentario: { bsonType: 'string', minLength: 1 },
      fecha: { bsonType: 'date' },
      likes: NUM,
    } } },
  campanas: { $jsonSchema: {
    bsonType: 'object', required: ['_id', 'nombre', 'fecha_inicio', 'fecha_fin', 'objetivo', 'publicaciones_asociadas', 'metricas_objetivo'],
    properties: {
      nombre: { bsonType: 'string', minLength: 1 },
      fecha_inicio: { bsonType: 'date' },
      fecha_fin: { bsonType: 'date' },
      objetivo: { enum: ['Captar nuevos usuarios', 'Aumentar engagement', 'Promover contenido'] },
      publicaciones_asociadas: { bsonType: 'array', items: { bsonType: 'string', pattern: '^pub_' } },
      metricas_objetivo: { bsonType: 'object', required: ['likes', 'comentarios', 'compartidos'],
        properties: { likes: NUM, comentarios: NUM, compartidos: NUM } },
    } } },
};

seccion('X03', 'Validadores $jsonSchema con collMod (validationAction: error)', () => {
  const r = {};
  for (const [col, validator] of Object.entries(VALIDADORES)) {
    try {
      const res = db.runCommand({ collMod: col, validator, validationLevel: 'strict', validationAction: 'error' });
      r[col] = res.ok === 1 ? 'OK' : res;
    } catch (e) { r[col] = 'ERROR ' + e.codeName + ': ' + e.message; }
  }
  return r;
});

seccion('X04', 'Prueba del validador: insertar una reacción con tipo inválido y fecha como texto', () =>
  db.reacciones.insertOne({ _id: 'react_invalida', usuario_id: 'user_1', publicacion_id: 'pub_1',
                            tipo_reaccion: 'Me divierte', fecha: '2025-07-01' }));
