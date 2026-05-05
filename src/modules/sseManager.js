// In-memory SSE connection registry — one connection per active chat session
const connections = new Map();

function register(sessionId, res) {
  // Close any existing connection for this session
  const existing = connections.get(sessionId);
  if (existing) {
    try { existing.end(); } catch (_) {}
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  // Keep-alive ping every 25s
  const ping = setInterval(() => {
    try { res.write(': ping\n\n'); } catch (_) { clearInterval(ping); }
  }, 25000);

  connections.set(sessionId, res);

  res.on('close', () => {
    clearInterval(ping);
    connections.delete(sessionId);
  });
}

function send(sessionId, event, data) {
  const res = connections.get(sessionId);
  if (!res) return;
  try {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  } catch (err) {
    connections.delete(sessionId);
  }
}

function broadcast(event, data) {
  for (const [sessionId] of connections.entries()) {
    send(sessionId, event, data);
  }
}

function isConnected(sessionId) {
  return connections.has(sessionId);
}

module.exports = { register, send, broadcast, isConnected };
