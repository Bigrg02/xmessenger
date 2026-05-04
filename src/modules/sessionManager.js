const db = require('../db');
const llmClient = require('./llmClient');

const CONTEXT_LIMIT = 40;

async function buildContext(session, characterCard) {
  const total = db.countMessages(session.id);
  let messages = db.getRecentMessages(session.id, CONTEXT_LIMIT);

  let summaryMessage = null;
  if (total > CONTEXT_LIMIT && !session.summary) {
    // Summarize older history
    const allMessages = db.getMessages(session.id, total - CONTEXT_LIMIT);
    const summaryText = await llmClient.summarize(characterCard, allMessages);
    db.updateSessionSummary(session.id, summaryText);
    session = db.getSession(session.id);
  }

  if (session.summary) {
    summaryMessage = {
      role: 'system',
      content: `[Session context so far: ${session.summary}]`,
    };
  }

  return { messages, summaryMessage };
}

module.exports = { buildContext };
