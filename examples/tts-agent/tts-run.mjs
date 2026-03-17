#!/usr/bin/env node
/**
 * tts-run.mjs — Calls ElevenLabs TTS API and returns audio as base64.
 *
 * Usage: ELEVENLABS_API_KEY=xxx node tts-run.mjs "text to speak" [voice_id]
 *
 * Returns JSON: { audio_base64, format, chars, voice_id }
 */

const text = process.argv[2];
const voiceId = process.argv[3] || '21m00Tcm4TlvDq8ikWAM'; // Rachel (default)

if (!text) {
  console.error(JSON.stringify({ error: 'Usage: node tts-run.mjs "text" [voice_id]' }));
  process.exit(1);
}

const apiKey = process.env.ELEVENLABS_API_KEY;
if (!apiKey) {
  console.error(JSON.stringify({ error: 'ELEVENLABS_API_KEY environment variable is required' }));
  process.exit(1);
}

try {
  const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
    method: 'POST',
    headers: {
      'xi-api-key': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      text,
      model_id: 'eleven_multilingual_v2',
      voice_settings: { stability: 0.5, similarity_boost: 0.75 },
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    console.error(JSON.stringify({ error: `ElevenLabs API error: ${response.status} ${errText.slice(0, 200)}` }));
    process.exit(1);
  }

  const buffer = await response.arrayBuffer();
  const base64 = Buffer.from(buffer).toString('base64');

  console.log(JSON.stringify({
    audio_base64: base64,
    format: 'mp3',
    chars: text.length,
    voice_id: voiceId,
  }));
} catch (err) {
  console.error(JSON.stringify({ error: err.message }));
  process.exit(1);
}
