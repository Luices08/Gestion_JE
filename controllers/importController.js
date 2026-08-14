const fs              = require('fs');
const { importarExcel } = require('../models/importModel');
const { getFichas }     = require('../models/dashboardModel');

// =============================================================
//  IMPORT CONTROLLER
// =============================================================

/**
 * GET /importar
 * Muestra el formulario de carga con la lista de fichas ya importadas.
 */
async function showForm(req, res) {
  try {
    const fichas  = await getFichas();
    const mensaje = req.query.mensaje || null;
    const tipo    = req.query.tipo    || null;

    // Contadores desde query params (vienen como strings)
    const contadores = mensaje ? {
      aprendices:   parseInt(req.query.aprendices   || 0, 10),
      competencias: parseInt(req.query.competencias || 0, 10),
      resultados:   parseInt(req.query.resultados   || 0, 10),
      juicios:      parseInt(req.query.juicios      || 0, 10),
      errores:      req.query.errores ? JSON.parse(decodeURIComponent(req.query.errores)) : [],
    } : null;

    res.render('importar/index', {
      title:      'Importar Excel',
      fichas,
      mensaje,
      tipo,
      contadores,
    });
  } catch (err) {
    console.error('Error al cargar formulario de importación:', err);
    res.status(500).render('importar/index', {
      title:      'Importar Excel',
      fichas:     [],
      mensaje:    'Error interno al cargar la página.',
      tipo:       'error',
      contadores: null,
    });
  }
}

/**
 * POST /importar
 * Recibe el archivo, ejecuta la importación y redirige con resultado.
 */
async function upload(req, res) {
  // multer ya validó tipo y tamaño; si falla llega por next(err)
  const rutaArchivo = req.file?.path;

  if (!rutaArchivo) {
    const params = new URLSearchParams({
      tipo:    'error',
      mensaje: 'No se recibió ningún archivo. Asegúrate de seleccionar un archivo .xls o .xlsx antes de enviar.',
    });
    return res.redirect(`/importar?${params.toString()}`);
  }

  try {
    const resultado = await importarExcel(rutaArchivo);

    // Borrar archivo temporal
    eliminarArchivo(rutaArchivo);

    const erroresEncoded = encodeURIComponent(JSON.stringify(resultado.errores));

    const params = new URLSearchParams({
      tipo:         'exito',
      mensaje:      `Ficha ${resultado.fichaId} importada correctamente.`,
      aprendices:   resultado.aprendices,
      competencias: resultado.competencias,
      resultados:   resultado.resultados,
      juicios:      resultado.juicios,
      errores:      erroresEncoded,
    });

    res.redirect(`/importar?${params.toString()}`);

  } catch (err) {
    eliminarArchivo(rutaArchivo);
    console.error('Error durante la importación:', err);

    const params = new URLSearchParams({
      tipo:    'error',
      mensaje: err.message || 'Error inesperado durante la importación.',
    });

    res.redirect(`/importar?${params.toString()}`);
  }
}

/**
 * Manejo de errores de multer (tamaño, tipo de archivo).
 * Se registra como middleware de error en importRoutes.js.
 */
function handleMulterError(err, req, res, next) {
  eliminarArchivo(req.file?.path);

  let mensaje = 'Error al procesar el archivo.';

  if (err.code === 'LIMIT_FILE_SIZE') {
    mensaje = 'El archivo supera el tamaño máximo permitido (10 MB).';
  } else if (err.code === 'TIPO_INVALIDO') {
    mensaje = 'Tipo de archivo no permitido. Solo se aceptan archivos .xls y .xlsx.';
  }

  const params = new URLSearchParams({ tipo: 'error', mensaje });
  res.redirect(`/importar?${params.toString()}`);
}

// ── Utilidad ──────────────────────────────────────────────────
function eliminarArchivo(ruta) {
  if (!ruta) return;
  try {
    fs.unlinkSync(ruta);
  } catch {
    // Si ya fue eliminado o no existe, ignorar
  }
}

module.exports = { showForm, upload, handleMulterError };
