import { useHudStore, useSegmentHover, useSegmentOrientation, useSimStore } from '@/app/store';
import { modePolicy } from '@/app/modePolicy';
import { aha17Info, LV_AHA17, type LvSegmentInfo } from '@/clinical/segmentation/catalog';
import type { SegmentCoverage } from '@/simulator/view-recognition/segmentCoverage';
import { getViewTarget } from '@/simulator/windows/viewDefinitions';
import { Segmented, Toggle } from './controls';
import { SEGMENT_RGB, segmentCss, segmentNames, type SegmentModelChoice } from './segmentMap';

/**
 * LV segment panel (decision 152): the polar map of the model the learner picks — anatomical AHA 17 with the apex cap
 * in the centre, or the 16-segment wall-motion model whose four apical segments reach the centre — coloured by what
 * the current plane shows of each segment, an inspector for the selected one, and the same selection as the cut map.
 * What the plane shows comes from the view analysis (`segmentCoverage`): the tissue the beam crosses, not the view's
 * name. The polar map follows the usual display convention: anterior up, septum left, lateral right, inferior down.
 */
const REASON_ES: Record<string, string> = {
  not_in_plane: 'fuera del plano',
  shadowed: 'en el plano, en sombra acústica',
  insufficient_extent: 'en el plano, corte demasiado pequeño o tangencial',
  insufficient_border_visibility: 'en el plano, borde endocárdico poco visible',
};
const LEVEL_ES: Record<LvSegmentInfo['level'], string> = {
  basal: 'basal',
  mid: 'medio',
  apical: 'apical',
  cap: 'casquete apical',
};
const TERRITORY_ES: Record<LvSegmentInfo['coronaryTerritoryHint'], string> = {
  LAD: 'descendente anterior',
  RCA: 'coronaria derecha',
  LCx: 'circunfleja',
  'LAD/variable': 'descendente anterior, variable',
};

/** State of a segment in the current plane, in words (the colour never carries it alone). */
export function coverageText(c: SegmentCoverage | undefined): string {
  if (!c) return 'sin análisis del corte';
  if (c.assessable) return 'evaluable en este corte';
  return REASON_ES[c.reason ?? ''] ?? 'no evaluable';
}

const SIZE = 232;
const C = SIZE / 2;
const R = 94;

function polar(r: number, thetaDeg: number): [number, number] {
  const t = (thetaDeg * Math.PI) / 180;
  return [C - r * Math.sin(t), C - r * Math.cos(t)];
}

/** Annular wedge between radii ri < ro and display angles t0 < t1 (counter-clockwise, toward the septum). */
function wedgePath(ri: number, ro: number, t0: number, t1: number): string {
  const [x0, y0] = polar(ro, t0);
  const [x1, y1] = polar(ro, t1);
  const large = t1 - t0 > 180 ? 1 : 0;
  if (ri <= 0) return `M${C},${C} L${x0},${y0} A${ro},${ro} 0 ${large} 0 ${x1},${y1} Z`;
  const [x2, y2] = polar(ri, t1);
  const [x3, y3] = polar(ri, t0);
  return `M${x0},${y0} A${ro},${ro} 0 ${large} 0 ${x1},${y1} L${x2},${y2} A${ri},${ri} 0 ${large} 1 ${x3},${y3} Z`;
}

/** Ring radii (fractions of R) of each level in each model. */
function ringOf(level: LvSegmentInfo['level'], model: SegmentModelChoice): [number, number] {
  if (level === 'basal') return [0.72, 1];
  if (level === 'mid') return [0.45, 0.72];
  if (level === 'apical') return model === 'LV_16' ? [0, 0.45] : [0.2, 0.45];
  return [0, 0.2];
}

/**
 * The wall of the polar map nearest an angle of the map (degrees from anterior, counter-clockwise toward the septum),
 * read on the mid ring: where the top of a short-axis image falls on the map (decision 181).
 */
export function wallAtPolarAngle(deg: number): string {
  let best = 7,
    bestD = Infinity;
  for (let id = 7; id <= 12; id++) {
    const c = aha17Info(id)!.polarCentreDeg!;
    const d = Math.abs(((((deg - c + 180) % 360) + 360) % 360) - 180);
    if (d < bestD) {
      bestD = d;
      best = id;
    }
  }
  return aha17Info(best)!.wall;
}

const textOn = (id: number): string => {
  const c = SEGMENT_RGB[id] ?? [0, 0, 0];
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2] > 140 ? '#0b0e12' : '#ffffff';
};

export function SegmentPanel() {
  const view = useHudStore((h) => h.hud?.view ?? null);
  const mode = useSimStore((s) => s.mode);
  const model = useSimStore((s) => s.ui.segmentModel);
  const selected = useSimStore((s) => s.ui.selectedSegment);
  const navSegments = useSimStore((s) => s.ui.navSegments);
  const hovered = useSegmentHover((h) => h.id);
  const setHover = useSegmentHover((h) => h.setHover);
  const upDeg = useSegmentOrientation((o) => o.upDeg);
  const insertions = useSegmentOrientation((o) => o.insertions);
  const setUi = useSimStore((s) => s.setUi);
  if (!modePolicy(mode).hintsEnabled) return null;
  const coverage = view ? (model === 'LV_AHA17' ? view.segments.aha17 : view.segments.lv16) : [];
  const covOf = (id: number) => coverage.find((c) => c.segmentId === id);
  const segments = LV_AHA17.filter((s) => model === 'LV_AHA17' || s.id !== 17);
  const select = (id: number | null) => setUi({ selectedSegment: id === selected ? null : id });
  const assessable = coverage.filter((c) => c.assessable).map((c) => c.segmentId);
  const partial = coverage.filter((c) => c.inPlane && !c.assessable);
  const info = selected ? aha17Info(selected) : null;
  const names = selected ? segmentNames(selected, model) : null;
  const cov = selected ? covOf(selected) : undefined;
  return (
    <div className="segment-panel" aria-label="Segmentos del ventrículo izquierdo">
      <Segmented<SegmentModelChoice>
        ariaLabel="Modelo de segmentación"
        value={model}
        onChange={(m) =>
          setUi({
            segmentModel: m,
            selectedSegment: m === 'LV_16' && selected === 17 ? null : selected,
          })
        }
        options={[
          {
            id: 'LV_AHA17',
            label: '17 · anatómico',
            title:
              'AHA 17 segmentos: identidad anatómica; el 17 es el casquete apical, sin cavidad',
          },
          {
            id: 'LV_16',
            label: '16 · motilidad',
            title:
              'Modelo de 16 segmentos para la motilidad regional: los cuatro apicales cubren todo el ápex',
          },
        ]}
      />
      <Toggle
        label="Colorear segmentos (corte y corazón 3D)"
        value={navSegments}
        onChange={(v) =>
          setUi({ navSegments: v, navSplit: v ? true : useSimStore.getState().ui.navSplit })
        }
        title="El mapa del corte y el corazón 3D colorean el miocardio del VI según el segmento de cada tejido; el corte además numera los que atraviesa el plano"
      />
      <svg
        className="bullseye"
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        width={SIZE}
        height={SIZE}
        role="group"
        aria-label={`Mapa polar, modelo de ${model === 'LV_AHA17' ? '17' : '16'} segmentos: anterior arriba, septo a la izquierda`}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setUi({ selectedSegment: null });
        }}
      >
        {segments.map((s) => {
          const c = covOf(s.id);
          const state = !c ? 'unknown' : c.assessable ? 'ok' : c.inPlane ? 'partial' : 'out';
          const [fi, fo] = ringOf(s.level, model);
          const isSel = selected === s.id;
          const label = `Segmento ${s.id}, ${segmentNames(s.id, model).es}: ${coverageText(c)}`;
          const [tx, ty] =
            s.polarCentreDeg === null ? [C, C] : polar(((fi + fo) / 2) * R, s.polarCentreDeg);
          const fill =
            state === 'ok' ? segmentCss(s.id) : state === 'partial' ? segmentCss(s.id) : '#262c36';
          return (
            <g
              key={s.id}
              role="button"
              tabIndex={0}
              aria-pressed={isSel}
              aria-label={label}
              className={`bullseye-seg ${state}${isSel ? ' selected' : ''}${hovered === s.id ? ' hovered' : ''}`}
              onClick={() => select(s.id)}
              onMouseEnter={() => setHover(s.id, 'polar')}
              onMouseLeave={() => setHover(null, 'polar')}
              onFocus={() => setHover(s.id, 'polar')}
              onBlur={() => setHover(null, 'polar')}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  select(s.id);
                }
              }}
            >
              <title>{label}</title>
              {s.polarCentreDeg === null ? (
                <circle
                  cx={C}
                  cy={C}
                  r={fo * R}
                  fill={fill}
                  fillOpacity={state === 'partial' ? 0.35 : 1}
                />
              ) : (
                <path
                  d={wedgePath(
                    fi * R,
                    fo * R,
                    s.polarCentreDeg - s.polarWidthDeg! / 2,
                    s.polarCentreDeg + s.polarWidthDeg! / 2,
                  )}
                  fill={fill}
                  fillOpacity={state === 'partial' ? 0.35 : 1}
                />
              )}
              <text
                x={tx}
                y={ty}
                textAnchor="middle"
                dominantBaseline="central"
                fill={state === 'ok' ? textOn(s.id) : state === 'partial' ? '#ffffff' : '#8b95a5'}
              >
                {s.id}
              </text>
            </g>
          );
        })}
        {upDeg !== null && (
          <path
            className="bullseye-up"
            d={(() => {
              const [x0, y0] = polar(R + 2, upDeg);
              const [x1, y1] = polar(R + 12, upDeg - 5);
              const [x2, y2] = polar(R + 12, upDeg + 5);
              return `M${x0},${y0} L${x1},${y1} L${x2},${y2} Z`;
            })()}
            fill="#ffffff"
            stroke="#0b0e12"
            strokeWidth={1}
          >
            <title>Arriba en la imagen (hacia la sonda)</title>
          </path>
        )}
        <text x={C} y={10} className="bullseye-dir" textAnchor="middle">
          anterior
        </text>
        <text x={C} y={SIZE - 4} className="bullseye-dir" textAnchor="middle">
          inferior
        </text>
        <text
          x={11}
          y={C}
          className="bullseye-dir"
          textAnchor="middle"
          transform={`rotate(-90 11 ${C})`}
        >
          septo
        </text>
        <text
          x={SIZE - 11}
          y={C}
          className="bullseye-dir"
          textAnchor="middle"
          transform={`rotate(90 ${SIZE - 11} ${C})`}
        >
          lateral
        </text>
      </svg>
      <ul className="bullseye-legend">
        <li>
          <i className="sw ok" /> evaluable en este corte
        </li>
        <li>
          <i className="sw partial" /> en el plano, no evaluable
        </li>
        <li>
          <i className="sw out" /> fuera del plano
        </li>
      </ul>
      {upDeg !== null && (
        <div className="small segment-orientation">
          ▲ Arriba en la imagen, hacia la sonda, queda la pared {wallAtPolarAngle(upDeg)} del mapa:
          en un eje corto la posición horaria depende de la ventana, y los segmentos se reconocen
          por las inserciones del VD.
          {insertions &&
            ' Los triángulos ámbar de la imagen marcan esas inserciones: el tabique (2, 3, 8 y 9) queda entre ellas.'}
        </div>
      )}
      <div className="small segment-summary" aria-live="polite">
        {view ? (
          <>
            En este corte:{' '}
            {assessable.length
              ? `evaluables ${assessable.join(', ')}`
              : 'ningún segmento evaluable'}
            {partial.length > 0 &&
              ` · en el plano sin evaluar ${partial
                .map((p) => `${p.segmentId} (${REASON_ES[p.reason ?? ''] ?? ''})`)
                .join(', ')}`}
            . Calculado del tejido que corta el plano, no del nombre de la vista.
          </>
        ) : (
          'Analizando el corte…'
        )}
      </div>
      {info && names && (
        <div className="segment-inspector" aria-live="polite">
          <div className="segment-title">
            <span
              className="segment-chip"
              style={{ background: segmentCss(info.id), color: textOn(info.id) }}
            >
              {info.id}
            </span>
            <b>{names.es}</b>
            <span className="small"> · {names.en}</span>
          </div>
          <dl>
            <dt>Nivel</dt>
            <dd>
              {LEVEL_ES[info.level]}
              {model === 'LV_16' && info.level === 'apical'
                ? ' (con el casquete de su cuadrante)'
                : ''}
            </dd>
            <dt>Vistas de referencia</dt>
            <dd>
              {info.canonicalViews.length
                ? info.canonicalViews.map((v) => getViewTarget(v).name).join(', ')
                : 'ninguna propia: se ve en cortes apicales que alcanzan el ápex'}
            </dd>
            <dt>En este corte</dt>
            <dd>
              {coverageText(cov)}
              {cov && cov.inPlane
                ? ` · ${cov.areaCm2.toFixed(1).replace('.', ',')} cm², ${cov.lengthCm.toFixed(1).replace('.', ',')} cm${
                    cov.borderContrast !== null
                      ? `, contraste del borde ${cov.borderContrast > 0 ? '+' : ''}${cov.borderContrast}`
                      : ''
                  }`
                : ''}
            </dd>
            <dt>Territorio coronario habitual</dt>
            <dd>{TERRITORY_ES[info.coronaryTerritoryHint]} (orientativo: la irrigación varía)</dd>
            {model === 'LV_AHA17' && info.id === 17 && (
              <>
                <dt>Motilidad</dt>
                <dd>no se puntúa: el modelo de 16 reparte el ápex entre 13–16</dd>
              </>
            )}
          </dl>
        </div>
      )}
    </div>
  );
}
