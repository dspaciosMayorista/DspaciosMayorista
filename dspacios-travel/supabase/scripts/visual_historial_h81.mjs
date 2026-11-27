// H8-1 · INSPECCIÓN de la página COMPILADA del record de vuelo (/dashboard/vuelos/[id], pestaña «Cambios» → «Movimientos históricos»):
// sesiones reales (control de vuelo, superadmin; un asesor de ventas como control negativo), datos sintéticos de semilla_visual_historial_h81.sql,
// Edge con emulación de dispositivo REAL (viewport de 390 px, mobile: true), 1280 / 820 / 390 px, detalle por silla abierto y cerrado.
// Lanzar con: sh supabase/scripts/lanzar_visual_compilada.sh pgsoporte339 plantilla339 docs/tecnico/evidence-block1-r9 supabase/scripts/visual_historial_h81.mjs \
//   supabase/migrations/…334…338 supabase/scripts/semilla_visual_historial_h81.sql      (ver el informe para la línea exacta)
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { iniciar, dormir } from "./visual_compilada_lib.mjs";

const REST = process.env.VC_REST, SECRETO = process.env.VC_SECRETO, PS = process.env.VC_PS, SALIDA = process.env.VC_SALIDA, APP_DIR = process.env.VC_APP_DIR;
const U = (n) => `00000000-0000-4000-8000-0000008810${n}`;
const USUARIOS = {
  CONTROL: { id: U("a1"), email: "h8-control@x.test", rol: "control_vuelo" },
  SUPER: { id: U("a2"), email: "h8-super@x.test", rol: "superadmin" },
  VENTA: { id: U("a3"), email: "h8-venta@x.test", rol: "venta" },
};
const sql = (q) => execSync(PS, { input: q, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 }).trim();
let fallos = 0;
const ok = (c, m) => { console.log(`${c ? "OK   " : "FALLO"} ${m}`); if (!c) fallos++; };
const ANCHOS = [1280, 820, 390];

const h = await iniciar({ rest: REST, secreto: SECRETO, usuarios: USUARIOS, salida: SALIDA, appDir: APP_DIR });
console.log("app compilada respondiendo en", h.APP, "· BUILD_ID", h.buildId);
const control = await h.pestana("CONTROL"), superad = await h.pestana("SUPER"), venta = await h.pestana("VENTA");

// Evidencia de la semilla: los movimientos tal como están guardados.
fs.writeFileSync(path.join(h.OUT, "fixture-movimientos.txt"), sql(`select m.id, b1.record as origen, b2.record as destino, m.tipo, coalesce(m.operacion_id::text,'-') as operacion, m.fecha_movimiento at time zone 'UTC' as fecha_utc, coalesce(m.registrado_por,'(null)') as actor, m.numero_silla_origen as so, m.numero_silla_destino as sd, m.cupos_origen_antes||'>'||m.cupos_origen_despues as co, m.cupos_destino_antes||'>'||m.cupos_destino_despues as cd, left(coalesce(m.motivo,'(null)'),60) as motivo
  from public.movimientos_silla m left join public.bloqueos_vuelo b1 on b1.id = m.bloqueo_origen_id left join public.bloqueos_vuelo b2 on b2.id = m.bloqueo_destino_id order by m.fecha_movimiento desc, m.id`).replace(/\|/g, " | "));

const ID = { A: 9501, B: 9502, C: 9503 };
const url = (k) => `${h.APP}/dashboard/vuelos/${ID[k]}`;
const norm = (t) => String(t).replace(/\s+/g, " ").trim();

/** Abre la pestaña «Cambios», marca la sección del historial (data-h81) y (opcional) abre todos los «Detalle por silla». */
async function abrirHistorial(pest, k, ancho, detalles = false) {
  await pest.ir(url(k), ancho, 3500);
  const r = await pest.eval(`(() => {
    const tab = [...document.querySelectorAll('button')].find((b) => /^Cambios/.test(b.textContent.trim()));
    if (!tab) return 'sin pestaña Cambios';
    tab.click();
    const sec = [...document.querySelectorAll('section')].find((s) => s.querySelector('p')?.textContent.trim() === 'Movimientos históricos');
    if (!sec) return 'sin sección';
    sec.setAttribute('data-h81', '1');
    for (const d of sec.querySelectorAll('details')) d.open = ${detalles ? "true" : "false"};
    sec.scrollIntoView();
    return 'ok:' + sec.querySelectorAll(':scope > ul > li').length;
  })()`);
  await dormir(500);
  return r;
}
const textoSeccion = (pest) => pest.eval(`(() => { const s = document.querySelector('[data-h81]'); return s ? s.innerText.replace(/\\s+/g, ' ').trim() : ''; })()`);
// innerText devuelve las etiquetas en MAYÚSCULAS (la interfaz las muestra así con CSS `uppercase`): se devuelven a su forma de origen para comparar texto.
const ETIQUETAS = [["REGISTRADO POR", "Registrado por"], ["CANTIDAD", "Cantidad"], ["RECORD ORIGEN", "Record origen"], ["RECORD DESTINO", "Record destino"], ["CUPOS ORIGEN (ANTES → DESPUÉS)", "Cupos origen (antes → después)"],
  ["CUPOS DESTINO (ANTES → DESPUÉS)", "Cupos destino (antes → después)"], ["SILLAS DE ORIGEN", "Sillas de origen"], ["SILLAS DE DESTINO", "Sillas de destino"], ["CONTRATO CM", "Contrato CM"]];
const etiquetas = (t) => ETIQUETAS.reduce((s, [a, b]) => s.split(a).join(b), t);
const tarjetas = async (pest) => (await pest.eval(`[...document.querySelectorAll('[data-h81] > ul > li')].map((li) => li.innerText.replace(/\\s+/g, ' ').trim())`)).map(etiquetas);
/** Solapes: ningún par de elementos hermanos/primos de una tarjeta se cruza (títulos, fecha, frase, celdas del detalle, resumen/lista de sillas). */
const solapes = (pest) => pest.eval(`(() => {
  const out = [];
  for (const li of document.querySelectorAll('[data-h81] > ul > li')) {
    const els = [...li.querySelectorAll(':scope > div > *, :scope > p, :scope > dl > div, :scope > details > summary, :scope > details > ul > li')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
    for (let i = 0; i < els.length; i++) for (let j = i + 1; j < els.length; j++) {
      if (els[i].contains(els[j]) || els[j].contains(els[i])) continue;
      const a = els[i].getBoundingClientRect(), b = els[j].getBoundingClientRect();
      const w = Math.min(a.right, b.right) - Math.max(a.left, b.left), hh = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (w > 1 && hh > 1) out.push(li.innerText.slice(0, 24).replace(/\\s+/g, ' ') + ' :: ' + els[i].innerText.slice(0, 20) + ' × ' + els[j].innerText.slice(0, 20));
    }
    const lr = li.getBoundingClientRect();
    for (const e of li.querySelectorAll('*')) { const r = e.getBoundingClientRect(); if (r.width && (r.right > lr.right + 1 || r.left < lr.left - 1)) { out.push('fuera de su tarjeta: ' + (e.innerText || e.tagName).slice(0, 30)); break; } }
  }
  return out.slice(0, 8);
})()`);

console.log("\n== 1. Control de vuelo en el record AAA111 (salidas del traslado, retiro, anterior incompleto, límites de día) ==");
let r = await abrirHistorial(control, "A", 1280);
ok(/^ok:\d+$/.test(r), `página compilada /dashboard/vuelos/${ID.A} (control de vuelo): pestaña «Cambios» y sección del historial (${r})`);
if (!/^ok:/.test(r)) { console.log("ABORTADO: no se llegó a la sección del historial; los controles de diseño serían vacíos.", JSON.stringify(h.peticiones), (await control.texto()).slice(0, 300)); console.log(h.eventosApp.join("").slice(-1500)); h.limpiar(); process.exit(1); }
const tarjA = await tarjetas(control);
ok(tarjA.length === 8, `AAA111 muestra 8 operaciones (${tarjA.length}; 10 filas guardadas: el traslado agrupa 3)`);
const A = norm(tarjA.join(" || "));
fs.writeFileSync(path.join(h.OUT, "tarjetas-AAA111.txt"), tarjA.map((x, i) => `#${i + 1} ${x}`).join(String.fromCharCode(10, 10)));
const retiro = tarjA.find((t) => /REFERENCIA-X{20}/.test(t)) ?? "";
ok(/Retiro de cupo/.test(retiro) && /Record destino No aplica/.test(retiro) && !/Traslado|Entraron|Salieron|hacia BBB222|desde BBB222/.test(retiro.replace(/Se pasa al record BBB222[^”]*/, "")),
  "retiro cuyo motivo menciona BBB222: se presenta como «Retiro de cupo», destino «No aplica», sin lenguaje de traslado (el motivo aparece solo como texto libre)");
ok(/Motivo \(texto libre\): “Se pasa al record BBB222/.test(retiro) && /23\/11\/2026 23:30 \(hora de Bogotá\)/.test(retiro) && /Registrado por Javier Alberto de Jesús Hernández-Quintero/.test(retiro), "ese retiro: motivo rotulado «texto libre», 23/11/2026 23:30 (hora de Bogotá) y el actor largo completo");
const traslado = tarjA.find((t) => /^Traslado de cupos libres/.test(t)) ?? "";
ok(/Salieron 3 cupo\(s\) libre\(s\) hacia BBB222/.test(traslado) && /05\/10\/2026 10:00 \(hora de Bogotá\)/.test(traslado) && /Cantidad 3 sillas/.test(traslado) && /Record origen AAA111/.test(traslado) && /Record destino BBB222/.test(traslado) && /Cupos origen \(antes → después\) 12 → 9/.test(traslado) && /Sillas de origen #10, #11, #12/.test(traslado),
  "traslado agrupado visto desde AAA111: «Salieron 3 cupo(s)…», 05/10/2026 10:00, 3 sillas, origen→destino, cupos 12 → 9, sillas #10, #11, #12");
const mover = tarjA.find((t) => /^Pasajero movido con su cupo/.test(t)) ?? "";
ok(/Entró pasajero con su cupo desde BBB222/.test(mover) && /02\/11\/2026 15:15/.test(mover) && /Contrato CM-0451/.test(mover), "pasajero movido con su cupo: entra desde BBB222, 02/11/2026 15:15, contrato guardado");
const legado = tarjA.find((t) => /^Movimiento anterior \(tipo no guardado\)/.test(t)) ?? "";
ok(/no se guardó su tipo ni su destino/.test(legado) && /Registrado por No guardado/.test(legado) && /Record destino No guardado/.test(legado) && /Cupos origen \(antes → después\) No guardado/.test(legado) && /Motivo \(texto libre\): “pasó al record CCC333”/.test(legado) && !/Cambio entre records|hacia CCC333/.test(legado) && /02\/01\/2026 07:00/.test(legado),
  "historial anterior incompleto: «tipo no guardado», actor/destino/cupos «No guardado», nada inferido del motivo que nombra CCC333, 02/01/2026 07:00");
const cambioLegado = tarjA.find((t) => /^Cambio entre records \(registro anterior\)/.test(t)) ?? "";
ok(/Entró desde CCC333 \(cambio CCC333 → AAA111\)/.test(cambioLegado) && /03\/01\/2026 07:00/.test(cambioLegado), "anterior con origen y destino guardados: «Cambio entre records (registro anterior)», 03/01/2026 07:00");
const orden = ["23/11/2026 23:30", "23/11/2026 00:00", "22/11/2026 23:59", "02/11/2026 15:15", "05/10/2026 10:00", "03/01/2026 07:00", "02/01/2026 07:00", "31/12/2025 23:59"].map((x) => A.indexOf(x));
ok(orden.every((x, i) => x >= 0 && (i === 0 || x > orden[i - 1])), `fechas visibles en hora de Bogotá, incluidos los límites del día (04:59Z → 22/11 23:59; 05:00Z → 23/11 00:00; año nuevo → 31/12/2025 23:59), de la más reciente a la más antigua (${orden.join(",")})`);

console.log("\n== 2. Mismo traslado visto desde el record destino BBB222 ==");
r = await abrirHistorial(control, "B", 1280);
const tarjB = await tarjetas(control);
const entra = tarjB.find((t) => /^Traslado de cupos libres/.test(t)) ?? "";
ok(/Entraron 3 cupo\(s\) libre\(s\) desde AAA111/.test(entra) && /Cupos destino \(antes → después\) 6 → 9/.test(entra) && /Sillas de destino #7, #8, #9/.test(entra), "desde BBB222 el mismo traslado se lee como entrada: «Entraron 3 cupo(s)… desde AAA111», cupos 6 → 9, sillas #7, #8, #9");
ok(/Salió pasajero con su cupo hacia AAA111/.test(tarjB.find((t) => /^Pasajero movido con su cupo/.test(t)) ?? ""), "desde BBB222 el pasajero movido con cupo se lee como salida hacia AAA111");

console.log("\n== 3. Detalle por silla expandido, texto largo y diseño a 1280 / 820 / 390 px (viewport real) ==");
const tabs0 = { ...h.peticiones };
for (const [pest, rol, k] of [[control, "control de vuelo", "A"], [control, "control de vuelo", "B"], [superad, "superadmin", "A"]]) {
  for (const ancho of ANCHOS) {
    if (rol === "superadmin" && ancho !== 390 && ancho !== 1280) continue;
    for (const detalles of [false, true]) {
      const re = await abrirHistorial(pest, k, ancho, detalles);
      const etiqueta = `${rol} · /dashboard/vuelos/${ID[k]} · ${ancho}px · detalle por silla ${detalles ? "abierto" : "cerrado"}`;
      ok(/^ok:/.test(re), `${etiqueta}: historial presente`);
      const med = await pest.captura(`historial-${k === "A" ? "AAA111" : "BBB222"}-${rol === "superadmin" ? "super" : "control"}-${detalles ? "detalle" : "compacto"}`, ancho, "[data-h81]");
      const sol = await solapes(pest);
      ok(!med.desbordaHorizontal && med.elementosFueraDelViewport === 0 && sol.length === 0 && (med.textoRecortado ?? []).length === 0,
        `${etiqueta}: sin desborde (scroll ${med.scrollWidth}/${med.innerWidth}), nada fuera del viewport (${med.elementosFueraDelViewport}), sin solapes${sol.length ? " " + JSON.stringify(sol) : ""}, sin texto recortado`);
      if (detalles && k === "A") {
        const t = await textoSeccion(pest);
        ok(/Silla #10 → #7/.test(t) && /Silla #11 → #8/.test(t) && /Silla #12 → #9/.test(t) && /Silla #3 → #13 · contrato CM-0451/.test(t), `${etiqueta}: el detalle expandido lista cada silla (#10 → #7, #11 → #8, #12 → #9, #3 → #13 con contrato)`);
      }
    }
  }
}
const dTabs = Object.fromEntries(Object.entries(h.peticiones).map(([k, v]) => [k, v - (tabs0[k] ?? 0)]).filter(([, v]) => v));
console.log("INFO  solicitudes al proxy durante toda la sección 3 (16 cargas de página):", JSON.stringify(dTabs));
// Cambiar de pestaña no pide nada: contenido ya renderizado en el servidor.
{ await abrirHistorial(control, "A", 1280); const a = { ...h.peticiones }; await control.eval(`[...document.querySelectorAll('button')].find((b) => /^Pasajeros/.test(b.textContent.trim()))?.click(); [...document.querySelectorAll('button')].find((b) => /^Cambios/.test(b.textContent.trim()))?.click();`); await dormir(1500);
  const d = Object.fromEntries(Object.entries(h.peticiones).map(([k, v]) => [k, v - (a[k] ?? 0)]).filter(([, v]) => v)); ok(Object.keys(d).length === 0, `cambiar de pestaña (Pasajeros ↔ Cambios) no genera solicitudes (${JSON.stringify(d)})`); }

console.log("\n== 4. Acceso: un asesor de ventas no entra al módulo ==");
await venta.ir(url("A"), 1280, 2500);
const tv = await venta.texto();
ok(!/Movimientos históricos|Traslado de cupos libres|Retiro de cupo/.test(tv), `asesor de ventas: la página del record no muestra el historial (${tv.slice(0, 60).replace(/\n/g, " ")}…)`);

const errores = [...control.errores(), ...superad.errores()].filter(Boolean);
ok(errores.length === 0, `sin excepciones de JavaScript en las pestañas (${errores.length})`);
h.escribirMedidas("mediciones_h81.json");
console.log(`\nRESULTADO: ${fallos === 0 ? "TODO OK" : fallos + " FALLO(S)"} · BUILD_ID ${h.buildId}`);
h.limpiar();
process.exit(fallos === 0 ? 0 : 1);
