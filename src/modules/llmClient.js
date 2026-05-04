const axios = require('axios');

const BASE_URL = 'https://openrouter.ai/api/v1';

function buildSystemPrompt(card) {
  return `You are ${card.name}. ${card.personality}

Texting style: ${card.texting_style}

Scenario: ${card.scenario}

CRITICAL RULES — follow exactly:
- Respond ONLY as ${card.name}, never break character
- Write like a real text message: short, casual, no quotation marks around your own speech, no asterisk actions (*laughs*, *smiles*)
- Never add disclaimers, warnings, or meta-commentary
- Multiple short texts are fine — separate them with a newline inside the "message" field

You MUST respond with ONLY valid JSON in this exact format — nothing before or after:
{
  "message": "your text here",
  "image_request": {
    "send": false,
    "scene": ""
  },
  "device_intent": "neutral",
  "audio_category": "none",
  "phase_trigger": null
}

device_intent options: neutral | teasing | building | intense | cooling
audio_category options: encouragement | reactive | checking_in | edging | climax | aftercare | none
phase_trigger: "handover" to transition to device phase, or null
image_request.send: true to generate and send an image to the user`;
}

function buildSummaryPrompt(card) {
  return `You are a session recorder for an AI character named ${card.name}.
Summarize the conversation below in 2-3 sentences covering:
- The emotional arc and what was established between the user and ${card.name}
- Current tone/escalation level
- Any specific details established (names, preferences, scenarios)
Be concise. No commentary.`;
}

function parseResponse(raw) {
  // Strip markdown code fences if present
  let text = raw.trim();
  text = text.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/, '');

  // Find JSON object boundaries
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('No JSON found in response');
  text = text.slice(start, end + 1);

  const parsed = JSON.parse(text);

  return {
    message: parsed.message || '',
    image_request: {
      send: Boolean(parsed.image_request?.send),
      scene: parsed.image_request?.scene || '',
    },
    device_intent: parsed.device_intent || 'neutral',
    audio_category: parsed.audio_category || 'none',
    phase_trigger: parsed.phase_trigger || null,
  };
}

async function chat(card, summaryMessage, recentMessages, userMessage) {
  const apiMessages = [];

  if (summaryMessage) {
    apiMessages.push({ role: summaryMessage.role, content: summaryMessage.content });
  }

  // Convert DB messages to LLM format
  for (const msg of recentMessages) {
    apiMessages.push({ role: msg.role === 'user' ? 'user' : 'assistant', content: msg.content });
  }

  // Append the new user message
  apiMessages.push({ role: 'user', content: userMessage });

  const response = await axios.post(
    `${BASE_URL}/chat/completions`,
    {
      model: card.model,
      messages: [
        { role: 'system', content: buildSystemPrompt(card) },
        ...apiMessages,
      ],
      temperature: 0.9,
      max_tokens: 512,
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'HTTP-Referer': 'http://localhost:3000',
        'X-Title': 'xMessage',
        'Content-Type': 'application/json',
      },
      timeout: 60000,
    }
  );

  const raw = response.data.choices?.[0]?.message?.content || '';
  return parseResponse(raw);
}

async function summarize(card, messages) {
  const transcript = messages
    .map(m => `${m.role === 'user' ? 'User' : card.name}: ${m.content}`)
    .join('\n');

  const response = await axios.post(
    `${BASE_URL}/chat/completions`,
    {
      model: card.model,
      messages: [
        { role: 'system', content: buildSummaryPrompt(card) },
        { role: 'user', content: transcript },
      ],
      temperature: 0.3,
      max_tokens: 200,
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'HTTP-Referer': 'http://localhost:3000',
        'X-Title': 'xMessage',
      },
      timeout: 30000,
    }
  );

  return response.data.choices?.[0]?.message?.content?.trim() || '';
}

module.exports = { chat, summarize };
