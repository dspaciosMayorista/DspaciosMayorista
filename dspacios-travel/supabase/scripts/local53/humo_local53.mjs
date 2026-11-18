// HUMO de la revisión local del #53: inicia sesión de verdad en GoTrue local con cada usuario, arma la cookie como @supabase/ssr y pide páginas a la app (build local).
// Comprueba lo visible por el dueño: mínimo de confirmación en la ficha (solo superadmin edita), vouchers del aliado (portal y enlace directo) y el vencimiento por la ruta
// del cron. Con `--cron` ejecuta el cron (cambia datos LOCALES: después correr `local53.ps1 restaurar`). Cuenta solicitudes por comprobación.
// Uso: node humo_local53.mjs <config.json> [url_app=http://127.0.0.1:3054] [--cron]
import { readFileSync } from "node:fs";

const cfg = JSON.parse(readFileSync(process.argv[2], "utf8"));
const APP = process.argv[3]?.startsWith("http") ? process.argv[3] : "http://127.0.0.1:3054";
const CRON = process.argv.includes("--cron");
const SUPA = "http://127.0.0.1:54353";
const REF = new URL(SUPA).hostname.split(".")[0];
let fallos = 0;
const ok = (c, m) => { console.log(`${c ? "OK   " : "FALLO"} ${m}`); if (!c) fallos++; };
const rest = async (ruta) => (await fetch(`${SUPA}/rest/v1/${ruta}`, { headers: { apikey: cfg.serviceKey, authorization: `Bearer ${cfg.serviceKey}` } })).json();

async function sesion(email) {
  const r = await fetch(`${SUPA}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: cfg.anonKey, "content-type": "application/json" }, body: JSON.stringify({ email, password: "Local53!" }) });
  const j = await r.json();
  if (!j.access_token) throw new Error(`login ${email}: ${JSON.stringify(j)}`);
  const valor = "base64-" + Buffer.from(JSON.stringify(j)).toString("base64url");
  const trozos = valor.match(/.{1,3180}/g);
  return trozos.length === 1 ? `sb-${REF}-auth-token=${valor}` : trozos.map((t, i) => `sb-${REF}-auth-token.${i}=${t}`).join("; ");
}
async function pagina(cookie, ruta) {
  const r = await fetch(`${APP}${ruta}`, { headers: cookie ? { cookie } : {}, redirect: "manual" });
  return { status: r.status, destino: r.headers.get("location"), html: [200, 404].includes(r.status) ? await r.text() : "" };
}

const tokens = Object.fromEntries((await rest("vouchers?select=numero_contrato,share_token")).map((v) => [v.numero_contrato, v.share_token]));
const sa = await sesion("superadmin@local53.test"), ad = await sesion("administracion@local53.test"), al = await sesion("aliado@local53.test"), al2 = await sesion("aliado2@local53.test");

console.log("— Mínimo de confirmación en la ficha (NETO = PVP)");
let p = await pagina(sa, "/dashboard/contratos/DTM-5301");
ok(p.status === 200 && p.html.includes("Pago mínimo para confirmar") && p.html.includes("Guardar mínimo"), `superadmin ve el mínimo y el formulario para cambiarlo (HTTP ${p.status})`);
ok(/condición de pago congelada/.test(p.html), "regla mostrada: condición congelada (PVP)");
p = await pagina(sa, "/dashboard/contratos/DTM-5302");
ok(p.status === 200 && /Abonos suficientes; confirmación pendiente/.test(p.html), "NETO con su condición cubierta: aparece «Reintentar confirmación» (antes exigía el total)");
ok(/condición de pago congelada/.test(p.html), "NETO muestra la MISMA regla que PVP");
p = await pagina(sa, "/dashboard/contratos/DTM-5303");
ok(p.status === 200 && /100 %|1\.000\.000/.test(p.html) && p.html.includes("Pago mínimo para confirmar"), "hotel que exige el 100 %: el mínimo mostrado es el total");
p = await pagina(ad, "/dashboard/contratos/DTM-5301");
ok(p.status === 200 && p.html.includes("Pago mínimo para confirmar") && !p.html.includes("Guardar mínimo"), "administración ve el mínimo pero NO el formulario (solo superadmin cambia)");

console.log("— Vouchers del aliado (portal y enlace directo)");
p = await pagina(al, "/portal/b2b/documentos");
ok(p.status === 200 && p.html.includes(`/voucher/${tokens["DTM-5322"]}`), "portal: contrato 100 % pagado → voucher enlazado");
ok(!p.html.includes(`/voucher/${tokens["DTM-5321"]}`) && /Disponible cuando el contrato esté 100 % pagado/.test(p.html), "portal: saldo pendiente → NO se enlaza; dice cuándo estará disponible");
ok(!p.html.includes(`/voucher/${tokens["DTM-5323"]}`), "portal: el voucher de otro aliado no aparece");
// Nota: la raíz de la app tiene app/loading.tsx, así que TODA página dinámica que llama notFound() responde HTTP 200 con la pantalla «no encontrado» (también /c/<token inexistente>:
// comportamiento previo de la app, no de este cambio). Por eso se comprueba el CONTENIDO y el título, no solo el código HTTP.
const sinDatos = (h, n) => !/Hotel Demo Cartagena|Alojamiento 3 noches|Presentar documento/.test(h) && !h.includes(n) && /<title>Voucher<\/title>/.test(h) && /noindex/.test(h);
const conDatos = (h) => /Hotel Demo Cartagena/.test(h) && /Alojamiento 3 noches/.test(h);
p = await pagina(al, `/voucher/${tokens["DTM-5322"]}`);
ok(p.status === 200 && conDatos(p.html) && p.html.includes("Voucher Hotel - DTM-5322"), `enlace directo, pagado completo: abre y trae el voucher (HTTP ${p.status})`);
p = await pagina(al, `/voucher/${tokens["DTM-5321"]}`);
ok(sinDatos(p.html, "DTM-5321"), `enlace directo, saldo pendiente: pantalla «no encontrado», título genérico, sin datos del voucher ni del contrato (HTTP ${p.status})`);
p = await pagina(al2, `/voucher/${tokens["DTM-5322"]}`);
ok(sinDatos(p.html, "DTM-5322"), `enlace directo de OTRO aliado (aunque esté pagado): «no encontrado» sin datos (HTTP ${p.status})`);
p = await pagina(null, `/voucher/${tokens["DTM-5322"]}`);
ok([302, 303, 307, 308].includes(p.status) && /login/.test(p.destino ?? ""), `sin sesión: redirige al login (HTTP ${p.status} → ${p.destino})`);
p = await pagina(sa, `/voucher/${tokens["DTM-5321"]}`);
ok(p.status === 200 && conDatos(p.html) && p.html.includes("Voucher Hotel - DTM-5321"), `superadmin: vista previa interna con saldo pendiente (HTTP ${p.status})`);
p = await pagina(sa, "/dashboard/contratos/DTM-5321");
ok(p.status === 200 && /Vista previa interna: el aliado solo podrá abrir estos vouchers cuando el contrato esté 100 % pagado/.test(p.html), "la ficha avisa que el aliado todavía no puede abrirlo");
p = await pagina(sa, "/dashboard/contratos/DTM-5322");
ok(p.status === 200 && /el aliado ya puede abrir estos vouchers/.test(p.html), "la ficha avisa que el aliado ya puede abrirlo (pagado)");

console.log("— Ejemplos completos creados con las acciones reales (DTM-0001 COP, DTM-0003 manual con acuerdo, cotización USD abierta)");
const tk = Object.fromEntries((await rest("ventas?select=numero_contrato,share_token&numero_contrato=in.(DTM-0001,DTM-0003)")).map((v) => [v.numero_contrato, v.share_token]));
const texto = (h) => h.replace(/<[^>]+>/g, " ").replace(/&nbsp;| /g, " ").replace(/\s+/g, " ");
const sinCeros = (t) => !/Total del contrato (USD )?\$ ?0(?![.\d])/.test(t);
const dinero = (t, etiqueta, valor) => t.includes(`${etiqueta} $ ${valor}`) || t.includes(`${etiqueta} $${valor}`);
p = await pagina(sa, "/contrato/DTM-0001");
let t = texto(p.html);
ok(p.status === 200 && t.includes("1 hab Doble (2 pax)") && dinero(t, "Total del contrato", "1.200.000") && sinCeros(t), "DTM-0001 (COP): documento interno con ítem del paquete, hotel y total $1.200.000");
p = await pagina(null, `/c/${tk["DTM-0001"]}`);
t = texto(p.html);
ok(p.status === 200 && t.includes("1 hab Doble (2 pax)") && dinero(t, "Total del contrato", "1.200.000") && sinCeros(t), "DTM-0001: documento público por token con el mismo ítem y total");
p = await pagina(sa, "/dashboard/contratos/DTM-0001");
ok(p.status === 200 && p.html.includes("Pago mínimo para confirmar"), "DTM-0001: la ficha muestra el mínimo de confirmación (condición congelada del hotel)");
p = await pagina(sa, "/contrato/DTM-0003");
t = texto(p.html);
ok(p.status === 200 && t.includes("Paquete Cartagena 4 días / 3 noches") && dinero(t, "Total del contrato", "2.500.000") && sinCeros(t), "DTM-0003 (manual): documento interno con ítem real y total $2.500.000");
ok(t.includes("Pago mínimo para confirmar: $500.000 COP (mínimo acordado)") && !t.includes("Condiciones de pago"), "DTM-0003: muestra el acuerdo del 20 % ($500.000 COP) sin inventar condiciones de proveedor");
p = await pagina(null, `/c/${tk["DTM-0003"]}`);
t = texto(p.html);
ok(p.status === 200 && t.includes("$500.000 COP (mínimo acordado)") && t.includes("Paquete Cartagena"), "DTM-0003: documento público por token con ítem y acuerdo");
p = await pagina(sa, "/dashboard/contratos/DTM-0003");
ok(p.status === 200 && /mínimo acordado por superadmin/.test(p.html), "DTM-0003: la ficha muestra la regla «mínimo acordado por superadmin»");
p = await pagina(sa, "/dashboard/cotizaciones/2");
t = texto(p.html);
ok(p.status === 200 && t.includes("USD $1,000") && /Moneda de cobro/i.test(t), "cotización USD 2: abierta y con el paso «Moneda de cobro» disponible");
const q = (await rest("cotizaciones?select=estado&id=eq.2"))[0];
const v2 = await rest("ventas?select=numero_contrato&cotizacion_id=eq.2");
ok(q && q.estado === "abierta" && v2.length === 0, "cotización USD 2: sigue abierta y sin contrato (la moneda y la TRM de cobro las elige quien revisa)");

if (CRON) {
  console.log("— Vencimiento por la ruta real del cron (cambia datos LOCALES)");
  const antes = Object.fromEntries((await rest("ventas?select=numero_contrato,estado&numero_contrato=in.(DTM-5311,DTM-5312,DTM-5313)")).map((v) => [v.numero_contrato, v.estado]));
  const sinSecreto = await fetch(`${APP}/api/cron/liberar-vencidas`);
  ok(sinSecreto.status === 401 || sinSecreto.status === 403, `el cron sin secreto se rechaza (HTTP ${sinSecreto.status})`);
  const r = await fetch(`${APP}/api/cron/liberar-vencidas`, { headers: { authorization: `Bearer ${cfg.cronSecret}` } });
  ok(r.status === 200, `el cron con secreto corre (HTTP ${r.status})`);
  const despues = Object.fromEntries((await rest("ventas?select=numero_contrato,estado&numero_contrato=in.(DTM-5311,DTM-5312,DTM-5313)")).map((v) => [v.numero_contrato, v.estado]));
  ok(antes["DTM-5311"] === "pendiente" && despues["DTM-5311"] === "cancelado", "sin pagos: se cancela como siempre");
  ok(despues["DTM-5312"] === "pendiente", "con un pago pequeño: se conserva pendiente");
  ok(despues["DTM-5313"] === "pendiente", "NETO en su mínimo: se conserva pendiente");
  const ab = await rest("abonos?select=numero_contrato&numero_contrato=in.(DTM-5312,DTM-5313)");
  ok(ab.length === 2, "los pagos siguen registrados");
}
console.log(`=== ${fallos} fallo(s)`);
process.exit(fallos ? 1 : 0);
