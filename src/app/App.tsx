import { useCallback, useEffect, useRef, useState } from 'react';
import { useHudStore, useSimStore } from './store';
import { useSimulation } from './useSimulation';
import { useShortcuts } from './shortcuts';
import { DisplayCanvas } from '@/ui/DisplayCanvas';
import { TorsoView } from '@/ui/TorsoView';
import { ConsolePanel } from '@/ui/ConsolePanel';
import { TopBar } from '@/ui/TopBar';
import { ModeBar } from '@/ui/ModeBar';
import { GuidancePanel } from '@/ui/GuidancePanel';
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
        if (out.view?.bestViewId && !out.frozen) useSimStore.getState().recordViewScore(out.view.bestViewId, out.view.score);
      }
      const audio = audioRef.current;
      if (audio && (modality === 'pw' || modality === 'cw' || modality === 'tdi')) audio.update(out.spectrumColumn, out.spectralRange.vMin, out.spectralRange.vMax);
    },
    [setHud, modality],
  );
  useSimulation(size, onFrame);

  useEffect(() => {
    const wantAudio = spectral.audioOn && (modality === 'pw' || modality === 'cw' || modality === 'tdi');
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

  return (
    <div className={`app ${ui.showTorso ? '' : 'no-torso'}`}>
      <TopBar />
      {ui.screen === 'references' ? (
        <ReferencesScreen />
      ) : ui.screen === 'report' ? (
        <ReportScreen />
      ) : (
        <>
          <div className="left" style={{ display: ui.showTorso ? 'flex' : 'none' }}>
            {ui.showTorso && <TorsoView />}
            <GuidancePanel />
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
