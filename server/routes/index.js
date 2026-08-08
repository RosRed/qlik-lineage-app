const express = require('express');
const router = express.Router();
const { requireAuth } = require('../auth/authMiddleware');

// Routes d'authentification : /login et /status sont publiques (les autres
// sont protégées à l'intérieur de authRoutes via requireAuth).
router.use('/auth', require('../auth/authRoutes'));

// Toutes les autres routes /api/* nécessitent une session valide.
router.use(requireAuth);

router.use('/apps', require('./apps'));
router.use('/', require('./analyze'));
router.use('/apps/:id/chat', require('./chat'));
router.use('/usage', require('./usage'));
router.use('/qlik', require('./qlik'));
router.use('/global', require('./global'));
router.use('/ssis', require('./ssis'));
router.use('/admin', require('./admin'));

module.exports = router;
