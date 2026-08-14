const express    = require('express');
const multer     = require('multer');
const path       = require('path');
const fs         = require('fs');
const router     = express.Router();
const ctrl       = require('../controllers/importController');

// Crear la carpeta uploads/ si no existe (se excluye del .gitignore)
const uploadsDir = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// =============================================================
//  CONFIGURACIÓN DE MULTER
// =============================================================

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, '../uploads'));
  },
  filename: (req, file, cb) => {
    // Nombre único para evitar colisiones entre imports simultáneos
    const timestamp = Date.now();
    const ext       = path.extname(file.originalname).toLowerCase();
    cb(null, `import_${timestamp}${ext}`);
  },
});

const fileFilter = (req, file, cb) => {
  // Validar solo por extensión — el MIME type de .xls varía entre
  // navegadores (Chrome/Edge pueden enviar application/octet-stream)
  const ext = path.extname(file.originalname).toLowerCase();
  if (ext === '.xls' || ext === '.xlsx') {
    cb(null, true);
  } else {
    const err = new Error('Solo se aceptan archivos .xls y .xlsx');
    err.code  = 'TIPO_INVALIDO';
    cb(err, false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
});

// =============================================================
//  RUTAS
// =============================================================

// GET /importar — formulario de carga
router.get('/', ctrl.showForm);

// POST /importar — procesar Excel
router.post(
  '/',
  upload.single('archivo'),
  ctrl.upload
);

// Middleware de error de multer (debe ir después del handler de la ruta)
router.use(ctrl.handleMulterError);

module.exports = router;
