// Tile screenshot crops into one image for quick visual review (local only).
// node tests/tile.mjs out.png cropX cropY cropW cropH cols img1 img2 ...
import { chromium } from 'playwright-core';
import fs from 'node:fs';
const [out, cx, cy, cw, ch, cols, ...imgs] = process.argv.slice(2);
const W = Number(cw), H = Number(ch), C = Number(cols);
const rows = Math.ceil(imgs.length / C);
const cells = imgs.map((p) => `<div style="width:${W}px;height:${H}px;overflow:hidden;position:relative;display:inline-block"><img src="data:image/png;base64,${fs.readFileSync(p).toString('base64')}" style="position:absolute;left:${-cx}px;top:${-cy}px"></div>`).join('');
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const pg = await b.newPage({ viewport: { width: W * C, height: H * rows } });
await pg.setContent(`<body style="margin:0;line-height:0;font-size:0;background:#222">${cells}</body>`);
await pg.screenshot({ path: out });
await b.close();
