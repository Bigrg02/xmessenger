# Audio Clips for Sara

Drop MP3/WAV/OGG files into each folder. Files will be selected randomly (no repeats back-to-back).

## Categories

### encouragement/
Warm, supportive clips. Played during normal conversation when she's being encouraging.
Examples: "You're doing so well", "I'm proud of you", "Keep going baby"

### reactive/
Short reactive sounds/words. Played when she reacts to what you say.
Examples: gasps, "mmm", "yeah?", "tell me more"

### checking_in/
Sent automatically after 45s silence during device phase. Gentle check-in clips.
Examples: "You still with me?", "How does that feel?", "Talk to me"

### edging/
Played when device_intent reaches "building" or "intense" levels.
Examples: "Don't you dare", "Hold it for me", "Stay right there"

### climax/
Played when phase_trigger or audio_category = climax.
Examples: high-intensity reactive clips

### aftercare/
Played after the session winds down (cooling phase or handover back).
Examples: soft, warm, caring clips

## RVC Pipeline (optional voice cloning)
1. Train an RVC v2 model on your voice reference clips (10-30 mins of clean audio)
2. Place the .pth and .index files as rvc_model.pth / rvc_model.index
3. Use a TTS system (Bark, ElevenLabs, etc.) to generate base clips from text
4. Run RVC inference: rvc_model.pth + base_audio → voice-cloned output
5. Place final MP3s in the appropriate category folders above
