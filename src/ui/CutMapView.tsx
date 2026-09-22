import { useEffect, useRef } from 'react';
import { frameBus } from '@/app/frameBus';
import { STRUCTURE_LABELS } from '@/app/review';
import { useSimStore } from '@/app/store';
import type { SimOutput } from '@/simulator/core/protocol';
import { computeSectorMapping, type SectorMapping } from '@/simulator/renderer/scanConvert';
import { nearestSampleLut, paintCutMap, placeLabels, type CutMapLabel } from './cutMap';

/**
 * Second view of the navigator (decision 141): the imaging plane as a colour-coded map of the structures it
 * passes through, scan-converted from the structure map of the frame on screen. It is the same plane as the
 * image by construction (same beam, phase, sector, depth and left–right convention), drawn in the model's
 * colours with the names of the regions the plane cuts and a depth ruler. Hovering names the structure under
 * the cursor; the map takes no other input (the probe is driven from the torso view).
 */
export function CutMapView() {
  const ref = useRef<HTMLDivElement>(null);
  const hoverRef = useRef<HTMLDivElement>(null);
  const labels = useSimStore((s) => s.ui.navLabels);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const canvas = document.createElement('canvas');
    el.appendChild(canvas);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    // the map is painted at CSS resolution (one lookup per pixel) and scaled onto the device-pixel canvas;
    // ruler and labels are drawn at device resolution so the text stays crisp
    const back = document.createElement('canvas');
    const backCtx = back.getContext('2d');
    if (!backCtx) return;
    let latest: SimOutput | null = null;
    let lut: Int32Array | null = null;
    let lutKey = '';
    let mapping: SectorMapping | null = null;
    let raf = 0;
    let cssW = 0,
      cssH = 0;
    // labels are re-placed a few times a second, not per frame: regions breathe with the beat and labels
    // that jumped or blinked at 30 Hz were noise, not information
    let labelsAt = 0;
    let labelsKey = '';
    let labelsShown: CutMapLabel[] = [];

    const draw = () => {
      raf = 0;
      const out = latest;
      const p = out?.polar;
      if (!out || !p || out.structure.length !== p.lines * p.samples || cssW < 8 || cssH < 8)
        return;
      const st = useSimStore.getState();
      const invertLR = st.settings.invertLR;
      const key = `${p.lines}x${p.samples}|${p.sectorRad.toFixed(4)}|${p.depthCm}|${cssW}x${cssH}|${invertLR ? 1 : 0}|${st.settings.zoom}`;
      if (key !== lutKey || !lut || !mapping) {
        mapping = computeSectorMapping(
          { ...p, elevationSamples: 1, focusCm: 0 },
          cssW,
          cssH,
          invertLR,
          st.settings.zoom,
        );
        lut = nearestSampleLut(p, mapping);
        lutKey = key;
        back.width = cssW;
        back.height = cssH;
      }
      const img = backCtx.createImageData(cssW, cssH);
      const stats = paintCutMap(img.data, lut, out.structure, cssW);
      backCtx.putImageData(img, 0, 0);
      const dpr = canvas.width / cssW;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(back, 0, 0, canvas.width, canvas.height);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawRuler(ctx, mapping, p.depthCm);
      if (st.ui.navLabels) {
        ctx.font = '600 11px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const now = performance.now();
        if (now - labelsAt > 400 || key !== labelsKey) {
          const minPixels = Math.max(60, 0.004 * cssW * cssH);
          labelsShown = placeLabels(
            stats,
            lut,
            out.structure,
            cssW,
            minPixels,
            (t) => ({ w: ctx.measureText(t).width, h: 12 }),
            new Set(labelsShown.map((l) => l.id)),
          );
          labelsAt = now;
          labelsKey = key;
        }
        ctx.lineJoin = 'round';
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.75)';
        ctx.fillStyle = '#f4f6fa';
        for (const l of labelsShown) {
          ctx.strokeText(l.text, l.x, l.y);
          ctx.fillText(l.text, l.x, l.y);
        }
      }
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(draw);
    };
    const unsubFrames = frameBus.subscribe((out) => {
      // frames without a structure map (M-mode and spectral strips share the bus) keep the last one drawn
      if (out.structure.length === out.polar.lines * out.polar.samples) {
        latest = out;
        schedule();
      }
    });
    const unsubStore = useSimStore.subscribe(schedule);
    const resize = () => {
      cssW = el.clientWidth || 0;
      cssH = el.clientHeight || 0;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.max(1, Math.round(cssW * dpr));
      canvas.height = Math.max(1, Math.round(cssH * dpr));
      schedule();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    resize();
    const onMove = (e: MouseEvent) => {
      const hover = hoverRef.current;
      if (!hover) return;
      const out = latest;
      if (!out || !lut) {
        hover.textContent = '';
        return;
      }
      const r = canvas.getBoundingClientRect();
      const x = Math.floor(((e.clientX - r.left) / r.width) * cssW);
      const y = Math.floor(((e.clientY - r.top) / r.height) * cssH);
      const k = x >= 0 && y >= 0 && x < cssW && y < cssH ? lut[y * cssW + x]! : -1;
      const id = k >= 0 ? (out.structure[k] ?? 0) : -1;
      hover.textContent = id > 0 ? (STRUCTURE_LABELS[id] ?? '') : '';
    };
    const onLeave = () => {
      if (hoverRef.current) hoverRef.current.textContent = '';
    };
    canvas.addEventListener('mousemove', onMove);
    canvas.addEventListener('mouseleave', onLeave);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      unsubFrames();
      unsubStore();
      ro.disconnect();
      canvas.removeEventListener('mousemove', onMove);
      canvas.removeEventListener('mouseleave', onLeave);
      el.removeChild(canvas);
    };
  }, []);

  return (
    <div
      className="cut-map"
      ref={ref}
      aria-label="Corte ecográfico: estructuras en el plano de la imagen"
    >
      <div className="torso-caption bottom">Corte ecográfico · plano de la imagen</div>
      <div className="cut-map-hover" ref={hoverRef} aria-live="off" />
      <div className="torso-help cut">
        {labels
          ? 'Estructuras que atraviesa el plano de la imagen, con sus nombres · pasar el ratón: nombre completo'
          : 'Estructuras que atraviesa el plano de la imagen · pasar el ratón: nombre'}
      </div>
    </div>
  );
}

/** Depth ruler down the left edge of the sector: a tick per centimetre, a number every five. */
function drawRuler(ctx: CanvasRenderingContext2D, m: SectorMapping, depthCm: number): void {
  const half = m.sectorRad / 2;
  const ex = -Math.sin(half),
    ey = Math.cos(half);
  const ox = -Math.cos(half),
    oy = -Math.sin(half);
  ctx.strokeStyle = 'rgba(255, 200, 87, 0.85)';
  ctx.fillStyle = 'rgba(255, 200, 87, 0.9)';
  ctx.lineWidth = 1;
  ctx.font = '10px system-ui, sans-serif';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  ctx.beginPath();
  for (let d = 1; d <= depthCm; d++) {
    const len = d % 5 === 0 ? 7 : 3.5;
    const x = m.apexX + ex * d * m.pxPerCm,
      y = m.apexY + ey * d * m.pxPerCm;
    if (y > m.height) break;
    ctx.moveTo(x, y);
    ctx.lineTo(x + ox * len, y + oy * len);
    if (d % 5 === 0) ctx.fillText(`${d}`, x + ox * (len + 3), y + oy * (len + 3));
  }
  ctx.stroke();
}
