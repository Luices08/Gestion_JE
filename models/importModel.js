const XLSX = require('xlsx');
const fs   = require('fs');
const pool = require('../config/db');

// =============================================================
//  HELPERS DE NORMALIZACIÓN Y PARSEO
// =============================================================

/**
 * Normaliza un texto para comparaciones flexibles:
 * quita acentos/tildes, convierte a minúsculas, colapsa espacios y saltos de línea.
 */
function normalizarTexto(txt) {
  return String(txt ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Extrae { codigo, descripcion } de una celda con formato
 * "36180 - Descripción..." o "2 - Descripción...".
 * Asegura que el código no exceda los 20 caracteres del esquema de BD.
 */
function parsearCodigoDescripcion(celda) {
  if (!celda) return null;
  const texto = String(celda).trim();
  if (!texto) return null;

  const idx = texto.indexOf(' - ');
  if (idx !== -1) {
    return {
      codigo:      texto.substring(0, idx).trim().substring(0, 20),
      descripcion: texto.substring(idx + 3).trim(),
    };
  }

  // Si tiene formato "123456 - ..." o "123456: ..."
  const match = texto.match(/^([A-Za-z0-9_-]+)\s*[-:]\s*(.*)$/);
  if (match) {
    return {
      codigo:      match[1].trim().substring(0, 20),
      descripcion: match[2].trim() || texto,
    };
  }

  return {
    codigo:      texto.substring(0, 20),
    descripcion: texto,
  };
}

/**
 * Extrae { tipo_documento, numero_documento, nombre_completo }
 * de una celda con formato "CC 1117523028 - NOMBRE APELLIDO" o similar.
 *
 * Retorna null cuando la celda está vacía, es null, o contiene
 * solo espacios y guiones (ej: "  -   "), que es como Sofia Plus
 * exporta los juicios sin funcionario asignado.
 */
function parsearFuncionario(celda) {
  if (!celda) return null;

  const texto = String(celda).trim();

  // Detectar patrón vacío "  -   " → solo espacios y guiones
  if (!texto || /^[\s\-]+$/.test(texto)) return null;

  // Formato esperado: "CC 1117523028 - NOMBRE APELLIDO"
  const idx = texto.indexOf(' - ');
  if (idx === -1) return null;

  const parteIzq = texto.substring(0, idx).trim();
  const nombre   = texto.substring(idx + 3).trim();

  if (!nombre) return null;

  const partesDoc = parteIzq.split(/\s+/);
  let tipo_documento   = 'CC';
  let numero_documento = parteIzq;

  if (partesDoc.length >= 2) {
    tipo_documento   = partesDoc[0].substring(0, 5).toUpperCase();
    numero_documento = partesDoc.slice(1).join('').trim();
  }

  if (!numero_documento) return null;

  return {
    tipo_documento,
    numero_documento: numero_documento.substring(0, 20),
    nombre_completo:  nombre.substring(0, 160),
  };
}

/**
 * Convierte un serial numérico de Excel a objeto Date JS.
 * Los archivos .xls de Sofia Plus almacenan fechas como número de días
 * desde 1900-01-01 (con el bug de 1900 leap year de Lotus 123).
 * Fórmula: (serial - 25569) * 86400 * 1000 → ms desde epoch Unix UTC.
 */
function serialExcelADate(serial) {
  if (!serial || typeof serial !== 'number') return null;
  return new Date((serial - 25569) * 86400 * 1000);
}

/**
 * Convierte cualquier valor de celda de fecha a Date JS.
 * Acepta: serial numérico, objeto Date, o string parseable (incluyendo DD/MM/YYYY [HH:MM[:SS]]).
 */
function parsearFecha(valor) {
  if (!valor) return null;
  if (valor instanceof Date) return isNaN(valor.getTime()) ? null : valor;
  if (typeof valor === 'number') return serialExcelADate(valor);

  const str = String(valor).trim();
  // Formato colombiano habitual en Sofia Plus: DD/MM/YYYY o DD-MM-YYYY con opcional HH:MM:SS
  const match = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})(?:\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/);
  if (match) {
    const dia = parseInt(match[1], 10);
    const mes = parseInt(match[2], 10) - 1;
    let anio  = parseInt(match[3], 10);
    if (anio < 100) anio += 2000;
    const hora = match[4] ? parseInt(match[4], 10) : 0;
    const min  = match[5] ? parseInt(match[5], 10) : 0;
    const seg  = match[6] ? parseInt(match[6], 10) : 0;
    const d    = new Date(Date.UTC(anio, mes, dia, hora, min, seg));
    return isNaN(d.getTime()) ? null : d;
  }

  const d = new Date(valor);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Formatea una fecha para SQL: 'YYYY-MM-DD'
 */
function formatearFechaSQL(valor) {
  const d = parsearFecha(valor);
  if (!d) return null;
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

/**
 * Normaliza el juicio evaluativo para que cumpla el CHECK de la base de datos:
 * 'APROBADO', 'NO APROBADO', 'POR EVALUAR'
 */
function normalizarJuicio(valor) {
  if (!valor) return 'POR EVALUAR';
  const v = normalizarTexto(valor).toUpperCase();
  if (v.includes('NO APROB') || v.includes('DEFICIENTE') || v === 'D' || v === 'NA') {
    return 'NO APROBADO';
  }
  if (v.includes('APROB') || v === 'A') {
    return 'APROBADO';
  }
  return 'POR EVALUAR';
}

/**
 * Normaliza el estado del aprendiz para cumplir con el CHECK de Postgres:
 * 'EN FORMACION', 'RETIRO VOLUNTARIO', 'TRASLADADO', 'DESERTADO'
 */
function normalizarEstadoAprendiz(estadoRaw) {
  if (!estadoRaw) return 'EN FORMACION';
  const norm = normalizarTexto(estadoRaw).toUpperCase();
  if (norm.includes('RETIRO')) return 'RETIRO VOLUNTARIO';
  if (norm.includes('TRASLAD')) return 'TRASLADADO';
  if (norm.includes('DESERT')) return 'DESERTADO';
  return 'EN FORMACION';
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
  // datos puede ser null cuando el Excel trae "  -   " o no tiene funcionario
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
 * Importa un archivo .xls / .xlsx del SENA a PostgreSQL de forma tolerante y flexible.
 * @param {string} rutaArchivo  Ruta absoluta al archivo temporal
 * @returns {{ fichaId, aprendices, competencias, resultados, juicios, errores[] }}
 */
async function importarExcel(rutaArchivo) {
  // ── Leer el workbook como buffer (resuelve .xls en Node.js) ─
  const buffer = fs.readFileSync(rutaArchivo);
  const wb     = XLSX.read(buffer, { type: 'buffer', cellDates: false });
  const ws     = wb.Sheets[wb.SheetNames[0]];
  const filas  = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });

  // ── 1. Detectar dinámicamente la fila de encabezados ────────
  // Normalmente fila 13 (índice 12), pero puede variar según la exportación.
  let headerRowIndex = 12;
  for (let r = 0; r < Math.min(filas.length, 30); r++) {
    const filaNorm = (filas[r] || []).map(normalizarTexto);
    const matches = filaNorm.filter(c =>
      c.includes('documento') ||
      c.includes('competencia') ||
      c.includes('resultado') ||
      c.includes('juicio')
    ).length;

    if (matches >= 2) {
      headerRowIndex = r;
      break;
    }
  }

  // ── 2. Extraer metadatos de la ficha (filas anteriores al encabezado) ─
  function buscarMetadato(patrones, valorPorDefecto = '') {
    for (let r = 0; r < headerRowIndex; r++) {
      const fila = filas[r] || [];
      for (let c = 0; c < fila.length; c++) {
        const celda = normalizarTexto(fila[c]);
        if (patrones.some(p => celda.includes(p))) {
          // El valor suele estar en la siguiente celda con contenido de esa fila
          for (let v = c + 1; v < fila.length; v++) {
            if (fila[v] !== null && fila[v] !== undefined && String(fila[v]).trim() !== '') {
              return fila[v];
            }
          }
        }
      }
    }
    return valorPorDefecto;
  }

  const meta = {
    numero_ficha:     String(buscarMetadato(['ficha', 'caracterizacion'], filas[2]?.[2] ?? '')).trim(),
    codigo_programa:  String(buscarMetadato(['codigo', 'programa'], filas[3]?.[2] ?? '')).trim(),
    version:          Number(buscarMetadato(['version'], filas[4]?.[2] ?? 1)) || 1,
    denominacion:     String(buscarMetadato(['denominacion', 'nombre del programa'], filas[5]?.[2] ?? '')).trim(),
    estado_ficha:     String(buscarMetadato(['estado de la ficha', 'estado ficha'], filas[6]?.[2] ?? 'EN EJECUCION')).trim(),
    fecha_inicio:     formatearFechaSQL(buscarMetadato(['fecha inicio', 'inicio'], filas[7]?.[2])),
    fecha_fin:        formatearFechaSQL(buscarMetadato(['fecha fin', 'fin'], filas[8]?.[2])),
    modalidad:        String(buscarMetadato(['modalidad'], filas[9]?.[2] ?? 'PRESENCIAL')).trim() || 'PRESENCIAL',
    regional:         String(buscarMetadato(['regional'], filas[10]?.[2] ?? '')).trim(),
    centro_formacion: String(buscarMetadato(['centro de formacion', 'centro formacion', 'centro'], filas[11]?.[2] ?? '')).trim(),
  };

  if (!meta.numero_ficha) {
    throw new Error('El archivo no contiene un número de ficha válido en la cabecera del reporte.');
  }

  // ── 3. Detectar layout de columnas desde la fila de encabezados ─
  const rawHeaders = filas[headerRowIndex] || [];
  const headers = rawHeaders.map(normalizarTexto);

  const COL = {
    tipo_doc:    headers.findIndex(h => (h.includes('tipo') && (h.includes('doc') || h.includes('identifica'))) || h === 'td'),
    num_doc:     headers.findIndex(h =>
      ((h.includes('numero') || h.includes('num') || h.includes('nro')) && (h.includes('doc') || h.includes('identifica'))) ||
      (h.includes('documento') && !h.includes('tipo')) ||
      h.includes('identificacion') ||
      h.includes('cedula')
    ),
    nombres:     headers.findIndex(h => (h.includes('nombre') && !h.includes('funcionario') && !h.includes('completo') && !h.includes('programa')) || h === 'nombre' || h === 'nombres'),
    apellidos:   headers.findIndex(h => h.includes('apellido')),
    estado:      headers.findIndex(h => (h.includes('estado') && !h.includes('ficha') && !h.includes('juicio')) || h === 'estado'),
    competencia: headers.findIndex(h => h.includes('competencia')),
    resultado:   headers.findIndex(h => h.includes('resultado') || h.includes('aprendizaje') || h.includes('rap')),
    juicio:      headers.findIndex(h => h.includes('juicio') || (h.includes('evaluacion') && !h.includes('fecha') && !h.includes('funcionario') && !h.includes('centro'))),
    fecha:       headers.findIndex(h => h.includes('fecha') || h.includes('hora')),
    funcionario: headers.findIndex(h => h.includes('funcionario') || h.includes('instructor') || h.includes('evaluador') || h.includes('docente') || h.includes('responsable')),
  };

  // Validar ÚNICAMENTE las columnas mínimas indispensables para registrar los juicios
  const colsObligatorias = [
    { key: 'num_doc',     label: 'Número de documento' },
    { key: 'competencia', label: 'Competencia' },
    { key: 'resultado',   label: 'Resultado de aprendizaje' },
    { key: 'juicio',      label: 'Juicio de evaluación' },
  ];

  const colsFaltantes = colsObligatorias
    .filter(c => COL[c.key] === -1)
    .map(c => c.label);

  if (colsFaltantes.length > 0) {
    throw new Error(`No se encontraron las columnas requeridas: ${colsFaltantes.join(', ')}. Verifica que el archivo sea un Reporte de Juicios de Evaluación de Sofia Plus.`);
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

    // 2. Procesar filas de datos (a partir de la fila siguiente al encabezado)
    const filaDatos = filas.slice(headerRowIndex + 1);

    for (let i = 0; i < filaDatos.length; i++) {
      const fila = filaDatos[i];

      // Saltar filas completamente vacías
      if (!fila || fila.every(c => c === null || c === '' || c === undefined)) continue;

      try {
        const tipo_documento   = COL.tipo_doc !== -1 && fila[COL.tipo_doc] ? fila[COL.tipo_doc] : 'CC';
        const numero_documento = COL.num_doc !== -1 ? fila[COL.num_doc] : null;
        const nombres          = COL.nombres !== -1 ? fila[COL.nombres] : '';
        const apellidos        = COL.apellidos !== -1 ? fila[COL.apellidos] : '';
        const estadoRaw        = COL.estado !== -1 ? fila[COL.estado] : 'EN FORMACION';
        const celdaCompetencia = COL.competencia !== -1 ? fila[COL.competencia] : null;
        const celdaResultado   = COL.resultado !== -1 ? fila[COL.resultado] : null;
        const juicioRaw        = COL.juicio !== -1 ? fila[COL.juicio] : null;
        const celdaFecha       = COL.fecha !== -1 ? fila[COL.fecha] : null;
        const celdaFuncionario = COL.funcionario !== -1 ? fila[COL.funcionario] : null;

        const numDoc = numero_documento != null ? String(numero_documento).trim() : '';

        // Si no tiene número de documento, omitir la fila
        if (!numDoc) {
          continue;
        }

        // ── Competencia ──────────────────────────────────────
        const comp = parsearCodigoDescripcion(celdaCompetencia);
        if (!comp) {
          contadores.errores.push(`Fila ${i + headerRowIndex + 2}: competencia inválida → ${celdaCompetencia}`);
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
          contadores.errores.push(`Fila ${i + headerRowIndex + 2}: resultado de aprendizaje inválido → ${celdaResultado}`);
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
        const idAprendiz = await upsertAprendiz(conn, contadores.fichaId, {
          tipo_documento:   String(tipo_documento ?? 'CC').trim().substring(0, 5),
          numero_documento: numDoc,
          nombres:          String(nombres   ?? '').trim(),
          apellidos:        String(apellidos ?? '').trim(),
          estado:           normalizarEstadoAprendiz(estadoRaw),
        });
        if (!aprendicesVistos.has(numDoc)) {
          aprendicesVistos.add(numDoc);
          contadores.aprendices++;
        }

        // ── Juicio evaluativo ────────────────────────────────
        const juicioVal = normalizarJuicio(juicioRaw);
        const fechaHora = celdaFecha ? formatearDatetimeSQL(celdaFecha) : null;
        await upsertJuicio(
          conn, idAprendiz, idResultado, idFuncionario,
          contadores.fichaId, juicioVal, fechaHora
        );
        contadores.juicios++;

      } catch (errFila) {
        contadores.errores.push(`Fila ${i + headerRowIndex + 2}: ${errFila.message}`);
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
