const aprendizModel  = require('../models/aprendizModel');
const dashboardModel = require('../models/dashboardModel');

// =============================================================
//  APRENDIZ CONTROLLER
// =============================================================

/**
 * GET /aprendices
 * Lista de aprendices con filtros opcionales desde query params.
 */
async function index(req, res) {
  try {
    const fichas = await dashboardModel.getFichas();

    const filtros = {
      id_ficha:      req.query.ficha       ? parseInt(req.query.ficha, 10)       : null,
      estado:        req.query.estado      || null,
      buscar:        req.query.buscar      || null,
      id_competencia:req.query.competencia ? parseInt(req.query.competencia, 10) : null,
    };

    // Si no se especificó ficha, usar la más reciente disponible
    if (!filtros.id_ficha && fichas.length) {
      filtros.id_ficha = fichas[0].id_ficha;
    }

    const aprendices = await aprendizModel.getAll(filtros);

    // Lista de competencias de la ficha activa para el selector de filtros
    let competencias = [];
    if (filtros.id_ficha) {
      competencias = await dashboardModel.getAprobacionPorCompetencia(filtros.id_ficha);
    }

    res.render('aprendices/index', {
      title:       'Aprendices',
      fichas,
      fichaActiva: filtros.id_ficha,
      aprendices,
      competencias,
      filtros: {
        estado:      req.query.estado      || '',
        buscar:      req.query.buscar      || '',
        competencia: req.query.competencia || '',
      },
    });

  } catch (err) {
    console.error('Error en listado de aprendices:', err);
    res.status(500).render('aprendices/index', {
      title:       'Aprendices',
      fichas:      [],
      fichaActiva: null,
      aprendices:  [],
      competencias:[],
      filtros:     { estado: '', buscar: '', competencia: '' },
      error:       'Error interno al cargar los aprendices.',
    });
  }
}

/**
 * GET /aprendices/:id
 * Detalle de un aprendiz con todos sus juicios agrupados por competencia.
 */
async function show(req, res) {
  try {
    const id       = parseInt(req.params.id, 10);
    const aprendiz = await aprendizModel.getById(id);

    if (!aprendiz) {
      return res.status(404).render('404', {
        title: 'Aprendiz no encontrado',
      });
    }

    const fichas = await dashboardModel.getFichas();

    res.render('aprendices/show', {
      title:   `${aprendiz.nombres} ${aprendiz.apellidos}`,
      aprendiz,
      fichas,
      fichaActiva: aprendiz.id_ficha,
    });

  } catch (err) {
    console.error('Error en detalle de aprendiz:', err);
    res.status(500).send('Error interno al cargar el aprendiz.');
  }
}

module.exports = { index, show };
