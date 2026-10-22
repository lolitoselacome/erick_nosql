// =====================================================================
// CETIA - Aplicador de migraciones
//
// Corre en orden los archivos de migrations/ que todavia no se han
// aplicado y deja constancia de cada uno en la coleccion _migraciones.
// Igual que en el proyecto relacional: las migraciones se aplican en
// orden y una que ya se aplico nunca se edita.
//
//   node aplicar.js            aplica las que faltan
//   node aplicar.js --estado   solo dice que falta, sin aplicar nada
// =====================================================================

const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');

const CARPETA = path.join(__dirname, 'migrations');
const CONTROL = '_migraciones';

function leerMigraciones() {
  if (!fs.existsSync(CARPETA)) {
    throw new Error(`No existe la carpeta de migraciones: ${CARPETA}`);
  }
  return fs
    .readdirSync(CARPETA)
    .filter((n) => n.endsWith('.js'))
    .sort()
    .map((nombre) => {
      const migracion = require(path.join(CARPETA, nombre));
      if (typeof migracion.aplicar !== 'function') {
        throw new Error(`La migracion ${nombre} no exporta una funcion aplicar(db)`);
      }
      return { nombre, descripcion: migracion.descripcion || '', aplicar: migracion.aplicar };
    });
}

function cadenaConexion() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error(
      'Falta MONGODB_URI. Copia .env.example a .env y pon ahi la cadena de conexion.'
    );
  }
  return uri;
}

async function main() {
  const soloEstado = process.argv.includes('--estado');
  const uri = cadenaConexion();
  const nombreBase = process.env.MONGODB_BASE || 'cetia';

  const cliente = new MongoClient(uri);
  await cliente.connect();

  try {
    const db = cliente.db(nombreBase);
    const control = db.collection(CONTROL);

    const aplicadas = new Set(
      (await control.find({}, { projection: { _id: 1 } }).toArray()).map((d) => d._id)
    );

    const migraciones = leerMigraciones();
    const pendientes = migraciones.filter((m) => !aplicadas.has(m.nombre));

    console.log(`Base: ${nombreBase}`);
    console.log(`Migraciones encontradas: ${migraciones.length}`);
    console.log(`Ya aplicadas: ${aplicadas.size}`);
    console.log(`Pendientes: ${pendientes.length}`);

    if (pendientes.length === 0) {
      console.log('\nNo hay nada que aplicar.');
      return;
    }

    if (soloEstado) {
      console.log('\nFaltan por aplicar:');
      for (const m of pendientes) {
        console.log(`  ${m.nombre}  ${m.descripcion}`);
      }
      return;
    }

    for (const m of pendientes) {
      process.stdout.write(`\nAplicando ${m.nombre} ... `);
      const inicio = Date.now();
      await m.aplicar(db);
      await control.insertOne({
        _id: m.nombre,
        descripcion: m.descripcion,
        aplicada: new Date(),
        duracion_ms: Date.now() - inicio,
      });
      console.log(`listo (${Date.now() - inicio} ms)`);
      if (m.descripcion) console.log(`  ${m.descripcion}`);
    }

    console.log('\nTodas las migraciones pendientes quedaron aplicadas.');
  } finally {
    await cliente.close();
  }
}

main().catch((error) => {
  console.error(`\nError: ${error.message}`);
  process.exitCode = 1;
});
