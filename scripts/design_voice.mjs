// Voice Design preview helper (ElevenLabs text-to-voice/design). Key from env only.
// Usage: node design_voice.mjs <outDir> <label> <model_id> <guidance> "<description>" "<text>"
// Writes <outDir>/<label>_<i>.mp3 and <outDir>/<label>.json (generated_voice_ids, no secrets).
import { writeFileSync, mkdirSync } from 'node:fs';
const key = process.env.ELEVENLABS_API_KEY;
if (!key) { console.error('ELEVENLABS_API_KEY missing'); process.exit(2); }
const [outDir, label, model_id, guidance, voice_description, text] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const body = { voice_description, model_id, guidance_scale: Number(guidance), text, should_enhance: false };
const res = await fetch('https://api.elevenlabs.io/v1/text-to-voice/design?output_format=mp3_44100_128', {
  method: 'POST', headers: { 'xi-api-key': key, 'content-type': 'application/json' }, body: JSON.stringify(body),
});
const t = await res.text();
if (!res.ok) { console.log('ERROR', res.status, t.slice(0, 800)); process.exit(1); }
const d = JSON.parse(t);
const meta = { label, model_id, guidance, voice_description, text: d.text, previews: [] };
d.previews.forEach((p, i) => {
  const f = `${outDir}/${label}_${i}.mp3`;
  writeFileSync(f, Buffer.from(p.audio_base_64, 'base64'));
  meta.previews.push({ file: f, generated_voice_id: p.generated_voice_id, duration_secs: p.duration_secs, language: p.language, media_type: p.media_type });
});
writeFileSync(`${outDir}/${label}.json`, JSON.stringify(meta, null, 2));
console.log(JSON.stringify(meta.previews, null, 1));
