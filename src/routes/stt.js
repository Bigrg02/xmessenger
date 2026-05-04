const express = require('express');
const router = express.Router();
const multer = require('multer');
const axios = require('axios');
const FormData = require('form-data');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

// POST /api/stt — accept audio blob, return transcript
router.post('/', upload.single('audio'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No audio file provided' });

  const whisperUrl = (process.env.WHISPER_API_URL || 'http://localhost:8000').replace(/\/$/, '');

  try {
    const form = new FormData();
    form.append('file', req.file.buffer, {
      filename: req.file.originalname || 'audio.webm',
      contentType: req.file.mimetype || 'audio/webm',
    });
    form.append('model', 'whisper-1');

    const response = await axios.post(`${whisperUrl}/v1/audio/transcriptions`, form, {
      headers: form.getHeaders(),
      timeout: 30000,
    });

    const transcript = response.data?.text?.trim() || '';
    res.json({ transcript });
  } catch (err) {
    console.error('[stt] Whisper error:', err.message);
    res.status(502).json({ error: 'STT service unavailable', detail: err.message });
  }
});

module.exports = router;
