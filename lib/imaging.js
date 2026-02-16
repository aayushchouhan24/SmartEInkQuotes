const sharp = require('sharp');

const DISPLAY_W = 296;
const DISPLAY_H = 128;
const BITMAP_BYTES = (DISPLAY_W * DISPLAY_H) / 8; // 4736

// ── Floyd–Steinberg dithering → 1-bit packed bitmap ─────────────────────────

function ditherToBitmap(grayBuf, w, h) {
  const pixels = new Float32Array(grayBuf);
  const rowBytes = Math.ceil(w / 8);
  const out = new Uint8Array(rowBytes * h);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x;
      const oldVal = pixels[idx];
      const newVal = oldVal < 128 ? 0 : 255;
      const err = oldVal - newVal;
      pixels[idx] = newVal;

      if (x + 1 < w) pixels[idx + 1] += (err * 7) / 16;
      if (y + 1 < h) {
        if (x > 0) pixels[(y + 1) * w + (x - 1)] += (err * 3) / 16;
        pixels[(y + 1) * w + x] += (err * 5) / 16;
        if (x + 1 < w) pixels[(y + 1) * w + (x + 1)] += (err * 1) / 16;
      }

      if (newVal === 0) {
        out[y * rowBytes + Math.floor(x / 8)] |= 0x80 >> (x % 8);
      }
    }
  }
  return out;
}

// ── Image buffer → 1-bit bitmap ─────────────────────────────────────────────

async function imageToBitmap(imageBuf) {
  const raw = await sharp(imageBuf)
    .resize(DISPLAY_W, DISPLAY_H, { fit: 'cover', position: 'centre' })
    .grayscale()
    .raw()
    .toBuffer();

  return ditherToBitmap(raw, DISPLAY_W, DISPLAY_H);
}

// ── Text → 1-bit bitmap (SVG overlay) ───────────────────────────────────────

async function textToBitmap(text) {
  const words = text.split(/\s+/);
  const lines = [];
  let line = '';
  for (const w of words) {
    if (line.length + w.length + 1 > 30 && line.length > 0) {
      lines.push(line);
      line = w;
    } else {
      line = line ? line + ' ' + w : w;
    }
  }
  if (line) lines.push(line);

  const fontSize = 14;
  const lineHeight = 18;
  const startY = Math.max(20, Math.floor((DISPLAY_H - lines.length * lineHeight) / 2));

  const escaped = lines.map((l) =>
    l.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
  );

  const textEls = escaped
    .map(
      (l, i) =>
        `<text x="${DISPLAY_W / 2}" y="${startY + i * lineHeight}" ` +
        `font-size="${fontSize}" font-family="monospace" text-anchor="middle" fill="black">${l}</text>`,
    )
    .join('\n');

  const svg = `<svg width="${DISPLAY_W}" height="${DISPLAY_H}" xmlns="http://www.w3.org/2000/svg">
    <rect width="${DISPLAY_W}" height="${DISPLAY_H}" fill="white"/>
    ${textEls}
  </svg>`;

  const buf = await sharp(Buffer.from(svg)).grayscale().raw().toBuffer();
  return ditherToBitmap(buf, DISPLAY_W, DISPLAY_H);
}

// ── 1-bit bitmap → PNG (for browser preview) ────────────────────────────────

async function bitmapToPng(bitmap) {
  const raw = Buffer.alloc(DISPLAY_W * DISPLAY_H);
  const rowBytes = Math.ceil(DISPLAY_W / 8);
  for (let y = 0; y < DISPLAY_H; y++) {
    for (let x = 0; x < DISPLAY_W; x++) {
      const bit = (bitmap[y * rowBytes + Math.floor(x / 8)] >> (7 - (x % 8))) & 1;
      raw[y * DISPLAY_W + x] = bit ? 0 : 255;
    }
  }
  return sharp(raw, { raw: { width: DISPLAY_W, height: DISPLAY_H, channels: 1 } })
    .png()
    .toBuffer();
}

// ── Base64 image data → 1-bit bitmap ────────────────────────────────────────

async function base64ToBitmap(base64Data) {
  const cleaned = base64Data.replace(/^data:image\/\w+;base64,/, '');
  const buf = Buffer.from(cleaned, 'base64');
  return imageToBitmap(buf);
}

module.exports = {
  DISPLAY_W,
  DISPLAY_H,
  BITMAP_BYTES,
  ditherToBitmap,
  imageToBitmap,
  textToBitmap,
  bitmapToPng,
  base64ToBitmap,
};
