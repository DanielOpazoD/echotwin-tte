import { hasGate, isStripModality, MODALITIES } from '@/simulator/renderer/modality';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  imageSegmentsOn,
  useHudStore,
  useSegmentHover,
  useSegmentOrientation,
  useSimStore,
  useStructureHover,
  type SimStore,
} from '@/app/store';
import type { SimOutput } from '@/simulator/core/protocol';
import { cineOffsetAtX, cineOffsetOnEcg, ecgLayoutOf, ecgTracePoints, ecgX } from './ecgTrace';
import { pixelToPolar, polarToPixel, type SectorMapping } from '@/simulator/renderer/scanConvert';
import { reprojectGeometry } from '@/simulator/measurements/geometry';
import { tgcAtDepth } from '@/simulator/renderer/postprocess/consolePipeline';
import type { Measurement } from '@/simulator/measurements/types';
import { frameBus } from '@/app/frameBus';
import { ImageHud } from './ImageHud';
import { ImageQuickBar } from './ImageQuickBar';
import { discProfileFromContour, volumeFromProfileMl } from '@/simulator/measurements/simpson';
import { summarizeEnvelope } from '@/simulator/measurements/vti';
import {
  evaluateCapture,
  specFor,
  structureAtPixel,
  type CaptureExtras,
} from '@/app/measurementCapture';
import { markerLabel, structureLabel, type ReviewMarker } from '@/app/review';
import { nearestSampleLut, paintStructureOutline, placeLabels } from './cutMap';
import {
  paintSegmentOverlay,
  sampleIndexAt,
  segmentCss,
  segmentIdOf,
  segmentIds,
  segmentNames,
} from './segmentMap';
import { SegmentImageToggle } from './SegmentImageToggle';
import {
  imageUpOnPolarMap,
  rvInsertionPoints,
  SegmentAnchors,
  type RvInsertions,
} from './segmentAnchors';
import { coverageText } from './SegmentPanel';
import { canvasFont } from './canvasFonts';

/**
 * Ultrasound display: draws the composite frame from the simulator and the overlays (depth scale,
 * orientation marker, focus, TGC curve, ECG, colour box, Doppler cursor/gate, calipers). Direct
 * manipulation of box/cursor/gate/calipers happens here (spec 29.3).
 */
export interface DisplayHandle {
  pushFrame: (out: SimOutput) => void;
}

interface Pending {
  points: { x: number; y: number }[];
  captureSector?: SectorMapping;
  context?: string;
}

export function DisplayCanvas(props: { onSize: (s: { width: number; height: number }) => void }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLCanvasElement>(null);
  const ovRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ width: 640, height: 520 });
  const pendingRef = useRef<Pending>({ points: [] });
  const lastOutRef = useRef<SimOutput | null>(null);
  /** the overlay redraw of the drawing effect, so tool clicks refresh the overlay without waiting for a frame */
  const redrawOverlayRef = useRef<() => void>(() => {});
  const dragRef = useRef<{
    kind: 'box-move' | 'box-resize' | 'cursor' | 'marker' | 'cine' | 'none';
    startX: number;
    startY: number;
    box?: { t0: number; t1: number; r0: number; r1: number };
    /** review marker being dragged (decision 135) and whether it has moved */
    markerId?: string;
    moved?: boolean;
  }>({ kind: 'none', startX: 0, startY: 0 });
  const reviewMode = useSimStore((s) => s.ui.reviewMode);
  const frozen = useSimStore((s) => s.frozen);
  const armed = useSimStore((s) => s.activeTool !== 'none');
  const segTipRef = useRef<HTMLDivElement>(null);
  const onSize = props.onSize;

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      const width = Math.max(320, Math.min(1024, Math.round(r.width)));
      const height = Math.max(240, Math.min(820, Math.round(r.height)));
      setSize({ width, height });
      onSize({ width, height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [onSize]);

  // Imperative drawing: image on every frame, overlay on every frame and on relevant store changes.
  useEffect(() => {
    const drawImage = (out: SimOutput) => {
      const canvas = imgRef.current;
      if (!canvas) return;
      if (canvas.width !== out.width || canvas.height !== out.height) {
        canvas.width = out.width;
        canvas.height = out.height;
      }
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      if (out.bitmap) {
        // formed on the GPU (decision 54): a texture copy, then release the bitmap's GPU memory
        ctx.drawImage(out.bitmap, 0, 0);
        out.bitmap.close();
      } else
        ctx.putImageData(
          new ImageData(new Uint8ClampedArray(out.rgba), out.width, out.height),
          0,
          0,
        );
    };
    const redrawOverlay = () => {
      const out = lastOutRef.current;
      const canvas = ovRef.current;
      if (!out || !canvas) return;
      const state = useSimStore.getState();
      // the ↔ of the ECG strip goes with the scrub: live again, a tool or review mode, before the pointer moves
      if (
        canvas.style.cursor &&
        (!out.frozen || state.activeTool !== 'none' || state.ui.reviewMode)
      )
        canvas.style.cursor = '';
      const pending = pendingRef.current;
      const context = [
        state.caseId,
        state.modality,
        state.activeTool,
        state.activeMeasurementId ?? '',
      ].join('|');
      if (pending.context !== context) {
        pending.points = [];
        pending.captureSector = undefined;
        pending.context = context;
      }
      drawOverlay(
        canvas,
        out,
        state,
        reprojectGeometry(pending.points, pending.captureSector, out.sector),
      );
    };
    const unsubFrame = frameBus.subscribe((out) => {
      const t0 = performance.now();
      drawImage(out);
      const t1 = performance.now();
      frameBus.latest = null;
      frameBus.recycle(out.rgba);
      lastOutRef.current = out;
      redrawOverlay();
      frameBus.diag.drawMs = t1 - t0;
      frameBus.diag.overlayMs = performance.now() - t1;
      frameBus.diag.frames++;
    });
    redrawOverlayRef.current = redrawOverlay;
    const unsubStore = useSimStore.subscribe(redrawOverlay);
    // the segment under the pointer in another view (cut map, 3D heart, polar map) is highlighted here too
    const unsubHover = useSegmentHover.subscribe(redrawOverlay);
    // the structure under the pointer on the cut map is outlined here (decision 202)
    const unsubStructHover = useStructureHover.subscribe(redrawOverlay);
    return () => {
      unsubFrame();
      unsubStore();
      unsubHover();
      unsubStructHover();
    };
  }, []);

  const toLocal = useCallback((e: React.MouseEvent): { x: number; y: number } => {
    const r = ovRef.current!.getBoundingClientRect();
    const out = lastOutRef.current;
    const sx = (out?.width ?? r.width) / r.width;
    const sy = (out?.height ?? r.height) / r.height;
    return { x: (e.clientX - r.left) * sx, y: (e.clientY - r.top) * sy };
  }, []);

  const onMouseDown = (e: React.MouseEvent) => {
    const hud = lastOutRef.current;
    if (!hud) return;
    const p = toLocal(e);
    const st = useSimStore.getState();
    const m = hud.sector;
    const inSector = p.y < m.height;
    // review mode (decision 134): a plain click marks the image, a click on a marker selects it and drags it
    // (decision 135); Shift keeps the ordinary behaviour
    if (st.ui.reviewMode && st.activeTool === 'none' && !e.shiftKey) {
      const hit = markerAt(p, hud, st.reviewMarkers);
      if (hit) {
        st.selectReviewMarker(hit.id);
        dragRef.current = {
          kind: 'marker',
          startX: p.x,
          startY: p.y,
          markerId: hit.id,
          moved: false,
        };
      } else {
        // Alt+click with a marker selected, or the armed «+ secundario», links the new point to that primary
        const sel = st.reviewMarkers.find((x) => x.id === st.reviewSelectedId);
        const parent = st.reviewLinkParentId ?? (e.altKey && sel ? (sel.parentId ?? sel.id) : null);
        placeReviewMarker(p, hud, parent);
      }
      return;
    }
    if (st.activeTool !== 'none') {
      handleToolClick(p, e.detail);
      return;
    }
    // frozen, a press on the ECG strip picks the cine frame at that instant and a drag scrubs (decision 190)
    const cineOffset = cineOffsetOnEcg(p, hud, st);
    if (cineOffset !== null) {
      st.setCineOffset(cineOffset);
      dragRef.current = { kind: 'cine', startX: p.x, startY: p.y };
      return;
    }
    if (st.modality === 'color' && inSector) {
      const { rCm, thetaRad } = pixelToPolar(m, p.x, p.y);
      const c = st.color;
      const inside =
        rCm >= c.boxRMinCm &&
        rCm <= c.boxRMaxCm &&
        thetaRad >= c.boxThetaMinRad &&
        thetaRad <= c.boxThetaMaxRad;
      dragRef.current = {
        kind: inside && !e.shiftKey ? 'box-move' : 'box-resize',
        startX: p.x,
        startY: p.y,
        box: { t0: c.boxThetaMinRad, t1: c.boxThetaMaxRad, r0: c.boxRMinCm, r1: c.boxRMaxCm },
      };
      if (!inside && !e.shiftKey) {
        // start a new box centred on the click
        st.setColor({
          boxThetaMinRad: thetaRad - 0.25,
          boxThetaMaxRad: thetaRad + 0.25,
          boxRMinCm: Math.max(0.5, rCm - 3),
          boxRMaxCm: Math.min(m.depthCm, rCm + 3),
        });
        dragRef.current.kind = 'none';
      }
      return;
    }
    if (isStripModality(st.modality) && inSector) {
      const { rCm, thetaRad } = pixelToPolar(m, p.x, p.y);
      st.setCursor(
        Math.max(-m.sectorRad / 2, Math.min(m.sectorRad / 2, thetaRad)),
        hasGate(st.modality) ? Math.max(1, Math.min(m.depthCm - 0.5, rCm)) : undefined,
      );
      dragRef.current = { kind: 'cursor', startX: p.x, startY: p.y };
    }
  };
  /** Name of the LV segment under the pointer, when the image shows the segments (decision 153). */
  const updateSegmentTip = (e: React.MouseEvent | null) => {
    const tip = segTipRef.current;
    const hud = lastOutRef.current;
    const st = useSimStore.getState();
    const hide = () => {
      if (tip) tip.style.display = 'none';
      useSegmentHover.getState().setHover(null, 'image');
    };
    if (!e || !tip || !hud || !imageSegmentsOn(st)) return hide();
    const p = toLocal(e);
    const m = hud.sector;
    const p0 = hud.polar;
    if (p.y >= m.height || hud.segment.length !== p0.lines * p0.samples) return hide();
    const k = sampleIndexAt(p0, m, p.x, p.y);
    const id = k >= 0 ? segmentIdOf(hud.segment[k] ?? 0, st.ui.segmentModel) : 0;
    if (id <= 0) return hide();
    const names = segmentNames(id, st.ui.segmentModel);
    const view = hud.view?.segments;
    const cov = (st.ui.segmentModel === 'LV_AHA17' ? view?.aha17 : view?.lv16)?.find(
      (c) => c.segmentId === id,
    );
    const swatch = tip.children[0] as HTMLElement;
    const title = tip.children[1] as HTMLElement;
    const sub = tip.children[2] as HTMLElement;
    swatch.style.background = segmentCss(id);
    title.textContent = `${id} · ${names.es}`;
    sub.textContent = `${names.en} · ${coverageText(cov)}`;
    const wrap = wrapRef.current!.getBoundingClientRect();
    const x = e.clientX - wrap.left,
      y = e.clientY - wrap.top;
    tip.style.display = 'grid';
    // beside the pointer, flipped to its left near the right edge of the image
    const left = x + 16 + 260 > wrap.width ? x - 16 - tip.offsetWidth : x + 16;
    tip.style.left = `${Math.max(4, left)}px`;
    tip.style.top = `${Math.max(4, y + 14)}px`;
    useSegmentHover.getState().setHover(id, 'image');
  };
  const onMouseMove = (e: React.MouseEvent) => {
    const hud = lastOutRef.current;
    if (dragRef.current.kind === 'none') {
      updateSegmentTip(e);
      // the strip says it can be scrubbed; an armed tool keeps its crosshair from the stylesheet
      if (hud && ovRef.current)
        ovRef.current.style.cursor =
          cineOffsetOnEcg(toLocal(e), hud, useSimStore.getState()) !== null ? 'ew-resize' : '';
      return;
    }
    if (!hud) return;
    const p = toLocal(e);
    const st = useSimStore.getState();
    const m = hud.sector;
    if (dragRef.current.kind === 'cine') {
      const layout = ecgLayoutOf(hud, st.modality);
      st.setCineOffset(cineOffsetAtX(p.x, layout, hud.cineWindow, hud.cineLength));
      return;
    }
    if (dragRef.current.kind === 'marker') {
      const f = fieldsAt(p, hud);
      if (f && dragRef.current.markerId) {
        st.updateReviewMarker(dragRef.current.markerId, { ...f, point: null });
        dragRef.current.moved = true;
      }
      return;
    }
    if (dragRef.current.kind === 'cursor') {
      const { rCm, thetaRad } = pixelToPolar(m, p.x, Math.min(p.y, m.height - 1));
      st.setCursor(
        Math.max(-m.sectorRad / 2, Math.min(m.sectorRad / 2, thetaRad)),
        hasGate(st.modality) ? Math.max(1, Math.min(m.depthCm - 0.5, rCm)) : undefined,
      );
    } else if (dragRef.current.kind === 'box-move' && dragRef.current.box) {
      const a = pixelToPolar(m, dragRef.current.startX, dragRef.current.startY);
      const b = pixelToPolar(m, p.x, p.y);
      const dt = b.thetaRad - a.thetaRad,
        dr = b.rCm - a.rCm;
      const bx = dragRef.current.box;
      st.setColor({
        boxThetaMinRad: bx.t0 + dt,
        boxThetaMaxRad: bx.t1 + dt,
        boxRMinCm: Math.max(0.5, bx.r0 + dr),
        boxRMaxCm: Math.min(m.depthCm, bx.r1 + dr),
      });
    } else if (dragRef.current.kind === 'box-resize' && dragRef.current.box) {
      const b = pixelToPolar(m, p.x, p.y);
      const bx = dragRef.current.box;
      st.setColor({
        boxThetaMaxRad: Math.max(bx.t0 + 0.08, b.thetaRad),
        boxRMaxCm: Math.max(bx.r0 + 1, Math.min(m.depthCm, b.rCm)),
      });
    }
  };
  const onMouseUp = () => {
    const d = dragRef.current;
    if (d.kind === 'marker' && d.moved && d.markerId) {
      // moved: ask the worker again for what lies under the new position
      const mk = useSimStore.getState().reviewMarkers.find((m) => m.id === d.markerId);
      if (mk) askWorker(mk.id, mk.rCm, mk.thetaRad);
    }
    dragRef.current = { kind: 'none', startX: 0, startY: 0 };
  };

  /** The fields of a marker that depend on where a display point lies: sector (polar, structure) or strip. */
  const fieldsAt = (
    p: { x: number; y: number },
    hud: SimOutput,
  ): Pick<
    ReviewMarker,
    'x' | 'y' | 'captureSector' | 'rCm' | 'thetaRad' | 'strip' | 'structure'
  > | null => {
    const m = hud.sector;
    const strip = hud.strip;
    const inSector = p.y < m.height;
    const onStrip = !inSector && strip.kind !== null && p.y >= strip.y;
    if (!inSector && !onStrip) return null;
    const polar = inSector ? pixelToPolar(m, p.x, p.y) : null;
    if (polar && (polar.rCm > m.depthCm || Math.abs(polar.thetaRad) > m.sectorRad / 2)) return null;
    return {
      x: p.x,
      y: p.y,
      captureSector: { ...m },
      rCm: polar ? polar.rCm : null,
      thetaRad: polar ? polar.thetaRad : null,
      strip:
        onStrip && strip.kind
          ? {
              kind: strip.kind,
              column: p.x - strip.x,
              value:
                strip.topValue +
                ((p.y - strip.y) / strip.height) * (strip.bottomValue - strip.topValue),
            }
          : null,
      structure: inSector ? structureAtPixel(hud, p.x, p.y) : 0,
    };
  };
  /** The worker's classification of a marker's point (the coordinates the anatomy code reasons in). */
  const askWorker = (id: string, rCm: number | null, thetaRad: number | null) => {
    if (rCm === null || thetaRad === null) return;
    void frameBus
      .request({ kind: 'probePoint', rCm, thetaRad })
      .then((res) => {
        if (res && res.kind === 'probePoint')
          useSimStore.getState().updateReviewMarker(id, { point: res.point });
      })
      .catch((e: unknown) => {
        console.warn('probe point request failed', e instanceof Error ? e.message : e);
      });
  };
  /** A numbered marker where the click fell, with the structure the frame's own map holds there. */
  const placeReviewMarker = (
    p: { x: number; y: number },
    hud: SimOutput,
    parentId: string | null = null,
  ) => {
    const st = useSimStore.getState();
    const f = fieldsAt(p, hud);
    if (!f) return;
    const id = `r${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
    const parent = parentId ? st.reviewMarkers.find((x) => x.id === parentId) : undefined;
    st.addReviewMarker({
      id,
      n: 0,
      parentId: parent ? parent.id : null,
      space: 'image',
      torso: null,
      group: null,
      ...f,
      frameId: hud.frameId,
      phase: hud.phase,
      modality: st.modality,
      point: null,
      note: '',
      category: parent ? parent.category : 'anatomia',
    });
    askWorker(id, f.rCm, f.thetaRad);
  };
  /** The image marker under a display point (within 12 px), if any. */
  const markerAt = (
    p: { x: number; y: number },
    hud: SimOutput,
    markers: ReviewMarker[],
  ): ReviewMarker | null => {
    for (const mk of markers) {
      if (mk.space !== 'image') continue;
      const q = markerScreenPosition(mk, hud.sector);
      if (Math.hypot(q.x - p.x, q.y - p.y) <= 12) return mk;
    }
    return null;
  };

  const handleToolClick = (p: { x: number; y: number }, detail: number) => {
    const hud = lastOutRef.current;
    if (!hud) return;
    const st = useSimStore.getState();
    const m = hud.sector;
    const strip = hud.strip;
    const pend = pendingRef.current;
    const sectorTool = st.activeTool === 'caliper' || st.activeTool === 'simpson';
    if (sectorTool) {
      pend.points = reprojectGeometry(pend.points, pend.captureSector, m);
      pend.captureSector = { ...m };
    } else pend.captureSector = undefined;
    const spec = specFor(st.activeMeasurementId);
    const modality = st.modality === 'color' ? '2d' : st.modality;
    const redraw = () => {
      redrawOverlayRef.current();
      useHudStore.getState().setHud({ ...hud });
    };
    const commit = (
      ms: Omit<
        Measurement,
        | 'id'
        | 'createdAt'
        | 'frameId'
        | 'phase'
        | 'timeS'
        | 'sourceViewId'
        | 'viewScore'
        | 'imageQualityScore'
        | 'userAssisted'
        | 'referenceGuidelineIds'
        | 'measurementId'
        | 'technique'
      >,
      extras: CaptureExtras = {},
    ) => {
      // pending points go before the store update: the store subscription redraws the overlay synchronously, and
      // with the points still pending their cyan crosses covered the measurement's yellow ones until the next frozen
      // frame (80 ms), which the caliper E2E read as a crosshair drawn elsewhere
      pend.points = [];
      st.addMeasurement({
        ...ms,
        captureSector: sectorTool ? { ...m } : undefined,
        label: spec ? spec.label : ms.label,
        measurementId: spec ? spec.id : null,
        technique: evaluateCapture(spec, hud, modality, st.phaseMarks, extras),
        id: `m${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`,
        createdAt: new Date().toISOString(),
        frameId: hud.frameId,
        phase: hud.phase,
        timeS: hud.timeS,
        sourceViewId: hud.view?.bestViewId ?? null,
        viewScore: hud.view?.score ?? null,
        imageQualityScore: hud.view ? Math.round(hud.view.components.gain * 100) : null,
        userAssisted: extras.userAssisted ?? false,
        referenceGuidelineIds: spec ? spec.referenceIds : ['ase-tte-2019'],
      });
      if (spec) st.setActiveMeasurement(null);
    };
    const stripVelocity = (y: number) =>
      strip.topValue + ((y - strip.y) / strip.height) * (strip.bottomValue - strip.topValue);
    const velocityUnits = MODALITIES[modality].velocityUnits;
    const velocityScale = velocityUnits === 'cm/s' ? 100 : 1;
    if (st.activeTool === 'caliper') {
      if (p.y >= m.height) return;
      pend.points.push(p);
      if (pend.points.length === 2) {
        const [a, b] = pend.points as [{ x: number; y: number }, { x: number; y: number }];
        const cm = Math.hypot(a.x - b.x, a.y - b.y) / m.pxPerCm;
        commit(
          {
            kind: 'linear',
            label: 'Distancia',
            value: cm,
            units: 'cm',
            modality,
            geometry: [a, b],
          },
          { segment: [a, b] },
        );
      }
      redraw();
      return;
    }
    if (st.activeTool === 'velocity') {
      if (strip.kind !== 'spectral' || p.y < strip.y) return;
      const v = Math.abs(stripVelocity(p.y));
      commit({
        kind: 'velocity',
        label: 'Velocidad',
        value: v * velocityScale,
        units: velocityUnits,
        modality,
        geometry: [p],
        derived: { gradientMmHg: 4 * v * v },
      });
      return;
    }
    if (st.activeTool === 'time') {
      if (strip.kind === null || p.y < strip.y) return;
      pend.points.push(p);
      if (pend.points.length === 2) {
        const [a, b] = pend.points as [{ x: number; y: number }, { x: number; y: number }];
        const ms = Math.abs(a.x - b.x) * strip.secondsPerColumn * 1000;
        commit({
          kind: 'time',
          label: 'Tiempo',
          value: ms,
          units: 'ms',
          modality,
          geometry: [a, b],
        });
      }
      redraw();
      return;
    }
    if (st.activeTool === 'slope') {
      // deceleration time: first click on the peak, second on the slope; extrapolated to the baseline
      if (strip.kind !== 'spectral' || p.y < strip.y) return;
      pend.points.push(p);
      if (pend.points.length === 2) {
        const [a, b] = pend.points as [{ x: number; y: number }, { x: number; y: number }];
        const v0 = Math.abs(stripVelocity(a.y)),
          v1 = Math.abs(stripVelocity(b.y));
        const t0 = a.x * strip.secondsPerColumn,
          t1 = b.x * strip.secondsPerColumn;
        if (v0 > v1 && t1 > t0) {
          const tInt = t1 + (v1 * (t1 - t0)) / (v0 - v1);
          const yBase =
            strip.y + ((0 - strip.topValue) / (strip.bottomValue - strip.topValue)) * strip.height;
          const intercept = { x: tInt / strip.secondsPerColumn, y: yBase };
          commit({
            kind: 'time',
            label: 'Tiempo de desaceleración',
            value: (tInt - t0) * 1000,
            units: 'ms',
            modality,
            geometry: [a, b, intercept],
            derived: { peakMps: v0 },
          });
        } else pend.points = [];
      }
      redraw();
      return;
    }
    if (st.activeTool === 'tapse') {
      if (strip.kind !== 'm-mode' || p.y < strip.y) return;
      pend.points.push(p);
      if (pend.points.length === 2) {
        const [a, b] = pend.points as [{ x: number; y: number }, { x: number; y: number }];
        const cm =
          (Math.abs(a.y - b.y) / strip.height) * Math.abs(strip.bottomValue - strip.topValue);
        commit({
          kind: 'linear',
          label: 'Excursión (modo M)',
          value: cm,
          units: 'cm',
          modality,
          geometry: [a, b],
        });
      }
      redraw();
      return;
    }
    if (st.activeTool === 'simpson') {
      if (p.y >= m.height) return;
      if (detail >= 2 && pend.points.length >= 5) {
        const pts = [...pend.points];
        const prof = discProfileFromContour(pts, m.pxPerCm);
        if (prof) {
          const vol = volumeFromProfileMl(prof);
          // the foreshortening check compares against the LV length: an atrial trace has none (decision 180)
          const trueL =
            st.lvLengthCm !== null && spec?.id !== 'la-volume'
              ? spec?.phase === 'es'
                ? st.lvLengthCm - 1.2
                : st.lvLengthCm
              : null;
          commit(
            {
              kind: 'volume',
              label: 'Volumen VI (Simpson monoplano)',
              value: vol,
              units: 'mL',
              modality,
              geometry: pts,
              derived: { longAxisCm: prof.longAxisCm, discs: prof.diametersCm.length },
            },
            { contour: pts, longAxisCm: prof.longAxisCm, trueLongAxisCm: trueL },
          );
        } else pend.points = [];
        redraw();
        return;
      }
      pend.points.push(p);
      redraw();
      return;
    }
    if (st.activeTool === 'auto-vti') {
      if (strip.kind !== 'spectral' || p.y < strip.y) return;
      pend.points.push(p);
      if (pend.points.length === 2) {
        const [a, b] = pend.points as [{ x: number; y: number }, { x: number; y: number }];
        pend.points = [];
        const x0 = Math.min(a.x, b.x),
          x1 = Math.max(a.x, b.x);
        void frameBus
          .request({
            kind: 'autoTrace',
            x0: Math.round(x0 - strip.x),
            x1: Math.round(x1 - strip.x),
          })
          .then((res) => {
            if (!res || res.kind !== 'autoTrace' || res.velocitiesMps.length < 2) return;
            const s = summarizeEnvelope(res.velocitiesMps, res.secondsPerColumn);
            const geometry = res.velocitiesMps.map((v, i) => ({
              x: strip.x + res.x0 + i,
              y:
                strip.y +
                ((v - strip.topValue) / (strip.bottomValue - strip.topValue)) * strip.height,
            }));
            commit(
              {
                kind: 'vti',
                label: 'VTI (envolvente automática)',
                value: s.vtiCm,
                units: 'cm',
                modality,
                geometry,
                derived: {
                  vmaxMps: s.vmaxMps,
                  meanGradientMmHg: s.meanGradientMmHg,
                  peakGradientMmHg: s.peakGradientMmHg,
                },
              },
              { userAssisted: true },
            );
            redraw();
          })
          .catch((e: unknown) => {
            // a dead or reloaded worker rejects (client.ts): the measurement is simply not taken
            console.warn('auto-trace request failed', e instanceof Error ? e.message : e);
          });
      }
      redraw();
      return;
    }
    if (st.activeTool === 'vti') {
      if (strip.kind !== 'spectral' || p.y < strip.y) return;
      if (detail >= 2 && pend.points.length >= 2) {
        const pts = [...pend.points].sort((a, b) => a.x - b.x);
        // resample envelope per column
        const vel: number[] = [];
        const x0 = pts[0]!.x,
          x1 = pts[pts.length - 1]!.x;
        for (let x = x0; x <= x1; x += 1) {
          let i = 0;
          while (i < pts.length - 2 && pts[i + 1]!.x < x) i++;
          const a = pts[i]!,
            b = pts[i + 1]!;
          const t = b.x === a.x ? 0 : (x - a.x) / (b.x - a.x);
          const y = a.y + (b.y - a.y) * t;
          vel.push(Math.abs(stripVelocity(y)));
        }
        const s = summarizeEnvelope(vel, strip.secondsPerColumn);
        commit({
          kind: 'vti',
          label: 'VTI',
          value: s.vtiCm,
          units: 'cm',
          modality,
          geometry: pts,
          derived: {
            vmaxMps: s.vmaxMps,
            meanGradientMmHg: s.meanGradientMmHg,
            peakGradientMmHg: s.peakGradientMmHg,
          },
        });
        return;
      }
      pend.points.push(p);
      redraw();
    }
  };

  return (
    <div className={`display-wrap${frozen ? ' frozen' : ''}`} ref={wrapRef}>
      <canvas
        ref={imgRef}
        width={size.width}
        height={size.height}
        aria-label="Imagen ecográfica simulada"
      />
      <canvas
        ref={ovRef}
        className={`overlay${reviewMode ? ' review' : ''}${armed ? ' armed' : ''}`}
        style={{ width: '100%', height: '100%' }}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={() => {
          onMouseUp();
          updateSegmentTip(null);
        }}
        aria-label="Superposiciones y herramientas de medición"
      />
      <ImageHud />
      <SegmentImageToggle />
      <ImageQuickBar />
      <div className="seg-tip" ref={segTipRef} role="status" aria-live="polite">
        <i className="seg-tip-swatch" />
        <b />
        <span />
      </div>
    </div>
  );
}

function drawOverlay(
  canvas: HTMLCanvasElement,
  hud: SimOutput,
  st: SimStore,
  pending: { x: number; y: number }[],
): void {
  const {
    modality,
    color,
    settings,
    cursorThetaRad: cursorTheta,
    gateDepthCm: gateDepth,
    spectral,
    ui,
    activeTool,
    measurements,
    reviewMarkers,
  } = st;
  const dpr = window.devicePixelRatio || 1;
  const W = hud.width,
    H = hud.height;
  if (canvas.width !== W * dpr || canvas.height !== H * dpr) {
    canvas.width = W * dpr;
    canvas.height = H * dpr;
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  if (imageSegmentsOn(st)) drawSegmentLayer(ctx, hud, st);
  else useSegmentOrientation.getState().set(null, false);
  drawStructureOutline(ctx, hud);
  const m = hud.sector;
  ctx.font = canvasFont(11);
  ctx.textBaseline = 'middle';
  const sectorH = m.height;
  const half = m.sectorRad / 2;
  const rightX = Math.min(W - 6, m.apexX + m.depthCm * m.pxPerCm * Math.sin(half) + 10);
  ctx.strokeStyle = '#9aa4b5';
  ctx.fillStyle = '#9aa4b5';
  ctx.lineWidth = 1;
  // the depth scale as on a scanner (decision 200): a tick every centimetre, a longer one with its figure every five
  // when the width limits the sector its edge is 14 px from the canvas edge: the scale then grows inwards and the
  // figures sit left of the ticks, otherwise both fell off the canvas (decision 201)
  const inward = rightX + 24 > W;
  const dir = inward ? -1 : 1;
  ctx.font = canvasFont(10, 'mono');
  ctx.textAlign = inward ? 'right' : 'left';
  for (let d = 1; d <= m.depthCm + 1e-6; d += 1) {
    const y = m.apexY + d * m.pxPerCm;
    if (y > sectorH - 2) break;
    const major = d % 5 === 0;
    ctx.beginPath();
    ctx.moveTo(rightX, y);
    ctx.lineTo(rightX + dir * (major ? 8 : 4), y);
    ctx.stroke();
    if (major) ctx.fillText(String(d), rightX + dir * 11, y);
  }
  ctx.textAlign = 'left';
  ctx.font = canvasFont(11);
  const fy = m.apexY + settings.focusCm * m.pxPerCm;
  if (fy < sectorH) {
    ctx.fillStyle = '#ffc857';
    ctx.beginPath();
    ctx.moveTo(rightX - 2, fy);
    ctx.lineTo(rightX - 8, fy - 4);
    ctx.lineTo(rightX - 8, fy + 4);
    ctx.closePath();
    ctx.fill();
  }
  ctx.fillStyle = '#5cc8ff';
  ctx.beginPath();
  ctx.arc(m.apexX + 16, m.apexY + 4, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#9aa4b5';
  ctx.fillText('R', m.apexX + 24, m.apexY + 4);
  ctx.strokeStyle = 'rgba(92,200,255,0.5)';
  ctx.beginPath();
  for (let i = 0; i <= 20; i++) {
    const d = (i / 20) * m.depthCm;
    const y = m.apexY + d * m.pxPerCm;
    const db = tgcAtDepth(settings, d);
    const x = 14 + (db / 15) * 10;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
  if (modality === 'color') {
    drawArcBox(
      ctx,
      m,
      color.boxThetaMinRad,
      color.boxThetaMaxRad,
      color.boxRMinCm,
      color.boxRMaxCm,
      '#57d38c',
    );
    // below the telemetry the HUD prints in the top-right corner (two lines, ~60 px), clear of the focus marker
    const bx = W - 30,
      by = Math.max(m.apexY + 20, 76),
      bh = 90;
    const grad = ctx.createLinearGradient(0, by, 0, by + bh);
    grad.addColorStop(0, '#ffd23c');
    grad.addColorStop(0.45, '#c81e1e');
    grad.addColorStop(0.5, '#000');
    grad.addColorStop(0.55, '#1e3cc8');
    grad.addColorStop(1, '#3ce0ff');
    ctx.fillStyle = grad;
    ctx.fillRect(bx, by, 8, bh);
    ctx.fillStyle = '#b9c3d0';
    ctx.font = canvasFont(10, 'mono');
    ctx.textAlign = 'right';
    ctx.fillText(`+${color.scaleMps.toFixed(2)}`, bx - 5, by + 7);
    ctx.fillText(`−${color.scaleMps.toFixed(2)}`, bx - 5, by + bh);
    ctx.fillStyle = '#7f8a9a';
    ctx.font = canvasFont(9.5);
    ctx.fillText('hacia', bx - 5, by + bh / 2 - 6);
    ctx.fillText('desde', bx - 5, by + bh / 2 + 12);
    ctx.textAlign = 'left';
    ctx.font = canvasFont(11);
  }
  if (isStripModality(modality)) {
    const p0 = polarToPixel(m, 0.3, cursorTheta);
    const p1 = polarToPixel(m, m.depthCm, cursorTheta);
    ctx.strokeStyle = MODALITIES[modality].strip === 'm-mode' ? '#5cc8ff' : '#ffc857';
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(p0.x, p0.y);
    ctx.lineTo(p1.x, p1.y);
    ctx.stroke();
    ctx.setLineDash([]);
    if (hasGate(modality)) {
      const g0 = polarToPixel(m, gateDepth - spectral.gateLengthCm / 2, cursorTheta);
      const g1 = polarToPixel(m, gateDepth + spectral.gateLengthCm / 2, cursorTheta);
      ctx.strokeStyle = '#ffc857';
      ctx.lineWidth = 2;
      const nx = -(g1.y - g0.y),
        ny = g1.x - g0.x;
      const nl = Math.hypot(nx, ny) || 1;
      for (const g of [g0, g1]) {
        ctx.beginPath();
        ctx.moveTo(g.x - (nx / nl) * 6, g.y - (ny / nl) * 6);
        ctx.lineTo(g.x + (nx / nl) * 6, g.y + (ny / nl) * 6);
        ctx.stroke();
      }
      ctx.lineWidth = 1;
    }
    const strip = hud.strip;
    if (strip.kind === 'spectral') {
      ctx.fillStyle = '#9aa4b5';
      ctx.textAlign = 'right';
      const n = 4;
      for (let i = 0; i <= n; i++) {
        const v = strip.topValue + ((strip.bottomValue - strip.topValue) * i) / n;
        const y = strip.y + (strip.height * i) / n;
        ctx.fillText(`${v.toFixed(2)}`, W - 4, Math.min(H - 8, Math.max(strip.y + 6, y)));
      }
      ctx.textAlign = 'left';
      ctx.fillText(
        `${modality.toUpperCase()}  ${spectral.sweepSpeedMmPerS} mm/s  escala ±${spectral.scaleMps.toFixed(2)} m/s  WF ${Math.round(spectral.wallFilterMps * 100)} cm/s`,
        6,
        strip.y + 8,
      );
      const cols1s = strip.secondsPerColumn > 0 ? 1 / strip.secondsPerColumn : 0;
      if (cols1s > 0) {
        ctx.strokeStyle = 'rgba(154,164,181,0.35)';
        for (let x = 0; x < strip.width; x += cols1s) {
          ctx.beginPath();
          ctx.moveTo(strip.x + x, strip.y + strip.height - 8);
          ctx.lineTo(strip.x + x, strip.y + strip.height);
          ctx.stroke();
        }
      }
    } else if (strip.kind === 'm-mode') {
      ctx.fillStyle = '#9aa4b5';
      ctx.textAlign = 'right';
      for (let d = 0; d <= strip.bottomValue; d += 5) {
        const y = strip.y + (d / strip.bottomValue) * strip.height;
        ctx.fillText(`${d}`, W - 4, Math.min(H - 8, Math.max(strip.y + 6, y)));
      }
      ctx.textAlign = 'left';
      ctx.fillText(`M-MODE  ${spectral.sweepSpeedMmPerS} mm/s`, 6, strip.y + 8);
    }
  }
  if (ui.showPhysics) {
    ctx.strokeStyle = 'rgba(92,200,255,0.25)';
    const lines = Number(hud.stats['lines'] ?? 0);
    const n = Math.max(8, Math.min(48, Math.round(lines / 4)));
    for (let i = 0; i <= n; i++) {
      const th = -half + (m.sectorRad * i) / n;
      const p1 = polarToPixel(m, m.depthCm, th);
      ctx.beginPath();
      ctx.moveTo(m.apexX, m.apexY);
      ctx.lineTo(p1.x, p1.y);
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(255,200,87,0.6)';
    drawArc(ctx, m, settings.focusCm - 1.5, -half, half);
    drawArc(ctx, m, settings.focusCm + 1.5, -half, half);
    ctx.fillStyle = '#ffc857';
    ctx.fillText('zona focal', m.apexX - 30, m.apexY + (settings.focusCm + 2.2) * m.pxPerCm);
  }
  if (ui.showEcg && hud.ecg.length > 3) {
    const layout = ecgLayoutOf(hud, modality);
    const { y: ey, height: eh } = layout;
    if (hud.frozen) {
      // the cine buffer as a band on the ECG and the frame shown as a playhead (decision 190)
      const x0 = ecgX(hud.cineWindow.startS, layout);
      const x1 = ecgX(hud.cineWindow.endS, layout);
      ctx.fillStyle = 'rgba(255,200,87,0.09)';
      ctx.fillRect(x0, ey, Math.max(1, x1 - x0), eh);
    }
    ctx.strokeStyle = '#57d38c';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    let first = true;
    for (const p of ecgTracePoints(hud.ecg, layout)) {
      if (first) {
        ctx.moveTo(p.x, p.y);
        first = false;
      } else ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
    ctx.lineWidth = 1;
    ctx.fillStyle = '#ffc857';
    if (hud.frozen) {
      const px = Math.round(ecgX(hud.cineWindow.frameS, layout));
      ctx.fillRect(px - 1, ey - 2, 2, eh + 2);
      ctx.beginPath();
      ctx.moveTo(px - 5, ey - 7);
      ctx.lineTo(px + 5, ey - 7);
      ctx.lineTo(px, ey - 1);
      ctx.closePath();
      ctx.fill();
    } else ctx.fillRect(W - 9, ey, 2, eh);
  }
  ctx.lineWidth = 1.5;
  for (const ms of measurements) {
    const sameFamily =
      ms.modality === modality ||
      (ms.modality === '2d' && modality === 'color') ||
      (ms.modality === 'color' && modality === '2d');
    if (!sameFamily) continue;
    const geometry = reprojectGeometry(ms.geometry, ms.captureSector, m);
    drawGeometry(ctx, geometry, ms.kind, '#ffc857');
    const p = geometry[geometry.length - 1];
    if (p)
      drawValueChip(
        ctx,
        `${ms.label} ${ms.value.toFixed(ms.kind === 'time' ? 0 : ms.kind === 'vti' ? 1 : 2)} ${ms.units}`,
        p.x,
        p.y,
        '#ffc857',
      );
  }
  if (pending.length)
    drawGeometry(
      ctx,
      pending,
      activeTool === 'caliper' || activeTool === 'tapse'
        ? 'linear'
        : activeTool === 'vti' || activeTool === 'simpson'
          ? 'vti'
          : 'time',
      '#5cc8ff',
    );
  ctx.lineWidth = 1;
  // review markers (decision 134): numbered, with the structure the model holds under each one. How to use the mode
  // is in the console's review tab; the image carries only a tag that names the mode, above the ECG where the depth
  // and gain steppers never go (decision 194), and the pending secondary point
  if (ui.reviewMode) {
    const tagY = (modality === '2d' || modality === 'color' ? sectorH : H) - 50;
    ctx.fillStyle = '#ff6ad5';
    ctx.fillText(
      st.reviewLinkParentId
        ? `REVISIÓN · punto secundario de ${reviewMarkers.find((x) => x.id === st.reviewLinkParentId)?.n ?? '?'} · Esc termina`
        : 'REVISIÓN',
      12,
      tagY,
    );
  }
  // links from each secondary point to its primary (decision 136), under the rings
  for (const mk of reviewMarkers) {
    if (mk.space !== 'image' || !mk.parentId) continue;
    const parent = reviewMarkers.find((x) => x.id === mk.parentId);
    if (!parent || parent.space !== 'image') continue;
    const a = markerScreenPosition(parent, m);
    const b = markerScreenPosition(mk, m);
    ctx.strokeStyle = 'rgba(255,106,213,0.8)';
    ctx.lineWidth = 1.2;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  for (const mk of reviewMarkers) {
    if (mk.space !== 'image') continue;
    const q = markerScreenPosition(mk, m);
    const selected = mk.id === st.reviewSelectedId;
    const radius = mk.parentId ? 7 : 9;
    if (selected) {
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.arc(q.x, q.y, 14, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#ff6ad5';
    ctx.fillStyle = 'rgba(20,20,28,0.75)';
    ctx.beginPath();
    ctx.arc(q.x, q.y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#ff6ad5';
    ctx.font = `bold ${mk.parentId ? 9 : 11}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(markerLabel(mk, reviewMarkers), q.x, q.y + 0.5);
    ctx.textAlign = 'left';
    ctx.font = canvasFont(11);
    if (!mk.strip) {
      const note = mk.note.trim();
      const label =
        structureLabel(mk.point ? mk.point.structure : mk.structure) +
        (note ? ` — ${note.length > 28 ? `${note.slice(0, 27)}…` : note}` : '');
      const w = ctx.measureText(label).width + 8;
      ctx.fillStyle = 'rgba(20,20,28,0.75)';
      ctx.fillRect(q.x + 12, q.y - 8, w, 16);
      ctx.fillStyle = '#ff6ad5';
      ctx.fillText(label, q.x + 16, q.y);
    }
    ctx.lineWidth = 1;
  }
}

/** Where an image marker sits on the current display: strip markers keep their pixel, sector markers reproject. */
function markerScreenPosition(mk: ReviewMarker, m: SectorMapping): { x: number; y: number } {
  if (mk.strip || !mk.captureSector) return { x: mk.x, y: mk.y };
  return reprojectGeometry([{ x: mk.x, y: mk.y }], mk.captureSector, m)[0] ?? { x: mk.x, y: mk.y };
}

function drawArc(
  ctx: CanvasRenderingContext2D,
  m: SimOutput['sector'],
  rCm: number,
  t0: number,
  t1: number,
): void {
  ctx.beginPath();
  const n = 24;
  for (let i = 0; i <= n; i++) {
    const th = t0 + ((t1 - t0) * i) / n;
    const p = polarToPixel(m, rCm, th);
    if (i === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  }
  ctx.stroke();
}

function drawArcBox(
  ctx: CanvasRenderingContext2D,
  m: SimOutput['sector'],
  t0: number,
  t1: number,
  r0: number,
  r1: number,
  color: string,
): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  const n = 16;
  for (let i = 0; i <= n; i++) {
    const p = polarToPixel(m, r0, t0 + ((t1 - t0) * i) / n);
    if (i === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  }
  for (let i = n; i >= 0; i--) {
    const p = polarToPixel(m, r1, t0 + ((t1 - t0) * i) / n);
    ctx.lineTo(p.x, p.y);
  }
  ctx.closePath();
  ctx.stroke();
  ctx.lineWidth = 1;
}

function drawGeometry(
  ctx: CanvasRenderingContext2D,
  pts: { x: number; y: number }[],
  kind: string,
  color: string,
): void {
  // calipers as on a scanner (decision 200): a cross at each point and a dashed line between them, both over a dark
  // halo so they read on bright tissue as well as in the cavity
  const crosses = () => {
    ctx.beginPath();
    for (const p of pts) {
      ctx.moveTo(p.x - 5, p.y);
      ctx.lineTo(p.x + 5, p.y);
      ctx.moveTo(p.x, p.y - 5);
      ctx.lineTo(p.x, p.y + 5);
    }
    ctx.stroke();
  };
  const joined =
    pts.length >= 2 &&
    (kind === 'linear' || kind === 'time' || kind === 'vti' || kind === 'volume');
  const line = () => {
    ctx.beginPath();
    ctx.moveTo(pts[0]!.x, pts[0]!.y);
    for (const p of pts.slice(1)) ctx.lineTo(p.x, p.y);
    if (kind === 'volume') ctx.closePath();
    ctx.stroke();
  };
  const cap = ctx.lineCap;
  ctx.lineCap = 'round';
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.65)';
  ctx.lineWidth = 3.5;
  crosses();
  if (joined) line();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  crosses();
  if (joined) {
    ctx.setLineDash([5, 4]);
    line();
    ctx.setLineDash([]);
  }
  ctx.lineCap = cap;
}

/** A measurement's value beside its last point: a small dark chip with the figure in the mono face (decision 200). */
function drawValueChip(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  color: string,
): void {
  const font = ctx.font;
  ctx.font = canvasFont(10.5, 'mono');
  const w = ctx.measureText(text).width + 12;
  const h = 18;
  const left = Math.max(
    2,
    Math.min(ctx.canvas.width / (window.devicePixelRatio || 1) - w - 2, x + 8),
  );
  // above the point, or under it when the point is at the top edge (decision 201)
  const top = y - h - 6 < 2 ? y + 8 : y - h - 6;
  ctx.fillStyle = 'rgba(8, 11, 16, 0.8)';
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.14)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(left, top, w, h, 5);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.textBaseline = 'middle';
  ctx.fillText(text, left + 6, top + h / 2 + 0.5);
  ctx.font = font;
}

/** Pixel-to-sample table and layer for the outline of the hovered structure, kept while the geometry stays. */
const structLayer: {
  key: string;
  lut: Int32Array | null;
  canvas: HTMLCanvasElement | null;
  img: ImageData | null;
} = { key: '', lut: null, canvas: null, img: null };

/**
 * The structure under the pointer on the cut map, outlined on the image in the accent (decision 202): the learner
 * points at «AI» on the drawing and sees where the atrium is in the echo. Nothing is drawn while nothing is pointed at.
 */
function drawStructureOutline(ctx: CanvasRenderingContext2D, hud: SimOutput): void {
  const id = useStructureHover.getState().id;
  if (id === null) return;
  const m = hud.sector;
  const p = hud.polar;
  if (hud.structure.length !== p.lines * p.samples || m.width < 8 || m.height < 8) return;
  const w = Math.round(m.width),
    h = Math.round(m.height);
  const key = `${p.lines}x${p.samples}|${p.sectorRad.toFixed(4)}|${p.depthCm}|${w}x${h}|${m.apexX.toFixed(1)},${m.apexY.toFixed(1)}|${m.pxPerCm.toFixed(3)}|${m.invertLR ? 1 : 0}`;
  if (key !== structLayer.key || !structLayer.lut || !structLayer.canvas || !structLayer.img) {
    structLayer.lut = nearestSampleLut(p, { ...m, width: w, height: h });
    structLayer.canvas = document.createElement('canvas');
    structLayer.canvas.width = w;
    structLayer.canvas.height = h;
    structLayer.img = new ImageData(w, h);
    structLayer.key = key;
  }
  const img = structLayer.img;
  img.data.fill(0);
  if (!paintStructureOutline(img.data, structLayer.lut, hud.structure, w, id)) return;
  const off = structLayer.canvas.getContext('2d');
  if (!off) return;
  off.putImageData(img, 0, 0);
  ctx.drawImage(structLayer.canvas, m.x, m.y);
}

/**
 * The LV segment layer of the image (decision 153): the frame's segment codes read in the chosen model, painted
 * translucent over the echo and numbered. The pixel-to-sample table is kept while the sector geometry stays.
 */
const segLayer: {
  key: string;
  lut: Int32Array | null;
  canvas: HTMLCanvasElement | null;
  img: ImageData | null;
  ids: Uint8Array | undefined;
  anchors: SegmentAnchors;
} = {
  key: '',
  lut: null,
  canvas: null,
  img: null,
  ids: undefined,
  anchors: new SegmentAnchors(),
};

/**
 * The RV insertions of a short-axis cut (decision 181): an amber pointer outside each, aimed at it from the side away
 * from the centre of the numbered myocardium. The septum (2, 3, 8, 9) lies between them, whatever the clock position.
 */
function drawRvInsertions(
  ctx: CanvasRenderingContext2D,
  m: { x: number; y: number },
  stats: readonly { id: number; count: number; cx: number; cy: number }[],
  ins: RvInsertions,
): void {
  let n = 0,
    cx = 0,
    cy = 0;
  for (const s of stats)
    if (s.id >= 1 && s.id <= 12) {
      cx += s.cx * s.count;
      cy += s.cy * s.count;
      n += s.count;
    }
  if (!n) return;
  cx /= n;
  cy /= n;
  ctx.save();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.85)';
  ctx.fillStyle = '#ffb020';
  for (const p of [ins.anterior, ins.inferior]) {
    const dx = p.x - cx,
      dy = p.y - cy;
    const d = Math.hypot(dx, dy) || 1;
    const ux = dx / d,
      uy = dy / d;
    // tip on the insertion, body 11 px outward, 8 px wide
    const tx = m.x + p.x,
      ty = m.y + p.y;
    ctx.beginPath();
    ctx.moveTo(tx, ty);
    ctx.lineTo(tx + ux * 11 - uy * 4, ty + uy * 11 + ux * 4);
    ctx.lineTo(tx + ux * 11 + uy * 4, ty + uy * 11 - ux * 4);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

function drawSegmentLayer(ctx: CanvasRenderingContext2D, hud: SimOutput, st: SimStore): void {
  const m = hud.sector;
  const p = hud.polar;
  if (hud.segment.length !== p.lines * p.samples || m.width < 8 || m.height < 8) return;
  const w = Math.round(m.width),
    h = Math.round(m.height);
  const key = `${p.lines}x${p.samples}|${p.sectorRad.toFixed(4)}|${p.depthCm}|${w}x${h}|${m.apexX.toFixed(1)},${m.apexY.toFixed(1)}|${m.pxPerCm.toFixed(3)}|${m.invertLR ? 1 : 0}`;
  if (key !== segLayer.key || !segLayer.lut || !segLayer.canvas || !segLayer.img) {
    segLayer.lut = nearestSampleLut(p, { ...m, width: w, height: h });
    segLayer.canvas = document.createElement('canvas');
    segLayer.canvas.width = w;
    segLayer.canvas.height = h;
    segLayer.img = new ImageData(w, h);
    segLayer.key = key;
  }
  const model = st.ui.segmentModel;
  segLayer.ids = segmentIds(hud.segment, model, segLayer.ids);
  const hovered = useSegmentHover.getState().id;
  const stats = paintSegmentOverlay(
    segLayer.img.data,
    segLayer.lut,
    segLayer.ids,
    w,
    st.ui.selectedSegment,
    hovered,
  );
  const off = segLayer.canvas.getContext('2d');
  if (!off) return;
  off.putImageData(segLayer.img, 0, 0);
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(segLayer.canvas, m.x, m.y);
  // numbers on each segment and the RV insertions: the mean of their places over one beat of an unchanged probe,
  // geometry and model, then still (decision 181)
  ctx.font = canvasFont(12, 'ui', 700);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const pr = st.probe;
  const layoutKey = `${key}|${model}|${st.caseId}|${[pr.u, pr.v, pr.rotationDeg, pr.tiltDeg, pr.rockDeg, pr.pressure].map((v) => v.toFixed(3)).join(',')}`;
  const anchors = segLayer.anchors;
  if (anchors.wants(layoutKey, hud.frameId)) {
    const shown = new Set(anchors.view().labels.map((l) => l.id));
    const labels = placeLabels(
      stats,
      segLayer.lut,
      segLayer.ids,
      w,
      Math.max(30, 0.0005 * w * h),
      (t) => ({ w: ctx.measureText(t).width + 6, h: 16 }),
      shown,
      (id) => String(id),
    );
    anchors.add(layoutKey, hud, labels, rvInsertionPoints(segLayer.lut, segLayer.ids, w, stats));
  }
  const view = anchors.view();
  useSegmentOrientation.getState().set(imageUpOnPolarMap(view.labels), view.insertions !== null);
  // where the numbers and the insertions were drawn, rounded to the pixel, for the E2E that checks they hold still
  const placed = JSON.stringify({
    labels: view.labels.map((l) => [l.id, Math.round(l.x), Math.round(l.y)]),
    insertions:
      view.insertions &&
      [view.insertions.anterior, view.insertions.inferior].map((q) => [
        Math.round(q.x),
        Math.round(q.y),
      ]),
  });
  if (ctx.canvas.dataset.segmentLabels !== placed) ctx.canvas.dataset.segmentLabels = placed;
  if (view.insertions) drawRvInsertions(ctx, m, stats, view.insertions);
  ctx.lineJoin = 'round';
  ctx.lineWidth = 3;
  for (const l of view.labels) {
    const x = m.x + l.x,
      y = m.y + l.y;
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.85)';
    ctx.strokeText(l.text, x, y);
    ctx.fillStyle = Number(l.text) === hovered ? '#5cc8ff' : '#ffffff';
    ctx.fillText(l.text, x, y);
  }
  ctx.restore();
}
