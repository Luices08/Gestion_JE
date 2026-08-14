const dashboardModel = require('../models/dashboardModel');

// =============================================================
//  DASHBOARD CONTROLLER
// =============================================================

/**
 * GET /
 * GET /dashboard
 * Resumen general con avance por aprendiz y aprobación por competencia.
 * Soporta ?ficha=id para filtrar por ficha específica.
 */
async function index(req, res) {
  try {
    const fichas      = await dashboardModel.getFichas();
    const fichaActiva = req.query.ficha ? parseInt(req.query.ficha, 10) : null;

    // Si no hay fichas cargadas aún, mostrar pantalla de bienvenida
    if (!fichas.length) {
      return res.render('dashboard/index', {
        title:                  'Dashboard',
        fichas:                 [],
        fichaActiva:            null,
        resumen:                null,
        avancePorAprendiz:      [],
        aprobacionPorCompetencia: [],
      });
    }

    // Si no se especificó ficha, usar la más reciente
    const idFicha = fichaActiva || fichas[0].id_ficha;

    const [resumen, avancePorAprendiz, aprobacionPorCompetencia] = await Promise.all([
      dashboardModel.getResumen(idFicha),
      dashboardModel.getAvancePorAprendiz(idFicha),
      dashboardModel.getAprobacionPorCompetencia(idFicha),
    ]);

    res.render('dashboard/index', {
      title:                   'Dashboard',
      fichas,
      fichaActiva:             idFicha,
      resumen,
      avancePorAprendiz,
      aprobacionPorCompetencia,
    });

  } catch (err) {
    console.error('Error en dashboard:', err);
    res.status(500).render('dashboard/index', {
      title:                   'Dashboard',
      fichas:                  [],
      fichaActiva:             null,
      resumen:                 null,
      avancePorAprendiz:       [],
      aprobacionPorCompetencia: [],
      error:                   'Error interno al cargar el dashboard.',
    });
  }
}

module.exports = { index };
