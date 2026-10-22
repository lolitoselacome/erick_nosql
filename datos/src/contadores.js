// =====================================================================
// CETIA - Matricula, numeros de empleado y clave de grupo
//
// Hereda cuatro disparadores del proyecto relacional:
//   alumnos_generar_matricula    docentes_generar_numero
//   usuarios_numero_coordinador  grupos_generar_clave
//
// En PostgreSQL el consecutivo salia de contar lo que ya habia dentro
// de la misma transaccion. MongoDB no tiene secuencias, asi que el
// consecutivo vive en la coleccion contadores y se saca con
// findOneAndUpdate y $inc, que es atomico: dos altas a la vez nunca se
// llevan el mismo numero.
//
// Formatos, iguales a los del proyecto relacional:
//   Alumno       10 digitos  carrera + anio + cuatrimestre + consecutivo
//                            1426010001 = primer alumno de TI, ene-abr 2026
//   Docente       8 digitos  90 + anio + consecutivo        90260001
//   Coordinador   8 digitos  91 + anio + consecutivo        91260001
//   Grupo                    carrera + cuatrimestre + letra  TI-1A
// =====================================================================

/**
 * Saca el siguiente numero de un contador, de forma atomica.
 * Si el contador no existe, nace en 1.
 */
async function siguiente(bd, clave, sesion = undefined) {
  const r = await bd.collection("contadores").findOneAndUpdate(
    { _id: clave },
    { $inc: { valor: 1 } },
    { upsert: true, returnDocument: "after", session: sesion }
  );
  return r.valor;
}

/**
 * Matricula del alumno: carrera + anio + cuatrimestre + consecutivo.
 * El consecutivo es por carrera, anio y cuatrimestre de ingreso, igual
 * que en el proyecto relacional.
 */
export async function generarMatricula(bd, { claveMatricula, anio, numeroCuatri }, sesion) {
  if (!/^[1-8][0-9]$/.test(claveMatricula)) {
    throw new Error(`Clave de matricula invalida: ${claveMatricula}`);
  }

  const aa = String(anio % 100).padStart(2, "0");
  const cc = String(numeroCuatri).padStart(2, "0");
  const clave = `matricula:${claveMatricula}:${aa}:${cc}`;

  const n = await siguiente(bd, clave, sesion);
  if (n > 9999) {
    throw new Error(
      `Se acabaron las matriculas del cuatrimestre ${aa}-${cc} para la carrera ${claveMatricula}`
    );
  }

  return `${claveMatricula}${aa}${cc}${String(n).padStart(4, "0")}`;
}

/** Numero de docente: 90 + anio + consecutivo. */
export async function generarNumeroDocente(bd, anio, sesion) {
  const aa = String(anio % 100).padStart(2, "0");
  const n = await siguiente(bd, `docente:${aa}`, sesion);
  if (n > 9999) throw new Error(`Se acabaron los numeros de docente del ${aa}`);
  return `90${aa}${String(n).padStart(4, "0")}`;
}

/** Numero de coordinador: 91 + anio + consecutivo. */
export async function generarNumeroCoordinador(bd, anio, sesion) {
  const aa = String(anio % 100).padStart(2, "0");
  const n = await siguiente(bd, `coordinador:${aa}`, sesion);
  if (n > 9999) throw new Error(`Se acabaron los numeros de coordinador del ${aa}`);
  return `91${aa}${String(n).padStart(4, "0")}`;
}

/**
 * Clave del grupo: clave de carrera + cuatrimestre + letra.
 * La letra avanza por carrera, turno y cuatrimestre dentro del
 * cuatrimestre escolar: TI-1A, TI-1B, ...
 */
export async function generarClaveGrupo(bd, { claveCarrera, cuatrimestre, idPeriodo }, sesion) {
  const clave = `grupo:${idPeriodo}:${claveCarrera}:${cuatrimestre}`;
  const n = await siguiente(bd, clave, sesion);

  if (n > 26) {
    throw new Error(
      `Ya hay 26 grupos de ${claveCarrera} en el cuatrimestre ${cuatrimestre}; ` +
        `no quedan letras`
    );
  }

  const letra = String.fromCharCode(64 + n); // 1 -> A
  return `${claveCarrera}-${cuatrimestre}${letra}`;
}
