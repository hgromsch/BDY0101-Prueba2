// 00 - Verificación de conectividad y configuración del cluster Atlas M0 (IE2, IE3)
load('scripts/lib.js');
titulo('00 · Conectividad con MongoDB Atlas desde mongosh');

seccion('C01', 'Ping al cluster', () => db.adminCommand({ ping: 1 }));

seccion('C02', 'Proveedor, región y topología (tags del nodo Atlas)', () => {
  const h = db.adminCommand({ hello: 1 });
  return {
    replicaSet: h.setName, nodos: h.hosts.length, esPrimario: h.isWritablePrimary,
    proveedor: h.tags.provider, region: h.tags.region, zona: h.tags.availabilityZone,
    versionMongoDB: db.version(), maxConexionesInfo: 'M0: 500 conexiones',
  };
});

seccion('C03', 'Usuario autenticado y sus roles', () => db.adminCommand({ connectionStatus: 1 }).authInfo);

seccion('C04', 'Read concern y write concern configurados en la sesión', () => ({
  readConcern: db.getMongo().getReadConcern(),
  writeConcern: db.getMongo().getWriteConcern(),
}));

seccion('C05', 'Base de datos de trabajo', () => ({ baseActual: db.getName(), colecciones: db.getCollectionNames().sort() }));

seccion('C06', 'Usuario de la aplicación (MONGODB_URI_APP): roles y prueba de permisos', () => {
  if (!process.env.MONGODB_URI_APP) return 'MONGODB_URI_APP no definido';
  const app = new Mongo(process.env.MONGODB_URI_APP);
  const info = app.getDB('admin').runCommand({ connectionStatus: 1 }).authInfo;
  const prueba = (fn) => { try { fn(); return 'PERMITIDO'; } catch (e) { return 'DENEGADO (' + (e.codeName || e.message) + ')'; } };
  return {
    usuario: info.authenticatedUsers[0].user,
    roles: info.authenticatedUserRoles.map(r => r.role + '@' + r.db),
    leer_contentflow: prueba(() => app.getDB('contentflow').usuarios.findOne()),
    escribir_contentflow: prueba(() => { app.getDB('contentflow').prueba_permisos.insertOne({ ok: 1 }); app.getDB('contentflow').prueba_permisos.drop(); }),
    escribir_otra_base: prueba(() => app.getDB('otra_base').x.insertOne({ a: 1 })),
    crear_usuarios: prueba(() => app.getDB('admin').runCommand({ createUser: 'x', pwd: 'x', roles: [] })),
  };
});
