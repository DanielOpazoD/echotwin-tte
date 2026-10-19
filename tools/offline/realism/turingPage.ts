/**
 * The reader's page of the Turing test (decision 344): one clip at a time, in the order of the sitting, without the
 * key. For each clip the reader says real or simulated, how sure (1–3) and what gave it away; the answers are kept in
 * the browser as they go (localStorage, per sitting) and saved at the end as `respuestas-<lector>.json`, the file
 * `turing.ts --grade` scores. It works from file:// with no server.
 */
import { GIVEAWAYS, type Trial } from '@/clinical/realism/turing';

const GIVEAWAY_LABELS: Record<(typeof GIVEAWAYS)[number], string> = {
  textura: 'Textura / speckle',
  movimiento: 'Movimiento',
  anatomia: 'Anatomía o proporciones',
  bordes: 'Bordes demasiado nítidos o lisos',
  ruido: 'Ruido, ganancia, fondo de las cavidades',
  artefactos: 'Artefactos (o su ausencia)',
  brillo: 'Brillo o contraste',
  formato: 'Formato, sector o resolución',
};

const esc = (s: string): string =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );

export function turingPage(trial: Pick<Trial, 'clips'>, seed: number): string {
  // the format travels with each clip (both sources share it): EchoNet's 112-px frames are drawn larger
  const clips = JSON.stringify(
    trial.clips.map((c) => ({ n: c.n, file: c.file, small: c.view.endsWith('echonet-clip') })),
  );
  const giveaways = GIVEAWAYS.map(
    (g) =>
      `<label class="chk"><input type="checkbox" name="g" value="${g}"> ${esc(GIVEAWAY_LABELS[g])}</label>`,
  ).join('');
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Prueba de Turing visual</title>
<style>
:root{--bg:#0d0d0f;--fg:#e8e8ea;--mute:#9a9aa2;--line:#2a2a30;--acc:#7fb2ff}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.45 system-ui,-apple-system,Segoe UI,sans-serif}
main{max-width:980px;margin:0 auto;padding:16px}h1{font-size:20px;margin:8px 0 12px}p{color:var(--mute);margin:6px 0}
.panel{border:1px solid var(--line);border-radius:8px;padding:16px;margin:12px 0}
.row{display:flex;gap:20px;flex-wrap:wrap;align-items:flex-start}
.media{background:#000;border-radius:6px;display:flex;align-items:center;justify-content:center;min-width:300px;min-height:300px;flex:1 1 480px}
.media video,.media img{max-width:100%;max-height:72vh;display:block;image-rendering:auto}
.media .small{width:448px;height:448px}
.form{flex:1 1 300px}fieldset{border:1px solid var(--line);border-radius:6px;margin:0 0 12px;padding:10px}
legend{color:var(--mute);padding:0 6px}label{display:block;margin:4px 0;cursor:pointer}.chk{font-size:14px}
button{background:var(--acc);color:#000;border:0;border-radius:6px;padding:9px 16px;font:inherit;cursor:pointer}
button:disabled{opacity:.35;cursor:default}input[type=text],textarea{width:100%;background:#16161a;color:var(--fg);border:1px solid var(--line);border-radius:6px;padding:7px;font:inherit}
.prog{color:var(--mute);font-size:13px}.hidden{display:none}
</style></head><body><main>
<section id="start" class="panel">
<h1>Prueba de Turing visual</h1>
<p>Verás ${trial.clips.length} imágenes o clips ecocardiográficos, uno a uno. Algunos son de pacientes reales y otros del simulador, en la misma proporción en cada vista y el mismo formato. Para cada uno di si te parece real o simulado, cuán seguro estás y qué te lo indicó. No hay vuelta atrás ni clave en esta página.</p>
<p>Tus respuestas se guardan en este navegador mientras avanzas; al final se descarga un archivo con ellas.</p>
<label>Nombre o iniciales <input type="text" id="reader" autocomplete="off"></label>
<label class="chk"><input type="checkbox" id="echo"> Leo ecocardiogramas habitualmente</label>
<p><button id="go">Empezar</button></p>
</section>
<section id="trial" class="hidden">
<div class="prog" id="prog"></div>
<div class="row">
<div class="media" id="media"></div>
<div class="form">
<fieldset><legend>¿Real o simulado?</legend>
<label><input type="radio" name="call" value="real"> Real</label>
<label><input type="radio" name="call" value="sim"> Simulado</label></fieldset>
<fieldset><legend>Seguridad</legend>
<label><input type="radio" name="conf" value="1"> 1 · adivino</label>
<label><input type="radio" name="conf" value="2"> 2 · bastante seguro</label>
<label><input type="radio" name="conf" value="3"> 3 · seguro</label></fieldset>
<fieldset><legend>¿Qué te lo indicó? (opcional)</legend>${giveaways}
<textarea id="note" rows="2" placeholder="Otra cosa…"></textarea></fieldset>
<button id="next" disabled>Siguiente</button>
</div></div></section>
<section id="done" class="panel hidden"><h1>Gracias</h1>
<p>Se descargó <code id="fname"></code>. Si no, pulsa el botón. Entrégalo a quien te pasó la prueba: la corrección está en la clave, que esta página no tiene.</p>
<p><button id="save">Descargar respuestas</button></p></section>
</main>
<script>
const CLIPS=${clips};const SEED=${seed};const KEY='turing-'+SEED;
let st=null;try{st=JSON.parse(localStorage.getItem(KEY)||'null')}catch(e){}
const $=(id)=>document.getElementById(id);
function save(){try{localStorage.setItem(KEY,JSON.stringify(st))}catch(e){}}
function sheet(){return{reader:st.reader,echoReader:st.echoReader,startedAt:st.startedAt,seed:SEED,answers:st.answers}}
function download(){const b=new Blob([JSON.stringify(sheet(),null,2)],{type:'application/json'});const a=document.createElement('a');const f='respuestas-'+(st.reader||'lector').replace(/[^a-z0-9_-]/gi,'_')+'-'+SEED+'.json';a.href=URL.createObjectURL(b);a.download=f;a.click();$('fname').textContent=f}
let t0=0;
function show(){const i=st.answers.length;if(i>=CLIPS.length){$('trial').classList.add('hidden');$('done').classList.remove('hidden');download();return}
const c=CLIPS[i];$('prog').textContent='Clip '+(i+1)+' de '+CLIPS.length;const m=$('media');m.replaceChildren();
const small=c.small;let el;
if(/\\.(mp4|webm)$/.test(c.file)){el=document.createElement('video');el.src=c.file;el.autoplay=true;el.loop=true;el.muted=true;el.playsInline=true}else{el=document.createElement('img');el.src=c.file;el.alt='imagen '+(i+1)}
if(small)el.className='small';m.appendChild(el);
document.querySelectorAll('input[name=call],input[name=conf],input[name=g]').forEach(x=>x.checked=false);$('note').value='';$('next').disabled=true;t0=performance.now()}
function ready(){$('next').disabled=!(document.querySelector('input[name=call]:checked')&&document.querySelector('input[name=conf]:checked'))}
document.querySelectorAll('input[name=call],input[name=conf]').forEach(x=>x.addEventListener('change',ready));
$('next').onclick=()=>{const c=CLIPS[st.answers.length];st.answers.push({n:c.n,call:document.querySelector('input[name=call]:checked').value,confidence:Number(document.querySelector('input[name=conf]:checked').value),giveaways:[...document.querySelectorAll('input[name=g]:checked')].map(x=>x.value),note:$('note').value.trim()||undefined,ms:Math.round(performance.now()-t0)});save();show()};
$('go').onclick=()=>{if(!st||st.answers.length>=CLIPS.length)st={reader:$('reader').value.trim(),echoReader:$('echo').checked,startedAt:new Date().toISOString(),answers:[]};save();$('start').classList.add('hidden');$('trial').classList.remove('hidden');show()};
$('save').onclick=download;
if(st&&st.answers.length&&st.answers.length<CLIPS.length){$('reader').value=st.reader;$('echo').checked=st.echoReader;$('go').textContent='Seguir (van '+st.answers.length+')'}
</script></body></html>
`;
}
