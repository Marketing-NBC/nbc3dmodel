/**
 * Beeldkwaliteit: scherp beeld tijdens beweging, op elk apparaat.
 *
 * Waarom het model onscherp werd zodra je draait/zoomt
 * ----------------------------------------------------
 * De Spline-runtime rendert zonder MSAA en gebruikt temporal anti-aliasing
 * (TAA): elk frame wordt een subpixel verschoven (Halton-jitter) en de
 * resolve-shader mengt 10% nieuw frame met 90% van de (gereprojecteerde)
 * historie. Stilstaand geeft dat na ~30 frames een strak, supersampled beeld.
 * Zodra de camera beweegt wordt die historie elk frame opnieuw verschoven en
 * geresampled (Catmull-Rom); met 90% terugkoppeling stapelt die vervaging
 * zich op tot een duidelijk "smerend" beeld. Door de orbit-damping beweegt
 * de camera bovendien nog even door na het loslaten, dus de blur is lang
 * zichtbaar en het beeld "springt" daarna weer scherp.
 *
 * Wat deze module doet
 * --------------------
 * 1. TAA-resolve-shader runtime patchen: de historie-weging hangt af van
 *    beweging. Twee signalen, het sterkste wint:
 *    - `nbcMotion` (uniform, uit JS): 1 zolang de camera van positie,
 *      rotatie of projectie verandert, daarna in een paar frames terug naar
 *      0. Dit is framerate-onafhankelijk: op een echte GPU bij 60-120 fps
 *      beweegt de camera per frame maar een fractie van een pixel, dus een
 *      drempel op pixelsnelheid alleen pakt dat niet.
 *    - de pixelsnelheid uit de velocity-buffer (voor bewegende objecten).
 *    Stilstaand blijft de runtime-standaard (0.1 nieuw / 0.9 historie) zodat
 *    het beeld nog steeds mooi convergeert; in beweging gaat het aandeel nieuw
 *    frame omhoog zodat er nauwelijks smeer overblijft.
 * 2. Pixel ratio: de scènes staan op "auto" (= devicePixelRatio). We volgen
 *    DPR-wijzigingen (venster naar ander scherm, browserzoom), wat de runtime
 *    zelf niet doet, en begrenzen op `maxPixelRatio`.
 * 3. Adaptief: renderen tijdens interactie structureel te traag → één stap
 *    lagere pixel ratio (nooit onder 1). Liever iets minder pixels dan een
 *    diashow; scherpte in beweging komt vooral uit punt 1.
 *
 * Alles werkt op de gevendorde runtime in vendor/spline/ (1.12.98). Als een
 * toekomstige runtime de shader anders opbouwt, wordt de patch overgeslagen
 * met een console.warn — de viewer blijft dan gewoon werken.
 */

export const QUALITY_DEFAULTS = {
  motionSharpening: true,
  alphaStatic: 0.1,   // runtime-standaard: aandeel nieuw frame bij stilstand
  alphaMoving: 0.5,   // aandeel nieuw frame bij (volle) beweging
  speedPx: 0.25,      // px/frame waarbij de overgang naar alphaMoving compleet is
  cameraMotion: true, // camerabeweging uit JS als bewegingssignaal
  motionDecay: 0.5,   // per frame: nbcMotion *= motionDecay zodra de camera stilstaat
  maxPixelRatio: 3,   // bovengrens voor devicePixelRatio (adaptief regelt de rest)
  pixelRatio: null,   // vaste waarde (tests/debug); null = automatisch
  adaptive: true,     // stap terug in pixel ratio bij structureel trage frames
  slowFrameMs: 45,    // frame trager dan dit telt als "traag" (~22 fps)
  minPixelRatio: 1,
};

const IS_MOBILE = typeof navigator !== 'undefined' && (
  /Mobi|Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
  // iPadOS meldt zich als Macintosh, maar heeft touch
  (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1));

const fmt = (n) => {
  const s = String(Number(n));
  return /[.e]/i.test(s) ? s : s + '.0';
};

/** De regel in de TAA-resolve-shader die de vaste 90%-terugkoppeling doet. */
const TAA_BLEND_RE = /const float alpha\s*=\s*0\.1\s*;\s*vec4 result\s*=\s*mix\(\s*currentColor\s*,\s*previousColorClipped\s*,\s*1\.0\s*-\s*alpha\s*\)\s*;/;

function getTaaMaterial(app) {
  const mat = app && app._renderer && app._renderer.pipeline && app._renderer.pipeline.taaPass
    && app._renderer.pipeline.taaPass.resolveMaterial;
  return mat && typeof mat.fragmentShader === 'string' ? mat : null;
}

/**
 * Patcht (of herstelt) de TAA-resolve-shader. Geeft true als de patch actief is.
 * `velocity` (vec2, uv-eenheden) en `resolution` (vec2, px) bestaan al in de
 * shader; de snelheid in pixels per frame stuurt de weging.
 */
function patchTaa(app, params) {
  const mat = getTaaMaterial(app);
  if (!mat) return false;
  if (!mat.__nbcOriginalFragment) mat.__nbcOriginalFragment = mat.fragmentShader;
  const original = mat.__nbcOriginalFragment;
  let next = original;
  if (params.motionSharpening) {
    if (!TAA_BLEND_RE.test(original)) {
      console.warn('quality: TAA-resolve-shader heeft een onbekende opbouw; motion-sharpening overgeslagen.');
      return false;
    }
    next = original.replace(TAA_BLEND_RE,
      `float nbcSpeedPx=length(velocity*resolution);` +
      `float nbcMove=max(nbcMotion,smoothstep(0.0,${fmt(params.speedPx)},nbcSpeedPx));` +
      `float alpha=mix(${fmt(params.alphaStatic)},${fmt(params.alphaMoving)},nbcMove);` +
      `vec4 result=mix(currentColor,previousColorClipped,1.0-alpha);`);
    // uniform declareren vóór main()
    next = next.replace(/void main\(\)\{/, 'uniform float nbcMotion;void main(){');
    if (!mat.uniforms.nbcMotion) mat.uniforms.nbcMotion = { value: 0 };
  }
  if (mat.fragmentShader !== next) {
    mat.fragmentShader = next;
    mat.needsUpdate = true;
  }
  return next !== original;
}

/**
 * Camerabeweging detecteren: vergelijkt per frame positie, rotatie en
 * projectie van de actieve camera en zet het resultaat in de `nbcMotion`-
 * uniform van de TAA-resolve-shader. Gehaakt vóór renderSplineScene, zodat
 * het huidige frame meteen de juiste weging krijgt.
 */
function hookCameraMotion(app, params, state) {
  const renderer = app._renderer;
  if (!renderer || typeof renderer.renderSplineScene !== 'function') return () => {};
  const original = renderer.renderSplineScene;
  const prev = new Float64Array(3 + 4 + 16);
  let primed = false;
  let motion = 0;
  const wrapped = function (scene, camera, ...rest) {
    try {
      const mat = getTaaMaterial(app);
      const u = mat && mat.uniforms && mat.uniforms.nbcMotion;
      if (u && camera) {
        const p = camera.position, q = camera.quaternion, m = camera.projectionMatrix && camera.projectionMatrix.elements;
        let changed = false;
        const cur = [p.x, p.y, p.z, q.x, q.y, q.z, q.w];
        if (m) for (let i = 0; i < 16; i++) cur.push(m[i]);
        for (let i = 0; i < cur.length; i++) {
          if (Math.abs(cur[i] - prev[i]) > 1e-7) changed = true;
          prev[i] = cur[i];
        }
        if (!primed) { primed = true; changed = false; }
        if (changed) motion = 1;
        else { motion *= params.motionDecay; if (motion < 0.03) motion = 0; }
        u.value = params.cameraMotion && params.motionSharpening ? motion : 0;
        state.cameraMoving = motion > 0;
      }
    } catch (e) { /* nooit het renderen blokkeren */ }
    return original.call(this, scene, camera, ...rest);
  };
  renderer.renderSplineScene = wrapped;
  return () => { if (renderer.renderSplineScene === wrapped) delete renderer.renderSplineScene; };
}

/**
 * Pas de kwaliteitsinstellingen toe op een geladen Spline Application.
 * Aanroepen ná `app.load()`; geeft een controller met `dispose()` terug
 * (aanroepen vóór het laden van een nieuwe scène).
 */
export function applyQuality(app, options = {}) {
  const params = { ...QUALITY_DEFAULTS, ...options };
  const renderer = app._renderer;
  const state = {
    taaPatched: false,
    pixelRatio: renderer && typeof renderer.getPixelRatio === 'function' ? renderer.getPixelRatio() : 1,
    devicePixelRatio: window.devicePixelRatio || 1,
    stepsDown: 0,
    mobile: IS_MOBILE,
    cameraMoving: false,
  };
  let disposed = false;

  function setPixelRatio(value) {
    if (disposed || !app._renderer) return;
    const v = Math.max(0.5, Math.min(4, Number(value) || 1));
    if (Math.abs(v - state.pixelRatio) < 1e-3) return;
    app._renderer.setPixelRatio(v);
    // De renderer past een nieuwe ratio pas toe bij een maatwijziging;
    // _resize(true) forceert dat (zelfde truc als de runtime bij DOF-resize).
    if (typeof app._resize === 'function') app._resize(true);
    state.pixelRatio = v;
    app.requestRender && app.requestRender();
  }

  function targetPixelRatio() {
    if (params.pixelRatio != null) return params.pixelRatio;
    const dpr = window.devicePixelRatio || 1;
    const capped = Math.min(dpr, params.maxPixelRatio);
    // eerder teruggeschakeld? die stap(pen) behouden
    return Math.max(params.minPixelRatio, capped * Math.pow(0.75, state.stepsDown));
  }

  function applyPixelRatio() {
    state.devicePixelRatio = window.devicePixelRatio || 1;
    setPixelRatio(targetPixelRatio());
  }

  /* --- DPR-wijzigingen volgen (ander scherm, browserzoom) --- */
  let mq = null;
  function watchDpr() {
    if (disposed || typeof window.matchMedia !== 'function') return;
    try {
      mq = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
      const onChange = () => { if (mq) mq.removeEventListener('change', onChange); applyPixelRatio(); watchDpr(); };
      mq.addEventListener('change', onChange);
      mq.__nbcOnChange = onChange;
    } catch (e) { mq = null; }
  }

  /* --- adaptief: trage frames tijdens renderen → stap terug --- */
  let lastFrame = 0, frames = 0, slowFrames = 0, warmup = 0;
  const onRendered = () => {
    const now = performance.now();
    const dt = now - lastFrame;
    lastFrame = now;
    if (!params.adaptive) return;
    if (warmup < 60) { warmup++; return; }          // shadercompilatie/opwarmen negeren
    if (dt <= 0 || dt > 250) return;                // pauze tussen interacties
    frames++;
    if (dt > params.slowFrameMs) slowFrames++;
    if (frames >= 45) {
      if (slowFrames > frames * 0.6 && state.pixelRatio > params.minPixelRatio + 1e-3) {
        state.stepsDown++;
        applyPixelRatio();
        console.info(`quality: renderen traag (${Math.round(slowFrames / frames * 100)}% frames > ${params.slowFrameMs}ms) → pixel ratio ${state.pixelRatio}`);
      }
      frames = 0; slowFrames = 0;
    }
  };

  /* --- start --- */
  state.taaPatched = patchTaa(app, params);
  const unhookCamera = hookCameraMotion(app, params, state);
  applyPixelRatio();
  watchDpr();
  app.canvas.addEventListener('rendered', onRendered);

  return {
    get state() { return { ...state, params: { ...params } }; },
    /** motion-sharpening aan/uit (debug/test) */
    setMotionSharpening(on) {
      params.motionSharpening = !!on;
      state.taaPatched = patchTaa(app, params);
      app.requestRender && app.requestRender();
      return state.taaPatched;
    },
    /** TAA-parameters aanpassen (alphaStatic, alphaMoving, speedPx) */
    setTaaParams(p) {
      Object.assign(params, p);
      state.taaPatched = patchTaa(app, params);
      app.requestRender && app.requestRender();
      return state.taaPatched;
    },
    setPixelRatio,
    dispose() {
      disposed = true;
      unhookCamera();
      app.canvas.removeEventListener('rendered', onRendered);
      if (mq && mq.__nbcOnChange) { try { mq.removeEventListener('change', mq.__nbcOnChange); } catch (e) {} }
      mq = null;
    },
  };
}
