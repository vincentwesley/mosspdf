// Scan clean-up before OCR: pure functions on RGBA pixels ({data,width,height}, like ImageData), no DOM.
export interface Px { data: Uint8ClampedArray; width: number; height: number }
export interface Rect { x: number; y: number; w: number; h: number }

const lum = (d: Uint8ClampedArray, i: number) => (d[i] * 77 + d[i + 1] * 150 + d[i + 2] * 29) >> 8;

/** Trims scanner-bed borders: rows and columns at the edges whose average brightness is dark. Never trims more than half the page. */
export function findPage(img: Px): Rect {
  const { data: d, width: W, height: H } = img;
  const DARK = 70;
  const rowDark = (y: number) => { let s = 0; for (let x = 0; x < W; x++) s += lum(d, (y * W + x) * 4); return s / W < DARK; };
  const colDark = (x: number, y0: number, y1: number) => { let s = 0; for (let y = y0; y < y1; y++) s += lum(d, (y * W + x) * 4); return s / (y1 - y0) < DARK; };
  let top = 0, bot = H;
  while (top < H && rowDark(top)) top++;
  while (bot > top && rowDark(bot - 1)) bot--;
  if (bot - top < H / 2) return { x: 0, y: 0, w: W, h: H };
  let left = 0, right = W;
  while (left < W && colDark(left, top, bot)) left++;
  while (right > left && colDark(right - 1, top, bot)) right--;
  if (right - left < W / 2) { left = 0; right = W; }
  const [x0, y0] = [left, top];
  return { x: x0, y: y0, w: right - x0, h: bot - y0 };
}

export function crop(img: Px, r: Rect): Px {
  const out = new Uint8ClampedArray(r.w * r.h * 4);
  for (let y = 0; y < r.h; y++) out.set(img.data.subarray(((r.y + y) * img.width + r.x) * 4, ((r.y + y) * img.width + r.x + r.w) * 4), y * r.w * 4);
  return { data: out, width: r.w, height: r.h };
}

/** Skew in degrees, clockwise positive (text running downhill to the right), -15..15. Projection profile: the angle whose row histogram of ink is the most uneven. */
export function estimateSkew(img: Px): number {
  const { data: d, width: W, height: H } = img;
  const f = Math.max(1, Math.round(Math.max(W, H) / 700)); // downscale by block averaging
  const [w, h] = [Math.floor(W / f), Math.floor(H / f)];
  const g = new Uint8Array(w * h);
  const hist = new Uint32Array(256);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0;
    for (let j = 0; j < f; j++) for (let i = 0; i < f; i++) s += lum(d, ((y * f + j) * W + x * f + i) * 4);
    hist[(g[y * w + x] = s / (f * f))]++;
  }
  // Otsu threshold
  let sumAll = 0;
  for (let t = 0; t < 256; t++) sumAll += t * hist[t];
  let wB = 0, sumB = 0, best = -1, thr = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB || wB === w * h) continue;
    sumB += t * hist[t];
    const v = wB * (w * h - wB) * (sumB / wB - (sumAll - sumB) / (w * h - wB)) ** 2;
    if (v > best) { best = v; thr = t; }
  }
  // ink only from the middle, so dark wedges left at the corners of a tilted page do not count
  const [mx, my] = [Math.round(w * 0.08), Math.round(h * 0.08)];
  const xs: number[] = [], ys: number[] = [];
  for (let y = my; y < h - my; y++) for (let x = mx; x < w - mx; x++) if (g[y * w + x] <= thr) { xs.push(x - w / 2); ys.push(y - h / 2); }
  if (xs.length < 50 || xs.length > w * h * 0.5) return 0; // blank, or a picture rather than text
  const rows = new Float64Array(h + 2 * w);
  const score = (deg: number) => {
    const t = Math.tan((deg * Math.PI) / 180);
    rows.fill(0);
    for (let k = 0; k < xs.length; k++) rows[Math.round(ys[k] - xs[k] * t + h / 2 + w)]++;
    let s = 0;
    for (let k = 0; k < rows.length; k++) s += rows[k] * rows[k];
    return s;
  };
  const search = (from: number, to: number, step: number) => {
    let top = -1, at = 0;
    for (let a = from; a <= to + 1e-9; a += step) { const s = score(a); if (s > top) { top = s; at = a; } }
    return at;
  };
  const coarse = search(-15, 15, 0.5);
  return Math.round(search(Math.max(-15, coarse - 0.5), Math.min(15, coarse + 0.5), 0.05) * 100) / 100;
}

/** Maps a point of the straightened image back to the image it came from (same centre, rotated by `deg`). */
export const unrotate = (deg: number, w: number, h: number, x: number, y: number): [number, number] => {
  const [c, s] = [Math.cos((deg * Math.PI) / 180), Math.sin((deg * Math.PI) / 180)];
  const [dx, dy] = [x - w / 2, y - h / 2];
  return [dx * c - dy * s + w / 2, dx * s + dy * c + h / 2];
};

/** Straightens a page that is skewed clockwise by `deg`: same size, bilinear, corners filled white. */
export function deskew(img: Px, deg: number): Px {
  if (!deg) return img;
  const { data: s, width: W, height: H } = img;
  const out = new Uint8ClampedArray(s.length).fill(255);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const [sx, sy] = unrotate(deg, W, H, x, y);
    const [x0, y0] = [Math.floor(sx), Math.floor(sy)];
    if (x0 < 0 || y0 < 0 || x0 >= W - 1 || y0 >= H - 1) continue;
    const [fx, fy] = [sx - x0, sy - y0];
    const o = (y * W + x) * 4, a = (y0 * W + x0) * 4;
    for (let c = 0; c < 3; c++) out[o + c] = (s[a + c] * (1 - fx) + s[a + 4 + c] * fx) * (1 - fy) + (s[a + W * 4 + c] * (1 - fx) + s[a + W * 4 + 4 + c] * fx) * fy;
  }
  return { data: out, width: W, height: H };
}

/** For OCR input only: grey, even out shadows and uneven light (paper level per 48 px block, bilinear), then stretch 1%..99% of the range. In place. */
export function enhance(img: Px): void {
  const { data: d, width: W, height: H } = img;
  const B = 48;
  const [bw, bh] = [Math.ceil(W / B), Math.ceil(H / B)];
  const g = new Uint8Array(W * H);
  for (let i = 0; i < g.length; i++) g[i] = lum(d, i * 4);
  const paper = new Float32Array(bw * bh);
  for (let by = 0; by < bh; by++) for (let bx = 0; bx < bw; bx++) {
    const [ye, xe] = [Math.min(H, by * B + B), Math.min(W, bx * B + B)];
    let s = 0, n = 0;
    for (let y = by * B; y < ye; y++) for (let x = bx * B; x < xe; x++) { s += g[y * W + x]; n++; }
    const mean = s / n;
    let t = 0, m = 0; // mean of the pixels brighter than the block mean = the paper
    for (let y = by * B; y < ye; y++) for (let x = bx * B; x < xe; x++) if (g[y * W + x] >= mean) { t += g[y * W + x]; m++; }
    paper[by * bw + bx] = Math.max(60, m ? t / m : mean); // floor: an all-ink block is not "paper"
  }
  const at = (bx: number, by: number) => paper[Math.min(bh - 1, Math.max(0, by)) * bw + Math.min(bw - 1, Math.max(0, bx))];
  const hist = new Uint32Array(256);
  for (let y = 0; y < H; y++) {
    const gy = (y - B / 2) / B, by = Math.floor(gy), fy = gy - by;
    for (let x = 0; x < W; x++) {
      const gx = (x - B / 2) / B, bx = Math.floor(gx), fx = gx - bx;
      const p = (at(bx, by) * (1 - fx) + at(bx + 1, by) * fx) * (1 - fy) + (at(bx, by + 1) * (1 - fx) + at(bx + 1, by + 1) * fx) * fy;
      hist[(g[y * W + x] = Math.min(255, (g[y * W + x] * 255) / p))]++;
    }
  }
  const n = W * H;
  let lo = 0, hi = 255, acc = 0;
  while (lo < 255 && (acc += hist[lo]) < n * 0.01) lo++;
  acc = 0;
  while (hi > 0 && (acc += hist[hi]) < n * 0.01) hi--;
  const wide = hi - lo > 16;
  for (let i = 0; i < n; i++) d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = wide ? Math.max(0, Math.min(255, ((g[i] - lo) * 255) / (hi - lo))) : g[i];
}

export interface Fixed {
  img: Px;
  /** Where a point of `img` lies on the page image that went in. */
  toOriginal(x: number, y: number): [number, number];
}

/** Crop to the page, then straighten. Either step can be off. */
export function fixPage(img: Px, o: { crop: boolean; straighten: boolean }): Fixed {
  const r = o.crop ? findPage(img) : { x: 0, y: 0, w: img.width, h: img.height };
  const cropped = r.w === img.width && r.h === img.height ? img : crop(img, r);
  const deg = o.straighten ? estimateSkew(cropped) : 0;
  const a = Math.abs(deg) >= 0.1 ? deg : 0; // tinier than that is not worth a resample
  return {
    img: a ? deskew(cropped, a) : cropped,
    toOriginal: (x, y) => { const [px, py] = a ? unrotate(a, cropped.width, cropped.height, x, y) : [x, y]; return [px + r.x, py + r.y]; },
  };
}
