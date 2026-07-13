const express = require('express');
const router = express.Router();

router.use('/apps', require('./apps'));
router.use('/', require('./analyze'));
router.use('/apps/:id/chat', require('./chat'));
router.use('/usage', require('./usage'));
router.use('/qlik', require('./qlik'));
router.use('/global', require('./global'));
router.use('/admin', require('./admin'));

module.exports = router;
