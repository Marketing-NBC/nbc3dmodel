/**
 * NBC 3D plattegrond — branding-module
 *
 * Past event-branding toe op een geladen Spline-scène (@splinetool/runtime):
 *
 *  1. Schermafbeeldingen vervangen. Alle afbeeldingen van de scène leven in
 *     `app._sharedAssetsManager.imageHolderCache`. Elke "holder" heeft een
 *     naam (bijv. "Event Hall Scherm - Deel 1_2-8.png"), de gedecodeerde
 *     afbeelding (`img`) en de daaruit gemaakte THREE-textures (cache).
 *     We vervangen de afbeelding in-place, waardoor élk scherm dat die
 *     asset gebruikt automatisch mee verandert.
 *
 *  2. Lichten omkleuren naar de 2 huisstijlkleuren.
 *
 * Rollen (schermgroepen) worden op asset-naam herkend; per rol kan een eigen
 * afbeelding worden geüpload, anders valt hij terug op een gegenereerde
 * huisstijl-afbeelding (kleurverloop + logo).
 */

/** Asset-naam → rol. Volgorde bepaalt prioriteit. */
export const SCREEN_ROLES = [
  { role: 'pilaren',       pattern: /logo\s*pilaar/i,                          label: 'LED-pilaren (logo)' },
  { role: 'eventhall',     pattern: /event\s*hall\s*scherm/i,                  label: 'Groot scherm Event Hall' },
  { role: 'ledwall',       pattern: /led\s*wall\s*entree/i,                    label: 'LED-wall entree' },
  { role: 'narrowcasting', pattern: /narrowcasting|registratie\s*schermen/i,   label: 'Registratie-/narrowcasting-schermen' },
  { role: 'tv',            pattern: /\btv\b|trio\s*scherm|presentatie/i,       label: 'TV-/presentatieschermen' },
];

/** Assets die nooit vervangen mogen worden (omgevings-textures e.d.). */
const PROTECTED_ASSETS = /matcap|tree-branch|empty|video/i;

/**
 * Meegeleverde Event Hall-decors (bestanden in assets/decors/).
 * Sleutel = presetnaam in de config ("preset:<naam>"), waarde = bestandsnaam.
 * Wordt gebruikt door de viewer (omzetten naar afbeelding) én de
 * beheeromgeving (dropdown + beschikbaarheidscheck).
 */
export const DECOR_PRESETS = {
  'blauw': 'blauw.jpg',
  'blauw-glas': 'blauw-glas.jpg',
  'wit': 'wit.jpg',
  'geel': 'geel.png',
  'boeken': 'Books decor.jpg',
  'wit-architectuur': 'Organic Beige.jpg',
  'blauw-goud': 'Extruded boxes.jpg',
  'rood': 'FrostedGlass rood.png',
};

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Kan afbeelding niet laden: ' + String(src).slice(0, 80)));
    img.src = src;
  });
}

/**
 * Genereer een huisstijl-afbeelding: verloop kleur 1 → kleur 2 met
 * gecentreerd logo, in de beeldverhouding van het oorspronkelijke scherm.
 */
export function makeBrandCanvas({ logoImg = null, primary, secondary, width = 1280, height = 720 }) {
  const c = document.createElement('canvas');
  c.width = width; c.height = height;
  const ctx = c.getContext('2d');
  const grad = ctx.createLinearGradient(0, 0, width, height);
  grad.addColorStop(0, primary);
  grad.addColorStop(1, secondary || primary);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height);
  if (logoImg) {
    const pad = 0.16;
    const s = Math.min((width * (1 - pad * 2)) / logoImg.width, (height * (1 - pad * 2)) / logoImg.height);
    const w = logoImg.width * s, h = logoImg.height * s;
    ctx.drawImage(logoImg, (width - w) / 2, (height - h) / 2, w, h);
  }
  return c;
}

/** Alle image-holders van een geladen app, met naam en formaat. */
export function listImageAssets(app) {
  const cache = app?._sharedAssetsManager?.imageHolderCache?.cache;
  if (!cache) return [];
  const entries = cache instanceof Map ? [...cache.values()] : Object.values(cache);
  return entries
    .map((holder) => ({
      holder,
      name: holder?.name || holder?.data?.name || '',
      width: holder?.img?.width || null,
      height: holder?.img?.height || null,
      isVideo: !!holder?.isVideo,
    }))
    .filter((e) => e.name || e.width);
}

/**
 * Vind alle THREE-textures die bij een holder horen.
 * De live textures zitten in `holder._cache`, een genest object met
 * numerieke sleutels (bijv. _cache[1001][1008][1006] → Texture).
 * NB: `holder.cache` is een terugverwijzing naar de volledige assets-cache
 * en moet dus NIET doorlopen worden.
 */
function holderTextures(holder) {
  const found = [];
  const seen = new Set();
  const scan = (v, depth) => {
    if (!v || typeof v !== 'object' || depth > 6 || seen.has(v)) return;
    seen.add(v);
    if (v.isTexture) { found.push(v); return; }
    if (v instanceof Map) { for (const x of v.values()) scan(x, depth + 1); return; }
    if (Array.isArray(v)) { for (const x of v) scan(x, depth + 1); return; }
    for (const k of Object.keys(v)) {
      if (k === 'shared' || k === 'thisContext') continue;
      scan(v[k], depth + 1);
    }
  };
  scan(holder._cache, 0);
  return found;
}

/** Vervang de afbeelding van een holder (en al zijn textures) in-place. */
export function swapHolderImage(holder, imageLike) {
  holder.img = imageLike;
  for (const tex of holderTextures(holder)) {
    if (tex.source && 'data' in tex.source) tex.source.data = imageLike;
    tex.image = imageLike;
    tex.needsUpdate = true;
    if (tex.source) tex.source.needsUpdate = true;
  }
}

/**
 * Logo-canvas voor de pilaar-logoband. De band toont het 426×191-canvas
 * GEROTEERD (canvas-x = verticaal op de band) en met verschillende schaal per
 * as: canvas-x beslaat ~40,1 wereld-eenheden (bandhoogte), canvas-y ~7,2
 * (bandbreedte). Het logo wordt daarom voorvervormd getekend, zodat het ná
 * de mapping exact de originele verhouding heeft — gecentreerd in beide
 * richtingen (dus in het verticale midden van de band).
 */
function pillarBandLogoCanvas(logoImg, w = 426, h = 191, pad = 0.05) {
  // Bandlengte volgt uit de hiddenMatrix-kalibratie van de pilaarvlakken:
  // 123,0 wereld bij hm-schaal 12,95 (full-fill) → 9,498 wereld per hm-eenheid,
  // dus de band (hm-schaal 4,09) is 4,09 × 9,498 ≈ 38,85 wereld lang. De
  // eerdere 40,1 kwam uit de three.js-matrix van het ORIGINELE vlak, maar de
  // gebakken rendermaat wijkt daarvan af — het logo werd daardoor ~3% te kort
  // getekend en oogde net iets te breed.
  const BAND_H_WORLD = 38.85; // verticaal op de pilaar (canvas-x-as)
  const BAND_W_WORLD = 7.2;   // horizontaal (canvas-y-as)
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  const pxPerWorldX = w / BAND_H_WORLD;  // langs de band (verticaal)
  const pxPerWorldY = h / BAND_W_WORLD;  // dwars op de band
  const maxAlong = BAND_H_WORLD * (1 - pad * 2);
  const maxAcross = BAND_W_WORLD * (1 - pad * 2);
  const lw = logoImg.width, lh = logoImg.height;
  if (lw >= lh) {
    // liggend logo → gedraaid op de band (verticaal lezend, zoals het
    // NBC-origineel): logo-breedte langs de band, hoogte dwars
    const s = Math.min(maxAlong / lw, maxAcross / lh);
    const drawW = lw * s * pxPerWorldX;
    const drawH = lh * s * pxPerWorldY;
    ctx.drawImage(logoImg, (w - drawW) / 2, (h - drawH) / 2, drawW, drawH);
  } else {
    // staand logo → rechtop op de band: logo-hoogte langs de band,
    // breedte dwars (getekend in het gedraaide stelsel, zodat het na de
    // band-rotatie rechtop staat)
    const s = Math.min(maxAlong / lh, maxAcross / lw);
    const destA = lw * s * pxPerWorldY;  // dwars (canvas-y)
    const destB = lh * s * pxPerWorldX;  // langs (canvas-x)
    ctx.save();
    ctx.translate(0, h);
    ctx.rotate(-Math.PI / 2);
    ctx.drawImage(logoImg, (h - destA) / 2, (w - destB) / 2, destA, destB);
    ctx.restore();
  }
  return c;
}

function roleFor(name) {
  for (const r of SCREEN_ROLES) if (r.pattern.test(name)) return r.role;
  return null;
}

/* ------------------------------------------------------------------ *
 *  Huisstijlkleuren: NBC-verloop (teal → oranje) omzetten             *
 * ------------------------------------------------------------------ */

/** De NBC-merkkleuren zoals ze in de scènes voorkomen (genormaliseerd rgb). */
const NBC_TEAL = [0.145, 0.616, 0.588];
const NBC_ORANGE = [0.867, 0.616, 0.251];
const COLOR_TOLERANCE = 0.13;

function hexToRgb01(hex) {
  const n = parseInt(hex.replace('#', ''), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

const near = (a, b) =>
  Math.abs(a[0] - b[0]) < COLOR_TOLERANCE &&
  Math.abs(a[1] - b[1]) < COLOR_TOLERANCE &&
  Math.abs(a[2] - b[2]) < COLOR_TOLERANCE;

function rgbToHsl([r, g, b]) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return [h * 360, s, l];
}

function hslToRgb([h, s, l]) {
  h = ((h % 360) + 360) % 360 / 360;
  if (s === 0) return [l, l, l];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t) => {
    t = ((t % 1) + 1) % 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [f(h + 1 / 3), f(h), f(h - 1 / 3)];
}

/**
 * Hue-gebaseerde remap voor gradient-stops: alle teal-tinten → EXACT kleur 1,
 * alle oranje-tinten → EXACT kleur 2. Het verloop blijft bestaan doordat de
 * shader tussen de stops interpoleert (kleur 1 → kleur 2); er wordt geen
 * licht/donker-variatie meer bewaard, want dan wijkt de kleur af van wat er
 * in de beheeromgeving gekozen is (vooral zichtbaar bij lichte kleuren).
 * (Alleen op gradientlagen toegepast, zodat meubels e.d. ongemoeid blijven.)
 */
function remapGradientStop(rgb, primaryRgb, secondaryRgb) {
  const [h, s] = rgbToHsl(rgb);
  if (s < 0.2) return null;
  if (h >= 150 && h <= 200) return primaryRgb;   // teal-familie → kleur 1
  if (h >= 15 && h <= 55) return secondaryRgb;   // oranje-familie → kleur 2
  return null;
}

/**
 * Vervang de NBC-merkkleuren (teal/oranje) door de 2 huisstijlkleuren in
 * alle materiaal-lagen: gradient-stops (verloop blijft behouden) én egale
 * kleurlagen. Werkt o.a. op de 9 LED-pilaren en het projectiescherm in de
 * Grand Hall.
 */
export function recolorBrandColors(app, primaryHex, secondaryHex) {
  const p = hexToRgb01(primaryHex);
  const s = hexToRgb01(secondaryHex || primaryHex);
  let changed = 0;

  // egale kleuren: alleen exacte NBC-kleuren (voorzichtig)
  const mapRgb = (rgb) => (near(rgb, NBC_TEAL) ? p : near(rgb, NBC_ORANGE) ? s : null);
  // gradient-stops: hele teal/oranje-familie op hue → exact de gekozen kleuren
  const mapStop = (rgb) => remapGradientStop(rgb, p, s) || mapRgb(rgb);

  const handleUniformValue = (val) => {
    if (!val || typeof val !== 'object') return;
    if (val.isColor) {
      const to = mapRgb([val.r, val.g, val.b]);
      if (to) { val.setRGB(to[0], to[1], to[2]); changed++; }
      return;
    }
    if (Array.isArray(val)) {
      for (const v of val) {
        if (v && typeof v === 'object' && 'x' in v && 'w' in v) {
          const to = mapStop([v.x, v.y, v.z]);
          if (to) { v.x = to[0]; v.y = to[1]; v.z = to[2]; changed++; }
        }
      }
    }
  };

  const mats = new Set();
  app._scene.traverse((o) => {
    if (o.isMesh && o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => mats.add(m));
  });

  for (const m of mats) {
    if (Array.isArray(m.layers)) {
      for (const layer of m.layers) {
        if (layer && layer.uniforms) for (const u of Object.values(layer.uniforms)) handleUniformValue(u && u.value);
        // spiegel ook de data zodat evt. shader-rebuilds dezelfde kleuren houden
        const d = layer && layer.data;
        if (d && Array.isArray(d.colors)) {
          for (const c of d.colors) {
            if (Array.isArray(c) && c.length >= 3) {
              const to = mapStop(c);
              if (to) { c[0] = to[0]; c[1] = to[1]; c[2] = to[2]; }
            }
          }
        }
        if (d && d.color && typeof d.color === 'object' && 'r' in d.color) {
          const to = mapRgb([d.color.r, d.color.g, d.color.b]);
          if (to) { d.color.r = to[0]; d.color.g = to[1]; d.color.b = to[2]; }
        }
      }
    }
    // egale kleurlagen die als node-uniform op het materiaal zelf hangen
    if (m.uniforms) {
      for (const u of Object.values(m.uniforms)) {
        const v = u && u.node && u.node.value;
        if (v && v.isColor) {
          const to = mapRgb([v.r, v.g, v.b]);
          if (to) { v.setRGB(to[0], to[1], to[2]); changed++; }
        }
      }
    }
  }
  return changed;
}

/**
 * De bovenranden/zijkanten van het Event Hall-decor (meshes "Deel_5*",
 * materiaal "O-500") zijn in de scène altijd NBC-oranje — nét buiten de
 * tolerantie van de merkkleur-remap. Maak ze neutraal lichtgrijs zodat ze
 * bij elke huisstijl passen.
 */
export function neutralizeDecorEdges(app, rgb = [0.85, 0.85, 0.85]) {
  let n = 0;
  app._scene.traverse((o) => {
    if (!o.isMesh || !/^Deel_5/.test(o.name || '')) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      if (!m || !Array.isArray(m.layers)) continue;
      for (const layer of m.layers) {
        const d = layer && layer.data;
        if (!d || d.type !== 'color') continue;
        if (d.color && typeof d.color === 'object' && 'r' in d.color) {
          d.color.r = rgb[0]; d.color.g = rgb[1]; d.color.b = rgb[2];
        }
        const u = layer.uniforms || {};
        for (const key of Object.keys(u)) {
          const v = u[key] && u[key].value;
          if (/color/i.test(key) && v && v.isColor) { v.setRGB(rgb[0], rgb[1], rgb[2]); n++; }
        }
      }
    }
  });
  return n;
}

/**
 * Geef de 2 wanden naast het Grand Hall-middenscherm ("Scherm L" / "Scherm R"
 * onder "Links + Rechts" op het Grand Hall-podium) eigen kleuren, los van de
 * huisstijlkleuren. Aanroepen NA recolorBrandColors (deze zet de stops
 * rechtstreeks, ongeacht de huidige kleur).
 */
export function recolorGrandHallWalls(app, primaryHex, secondaryHex) {
  const p = hexToRgb01(primaryHex);
  const s = hexToRgb01(secondaryHex || primaryHex);
  let n = 0;
  app._scene.traverse((o) => {
    if (!o.isMesh || !o.parent || (o.parent.name || '') !== 'Links + Rechts') return;
    const to = o.name === 'Scherm L' ? p : o.name === 'Scherm R' ? s : null;
    if (!to) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      if (!m || !Array.isArray(m.layers)) continue;
      for (const layer of m.layers) {
        const u = (layer && layer.uniforms) || {};
        for (const key of Object.keys(u)) {
          const v = u[key] && u[key].value;
          if (!/_colors$/.test(key) || !Array.isArray(v)) continue;
          for (const stop of v) {
            if (stop && typeof stop.x === 'number') { stop.x = to[0]; stop.y = to[1]; stop.z = to[2]; n++; }
          }
        }
        const d = layer && layer.data;
        if (d && Array.isArray(d.colors)) {
          for (const c of d.colors) {
            if (Array.isArray(c) && c.length >= 3) { c[0] = to[0]; c[1] = to[1]; c[2] = to[2]; }
          }
        }
      }
    }
  });
  return n;
}

/* ------------------------------------------------------------------ *
 *  Opstellingen per hal tonen/verbergen                               *
 * ------------------------------------------------------------------ */

/**
 * Namen van de kinderen onder de "Opstellingen"-container per hal.
 * (De container heet per scène anders: Congres / Feest / Sit down dinner.)
 */
export const HALL_GROUP_NAMES = {
  eventhall: ['Event Hall', 'Sit down dinner 2'],
  grandhall: ['Grand Hall', 'GH - Feest', 'Sit down dinner'],
  hosp1: ['Hosp1', 'Hosp1 - Feest'],
  hosp2: ['Hosp2', 'Hosp2 - Feest'],
};

/**
 * Zet de opstelling (stoelen/barren/tafels) van een hal aan of uit.
 * @param visibility bijv. { eventhall: false, grandhall: true }
 */
export function setHallVisibility(app, visibility = {}) {
  if (!app || !app._scene) return {};
  let container = null;
  app._scene.traverse((o) => {
    if (!container && (o.name || '').trim() === 'Opstellingen' && o.children && o.children.length) {
      container = o.children[0]; // Congres / Feest / Sit down dinner
    }
  });
  if (!container) return {};
  const applied = {};
  for (const [hall, show] of Object.entries(visibility)) {
    const names = HALL_GROUP_NAMES[hall];
    if (!names || typeof show !== 'boolean') continue;
    for (const child of container.children) {
      if (names.includes((child.name || '').trim())) {
        child.visible = show;
        applied[hall] = show;
      }
    }
  }
  if (app.requestRender) app.requestRender();
  return applied;
}

/* ------------------------------------------------------------------ *
 *  Logo-overlay op het projectiescherm in de Grand Hall               *
 * ------------------------------------------------------------------ */

/**
 * Kloont een pilaar-logovlak (dat na de texture-swap het klantlogo toont)
 * en plaatst het midden op het Grand Hall-projectiescherm, georiënteerd
 * zoals de "Welkom"-tekst die al op dat scherm staat.
 */
/**
 * Ondiepe kloon van een Spline-mesh: zelfde prototype, gedeelde geometry en
 * material, eigen transform. (De reguliere .clone() werkt niet omdat de
 * Spline-meshclass constructor-argumenten vereist.)
 */
function shallowCloneMesh(src) {
  const c = Object.create(Object.getPrototypeOf(src));
  Object.assign(c, src);
  c.uuid = (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2));
  c.parent = null;
  c.children = [];
  c.matrix = src.matrix.clone();
  c.matrixWorld = src.matrixWorld.clone();
  c.position = src.position.clone();
  c.quaternion = src.quaternion.clone();
  c.scale = src.scale.clone();
  if (src.modelViewMatrix) c.modelViewMatrix = src.modelViewMatrix.clone();
  if (src.normalMatrix) c.normalMatrix = src.normalMatrix.clone();
  return c;
}

/* ------------------------------------------------------------------ *
 *  Canvas-helpers                                                     *
 * ------------------------------------------------------------------ */

/** Afbeelding cover-fit in een canvas van w×h (vult het hele vlak). */
export function coverCanvas(img, w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  const s = Math.max(w / img.width, h / img.height);
  const dw = img.width * s, dh = img.height * s;
  ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
  return c;
}

/** Logo op transparante achtergrond, in de beeldverhouding van het origineel. */
export function makeLogoCanvas(logoImg, width = 852, height = 382, pad = 0.06) {
  const c = document.createElement('canvas');
  c.width = width; c.height = height;
  const ctx = c.getContext('2d');
  const s = Math.min((width * (1 - pad * 2)) / logoImg.width, (height * (1 - pad * 2)) / logoImg.height);
  const w = logoImg.width * s, h = logoImg.height * s;
  ctx.drawImage(logoImg, (width - w) / 2, (height - h) / 2, w, h);
  return c;
}

/* ------------------------------------------------------------------ *
 *  Event Hall: decor over de volledige schermwand (4 delen)           *
 * ------------------------------------------------------------------ */

/**
 * Maak de achtergrond van een decorbeeld transparant (kieren tussen de
 * panelen, de zone boven de paneeltoppen).
 *  - Presets: alle bijna-zwarte pixels. Die renders hebben ook doorkijkgaten
 *    midden in een vorm die anders zwart op de wand komen.
 *  - Uploads (borderOnly): alleen bijna-zwart dat via elkaar met de rand van
 *    het beeld verbonden is. Zwarte logo's, letters en schaduwen ín een
 *    paneel blijven zo staan; met de drempel over het hele beeld werden die
 *    weggegooid en opgevuld met decorkleuren (vlekkerige, "wazige" logo's).
 *    Echte gaten in een upload horen transparant te zijn; die worden
 *    hieronder per deel opgevuld.
 */
function clearDecorBackground(ctx, w, h, borderOnly) {
  let id;
  try { id = ctx.getImageData(0, 0, w, h); } catch (e) { return; }
  const d = id.data;
  const n = w * h;
  const isGap = (p) => d[p * 4 + 3] < 8 || d[p * 4] + d[p * 4 + 1] + d[p * 4 + 2] < 48;
  if (!borderOnly) {
    for (let p = 0; p < n; p++) if (isGap(p)) d[p * 4 + 3] = 0;
    ctx.putImageData(id, 0, 0);
    return;
  }
  const seen = new Uint8Array(n);
  const stack = new Int32Array(n);
  let top = 0;
  const push = (p) => { if (!seen[p] && isGap(p)) { seen[p] = 1; stack[top++] = p; } };
  for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
  while (top) {
    const p = stack[--top];
    d[p * 4 + 3] = 0;
    const x = p % w;
    if (x > 0) push(p - 1);
    if (x < w - 1) push(p + 1);
    if (p >= w) push(p - w);
    if (p < n - w) push(p + w);
  }
  ctx.putImageData(id, 0, 0);
}

/**
 * Bouw één doorlopend decorbeeld voor de hele Event Hall-schermwand en
 * verdeel het over de 4 "Deel"-textures, zodat het beeld en de logo's
 * netjes doorlopen over de wand (in plaats van 4 losse herhalingen).
 *
 * decor: { type: 'verloop' | 'effen1' | 'effen2' | 'zwart' | 'custom',
 *          image?: geladen afbeelding (bij 'custom'),
 *          preset?: true als image een meegeleverd decor is,
 *          logoSpots?: aantal logo-plekken (1 of 2, standaard 2) }
 */
export function applyEventhallDecor(app, { decor = {}, colors = {}, logoImg = null }) {
  const parts = listImageAssets(app)
    .filter((a) => /event\s*hall\s*scherm/i.test(a.name))
    .map((a) => {
      const m = a.name.match(/deel\s*(\d)/i);
      return { ...a, index: m ? Number(m[1]) : 99 };
    })
    .sort((a, b) => a.index - b.index);
  if (!parts.length) return 0;

  const height = Math.max(...parts.map((p) => p.height || 850));
  const widths = parts.map((p) => Math.round((p.width || 1280) * (height / (p.height || 850))));
  const total = widths.reduce((a, b) => a + b, 0);

  // 1. achtergrond over de hele wand
  const wall = document.createElement('canvas');
  wall.width = total; wall.height = height;
  const ctx = wall.getContext('2d');
  const primary = colors.primary || '#E4032E';
  const secondary = colors.secondary || primary;
  const type = decor.type || 'verloop';
  if (type === 'custom' && decor.image) {
    // STRETCH-fit met gekalibreerde correctie: de decors zijn orthografische
    // renders van exact deze wand. Silhouet-registratie (XOR-fit op de
    // paneelranden t.o.v. de originele textures) gaf een kleine affiene
    // afwijking: x −0,06% verschoven, y ×1,015 −0,47%. Cover-fit sneed
    // eerder ±2% af, wat zwarte balken op de panelen gaf.
    const dx = -0.00059 * total;
    const dy = -0.0047 * height;
    ctx.drawImage(decor.image, 0, 0, decor.image.width, decor.image.height,
      dx, dy, total, height * 1.015);
  } else if (type === 'zwart') {
    ctx.fillStyle = '#0a0a0a'; ctx.fillRect(0, 0, total, height);
  } else if (type === 'effen1' || type === 'effen2') {
    ctx.fillStyle = type === 'effen1' ? primary : secondary;
    ctx.fillRect(0, 0, total, height);
  } else {
    const grad = ctx.createLinearGradient(0, 0, total, 0);
    grad.addColorStop(0, primary);
    grad.addColorStop(1, secondary);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, total, height);
  }
  if (type === 'custom' && decor.image) clearDecorBackground(ctx, total, height, !decor.preset);

  // 2. logo op 1 of 2 plekken op de wand — posities corresponderen met de
  //    panelen van het decor: het grote paneel links van het midden
  //    (wandfractie ±0,385) en de bol rechts (±0,865), verticaal iets onder
  //    het midden zodat het logo binnen het paneel valt.
  if (logoImg && decor.logo !== false) {
    const spots = decor.logoSpots === 1
      ? [{ fx: 0.385, fy: 0.58 }]
      : [{ fx: 0.385, fy: 0.58 }, { fx: 0.865, fy: 0.58 }];
    const maxH = height * 0.34;
    const maxW = total * 0.13;
    const s = Math.min(maxW / logoImg.width, maxH / logoImg.height);
    const lw = logoImg.width * s, lh = logoImg.height * s;
    for (const { fx, fy } of spots) {
      ctx.drawImage(logoImg, total * fx - lw / 2, height * fy - lh / 2, lw, lh);
    }
  }

  // 3. wand opdelen in de 4 delen (originele resolutie per deel).
  //    De achtergrond (kieren, boven de paneeltoppen) is hierboven al
  //    transparant gemaakt. Per deel worden die gaten opgevuld met
  //    verschoven/vergrote kopieën van hetzelfde decor (en als laatste
  //    redmiddel de gemiddelde decorkleur), zodat er geen zwarte pixel op
  //    een paneelrand kan vallen.
  let x = 0;
  parts.forEach((p, i) => {
    const sw = p.width || widths[i];
    const sh = p.height || height;

    // exacte slice + gemiddelde kleur van de zichtbare pixels
    const clean = document.createElement('canvas');
    clean.width = sw; clean.height = sh;
    const cctx = clean.getContext('2d');
    cctx.drawImage(wall, x, 0, widths[i], height, 0, 0, sw, sh);
    let avg = '#3a3a3a';
    try {
      const d = cctx.getImageData(0, 0, sw, sh).data;
      let ar = 0, ag = 0, ab = 0, an = 0;
      for (let k = 0; k < d.length; k += 4) {
        if (d[k + 3] < 128) continue;
        ar += d[k]; ag += d[k + 1]; ab += d[k + 2]; an++;
      }
      if (an) avg = `rgb(${Math.round(ar / an)},${Math.round(ag / an)},${Math.round(ab / an)})`;
    } catch (e) { /* standaardkleur */ }

    const slice = document.createElement('canvas');
    slice.width = sw; slice.height = sh;
    const sctx = slice.getContext('2d');
    sctx.drawImage(clean, 0, 0);
    // gaten vullen met verschoven en vergrote kopieën (achter het exacte beeld)
    sctx.globalCompositeOperation = 'destination-over';
    const dx = Math.round(sw * 0.02), dy = Math.round(sh * 0.03);
    sctx.drawImage(clean, 0, dy);        // omhoog geschoven inhoud vult toppen
    sctx.drawImage(clean, 0, -dy);
    sctx.drawImage(clean, dx, 0);
    sctx.drawImage(clean, -dx, 0);
    sctx.drawImage(clean, -Math.round(sw * 0.03), -Math.round(sh * 0.05), Math.round(sw * 1.06), Math.round(sh * 1.1));
    sctx.fillStyle = avg;
    sctx.fillRect(0, 0, sw, sh);
    sctx.globalCompositeOperation = 'source-over';
    swapHolderImage(p.holder, slice);
    x += widths[i];
  });
  return parts.length;
}

/* ------------------------------------------------------------------ *
 *  Grand Hall: middenscherm (16:9) met logo / zwart / eigen beeld     *
 * ------------------------------------------------------------------ */

function worldBox(mesh) {
  if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
  mesh.updateWorldMatrix(true, false);
  const bb = mesh.geometry.boundingBox;
  const e = mesh.matrixWorld.elements;
  const corners = [];
  for (const x of [bb.min.x, bb.max.x]) for (const y of [bb.min.y, bb.max.y]) for (const z of [bb.min.z, bb.max.z]) {
    corners.push({
      x: e[0] * x + e[4] * y + e[8] * z + e[12],
      y: e[1] * x + e[5] * y + e[9] * z + e[13],
      z: e[2] * x + e[6] * y + e[10] * z + e[14],
    });
  }
  const min = { x: Infinity, y: Infinity, z: Infinity }, max = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (const c of corners) for (const k of ['x', 'y', 'z']) { min[k] = Math.min(min[k], c[k]); max[k] = Math.max(max[k], c[k]); }
  return { min, max, size: { x: max.x - min.x, y: max.y - min.y, z: max.z - min.z },
           center: { x: (min.x + max.x) / 2, y: (min.y + max.y) / 2, z: (min.z + max.z) / 2 } };
}

function pillarLogoRects(scene) {
  const rects = [];
  scene.traverse((o) => {
    if (o.isMesh && /^Rectangle/.test(o.name || '') &&
        o.parent && /NBC logo's pilaar/i.test(o.parent.name || '')) rects.push(o);
  });
  return rects;
}

function firstMaterial(mesh) { return Array.isArray(mesh.material) ? mesh.material[0] : mesh.material; }

/**
 * Richt het Grand Hall-middenscherm in:
 *  - verbergt de "Welkom"-tekst
 *  - claimt één pilaar-logovlak + bijbehorende texture-holder exclusief
 *    (de overige pilaarvlakken met datzelfde materiaal krijgen het materiaal
 *    van een ander vlak in hun eigen groep, zodat pilaren intact blijven)
 *  - schaalt het vlak exact passend op het rechthoekige middenscherm
 *  - vult het met: logo op transparant (kleur-modus), logo op zwart, of een
 *    eigen 16:9-beeld
 */
/**
 * Zoek het vlak dat we op het Grand Hall-middenscherm plaatsen (een pilaar-
 * logovlak dat tegen de achterwand kijkt, dus vrijwel onzichtbaar) én de
 * holder die de textuur ervan levert. Zodat applyBranding die holder precies
 * één keer kan swappen (dubbele swaps breken de render).
 */
/** Maten van het Grand Hall-middenscherm (de "Cube" in "Scherm midden"). */
export function grandHallScreenSize(app) {
  const scene = app._scene;
  let cube = null, schermMidden = null;
  scene.traverse((o) => { if (!schermMidden && (o.name || '').trim() === 'Scherm midden') schermMidden = o; });
  if (schermMidden) schermMidden.traverse((o) => { if (!cube && o.isMesh && /^Cube/.test((o.name || '').trim())) cube = o; });
  if (!cube) return null;
  const cb = worldBox(cube);
  return { cube, w: Math.max(cb.size.x, cb.size.z), h: cb.size.y, center: cb.center };
}

export function findGrandHallPlane(app, pilarenAssets = []) {
  const scene = app._scene;
  const rects = pillarLogoRects(scene);
  let plane = null;
  scene.traverse((o) => { if (!plane && o.name === 'brand-logo-grandhall') plane = o; });
  if (!plane) {
    let bestZ = -Infinity;
    for (const r of rects) {
      r.updateWorldMatrix(true, false);
      const z = r.matrixWorld.elements[14];
      if (z > bestZ) { bestZ = z; plane = r; }
    }
  }
  if (!plane) return null;
  const planeMat = firstMaterial(plane);
  const holderEntry = pilarenAssets.find((a) =>
    holderTexturesOf(a.holder).some((t) => materialUsesTexture(planeMat, t))) || null;
  return { plane, planeMat, holder: holderEntry ? holderEntry.holder : null };
}

/**
 * Bouw de content-canvas voor het Grand Hall-middenscherm.
 *
 * BELANGRIJK: de canvas moet EXACT de pixelmaten van de originele holder-
 * afbeelding hebben — Spline alloceert de GPU-textuur op vaste grootte en
 * negeert uploads met andere afmetingen (de oude afbeelding blijft dan
 * zichtbaar). Omdat het vlak op schermverhouding wordt geschaald terwijl de
 * canvas de holderverhouding houdt, wordt de inhoud eerst op schermverhouding
 * gecomponeerd en daarna in de holdermaat "voorvervormd": na de UV-mapping op
 * het vlak kloppen de verhoudingen (logo dus nooit uitgerekt).
 */
function buildGrandHallContent(app, { mode, image, logoImg, colors = {}, aspect = 16 / 9, holderW = 426, holderH = 191 }) {
  // 1. componeer op schermverhouding
  const W = 1280;
  const H = Math.max(2, Math.round(W / Math.max(aspect, 1e-6)));
  const tmp = document.createElement('canvas');
  tmp.width = W; tmp.height = H;
  const tctx = tmp.getContext('2d');
  if (image) {
    const s = Math.max(W / image.width, H / image.height);
    tctx.drawImage(image, (W - image.width * s) / 2, (H - image.height * s) / 2, image.width * s, image.height * s);
  } else {
    if (mode === 'zwart') {
      tctx.fillStyle = '#0a0a0a'; tctx.fillRect(0, 0, W, H);
    } else if (colors.primary) {
      // kleurmodus: verloop in exact de gekozen huisstijlkleuren
      const grad = tctx.createLinearGradient(0, 0, W, 0);
      grad.addColorStop(0, colors.primary);
      grad.addColorStop(1, colors.secondary || colors.primary);
      tctx.fillStyle = grad;
      tctx.fillRect(0, 0, W, H);
    }
    if (logoImg) {
      const s = Math.min((W * 0.6) / logoImg.width, (H * 0.6) / logoImg.height);
      const lw = logoImg.width * s, lh = logoImg.height * s;
      tctx.drawImage(logoImg, (W - lw) / 2, (H - lh) / 2, lw, lh);
    }
  }
  // 2. voorvervormen naar de exacte holdermaat; de scherpe origineel-resolutie
  //    blijft eraan hangen voor de bytes-injectie op het middenscherm
  const content = document.createElement('canvas');
  content.width = holderW; content.height = holderH;
  content.getContext('2d').drawImage(tmp, 0, 0, holderW, holderH);
  content.__nbcFull = tmp;
  return content;
}

export function setupGrandHallScreen(app, { mode = 'kleur', image = null, logoImg = null, planeInfo = null }) {
  const scene = app._scene;
  let welkom = null, cube = null, schermMidden = null;
  scene.traverse((o) => {
    if (!schermMidden && (o.name || '').trim() === 'Scherm midden') schermMidden = o;
  });
  if (schermMidden) {
    schermMidden.traverse((o) => {
      if (!welkom && o.isMesh && (o.name || '').trim() === 'Welkom') welkom = o;
      if (!cube && o.isMesh && /^Cube/.test((o.name || '').trim())) cube = o;
    });
  }
  if (!welkom || !cube || !planeInfo || !planeInfo.plane) return { fail: 'welkom/cube/plane' };

  // Welkom-tekst weg
  const wparent = welkom.parent && /welkom/i.test(welkom.parent.name || '') ? welkom.parent : welkom;
  wparent.visible = false;

  // De content staat al (vroeg, in de pilaren-fase) in de geclaimde holder.
  // In plaats van het pilaarvlak te verplaatsen (transforms op instance-
  // vlakken renderen onbetrouwbaar), krijgt de scherm-CUBE een eigen
  // materiaal: materiaal-toewijzing op de cube rendert wél betrouwbaar.
  //
  // Het pilaarmateriaal zelf is onbruikbaar op de cube: de kadrering
  // (crop/projection/rotatie-90/repeat) zit in de GECOMPILEERDE shader
  // (defines) en is met uniform-wijzigingen niet te corrigeren. De Event
  // Hall-schermmaterialen mappen hun texture wél 1-op-1 op het vlak (dat is
  // getest: een hue-testbeeld verschijnt strak op de cube). Daarom: een
  // ondiepe KOPIE van zo'n Event Hall-materiaal, met eigen laag/uniform-
  // objecten en de geclaimde holder-texture als beeldbron.
  const plane = planeInfo.plane;
  if (!planeInfo.holder) return { fail: 'holder' };
  plane.visible = false;                 // het vlak zelf blijft in de pilaar; uit
  plane.name = 'brand-logo-grandhall';   // marker: nooit herbouwen/hergebruiken

  // De cube krijgt via Spline's eigen data-kanaal (updateByOp + geometry-
  // rebuild, zoals app.swapGeometry doet) een VERS materiaal, opgebouwd uit
  // de laag-data van het geclaimde pilaarvlak — met de kadrering rechtgezet
  // naar een 1-op-1 vlak-mapping (zoals de Event Hall-schermen) en de
  // Grand Hall-content als PNG-bytes op volledige resolutie. JS-niveau
  // kopieën/toewijzingen delen namelijk gecompileerde bindingen; alleen dit
  // data-kanaal levert een materiaal met eigen shader-defines en beeld.
  if (!cube.data || typeof cube.updateByOp !== 'function' || !plane.data) return { fail: 'data-kanaal' };
  const holderImg = planeInfo.holder.img;
  const full = (holderImg && holderImg.__nbcFull) || holderImg;
  if (!full) return { fail: 'content' };
  const bytes = canvasToPngBytes(full);
  const srcMatData = JSON.parse(JSON.stringify(plane.data.material));
  for (const layer of srcMatData.layers || []) {
    if (!layer.data || layer.data.type !== 'texture') continue;
    layer.data.projection = 0;
    layer.data.crop = false;
    layer.data.axis = 'x';
    if (layer.data.texture) {
      layer.data.texture.repeat = [1, 1];
      layer.data.texture.offset = [0, 0];
      layer.data.texture.rotation = 0;
      layer.data.texture.image = { data: bytes, name: 'nbc-grandhall.png' };
    }
  }
  const opCtx = { shared: app._sharedAssetsManager, scene };
  try {
    const l = { ...cube.data, material: srcMatData };
    cube.updateByOp({ type: 0, path: [], props: { material: l.material } }, l, opCtx, false);
    const l2 = { ...cube.data, geometry: { ...cube.data.geometry } };
    cube.updateByOp({ type: 0, path: [], props: { geometry: l2.geometry } }, l2, opCtx, false);
  } catch (e) {
    return { fail: 'updateByOp: ' + e.message };
  }

  return { cube: true };
}

function holderTexturesOf(holder) {
  const found = [];
  const seen = new Set();
  const scan = (v, depth) => {
    if (!v || typeof v !== 'object' || depth > 6 || seen.has(v)) return;
    seen.add(v);
    if (v.isTexture) { found.push(v); return; }
    if (v instanceof Map) { for (const x of v.values()) scan(x, depth + 1); return; }
    if (Array.isArray(v)) { for (const x of v) scan(x, depth + 1); return; }
    for (const k of Object.keys(v)) {
      if (k === 'shared' || k === 'thisContext') continue;
      scan(v[k], depth + 1);
    }
  };
  scan(holder._cache, 0);
  return found;
}

function materialUsesTexture(material, tex) {
  let found = false;
  const seen = new Set();
  const walk = (obj, depth) => {
    if (found || !obj || typeof obj !== 'object' || depth > 8 || seen.has(obj)) return;
    seen.add(obj);
    if (obj === tex) { found = true; return; }
    if (obj instanceof Map) { for (const v of obj.values()) walk(v, depth + 1); return; }
    if (Array.isArray(obj)) { for (const v of obj) walk(v, depth + 1); return; }
    for (const k of Object.keys(obj)) {
      if (k.startsWith('__') || ['parent', 'children', 'shared', 'thisContext'].includes(k)) continue;
      const v = obj[k];
      if (v && typeof v === 'object') walk(v, depth + 1);
    }
  };
  walk(material, 0);
  return found;
}

/* ------------------------------------------------------------------ *
 *  LED-pilaren: volledig vullen met eigen (staand) beeld              *
 * ------------------------------------------------------------------ */

// Empirisch gekalibreerd (pixel- en silhouetmetingen op de congres-scène):
// met deze hiddenMatrix-waarden beslaat elk logovlak vrijwel de volledige
// pilaarmesh (alle pilaarmeshes zijn identiek, 129,3 eenheden lang, en de
// logoband zit overal op dezelfde relatieve plek — dus één vaste waarde
// werkt voor álle pilaren in álle scènes, zonder metingen of wachten).
const PILLAR_HM_SCALE = 12.95;
const PILLAR_HM_SHIFT = -35.6;
// Het vlak beslaat mesh-relatief ~[6 .. 129] (wereldhoogte ≈ 123); de vloer
// van de binnenplaats ligt op 84,6 onder de top. Het beeld staat op WARE
// verhouding met de voet op de vloer; erboven wordt de bovenste beeldrand
// doorgetrokken, eronder (alleen zichtbaar bij lager gelegen vloeren) de
// onderste beeldrand.
const PILLAR_PLANE_H = 123.0;
// zichtbare pilaarmaat boven de binnenplaatsvloer
const PILLAR_FACE_W = 7.2;
const PILLAR_FACE_H = 84.6;

/** Canvas → PNG-bytes (Uint8Array), voor injectie in Spline-materiaaldata. */
function canvasToPngBytes(canvas) {
  const b64 = canvas.toDataURL('image/png').split(',')[1];
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/** Gemiddelde kleur van een afbeelding (voor de hoek-tint van de pilaren). */
function averageImageColor(image) {
  const c = document.createElement('canvas');
  c.width = 8; c.height = 32;
  const g = c.getContext('2d');
  g.drawImage(image, 0, 0, 8, 32);
  const d = g.getImageData(0, 0, 8, 32).data;
  let r = 0, gr = 0, b = 0, n = 0;
  for (let i = 0; i < d.length; i += 4) { r += d[i]; gr += d[i + 1]; b += d[i + 2]; n++; }
  return [r / n / 255, gr / n / 255, b / n / 255];
}

/**
 * Staand beeld gedraaid in de holdermaat componeren (canvas-x = verticaal,
 * x=0 = top van het vlak), in één resample-stap voor maximale scherpte.
 *
 * Het beeld vult het zichtbare deel van de pilaar VOLLEDIG (van vloer tot
 * top, zoals het kleurverloop), met cover-fit op de pilaarverhouding
 * (1 breed : 11,75 hoog — lever op die verhouding aan, dan wordt er niets
 * bijgesneden of vervormd). Onder de vloer (alleen zichtbaar bij pilaren op
 * lager gelegen vloeren) wordt de onderste beeldrand doorgetrokken.
 */
function pillarCanvas(image, w = 426, h = 191) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  const floorX = Math.round(w * (PILLAR_FACE_H / PILLAR_PLANE_H)); // vloer, gemeten vanaf de top
  const targetAspect = PILLAR_FACE_W / PILLAR_FACE_H;
  let sx = 0, sy = 0, sw = image.width, sh = image.height;
  if (sw / sh > targetAspect) { const nw = sh * targetAspect; sx = (sw - nw) / 2; sw = nw; }
  else { const nh = sw / targetAspect; sy = (sh - nh) / 2; sh = nh; }
  ctx.save();
  ctx.translate(0, h);
  ctx.rotate(-Math.PI / 2);
  // gedraaid stelsel: 1e dest-as → canvas-y (breedte h), 2e dest-as → canvas-x
  ctx.drawImage(image, sx, sy, sw, sh, 0, 0, h, floorX);
  ctx.restore();
  if (floorX < w) ctx.drawImage(c, Math.max(0, floorX - 2), 0, 2, h, floorX, 0, w - floorX, h);
  return c;
}

/**
 * Vult alle LED-pilaren op alle 4 zijden met een geüpload (staand) beeld,
 * precies zo hoog als de pilaar zelf (het kleurverloop).
 *
 * BELANGRIJK (empirisch): de pilaren zijn Spline-instances. Directe three.js-
 * transforms renderen NIET (gebakken rendertransform) en materiaal-ops
 * bevriezen de pose. Wat wél werkt: data.hiddenMatrix aanpassen plus een
 * geometry-op (zoals app.swapGeometry doet) — dan herbouwt Spline het
 * render-item mét de nieuwe maat. Content gaat via de gedeelde holders
 * (exacte originele pixelmaat, anders weigert de GPU-upload).
 */
export function fillPillarsWithImage(app, image, pilarenAssets, skipPlane = null) {
  const scene = app._scene;
  for (const a of pilarenAssets) {
    swapHolderImage(a.holder, pillarCanvas(image, a.width || 426, a.height || 191));
  }
  const opCtx = { shared: app._sharedAssetsManager, scene };
  let n = 0;
  scene.traverse((group) => {
    if (!/NBC logo's pilaar/i.test(group.name || '')) return;
    for (const r of (group.children || [])) {
      if (!r.isMesh || r === skipPlane || r.name === 'brand-logo-grandhall') continue;
      if (!r.data || typeof r.updateByOp !== 'function' || !Array.isArray(r.data.hiddenMatrix)) continue;
      try {
        const hm = [...r.data.hiddenMatrix];
        hm[5] = PILLAR_HM_SCALE;
        hm[13] = PILLAR_HM_SHIFT;
        const l = { ...r.data, hiddenMatrix: hm };
        r.updateByOp({ type: 0, path: [], props: { hiddenMatrix: l.hiddenMatrix } }, l, opCtx, false);
        const l2 = { ...r.data, geometry: { ...r.data.geometry } };
        r.updateByOp({ type: 0, path: [], props: { geometry: l2.geometry } }, l2, opCtx, false);
        n++;
      } catch (e) { /* vlak overslaan; de rest gaat door */ }
    }
  });
  if (app.requestRender) app.requestRender();
  return n;
}

/**
 * Tint het kleurverloop van de pilaren zelf naar de gemiddelde beeldkleur,
 * zodat de afgeronde hoeken (zichtbaar tussen de vlakken) niet meer als
 * felle verloopstreep opvallen. Aanroepen NA recolorBrandColors.
 */
export function tintPillarCorners(app, image) {
  const scene = app._scene;
  const avg = averageImageColor(image);
  let n = 0;
  scene.traverse((group) => {
    if (!/NBC logo's pilaar/i.test(group.name || '')) return;
    const pillar = group.parent && (group.parent.children || []).find((s) => s.isMesh && /^Pilaar/.test(s.name || ''));
    if (!pillar) return;
    const mats = Array.isArray(pillar.material) ? pillar.material : [pillar.material];
    for (const m of mats) {
      if (!m) continue;
      const layerList = (m.layers && (m.layers.layers || m.layers)) || [];
      for (const layer of layerList) {
        const u = layer.uniforms || {};
        for (const key of Object.keys(u)) {
          if (!/_colors$/.test(key) || !Array.isArray(u[key].value)) continue;
          for (const stop of u[key].value) {
            if (stop && typeof stop.x === 'number') { stop.x = avg[0]; stop.y = avg[1]; stop.z = avg[2]; n++; }
          }
        }
      }
    }
  });
  if (app.requestRender) app.requestRender();
  return n;
}

// Bandpose: gekalibreerd zodat het herbouwde vlak exact de originele
// logoband beslaat (wereld ≈ [2,9 .. 42,9] op de referentiepilaar; de
// relatie is mesh-relatief en geldt voor alle pilaren in alle scènes).
const PILLAR_BAND_HM_SCALE = 4.09;
// verticale positie van de band op de pilaar (gekalibreerd; 0,617 wereld per
// t-eenheid): 'onder' = de originele NBC-bandpositie
const PILLAR_BAND_SHIFTS = { onder: -28.5, midden: 3.3, boven: 32.5 };

/**
 * Herbouwt de pilaar-logovlakken op exact de originele bandpositie, zodat ze
 * het volledige (logo)canvas 1-op-1 tonen in plaats van het kleine gebakken
 * textuurvenster van het originele materiaal. Zie fillPillarsWithImage voor
 * waarom dit via data.hiddenMatrix + een geometry-op moet.
 */
function applyPillarBandPose(app, skipPlane = null, pos = 'midden') {
  const scene = app._scene;
  const opCtx = { shared: app._sharedAssetsManager, scene };
  const shift = PILLAR_BAND_SHIFTS[pos] != null ? PILLAR_BAND_SHIFTS[pos] : PILLAR_BAND_SHIFTS.midden;
  let n = 0;
  scene.traverse((group) => {
    if (!/NBC logo's pilaar/i.test(group.name || '')) return;
    for (const r of (group.children || [])) {
      if (!r.isMesh || r === skipPlane || r.name === 'brand-logo-grandhall') continue;
      if (!r.data || typeof r.updateByOp !== 'function' || !Array.isArray(r.data.hiddenMatrix)) continue;
      // het ACHTERVLAK van elke pilaar is 180° gekanteld gebakken (rotatie
      // x≈π): de hm-assen werken er gespiegeld op, waardoor het na de
      // herpositionering als los vlakje boven/achter de pilaar uitsteekt.
      // Er is geen betrouwbare pose voor dit vlak — verbergen.
      if (r.rotation && Math.abs(Math.abs(r.rotation.x) - Math.PI) < 0.1) {
        r.visible = false;
        continue;
      }
      try {
        const hm = [...r.data.hiddenMatrix];
        hm[5] = PILLAR_BAND_HM_SCALE;
        hm[13] = shift;
        const l = { ...r.data, hiddenMatrix: hm };
        r.updateByOp({ type: 0, path: [], props: { hiddenMatrix: l.hiddenMatrix } }, l, opCtx, false);
        const l2 = { ...r.data, geometry: { ...r.data.geometry } };
        r.updateByOp({ type: 0, path: [], props: { geometry: l2.geometry } }, l2, opCtx, false);
        n++;
      } catch (e) { /* vlak overslaan; de rest gaat door */ }
    }
  });
  if (app.requestRender) app.requestRender();
  return n;
}

/* ------------------------------------------------------------------ *
 *  Grand Hall: volledige theateropstelling (congres-scène)            *
 * ------------------------------------------------------------------ */

/**
 * Vult de Grand Hall met een volledige theateropstelling: de bestaande
 * stoelkolommen (elk 10 stoelen breed) worden naar achteren doorgetrokken
 * tot de achterwand, en de catering in het middenschip (Food + Drinks,
 * hoge tafels) plus het scheidingsgordijn gaan uit.
 *
 * Werkt via het Spline-datakanaal: nieuwe rij-instances worden met
 * scene.updateTreeByOp (op-type 7) toegevoegd en daarna met
 * expandInstanceChildren geëxpandeerd — regulier klonen van three.js-nodes
 * rendert niet (de runtime bouwt render-items uit z'n eigen data-graph).
 * Alleen beschikbaar in de congres-scène (daar staan de stoelcomponenten in).
 */
export function applyGrandHallFullTheater(app) {
  const scene = app._scene;
  const sam = app._sharedAssetsManager;
  if (!scene || !sam || typeof scene.updateTreeByOp !== 'function') return 0;

  let ghCongres = null;
  scene.traverse((o) => {
    if (!ghCongres && (o.name || '').trim() === 'Congres' &&
        o.parent && (o.parent.name || '').trim() === 'Grand Hall') ghCongres = o;
  });
  if (!ghCongres) return 0; // geen congres-scène

  // middenschip leegmaken: catering en scheidingsgordijn uit
  for (const naam of ['Food + Drinks', 'Hoge Ronde Tafels + Stoelen', 'Gordijn']) {
    const g = ghCongres.children.find((c) => (c.name || '').trim() === naam);
    if (g) g.visible = false;
  }

  const grid = ghCongres.children.find((c) => (c.name || '') === 'Stoelen Grid podium');
  if (!grid) return 0;

  // alle bestaande stoelenrijen (10-stoels rij-instances) verzamelen
  const rows = [];
  grid.traverse((o) => {
    if (o.data && o.data.type === 'Instance' && /rij stoelen/i.test(o.data.name || o.name || '')) rows.push(o);
  });
  if (!rows.length) return 0;

  // groepeer per kolom op het werkelijke stoelen-zwaartepunt (bbox-centrum);
  // node-origins liggen nl. niet op de stoelen zelf
  const rowBox = (o) => {
    const min = { x: Infinity, z: Infinity }, max = { x: -Infinity, z: -Infinity };
    o.updateWorldMatrix(true, true);
    o.traverse((m) => {
      if (!m.isMesh || !m.geometry) return;
      if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
      const bb = m.geometry.boundingBox;
      const e = m.matrixWorld.elements;
      for (const x of [bb.min.x, bb.max.x]) for (const y of [bb.min.y, bb.max.y]) for (const z of [bb.min.z, bb.max.z]) {
        const wx = e[0] * x + e[4] * y + e[8] * z + e[12];
        const wz = e[2] * x + e[6] * y + e[10] * z + e[14];
        min.x = Math.min(min.x, wx); max.x = Math.max(max.x, wx);
        min.z = Math.min(min.z, wz); max.z = Math.max(max.z, wz);
      }
    });
    return { cx: (min.x + max.x) / 2, minZ: min.z, maxZ: max.z };
  };
  const worldPos = (o) => { o.updateWorldMatrix(true, false); const e = o.matrixWorld.elements; return { x: e[12], y: e[13], z: e[14] }; };
  const columns = new Map();
  for (const r of rows) {
    const box = rowBox(r);
    if (!isFinite(box.cx)) continue;
    const key = Math.round(box.cx / 80); // kolommen (±139 breed) liggen ±170 uit elkaar
    const cur = columns.get(key);
    if (!cur || box.minZ < cur.box.minZ) columns.set(key, { row: r, box });
  }

  const ROW_PITCH = 18;        // wereldafstand tussen rijen (gemeten)
  const BACK_LIMIT = 310;      // vrije zone bij de achterwand (muur z≈262)
  const AISLE_EVERY = 10;      // dwarsgangpad na elke 10 nieuwe rijen
  const AISLE_EXTRA = 14;

  // Vector3-klasse van de runtime hergebruiken via een bestaand object
  const V3 = Object.getPrototypeOf(rows[0].position).constructor;
  let added = 0;
  const errors = [];
  for (const { row, box } of columns.values()) {
    const parent = row.parent;
    if (!parent || !parent.uuid) continue;
    parent.updateWorldMatrix(true, false);
    const inv = parent.matrixWorld.clone().invert();
    const base = worldPos(row);
    const frontOffset = base.z - box.minZ; // origin t.o.v. voorkant stoelen
    for (let k = 1; ; k++) {
      const dz = ROW_PITCH + (k - 1) * ROW_PITCH + Math.floor((k - 1) / AISLE_EVERY) * AISLE_EXTRA;
      if (box.minZ - dz < BACK_LIMIT) break;
      const world = new V3(base.x, base.y, base.z - dz);
      const local = world.applyMatrix4(inv);
      const data = JSON.parse(JSON.stringify(row.data));
      data.name = 'GH theaterrij extra';
      data.position = [local.x, local.y, local.z];
      const op = {
        path: [], type: 7,
        id: (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2)),
        parent: parent.uuid,
        localIndex: parent.children.length,
        data,
        children: [],
      };
      try {
        scene.updateTreeByOp(op, sam);
        const node = scene.find(op.id);
        if (node && typeof node.expandInstanceChildren === 'function') {
          node.expandInstanceChildren({ scene, shared: sam });
        }
        added++;
      } catch (e) {
        errors.push(String((e && e.message) || e));
        break; // kolom overslaan bij onverwachte runtime-wijzigingen
      }
    }
  }
  if (errors.length) console.warn('theateropstelling: ' + errors.length + ' rij(en) overgeslagen:', errors[0]);
  if (app.requestRender) app.requestRender();
  return added;
}

/* ------------------------------------------------------------------ *
 *  Hoofd-API                                                          *
 * ------------------------------------------------------------------ */

/**
 * Pas branding toe op een geladen Spline Application.
 *
 * config:
 *   colors:    { primary, secondary }
 *   logo:      URL/data-URI (png met transparantie)
 *   pillarLogo: URL/data-URI — apart logo (bijv. andere kleurvariant) voor de
 *              logoband van de LED-pilaren; valt terug op het gewone logo
 *   screens:   { ledwall?, narrowcasting?, tv? } — eigen beeld per groep
 *              (screens.pilaren wordt genegeerd: pilaren tonen alleen het logo
 *              op de originele band — eigen beelden op de pilaren zijn
 *              uitgeschakeld wegens het gebakken render-regime van de instances)
 *   eventhall: { decor: 'verloop'|'effen1'|'effen2'|'zwart'|'custom', image?,
 *              logoSpots?, logoImage? } — logoImage: eigen logo (URL/data-URI)
 *              voor de plekken op de decorwand, anders het gewone logo
 *   grandhall: { mode: 'kleur'|'zwart', image?, colors?, logoImage?,
 *              fullTheater? } — middenscherm (16:9);
 *              fullTheater: true → volledige theateropstelling in de hele
 *              Grand Hall (alleen congres-scène; zie applyGrandHallFullTheater);
 *              colors: { primary, secondary } — eigen kleuren voor het Grand
 *              Hall-decor (middenscherm-verloop + de 2 wanden ernaast) in
 *              plaats van de huisstijlkleuren;
 *              logoImage: eigen logo voor het middenscherm, anders het gewone logo
 *   halls:     { eventhall?, grandhall?, hosp1?, hosp2? } — opstelling tonen/verbergen
 *   lights:    true om ook de lichten om te kleuren
 */
export async function applyBranding(app, config = {}) {
  const { colors = {}, logo = null, screens = {} } = config;
  const primary = colors.primary || null;
  const secondary = colors.secondary || null;

  const logoImg = logo ? await loadImage(logo) : null;
  const pillarLogoImg = config.pillarLogo ? await loadImage(config.pillarLogo) : null;
  const overrides = {};
  for (const [role, src] of Object.entries(screens)) {
    if (src && role !== 'pilaren') overrides[role] = await loadImage(src);
  }
  const eventhallCfg = { ...(config.eventhall || {}) };
  if (eventhallCfg.image) eventhallCfg.image = await loadImage(eventhallCfg.image);
  if (!eventhallCfg.image && overrides.eventhall) { eventhallCfg.type = 'custom'; eventhallCfg.image = overrides.eventhall; }
  const grandhallCfg = { ...(config.grandhall || {}) };
  if (grandhallCfg.image) grandhallCfg.image = await loadImage(grandhallCfg.image);
  if (!grandhallCfg.image && overrides.grandhall) grandhallCfg.image = overrides.grandhall;
  // eigen logo per scherm (anders het gewone logo)
  const ehLogoImg = eventhallCfg.logoImage ? await loadImage(eventhallCfg.logoImage) : null;
  const ghLogoImg = grandhallCfg.logoImage ? await loadImage(grandhallCfg.logoImage) : null;

  const result = { swapped: [], recolored: 0, lights: 0, skipped: [], grandhall: false, eventhallParts: 0, pillarsFilled: 0 };

  const assets = listImageAssets(app);
  const pilarenAssets = assets.filter((a) => a.name && roleFor(a.name) === 'pilaren');

  // Grand Hall-vlak + holder vooraf bepalen zodat we die holder overslaan bij
  // het pilaren-swappen (elke holder mag maar één keer geswapt worden).
  const ghInfo = findGrandHallPlane(app, pilarenAssets);
  const ghHolder = ghInfo && ghInfo.holder;
  const wantGrandhall = !!(logoImg || ghLogoImg || grandhallCfg.image || grandhallCfg.mode === 'zwart');

  const ghScreen = grandHallScreenSize(app);
  const ghAsset = ghHolder ? pilarenAssets.find((a) => a.holder === ghHolder) : null;
  // Content voor het Grand Hall-vlak. Wordt hieronder BINNEN de pilaren-lus
  // geswapt en heeft EXACT de originele holdermaat (Spline weigert uploads met
  // andere afmetingen); de inhoud is voorvervormd op de schermverhouding.
  // eigen Grand Hall-kleuren (optioneel) — anders de huisstijlkleuren
  const ghColors = (grandhallCfg.colors && grandhallCfg.colors.primary)
    ? { primary: grandhallCfg.colors.primary, secondary: grandhallCfg.colors.secondary || grandhallCfg.colors.primary }
    : { primary, secondary };
  const ghContent = (ghInfo && ghHolder && wantGrandhall) ? buildGrandHallContent(app, {
    mode: grandhallCfg.mode || 'kleur', image: grandhallCfg.image || null, logoImg: ghLogoImg || logoImg,
    colors: ghColors,
    aspect: ghScreen ? ghScreen.w / Math.max(ghScreen.h, 1e-6) : 16 / 9,
    holderW: (ghAsset && ghAsset.width) || 426,
    holderH: (ghAsset && ghAsset.height) || 191,
  }) : null;

  // 1. losse schermgroepen (ledwall, narrowcasting, tv) — volledig element vullen
  for (const asset of assets) {
    if (!asset.name || PROTECTED_ASSETS.test(asset.name) || asset.isVideo) { result.skipped.push(asset.name); continue; }
    const role = roleFor(asset.name);
    if (!role || role === 'eventhall' || role === 'pilaren') continue;
    let replacement = null;
    if (overrides[role]) {
      replacement = coverCanvas(overrides[role], asset.width || 1600, asset.height || 900);
    } else if (primary) {
      replacement = makeBrandCanvas({ logoImg, primary, secondary, width: asset.width || 1280, height: asset.height || 720 });
    }
    if (!replacement) continue;
    swapHolderImage(asset.holder, replacement);
    result.swapped.push({ asset: asset.name, role });
  }

  // 2. pilaren + Grand Hall-vlak. Het vlak deelt een holder met de pilaren;
  //    die holder krijgt (bij zwart/eigen beeld) de Grand Hall-content, de
  //    rest het (pilaar)logo op de originele logoband — exact dezelfde plek
  //    en uitlijning als het NBC-logo, zo groot mogelijk (het logo vult de
  //    hele band, verticaal zoals het origineel).
  const bandLogo = pillarLogoImg || logoImg;
  if (bandLogo) {
    for (const a of pilarenAssets) {
      if (a.holder === ghHolder && ghContent) {
        swapHolderImage(a.holder, ghContent);
      } else {
        swapHolderImage(a.holder, pillarBandLogoCanvas(bandLogo, a.width || 426, a.height || 191));
        // zonder mipmaps: het logo (op transparante achtergrond) vervaagde
        // op afstand doordat mip-niveaus met de transparantie vermengen
        for (const t of holderTextures(a.holder)) {
          t.generateMipmaps = false;
          t.minFilter = 1006; // LinearFilter
          t.needsUpdate = true;
        }
      }
      result.swapped.push({ asset: a.name, role: 'pilaren' });
    }
    // De originele band toont maar een klein venster van de texture (gebakken
    // crop/rotatie in de shader). Door de vlakken via het data-kanaal op
    // exact de originele bandpositie te herbouwen tonen ze het volledige
    // canvas 1-op-1: het logo vult dan de hele band.
    applyPillarBandPose(app, wantGrandhall ? (ghInfo && ghInfo.plane) : null, config.pillarLogoPos || 'midden');
  } else if (ghContent && ghHolder) {
    // geen logo, maar wél Grand Hall-content (zwart scherm of eigen beeld)
    swapHolderImage(ghHolder, ghContent);
  }

  // 3. Event Hall-decorwand (één doorlopend beeld over de 4 delen)
  if (primary || eventhallCfg.image) {
    result.eventhallParts = applyEventhallDecor(app, { decor: eventhallCfg, colors, logoImg: ehLogoImg || logoImg });
  }

  // 3b. bovenranden van het decor: altijd neutraal grijs i.p.v. NBC-oranje
  neutralizeDecorEdges(app);

  // 4. NBC-verloop (pilaren, Grand Hall-scherm, LED-accenten) → huisstijlkleuren
  if (primary) result.recolored = recolorBrandColors(app, primary, secondary);

  // 4b. eigen Grand Hall-kleuren op de 2 wanden naast het middenscherm
  //     (het middenscherm zelf krijgt ze al via ghContent)
  if (grandhallCfg.colors && grandhallCfg.colors.primary) {
    result.ghWalls = recolorGrandHallWalls(app, ghColors.primary, ghColors.secondary);
  }

  // 5. Grand Hall-middenscherm: vlak verplaatsen/schalen op het scherm
  //    (de content is al vroeg geswapt)
  if (ghInfo && wantGrandhall) {
    result.grandhall = setupGrandHallScreen(app, {
      mode: grandhallCfg.mode || 'kleur',
      image: grandhallCfg.image || null,
      logoImg: ghLogoImg || logoImg,
      planeInfo: ghInfo,
    });
  }

  // 6. opstellingen per hal aan/uit
  if (config.halls && typeof config.halls === 'object') {
    result.halls = setHallVisibility(app, config.halls);
  }

  // 6b. Grand Hall: volledige theateropstelling (alleen congres-scène)
  if (grandhallCfg.fullTheater) {
    result.ghTheaterRows = applyGrandHallFullTheater(app);
  }

  if (primary && config.lights === true && app._scene) {
    let i = 0;
    app._scene.traverse((o) => {
      if (o.isLight && o.color && o.color.set) {
        o.color.set(i % 2 === 0 ? primary : (secondary || primary));
        result.lights++; i++;
      }
    });
  }

  if (app.requestRender) app.requestRender();
  return result;
}
