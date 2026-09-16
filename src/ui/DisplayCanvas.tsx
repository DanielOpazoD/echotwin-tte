import { useCallback, useEffect, useRef, useState } from 'react';
import { useHudStore, useSimStore, type SimStore } from '@/app/store';
import type { SimOutput } from '@/simulator/core/protocol';
import { ecgTracePoints, type EcgLayout } from './ecgTrace';
import { pixelToPolar, polarToPixel, type SectorMapping } from '@/simulator/renderer/scanConvert';
import { reprojectGeometry } from '@/simulator/measurements/geometry';
import { tgcAtDepth } from '@/simulator/renderer/postprocess/consolePipeline';
import type { Measurement } from '@/simulator/measurements/types';
import { frameBus } from '@/app/frameBus';
import { ImageHud } from './ImageHud';
import { discProfileFromContour, volumeFromProfileMl } from '@/simulator/measurements/simpson';
import { summarizeEnvelope } from '@/simulator/measurements/vti';
import { evaluateCapture, specFor, type CaptureExtras } from '@/app/measurementCapture';

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
  const dragRef = useRef<{
    kind: 'box-move' | 'box-resize' | 'cursor' | 'none';
    startX: number;
    startY: number;
    box?: { t0: number; t1: number; r0: number; r1: number };
  }>({ kind: 'none', startX: 0, startY: 0 });
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
    const unsubStore = useSimStore.subscribe(redrawOverlay);
    return () => {
      unsubFrame();
      unsubStore();
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
    if (st.activeTool !== 'none') {
      handleToolClick(p, e.detail);
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
    if (
      (st.modality === 'pw' ||
        st.modality === 'cw' ||
        st.modality === 'tdi' ||
        st.modality === 'm-mode' ||
        st.modality === 'cmm') &&
      inSector
    ) {
      const { rCm, thetaRad } = pixelToPolar(m, p.x, p.y);
      st.setCursor(
        Math.max(-m.sectorRad / 2, Math.min(m.sectorRad / 2, thetaRad)),
        st.modality === 'pw' || st.modality === 'tdi'
          ? Math.max(1, Math.min(m.depthCm - 0.5, rCm))
          : undefined,
      );
      dragRef.current = { kind: 'cursor', startX: p.x, startY: p.y };
    }
  };
  const onMouseMove = (e: React.MouseEvent) => {
    const hud = lastOutRef.current;
    if (!hud || dragRef.current.kind === 'none') return;
    const p = toLocal(e);
    const st = useSimStore.getState();
    const m = hud.sector;
    if (dragRef.current.kind === 'cursor') {
      const { rCm, thetaRad } = pixelToPolar(m, p.x, Math.min(p.y, m.height - 1));
      st.setCursor(
        Math.max(-m.sectorRad / 2, Math.min(m.sectorRad / 2, thetaRad)),
        st.modality === 'pw' || st.modality === 'tdi'
          ? Math.max(1, Math.min(m.depthCm - 0.5, rCm))
          : undefined,
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
    dragRef.current = { kind: 'none', startX: 0, startY: 0 };
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
    const redraw = () => useHudStore.getState().setHud({ ...hud });
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
      pend.points = [];
      if (spec) st.setActiveMeasurement(null);
    };
    const stripVelocity = (y: number) =>
      strip.topValue + ((y - strip.y) / strip.height) * (strip.bottomValue - strip.topValue);
    const velocityUnits = modality === 'tdi' ? 'cm/s' : 'm/s';
    const velocityScale = modality === 'tdi' ? 100 : 1;
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
          const trueL =
            st.lvLengthCm !== null
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
    <div className="display-wrap" ref={wrapRef}>
      <canvas
        ref={imgRef}
        width={size.width}
        height={size.height}
        aria-label="Imagen ecográfica simulada"
      />
      <canvas
        ref={ovRef}
        className="overlay"
        style={{ width: '100%', height: '100%' }}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
        aria-label="Superposiciones y herramientas de medición"
      />
      <ImageHud />
      <div className="disclaimer">
        Simulador educacional con pacientes sintéticos. No utilizar para diagnóstico ni toma de
        decisiones clínicas reales.
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
  const m = hud.sector;
  ctx.font = '11px system-ui, sans-serif';
  ctx.textBaseline = 'middle';
  const sectorH = m.height;
  const half = m.sectorRad / 2;
  const rightX = Math.min(W - 6, m.apexX + m.depthCm * m.pxPerCm * Math.sin(half) + 10);
  ctx.strokeStyle = '#9aa4b5';
  ctx.fillStyle = '#9aa4b5';
  ctx.lineWidth = 1;
  const stepCm = m.depthCm > 20 ? 5 : m.depthCm > 12 ? 2 : 1;
  for (let d = 0; d <= m.depthCm + 1e-6; d += stepCm) {
    const y = m.apexY + d * m.pxPerCm;
    if (y > sectorH - 2) break;
    ctx.beginPath();
    ctx.moveTo(rightX, y);
    ctx.lineTo(rightX + 6, y);
    ctx.stroke();
    if (d % (stepCm * 2) === 0) ctx.fillText(String(d), rightX + 9, y);
  }
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
    const bx = W - 22,
      by = m.apexY + 20,
      bh = 90;
    const grad = ctx.createLinearGradient(0, by, 0, by + bh);
    grad.addColorStop(0, '#ffd23c');
    grad.addColorStop(0.45, '#c81e1e');
    grad.addColorStop(0.5, '#000');
    grad.addColorStop(0.55, '#1e3cc8');
    grad.addColorStop(1, '#3ce0ff');
    ctx.fillStyle = grad;
    ctx.fillRect(bx, by, 8, bh);
    ctx.fillStyle = '#9aa4b5';
    ctx.font = '10px system-ui';
    ctx.fillText(`${color.scaleMps.toFixed(2)}`, bx - 32, by);
    ctx.fillText(`−${color.scaleMps.toFixed(2)}`, bx - 36, by + bh);
    ctx.fillText('↑ hacia', bx - 44, by + bh / 2 - 8);
    ctx.fillText('↓ desde', bx - 44, by + bh / 2 + 8);
    ctx.font = '11px system-ui';
  }
  if (
    modality === 'pw' ||
    modality === 'cw' ||
    modality === 'tdi' ||
    modality === 'm-mode' ||
    modality === 'cmm'
  ) {
    const p0 = polarToPixel(m, 0.3, cursorTheta);
    const p1 = polarToPixel(m, m.depthCm, cursorTheta);
    ctx.strokeStyle = modality === 'm-mode' || modality === 'cmm' ? '#5cc8ff' : '#ffc857';
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(p0.x, p0.y);
    ctx.lineTo(p1.x, p1.y);
    ctx.stroke();
    ctx.setLineDash([]);
    if (modality === 'pw' || modality === 'tdi') {
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
  if (ui.showEcg && hud.ecg.length > 1) {
    const eh = 34;
    const ey = (modality === '2d' || modality === 'color' ? sectorH : H) - eh - 4;
    const span = 3;
    const layout: EcgLayout = {
      x0: 8,
      width: W - 16,
      y: ey,
      height: eh,
      spanS: span,
      headS: hud.ecgHead,
    };
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
    ctx.fillRect(W - 9, ey, 2, eh);
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
    if (p) {
      ctx.fillStyle = '#ffc857';
      ctx.fillText(
        `${ms.label}: ${ms.value.toFixed(ms.kind === 'time' ? 0 : ms.kind === 'vti' ? 1 : 2)} ${ms.units}`,
        p.x + 6,
        p.y - 8,
      );
    }
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
  if (activeTool !== 'none') {
    ctx.fillStyle = '#5cc8ff';
    const spec = st.activeMeasurementId ? specFor(st.activeMeasurementId) : undefined;
    const prefix = spec ? `${spec.shortLabel} · ` : '';
    ctx.fillText(prefix + TOOL_HINT[activeTool], 8, 30);
  }
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

const TOOL_HINT: Record<SimStore['activeTool'], string> = {
  none: '',
  caliper: 'Caliper: clic en 2 puntos (borde interno a borde interno)',
  velocity: 'Velocidad: clic sobre el pico del espectro',
  vti: 'VTI: clic a lo largo de la envolvente, doble clic para cerrar',
  'auto-vti': 'VTI automático: clic al inicio y al final del latido sobre el espectro',
  time: 'Tiempo: clic en 2 puntos',
  slope: 'Tiempo de desaceleración: clic en el pico de E y luego sobre la pendiente',
  simpson:
    'Simpson: clic a lo largo del endocardio de anillo a anillo por el ápex, doble clic para cerrar',
  tapse: 'TAPSE: clic en la posición telediastólica y telesistólica del anillo en el modo M',
};

function drawGeometry(
  ctx: CanvasRenderingContext2D,
  pts: { x: number; y: number }[],
  kind: string,
  color: string,
): void {
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  for (const p of pts) {
    ctx.beginPath();
    ctx.moveTo(p.x - 4, p.y);
    ctx.lineTo(p.x + 4, p.y);
    ctx.moveTo(p.x, p.y - 4);
    ctx.lineTo(p.x, p.y + 4);
    ctx.stroke();
  }
  if (
    pts.length >= 2 &&
    (kind === 'linear' || kind === 'time' || kind === 'vti' || kind === 'volume')
  ) {
    ctx.beginPath();
    ctx.moveTo(pts[0]!.x, pts[0]!.y);
    for (const p of pts.slice(1)) ctx.lineTo(p.x, p.y);
    if (kind === 'volume') ctx.closePath();
    ctx.stroke();
  }
}
