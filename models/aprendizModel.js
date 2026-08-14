const pool = require('../config/db');

// =============================================================
//  APRENDIZ MODEL
// =============================================================

/**
 * Lista de aprendices con su avance %.
 * Filtros opcionales: id_ficha, estado, buscar (nombre o doc),
 * id_competencia.
 */
async function getAll(filtros = {}) {
  const { id_ficha, estado, buscar, id_competencia } = filtros;

  const params = [];
  const where  = [];
  let paramIdx = 1;

  // Filtro por competencia: solo aprendices que tengan al menos
  // un juicio en algún RA de esa competencia
  let joinCompetencia = '';
  if (id_competencia) {
    joinCompetencia = `
      JOIN juicio_evaluativo jc ON jc.id_aprendiz = a.id_aprendiz
      JOIN resultado_aprendizaje rac ON rac.id_resultado = jc.id_resultado
        AND rac.id_competencia = $${paramIdx++}
    `;
    params.push(id_competencia);
  }

  if (id_ficha) {
    where.push(`a.id_ficha = $${paramIdx++}`);
    params.push(id_ficha);
  }

  if (estado) {
    where.push(`a.estado = $${paramIdx++}`);
    params.push(estado);
  }

  if (buscar) {
    const p1 = paramIdx++;
    const p2 = paramIdx++;
    const p3 = paramIdx++;
    where.push(`(
      a.nombres          ILIKE $${p1} OR
      a.apellidos        ILIKE $${p2} OR
      a.numero_documento ILIKE $${p3}
    )`);
    const like = `%${buscar}%`;
    params.push(like, like, like);
  }

  const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const sql = `
    SELECT
      a.id_aprendiz,
      a.id_ficha,
      a.tipo_documento,
      a.numero_documento,
      CONCAT(a.nombres, ' ', a.apellidos)                          AS nombre_completo,
      a.nombres,
      a.apellidos,
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
    ${joinCompetencia}
    LEFT JOIN juicio_evaluativo j ON j.id_aprendiz = a.id_aprendiz
    ${whereClause}
    GROUP BY
      a.id_aprendiz, a.id_ficha, a.tipo_documento,
      a.numero_documento, a.nombres, a.apellidos, a.estado
    ORDER BY a.apellidos ASC, a.nombres ASC
  `;

  const { rows } = await pool.query(sql, params);
  return rows;
}

/**
 * Detalle completo de un aprendiz con todos sus juicios
 * agrupados por competencia.
 */
async function getById(id_aprendiz) {
  // Datos del aprendiz
  const { rows: aprendices } = await pool.query(
    `SELECT
       a.id_aprendiz,
       a.id_ficha,
       a.tipo_documento,
       a.numero_documento,
       a.nombres,
       a.apellidos,
       CONCAT(a.nombres, ' ', a.apellidos) AS nombre_completo,
       a.estado,
       f.numero_ficha,
       f.denominacion
     FROM aprendiz a
     JOIN ficha f ON f.id_ficha = a.id_ficha
     WHERE a.id_aprendiz = $1`,
    [id_aprendiz]
  );

  if (!aprendices.length) return null;

  const aprendiz = aprendices[0];

  // Juicios agrupados por competencia
  const { rows: juicios } = await pool.query(
    `SELECT
       c.id_competencia,
       c.codigo_competencia,
       c.descripcion                                       AS competencia,
       ra.id_resultado,
       ra.codigo_resultado,
       ra.descripcion                                      AS resultado,
       j.juicio,
       j.fecha_hora_juicio,
       f2.nombre_completo                                  AS funcionario
     FROM juicio_evaluativo j
     JOIN resultado_aprendizaje ra ON ra.id_resultado  = j.id_resultado
     JOIN competencia           c  ON c.id_competencia = ra.id_competencia
     LEFT JOIN funcionario      f2 ON f2.id_funcionario = j.id_funcionario
     WHERE j.id_aprendiz = $1
     ORDER BY c.codigo_competencia ASC, ra.codigo_resultado ASC`,
    [id_aprendiz]
  );

  // Agrupar juicios por competencia
  const mapaCompetencias = new Map();
  for (const fila of juicios) {
    if (!mapaCompetencias.has(fila.id_competencia)) {
      mapaCompetencias.set(fila.id_competencia, {
        id_competencia:     fila.id_competencia,
        codigo_competencia: fila.codigo_competencia,
        competencia:        fila.competencia,
        resultados:         [],
        aprobados:          0,
        total:              0,
      });
    }
    const comp = mapaCompetencias.get(fila.id_competencia);
    comp.resultados.push({
      id_resultado:    fila.id_resultado,
      codigo_resultado:fila.codigo_resultado,
      resultado:       fila.resultado,
      juicio:          fila.juicio,
      fecha_hora:      fila.fecha_hora_juicio,
      funcionario:     fila.funcionario || null,
    });
    comp.total++;
    if (fila.juicio === 'APROBADO') comp.aprobados++;
  }

  // Calcular avance general
  const totalJuicios = juicios.length;
  const totalAprobados = juicios.filter(j => j.juicio === 'APROBADO').length;
  const pctAvance = totalJuicios
    ? Math.round((totalAprobados / totalJuicios) * 1000) / 10
    : 0;

  return {
    ...aprendiz,
    total_juicios:        totalJuicios,
    total_aprobados:      totalAprobados,
    pct_avance:           pctAvance,
    juiciosPorCompetencia: [...mapaCompetencias.values()],
  };
}

/**
 * Lista plana de todos los juicios de un aprendiz,
 * ordenados por competencia y resultado.
 */
async function getJuiciosByAprendiz(id_aprendiz) {
  const { rows } = await pool.query(
    `SELECT
       c.codigo_competencia,
       c.descripcion                   AS competencia,
       ra.codigo_resultado,
       ra.descripcion                  AS resultado,
       j.juicio,
       j.fecha_hora_juicio,
       f.nombre_completo               AS funcionario
     FROM juicio_evaluativo j
     JOIN resultado_aprendizaje ra ON ra.id_resultado   = j.id_resultado
     JOIN competencia           c  ON c.id_competencia  = ra.id_competencia
     LEFT JOIN funcionario      f  ON f.id_funcionario  = j.id_funcionario
     WHERE j.id_aprendiz = $1
     ORDER BY c.codigo_competencia ASC, ra.codigo_resultado ASC`,
    [id_aprendiz]
  );
  return rows;
}

module.exports = { getAll, getById, getJuiciosByAprendiz };
