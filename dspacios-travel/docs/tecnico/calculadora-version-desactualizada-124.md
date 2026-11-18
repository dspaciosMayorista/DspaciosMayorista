# #124 — "La calculadora cambió desde que la abriste…" (stale calculator version)

Status: implemented and executor-verified locally; **not** audited by Codex, **not** accepted by the owner, nothing staged, committed, pushed or run remotely. No migration. Base: `origin/main` 51ea60612 (worktree `dspacios-travel/.worktrees/124-calculadora-conflicto`, branch `claude/124-calculadora-conflicto-version`).

## 1. Where the message comes from

| Piece | Location |
| --- | --- |
| Message (old, single text for every cause) | `guardarCalculadora` in `app/(dashboard)/dashboard/producto/hoteles/actions.ts` (constant `CALCULADORA_DESACTUALIZADA`, removed by this task) |
| Only caller | `CalculadoraEditor.tsx` — 5 call sites (Dubai save, Mixta save, Mixta «Sustituir…», Mixta revert after a failed substitution, Corporativa save). The buttons «Guardar calculadora», «Generar (agregar/actualizar)» and «Reemplazar TODAS» all call «save» first. «Generar»/«Reemplazar» themselves never produce this text; their own comparison (`p_previas`) has different wording. |
| Token compared | `hotel_calculadora.version` (bigint). Trigger `tg_version_fila_43` (migration 297, `20260601000297_calculadora_grupos_dias.sql` lines 45–60) sets `1` on insert and `old.version + 1` on **every** update, even an identical one. The update is `... where hotel_id = :id and version = :versionLeida`; 0 rows ⇒ message. |
| Where the client got its token | `page.tsx` reads `hotel_calculadora.version` once per render and passes `versionInicial`; `CalculadoraEditor` stored it with `useState(versionInicial)` — a state that is **never re-synchronised** with later props. |
| Other writer of the same row | `renombrarTemporadaEnDatos` (`actions.ts` ~563–600, called from `actualizarTemporada` and `activarCambioPromocion`): renaming a vigencia rewrites the season name inside `hotel_calculadora.params` (`renombrarTemporadaEnParams`, `lib/calc/calculadoras.ts`), which bumps the version. |

Nothing compared is a timestamp, a float, a serialized number, an ordering or a null/default normalisation: the token is an integer. Those hypotheses were checked and ruled out (see §3 case 1–4).

## 2. Confirmed triggers

All reproduced with the real server actions against a real Postgres + PostgREST (`supabase/scripts/repro_124_conflicto_calculadora.sh`, throw-away database copied from the local4360 synthetic photo plus migrations 300–302; output in §3).

1. **The same person renames a vigencia on the same page** (Temporadas box and calculator share one tab panel and one client component tree). The rename cascade rewrote the calculator (version +1) and the page refreshed its props, but the open editor kept the old version **and** its form state under the old season name. Nobody else is involved. Evidence: after the rename the database held v5 while the open editor still sent v4; the audit trigger (087) records the same actor for the rename and the calculator rewrite. Only happens when the renamed vigencia is referenced by the calculator (`bases`, `bases_por_regimen`, Dubai `promos`); an unrelated vigencia (case 6a) or a date-only edit of a referenced one (6b) does **not** bump the version.
   *The guard was protecting data.* A form still holding the old name derives `params.bases` from the new `temporadas` prop, so the renamed season's base appears empty and would have been dropped on the next successful save.
2. **A genuine concurrent save** (second browser/tab/session of the same or another account) — case 7.
3. **A write refused by the database with the version unchanged** (case 9): `hotel_calculadora` has a RESTRICTIVE update policy `puede_escribir_catalogo_global()` = `agencia_activa_sesion() = 'mayorista'`, which needs a live `auth.sessions` row (and, for superadmin, the agency context). An ended session or a non-mayorista agency context makes the update affect 0 rows — indistinguishable from a stale version under the old code, and printed as "otra persona la guardó". Client version == database version in that case.
4. A second tab of the same person holding an older version (case 8a). **Not** possible inside one form: the three buttons are `disabled={pending}`.
5. Substitution flow («Sustituir por −x%…», Mixta): it is *save → substitute → (on failure) save again with the version returned by the first save*. `sustituirPromoManualMixta` and `generarTarifasCalculadora` do not write `hotel_calculadora` (case 3, 8a), so the flow chains correctly; it only conflicts when one of the triggers above happens in between. The manually maintained promotion row shown in the screenshot and its warning («Promociones escritas a mano sin tocar…») are a separate mechanism (`promosManualesIntactas`) and are not part of this comparison.
6. Day groups: the group panel compares its own `calcVersion` plus the vigencia fingerprint. After a rename it is also rejected (case 8b), with its own message («la configuración de esta vigencia cambió…»), which names a vigencia, not a person. Not changed by this task.

Ruled out: save → generate (generate does not touch the version), generate → save, save → edit → save (the editor chained the returned version already), timestamps/serialisation/null normalisation (integer token), polling/background writes (none exist).

## 3. Reproduction output (before the fix, then after)

Command: `sh supabase/scripts/repro_124_conflicto_calculadora.sh` (from `dspacios-travel/`, needs the `pg4360` container). "client sends" = the version the form holds; "database held" = `hotel_calculadora.version` just before the call.

| # | Case | client sends | database held | Result |
| --- | --- | --- | --- | --- |
| 1 | open → edit → save | v1 | v1 | ok → v2 |
| 2 | save → edit → save (chained) | v2 | v2 | ok → v3 |
| 3 | save → generate | – | v3 | generate ok (3 rows); version unchanged |
| 4 | generate → save from the same form | v3 | v3 | ok → v4 |
| 5a | same user renames `ALTA`→`ALTA 2027`, then saves the open form | v4 | v5 | rejected (before: generic text; after: `motivo: "cambio"` + the stored copy) |
| 6a | rename of an unrelated vigencia (`CERRADA`) | v6 | v6 | version unchanged; save ok → v7 |
| 6b | date edit of a referenced vigencia | – | v8 | version unchanged |
| 7 | two sessions, same base version | v9 / v9 | v9 → v10 | first ok → v10; second rejected (`cambio`, winner's copy returned); audit row names the winner |
| 9 | session ended (RLS refuses) | v11 | v11 | before: "otra persona…"; after: `motivo: "sin_permiso"` ("la calculadora NO cambió") |
| 8a | second tab / stale closure | v1 | v3 | rejected |
| 8b | group panel after a rename | v1 | v2 | rejected with the group panel's own message |

## 4. The fix

Principle: keep optimistic concurrency exactly as is (still `update … where version = :leida`, no auto-retry, no force-save, no overwrite of manual promotion values, no discard of unsaved edits) and fix (a) the stale client copy and (b) the wording.

Server — `guardarCalculadora` (`actions.ts`):
- On a 0-row result (or `23505` on first insert) it performs **one** primary-key read (`diagnosticarRechazoCalculadora`), only on the rejection path, and returns `motivo`:
  - `cambio` — stored version ≠ yours: returns `actual {version, tipo, params}` and the text "No se guardó nada… tenías la versión X; la actual es la Y. No se sobrescribió ningún dato."
  - `sin_permiso` — stored version == yours: the write was refused (session/agency/role); text says the calculator did **not** change and what to check.
  - `sin_diagnostico` — the read itself failed: honest generic text, no guessed cause.
- The rename-cascade warning no longer asserts "alguien la guardó al mismo tiempo".

Client — `CalculadoraEditor.tsx` + `lib/hoteles/calculadoraConflicto.ts` (pure):
- The editor now owns the stored copy it knows (`guardada`, kept in a ref so no closure goes stale), updated by every own save. It no longer relies on a state frozen at mount.
- When the page refresh brings a **newer** version than the editor knows (the rename case) or the server rejects a save with `cambio`, `reconciliar` compares the known stored copy with the new one using only data already in hand (props / the rejection payload):
  - no unsaved edits ⇒ adopt the new copy (forms remounted with it), banner explains what changed, **no request**;
  - unsaved edits + the change is a **confirmed rename** (applying that exact rename to the known copy reproduces the new copy) ⇒ the same rename is applied to the on-screen values, they are kept, nothing is saved, banner says so;
  - unsaved edits + anything else ⇒ nothing adopted, nothing saved, edits stay on screen, banner lists the changed sections and offers an explicit, confirmed «Cargar la versión guardada» (discards unsaved edits) — recarging the page also discards them and the banner says so;
  - identical content (own write returning through the page refresh) ⇒ version adopted silently.
- Unsaved-edit detection is two refs (`base` at mount/after save vs `snap` while the page is not ahead), updated by two effects with no state and no extra renders.
- The banner never names a person. Only the existing audit log (087, `/dashboard/auditoria`, superadmin/gerencia, table `hotel_calculadora`) can prove an actor.
- Group-mode forms keep their own save path and do not feed the snapshots.

### Before / after message (only confirmed triggers)

| Trigger | Before | After |
| --- | --- | --- |
| Same user renamed `ALTA` (clean form) | "La calculadora cambió desde que la abriste (otra persona la guardó o se renombró una vigencia). Recarga la página…" | Banner (info): "La vigencia «ALTA» se renombró a «ALTA 2027» y la calculadora guardada ya usa el nombre nuevo (versión 4 → 5). No tenías cambios sin guardar: cargamos la versión actual y no se sobrescribió nada. Repite la acción que querías." |
| Same, with unsaved edits | same generic text | Banner (info): "… Conservamos tus cambios sin guardar y los pasamos al nombre nuevo. Todavía NO están guardados: revísalos y pulsa Guardar." |
| Concurrent save, unsaved edits | same generic text | Banner (alert): "La calculadora guardada en la base cambió después de que abriste esta pantalla (versión 4 → 6); cambió: modificadores. Tu clic no guardó nada. No se guardó nada y tus cambios sin guardar siguen en pantalla… [Cargar la versión guardada] [Entendido]" |
| Write refused, version unchanged | same generic text (wrong) | Form message: "No se guardó nada. La calculadora NO cambió (sigue en la versión 11…): la base rechazó la escritura. Suele pasar cuando la sesión terminó o la agencia activa/el rol no permite editar el catálogo…" |
| Unknown | same generic text | "…no se pudo comprobar el motivo… Tus valores siguen en pantalla; copia lo que necesites, recarga y vuelve a intentarlo." |

## 5. Plain explanation

| User action | Actual trigger | What changed | Was anything saved? | How to recover |
| --- | --- | --- | --- | --- |
| Renamed a vigencia, then clicked Guardar / Generar in the calculator | The rename rewrote the calculator's season names (version +1); the open editor kept the old version and old names | Season name inside the calculator (`ALTA`→`ALTA 2027`) | No (calculator) — the rename itself and its tariffs were saved | Automatic now: editor adopts the new copy (or carries your edits to the new name) and tells you; press the action again |
| Clicked Guardar while someone else saved from another session | Genuine concurrent save | Whatever the banner lists (sections) | No | Review the banner; keep editing or «Cargar la versión guardada» (discards unsaved edits) |
| Clicked Guardar, version identical in the message | Database refused the write (ended session, agency context or role) | Nothing | No | Sign out/in, check the active agency (superadmin: agency switcher), retry |
| Clicked Guardar from an old tab | Tab holds an older version | Older tab only | No | Same as a concurrent save: the banner shows what is newer |

**Real concurrent change vs same-session bug.** Open `/dashboard/auditoria`, filter table `hotel_calculadora`: each row has the actor (auth user) and the version. If the row just before your failed save has *your* e-mail and its time matches the rename you made, it was the same-session rename. A different actor, or a version jump with no matching action of yours, is a real concurrent change. If the error says "NO cambió… rechazó la escritura" it is a permission/session problem, not a version problem. The application never infers an actor.

## 6. Tests personally executed (local)

- `pruebas/calculadoraConflicto124.test.ts` — 8 pure tests (classification, stable comparison, rename cascade on a copy, message wording). Pass 8/8.
- `pruebas/calculadoraConflicto124.react.ts` — 12 tests with the REAL `CalculadoraEditor` (jsdom), actions replaced: chaining, save→generate, rename with clean form, rename with unsaved edits (values kept and carried), Dubai promotion rename, non-rename change with unsaved edits, real conflict on click with/without edits, refused write, own write returning with the refresh, closed panel, typing makes 0 requests. Pass 12/12. Existing `pruebas/calculadoraGrupos297.react.ts` still 15/15.
- `supabase/scripts/repro_124_conflicto_calculadora.{sh,mjs}` — real actions + real Postgres/PostgREST, all cases of §3, after the fix: "ALL CHECKS PASSED".
- `pruebas/calculadoraGrupos297.test.ts` — the two source-level tests that encoded the old text were rewritten to the new contract (`cambio` + stored copy, `sin_permiso`, `sin_diagnostico`, 23505 on first insert, one write + one read); related suites (Dubai/Mixta/Corporativa generators, catalogue, wiring) 268 tests: all pass after that rewrite (44/44 for the two touched files).
- `tsc --noEmit`: clean.
- Compiled local app desktop/mobile and final `next build`: **not executed** — see §7.

## 7. Request measurements (VALIDACION_CONSUMO_VERCEL.md)

**Measured (local, executor):** the request count per interaction is bounded by construction and asserted in the React tests with the real editor: typing = 0 requests (3 consecutive edits, test «escribir en el formulario…»); one «Guardar calculadora» click = exactly 1 `guardarCalculadora`; «Generar» = 1 save + 1 generate; a rejected click = 1 request with no retry (`nombres().length === 1`); adopting a newer stored copy after a rename = 0 requests (the data arrives with the page refresh the rename already triggers). Server side, with the real actions and Postgres: a rejected save adds exactly **one** primary-key `select` on `hotel_calculadora` (asserted in `calculadoraGrupos297.test.ts`); a successful save adds none. There is no timer, polling or retry loop in the new code; `useEffect` on `versionInicial` fires only when the page delivers a newer version and issues no request.

**NOT executed (owner decision, 2026-11-17, because free RAM stayed at 1.7–2.7 GB and the build's TypeScript phase peaks at ≈2.4–2.5 GB; the local memory guard stops it below 400 MB free and was not bypassed):** the final local `next build`, and the compiled-app desktop/mobile browser run. Three build attempts were stopped by the guard (peaks 1,950 / 2,392 / 2,470 MB). `tsc --noEmit` (the TypeScript step of the build) passed; Turbopack compilation itself reported «Compiled successfully» before the guard stopped each run. The browser script `supabase/scripts/local124/verificar_124_navegador.mjs` and the isolated stack `supabase/scripts/local124/local124.ps1` are written but **have never been run to completion: treat the script as unverified**. No Vercel/Supabase hosted metrics were measured.

Static reasoning (not measured elsewhere): the added work is one primary-key `select` on a **rejected** save only (never on a successful save), plus pure in-memory comparisons; no timers, no polling, no `useEffect` that issues requests; the `useEffect` on `versionInicial` runs only when the page delivers a new version. Hosted Vercel/Supabase metrics: not measured; no claim of zero impact beyond the above.

## 8. Limitations and remaining gates

- **Pending gates:** (1) final local `next build` (needs ≈3 GB free RAM; run `supabase/scripts/local124/local124.ps1 prod` or `next build` after freeing memory); (2) compiled-app browser run, desktop + 390 px, with `local124.ps1 preparar|prod` then `node supabase/scripts/local124/verificar_124_navegador.mjs <outDir>` (the script must be debugged on its first real run); (3) Codex audit; (4) owner local acceptance (`pending-owner-local-review.md`, section #124).
- Local resources left behind, all **stopped**: database `r124_revision` in container `pg4360` and containers `r124-auth/-rest/-kong` (own roles, no data of #43/#60 or the lote touched), `node_modules` and `.next` cache inside the worktree. `local124.ps1 limpiar` removes the database, roles, containers and network.
- The screenshot itself was not available to the executor; the owner's exact trigger could not be identified from it. The three confirmed triggers are those above; the audit log tells which one it was.
- Rebase on rename covers renames of vigencias referenced by `bases`, `bases_por_regimen` and Dubai `promos`. A change that mixes a rename with other edits to the stored copy is reported as a generic change (no rebase).
- Unsaved-edit detection after a rename relies on the last in-sync snapshot of the form; values typed while a save is in flight are not guaranteed to be carried.
- The day-group panel (`CalculoGrupoPanel`) still has its own wording; it adopts the editor's version after a rename but is not otherwise changed.
- Kept from the old behaviour: no automatic retry; every message still requires an explicit user action.
