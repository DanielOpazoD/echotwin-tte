import { useEffect, useRef } from 'react';
import { frameBus } from '@/app/frameBus';
import { STRUCTURE_LABELS } from '@/app/review';
import { segmentLayerOn, useSegmentHover, useSimStore, useStructureHover } from '@/app/store';
import type { SimOutput } from '@/simulator/core/protocol';
import { computeSectorMapping, type SectorMapping } from '@/simulator/renderer/scanConvert';
import { nearestSampleLut, paintCutMap, placeLabels, withoutOverlaps } from './cutMap';
import { SegmentAnchors } from './segmentAnchors';
import { paintSegmentMap, segmentIds, segmentNames } from './segmentMap';
import { canvasFont } from './canvasFonts';

/**
 * Whether the interface's fonts have arrived (decision 201): the labels are placed with `measureText`, and a placement
 * measured with the fallback face before Inter loaded would stay cached until the probe moved.
 */
let fontsReady = false;
if (typeof document !== 'undefined' && 'fonts' in document)
  void document.fonts.ready.then(() => {
    fontsReady = true;
  });

/**
 * Second view of the navigator (decision 141): the imaging plane as a colour-coded map of the structures it
 * passes through, scan-converted from the structure map of the frame on screen. It is the same plane as the
 * image by construction (same beam, phase, sector, depth and left–right convention), drawn in the model's
 * colours with the names of the regions the plane cuts and a depth ruler. Hovering names the structure under
 * the cursor. With the segment layer on (decision 152) the LV myocardium is coloured and numbered by the segment of
 * the tissue the plane crosses, from the frame's segment channel; a click selects a segment, the same selection as the
 * polar map of the segment panel. The probe is driven from the torso view.
 */
export function CutMapView() {
  const ref = useRef<HTMLDivElement>(null);
  const hoverRef = useRef<HTMLDivElement>(null);
  const labels = useSimStore((s) => s.ui.navLabels);
  const segmentsOn = useSimStore(segmentLayerOn);

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
    // labels hold still while the probe rests: the mean of their places over one beat (decision 181); they used to be
    // re-placed a few times a second and followed the wall through the beat
    const segAnchors = new SegmentAnchors();
    const structAnchors = new SegmentAnchors();
    const restKey = (): string => {
      const pr = useSimStore.getState().probe;
      return [pr.u, pr.v, pr.rotationDeg, pr.tiltDeg, pr.rockDeg, pr.pressure]
        .map((v) => v.toFixed(3))
        .join(',');
    };
    // per-sample segment ids of the latest frame in the model shown (recomputed per frame and model)
    let ids: Uint8Array | null = null;
    let idsOf: SimOutput | null = null;
    let idsModel = '';
    const segmentIdsNow = (out: SimOutput): Uint8Array | null => {
      const model = useSimStore.getState().ui.segmentModel;
      if (out.segment.length !== out.structure.length) return null;
      if (idsOf !== out || idsModel !== model || !ids) {
        ids = segmentIds(out.segment, model, ids ?? undefined);
        idsOf = out;
        idsModel = model;
      }
      return ids;
    };

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
      const segIds = segmentLayerOn(st) ? segmentIdsNow(out) : null;
      const stats = segIds
        ? paintSegmentMap(
            img.data,
            lut,
            out.structure,
            segIds,
            cssW,
            st.ui.selectedSegment,
            useSegmentHover.getState().id,
          )
        : paintCutMap(img.data, lut, out.structure, cssW, useStructureHover.getState().id);
      backCtx.putImageData(img, 0, 0);
      const dpr = canvas.width / cssW;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(back, 0, 0, canvas.width, canvas.height);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      // with the segments numbered, the depth numbers carry their unit so they are not read as segments
      drawRuler(ctx, mapping, p.depthCm, segIds !== null);
      if (segIds) {
        // segment numbers: every segment in the plane gets its number, still while the probe rests (decision 181)
        ctx.font = canvasFont(12, 'ui', 700);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const segKey = `${key}|seg|${st.ui.segmentModel}|${st.caseId}|${restKey()}|${fontsReady}`;
        if (segAnchors.wants(segKey, out.frameId))
          segAnchors.add(
            segKey,
            out,
            placeLabels(
              stats,
              lut,
              segIds,
              cssW,
              Math.max(12, 0.0008 * cssW * cssH),
              (t) => ({ w: ctx.measureText(t).width, h: 13 }),
              new Set(segAnchors.view().labels.map((l) => l.id)),
              (id) => String(id),
            ),
            null,
          );
        const labelsShown = withoutOverlaps(segAnchors.view().labels, (t) => ({
          w: ctx.measureText(t).width,
          h: 13,
        }));
        ctx.lineJoin = 'round';
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.85)';
        ctx.fillStyle = '#ffffff';
        for (const l of labelsShown) {
          ctx.strokeText(l.text, l.x, l.y);
          ctx.fillText(l.text, l.x, l.y);
        }
      } else if (st.ui.navLabels) {
        ctx.font = canvasFont(11, 'ui', 600);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const structKey = `${key}|${st.caseId}|${restKey()}|${fontsReady}`;
        if (structAnchors.wants(structKey, out.frameId))
          structAnchors.add(
            structKey,
            out,
            placeLabels(
              stats,
              lut,
              out.structure,
              cssW,
              Math.max(60, 0.004 * cssW * cssH),
              (t) => ({ w: ctx.measureText(t).width, h: 12 }),
              new Set(structAnchors.view().labels.map((l) => l.id)),
            ),
            null,
          );
        const labelsShown = withoutOverlaps(structAnchors.view().labels, (t) => ({
          w: ctx.measureText(t).width,
          h: 12,
        }));
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
    const unsubHover = useSegmentHover.subscribe(schedule);
    const unsubStructHover = useStructureHover.subscribe(schedule);
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
    /** Polar sample under a mouse event (−1 outside the sector). */
    const sampleAt = (e: MouseEvent): number => {
      if (!lut) return -1;
      const r = canvas.getBoundingClientRect();
      const x = Math.floor(((e.clientX - r.left) / r.width) * cssW);
      const y = Math.floor(((e.clientY - r.top) / r.height) * cssH);
      return x >= 0 && y >= 0 && x < cssW && y < cssH ? lut[y * cssW + x]! : -1;
    };
    /** Segment id under a mouse event in the model shown, 0 when none (or the layer is off). */
    const segmentAt = (k: number): number => {
      const out = latest;
      if (!out || k < 0 || !segmentLayerOn(useSimStore.getState())) return 0;
      return segmentIdsNow(out)?.[k] ?? 0;
    };
    const onMove = (e: MouseEvent) => {
      const hover = hoverRef.current;
      if (!hover) return;
      const out = latest;
      if (!out || !lut) {
        hover.textContent = '';
        return;
      }
      const k = sampleAt(e);
      const seg = segmentAt(k);
      useSegmentHover.getState().setHover(seg > 0 ? seg : null, 'cut');
      if (seg > 0) {
        useStructureHover.getState().setHover(null);
        const n = segmentNames(seg, useSimStore.getState().ui.segmentModel);
        hover.textContent = `${seg} · ${n.es} (${n.en})`;
        return;
      }
      const id = k >= 0 ? (out.structure[k] ?? 0) : -1;
      // the structure under the pointer lights up here and is outlined on the image (decision 202); with the segment
      // layer on, the map paints segments and the structure is not lit, so the image does not outline it either
      useStructureHover
        .getState()
        .setHover(id > 0 && !segmentLayerOn(useSimStore.getState()) ? id : null);
      hover.textContent = id > 0 ? (STRUCTURE_LABELS[id] ?? '') : '';
    };
    const onClick = (e: MouseEvent) => {
      const st = useSimStore.getState();
      if (!segmentLayerOn(st)) return;
      const seg = segmentAt(sampleAt(e));
      st.setUi({ selectedSegment: seg > 0 && seg !== st.ui.selectedSegment ? seg : null });
    };
    const onLeave = () => {
      useSegmentHover.getState().setHover(null, 'cut');
      useStructureHover.getState().setHover(null);
      if (hoverRef.current) hoverRef.current.textContent = '';
    };
    canvas.addEventListener('mousemove', onMove);
    canvas.addEventListener('mouseleave', onLeave);
    canvas.addEventListener('click', onClick);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      unsubFrames();
      unsubStore();
      unsubHover();
      unsubStructHover();
      // the map can unmount with the pointer over it (split off, rail hidden): nothing fires mouseleave then
      useSegmentHover.getState().setHover(null, 'cut');
      useStructureHover.getState().setHover(null);
      ro.disconnect();
      canvas.removeEventListener('mousemove', onMove);
      canvas.removeEventListener('mouseleave', onLeave);
      canvas.removeEventListener('click', onClick);
      el.removeChild(canvas);
    };
  }, []);

  return (
    <div
      className="cut-map"
      ref={ref}
      aria-label={
        segmentsOn
          ? 'Corte ecográfico: segmentos del ventrículo izquierdo que atraviesa el plano de la imagen'
          : 'Corte ecográfico: estructuras en el plano de la imagen'
      }
    >
      <div className="torso-caption bottom">
        {segmentsOn ? 'Corte ecográfico · segmentos' : 'Corte ecográfico'}
      </div>
      <div className="cut-map-hover" ref={hoverRef} aria-live="off" />
      <div className="torso-help cut">
        {segmentsOn
          ? 'Pasar el ratón: nombre · clic: seleccionar'
          : labels
            ? 'Pasar el ratón: nombre completo'
            : 'Pasar el ratón: nombre'}
      </div>
    </div>
  );
}

/** Depth ruler down the left edge of the sector: a tick per centimetre, a number every five. */
function drawRuler(
  ctx: CanvasRenderingContext2D,
  m: SectorMapping,
  depthCm: number,
  withUnit = false,
): void {
  const half = m.sectorRad / 2;
  const ex = -Math.sin(half),
    ey = Math.cos(half);
  const ox = -Math.cos(half),
    oy = -Math.sin(half);
  ctx.strokeStyle = 'rgba(255, 200, 87, 0.85)';
  ctx.fillStyle = 'rgba(255, 200, 87, 0.9)';
  ctx.lineWidth = 1;
  ctx.font = canvasFont(10, 'mono');
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
    if (d % 5 === 0)
      ctx.fillText(withUnit ? `${d} cm` : `${d}`, x + ox * (len + 3), y + oy * (len + 3));
  }
  ctx.stroke();
}
