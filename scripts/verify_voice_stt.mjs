#!/usr/bin/env node
// Intelligibility check for generated voice lines: transcribes each voice mp3 with ElevenLabs Scribe and
// compares it with the manifest `tts` text (word-level similarity). Writes scripts/voice-stt-check.json.
// Usage: ELEVENLABS_API_KEY=... node scripts/verify_voice_stt.mjs [--only=id,id2] [--threshold=0.6]
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const KEY = process.env.ELEVENLABS_API_KEY;
if (!KEY) { console.error('ELEVENLABS_API_KEY missing'); process.exit(2); }
const args = Object.fromEntries(process.argv.slice(2).map((a) => { const m = a.match(/^--([^=]+)(?:=(.*))?$/); return [m[1], m[2] ?? true]; }));
const ONLY = args.only ? String(args.only).split(',') : null;
const THRESH = Number(args.threshold || 0.6);
const entries = JSON.parse(readFileSync(join(ROOT, 'src/audio/manifest.json'), 'utf8')).entries
  .filter((e) => e.kind === 'voice' && (!ONLY || ONLY.includes(e.id)));

const norm = (s) => s.toLowerCase().replace(/\[[^\]]*\]/g, ' ').replace(/[^a-z' ]+/g, ' ').replace(/-/g, ' ').split(/\s+/).filter(Boolean)
  .map((w) => w.replace(/(.)\1+/g, '$1'));
function similarity(a, b) { // word-level LCS ratio
  const x = norm(a), y = norm(b); if (!x.length) return y.length ? 0 : 1;
  const dp = Array.from({ length: x.length + 1 }, () => new Array(y.length + 1).fill(0));
  for (let i = 1; i <= x.length; i++) for (let j = 1; j <= y.length; j++)
    dp[i][j] = x[i - 1] === y[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
  return (2 * dp[x.length][y.length]) / (x.length + y.length);
}
async function transcribe(file) {
  for (let i = 0; i < 5; i++) {
    const fd = new FormData(); fd.append('model_id', 'scribe_v2'); fd.append('language_code', 'en');
    fd.append('file', new Blob([readFileSync(file)], { type: 'audio/mpeg' }), basename(file));
    const res = await fetch('https://api.elevenlabs.io/v1/speech-to-text', { method: 'POST', headers: { 'xi-api-key': KEY }, body: fd });
    if (res.ok) return (await res.json()).text;
    if (res.status === 429 || res.status >= 500) { await new Promise((r) => setTimeout(r, 2000 * 2 ** i)); continue; }
    throw new Error(`HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  }
  throw new Error('retries exhausted');
}
const out = []; const queue = [...entries];
async function worker() {
  while (queue.length) {
    const e = queue.shift(); const f = join(ROOT, 'public', e.file);
    if (!existsSync(f)) { out.push({ id: e.id, status: 'missing' }); continue; }
    try { const heard = await transcribe(f); const sim = Number(similarity(e.tts, heard).toFixed(2));
      out.push({ id: e.id, speaker: e.speaker, expected: e.tts, heard, similarity: sim, flag: sim < THRESH });
    } catch (err) { out.push({ id: e.id, status: 'error', error: err.message }); }
  }
}
await Promise.all([worker(), worker(), worker()]);
out.sort((a, b) => (a.similarity ?? -1) - (b.similarity ?? -1));
writeFileSync(join(ROOT, 'scripts/voice-stt-check.json'), JSON.stringify({ checked_at: new Date().toISOString(), threshold: THRESH, results: out }, null, 2) + '\n');
for (const r of out) if (r.flag || r.status) console.log(r.id, r.similarity ?? r.status, '| expected:', r.expected, '| heard:', r.heard ?? r.error);
console.log(`checked ${out.length}, flagged ${out.filter((r) => r.flag).length}, errors ${out.filter((r) => r.status).length}`);
