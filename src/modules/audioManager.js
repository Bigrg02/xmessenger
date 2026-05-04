const fs = require('fs');
const path = require('path');

// Track last played clip per session to avoid repeats
const lastPlayed = new Map(); // sessionId -> clipPath

function getClipsForCategory(characterName, category) {
  const dir = path.join(__dirname, '../../characters', characterName.toLowerCase(), 'audio', category);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => /\.(mp3|wav|ogg|m4a)$/i.test(f))
    .map(f => `/characters/${characterName.toLowerCase()}/audio/${category}/${f}`);
}

function pickClip(sessionId, clips) {
  if (!clips.length) return null;
  if (clips.length === 1) return clips[0];

  const last = lastPlayed.get(sessionId);
  const available = clips.filter(c => c !== last);
  const chosen = available[Math.floor(Math.random() * available.length)];
  lastPlayed.set(sessionId, chosen);
  return chosen;
}

function getClip(sessionId, characterName, category) {
  if (!category || category === 'none') return null;
  const clips = getClipsForCategory(characterName, category);
  return pickClip(sessionId, clips);
}

module.exports = { getClip };
