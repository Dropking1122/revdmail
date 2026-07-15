const express = require('express');
const router = express.Router();
const apiController = require('../controllers/apiController');

router.post('/create', apiController.createEmail);
router.delete('/delete', apiController.deleteEmail);
router.get('/messages', apiController.getMessages);
router.get('/domains', apiController.getDomains);
router.get('/debug/emails', apiController.debugEmails);
router.get('/gmail-generator', apiController.gmailGenerator);

module.exports = router;
