const XLSX = require('xlsx');
const fs   = require('fs');
const pool = require('../config/db');

// =============================================================
//  HELPERS DE PARSEO
// =============================================================

/**
 * Extrae { codigo, descripcion } de una celda con formato
 * "36180 - Descripción..." o "2 - Descripción...".
 * No asume longitud mínima del código.
 */
function parsearCodigoDescripcion(celda) {
  if (!celda) return null;
  const texto = String(celda).trim();
  const idx   = texto.indexOf(' - ');
  if (idx === -1) return { codigo: texto, descripcion: texto };
  return {
    codigo:      texto.substring(0, idx).trim(),
    descripcion: texto.substring(idx + 3).trim(),
  };
}

/**
 * Extrae { tipo_documento, numero_documento, nombre_completo }
 * de una celda con formato "CC 1117523028 - NOMBRE APELLIDO".
 *
 * Retorna null cuando la celda está vacía, es null, o contiene
 * solo espacios y guiones (ej: "  -   "), que es como Sofia Plus
 * exporta los juicios sin funcionario asignado.
 */
function parsearFuncionario(celda) {
  if (!celda) return null;

  const texto = String(celda).trim();

  // Detectar el patrón vacío "  -   " → solo espacios y guiones
  if (/^[\s\-]+$/.test(texto)) return null;

  // Formato esperado: "CC 1117523028 - NOMBRE APELLIDO"
  const idx = texto.indexOf(' - ');
  if (idx === -1) return null;

  const parteIzq  = texto.substring(0, idx).trim();   // "CC 1117523028"
  const nombre    = texto.substring(idx + 3).trim();   // "NOMBRE APELLIDO"

  if (!nombre) return null;

  const espacioDoc = parteIzq.indexOf(' ');
  if (espacioDoc === -1) return null;

  const tipo_documento    = parteIzq.substring(0, espacioDoc).trim();
  const numero_documento  = parteIzq.substring(espacioDoc + 1).trim();

  if (!tipo_documento || !numero_documento) return null;

  return { tipo_documento, numero_documento, nombre_completo: nombre };
}

/**
 * Convierte un serial numérico de Excel a objeto Date JS.
 * Los archivos .xls de Sofia Plus almacenan fechas como número de días
 * desde 1900-01-01 (con el bug de 1900 leap year de Lotus 123).
 * Fórmula: (serial - 25569) * 86400 * 1000 → ms desde epoch Unix.
 */
function serialExcelADate(serial) {
  if (!serial || typeof serial !== 'number') return null;
  return new Date((serial - 25569) * 86400 * 1000);
}

/**
 * Convierte cualquier valor de celda de fecha a Date JS.
 * Acepta: serial numérico, objeto Date, o string parseable.
 */
function parsearFecha(valor) {
  if (!valor) return null;
  if (valor instanceof Date) return isNaN(valor.getTime()) ? null : valor;
  if (typeof valor === 'number') return serialExcelADate(valor);
  const d = new Date(valor);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Formatea una fecha para SQL: 'YYYY-MM-DD'
 */
function formatearFechaSQL(valor) {
  const d = parsearFecha(valor);
  if (!d) return null;
  // Usar UTC para evitar desplazamientos por zona horaria
  const y  = d.getUTCFullYear();
  const m  = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dy = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${dy}`;
}

/**
 * Formatea fecha+hora para SQL: 'YYYY-MM-DD HH:MM:SS'
 */
function formatearDatetimeSQL(valor) {
  const d = parsearFecha(valor);
  if (!d) return null;
  const y  = d.getUTCFullYear();
  const mo = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dy = String(d.getUTCDate()).padStart(2, '0');
  const h  = String(d.getUTCHours()).padStart(2, '0');
  const mi = String(d.getUTCMinutes()).padStart(2, '0');
  const s  = String(d.getUTCSeconds()).padStart(2, '0');
  return `${y}-${mo}-${dy} ${h}:${mi}:${s}`;
}

// =============================================================
//  UPSERTS INDIVIDUALES
// =============================================================

async function upsertFicha(conn, meta) {
  const { rows } = await conn.query(
    'SELECT id_ficha FROM ficha WHERE numero_ficha = $1',
    [meta.numero_ficha]
  );

  if (rows.length > 0) {
    await conn.query(
      `UPDATE ficha SET
         codigo_programa    = $1,
         version            = $2,
         denominacion       = $3,
         estado_ficha       = $4,
         fecha_inicio       = $5,
         fecha_fin          = $6,
         modalidad          = $7,
         regional           = $8,
         centro_formacion   = $9,
         ultima_importacion = NOW(),
         updated_at         = NOW()
       WHERE numero_ficha = $10`,
      [
        meta.codigo_programa, meta.version, meta.denominacion,
        meta.estado_ficha, meta.fecha_inicio, meta.fecha_fin,
        meta.modalidad, meta.regional, meta.centro_formacion,
        meta.numero_ficha,
      ]
    );
    return rows[0].id_ficha;
  }

  const { rows: insertRows } = await conn.query(
    `INSERT INTO ficha
       (numero_ficha, codigo_programa, version, denominacion,
        estado_ficha, fecha_inicio, fecha_fin,
        modalidad, regional, centro_formacion, ultima_importacion)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
     RETURNING id_ficha`,
    [
      meta.numero_ficha, meta.codigo_programa, meta.version, meta.denominacion,
      meta.estado_ficha, meta.fecha_inicio, meta.fecha_fin,
      meta.modalidad, meta.regional, meta.centro_formacion,
    ]
  );
  return insertRows[0].id_ficha;
}

async function upsertCompetencia(conn, codigo, descripcion) {
  const { rows } = await conn.query(
    'SELECT id_competencia FROM competencia WHERE codigo_competencia = $1',
    [codigo]
  );
  if (rows.length > 0) return rows[0].id_competencia;

  const { rows: insertRows } = await conn.query(
    'INSERT INTO competencia (codigo_competencia, descripcion) VALUES ($1, $2) RETURNING id_competencia',
    [codigo, descripcion]
  );
  return insertRows[0].id_competencia;
}

async function upsertResultado(conn, idCompetencia, codigo, descripcion) {
  const { rows } = await conn.query(
    'SELECT id_resultado FROM resultado_aprendizaje WHERE codigo_resultado = $1',
    [codigo]
  );
  if (rows.length > 0) return rows[0].id_resultado;

  const { rows: insertRows } = await conn.query(
    'INSERT INTO resultado_aprendizaje (id_competencia, codigo_resultado, descripcion) VALUES ($1, $2, $3) RETURNING id_resultado',
    [idCompetencia, codigo, descripcion]
  );
  return insertRows[0].id_resultado;
}

async function upsertFuncionario(conn, datos) {
  // datos puede ser null cuando el Excel trae "  -   "
  if (!datos) return null;

  const { rows } = await conn.query(
    'SELECT id_funcionario FROM funcionario WHERE tipo_documento = $1 AND numero_documento = $2',
    [datos.tipo_documento, datos.numero_documento]
  );
  if (rows.length > 0) return rows[0].id_funcionario;

  const { rows: insertRows } = await conn.query(
    'INSERT INTO funcionario (tipo_documento, numero_documento, nombre_completo) VALUES ($1, $2, $3) RETURNING id_funcionario',
    [datos.tipo_documento, datos.numero_documento, datos.nombre_completo]
  );
  return insertRows[0].id_funcionario;
}

async function upsertAprendiz(conn, idFicha, fila) {
  const { rows } = await conn.query(
    'SELECT id_aprendiz FROM aprendiz WHERE numero_documento = $1',
    [fila.numero_documento]
  );

  if (rows.length > 0) {
    await conn.query(
      'UPDATE aprendiz SET id_ficha = $1, nombres = $2, apellidos = $3, estado = $4, updated_at = NOW() WHERE numero_documento = $5',
      [idFicha, fila.nombres, fila.apellidos, fila.estado, fila.numero_documento]
    );
    return rows[0].id_aprendiz;
  }

  const { rows: insertRows } = await conn.query(
    `INSERT INTO aprendiz
       (id_ficha, tipo_documento, numero_documento, nombres, apellidos, estado)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id_aprendiz`,
    [idFicha, fila.tipo_documento, fila.numero_documento,
     fila.nombres, fila.apellidos, fila.estado]
  );
  return insertRows[0].id_aprendiz;
}

async function upsertJuicio(conn, idAprendiz, idResultado, idFuncionario, idFicha, juicio, fechaHora) {
  await conn.query(
    `INSERT INTO juicio_evaluativo
       (id_aprendiz, id_resultado, id_funcionario, id_ficha, juicio, fecha_hora_juicio)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (id_aprendiz, id_resultado, id_ficha)
     DO UPDATE SET
       juicio            = EXCLUDED.juicio,
       id_funcionario    = EXCLUDED.id_funcionario,
       fecha_hora_juicio = EXCLUDED.fecha_hora_juicio,
       updated_at        = NOW()`,
    [idAprendiz, idResultado, idFuncionario, idFicha, juicio, fechaHora]
  );
}

// =============================================================
//  FUNCIÓN PRINCIPAL
// =============================================================

/**
 * Importa un archivo .xls / .xlsx del SENA a PostgreSQL.
 * @param {string} rutaArchivo  Ruta absoluta al archivo temporal
 * @returns {{ fichaId, aprendices, competencias, resultados, juicios, errores[] }}
 */
async function importarExcel(rutaArchivo) {
  // ── Leer el workbook como buffer (resuelve .xls en Node.js) ─
  const buffer = fs.readFileSync(rutaArchivo);
  const wb     = XLSX.read(buffer, { type: 'buffer', cellDates: false });
  const ws     = wb.Sheets[wb.SheetNames[0]];
  const filas  = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });

  // ── Extraer metadatos de la ficha (filas 0-11) ─────────────
  const meta = {
    numero_ficha:     String(filas[2]?.[2] ?? '').trim(),
    codigo_programa:  String(filas[3]?.[2] ?? '').trim(),
    version:          Number(filas[4]?.[2] ?? 1),
    denominacion:     String(filas[5]?.[2] ?? '').trim(),
    estado_ficha:     String(filas[6]?.[2] ?? 'EN EJECUCION').trim(),
    fecha_inicio:     formatearFechaSQL(filas[7]?.[2]),
    fecha_fin:        formatearFechaSQL(filas[8]?.[2]),
    modalidad:        String(filas[9]?.[2] ?? 'PRESENCIAL').trim(),
    regional:         String(filas[10]?.[2] ?? '').trim(),
    centro_formacion: String(filas[11]?.[2] ?? '').trim(),
  };

  if (!meta.numero_ficha) {
    throw new Error('El archivo no contiene un número de ficha válido (fila 3, columna C).');
  }

  // ── Detectar layout de columnas desde la fila de encabezados ─
  // Sofia Plus a veces exporta una columna vacía extra entre
  // "Juicio de Evaluación" y "Fecha y Hora del Juicio".
  // Detectamos las posiciones reales por nombre de encabezado.
  const headers = (filas[12] || []).map(h => String(h ?? '').trim().toLowerCase());
  const COL = {
    tipo_doc:     headers.findIndex(h => h.includes('tipo de documento')),
    num_doc:      headers.findIndex(h => h.includes('número de documento')),
    nombres:      headers.findIndex(h => h === 'nombre'),
    apellidos:    headers.findIndex(h => h === 'apellidos'),
    estado:       headers.findIndex(h => h === 'estado'),
    competencia:  headers.findIndex(h => h.includes('competencia')),
    resultado:    headers.findIndex(h => h.includes('resultado de aprendizaje')),
    juicio:       headers.findIndex(h => h.includes('juicio de evaluación') || h.includes('juicio de evaluacion')),
    fecha:        headers.findIndex(h => h.includes('fecha y hora')),
    funcionario:  headers.findIndex(h => h.includes('funcionario')),
  };

  // Validar que encontramos las columnas mínimas
  const colsFaltantes = Object.entries(COL)
    .filter(([, v]) => v === -1)
    .map(([k]) => k);
  if (colsFaltantes.length > 0) {
    throw new Error(`No se encontraron las columnas: ${colsFaltantes.join(', ')}. Verifica que el archivo sea un Reporte de Juicios de Evaluación de Sofia Plus.`);
  }

  // ── Contadores ─────────────────────────────────────────────
  const contadores = {
    fichaId:      null,
    aprendices:   0,
    competencias: 0,
    resultados:   0,
    juicios:      0,
    errores:      [],
  };

  const aprendicesVistos   = new Set();
  const competenciasVistas = new Set();
  const resultadosVistos   = new Set();

  // ── Transacción ────────────────────────────────────────────
  const conn = await pool.connect();
  try {
    await conn.query('BEGIN');

    // 1. Upsert ficha
    contadores.fichaId = await upsertFicha(conn, meta);

    // 2. Procesar filas de datos (desde la fila 13, índice 13)
    const filaDatos = filas.slice(13);

    for (let i = 0; i < filaDatos.length; i++) {
      const fila = filaDatos[i];

      // Saltar filas completamente vacías
      if (!fila || fila.every(c => c === null || c === '')) continue;

      try {
        const tipo_documento   = fila[COL.tipo_doc];
        const numero_documento = fila[COL.num_doc];
        const nombres          = fila[COL.nombres];
        const apellidos        = fila[COL.apellidos];
        const estado           = fila[COL.estado];
        const celdaCompetencia = fila[COL.competencia];
        const celdaResultado   = fila[COL.resultado];
        const juicio           = fila[COL.juicio];
        const celdaFecha       = fila[COL.fecha];
        const celdaFuncionario = fila[COL.funcionario];

        // Validaciones mínimas
        if (!numero_documento || !juicio) {
          contadores.errores.push(`Fila ${i + 14}: faltan campos obligatorios (doc o juicio)`);
          continue;
        }

        // ── Competencia ──────────────────────────────────────
        const comp = parsearCodigoDescripcion(celdaCompetencia);
        if (!comp) {
          contadores.errores.push(`Fila ${i + 14}: competencia inválida → ${celdaCompetencia}`);
          continue;
        }
        const idCompetencia = await upsertCompetencia(conn, comp.codigo, comp.descripcion);
        if (!competenciasVistas.has(comp.codigo)) {
          competenciasVistas.add(comp.codigo);
          contadores.competencias++;
        }

        // ── Resultado de aprendizaje ─────────────────────────
        const ra = parsearCodigoDescripcion(celdaResultado);
        if (!ra) {
          contadores.errores.push(`Fila ${i + 14}: resultado de aprendizaje inválido → ${celdaResultado}`);
          continue;
        }
        const idResultado = await upsertResultado(conn, idCompetencia, ra.codigo, ra.descripcion);
        if (!resultadosVistos.has(ra.codigo)) {
          resultadosVistos.add(ra.codigo);
          contadores.resultados++;
        }

        // ── Funcionario (puede ser null) ─────────────────────
        const datosFuncionario = parsearFuncionario(celdaFuncionario);
        const idFuncionario    = await upsertFuncionario(conn, datosFuncionario);

        // ── Aprendiz ─────────────────────────────────────────
        const numDoc = String(numero_documento).trim();
        const idAprendiz = await upsertAprendiz(conn, contadores.fichaId, {
          tipo_documento:   String(tipo_documento ?? '').trim(),
          numero_documento: numDoc,
          nombres:          String(nombres   ?? '').trim(),
          apellidos:        String(apellidos ?? '').trim(),
          estado:           String(estado    ?? 'EN FORMACION').trim(),
        });
        if (!aprendicesVistos.has(numDoc)) {
          aprendicesVistos.add(numDoc);
          contadores.aprendices++;
        }

        // ── Juicio evaluativo ────────────────────────────────
        const fechaHora = formatearDatetimeSQL(celdaFecha);
        await upsertJuicio(
          conn, idAprendiz, idResultado, idFuncionario,
          contadores.fichaId, String(juicio).trim(), fechaHora
        );
        contadores.juicios++;

      } catch (errFila) {
        contadores.errores.push(`Fila ${i + 14}: ${errFila.message}`);
      }
    }

    await conn.query('COMMIT');
  } catch (err) {
    await conn.query('ROLLBACK');
    throw err;
  } finally {
    conn.release();
  }

  return contadores;
}

module.exports = { importarExcel };
