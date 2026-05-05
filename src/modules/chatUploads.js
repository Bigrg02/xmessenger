const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const CHAT_UPLOADS_DIR = path.join(__dirname, '../../data/chat-uploads');

if (!fs.existsSync(CHAT_UPLOADS_DIR)) {
  fs.mkdirSync(CHAT_UPLOADS_DIR, { recursive: true });
}

function sanitizeExt(originalName, mimeType) {
  const fromName = path.extname(originalName || '').toLowerCase();
  if (fromName && /^[.][a-z0-9]{1,8}$/.test(fromName)) return fromName;

  const mimeExt = (mimeType || '').split('/')[1] || 'jpg';
  return `.${mimeExt.replace(/[^a-z0-9]/gi, '').toLowerCase() || 'jpg'}`;
}

function saveChatImage(file, sessionId) {
  if (!file) throw new Error('image file required');
  if (!file.mimetype?.startsWith('image/')) throw new Error('Only image uploads are supported');

  const ext = sanitizeExt(file.originalname, file.mimetype);
  const filename = `${sessionId}_${Date.now()}_${uuidv4()}${ext}`;
  const targetPath = path.join(CHAT_UPLOADS_DIR, filename);

  fs.writeFileSync(targetPath, file.buffer);

  return {
    filename,
    path: targetPath,
    url: `/data/chat-uploads/${filename}`,
    contentType: file.mimetype,
    originalFilename: file.originalname || filename,
  };
}

module.exports = {
  CHAT_UPLOADS_DIR,
  saveChatImage,
};
