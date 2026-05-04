require('dotenv').config();
const express = require('express');
const path = require('path');
const { initDb } = require('./src/db');
const charactersRouter = require('./src/routes/characters');
const sessionsRouter = require('./src/routes/sessions');
const messagesRouter = require('./src/routes/messages');
const devicesRouter = require('./src/routes/devices');
const audioRouter = require('./src/routes/audio');
const sttRouter = require('./src/routes/stt');
const deviceManager = require('./src/modules/deviceManager');

const app = express();
const PORT = process.env.PORT || 3000;

initDb();

app.use(express.json());

// Serve character assets (avatars, audio)
app.use('/characters', express.static(path.join(__dirname, 'characters')));
// Serve generated images
app.use('/data/images', express.static(path.join(__dirname, 'data/images')));
// Serve frontend
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/characters', charactersRouter);
app.use('/api/sessions', sessionsRouter);
app.use('/api/sessions', messagesRouter);
app.use('/api/devices', devicesRouter);
app.use('/api/audio', audioRouter);
app.use('/api/stt', sttRouter);

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', version: '1.0.0' });
});

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`xMessage listening on port ${PORT}`);
  deviceManager.connect().catch(err => {
    console.warn('[devices] Intiface not available:', err.message);
  });
});
