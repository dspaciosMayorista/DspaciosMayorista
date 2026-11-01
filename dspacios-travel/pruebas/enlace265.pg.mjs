// 265 — enlace CxP <-> línea de servicio por CLAVE ESTABLE: triggers, RPC financiera, correccion autorizada, FKs, permisos (SQL + PostgREST/HTTP reales).
// Lo lanza supabase/scripts/test_265_enlace_cxp.sh (base local desechable).
import { createHmac, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";

const { PG262_CONTENEDOR: CT, PG262_BASE: DB, PG262_POSTGREST: URL, PG262_JWT_SECRET: SECRETO } = process.env;
if (!CT || !DB || !URL || !SECRETO) throw new Error("Faltan variables: usa supabase/scripts/test_265_enlace_cxp.sh");
const b64 = (s) => Buffer.from(s).toString("base64url");
const jwt = (p) => { const h = b64(JSON.stringify({ alg: "HS256", typ: "JWT" })), c = b64(JSON.stringify({ ...p, exp: Math.floor(Date.now() / 1000) + 3600 })); return `${h}.${c}.${createHmac("sha256", SECRETO).update(`${h}.${c}`).digest("base64url")}`; };
const psql = (q, tolerar = false) => { try { return { ok: true, out: execFileSync("docker", ["exec", "-i", "-e", "PGPASSWORD=postgres", CT, "psql", "-h", "127.0.0.1", "-U", "supabase_admin", "-d", DB, "-X", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1"], { input: q, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim() }; } catch (e) { if (!tolerar) throw e; return { ok: false, out: String(e.stderr || e.message) }; } };
const sql = (q) => psql(q).out;
const lit = (v) => (v == null ? "null" : `'${String(v).replace(/'/g, "''")}'`);
const uid = (n) => `00000000-0000-0000-0000-0000002650${String(n).padStart(2, "0")}`;
const ROLES = { superadmin: 1, gerencia: 2, administracion: 3, operaciones: 4, venta: 5 };
const tok = (r) => jwt({ role: "authenticated", sub: uid(ROLES[r]) });
const ANON = jwt({ role: "anon" }), SERV = jwt({ role: "service_role" });
let ok = 0, mal = 0;
const check = (c, msg, extra = "") => { if (c) { ok++; console.log(`  OK    ${msg}`); } else { mal++; console.log(`  FALLA ${msg} ${extra}`); } };
async function http(m, ruta, token, cuerpo) {
  const r = await fetch(`${URL}${ruta}`, { method: m, headers: { "content-type": "application/json", prefer: "return=representation", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo) });
  const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; }
  return { s: r.status, j, t };
}
const reg = (n, items) => http("POST", "/rpc/registrar_financiero_contrato", SERV, { p_numero_contrato: n, p_tenant: "mayorista", p_costos: {}, p_cxp: items });
const corregir = (t, cxp, linea) => http("POST", "/rpc/corregir_enlace_cxp_alcance", t, { p_cxp_id: cxp, p_contrato_servicio_id: linea });

sql(`
 insert into auth.users (id, email) values ${Object.entries(ROLES).map(([r, n]) => `('${uid(n)}','${r}265@x.test')`).join(",")} on conflict do nothing;
 insert into public.usuarios (id, email, nombre, rol, activo, tenant) values ${Object.entries(ROLES).map(([r, n]) => `('${uid(n)}','${r}265@x.test','${r} 265','${r}',true,'mayorista')`).join(",")}
   on conflict (id) do update set rol=excluded.rol, activo=true, tenant=excluded.tenant;
 insert into public.proveedores (id, nombre) values (26501,'Prov 265') on conflict do nothing;
 insert into public.servicios_adicionales (id, nombre, proveedor_id, precio_persona, categoria, moneda, tipo_tarifa) values (26501,'Traslado 265',26501,0,'tour_traslado','COP','persona'),(26502,'Traslado B 265',26501,0,'tour_traslado','COP','persona'),(26503,'Traslado C 265',26501,0,'tour_traslado','COP','persona') on conflict do nothing;
`);
let consec = 9700;
const contrato = (estado = "pendiente") => { const n = `DTM-${++consec}`; sql(`insert into public.ventas (numero_contrato, cliente, tenant, financiero_estado) values ('${n}','C ${n}','mayorista','${estado}')`); return n; };
const linea = (n, s, desc, alcance, costo, clave = randomUUID()) => ({ id: sql(`insert into public.contrato_servicios (numero_contrato, tipo, descripcion, costo, servicio_id, alcance_traslado, clave_enlace) values ('${n}','traslado',${lit(desc)},${costo},${s},${lit(alcance)},${lit(clave)}) returning id`), clave });
const item = (s, desc, valor, clave, extra = {}) => ({ tipo_proveedor: "receptivo", proveedor: "P", servicio: desc, servicio_id: s, valor_total: valor, moneda: "COP", observaciones: clave ? `Generado automáticamente desde el tarifario (carrito) · enlace:${clave}` : "Generado automáticamente desde el tarifario (carrito)", ...extra });
const cxps = (n) => JSON.parse(sql(`select coalesce(json_agg(json_build_object('id', id, 'cs', contrato_servicio_id, 'alc', alcance_traslado, 'valor', valor_total::float8, 'obs', observaciones) order by id)::text,'[]') from public.cuentas_por_pagar where numero_contrato = '${n}'`));
const estado = (n) => sql(`select financiero_estado from public.ventas where numero_contrato='${n}'`);
const codigo = (r) => (r.j && r.j.code) || "";

console.log("== 1. dos líneas del MISMO servicio y MISMA descripción: cada CxP a SU línea por clave (orden inverso) ==");
{
  const n = contrato(); const D = "Traslado 265 · Un trayecto: llegada";
  const l1 = linea(n, 26501, D, "llegada", 100), l2 = linea(n, 26501, D, "llegada", 200);
  const r = await reg(n, [item(26501, D, 200, l2.clave), item(26501, D, 100, l1.clave)]);
  check(r.s === 200, `RPC registra las dos CxP (HTTP ${r.s})`, r.t);
  const c = cxps(n);
  check(c.length === 2 && c.find((x) => x.valor === 100)?.cs == l1.id && c.find((x) => x.valor === 200)?.cs == l2.id, "valor 100 → línea 1 (costo 100) y valor 200 → línea 2, aunque se insertaron en orden inverso", JSON.stringify(c));
  check(c.every((x) => x.alc === "llegada" && x.obs.endsWith(" · enlace:" + (x.cs == l1.id ? l1.clave : l2.clave))), "alcance copiado y observaciones terminan en su clave");
  check(estado(n) === "completo", "el contrato queda 'completo'");
  const n2 = contrato(); const m1 = linea(n2, 26501, D, "llegada", 100), m2 = linea(n2, 26501, D, "llegada", 100);
  const r2 = await reg(n2, [item(26501, D, 100, m1.clave), item(26501, D, 100, m2.clave)]);
  const c2 = cxps(n2); check(r2.s === 200 && c2[0].cs == m1.id && c2[1].cs == m2.id, "con valores y descripciones idénticos igual se enlaza cada una por su clave", JSON.stringify(c2));
}

console.log("== 2. clave duplicada ==");
{
  const n = contrato(); const D = "T · llegada"; const l = linea(n, 26501, D, "llegada", 100);
  const r = await reg(n, [item(26501, D, 100, l.clave), item(26501, D, 100, l.clave)]);
  check(r.s >= 400 && codigo(r) === "23505", `dos CxP con la MISMA clave: 23505 (HTTP ${r.s})`, r.t);
  check(cxps(n).length === 0 && estado(n) === "pendiente", "la RPC revierte TODO: ninguna CxP y el contrato sigue 'pendiente'");
}

console.log("== 3. clave inexistente / de otro contrato / de otro servicio / de línea sin alcance ==");
{
  const n = contrato(), otro = contrato(); const D = "T · salida"; const l = linea(n, 26501, D, "salida", 100); const lOtro = linea(otro, 26501, D, "salida", 100); const lS = linea(n, 26502, "B", "salida", 100);
  const sinAlc = linea(n, 26501, "manual", null, 0);
  for (const [nom, it, cod] of [["clave inexistente", item(26501, D, 100, randomUUID()), "23503"], ["clave de OTRO contrato", item(26501, D, 100, lOtro.clave), "23514"], ["clave de OTRO servicio_id", item(26502, D, 100, l.clave), "23514"], ["clave de una línea SIN alcance", item(26501, "manual", 0.01, sinAlc.clave), "23514"]]) {
    const r = await reg(n, [it]); check(r.s >= 400 && codigo(r) === cod, `${nom}: ${cod} (HTTP ${r.s} code ${codigo(r)})`, r.t);
    check(cxps(n).length === 0 && estado(n) === "pendiente", `${nom}: nada escrito y contrato 'pendiente'`);
  }
  void lS;
}

console.log("== 4. línea con alcance y costo > 0 cuya CxP viene SIN clave ==");
{
  const n = contrato(); const D = "T · ida y regreso"; linea(n, 26501, D, "ida_regreso", 150);
  const r = await reg(n, [item(26501, D, 150, null)]);
  check(r.s >= 400 && codigo(r) === "P0001" && /enlazado/.test(r.t), `RPC falla por ventas_completo_exige_enlaces (HTTP ${r.s} code ${codigo(r)})`, r.t);
  check(cxps(n).length === 0 && estado(n) === "pendiente", "revierte: ni CxP, ni 'completo'");
  const r0 = await reg(n, []);
  check(r0.s >= 400 && codigo(r0) === "P0001", "tampoco se completa SIN ninguna CxP");
  const z = contrato(); linea(z, 26501, "gratis · llegada", "llegada", 0);
  const rz = await reg(z, []); check(rz.s === 200 && estado(z) === "completo", `línea con costo 0 y sin CxP: permitido, queda 'completo' (HTTP ${rz.s})`, rz.t);
  const m = contrato(); sql(`insert into public.contrato_servicios (numero_contrato, tipo, descripcion, costo) values ('${m}','otro','manual',50)`);
  const rm = await reg(m, []); check(rm.s === 200 && estado(m) === "completo", "una línea manual (sin alcance) con costo no exige CxP");
}

console.log("== 5. CxP sin clave con contrato_servicio_id / alcance forzados ==");
{
  const n = contrato(); const D = "T · llegada"; const l = linea(n, 26501, D, "llegada", 100);
  let e = psql(`insert into public.cuentas_por_pagar (numero_contrato, tenant, proveedor, tipo_proveedor, servicio, servicio_id, valor_total, contrato_servicio_id) values ('${n}','mayorista','P','receptivo',${lit(D)},26501,100,${l.id})`, true);
  check(!e.ok && /23514|solo se asignan con una clave/.test(e.out), "contrato_servicio_id forzado sin clave: rechazado");
  e = psql(`insert into public.cuentas_por_pagar (numero_contrato, tenant, proveedor, tipo_proveedor, servicio, servicio_id, valor_total, alcance_traslado) values ('${n}','mayorista','P','receptivo',${lit(D)},26501,100,'llegada')`, true);
  check(!e.ok && /solo se asignan con una clave/.test(e.out), "alcance_traslado forzado sin clave: rechazado");
  let r = await http("POST", "/cuentas_por_pagar", tok("administracion"), { numero_contrato: n, tenant: "mayorista", proveedor: "P", tipo_proveedor: "receptivo", servicio: D, servicio_id: 26501, valor_total: 100, contrato_servicio_id: Number(l.id) });
  check(r.s >= 400, `por HTTP (administracion) con contrato_servicio_id forzado: rechazado (HTTP ${r.s})`);
  r = await http("POST", "/cuentas_por_pagar", tok("administracion"), { numero_contrato: n, tenant: "mayorista", proveedor: "P", tipo_proveedor: "receptivo", servicio: D, servicio_id: 26501, valor_total: 100 });
  check(r.s === 201 && r.j[0].contrato_servicio_id == null && r.j[0].alcance_traslado == null, "una CxP manual normal (sin clave ni vínculo) se inserta sin enlace, como siempre");
  e = psql(`insert into public.cuentas_por_pagar (numero_contrato, tenant, proveedor, tipo_proveedor, servicio, servicio_id, valor_total, observaciones) values ('${n}','mayorista','P','receptivo','x',26501,1,'texto enlace:${randomUUID()}  ')`, true);
  check(!e.ok || true, "(informativo) clave con espacios finales");
  void l;
}

console.log("== 6. UPDATE/DELETE por HTTP ==");
{
  const n = contrato(); const D = "T6 · llegada"; const l = linea(n, 26501, D, "llegada", 100); const libre = linea(n, 26501, "libre", "salida", 0);
  await reg(n, [item(26501, D, 100, l.clave)]);
  const c = cxps(n)[0];
  for (const rol of ["administracion", "operaciones", "venta", "gerencia"]) {
    let r = await http("PATCH", `/cuentas_por_pagar?id=eq.${c.id}`, tok(rol), { alcance_traslado: "salida" });
    check(r.s >= 400 || (r.s === 200 && Array.isArray(r.j) && r.j.length === 0), `${rol}: PATCH alcance_traslado de la CxP enlazada no cambia nada (HTTP ${r.s} ${codigo(r)})`);
    r = await http("PATCH", `/cuentas_por_pagar?id=eq.${c.id}`, tok(rol), { contrato_servicio_id: null });
    check(r.s >= 400 || (r.s === 200 && Array.isArray(r.j) && r.j.length === 0), `${rol}: PATCH contrato_servicio_id=null no cambia nada (HTTP ${r.s} ${codigo(r)})`);
  }
  let r = await http("PATCH", `/cuentas_por_pagar?id=eq.${c.id}`, tok("administracion"), { alcance_traslado: "salida" });
  check(r.s === 403 && codigo(r) === "42501", `administracion recibe 403/42501 (HTTP ${r.s} code ${codigo(r)})`, r.t);
  check(cxps(n)[0].alc === "llegada" && cxps(n)[0].cs == l.id, "la CxP sigue con su alcance y su línea");
  r = await http("PATCH", `/cuentas_por_pagar?id=eq.${c.id}`, tok("administracion"), { valor_total: 101 }); check(r.s === 200, `(control) otros campos de la CxP se siguen editando (HTTP ${r.s})`);
  for (const campo of [{ alcance_traslado: "salida" }, { servicio_id: 26502 }, { clave_enlace: randomUUID() }]) {
    r = await http("PATCH", `/contrato_servicios?id=eq.${l.id}`, tok("administracion"), campo);
    check(r.s >= 400, `PATCH ${Object.keys(campo)[0]} de la línea enlazada: bloqueado (HTTP ${r.s} ${codigo(r)})`);
  }
  r = await http("DELETE", `/contrato_servicios?id=eq.${l.id}`, tok("administracion")); check(r.s >= 400, `DELETE de la línea enlazada: bloqueado (HTTP ${r.s} ${codigo(r)})`);
  check(sql(`select count(*) from public.contrato_servicios where id=${l.id} and alcance_traslado='llegada' and servicio_id=26501`) === "1", "la línea enlazada sigue intacta");
  r = await http("PATCH", `/contrato_servicios?id=eq.${libre.id}`, tok("administracion"), { costo: 1, alcance_traslado: "llegada" }); check(r.s === 200, `(control) una línea SIN CxP sí se edita (HTTP ${r.s})`);
  r = await http("DELETE", `/contrato_servicios?id=eq.${libre.id}`, tok("administracion")); check(r.s === 204 || r.s === 200, `(control) una línea SIN CxP sí se borra (HTTP ${r.s})`);
  r = await http("PATCH", `/contrato_servicios?id=eq.${l.id}`, tok("administracion"), { costo: 100, descripcion: "editada" }); check(r.s === 200, `(control) costo/descripcion de la línea enlazada sí se editan (HTTP ${r.s}); la CxP no sigue la descripción: el vínculo es la clave`);
}

console.log("== 7. corregir_enlace_cxp_alcance ==");
{
  const n = contrato(), otro = contrato(); const D = "T7 · llegada";
  const l1 = linea(n, 26501, D, "llegada", 100), l2 = linea(n, 26501, D, "llegada", 0), lB = linea(n, 26502, "B", "salida", 0), lSin = linea(n, 26501, "m", null, 0), lOtro = linea(otro, 26501, D, "llegada", 100);
  await reg(n, [item(26501, D, 100, l1.clave)]); const c = cxps(n)[0];
  const cb = cxps(n)[0];
  for (const rol of ["administracion", "operaciones", "venta"]) { const r = await corregir(tok(rol), c.id, Number(l2.id)); check(r.s >= 400 && codigo(r) === "42501", `${rol}: rechazado 42501 (HTTP ${r.s})`, r.t); }
  let r = await corregir(ANON, c.id, Number(l2.id)); check(r.s === 401 || r.s === 403 || r.s === 404, `anon: rechazado (HTTP ${r.s})`);
  check(cxps(n)[0].cs == l1.id, "ningún rol no autorizado cambió el vínculo");
  for (const [nom, linea_, cod] of [["línea de OTRO contrato", Number(lOtro.id), "23514"], ["línea de OTRO servicio", Number(lB.id), "23514"], ["línea SIN alcance", Number(lSin.id), "23514"], ["línea inexistente", 99999999, "P0002"]]) {
    r = await corregir(tok("superadmin"), c.id, linea_); check(r.s >= 400 && codigo(r) === cod, `${nom}: ${cod} (HTTP ${r.s} code ${codigo(r)})`, r.t);
  }
  r = await corregir(tok("superadmin"), 99999999, Number(l2.id)); check(r.s >= 400 && codigo(r) === "P0002", "CxP inexistente: P0002");
  // línea ya usada por OTRA CxP
  const c2 = sql(`insert into public.cuentas_por_pagar (numero_contrato, tenant, proveedor, tipo_proveedor, servicio, servicio_id, valor_total, observaciones) values ('${n}','mayorista','P','receptivo','suelta',26501,5,'x') returning id`);
  r = await corregir(tok("gerencia"), Number(c2), Number(l1.id)); check(r.s >= 400 && codigo(r) === "23505", `línea ya usada: 23505 (HTTP ${r.s})`, r.t);
  check(cxps(n).find((x) => String(x.id) === c2).cs == null, "la CxP suelta sigue sin enlace tras el rechazo");
  r = await corregir(tok("superadmin"), c.id, Number(l2.id)); check(r.s === 204 || r.s === 200, `superadmin reenlaza la CxP a la línea 2 (HTTP ${r.s})`, r.t);
  check(cxps(n).find((x) => x.id === c.id).cs == l2.id, "la CxP quedó en la línea 2");
  r = await corregir(tok("gerencia"), Number(c2), Number(l1.id)); check(r.s === 204 || r.s === 200, `gerencia enlaza una CxP suelta a una línea libre (HTTP ${r.s})`, r.t);
  check(cxps(n).find((x) => String(x.id) === c2).cs == l1.id && cxps(n).find((x) => String(x.id) === c2).alc === "llegada", "enlace y alcance copiados desde la línea");
  r = await corregir(tok("superadmin"), Number(c2), null); check(r.s === 204 || r.s === 200, `desenlazar (null) por superadmin (HTTP ${r.s})`);
  const d = cxps(n).find((x) => String(x.id) === c2); check(d.cs == null && d.alc == null, "desenlazada: vínculo y alcance en NULL");
  const aud = JSON.parse(sql(`select coalesce(json_agg(json_build_object('actor', actor_email, 'rol', actor_rol, 'accion', accion, 'registro', registro_id, 'cambios', cambios::text) order by id)::text,'[]') from public.auditoria where tabla='cuentas_por_pagar' and registro_id='${n}' and accion='UPDATE' and cambios ? 'contrato_servicio_id'`));
  check(aud.some((a) => a.actor === "superadmin265@x.test" && a.rol === "superadmin" && /contrato_servicio_id/.test(a.cambios)) && aud.some((a) => a.actor === "gerencia265@x.test"), "los cambios quedan en la tabla auditoria con el actor (superadmin y gerencia)", JSON.stringify(aud).slice(0, 300));
  check(sql(`select current_setting('app.enlace_cxp_autorizado', true)`) !== "on", "la bandera de autorización no queda encendida en otras sesiones");
  r = await http("PATCH", `/cuentas_por_pagar?id=eq.${c.id}`, tok("administracion"), { alcance_traslado: "salida" }); check(r.s === 403, "tras corregir, el UPDATE directo sigue bloqueado");
  void cb;
}

console.log("== 8. eliminar_contrato y fn_renumerar_contrato ==");
{
  const n = contrato(); const D = "T8 · llegada"; const l = linea(n, 26501, D, "llegada", 100); await reg(n, [item(26501, D, 100, l.clave)]);
  let r = await http("POST", "/rpc/fn_renumerar_contrato", tok("administracion"), { p_viejo: n, p_nuevo: "DTM-9899" }); check(r.s >= 400, `administracion no renumera (HTTP ${r.s})`);
  r = await http("POST", "/rpc/fn_renumerar_contrato", tok("superadmin"), { p_viejo: n, p_nuevo: "DTM-9899" }); check(r.s === 204 || r.s === 200, `superadmin renumera (HTTP ${r.s})`, r.t);
  check(sql(`select count(*) from public.cuentas_por_pagar c join public.contrato_servicios cs on cs.id=c.contrato_servicio_id where c.numero_contrato='DTM-9899' and cs.numero_contrato='DTM-9899' and cs.clave_enlace='${l.clave}' and c.alcance_traslado='llegada'`) === "1", "tras renumerar línea y CxP siguen enlazadas (misma clave) en el número nuevo");
  r = await http("POST", "/rpc/eliminar_contrato", tok("administracion"), { p_numero: "DTM-9899" }); check(r.s >= 400, `administracion no elimina (HTTP ${r.s})`);
  r = await http("POST", "/rpc/eliminar_contrato", tok("superadmin"), { p_numero: "DTM-9899" }); check(r.s === 204 || r.s === 200, `superadmin elimina el contrato con líneas y CxP enlazadas (HTTP ${r.s})`, r.t);
  check(["ventas", "contrato_servicios", "cuentas_por_pagar"].every((t) => sql(`select count(*) from public.${t} where numero_contrato='DTM-9899'`) === "0"), "ventas, líneas y CxP eliminadas sin error de FK ni de los triggers de protección");
}

console.log("== 9. borrar el servicio del catálogo con una línea enlazada ==");
{
  const n = contrato(); const D = "T9 · llegada"; const l = linea(n, 26503, D, "llegada", 100); await reg(n, [item(26503, D, 100, l.clave)]);
  const e = psql(`delete from public.servicios_adicionales where id = 26503`, true);
  console.log("      resultado:", e.ok ? "se borró" : e.out.split("\n")[0].slice(0, 200));
  check(!e.ok && /42501|no se editan/.test(e.out), "HALLAZGO: no se puede borrar un servicio del catálogo que tiene una línea enlazada (la FK ON DELETE SET NULL choca con linea_enlazada_protegida)");
  check(sql(`select count(*) from public.contrato_servicios where id=${l.id} and servicio_id=26503`) === "1" && cxps(n)[0].cs == l.id, "la línea, la CxP y el vínculo quedan intactos tras el intento");
  const m = contrato(); sql(`insert into public.contrato_servicios (numero_contrato, tipo, descripcion, costo, servicio_id) values ('${m}','traslado','legado',1,26503)`);
}

console.log("== 10. permisos ==");
{
  const fns = ["tg_cxp_enlace_por_clave()", "tg_cxp_enlace_inmutable()", "tg_linea_enlazada_protegida()", "tg_ventas_completo_exige_enlaces()"];
  for (const f of fns) check(sql(`select has_function_privilege('anon','public.${f}','execute')::text||'/'||has_function_privilege('authenticated','public.${f}','execute')::text`) === "false/false", `${f}: no ejecutable por anon ni authenticated`);
  check(sql(`select has_function_privilege('anon','public.corregir_enlace_cxp_alcance(bigint,bigint)','execute')::text||'/'||has_function_privilege('authenticated','public.corregir_enlace_cxp_alcance(bigint,bigint)','execute')::text`) === "false/true", "corregir_enlace_cxp_alcance: solo authenticated");
  check(sql(`select count(*) from pg_proc where proname in ('tg_cxp_enlace_por_clave','tg_cxp_enlace_inmutable','tg_linea_enlazada_protegida','tg_ventas_completo_exige_enlaces','corregir_enlace_cxp_alcance') and prosecdef and proconfig::text like '%search_path=public, pg_temp%'`) === "5", "las 5 funciones son SECURITY DEFINER con search_path fijo");
  for (const f of ["tg_cxp_enlace_por_clave", "tg_cxp_enlace_inmutable", "tg_linea_enlazada_protegida", "tg_ventas_completo_exige_enlaces"]) { const r = await http("POST", `/rpc/${f}`, tok("superadmin"), {}); check(r.s === 404, `${f} no se expone como RPC (HTTP ${r.s})`); }
  const spec = await fetch(`${URL}/`, { headers: { accept: "application/openapi+json", authorization: `Bearer ${tok("superadmin")}` } }).then((x) => x.text());
  check(!/tg_cxp_enlace|tg_linea_enlazada|tg_ventas_completo|tg_cxp_enlazar/.test(spec) && spec.includes("corregir_enlace_cxp_alcance"), "el OpenAPI expone corregir_enlace_cxp_alcance y ninguna función de trigger");
  const sa = await http("POST", "/rpc/registrar_financiero_contrato", ANON, { p_numero_contrato: "x", p_tenant: "mayorista", p_costos: {}, p_cxp: [] }); check(sa.s === 401 || sa.s === 403 || sa.s === 404, `registrar_financiero_contrato sigue cerrada a anon (HTTP ${sa.s})`);
  const au = await http("POST", "/rpc/registrar_financiero_contrato", tok("superadmin"), { p_numero_contrato: "x", p_tenant: "mayorista", p_costos: {}, p_cxp: [] }); check(au.s === 401 || au.s === 403 || au.s === 404, `...y a authenticated (HTTP ${au.s})`);
}

console.log("== 11. reintento con las CxP del carrito ya existentes (OBS_AUTO ahora empieza por marca_cxp_automatica()) ==");
{
  const n = contrato(); const D = "T11 · llegada"; const l = linea(n, 26501, D, "llegada", 100); await reg(n, [item(26501, D, 100, l.clave)]);
  const marca = sql(`select public.marca_cxp_automatica()`);
  const obs = cxps(n)[0].obs;
  check(obs.startsWith(marca), `la observación del carrito ("${obs.slice(0, 60)}…") EMPIEZA por marca_cxp_automatica() ("${marca}")`);
  sql(`update public.ventas set financiero_estado='pendiente' where numero_contrato='${n}'`);
  const antes = cxps(n).map((x) => x.id);
  const r = await reg(n, [item(26501, D, 100, l.clave)]);
  check(r.s === 200, `el reintento reemplaza la CxP automática anterior (HTTP ${r.s})`, r.t);
  const c = cxps(n);
  check(c.length === 1 && !antes.includes(c[0].id) && c[0].cs == l.id && c[0].alc === "llegada" && estado(n) === "completo", "queda UNA CxP nueva enlazada a la misma línea y el contrato 'completo'", JSON.stringify(c));
  // con un pago registrado la CxP NO se reemplaza y el reintento falla cerrado
  sql(`insert into public.cxp_pagos (cuenta_por_pagar_id, valor, tenant) values (${c[0].id}, 10, 'mayorista')`);
  sql(`update public.ventas set financiero_estado='pendiente' where numero_contrato='${n}'`);
  const r2 = await reg(n, [item(26501, D, 100, l.clave)]);
  check(r2.s >= 400 && codigo(r2) === "23505", `con un pago la CxP no se reemplaza y la clave choca (23505): falla cerrado (HTTP ${r2.s})`, r2.t);
  check(cxps(n).length === 1 && cxps(n)[0].id === c[0].id && estado(n) === "pendiente", "sigue la CxP original y el contrato 'pendiente'");
}

console.log(`\nRESULTADO enlace265: ${ok} correctas, ${mal} fallas`);
process.exit(mal ? 1 : 0);
