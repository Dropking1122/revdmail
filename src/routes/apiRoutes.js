const express = require('express');
const router = express.Router();
const apiController = require('../controllers/apiController');

router.post('/create', apiController.createEmail);
router.delete('/delete', apiController.deleteEmail);
router.get('/messages', apiController.getMessages);
router.get('/message/:id', apiController.getMessageDetail);
router.get('/domains', apiController.getDomains);
router.get('/gmail-generator', apiController.gmailGenerator);
router.get('/gmail-variants', apiController.gmailGenerator);

module.exports = router;
