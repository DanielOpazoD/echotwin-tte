import { useEffect, useRef } from 'react';
import { SimClient } from '@/simulator/core/client';
import type { SimInput, SimOutput } from '@/simulator/core/protocol';
import { useSimStore } from './store';
import { loadCaseById } from '@/cases';
import { frameBus } from './frameBus';

/**
 * Drives the simulator from requestAnimationFrame: snapshots the store into a SimInput, sends it,
 * and publishes outputs back (the HUD state). The heavy work happens in the worker.
 */
export function useSimulation(
  displaySize: { width: number; height: number },
  onFrame: (out: SimOutput) => void,
): void {
  const clientRef = useRef<SimClient | null>(null);
  const sizeRef = useRef(displaySize);
  const onFrameRef = useRef(onFrame);
  const caseId = useSimStore((s) => s.caseId);
  // the case the client last loaded: the mount loads it, and the case effect only reloads a different one (decision
  // 172; both loaded it at start, and the worker built the first core twice)
  const loadedCaseRef = useRef<string | null>(null);
  useEffect(() => {
    sizeRef.current = displaySize;
    clientRef.current?.send(buildInput(displaySize));
  }, [displaySize]);
  useEffect(() => {
    onFrameRef.current = onFrame;
  }, [onFrame]);

  useEffect(() => {
    const store = useSimStore.getState();
    const client = new SimClient({
      onFrame: (out) => {
        onFrameRef.current(out);
      },
      onReady: (truth, id, phaseMarks, lvLengthCm) => {
        useSimStore.getState().setTruth(truth, id);
        useSimStore.getState().setCycleInfo(phaseMarks, lvLengthCm);
        useSimStore.getState().setWorkerMode(client.mode);
      },
      onError: (m) => useSimStore.getState().setError(m),
    });
    clientRef.current = client;
    frameBus.recycle = (b) => client.recycle(b);
    frameBus.request = (req) => client.request(req);
    const caseDef = loadCaseById(store.caseId);
    loadedCaseRef.current = store.caseId;
    void client.loadCase(caseDef, buildInput(sizeRef.current));
    // Inputs are pushed on store changes (independent of rAF, which browsers pause in hidden tabs).
    const push = () => client.send(buildInput(sizeRef.current));
    const unsub = useSimStore.subscribe(push);
    const safety = setInterval(push, 500);
    let raf = 0;
    let frames = 0;
    let fpsT = performance.now();
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      if (useSimStore.getState().presetAnim) useSimStore.getState().tickPresetAnimation(now);
      frames++;
      if (now - fpsT > 1000) {
        useSimStore.getState().setFpsUi(frames);
        frames = 0;
        fpsT = now;
      }
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      clearInterval(safety);
      unsub();
      client.dispose();
      clientRef.current = null;
      loadedCaseRef.current = null;
    };
  }, []);

  useEffect(() => {
    const client = clientRef.current;
    if (!client || loadedCaseRef.current === caseId) return;
    loadedCaseRef.current = caseId;
    void client.loadCase(loadCaseById(caseId), buildInput(sizeRef.current));
  }, [caseId]);
}

export function buildInput(display: { width: number; height: number }): SimInput {
  const s = useSimStore.getState();
  return {
    probe: s.probe,
    patient: s.patient,
    settings: s.settings,
    modality: s.modality,
    frozen: s.frozen,
    cineOffset: s.cineOffset,
    color: s.color,
    spectral: s.spectral,
    cursorThetaRad: s.cursorThetaRad,
    gateDepthCm: s.gateDepthCm,
    quality: s.quality,
    display,
    rendererBackend: s.rendererBackend,
    artifactOverrides: s.artifactLab,
  };
}
