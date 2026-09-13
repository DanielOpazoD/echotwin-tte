// Validates the speckle cell estimator of regionStats on synthetic speckle with a known PSF.
import { erode, imageStats, LABEL, type RegionImage } from '@/clinical/regionStats';
let seed = 12345;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const gauss = () => { const u = Math.max(1e-12, rnd()), v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
function speckleImage(fwhmXmm: number, fwhmYmm: number, pxMm: number, W: number, H: number, wallMm: number, wallOffset = 0): RegionImage {
  const fine = 0.08; // mm per fine sample
  const fw = Math.ceil((W * pxMm) / fine), fh = Math.ceil((H * pxMm) / fine);
  const re = new Float32Array(fw * fh).map(gauss), im = new Float32Array(fw * fh).map(gauss);
  const blur = (a: Float32Array, fwhm: number, horizontal: boolean) => {
    const s = fwhm / 2.3548 / fine, R = Math.ceil(3 * s), k: number[] = [];
    for (let j = -R; j <= R; j++) k.push(Math.exp(-(j * j) / (2 * s * s)));
    const out = new Float32Array(a.length);
    for (let y = 0; y < fh; y++) for (let x = 0; x < fw; x++) {
      let acc = 0;
      for (let j = -R; j <= R; j++) {
        const xx = horizontal ? Math.min(fw - 1, Math.max(0, x + j)) : x, yy = horizontal ? y : Math.min(fh - 1, Math.max(0, y + j));
        acc += k[j + R]! * a[yy * fw + xx]!;
      }
      out[y * fw + x] = acc;
    }
    return out;
  };
  const r2 = blur(blur(re, fwhmXmm, true), fwhmYmm, false), i2 = blur(blur(im, fwhmXmm, true), fwhmYmm, false);
  const grey = new Float32Array(W * H), labels = new Uint8Array(W * H);
  const dbs: number[] = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const fx = Math.min(fw - 1, Math.floor((x * pxMm) / fine)), fy = Math.min(fh - 1, Math.floor((y * pxMm) / fine));
    const amp = Math.hypot(r2[fy * fw + fx]!, i2[fy * fw + fx]!);
    dbs.push(20 * Math.log10(amp + 1e-9));
  }
  const top = [...dbs].sort((a, b) => a - b)[Math.floor(dbs.length * 0.99)]!;
  for (let p = 0; p < W * H; p++) grey[p] = Math.max(0, Math.min(255, (255 * (dbs[p]! - (top - 60))) / 60));
  // two vertical "walls" of wallMm width with a cavity between, like an apical LV
  const wallPx = Math.round(wallMm / pxMm), cx = W / 2;
  for (let y = 10; y < H - 10; y++) for (let x = 0; x < W; x++) {
    const d = Math.abs(x - cx);
    labels[y * W + x] = d < 40 ? LABEL.cavity : d < 40 + wallPx ? LABEL.myocardium : LABEL.background;
    if (x < cx && labels[y * W + x] === LABEL.myocardium) grey[y * W + x] = Math.max(0, Math.min(255, grey[y * W + x]! + wallOffset + 10 * (y / H)));
  }
  return { width: W, height: H, grey, labels, mmPerPx: [pxMm, pxMm] };
}

/** Masked ACF of grey residuals after removing a masked Gaussian local mean (sigma in mm); no per-run means. */
export function cellMm2(img: RegionImage, mask: Uint8Array, horizontal: boolean, detrendMm = 4): number {
  const { width: w, height: h, grey } = img;
  const px = horizontal ? img.mmPerPx[0] : img.mmPerPx[1];
  const s = detrendMm / ((img.mmPerPx[0] + img.mmPerPx[1]) / 2), R = Math.ceil(3 * s);
  const k: number[] = []; for (let j = -R; j <= R; j++) k.push(Math.exp(-(j * j) / (2 * s * s)));
  const num = new Float64Array(w * h), den = new Float64Array(w * h), t1 = new Float64Array(w * h), t2 = new Float64Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let a = 0, b = 0; for (let j = -R; j <= R; j++) { const xx = x + j; if (xx < 0 || xx >= w) continue; const m = mask[xx + y * w]!; a += k[j + R]! * m * grey[xx + y * w]!; b += k[j + R]! * m; } t1[x + y * w] = a; t2[x + y * w] = b; }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let a = 0, b = 0; for (let j = -R; j <= R; j++) { const yy = y + j; if (yy < 0 || yy >= h) continue; a += k[j + R]! * t1[x + yy * w]!; b += k[j + R]! * t2[x + yy * w]!; } num[x + y * w] = a; den[x + y * w] = b; }
  const res = new Float64Array(w * h);
  for (let i = 0; i < w * h; i++) if (mask[i] && den[i]! > 0) res[i] = grey[i]! - num[i]! / den[i]!;
  const maxLag = 16; const acf: number[] = [];
  for (let lag = 0; lag <= maxLag; lag++) {
    let sum = 0, n = 0;
    for (let y = 0; y < h - (horizontal ? 0 : lag); y++) for (let x = 0; x < w - (horizontal ? lag : 0); x++) {
      const i = x + y * w, j = horizontal ? i + lag : i + lag * w;
      if (!mask[i] || !mask[j]) continue; sum += res[i]! * res[j]!; n++;
    }
    acf.push(n ? sum / n : NaN);
  }
  for (let lag = 1; lag <= maxLag; lag++) { const a = acf[lag]! / acf[0]!, b = acf[lag - 1]! / acf[0]!; if (a <= 0.5) return 2 * (lag - 1 + (b - 0.5) / Math.max(1e-9, b - a)) * px; }
  return NaN;
}

for (const [fx, fy] of [[1.0, 0.9], [2.0, 1.0], [2.4, 2.0], [3.0, 2.0], [4.0, 1.6]])
  for (const [wall, off] of [[9, 0], [20, 0], [9, 25]]) {
    const img = speckleImage(fx, fy, 0.31, 220, 260, wall, off);
    const st = imageStats(img);
    const myo = erode(img.labels, img.width, img.height, LABEL.myocardium, 2);
    console.log(`FWHM ${fx}x${fy} mm, wall ${wall} mm, wall offset ${off} -> regionStats (new) ${st.speckleCellMm.horizontal.toFixed(2)} x ${st.speckleCellMm.vertical.toFixed(2)} | scratch detrended ${cellMm2(img, myo, true).toFixed(2)} x ${cellMm2(img, myo, false).toFixed(2)} mm`);
  }
