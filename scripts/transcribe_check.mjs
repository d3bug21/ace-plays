// Intelligibility check: transcribe local mp3s with ElevenLabs Scribe. Key from env only.
// Usage: node transcribe_check.mjs file1.mp3 [...]
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
const key = process.env.ELEVENLABS_API_KEY;
if (!key) { console.error('ELEVENLABS_API_KEY missing'); process.exit(2); }
for (const f of process.argv.slice(2)) {
  const fd = new FormData();
  fd.append('model_id', process.env.STT_MODEL || 'scribe_v2');
  fd.append('file', new Blob([readFileSync(f)], { type: 'audio/mpeg' }), basename(f));
  const res = await fetch('https://api.elevenlabs.io/v1/speech-to-text', { method: 'POST', headers: { 'xi-api-key': key }, body: fd });
  const t = await res.text();
  if (!res.ok) { console.log(f, 'ERROR', res.status, t.slice(0, 300)); continue; }
  const d = JSON.parse(t);
  console.log(`${basename(f)}\t[${d.language_code} ${Number(d.language_probability).toFixed(2)}]\t${d.text}`);
}
