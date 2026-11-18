# Slow / partially loaded images in Programas and Receptivos — measurement and local fix (2026-11-17)

Follows `imagenes-tarifario-lentas-2026-11-13.md` (static candidates only, no measurements). Branch `claude/imagenes-programas-receptivos`, worktree `.worktrees/img-lentas-programas-receptivos`, based on `origin/main` 51ea60612. No migration, no staging/commit/push/Preview, no remote SQL, no production secrets, no paid optimisation service, no stored media touched.

Status: implemented and verified locally by the executor. **Not accepted**: Codex audit and the owner's consolidated local review are still required (see "Pending gates").

## 1. Verdict on the static hypotheses (measured, not assumed)

| Hypothesis from 2026-11-13 | Measured result |
| --- | --- |
| Programas cards use a raw `<img>` with no lazy loading | **Confirmed.** Baseline requested all 12 covers (61.1 MB) at page load, 12 in flight at once, on desktop and mobile. |
| Some Receptivos images use `next/image` + `unoptimized`, so no lazy/size benefit | **Refuted for lazy loading.** `next/image` already defaults to `loading="lazy"`: baseline fired 9 requests (20.5 MB) before any scroll on desktop and 4 (9.1 MB) on mobile, the rest only on scroll. `unoptimized` does mean the browser downloads the stored original (no resize), which is the real cost. |
| Uploaded files may lack size reduction | **Confirmed in code**: both uploaders (`ProgramaImagenes.tsx`, `ServicioFotoCell.tsx`) send the raw file (limits 10 MB / 8 MB). A 4608×3456 / 9 MB cover is rendered in a 422×160 px box (a ~236× pixel excess). |

Root cause of "blank or half-drawn" cards: catalog photos are full-size originals; on a throttled link the 12 (Programas) or ~40 (Receptivos) concurrent downloads share the bandwidth, so the images inside the first viewport finish last (see tables). A broken image additionally showed the browser's broken-image icon + alt text over an empty box.

## 2. Exact rendering paths

| Catalog | File : element | Source of the URL |
| --- | --- | --- |
| Programas list cards | `app/tarifario/TarifarioPublic.tsx` `PorProgramas` (was a raw `<img src={p.portada_url}>`) | `programas.portada_url` via `getProgramasResumen` |
| Receptivos search results | `app/tarifario/BuscadorReceptivos.tsx` (was `next/image … unoptimized`) | `fotosPorServicio` map from `servicios_adicionales.foto_url` |
| Receptivos catalog («Explora todos») | `app/tarifario/ExploraReceptivos.tsx` (same) | same map, through `receptivosPorDestino` in `VistaBooking.tsx` |
| Receptivo detail modal | `app/tarifario/tarjetaHotelCompartida.tsx` (same) | same |
| Uploaders | `…/producto/programas/[id]/ProgramaImagenes.tsx`, `…/producto/servicios/ServicioFotoCell.tsx` | Storage buckets `programas`, `servicio-fotos` |

Not changed on purpose: the Programa detail hero and print document (`app/tarifario/programa/[id]/page.tsx`, `…/doc/page.tsx`: server components over a gradient fallback, not part of the catalog grids) and the hotel galleries (`CarruselFotoHotel`, `VistaBooking` hotel cards), which are out of this block's scope.

## 3. Method and environment (local only)

- **App**: `next build` + `next start` of the compiled worktree on `127.0.0.1:3047`, started with an environment built from scratch and the loopback-only network guard (`supabase/scripts/local-lote/guardia_red_lote.cjs`). Baseline = unmodified `origin/main` (BUILD_ID `LhtyLPT8…`); after = changed code (BUILD_ID `g80FMeKH…`). Same machine, same fixtures, same driver.
- **Data**: database `dspacios_img`, a private copy (`create database … template lote_revision`) inside the existing `pg4360` container; `lote_revision` and every shared database were not modified. Migrations 297–306 were applied to the copy so the schema matches the code. Synthetic seed `semilla_img.sql`: 12 published Programas (6 camera originals ≈ 9 MB, 3 × 2.3 MB, 3 × 0.3 MB), 45 Receptivos (≈ 2.3 MB each, 3 destinos), tarifario published with the real `generarTarifario` action. PostgREST (`img-rest`) + a path-stripping proxy replace Kong; no GoTrue (anonymous session).
- **Images**: `servidor_imagenes.mjs` is a stand-in for Storage public buckets (`Cache-Control: max-age=3600`, ETag) with injectable faults (`/slow/<ms>/`, `/fail/`, `/missing/`, `/trunc/`). Fixtures are synthetic noisy JPEGs from `generar_fixtures.mjs` (no real media).
- **Browser**: one Edge headless instance driven by raw CDP (`medir_cdp.mjs`, no dependency): desktop 1366×768 DPR 1 / mobile 390×844 DPR 3; unthrottled / 4G (9 Mbps, 60 ms) / 3G (1.6 Mbps, 150 ms); cold (cache cleared) / warm (second load, cache kept). Slow networks are **time-boxed** (45–60 s windows): "not displayed" means not within the window. Each run: open `/tarifario`, open the tab, wait for quiet, scroll to the bottom in 0.8-viewport steps, then wait 10 s idle.
- Re-run the whole thing: see `supabase/scripts/local-img/` (`local-img.ps1`, `semilla_img.sql`, `generar_fixtures.mjs`, `generar_tarifario_img.ts`, `medir_cdp.mjs`, `medir_reductor.mjs`).

### Limits (what this does NOT show)

- Not production: no Supabase Storage/CDN, no HTTP/2-3 multiplexing (the stand-in is HTTP/1.1, so Chrome opens ≤ 6 connections per host; production would run more concurrent streams, i.e. more bandwidth sharing, not less), no real TTFB/LCP. **No production TTFB/LCP claim is made.** Numbers are local and relative (before vs after on the same rig). One sample per scenario; differences of ~1 s are noise (the very first baseline scenario includes browser/server warm-up: 5.7 s vs a typical 0.7–0.9 s).
- Fixtures are noise-like (worst-case compressibility); real photos compress better, so absolute reducer output sizes are an upper bound.
- `fetchpriority` cannot show a benefit on an HTTP/1.1 stand-in; it was kept for the first Programas card and the modal photo because it is harmless and standard, but no gain is claimed.
- The upload reducer was measured in Edge only (Chromium). Safari/Firefox paths were not exercised (fallback = upload the original, as before).
- Server-side cost of the real page (data load) was not changed and not re-measured here.

## 4. Measurements

Programas (12 covers; 61.1 MB of originals). «Before» = baseline build; «Code» = changed build, same originals; «Reducer» = same fixtures after `reducirImagen()` (real outputs, see §5; models **new uploads only**).

| Scenario | Metric | Before | Code only | Reducer (projection) |
| --- | --- | --- | --- | --- |
| desktop 4G cold | requests / MB before scroll | 12 / 61.1 | 12 / 61.1 | 12 / 10.2 |
| | first catalog image shown | 49.5 s | 49.5 s | 7.3 s |
| | all first-viewport images (6) shown | 54.5 s | 54.8 s | 8.2 s |
| mobile 4G cold | requests / MB before scroll | 12 / 61.1 | **6 / 53.7** | 6 / 7.3 |
| | first catalog image shown | 49.3 s | 49.4 s | 7.3 s |
| | layout shift (CLS) | 0.024 | **0** | 0 |
| mobile 3G cold (45 s window) | first catalog image shown | never | never | 39.2 s |
| | requests / MB before scroll | 12 / 0 | **6 / 0** | 6 / 7.3 |
| desktop unthrottled, cold / warm | requests; MB | 12; 61.1 / 0.0 | 12; 61.1 / 0.0 | 12; 10.2 |

Receptivos catalog («Explora»); the search-results flow behaves identically (same URLs, same lazy behaviour): 45 photos, 102.9 MB of originals.

| Scenario | Metric | Before | Code only | Reducer (projection) |
| --- | --- | --- | --- | --- |
| desktop 4G cold (60 s window) | requests / MB before scroll | 9 / 20.5 | 9 / 20.5 | 9 / 6.8 |
| | MB downloaded in the window | 86.8 | 86.8 | 34.2 |
| | first catalog image shown | 13.1 s | 13.1 s | 4.9 s |
| mobile 4G cold | requests / MB before scroll | 4 / 9.1 | 4 / 9.1 | 4 / 3.0 |
| | first catalog image shown | 9.1 s | 9.1 s | 3.6 s |
| mobile 3G cold (45 s window) | first catalog image shown | 48.6 s | 48.6 s | 18.3 s |

Findings from the tables:
1. **The display-code change alone does not make existing originals faster**, except Programas on mobile (half the images, 7.4 MB less, deferred until needed) and CLS on mobile. A 12-card desktop grid lies entirely inside Chrome's lazy-load margin, so lazy loading cannot defer anything there; Receptivos was already lazy.
2. **Bytes are the lever.** The same page with reducer-sized sources moves far fewer bytes (Programas 61.1 → 10.2 MB, ≈ 6×; Receptivos 86.8 → 34.2 MB in the window, ≈ 2.5×) and the first photo appears ≈ 7× (Programas desktop 4G) to ≈ 2.5–3× (Receptivos) sooner. It applies to **new uploads only**; existing originals keep their size until the owner decides how to treat them (§7).
3. In the Receptivos first viewport there are **zero** catalog photos (the search form sits above them; screenshot reviewed), so no photo there is given priority; only the first Programas card and the detail-modal photo are.
4. Warm cache: unthrottled warm loads transfer 0 bytes in both builds (the stand-in sends `max-age=3600`). On the throttled warm runs the first pass had not fully cached (time-boxed), so the "0 bytes" claim is only made for the unthrottled warm case.
5. Search-results flow vs catalog: both list the same service photos; the browser fetches each URL once per page (de-duplicated), so results do not double the bytes.

### Failed / missing / slow / truncated images (desktop and mobile, unthrottled)

Injected on 4 Programas covers and 4 Receptivo photos: one `slow` (first byte after 8 s), one `404`, one `500`, one truncated at 40 %.

| | Before | After |
| --- | --- | --- |
| Broken `<img>` elements left in the DOM | 3 per catalog (6 on the search page) | **0** |
| What the user sees | browser broken-image icon + alt text over a blank box | the same «Sin foto» placeholder used for missing photos, at the same box size (screenshots reviewed) |
| Requests per URL per component | 1 | 1 (no retry added) |
| Image requests during 10 s of idle after settling | 0 | **0** |
| Slow image | appears when it arrives | appears when it arrives; box already reserved (CLS ≈ 0) |

The search page shows `maxPorUrl = 2` for the failing URLs in both builds: the results list and the catalog are two components that each request their own failing URL once; failed responses are not cached. It is not a retry loop (0 requests while idle).

## 5. The fix (smallest set the evidence supports)

1. `components/ImagenCatalogo.tsx` (new, 28 lines): one image component for the four catalog paths. It fills a positioned parent that already reserves the space (aspect ratio / fixed height); `loading="lazy"` + `decoding="async"` by default; `prioridad` = eager + `fetchpriority="high"` (first Programas card, detail-modal photo only); on error, or when an image already failed before hydration, it renders the existing «Sin foto» placeholder and never retries (state keyed by `src`, so a changed URL gets a fresh chance). No effect hooks, no timers, no requests of its own.
2. Programas card: `<img>` → `ImagenCatalogo` inside a `relative h-40` box (same height as before).
3. Receptivos results, catalog and modal: `next/image … unoptimized` → `ImagenCatalogo` (the rendered element is the same plain `<img>`; `unoptimized` was never providing a resize). `next/image`/`unoptimized` were not removed from any other file.
4. `lib/imagenes/reducirImagen.ts` (new) + both uploaders: before uploading, a **new** Programa cover or Receptivo photo is re-encoded client-side (canvas → WebP q0.82, longest side ≤ 1920 px, EXIF orientation applied by `createImageBitmap`). Files ≤ 600 KB and ≤ 1920 px, GIF/SVG/HEIC, decode errors, or no size gain are uploaded **as-is** (previous behaviour). Flyer and Historia pieces are never touched. Uploads also get `cacheControl: "31536000"`: the object path is unique per upload (timestamp), so it can be immutable-cached; this only affects new objects.
5. No new dependency, no paid service, no change to `next.config.ts`, no change to search, pricing, filtering, reservation or permissions (the image URLs and the data loading are untouched).

Reducer measured in Edge on the fixtures (12 originals + an EXIF-rotated one): 4608×3456 / 8.9–9.6 MB → 1920×1440 / 1.2–1.3 MB (≈ 7×, 410 ms); 3000×2000 / 2.3 MB → 1920×1280 / 0.73 MB (260 ms); EXIF-rotated 3000×2000 → 1280×1920 (orientation applied); a 283 KB 1600×900 file, a GIF and an SVG came back untouched; average of the 13 outputs 986 KB (noise fixtures = worst case).

## 6. Request / consumption validation (`VALIDACION_CONSUMO_VERCEL.md`)

- Scope reviewed: the diff above and the two uploaders. Images are served by Supabase Storage directly (plain `<img>`, `unoptimized` before and after); **no `/_next/image` transformation exists before or after**, so no Vercel Image Optimization usage is introduced or removed. HTML/RSC payload is unchanged (same URL strings).
- Expected requests per action: page load = one image request per catalog image that enters the lazy window; scrolling adds only the images approaching the viewport; opening the modal adds one (its image). No polling, no retry, no effects in the new component (`useState` + a ref callback that runs on render and calls `setState` only when an already-failed image is detected; a repeated `error` event for the same `src` is a no-op — covered by test).
- Proven locally (compiled app, counters on every image request): 0 requests in the 10 s after settling in all failure scenarios; at most 1 request per URL per component; no growth with scrolling beyond the images actually reached. Server work and transformation cost added: **none** (the reducer runs on the uploader's browser; ≈ 0.3–0.4 s CPU per upload on this machine).
- Not proven: multi-tab behaviour (there is no shared state or timer to deduplicate) and production CDN behaviour.

Focused tests (all pass): `pruebas/imagenCatalogo.react.ts` (4: lazy/eager attributes, missing src, single failure → placeholder with no retry and recovery on a new `src`, failure before hydration), `pruebas/reducirImagen.test.ts` (3: sizing rule, untouched formats, decode failure/small file), `pruebas/imagenesCatalogo.wiring.test.ts` (3: wiring of the four paths and both uploaders), plus the existing `pruebas/receptivosPortada89.react.ts` (#89, unchanged and passing) and `eslint` on every changed file. Registered `imagenCatalogo.react.ts` in `test:react`. Final `next build` of the changed code: exit 0, no TypeScript/lint errors (BUILD_ID above). Full suites were not repeated: the change touches no logic outside image rendering/upload.

## 7. Pending gates and decisions (nothing here was done)

1. **Codex audit** of the diff and of these measurements; **consolidated owner local review** (walkthrough in `pending-owner-local-review.md`).
2. **Existing stored originals stay as they are** (new uploads only). Options for the owner, each needing explicit approval: (a) one-off re-encode/backfill of the stored files and URLs (migrates media, new URLs); (b) Supabase Storage image transformations (`/render/image`) or Vercel image optimisation (`/_next/image`): both are paid usage, not evaluated for cost here; (c) accept the current originals and re-upload the heaviest covers through the new uploader (zero cost). Nothing was enabled, deleted or rewritten.
3. **Finding outside this block (needs a production check, not asserted):** in the repo's RLS, `servicios_adicionales` is readable only by internal roles (`servicios_adicionales: interno`), while the tarifario loads the Receptivos photo map with the visitor's own session (`lib/tarifario/datos.ts`). In the local rig an anonymous visitor therefore saw «Sin foto» on every Receptivo until a read policy was added to the **private copy only** (documented in `semilla_img.sql`). If production behaves the same, anonymous/agency visitors never receive Receptivo photos; whether production has an extra policy is unknown.
4. Integration notes: `#102` edits `TarifarioPublic.tsx` (disjoint hunks from the Programas card; its import-block insertion is ~3 lines from mine, so a textual conflict is possible) and `package.json` `test:react`; `#53` edits the same `test:react` line. Resolve by keeping both file lists. No other overlap with #53/#102 files.
5. Not covered: Programa detail hero/print background, hotel galleries/cards, Safari/Firefox reducer path, multi-tab, production network.

## 7.bis Update 2026-11-17 — owner decisions O1 and O2 (integrated source)

- **O1 (public Receptivo photos):** `lib/tarifario/fotosServicio.ts` reads ONLY `id` and `foto_url` of the services already published in the tarifario the person sees, with the service client (`datos.ts` and `resumen.ts`); no policy was opened and no other column of `servicios_adicionales` is exposed. Visitors, allies, `venta` and internal roles now receive the same photos (12/12 in the review rig; missing or broken photos fall back to «Sin foto» with no retry).
- **O2 (upload size):** both uploaders call `prepararSubidaImagen` (`lib/imagenes/reducirImagen.ts`): reduce FIRST, then apply the final limit (8 MB Receptivos, 10 MB Programas cover; flyer/historia are not reduced and keep the limit on the original). Unchanged: Storage limits and format validation. Bounded browser work: one decode, and only for originals up to 40 MB. A non-reducible oversized file (GIF/SVG/HEIC) gets a clear error naming the format. Evidence in `observaciones-o1-o4-2026-11-17.md`.

## 8. Files

New: `components/ImagenCatalogo.tsx`, `lib/imagenes/reducirImagen.ts`, `pruebas/imagenCatalogo.react.ts`, `pruebas/reducirImagen.test.ts`, `pruebas/imagenesCatalogo.wiring.test.ts`, `supabase/scripts/local-img/*` (measurement rig; `resultados/*.json` are the raw per-scenario results behind every table — `node resumir_resultados.cjs resultados/baseline.json` prints a summary — and `baseline` = pre-change build, `after` = changed build, `after_reductor` = reducer-output projection, `*_fallas*` = injected failures, `after_reposo` = idle check, `reductor` = upload-reducer sizes), this document.
Modified: `app/tarifario/TarifarioPublic.tsx`, `BuscadorReceptivos.tsx`, `ExploraReceptivos.tsx`, `tarjetaHotelCompartida.tsx`, `…/producto/programas/[id]/ProgramaImagenes.tsx`, `…/producto/servicios/ServicioFotoCell.tsx`, `package.json` (one test registered).
