const axios = require('axios');

const BASE_URL = 'https://openrouter.ai/api/v1';

// Models known to support response_format: json_object via OpenRouter
const JSON_MODE_MODELS = [
  'openai/gpt-4o',
  'openai/gpt-4o-mini',
  'openai/gpt-4-turbo',
  'openai/gpt-3.5-turbo',
  'openai/o1-mini',
  'openai/o3-mini',
  'mistralai/mistral-large',
  'mistralai/mistral-medium',
];

function supportsJsonMode(model) {
  return JSON_MODE_MODELS.some(m => model.startsWith(m) || model === m);
}

function buildSystemPrompt(card) {
  return `You are ${card.name}. ${card.personality}

Texting style: ${card.texting_style}

Scenario: ${card.scenario}

RULES — follow exactly:
- Stay in character as ${card.name} at all times
- Write like real text messages: short, casual, no asterisk actions, no quotation marks
- No disclaimers, warnings, or meta-commentary ever
- Multiple short texts are fine — put them on separate lines inside "message"

OUTPUT FORMAT — you must always respond with valid JSON, no other text:
{
  "message": "your text here",
  "image_request": { "send": false, "scene": "" },
  "device_intent": "neutral",
  "audio_category": "none",
  "phase_trigger": null
}

device_intent: neutral | teasing | building | intense | cooling
audio_category: encouragement | reactive | checking_in | edging | climax | aftercare | none
phase_trigger: "handover" (transitions to device phase) or null
image_request.send: true to generate and send an image`;
}

function buildRetryPrompt() {
  return `Your last response was not valid JSON. You MUST respond with only a JSON object. No other text. Example:
{"message":"hey","image_request":{"send":false,"scene":""},"device_intent":"neutral","audio_category":"none","phase_trigger":null}`;
}

function buildSummaryPrompt(card) {
  return `Summarize this conversation between a user and ${card.name} in 2-3 sentences.
Cover: emotional arc, what has been established, current escalation level.
Be concise. Return plain text only.`;
}

function parseResponse(raw) {
  if (!raw || !raw.trim()) throw new Error('Empty response from model');

  let text = raw.trim();

  // Strip markdown code fences
  text = text.replace(/^```json\s*/im, '').replace(/^```\s*/im, '').replace(/```\s*$/m, '');

  // Find the outermost JSON object
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1) {
    // Log raw for debugging
    console.warn('[llm] No JSON found. Raw response:', text.slice(0, 200));
    throw new Error('No JSON found in response');
  }

  let parsed;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch (e) {
    console.warn('[llm] JSON parse failed. Raw:', text.slice(start, Math.min(end + 1, start + 300)));
    throw new Error(`JSON parse error: ${e.message}`);
  }

  // If the model only returned a message string with no structure, wrap it
  if (typeof parsed === 'string') {
    return makeResponse(parsed);
  }

  // message field might be missing — try to salvage from common variations
  const msg = parsed.message ?? parsed.text ?? parsed.reply ?? parsed.response ?? '';

  return makeResponse(msg, parsed);
}

function makeResponse(message, parsed = {}) {
  return {
    message: String(message || '').trim(),
    image_request: {
      send: Boolean(parsed.image_request?.send),
      scene: parsed.image_request?.scene || '',
    },
    device_intent: parsed.device_intent || 'neutral',
    audio_category: parsed.audio_category || 'none',
    phase_trigger: parsed.phase_trigger || null,
  };
}

async function callLLM(model, messages, useJsonMode) {
  const body = {
    model,
    messages,
    temperature: 0.9,
    max_tokens: 512,
  };

  if (useJsonMode) {
    body.response_format = { type: 'json_object' };
  }

  const response = await axios.post(`${BASE_URL}/chat/completions`, body, {
    headers: {
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'HTTP-Referer': 'http://localhost:3000',
      'X-Title': 'xMessage',
      'Content-Type': 'application/json',
    },
    timeout: 60000,
  });

  return response.data.choices?.[0]?.message?.content || '';
}

async function chat(card, summaryMessage, recentMessages, userMessage) {
  const apiMessages = [];

  if (summaryMessage) {
    apiMessages.push({ role: summaryMessage.role, content: summaryMessage.content });
  }

  for (const msg of recentMessages) {
    // Wrap previous assistant messages back in JSON so the model understands the expected format
    if (msg.role === 'assistant') {
      const wrapped = JSON.stringify({
        message: msg.content,
        image_request: { send: false, scene: '' },
        device_intent: msg.metadata?.device_intent || 'neutral',
        audio_category: msg.metadata?.audio_category || 'none',
        phase_trigger: null,
      });
      apiMessages.push({ role: 'assistant', content: wrapped });
    } else {
      apiMessages.push({ role: 'user', content: msg.content });
    }
  }

  apiMessages.push({ role: 'user', content: userMessage });

  const jsonMode = supportsJsonMode(card.model);
  const systemMessages = [{ role: 'system', content: buildSystemPrompt(card) }];

  // First attempt
  let raw = await callLLM(card.model, [...systemMessages, ...apiMessages], jsonMode);
  console.log(`[llm] Raw response (${raw.length} chars):`, raw.slice(0, 150));

  try {
    return parseResponse(raw);
  } catch (firstErr) {
    console.warn(`[llm] Parse failed (${firstErr.message}), retrying with JSON reminder...`);

    // Retry: append the failed response and a correction prompt
    const retryMessages = [
      ...systemMessages,
      ...apiMessages,
      { role: 'assistant', content: raw },
      { role: 'user', content: buildRetryPrompt() },
    ];

    raw = await callLLM(card.model, retryMessages, jsonMode);
    console.log('[llm] Retry raw response:', raw.slice(0, 150));

    return parseResponse(raw);
  }
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
