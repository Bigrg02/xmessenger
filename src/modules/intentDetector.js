// Lightweight intent detection for voice commands during device phase.
// Runs BEFORE the LLM call so devices respond immediately.

const BODY_TARGETS = [
  [/\b(cock|dick|front|clit|pussy)\b/i, 'gush2'],
  [/\b(ass|butt|back|plug|prostate)\b/i, 'edge2'],
  [/\b(both|everything|all of it)\b/i, 'both'],
];

const INTENSITY = [
  [/\b(more|harder|higher|up|stronger|faster|increase)\b/i, +0.15],
  [/\b(less|softer|lower|down|weaker|slower|decrease|reduce)\b/i, -0.15],
];

const URGENCY = [
  [/\b(stop|pause|off|done|enough)\b/i, 'stop'],
  [/\b(close|almost|so close|nearly|about to|gonna cum)\b/i, 'close'],
  [/\b(keep going|don.?t stop|stay there|hold it|keep it|maintain)\b/i, 'keep'],
  [/\b(too much|too intense|too strong|overwhelming|too hard)\b/i, 'too_much'],
  [/\b(cum(ming)?|com(e|ing)|finish|climax|there|yes+)\b/i, 'climax'],
];

function detect(transcript) {
  const result = {
    bodyTarget: null,  // 'edge2' | 'gush2' | 'both' | null
    intensityDelta: null,  // number | null
    urgency: null,  // 'stop' | 'close' | 'keep' | 'too_much' | 'climax' | null
    hasIntent: false,
  };

  for (const [re, target] of BODY_TARGETS) {
    if (re.test(transcript)) { result.bodyTarget = target; break; }
  }

  for (const [re, delta] of INTENSITY) {
    if (re.test(transcript)) { result.intensityDelta = delta; break; }
  }

  for (const [re, urgency] of URGENCY) {
    if (re.test(transcript)) { result.urgency = urgency; break; }
  }

  result.hasIntent = result.bodyTarget !== null || result.intensityDelta !== null || result.urgency !== null;
  return result;
}

module.exports = { detect };
