// ===== Push-to-Talk =====
const PTT = (() => {
  const btn = document.getElementById('btn-ptt');
  let mediaRecorder = null;
  let chunks = [];
  let stream = null;
  let isRecording = false;

  async function startRecording() {
    if (isRecording) return;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorder = new MediaRecorder(stream, { mimeType: getSupportedMimeType() });
      chunks = [];

      mediaRecorder.ondataavailable = e => {
        if (e.data.size > 0) chunks.push(e.data);
      };

      mediaRecorder.onstop = async () => {
        const blob = new Blob(chunks, { type: mediaRecorder.mimeType });
        stream.getTracks().forEach(t => t.stop());
        await processAudio(blob);
      };

      mediaRecorder.start();
      isRecording = true;
      btn.classList.add('recording');
      btn.querySelector('span').textContent = 'Recording…';
      navigator.vibrate?.(30);
    } catch (err) {
      console.error('[ptt] Mic access denied:', err);
      btn.querySelector('span').textContent = 'Mic denied';
      setTimeout(() => { btn.querySelector('span').textContent = 'Hold to Talk'; }, 2000);
    }
  }

  function stopRecording() {
    if (!isRecording || !mediaRecorder) return;
    isRecording = false;
    btn.classList.remove('recording');
    btn.querySelector('span').textContent = 'Processing…';
    mediaRecorder.stop();
    navigator.vibrate?.([20, 20, 20]);
  }

  async function processAudio(blob) {
    try {
      const form = new FormData();
      form.append('audio', blob, 'recording.webm');

      const res = await fetch('/api/stt', { method: 'POST', body: form });
      const { transcript, error } = await res.json();

      if (error || !transcript?.trim()) {
        btn.querySelector('span').textContent = 'Hold to Talk';
        return;
      }

      btn.querySelector('span').textContent = 'Hold to Talk';

      // Send as voice message
      Chat.sendMessage(transcript, true);

    } catch (err) {
      console.error('[ptt] STT error:', err);
      btn.querySelector('span').textContent = 'Hold to Talk';
    }
  }

  function getSupportedMimeType() {
    const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
    for (const type of types) {
      if (MediaRecorder.isTypeSupported(type)) return type;
    }
    return '';
  }

  // Touch events for mobile PTT
  btn.addEventListener('touchstart', e => { e.preventDefault(); startRecording(); }, { passive: false });
  btn.addEventListener('touchend', e => { e.preventDefault(); stopRecording(); }, { passive: false });
  btn.addEventListener('touchcancel', e => { e.preventDefault(); stopRecording(); }, { passive: false });

  // Mouse events for desktop testing
  btn.addEventListener('mousedown', startRecording);
  btn.addEventListener('mouseup', stopRecording);
  btn.addEventListener('mouseleave', () => { if (isRecording) stopRecording(); });
})();
