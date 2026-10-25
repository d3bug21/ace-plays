// Rough F0 (pitch) estimator for voice selection. Decodes with macOS afconvert to 16 kHz mono PCM,
// then runs a normalized autocorrelation pitch tracker on voiced frames. No network.
// Usage: node analyze_pitch.mjs file1.mp3 [file2.mp3 ...]
import { execFileSync } from 'node:child_process';
import { readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
const tmp = process.env.TMPDIR || '.';
function decode(f) {
  const out = join(tmp, `pitch_${process.pid}_${Math.random().toString(36).slice(2)}.wav`);
  execFileSync('afconvert', ['-f', 'WAVE', '-d', 'LEI16@16000', '-c', '1', f, out]);
  const b = readFileSync(out); unlinkSync(out);
  let off = 12; let data = null;
  while (off < b.length - 8) { const id = b.toString('ascii', off, off + 4); const sz = b.readUInt32LE(off + 4); if (id === 'data') { data = b.subarray(off + 8, off + 8 + sz); break; } off += 8 + sz; }
  const s = new Float32Array(data.length / 2); for (let i = 0; i < s.length; i++) s[i] = data.readInt16LE(i * 2) / 32768; return s;
}
function f0s(s, sr = 16000) {
  const N = 640, hop = 160, minL = Math.floor(sr / 500), maxL = Math.floor(sr / 70); const res = [];
  let peak = 0; for (const v of s) peak = Math.max(peak, Math.abs(v));
  for (let st = 0; st + N + maxL < s.length; st += hop) {
    let e = 0; for (let i = 0; i < N; i++) e += s[st + i] * s[st + i];
    if (Math.sqrt(e / N) < peak * 0.08) continue;
    let best = 0, bl = 0;
    for (let L = minL; L <= maxL; L++) { let c = 0, e2 = 0; for (let i = 0; i < N; i++) { c += s[st + i] * s[st + i + L]; e2 += s[st + i + L] ** 2; } const r = c / Math.sqrt(e * e2 + 1e-9); if (r > best) { best = r; bl = L; } }
    if (best > 0.75) res.push(sr / bl);
  }
  return res.sort((a, b) => a - b);
}
for (const f of process.argv.slice(2)) {
  const v = f0s(decode(f)); const q = (p) => v.length ? v[Math.floor(p * (v.length - 1))].toFixed(0) : '-';
  console.log(`${f}\tvoiced=${v.length}\tF0 p25=${q(0.25)} median=${q(0.5)} p75=${q(0.75)} Hz`);
}
