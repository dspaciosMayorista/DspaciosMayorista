// HUMO 2 de la revisión local del #53: ACCIONES sobre datos locales (la app compilada solo las RENDERIZA). Usa las mismas RPC que llaman las acciones de la ficha,
// con la sesión REAL de cada usuario por el gateway, y vuelve a pedir las páginas a la app compilada para ver el efecto. Cambia datos LOCALES: después correr `local53.ps1 restaurar`.
// Uso: node humo_local53_acciones.mjs <config.json> [url_app=http://127.0.0.1:3054]
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const cfg = JSON.parse(readFileSync(process.argv[2], "utf8"));
const APP = process.argv[3] ?? "http://127.0.0.1:3054";
const SUPA = "http://127.0.0.1:54353";
const REF = "127";
let fallos = 0;
const ok = (c, m) => { console.log(`${c ? "OK   " : "FALLO"} ${m}`); if (!c) fallos++; };
const rest = async (r) => (await fetch(`${SUPA}/rest/v1/${r}`, { headers: { apikey: cfg.serviceKey, authorization: `Bearer ${cfg.serviceKey}` } })).json();
const sql = (q) => execFileSync("docker", ["exec", "-i", "-e", "PGPASSWORD=postgres", "pg304", "psql", "-h", "127.0.0.1", "-U", "supabase_admin", "-d", "dspacios_local53", "-X", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1"], { input: q, encoding: "utf8" }).trim();
const sesiones = new Map();
async function sesion(email) {
  const j = await (await fetch(`${SUPA}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: cfg.anonKey, "content-type": "application/json" }, body: JSON.stringify({ email, password: "Local53!" }) })).json();
  const v = "base64-" + Buffer.from(JSON.stringify(j)).toString("base64url");
  const t = v.match(/.{1,3180}/g);
  sesiones.set(email, j.access_token);
  return t.length === 1 ? `sb-${REF}-auth-token=${v}` : t.map((x, i) => `sb-${REF}-auth-token.${i}=${x}`).join("; ");
}
const rpc = async (email, fn, args) => {
  const r = await fetch(`${SUPA}/rest/v1/rpc/${fn}`, { method: "POST", headers: { apikey: cfg.anonKey, authorization: `Bearer ${sesiones.get(email)}`, "content-type": "application/json" }, body: JSON.stringify(args) });
  return { status: r.status, cuerpo: await r.json().catch(() => null) };
};
const pagina = async (cookie, ruta) => { const r = await fetch(`${APP}${ruta}`, { headers: { cookie }, redirect: "manual" }); return { status: r.status, html: await r.text() }; };
const estado = (n) => sql(`select estado from public.ventas where numero_contrato = '${n}'`);

const sa = await sesion("superadmin@local53.test"), ad = await sesion("administracion@local53.test"), al = await sesion("aliado@local53.test");
const tokens = Object.fromEntries((await rest("vouchers?select=numero_contrato,share_token")).map((v) => [v.numero_contrato, v.share_token]));

console.log("— Umbrales de confirmación (NETO = PVP), idempotencia");
ok(estado("DTM-5302") === "pendiente", "DTM-5302 (NETO, 300.000 pagados de una condición de 300.000) empieza pendiente");
let r = await rpc("administracion@local53.test", "reintentar_confirmacion_pago", { p_numero: "DTM-5302" });
ok(r.status === 200 && r.cuerpo?.confirmada === true && estado("DTM-5302") === "confirmado", `«Reintentar confirmación» (administración) confirma el NETO con su condición (HTTP ${r.status})`);
r = await rpc("administracion@local53.test", "reintentar_confirmacion_pago", { p_numero: "DTM-5302" });
ok(r.status === 200 && r.cuerpo?.confirmada === false && estado("DTM-5302") === "confirmado", "segundo reintento: no cambia nada ni duplica (idempotente)");
ok(sql("select count(*) from public.aliados_b2b where numero_contrato = 'DTM-5302'") === "0", "no se creó ninguna comisión (ciclo #97 apagado, nada materializado por esta prueba)");
ok(estado("DTM-5301") === "pendiente", "DTM-5301 (PVP, 250.000 de 300.000) sigue pendiente");
r = await rpc("administracion@local53.test", "fijar_minimo_confirmacion", { p_numero: "DTM-5301", p_tipo: "porcentaje", p_valor: 20 });
ok(r.status >= 400, `administración NO puede cambiar el mínimo (HTTP ${r.status})`);
r = await rpc("superadmin@local53.test", "fijar_minimo_confirmacion", { p_numero: "DTM-5301", p_tipo: "porcentaje", p_valor: 20, p_motivo: "acuerdo de prueba" });
ok(r.status === 200 && Number(r.cuerpo?.minimo) === 200000 && r.cuerpo?.alcanza === true, `superadmin fija 20 %: mínimo 200.000, ya alcanza con 250.000 (HTTP ${r.status})`);
ok(estado("DTM-5301") === "pendiente", "fijar el mínimo NO confirma por sí solo");
let p = await pagina(sa, "/dashboard/contratos/DTM-5301");
ok(/mínimo acordado/.test(p.html) && /Abonos suficientes; confirmación pendiente/.test(p.html), "la ficha compilada muestra «mínimo acordado» y el aviso de reintento");
r = await rpc("superadmin@local53.test", "reintentar_confirmacion_pago", { p_numero: "DTM-5301" });
ok(r.status === 200 && estado("DTM-5301") === "confirmado", "el reintento manual lo confirma");
r = await rpc("superadmin@local53.test", "fijar_minimo_confirmacion", { p_numero: "DTM-5301", p_tipo: "total" });
ok(r.status >= 400, "un contrato ya confirmado no admite cambiar el mínimo");
r = await rpc("superadmin@local53.test", "fijar_minimo_confirmacion", { p_numero: "DTM-5303", p_tipo: "porcentaje", p_valor: 30, p_motivo: "el hotel acepta 30 %" });
ok(r.status === 200 && Number(r.cuerpo?.minimo) === 300000 && r.cuerpo?.alcanza === true, "hotel que exigía el 100 %: superadmin lo baja a 30 % (400.000 ya lo alcanzan)");
ok(sql("select count(*) from public.auditoria where tabla = 'contrato_minimo_acuerdo' and accion = 'INSERT' and despues->>'numero_contrato' in ('DTM-5301','DTM-5303')") === "2", "la auditoría registró los 2 acuerdos");

console.log("— Reversión de pago y aumento de saldo (vouchers del aliado)");
const link = `/voucher/${tokens["DTM-5322"]}`;
p = await pagina(al, link);
ok(/Alojamiento 3 noches/.test(p.html), "DTM-5322 pagado completo: el aliado abre el voucher");
const idAbono = sql("select id from public.abonos where numero_contrato = 'DTM-5322' order by id limit 1");
sql(`set role service_role; select public.anular_abono(${idAbono}, 'DTM-5322', 'mayorista', (select id from public.usuarios where email = 'superadmin@local53.test'), 'prueba de reversión');`);
p = await pagina(al, link);
ok(!/Alojamiento 3 noches/.test(p.html), "tras anular el pago: el enlace directo ya no muestra el voucher");
p = await pagina(al, "/portal/b2b/documentos");
ok(!p.html.includes(tokens["DTM-5322"]) && /Disponible cuando el contrato esté 100 % pagado/.test(p.html), "tras anular el pago: el portal ya no lo enlaza y dice cuándo estará disponible");
ok(sql("select count(*) from public.vouchers where numero_contrato = 'DTM-5322'") === "1", "el voucher NO se borró");
sql("insert into public.abonos (numero_contrato, tenant, cliente, fecha_abono, valor_abono, forma_pago, trm, monto_cop) values ('DTM-5322', 'mayorista', 'c', current_date, 1000000, 'transferencia', 1, 1000000)");
p = await pagina(al, link);
ok(/Alojamiento 3 noches/.test(p.html), "al pagar de nuevo el total: vuelve a abrir");
sql("update public.ventas set precio_venta = 1200000 where numero_contrato = 'DTM-5322'");
p = await pagina(al, link);
ok(!/Alojamiento 3 noches/.test(p.html), "aumento posterior del precio: se bloquea de nuevo");
p = await pagina(sa, link);
ok(/Alojamiento 3 noches/.test(p.html), "y la vista previa interna sigue disponible");

console.log(`=== ${fallos} fallo(s)`);
process.exit(fallos ? 1 : 0);
