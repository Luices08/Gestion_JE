const express = require('express');
const path    = require('path');
require('dotenv').config();

const app = express();

// ── Motor de vistas ──────────────────────────────────────────
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// ── Middlewares ──────────────────────────────────────────────
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── Rutas ────────────────────────────────────────────────────
app.use('/',           require('./routes/dashboardRoutes'));
app.use('/aprendices', require('./routes/aprendizRoutes'));
app.use('/importar',   require('./routes/importRoutes'));

// ── 404 ──────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).render('404', { title: 'Página no encontrada' });
});

// ── Inicio ───────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor corriendo en http://localhost:${PORT}`);
});
