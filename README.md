# NBC Events — 3D plattegrond voor sales

Doorontwikkeling van de 3D plattegrond (nbcevents.nl/3d-plattegrond) tot
salestool: per event een gebrand 3D-model met eigen logo, huisstijlkleuren en
schermcontent, deelbaar via een unieke, niet-herleidbare URL.

**Status: werkend proof-of-concept.**

- Alle schermen in het model (groot scherm Event Hall, LED-wall entree,
  registratie-/narrowcastingschermen, LED-pilaren) zijn runtime te vervangen
  door een geüpload beeld of een gegenereerde huisstijl-afbeelding.
- **Tooltips zoals op de live site**: de ankers in de scène worden verborgen
  en vervangen door klikbare pills met kaartjes (afbeelding, tekst,
  capaciteitsvarianten), incl. de scheidingswand-toggle (`src/tooltips.js`).
- Het **kleurverloop op de 9 LED-pilaren** en het **projectiescherm in de
  Grand Hall** wordt omgezet naar de 2 huisstijlkleuren (verloop en
  licht/donker-variatie blijven behouden), met het geüploade logo op het
  Grand Hall-scherm op de plek van het NBC-logo.
- **Opstelling kiezen** (Congres / Feest / Sit-down dinner) en per hal de
  opstelling **aan/uit zetten**: Event Hall- en Grand Hall-opstellingen
  (stoelen, barren, tafels) zijn per event te verbergen.

| Origineel | Gebrand (testmerk "ACME") |
|---|---|
| ![voor](docs/screenshots/congres-before.png) | ![na](docs/screenshots/congres-after.png) |

![Grand Hall detail](docs/screenshots/grandhall-logo-detail.png)

## Onderdelen

| Pad | Wat |
|---|---|
| `assets/spline/*/scene.splinecode` | De 4 Spline-scènes van de live site (congres, feest, sitdown, lounge) |
| `src/branding.js` | Branding-module: texture-injectie + kleuren, werkt op `@splinetool/runtime` |
| `src/quality.js` | Beeldkwaliteit: scherp beeld tijdens draaien/zoomen (TAA-patch), pixel ratio-beleid |
| `viewer/` | Klantpagina: laadt branding-config via `?e=TOKEN` of `#c=<config>` en toont het gebrande model |
| `admin/` | Demo-beheeromgeving: kleuren kiezen, logo/beelden uploaden, deelbare link genereren |
| `scripts/` | Lokale server + Playwright-testen (inspectie, branding-PoC, viewer e2e) |
| `docs/architectuur-analyse.md` | Technische analyse van de bestaande tool |

## Hosting (GitHub Pages)

De app is volledig statisch en draait onder elk (sub)pad, bijv.
`https://digitaldedication.github.io/nbc3dmodel/`:

- `…/admin/` — beheeromgeving met live preview
- `…/viewer/` — klantpagina (kaal model zonder parameters)
- `…/viewer/#c=…` — zelfstandige deel-link (config in de URL)
- `…/viewer/?e=TOKEN` — vaste link; vereist `configs/TOKEN.json` in de repo
  (download het bestand in de beheeromgeving en commit het naar `configs/`)

De Spline-runtime is gevendored in `vendor/spline/` zodat er geen
`node_modules` nodig is op de server. Let op: GitHub Pages moet de branch
serveren waar deze code op staat (Settings → Pages).

## Lokaal draaien

```bash
npm install
node scripts/serve.mjs        # http://127.0.0.1:8787
# open /admin/  → branding samenstellen, voorbeeld + deelbare link
# open /viewer/ → kaal model
```

Testen (headless Chromium; in een omgeving zonder internet worden de
draco/wasm-verzoeken lokaal afgevangen):

```bash
node scripts/test-branding.mjs congres   # before/after-screenshots branding
node scripts/test-viewer.mjs             # e2e: viewer met config + scènewissel
node scripts/test-sharpness.mjs          # scherpte in beweging: oud vs. nieuw (+ alpha-varianten als argumenten)
node scripts/inspect-scene.mjs           # inventarisatie objecten/materialen
```

## Hoe de branding werkt

De Spline-runtime bewaart alle scène-afbeeldingen in
`app._sharedAssetsManager.imageHolderCache`. Elke holder heeft een naam
(bijv. `Event Hall Scherm - Deel 1_2-8.png`) en de live THREE-textures in
`holder._cache`. `src/branding.js` herkent schermgroepen op asset-naam
(zie `SCREEN_ROLES`), vervangt de afbeelding in-place en zet `needsUpdate`
— elk object dat de asset gebruikt verandert mee.

Daarnaast:
- **Kleurverloop-recolor**: gradient-lagen in de Spline-materialen (o.a.
  pilaren en Grand Hall-scherm) hebben stops als vec4-uniforms
  (`layer.uniforms.fN_colors`). Alle tinten uit de NBC teal-familie gaan op
  hue naar kleur 1, de oranje-familie naar kleur 2, met behoud van de
  lichtheid per stop zodat het verloop diepte houdt. Egale kleurlagen worden
  alleen bij exacte NBC-kleuren vervangen (meubels blijven ongemoeid).
- **Logo op het Grand Hall-scherm**: nieuwe meshes rendert de Spline-pipeline
  niet (gecachte renderlijst), dus verplaatst `overlayLogoOnGrandHall` een
  bestaand pilaar-logovlak (het vlak dat tegen de achterwand kijkt, dus
  onzichtbaar) naar het scherm, georiënteerd op de "Welkom"-tekst.
- **Opstellingen aan/uit**: elke scène heeft een groep `Opstellingen > <mode>`
  met per hal een subgroep (`Event Hall`, `Grand Hall`, `GH - Feest`,
  `Sit down dinner (2)`, `Hosp1/2`). `setHallVisibility` zet daar `visible`
  op false; mapping in `HALL_GROUP_NAMES`.

Deel-URL's: `viewer/?e=TOKEN` laadt `configs/TOKEN.json` (token = 22 random
tekens, niet herleidbaar tot de klant). Voor snelle demo's zonder server kan
de volledige config ook in de URL-hash (`#c=…`).

## Beeldscherpte tijdens beweging

De Spline-runtime rendert zonder MSAA en gebruikt temporal anti-aliasing:
elk frame krijgt een subpixel-jitter en de resolve-shader mengt 10% nieuw
frame met 90% gereprojecteerde historie. Stilstaand convergeert dat in ~30
frames naar een strak beeld, maar tijdens draaien/zoomen (en de damping
daarna) wordt die historie elk frame opnieuw verschoven en geresampled: het
model "smeert" en springt pas na het stilvallen weer scherp.

`src/quality.js` (aangeroepen in `viewer/` direct na `app.load()`):
- **TAA-patch**: de resolve-shader (`renderer.pipeline.taaPass.resolveMaterial`)
  wordt runtime aangepast zodat de historie-weging afhangt van de
  bewegingssnelheid per pixel (velocity-buffer). Stilstaand ongewijzigd
  (`alphaStatic` 0.1), in beweging `alphaMoving` 0.5 vanaf `speedPx` 1.5 px/frame.
- **Pixel ratio**: de scènes staan op "auto" (= devicePixelRatio). Begrensd op
  2 (telefoons met DPR 3 renderden 9x zoveel pixels als 1x) en de ratio volgt
  DPR-wijzigingen (ander scherm, browserzoom).
- **Adaptief**: zijn >60% van de frames tijdens interactie trager dan 45 ms,
  dan gaat de pixel ratio één stap (×0,75) omlaag, nooit onder 1.

Debug/override: zet vóór het laden `window.NBC3D_QUALITY = { … }` (keys als in
`QUALITY_DEFAULTS`), of gebruik in de console `__nbc3d.quality.setTaaParams({ alphaMoving: 0.4 })`
en `__nbc3d.quality.setMotionSharpening(false)` om oud en nieuw te vergelijken.

## Nog te doen (zie wensendocument)

- Fijnere opstellingsvarianten (half/half, theater groot/klein, wand erin/eruit)
  — vergt nieuwe varianten in de Spline-editor
- Hospitality-area's aan/uit in de beheeromgeving (module ondersteunt het al:
  `halls: { hosp1, hosp2 }`)
- Lichtbeams/LED-lijnen rond deuren in huisstijlkleur
- Entresol-bestickering, traptreden, zaalbordjes, extra groen
- Beheeromgeving met login + server-side opslag van configs en uploads
- Integratie in de bestaande site/CMS (config injecteren naast `REACT_THREE_CONFIG`)
