import { useEffect, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { navigatorLayers, useHudStore, useSimStore } from '@/app/store';
import { modePolicy } from '@/app/modePolicy';
import { CutMapView } from './CutMapView';
import { RotationDial } from './RotationDial';
import { CheckItem, MenuCap, usePopover } from './menu';
import { IconCrosshair, IconLayers, IconMinus, IconPlus } from './icons';
import { mountNavigatorScene, type NavigatorZoom } from './navigator/navigatorScene';

export { narrowPanelFovDeg } from './navigator/navigatorScene';

/**
 * 3D torso + probe trainer (spec 4.3, 58, 76). Clean clinical torso: wrap-around superellipse chest
 * with a translucent skin over a full rib cage (both sides), sternum, clavicles, a translucent heart
 * ghost and the imaging plane fan; a phased-array transducer with a pickable index marker.
 * Mouse: drag skin = slide · drag the blue marker or wheel = rotate · Shift+drag = rock ·
 * Alt+drag = tilt · right-drag = orbit · Ctrl/⌘+wheel = zoom. Never teleports to a view. The scene itself lives in
 * `navigator/navigatorScene.ts`; this component mounts it and draws the controls around it.
 */
export function TorsoView() {
  const ref = useRef<HTMLDivElement>(null);
  const [dragAction, setDragAction] = useState<'probe' | 'camera'>('probe');
  const dragActionRef = useRef(dragAction);
  const caseId = useSimStore((s) => s.caseId);
  const split = useSimStore((s) => navigatorLayers(s).split);
  const anatomy = useSimStore((s) => modePolicy(s.mode).navigatorAnatomy);
  const livePatient = useSimStore((s) => s.patient);
  const patient = useHudStore(
    useShallow((s) => (s.hud?.frozen ? (s.hud.acquisition?.patient ?? livePatient) : livePatient)),
  );
  const frozen = useHudStore((s) => s.hud?.frozen ?? false);
  const zoomRef = useRef<NavigatorZoom | null>(null);
  // a browser without WebGL keeps the image and the cut map; only the 3D view gives way to a notice (decision 154).
  // Probed once on mounting; if the renderer still failed, the ErrorBoundary around the navigator would contain it
  const [webglError] = useState(probeWebgl);

  useEffect(() => {
    const el = ref.current;
    if (!el || webglError) return;
    return mountNavigatorScene(el, { caseId, patient, dragAction: dragActionRef, zoom: zoomRef });
  }, [caseId, patient, webglError]);

  return (
    <div className={`torso-wrap${split ? ' split' : ''}`}>
      <div className="torso-3d" ref={ref} aria-label="Torso 3D y sonda virtual" data-tour="torso">
        {/* inside the torso so it sits at the torso's own bottom edge, whatever height the cut map leaves it
            (decision 197) */}
        <div className="torso-help">
          {frozen ? (
            'Sonda de la adquisición congelada · Arrastrar: orbitar cámara · Rueda: zoom'
          ) : dragAction === 'camera' ? (
            'Arrastrar: orbitar cámara · Rueda: zoom · La sonda conserva su posición'
          ) : (
            <>
              Arrastrar: deslizar · Rueda: rotar · Shift: rock · Alt: tilt ·{' '}
              <kbd className="kbd">?</kbd> todos los gestos
            </>
          )}
        </div>
        {webglError && (
          <div className="panel-error" role="alert">
            <b>La vista 3D necesita WebGL 2, que este navegador no ofrece.</b>
            <span className="small">
              La imagen ecográfica, el mapa del corte y los controles de la sonda siguen
              funcionando.
            </span>
          </div>
        )}
      </div>
      {split && <div className="torso-caption top">Sonda y tórax</div>}
      {split && <CutMapView />}
      <label className="torso-gesture">
        Arrastrar
        <select
          aria-label="Acción al arrastrar en el navegador"
          value={frozen ? 'camera' : dragAction}
          disabled={frozen}
          onChange={(e) => {
            const action = e.target.value as 'probe' | 'camera';
            dragActionRef.current = action;
            setDragAction(action);
          }}
        >
          <option value="probe">Sonda</option>
          <option value="camera">Cámara</option>
        </select>
      </label>
      <div className="torso-tools">
        <RotationDial />
        <div className="torso-buttons">
          <button
            className="icon-btn"
            onClick={() => zoomRef.current?.zoomBy(0.85)}
            data-tip="Acercar"
            data-tip-key="Ctrl/⌘+rueda"
            aria-label="Acercar"
          >
            <IconPlus size={12} />
          </button>
          <button
            className="icon-btn"
            onClick={() => zoomRef.current?.zoomBy(1.18)}
            data-tip="Alejar"
            aria-label="Alejar"
          >
            <IconMinus size={12} />
          </button>
          <button
            className="icon-btn"
            onClick={() => zoomRef.current?.center()}
            data-tip="Centrar la cámara en la sonda"
            aria-label="Centrar la cámara en la sonda"
          >
            <IconCrosshair size={12} />
          </button>
          <button
            className="icon-btn"
            onClick={() => zoomRef.current?.overview()}
            data-tip="Restablecer vista global del tórax"
            aria-label="Restablecer vista global del tórax"
          >
            ↺
          </button>
          {anatomy && (
            <button
              className="icon-btn"
              onClick={() => zoomRef.current?.plane()}
              data-tip="Mirar perpendicular al plano ecográfico"
              aria-label="Mirar perpendicular al plano ecográfico"
            >
              ⊥
            </button>
          )}
          {/* in exam mode the layers are fixed to the skin and the ribs (decision 256) */}
          {anatomy && <LayerMenu />}
        </div>
      </div>
    </div>
  );
}

/**
 * Why this browser cannot draw the 3D navigator, or null when it offers a WebGL2 context (released at once). three.js
 * creates only WebGL2 contexts: a browser with WebGL1 alone would pass a looser probe and fail inside the effect.
 */
function probeWebgl(): string | null {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2');
    if (!gl) return 'este navegador no ofrece un contexto WebGL2';
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

/** 3D navigator layers as a checkable popover: keeps the torso overlay to camera controls only. */
function LayerMenu() {
  const ui = useSimStore((s) => s.ui);
  const setUi = useSimStore((s) => s.setUi);
  const { open, setOpen, wrap } = usePopover();
  const layer = (label: string, key: keyof typeof ui, hint: string) => (
    <CheckItem
      label={label}
      checked={Boolean(ui[key])}
      onToggle={() => setUi({ [key]: !ui[key] })}
      hint={hint}
    />
  );
  return (
    <div className="menu-wrap" ref={wrap}>
      <button
        className={`icon-btn${open ? ' active' : ''}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Capas del navegador 3D"
        data-tip="Capas del navegador 3D"
        onClick={() => setOpen(!open)}
      >
        <IconLayers size={12} />
      </button>
      {open && (
        <div className="menu down" role="menu" aria-label="Capas del navegador 3D">
          <MenuCap>Cuerpo</MenuCap>
          {layer('Piel', 'navSkin', 'Superficie del tórax')}
          {layer('Hueso', 'showSkeleton', 'Costillas y esternón')}
          <MenuCap>Corazón</MenuCap>
          {layer('Miocardio', 'navHeart', 'Paredes del modelo 3D')}
          {layer('Cavidades', 'navChambers', 'Ventrículos y aurículas')}
          {layer('Válvulas', 'navValves', 'Válvulas y cuerdas')}
          {layer(
            'Segmentos del VI',
            'navSegments',
            'Colorea el miocardio del VI por segmento (también el corte); pasar el ratón: nombre',
          )}
          {layer('Vasos', 'navVessels', 'Aorta torácica y ramas proximales, pulmonar y cavas')}
          <MenuCap>Vistas</MenuCap>
          {layer(
            'Corte de frente',
            'navSplit',
            'Segunda vista: el corazón cortado por el plano, mirando el corte',
          )}
          {layer(
            'Etiquetas del corte',
            'navLabels',
            'Nombres de cámaras y válvulas sobre el corte',
          )}
          <MenuCap>Examen</MenuCap>
          {layer('Ventanas', 'navWindows', 'Ventanas acústicas de las vistas canónicas')}
          {layer('Ejes', 'navAxes', 'Haz, elevación y lateral')}
          {layer('Corte', 'navCut', 'Cortar el corazón por el plano de imagen')}
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------------------------------------
// geometry builders
// ------------------------------------------------------------------------------------------------
