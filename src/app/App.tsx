import { useCallback, useEffect, useRef, useState } from 'react';
import { useHudStore, useSimStore } from './store';
import { modePolicy } from './modePolicy';
import { useSimulation } from './useSimulation';
import { useShortcuts } from './shortcuts';
import { DisplayCanvas } from '@/ui/DisplayCanvas';
import { TorsoView } from '@/ui/TorsoView';
import { ConsolePanel } from '@/ui/ConsolePanel';
import { TopBar } from '@/ui/TopBar';
import { ModeBar } from '@/ui/ModeBar';
import { GuidancePanel } from '@/ui/GuidancePanel';
import { CurriculumScreen } from '@/ui/CurriculumScreen';
import { ProgressScreen } from '@/ui/ProgressScreen';
import { evaluateTasks, type LearnerSnapshot } from '@/education/curriculum';
import { expectedFindings, scoreImpression } from '@/education/impression';
import { DevPanel } from '@/ui/DevPanel';
import { ReferencesScreen } from '@/ui/ReferencesScreen';
import { ReportScreen } from '@/ui/ReportScreen';
import { Tutorial } from '@/ui/Tutorial';
import type { SimOutput } from '@/simulator/core/protocol';
import { DopplerAudio } from '@/simulator/doppler/audio/dopplerAudio';
import { frameBus } from './frameBus';

export function App() {
  const [size, setSize] = useState({ width: 640, height: 520 });
  const audioRef = useRef<DopplerAudio | null>(null);
  const setHud = useHudStore((s) => s.setHud);
  const lastHudRef = useRef(0);
  const ui = useSimStore((s) => s.ui);
  const mode = useSimStore((s) => s.mode);
  const error = useSimStore((s) => s.error);
  const spectral = useSimStore((s) => s.spectral);
  const modality = useSimStore((s) => s.modality);
  useShortcuts();

  const onFrame = useCallback(
    (out: SimOutput) => {
      frameBus.latest = out;
      frameBus.emit(out);
      const now = performance.now();
      if (now - lastHudRef.current > 120) {
        lastHudRef.current = now;
        setHud(out);
        const st = useSimStore.getState();
        if (out.view?.bestViewId && !out.frozen) {
          const prev = st.viewProgress[out.view.bestViewId] ?? 0;
          st.recordViewScore(out.view.bestViewId, out.view.score);
          if (out.view.score >= prev + 5 || (prev === 0 && out.view.score > 0))
            st.recordEvent({
              t: Date.now(),
              kind: 'view',
              caseId: st.caseId,
              viewId: out.view.bestViewId,
              score: out.view.score,
            });
        }
        // curriculum: evaluate the automatic task checks against the learner's current state (≈ 8 Hz)
        if (modePolicy(st.mode).evaluateCurriculum) {
          const impression = st.truth
            ? scoreImpression(st.impressionSelection, expectedFindings(st.truth)).score
            : null;
          const snapshot: LearnerSnapshot = {
            caseId: st.caseId,
            mode: st.mode,
            viewProgress: st.viewProgress,
            bestView: out.view?.bestViewId
              ? { id: out.view.bestViewId, score: out.view.score }
              : null,
            modality: st.modality,
            colorScaleMps: st.color.scaleMps,
            colorGainDb: st.color.gainDb,
            gateStructure: out.gate?.structure ?? null,
            gateFlowAngleDeg: out.gate?.flowAngleDeg ?? null,
            measurements: st.measurements,
            impressionScore: st.impressionSelection.length ? impression : null,
            settings: {
              depthCm: st.settings.depthCm,
              gainDb: st.settings.gainDb,
              frequencyMHz: st.settings.frequencyMHz,
              harmonics: st.settings.harmonics,
            },
          };
          const done = evaluateTasks(snapshot).filter((id) => !st.progress.completedTasks[id]);
          if (done.length) st.completeTasks(done);
        }
      }
      const audio = audioRef.current;
      if (audio && (modality === 'pw' || modality === 'cw' || modality === 'tdi'))
        audio.update(out.spectrumColumn, out.spectralRange.vMin, out.spectralRange.vMax);
    },
    [setHud, modality],
  );
  useSimulation(size, onFrame);

  useEffect(() => {
    const wantAudio =
      spectral.audioOn && (modality === 'pw' || modality === 'cw' || modality === 'tdi');
    if (wantAudio && !audioRef.current) {
      audioRef.current = new DopplerAudio();
      audioRef.current.start();
    }
    if (audioRef.current) {
      if (!wantAudio) {
        audioRef.current.stop();
        audioRef.current = null;
      } else audioRef.current.setVolume(spectral.volume);
    }
  }, [spectral.audioOn, spectral.volume, modality]);

  // Clean interface: the whole left rail hides (exam mode forces it on).
  const minimal = ui.minimal || mode === 'exam';
  const railVisible = ui.showTorso && !minimal;
  return (
    <div
      className={`app ${railVisible ? '' : 'no-torso'} ${railVisible && ui.railMini ? 'rail-mini' : ''}`}
    >
      <TopBar />
      {ui.screen === 'references' ? (
        <ReferencesScreen />
      ) : ui.screen === 'report' ? (
        <ReportScreen />
      ) : ui.screen === 'curriculum' ? (
        <CurriculumScreen />
      ) : ui.screen === 'progress' ? (
        <ProgressScreen />
      ) : (
        <>
          <div className="left" style={{ display: railVisible ? 'flex' : 'none' }}>
            <button
              className="rail-collapse"
              onClick={() => useSimStore.getState().setUi({ railMini: !ui.railMini })}
              aria-expanded={!ui.railMini}
              aria-label={
                ui.railMini ? 'Expandir panel de navegación' : 'Colapsar panel de navegación'
              }
              title={
                ui.railMini
                  ? 'Expandir el torso 3D y la guía'
                  : 'Colapsar a una tira con la puntuación'
              }
            >
              {ui.railMini ? '»' : '«'}
            </button>
            {/* the torso stays mounted while mini so its mesh worker is not rebuilt on expand */}
            <div className="rail-main" style={{ display: ui.railMini ? 'none' : 'flex' }}>
              {railVisible && <TorsoView />}
              <GuidancePanel />
            </div>
            {ui.railMini && <RailMini />}
          </div>
          <div className="center">
            {error && (
              <div className="error" role="alert">
                {error}
                <div>
                  <button onClick={() => useSimStore.getState().setError(null)}>cerrar</button>
                </div>
              </div>
            )}
            <DisplayCanvas onSize={setSize} />
            <DevPanel />
            {ui.screen === 'simulator' && <Tutorial />}
          </div>
          <div className="right">
            <ConsolePanel />
          </div>
        </>
      )}
      <ModeBar />
    </div>
  );
}

/** Collapsed left rail: the view score stays glanceable while torso and guidance are tucked away. */
function RailMini() {
  const hud = useHudStore((h) => h.hud);
  const mode = useSimStore((s) => s.mode);
  const v = hud?.view;
  if (!modePolicy(mode).hintsEnabled || !v) return <div className="rail-strip" />;
  const color = v.score >= 75 ? 'var(--ok)' : v.score >= 50 ? 'var(--warn)' : 'var(--bad)';
  return (
    <div className="rail-strip">
      <div
        className="rail-strip-score"
        style={{ color }}
        title={`${v.score}/100 — ${v.bestViewName}`}
      >
        {v.score}
      </div>
      <div className="rail-strip-bar">
        <i style={{ height: `${v.score}%`, background: color }} />
      </div>
    </div>
  );
}
