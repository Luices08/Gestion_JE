const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/dashboardController');

router.get('/',          ctrl.index);
router.get('/dashboard', ctrl.index);

module.exports = router;
