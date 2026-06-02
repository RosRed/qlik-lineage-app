const express = require('express');
const router = express.Router();

router.use('/', require('./apps'));
router.use('/', require('./analyze'));
router.use('/apps/:id/chat', require('./chat'));

module.exports = router;
