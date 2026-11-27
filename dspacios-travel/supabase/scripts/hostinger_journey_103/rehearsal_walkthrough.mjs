// EXECUTOR REHEARSAL of the owner walkthrough (docs/tecnico/owner-walkthrough-103.md) on a SEPARATE disposable fixture: the exact W1–W11 sequence, in order, through the dedicated review browser profile
// (accounts chosen by saved-credential autofill, real Auth sign-in, no password typed), (the stop/start preservation cycle is rehearsal_lifecycle.mjs).
//   Run with the fixture's own folder:  HJ_REVIEW_DIR=<rehearsal folder> node rehearsal_walkthrough.mjs     (the fixture is created with: node review.mjs start)
// Local, synthetic, loopback; captured mail only. Results → <folder>/evidence/rehearsal_w1_w11.json
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { AQUI, ajustesRevision, cargarConfig, contrasenaRevision, sqlDesechable } from "./lib.mjs";
import { CUENTAS_REVISION, abrirNavegador, cuentasGuardadas, ingresarConAutofill, prepararPerfil } from "./review_browser.mjs";

const a = ajustesRevision(), cfg = cargarConfig(a), sql = sqlDesechable(a), BASE = `http://127.0.0.1:${cfg.puertos.app}`, MAIL = `http://127.0.0.1:${cfg.puertos.correo}`;
const EVID = path.join(a.work, "evidence"); fs.mkdirSync(EVID, { recursive: true });
const resultados = [];
const afirmar = (n, ok, d = "") => { resultados.push({ nombre: n, ok: !!ok, detalle: String(d).slice(0, 400) }); console.log(`${ok ? "PASS" : "FAIL"} · ${n}${ok ? "" : " · " + String(d).slice(0, 300)}`); };
const sqlJ = (q) => sql(q);
const mensajes = async () => (await (await fetch(`${MAIL}/api/v1/messages?limit=200`)).json()).messages ?? [];
const detalle = async (id) => (await (await fetch(`${MAIL}/api/v1/message/${id}`)).json());
const review = (...args) => spawnSync(process.execPath, [path.join(AQUI, "review.mjs"), ...args], { env: { ...process.env, HJ_REVIEW_DIR: a.work }, encoding: "utf8" });
const huella = () => { const r = spawnSync(process.execPath, [path.join(AQUI, "review_huella.mjs")], { env: { ...process.env, HJ_REVIEW_DIR: a.work }, encoding: "utf8" }); if (r.status !== 0) throw new Error("fingerprint failed: " + (r.stderr ?? "").slice(0, 200)); return JSON.parse(r.stdout); };

let b = null, cuentaActual = null;
const texto = () => b.evaluar(() => document.body.innerText);
const clic = (re, ambito = "button", dentro = "body") => b.evaluar((s, a2, d) => { const r = new RegExp(s, "i"); const raiz = document.querySelector(d) ?? document.body; const el = [...raiz.querySelectorAll(a2)].find((x) => r.test((x.getAttribute("aria-label") || "") + " " + (x.textContent || ""))); if (!el) return false; el.click(); return true; }, re.source, ambito, dentro);
const escribir = (sel, v) => b.evaluar((s, val) => { const el = document.querySelector(s); if (!el) return false; const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, "value").set.call(el, val); el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? "change" : "input", { bubbles: true })); return true; }, sel, v);
const desborde = () => b.evaluar(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const panel = () => b.evaluar(() => document.querySelector('[data-testid="solicitudes-proveedor"]')?.innerText ?? "");
const pulsar = (re) => b.evaluar((s) => { const x = [...document.querySelectorAll('[data-testid="solicitudes-proveedor"] button')].find((e) => new RegExp(s).test(e.textContent)); if (!x || x.disabled) return false; x.click(); return true; }, re);
/** Signs in as `cuenta` through the SAVED-CREDENTIAL AUTOFILL of the review browser profile: the account is chosen by the profile (nothing is typed). */
async function sesion(cuenta) {
  if (b) await b.cerrar();
  await prepararPerfil(a, cfg, cuenta);                                   // the chosen account becomes the first proposal (what picking it in the browser's list does)
  b = await abrirNavegador(a, cfg); await b.limpiarSesion();
  const v = await ingresarConAutofill(b, cfg, a, cuenta); cuentaActual = cuenta;
  return v;
}
const hotelUrl = `${BASE}/dashboard/producto/hoteles/20301?tab=temporadas`;

// ───────────── 0 · environment + saved accounts ─────────────
afirmar("0.1 the review state says seeded, the dedicated container record exists", JSON.parse(fs.readFileSync(path.join(a.work, "review-state.json"), "utf8")).seeded === true && fs.existsSync(path.join(a.work, "pg.json")));
await prepararPerfil(a, cfg, "admin103@walk.test");
const guardadas = cuentasGuardadas(a, cfg);
afirmar("0.2 the review browser profile holds exactly the 4 synthetic accounts, each with the review password (no personal profile touched)", guardadas.length === 4 && guardadas.every((g) => g.claveCorrecta) && CUENTAS_REVISION.every((c) => guardadas.some((g) => g.cuenta === c)), guardadas.map((g) => g.cuenta).join(","));
const l0 = await sesion("admin103@walk.test");
afirmar("0.3 saved-account autofill fills the form (fields in :autofill state) and the REAL Auth sign-in reaches the dashboard without typing", l0.autofill && l0.correo === "admin103@walk.test" && (await b.evaluar(() => location.pathname)).startsWith("/dashboard"), JSON.stringify(l0));
await fetch(`${MAIL}/api/v1/messages`, { method: "DELETE" });

// ───────────── W1 · unfinished tariff update finishes by itself (admin103) ─────────────
sql("update public.tarifario_cambio_fuente set creado_en = now() - interval '20 minutes' where paquete_id in (20301, 20302)");
await b.ir(hotelUrl); await b.dormir(1500);
const primera = await b.evaluar(() => document.querySelector('[data-testid="estado-tarifarios"]')?.innerText ?? "(no notice)");
const t0 = Date.now(); const sinAviso = await b.esperar(() => !document.querySelector('[data-testid="estado-tarifarios"]'), 90000).then(() => true, () => false);
afirmar("W1.1 with no click the unfinished-update notice goes away by itself", sinAviso && sql("select count(*) from public.armado_paquetes where id in (20301, 20302) and tarifario_revision_fuente > coalesce(tarifario_revision_publicada, 0)") === "0", `first read: «${primera.slice(0, 90)}», gone after ${Math.round((Date.now() - t0) / 1000)} s`);
await b.ir(hotelUrl); await b.dormir(2500); let t = await texto();
afirmar("W1.2 after reload there is no notice", !/Quedaron \d+ paquete|Actualizando los tarifarios|Completando/.test(t));
// ───────────── W2 · codes ─────────────
afirmar("W2 the code SS-2027-X is shown and the missing one is flagged «Exige código pero no se ha digitado»", /SS-2027-X/.test(await b.evaluar(() => [...document.querySelectorAll("input")].map((i) => i.value).join(" "))) && /Exige código pero no se ha digitado/.test(t));
// ───────────── W3 · exclude two nights ─────────────
const editarFila = (nombre) => b.evaluar((n) => { const fila = [...document.querySelectorAll("*")].find((e) => e.children.length < 8 && new RegExp("^" + n).test((e.textContent || "").trim()) && e.querySelector("button")); const btn = fila && [...fila.querySelectorAll("button")].find((x) => /Editar/.test(x.textContent)); if (!btn) return false; btn.click(); return true; }, nombre);
const mesDic = () => b.evaluar(() => { const s = document.querySelector('select[aria-label="Mes"]'); const i = [...s.options].findIndex((o) => /diciembre/i.test(o.textContent) && /2026/.test(o.textContent)); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(s, String(i)); s.dispatchEvent(new Event("change", { bubbles: true })); });
const clicDia = (n) => b.evaluar((dia) => { const c = [...document.querySelectorAll('[role="gridcell"]')].find((x) => new RegExp(`(^|\\D)${dia}\\D.*diciembre`, "i").test(x.getAttribute("aria-label") || "") && !x.disabled); if (!c) return null; c.click(); return c.getAttribute("aria-label"); }, n);
const marcadas = () => b.evaluar(() => [...document.querySelectorAll('[role="gridcell"]')].filter((x) => x.getAttribute("aria-pressed") === "true").length);
afirmar("W3.1 Editar ALTA opens the exclusion calendar", (await editarFila("ALTA")) && await (async () => { await b.dormir(800); return b.evaluar(() => !!document.querySelector('[data-testid="calendario-exclusiones"] [role="grid"]')); })());
await mesDic(); await b.dormir(300); const d30 = await clicDia(30), d31 = await clicDia(31);
afirmar("W3.2 clicking 30 and 31 December marks both as excluded", !!d30 && !!d31 && (await marcadas()) === 2, `${d30} | ${d31}`);
await clic(/Guardar cambios/); await b.dormir(4000);
const bl = sql("select blackouts::text from public.hotel_temporadas where id = 20301");
afirmar("W3.3 saving persists 30–31 Dec 2026 on the validity", /2026-12-30/.test(bl) && /2026-12-31/.test(bl), bl);
const limpia = await b.esperar(() => !document.querySelector('[data-testid="estado-tarifarios"]'), 90000).then(() => true, () => false);
afirmar("W3.4 the update notice (if shown) clears by itself and the persisted debt is 0", limpia && sql("select count(*) from public.armado_paquetes where id in (20301,20302) and tarifario_revision_fuente > coalesce(tarifario_revision_publicada, 0)") === "0");
await b.ir(hotelUrl); await b.dormir(2000); await editarFila("ALTA"); await b.dormir(800); await mesDic(); await b.dormir(300);
afirmar("W3.5 reopening shows the two nights still excluded", (await marcadas()) === 2);
// ───────────── W4 · copy a saved set ─────────────
await b.ir(hotelUrl); await b.dormir(2000); await editarFila("Promo Semana Santa"); await b.dormir(800);
const op = await b.evaluar(() => { const s = document.querySelector('[data-testid="conjuntos-fechas"] select'); const o = [...(s?.options ?? [])].find((x) => /Semana Santa Walk/.test(x.textContent)); if (!o) return null; Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(s, o.value); s.dispatchEvent(new Event("change", { bubbles: true })); return o.textContent; });
afirmar("W4.1 the saved set «Semana Santa Walk» (with its year) is offered", !!op, op);
await clic(/Aplicar \(copiar fechas\)/); await b.dormir(600);
afirmar("W4.2 applying COPIES 4 nights (25–28 March) into the validity being edited", (await b.evaluar(() => [...document.querySelectorAll('[role="gridcell"]')].filter((x) => x.getAttribute("aria-pressed") === "true").length)) === 4);
await clic(/Guardar cambios/); await b.dormir(3500);
afirmar("W4.3 saved: 25 March is in the validity's exclusions", /2027-03-25/.test(sql("select blackouts::text from public.hotel_temporadas where nombre = 'Promo Semana Santa' and hotel_id = 20301")));
sql("update public.conjuntos_fechas set rangos = '[{\"fecha_inicio\":\"2027-04-01\",\"fecha_fin\":\"2027-04-02\"}]' where nombre = 'Semana Santa Walk'");
afirmar("W4.4 editing the saved set afterwards does NOT change the validity (copy, not link)", !/2027-04-01/.test(sql("select blackouts::text from public.hotel_temporadas where nombre = 'Promo Semana Santa' and hotel_id = 20301")));
// ───────────── W5 · general closure ─────────────
await b.ir(`${BASE}/dashboard/producto/hoteles/20301`); await b.dormir(3000); await clic(/Black out general/); await b.dormir(800);   // the closures block is on the «Configuración» tab (the page default)
afirmar("W5.1 the closure «Mantenimiento Walk» is listed", await b.esperar(() => /Mantenimiento Walk/.test(document.body.innerText), 8000).then(() => true, () => false));
await b.evaluar(() => { const fila = [...document.querySelectorAll("li, tr, div")].find((e) => /Mantenimiento Walk/.test(e.textContent || "") && e.querySelector("button") && e.children.length < 8); [...fila.querySelectorAll("button")].find((x) => /Eliminar|Quitar/i.test(x.textContent || x.getAttribute("aria-label") || "")).click(); });
await b.dormir(1200);
afirmar("W5.2 deleting removes the row WITHOUT reloading and the database no longer has it", !/Mantenimiento Walk/.test(await texto()) && sql("select count(*) from public.hotel_blackouts where hotel_id = 20301 and motivo = 'Mantenimiento Walk'") === "0");

// ───────────── W6 · supplier request with a code (admin103) ─────────────
await b.ir(`${BASE}/dashboard/contratos/DTM-2001`); await b.dormir(3000); t = await texto();
afirmar("W6.1 the contract shows «Solicitudes a proveedores por correo» and the local-capture warning", /Solicitudes a proveedores por correo/.test(t) && /NO sale de esta máquina/.test(t));
await b.evaluar(() => document.querySelector('[data-testid="solicitudes-proveedor"]')?.scrollIntoView());
await escribir("#sp-proveedor", "Hotel Prueba 103"); await escribir("#sp-correos", "reservas@walk.test");
await clic(/Vista previa/); await b.dormir(3500); t = await panel();
afirmar("W6.2 the preview demands the promotion code (Promo Semana Santa — SS-2027-X)", /Código de promoción exigido por el hotel/.test(t) && /Promo Semana Santa/.test(t) && /SS-2027-X/.test(t), t.slice(0, 300));
afirmar("W6.3 «Enviar solicitud» is disabled until the code is chosen", await b.evaluar(() => [...document.querySelectorAll("button")].find((x) => /Enviar solicitud/.test(x.textContent)).disabled));
await b.evaluar(() => document.querySelector('[data-testid="codigo-promocion"] input[type="radio"]').click()); await b.dormir(3000);
afirmar("W6.4 choosing the code enables sending and the preview shows it", /SS-2027-X/.test(await b.evaluar(() => document.querySelector('[data-testid="vista-previa-solicitud"] iframe')?.getAttribute("srcdoc") ?? "")) && !(await b.evaluar(() => [...document.querySelectorAll("button")].find((x) => /Enviar solicitud/.test(x.textContent)).disabled)));
await clic(/Enviar solicitud/); await b.dormir(4500);
let ms = await mensajes(); const mRes = ms.filter((m) => m.To.some((x) => x.Address === "reservas@walk.test"));
afirmar("W6.5 exactly ONE message reached the local inbox", mRes.length === 1, `messages=${ms.length}`);
if (mRes[0]) { const d = await detalle(mRes[0].ID); afirmar("W6.6 it has an HTML table AND plain text with the code, the holder, the three travellers, no prices; Reply-To carries the token", /SS-2027-X/.test(d.HTML) && /SS-2027-X/.test(d.Text) && /<table/.test(d.HTML) && /Ana Walk/.test(d.Text) && /Luis Walk/.test(d.Text) && /Sofía Walk/.test(d.Text) && !/precio|costo|3\.?000\.?000/i.test(d.HTML + d.Text) && d.ReplyTo.some((r) => /^respuestas\+[A-Za-z0-9_-]{16,}@walk\.test$/.test(r.Address)), (d.Text || "").slice(0, 160)); }
await clic(/Enviar solicitud/); await b.dormir(1500);
afirmar("W6.7 pressing «Enviar solicitud» a second time sends nothing", (await mensajes()).filter((m) => m.To.some((x) => x.Address === "reservas@walk.test")).length === 1);
t = await panel(); afirmar("W6.8 the history shows «Enviada» with «Código SS-2027-X»", /Enviada/.test(t) && /Código SS-2027-X/.test(t), t.slice(-200));
await escribir("#sp-proveedor", "Receptivo 103"); await escribir("#sp-correos", "tours@walk.test"); await clic(/Vista previa/); await b.dormir(2500);
const sd2 = await b.evaluar(() => document.querySelector('[data-testid="vista-previa-solicitud"] iframe')?.getAttribute("srcdoc") ?? "");
afirmar("W6.9 (optional) a services supplier previews without a code section and lists the transfer", /Traslado aeropuerto/.test(sd2) && !/Código de promoción/.test(sd2));

// ───────────── W7 · two stays of one supplier (DTM-2004) ─────────────
await b.ir(`${BASE}/dashboard/contratos/DTM-2004`); await b.dormir(3500);
await b.evaluar(() => document.querySelector('[data-testid="solicitudes-proveedor"]')?.scrollIntoView());
await escribir("#sp-proveedor", "Hotel Prueba 103"); await b.dormir(600); await escribir("#sp-correos", "reservas@hotel.test"); await b.dormir(300);
t = await panel(); afirmar("W7.1 «Estancias de esta solicitud» lists both hotels", /Estancias de esta solicitud/.test(t) && /Otro Hotel 103/.test(t) && /Hotel Prueba 103/.test(t), t.slice(0, 200));
await pulsar("Vista previa"); await b.dormir(3500); t = await panel();
afirmar("W7.2 with both stays ticked the preview is blocked with the instruction to send one hotel per request", /una solicitud lleva un solo código|selecciona el hotel|solicitud aparte/.test(t), t.slice(0, 300));
const marca = (re, valor) => b.evaluar((s, v) => { const l = [...document.querySelectorAll('[data-testid="estancias-solicitud"] label')].find((e) => new RegExp(s).test(e.textContent)); const i = l?.querySelector("input"); if (!i) return "no-label"; if (i.checked !== v) i.click(); return i.checked === v; }, re, valor);
const radio = (re) => b.evaluar((s) => { const l = [...document.querySelectorAll('[data-testid="codigo-promocion"] label')].find((e) => new RegExp(s).test(e.textContent)); const i = l?.querySelector("input"); if (!i) return false; i.click(); return true; }, re);
await marca("Otro Hotel 103", false); await pulsar("Vista previa"); await b.dormir(3500); await radio("Semana Santa"); await b.dormir(2500);
afirmar("W7.3 stay A previews with SS-2027-X and nothing of B", !/OTRO-CODE/.test(await panel()));
afirmar("W7.4 sending stay A succeeds", (await pulsar("Enviar solicitud")) && await (async () => { await b.dormir(4000); return /Solicitud enviada/.test(await panel()); })());
await marca("Hotel Prueba 103", false); await marca("Otro Hotel 103", true); await b.dormir(400); await pulsar("Vista previa"); await b.dormir(3500); await radio("Promo Otro Hotel"); await b.dormir(2500);
afirmar("W7.5 sending stay B with its own code succeeds", (await pulsar("Enviar solicitud")) && await (async () => { await b.dormir(4000); return /Solicitud enviada/.test(await panel()); })());
const ms7 = (await mensajes()).filter((m) => m.To.some((x) => x.Address === "reservas@hotel.test")), det7 = []; for (const m of ms7) det7.push(await detalle(m.ID));
const cA = det7.filter((d) => /SS-2027-X/.test(d.HTML)), cB = det7.filter((d) => /OTRO-CODE/.test(d.HTML));
afirmar("W7.6 two messages: one with SS-2027-X only (first stay), one with OTRO-CODE only (second stay); none carries both", ms7.length === 2 && cA.length === 1 && cB.length === 1 && cA[0] !== cB[0] && !/Otro Hotel 103/.test(cA[0].HTML + cA[0].Text), `msgs=${ms7.length}`);

// ───────────── W8 · the supplier replies — STANDALONE helper from a FRESH process with only the documented setting ─────────────
const limpio = { ...process.env, HJ_REVIEW_DIR: a.work }; for (const k of ["HJ_WORK", "HJ_SOURCE_PG_CONTAINER", "HJ_SOURCE_TEMPLATE_DB", "HJ_DB", "HJ_APP_PORT"]) delete limpio[k];
const fresco = (texto2) => spawnSync("powershell.exe", ["-NoProfile", "-Command", `Set-Location '${AQUI}'; node review_reply.mjs DTM-2001 '${texto2}'`], { env: limpio, encoding: "utf8" });   // a FRESH shell: a new PowerShell process with only HJ_REVIEW_DIR set
const rr = fresco("Confirmamos disponibilidad con el código.");
afirmar("W8.1 `node review_reply.mjs DTM-2001 …` from a fresh shell (only the review-folder setting) triggers the app's inbound route (HTTP 200/202, 1 new reply)", rr.status === 0 && /webhook → HTTP (200|202)/.test(rr.stdout) && /new replies recorded: 1/.test(rr.stdout), (rr.stdout + rr.stderr).replace(/\s+/g, " ").slice(0, 260));
await b.ir(`${BASE}/dashboard/contratos/DTM-2001`); await b.dormir(3000); t = await panel();
afirmar("W8.2 the card shows «Respondió», the reply text and «1 respuesta(s) nueva(s)» and is NOT «Confirmada por el proveedor»", /Respondió/.test(t) && /Confirmamos disponibilidad/.test(t) && /1 respuesta\(s\) nueva\(s\)/.test(t) && !/Confirmada por el proveedor/.test(t), t.slice(0, 300));
await clic(/marcar leídas/); await b.dormir(2000);
afirmar("W8.3 «marcar leídas» clears this contract's notices", sql("select count(*) from public.solicitud_proveedor_avisos a join public.solicitudes_proveedor s on s.id = a.solicitud_id where s.numero_contrato = 'DTM-2001' and a.leido_en is null and a.user_id = (select id from auth.users where email = 'admin103@walk.test')") === "0");
await b.dormir(2500);
afirmar("W8.4 an internal notice «Respuesta del proveedor · …» to interno@walk.test is in the local inbox", (await mensajes()).some((m) => m.To.some((x) => x.Address === "interno@walk.test") && /Respuesta del proveedor/.test(m.Subject)));
afirmar("W8.5 the reply did not confirm anything: request not confirmed/rejected, contract state unchanged", sql("select count(*) from public.solicitudes_proveedor where numero_contrato = 'DTM-2001' and (confirmacion is not null or confirmada_en is not null)") === "0" && sql("select estado from public.ventas where numero_contrato = 'DTM-2001'") === "pendiente");

// ───────────── W9 · payment notice (ops103) ─────────────
await sesion("ops103@walk.test");
afirmar("W9.0 operaciones signed in through the saved-account autofill", cuentaActual === "ops103@walk.test" && (await b.evaluar(() => location.pathname)).startsWith("/dashboard"));
const pdf = path.join(a.work, "soporte-walk.pdf"); afirmar("W9.0b the sample proof file is in the review folder (created by the seed)", fs.existsSync(pdf), pdf);
const huellaPagos = () => sql("select md5(coalesce(string_agg(id || ':' || cuenta_por_pagar_id || ':' || valor || ':' || fecha || ':' || trm, ',' order by id), '')) || '|' || (select count(*) from public.asientos_contables) || '|' || (select count(*) from public.conciliacion_sistema) from public.cxp_pagos");
const antesPagos = huellaPagos();
await b.ir(`${BASE}/dashboard/pagos/avisos`); await b.dormir(3000);
afirmar("W9.1 the screen «Aviso de pago a proveedores» opens for operaciones", /Aviso de pago a proveedores/.test(await texto()));
await escribir("#av-proveedor", "Proveedor Pago 103"); await b.dormir(2500); t = await b.evaluar(() => document.querySelector('[data-testid="pagos-aviso"]')?.innerText ?? "");
afirmar("W9.2 four payments listed: DTM-2001 COP 1.500.000, DTM-2002 COP 2.500.000, DTM-2003 USD 100,00 and USD 50,00", /DTM-2001/.test(t) && /DTM-2002/.test(t) && /DTM-2003/.test(t) && /USD 100,00/.test(t) && /USD 50,00/.test(t) && /COP 1\.500\.000/.test(t) && /COP 2\.500\.000/.test(t), t.slice(0, 300));
await b.evaluar(() => document.querySelectorAll('[data-testid="pagos-aviso"] input[aria-label^="Incluir"]').forEach((c) => c.click())); await b.dormir(300);
await b.archivo('input[type="file"]', pdf); await b.dormir(400); await clic(/Guardar soporte/); await b.dormir(5000); t = await texto();
afirmar("W9.3 saving the proof (REAL storage) says «Soporte guardado. Aún no se ha enviado nada»", /Soporte guardado\. Aún no se ha enviado nada/.test(t), t.match(/Soporte[^.]*\.[^.]*\./)?.[0] ?? t.slice(-150));
await b.evaluar(() => { const c = [...document.querySelectorAll('[data-testid="pagos-aviso"] input[type="checkbox"]:not([aria-label])')]; if (c[0]) c[0].click(); });
await escribir("#av-ref", "TRF-WALK-889"); await escribir("#av-correos", "pagos@proveedor-walk.test"); await clic(/Vista previa/); await b.dormir(3500);
const vp = await b.evaluar(() => document.querySelector('[data-testid="vista-previa-pago"] iframe')?.getAttribute("srcdoc") ?? "");
afirmar("W9.4 the preview shows 3 reservations, the partial 1.500.000 of 4.000.000, USD with rates, totals per currency and the file", /DTM-2001/.test(vp) && /COP 4\.000\.000/.test(vp) && /TRM 4000/.test(vp) && /TRM 4100/.test(vp) && /USD 150,00/.test(vp) && /\.pdf/.test(vp));
await clic(/Enviar aviso/); await b.dormir(5000);
const mPago = (await mensajes()).filter((m) => m.To.some((x) => x.Address === "pagos@proveedor-walk.test"));
afirmar("W9.5 exactly ONE message with the proof attached (same size) and «AVISO DE PAGO»", mPago.length === 1 && await (async () => { const d = await detalle(mPago[0].ID), adj = d.Attachments ?? []; return adj.length === 1 && adj[0].Size === fs.statSync(pdf).size && /AVISO DE PAGO/.test(d.HTML); })());
await clic(/Enviar aviso/); await b.dormir(2500);
afirmar("W9.6 a second press sends nothing; payments, accounting entries and reconciliation are unchanged; the history shows «Enviada» not confirmed", (await mensajes()).filter((m) => m.To.some((x) => x.Address === "pagos@proveedor-walk.test")).length === 1 && huellaPagos() === antesPagos && /Avisos enviados/.test(await texto()) && !/Confirmada por el proveedor/.test(await texto()));

// ───────────── W10 · sales advisor limits (venta103) ─────────────
await sesion("venta103@walk.test");
for (const [ruta, nombre] of [["/dashboard/pagos/avisos", "payment notices"], ["/dashboard/producto/hoteles/20301?tab=temporadas", "hotel page"], ["/dashboard/contratos/DTM-2001", "contract request section"]]) {
  await b.ir(`${BASE}${ruta}`); await b.dormir(2500); const url = await b.evaluar(() => location.pathname), tx = await texto();
  afirmar(`W10 venta103 cannot use: ${nombre}`, nombre.startsWith("contract") ? !/Solicitudes a proveedores por correo/.test(tx) : (!url.startsWith(ruta.split("?")[0]) || /No tienes permisos|no tienes permiso|Sin acceso/i.test(tx)), `${url} · ${tx.slice(0, 80).replace(/\n/g, " ")}`);
}
// ───────────── W11 · phone width ─────────────
await sesion("ops103@walk.test"); await b.tam(390, 844);
await b.ir(hotelUrl); await b.dormir(2000); const d1 = await desborde();
await b.ir(`${BASE}/dashboard/pagos/avisos`); await b.dormir(2500); await escribir("#av-proveedor", "Proveedor Pago 103"); await b.dormir(2500); const d2 = await desborde();
const interno = await b.evaluar(() => { const tbl = document.querySelector('[data-testid="pagos-aviso"]'); const c = tbl?.parentElement; return c ? c.scrollWidth - c.clientWidth : -1; });
afirmar("W11 at 390 px neither page scrolls sideways as a whole; the payments table scrolls inside its card", d1 <= 1 && d2 <= 1 && interno > 0, `hotel overflow ${d1}, payments page overflow ${d2}, table inner overflow ${interno}`);
await b.foto(path.join(EVID, "w11-pagos-390.png")); await b.cerrar(); b = null;

const fallos = resultados.filter((r) => !r.ok);
fs.writeFileSync(path.join(EVID, "rehearsal.json"), JSON.stringify({ ok: fallos.length === 0, total: resultados.length, resultados, nota: "W1–W11 only" }, null, 2));
console.log(`\nREHEARSAL ${fallos.length ? "FAILED" : "PASSED"}: ${resultados.length - fallos.length}/${resultados.length}`);
process.exit(fallos.length ? 1 : 0);
