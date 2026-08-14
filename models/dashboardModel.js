const pool = require('../config/db');

// =============================================================
//  DASHBOARD MODEL
// =============================================================

/**
 * Resumen general de una ficha.
 * Retorna un único objeto con contadores y % de avance global.
 */
async function getResumen(id_ficha) {
  const { rows } = await pool.query(
    `SELECT
       f.id_ficha,
       f.numero_ficha,
       f.denominacion,
       f.estado_ficha,
       f.fecha_inicio,
       f.fecha_fin,
       f.ultima_importacion,
       COUNT(DISTINCT a.id_aprendiz)                                        AS total_aprendices,
       COUNT(DISTINCT a.id_aprendiz) FILTER (WHERE a.estado = 'EN FORMACION')       AS en_formacion,
       COUNT(DISTINCT a.id_aprendiz) FILTER (WHERE a.estado = 'RETIRO VOLUNTARIO')  AS retirados,
       COUNT(DISTINCT a.id_aprendiz) FILTER (WHERE a.estado = 'TRASLADADO')         AS trasladados,
       COUNT(DISTINCT a.id_aprendiz) FILTER (WHERE a.estado = 'DESERTADO')          AS desertados,
       COUNT(j.id_juicio)                                                   AS total_juicios,
       COUNT(j.id_juicio) FILTER (WHERE j.juicio = 'APROBADO')              AS aprobados,
       COUNT(j.id_juicio) FILTER (WHERE j.juicio = 'NO APROBADO')           AS no_aprobados,
       COUNT(j.id_juicio) FILTER (WHERE j.juicio = 'POR EVALUAR')           AS por_evaluar,
       ROUND(
         100.0 * COUNT(j.id_juicio) FILTER (WHERE j.juicio = 'APROBADO')
         / NULLIF(COUNT(j.id_juicio), 0), 1
       )                                                                    AS pct_avance_global
     FROM ficha f
     LEFT JOIN aprendiz          a ON a.id_ficha    = f.id_ficha
     LEFT JOIN juicio_evaluativo j ON j.id_aprendiz = a.id_aprendiz
     WHERE f.id_ficha = $1
     GROUP BY
       f.id_ficha, f.numero_ficha, f.denominacion,
       f.estado_ficha, f.fecha_inicio, f.fecha_fin, f.ultima_importacion`,
    [id_ficha]
  );
  return rows[0] || null;
}

/**
 * Lista de aprendices ordenados por % de avance descendente.
 * Incluye contadores de juicios por estado para barras de progreso.
 */
async function getAvancePorAprendiz(id_ficha) {
  const { rows } = await pool.query(
    `SELECT
       a.id_aprendiz,
       CONCAT(a.nombres, ' ', a.apellidos)                          AS nombre_completo,
       a.tipo_documento,
       a.numero_documento,
       a.estado,
       COUNT(j.id_juicio)                                           AS total_juicios,
       COUNT(j.id_juicio) FILTER (WHERE j.juicio = 'APROBADO')       AS aprobados,
       COUNT(j.id_juicio) FILTER (WHERE j.juicio = 'NO APROBADO')    AS no_aprobados,
       COUNT(j.id_juicio) FILTER (WHERE j.juicio = 'POR EVALUAR')    AS por_evaluar,
       ROUND(
         100.0 * COUNT(j.id_juicio) FILTER (WHERE j.juicio = 'APROBADO')
         / NULLIF(COUNT(j.id_juicio), 0), 1
       )                                                            AS pct_avance
     FROM aprendiz a
     LEFT JOIN juicio_evaluativo j ON j.id_aprendiz = a.id_aprendiz
     WHERE a.id_ficha = $1
     GROUP BY
       a.id_aprendiz, a.nombres, a.apellidos,
       a.tipo_documento, a.numero_documento, a.estado
     ORDER BY pct_avance DESC, nombre_completo ASC`,
    [id_ficha]
  );
  return rows;
}

/**
 * Aprobación por competencia dentro de una ficha.
 * Incluye total de RA, aprobados, no aprobados, por evaluar y %.
 */
async function getAprobacionPorCompetencia(id_ficha) {
  const { rows } = await pool.query(
    `SELECT
       c.id_competencia,
       c.codigo_competencia,
       c.descripcion                                                AS competencia,
       COUNT(DISTINCT ra.id_resultado)                              AS total_ra,
       COUNT(j.id_juicio)                                           AS total_juicios,
       COUNT(j.id_juicio) FILTER (WHERE j.juicio = 'APROBADO')       AS aprobados,
       COUNT(j.id_juicio) FILTER (WHERE j.juicio = 'NO APROBADO')    AS no_aprobados,
       COUNT(j.id_juicio) FILTER (WHERE j.juicio = 'POR EVALUAR')    AS por_evaluar,
       ROUND(
         100.0 * COUNT(j.id_juicio) FILTER (WHERE j.juicio = 'APROBADO')
         / NULLIF(COUNT(j.id_juicio), 0), 1
       )                                                            AS pct_aprobacion
     FROM juicio_evaluativo j
     JOIN resultado_aprendizaje ra ON ra.id_resultado  = j.id_resultado
     JOIN competencia           c  ON c.id_competencia = ra.id_competencia
     WHERE j.id_ficha = $1
     GROUP BY c.id_competencia, c.codigo_competencia, c.descripcion
     ORDER BY pct_aprobacion DESC`,
    [id_ficha]
  );
  return rows;
}

/**
 * Lista de todas las fichas cargadas en el sistema,
 * con conteo de aprendices y fecha de última importación.
 */
async function getFichas() {
  const { rows } = await pool.query(
    `SELECT
       f.id_ficha,
       f.numero_ficha,
       f.codigo_programa,
       f.denominacion,
       f.estado_ficha,
       f.fecha_inicio,
       f.fecha_fin,
       f.modalidad,
       f.regional,
       f.ultima_importacion,
       COUNT(DISTINCT a.id_aprendiz)                                AS total_aprendices
     FROM ficha f
     LEFT JOIN aprendiz a ON a.id_ficha = f.id_ficha
     GROUP BY
       f.id_ficha, f.numero_ficha, f.codigo_programa,
       f.denominacion, f.estado_ficha, f.fecha_inicio,
       f.fecha_fin, f.modalidad, f.regional, f.ultima_importacion
     ORDER BY f.ultima_importacion DESC NULLS LAST`
  );
  return rows;
}

module.exports = { getResumen, getAvancePorAprendiz, getAprobacionPorCompetencia, getFichas };
