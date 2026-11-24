// A scanned-looking test page: capital letters in a 5x7 pixel font, scaled up and lightly blurred, as a grey PNG.
// Self-made (CC0); used by scripts/corpus.mjs (image-only PDF) and the OCR unit test.
import { crc32, deflateSync } from "node:zlib";

const GLYPHS = {
  A: "01110 10001 10001 11111 10001 10001 10001", B: "11110 10001 10001 11110 10001 10001 11110", C: "01110 10001 10000 10000 10000 10001 01110",
  D: "11110 10001 10001 10001 10001 10001 11110", E: "11111 10000 10000 11110 10000 10000 11111", F: "11111 10000 10000 11110 10000 10000 10000",
  G: "01110 10001 10000 10111 10001 10001 01111", H: "10001 10001 10001 11111 10001 10001 10001", I: "01110 00100 00100 00100 00100 00100 01110",
  J: "00111 00010 00010 00010 00010 10010 01100", K: "10001 10010 10100 11000 10100 10010 10001", L: "10000 10000 10000 10000 10000 10000 11111",
  M: "10001 11011 10101 10101 10001 10001 10001", N: "10001 11001 10101 10011 10001 10001 10001", O: "01110 10001 10001 10001 10001 10001 01110",
  P: "11110 10001 10001 11110 10000 10000 10000", Q: "01110 10001 10001 10001 10101 10010 01101", R: "11110 10001 10001 11110 10100 10010 10001",
  S: "01111 10000 10000 01110 00001 00001 11110", T: "11111 00100 00100 00100 00100 00100 00100", U: "10001 10001 10001 10001 10001 10001 01110",
  V: "10001 10001 10001 10001 10001 01010 00100", W: "10001 10001 10001 10101 10101 11011 10001", X: "10001 10001 01010 00100 01010 10001 10001",
  Y: "10001 10001 01010 00100 00100 00100 00100", Z: "11111 00001 00010 00100 01000 10000 11111",
  0: "01110 10001 10011 10101 11001 10001 01110", 1: "00100 01100 00100 00100 00100 00100 01110", 2: "01110 10001 00001 00010 00100 01000 11111",
  3: "11110 00001 00001 01110 00001 00001 11110", 4: "00010 00110 01010 10010 11111 00010 00010", 5: "11111 10000 11110 00001 00001 10001 01110",
  6: "00110 01000 10000 11110 10001 10001 01110", 7: "11111 00001 00010 00100 01000 01000 01000", 8: "01110 10001 10001 01110 10001 10001 01110",
  9: "01110 10001 10001 01111 00001 00010 01100",
};

function boxBlur(src, w, h, r) {
  const tmp = new Float32Array(w * h), out = new Uint8Array(w * h);
  for (let j = 0; j < h; j++) { let a = 0; for (let i = -r; i < w; i++) { if (i + r < w) a += src[j * w + i + r]; if (i - r - 1 >= 0) a -= src[j * w + i - r - 1]; if (i >= 0) tmp[j * w + i] = a / (2 * r + 1); } }
  for (let i = 0; i < w; i++) { let a = 0; for (let j = -r; j < h; j++) { if (j + r < h) a += tmp[(j + r) * w + i]; if (j - r - 1 >= 0) a -= tmp[(j - r - 1) * w + i]; if (j >= 0) out[j * w + i] = Math.round(a / (2 * r + 1)); } }
  return out;
}

/** Grey pixels (255 = paper) of `lines` drawn at `scale` px per font cell on a w x h page. */
export function scanGray(lines, { w = 1240, h = 1754, scale = 7, x = 80, y = 160 } = {}) {
  const px = new Uint8Array(w * h).fill(250);
  lines.forEach((line, li) => {
    [...line].forEach((ch, ci) => {
      const rows = GLYPHS[ch]?.split(" ");
      rows?.forEach((r, ry) => [...r].forEach((bit, rx) => {
        if (bit !== "1") return;
        for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) px[(y + li * scale * 12 + ry * scale + dy) * w + x + (ci * 6 + rx) * scale + dx] = 20;
      }));
    });
  });
  // Round the blocky corners (two box blurs, then re-contrast), so it reads like printed text; then a final soft blur like a scanner.
  let cur = px;
  for (const r of [scale >> 1, scale >> 1, 1]) cur = boxBlur(cur, w, h, r);
  const out = cur.map((v) => Math.max(0, Math.min(255, (v - 135) * 2.6 + 135)));
  return { w, h, gray: out };
}

/** 8-bit greyscale PNG. */
export function grayPng({ w, h, gray }) {
  const raw = Buffer.alloc((w + 1) * h);
  for (let j = 0; j < h; j++) Buffer.from(gray.buffer, j * w, w).copy(raw, j * (w + 1) + 1);
  const chunk = (type, data) => {
    const b = Buffer.alloc(12 + data.length);
    b.writeUInt32BE(data.length, 0);
    b.write(type, 4, "latin1");
    data.copy(b, 8);
    b.writeUInt32BE(crc32(b.subarray(4, 8 + data.length)), 8 + data.length);
    return b;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // 8-bit, colour type 0 (grey)
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

export const SCAN_LINES = ["MOSSPDF OCR FIXTURE", "INVOICE 2026 TOTAL 480", "SCANNED PAGE ONE"];

/** The page tilted `deg` degrees clockwise on a dark scanner bed (`bed` px of it on every side), as {w,h,gray}; for the scan-cleanup tests. */
export function skewScan({ w, h, gray }, deg, bed = 60) {
  const [W, H] = [w + 2 * bed, h + 2 * bed];
  const out = new Uint8Array(W * H).fill(25);
  const [c, s] = [Math.cos((deg * Math.PI) / 180), Math.sin((deg * Math.PI) / 180)];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const [dx, dy] = [x - W / 2, y - H / 2];
    const [sx, sy] = [Math.round(dx * c + dy * s + w / 2), Math.round(-dx * s + dy * c + h / 2)]; // the page point that lands here
    if (sx >= 0 && sy >= 0 && sx < w && sy < h) out[y * W + x] = gray[sy * w + sx];
  }
  return { w: W, h: H, gray: out };
}
