// routes/announcementRoute.js
const express = require('express');
const router  = express.Router();
const auth    = require('../middleware/authMiddleware');
const { getActiveAnnouncements, markAnnouncementRead } = require('../authController/announcementController');

router.get('/active', auth, getActiveAnnouncements);
router.patch('/:id/read', auth, markAnnouncementRead); // ← nuevo

module.exports = router;
