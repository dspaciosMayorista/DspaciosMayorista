// #43/#60 entrega 4 — migración 300 por HTTP contra PostgREST local (lo lanza test_300_postgrest.sh).
// 1) Los SELECT EXACTOS de los cargadores (grupos + reglas incrustados) responden 200: la tabla de reglas, con FK a
//    vigencias y a grupos, no vuelve ambigua la relación vigencias → grupos (PGRST201). 2) RPC por rol. 3) Solicitudes.
import { createHmac } from "node:crypto";
import { execSync } from "node:child_process";

const URL = process.env.T300_URL, SECRETO = process.env.T300_SECRETO, SQL = process.env.T300_SQL;
const b64 = (s) => Buffer.from(s).toString("base64url");
const jwt = (p) => {
  const h = b64(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const c = b64(JSON.stringify({ ...p, exp: Math.floor(Date.now() / 1000) + 3600 }));
  return `${h}.${c}.${createHmac("sha256", SECRETO).update(`${h}.${c}`).digest("base64url")}`;
};
const usuario = (n) => jwt({ role: "authenticated", sub: `00000000-0000-4000-8000-00000000930${n}`, session_id: `00000000-0000-4000-8000-00000000a30${n}` });
const R = { oper_may: usuario(2), oper_min: usuario(3), venta: usuario(4), servicio: jwt({ role: "service_role" }), anon: null };
const sql = (q) => execSync(SQL, { input: q, encoding: "utf8" }).trim();
let fallos = 0, solicitudes = 0;
const ok = (c, m) => { if (c) console.log(`OK    ${m}`); else { fallos++; console.log(`FALLO ${m}`); } };
async function http(token, metodo, ruta, cuerpo) {
  solicitudes++;
  const r = await fetch(`${URL}${ruta}`, { method: metodo, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo) });
  const t = await r.text();
  let c; try { c = JSON.parse(t); } catch { c = t; }
  return { status: r.status, cuerpo: c };
}
const { SELECT_PROMO_VIGENCIA } = await import("../lib/calc/promocionesGrupo.ts");
const S = "00000000-0000-4000-8000-0000000c0001";
sql(`insert into public.hotel_temporadas (id, hotel_id, nombre, fecha_inicio, fecha_fin, prioridad, tipo, promo_base_id)
     values (930130, 9301, 'PROMO HTTP', '2027-01-01', '2027-01-31', 6, 'descuento_pct', 930101);`);

// 1) Guardar reglas: 1 solicitud; venta y Minorista rechazados.
const previas = { base: 930101, reglas: [] };
const reglas = [{ grupo_id: S, valor: 10, dias: [1, 2, 3] }];
const antes = solicitudes;
const g = await http(R.oper_may, "POST", "/rpc/promocion_guardar_reglas", { p_promocion_id: 930130, p_base_id: 930101, p_reglas: reglas, p_previas: previas });
ok(g.status === 200 && solicitudes - antes === 1, `operaciones Mayorista guarda reglas en 1 solicitud (HTTP ${g.status})`);
const v = await http(R.venta, "POST", "/rpc/promocion_guardar_reglas", { p_promocion_id: 930130, p_base_id: 930101, p_reglas: reglas, p_previas: { base: 930101, reglas } });
ok(v.status >= 400, `venta no guarda reglas (HTTP ${v.status})`);
const m = await http(R.oper_min, "POST", "/rpc/promocion_guardar_reglas", { p_promocion_id: 930130, p_base_id: 930101, p_reglas: [], p_previas: { base: 930101, reglas } });
ok(m.status >= 400, `sesión Minorista no escribe el catálogo global (HTTP ${m.status})`);
const o = await http(R.oper_may, "POST", "/rpc/promocion_guardar_reglas", { p_promocion_id: 930130, p_base_id: 930101, p_reglas: [], p_previas: previas });
ok(o.status === 409 || /recarga/.test(JSON.stringify(o.cuerpo)), `foto obsoleta ⇒ rechazo PT409 (HTTP ${o.status})`);

// 2) Los SELECT exactos de los cargadores (misma forma que computo/cotizar/vigencia/generación y la ficha).
const cargadores = {
  "computo/cotizar/vigencia/generación": `id,nombre,tipo,prioridad,hotel_temporada_grupos(id,dias,activo),${SELECT_PROMO_VIGENCIA.replace(/\s+/g, "")}`,
  ficha: `id,nombre,hotel_temporada_grupos(id,nombre,dias,activo,hotel_calculadora_grupo_bases(tipo,bases,generales,version)),${SELECT_PROMO_VIGENCIA.replace(/\s+/g, "")}`,
};
for (const [quien, sel] of Object.entries(cargadores)) {
  for (const [rol, token] of [["service_role", R.servicio], ["operaciones", R.oper_may]]) {
    const r = await http(token, "GET", `/hotel_temporadas?select=${encodeURIComponent(sel)}&hotel_id=eq.9301&order=id`);
    const promo = Array.isArray(r.cuerpo) ? r.cuerpo.find((x) => x.id === 930130) : null;
    const alta = Array.isArray(r.cuerpo) ? r.cuerpo.find((x) => x.id === 930101) : null;
    ok(r.status === 200 && promo?.promo_base_id === 930101 && promo.hotel_promocion_reglas?.length === 1 && alta?.hotel_temporada_grupos?.length === 2,
      `${quien} como ${rol}: HTTP ${r.status}, grupos y reglas en la MISMA respuesta${r.status !== 200 ? ` — ${JSON.stringify(r.cuerpo).slice(0, 160)}` : ""}`);
  }
}
const rv = await http(R.venta, "GET", `/hotel_temporadas?select=${encodeURIComponent(`id,${SELECT_PROMO_VIGENCIA.replace(/\s+/g, "")}`)}&id=eq.930130`);
ok(rv.status !== 200 || (Array.isArray(rv.cuerpo) && rv.cuerpo.every((x) => (x.hotel_promocion_reglas ?? []).length === 0)), `venta no ve reglas (HTTP ${rv.status})`);
const ra = await http(R.anon, "GET", "/hotel_promocion_reglas?select=id");
ok(ra.status === 401 || ra.status === 403 || (Array.isArray(ra.cuerpo) && ra.cuerpo.length === 0), `anon sin acceso directo a las reglas (HTTP ${ra.status})`);

// 3) «Aplicar a la venta» (revisión): 1 solicitud trae las promociones vinculadas, con sus reglas.
const al = await http(R.oper_may, "POST", "/rpc/grupos_dias_alcance", { p_temporada_id: 930101 });
ok(al.status === 200 && (al.cuerpo.promociones_reglas ?? []).some((p) => p.nombre === "PROMO HTTP" && p.reglas.length === 1)
   && Array.isArray(al.cuerpo.promociones_conflictos), `revisión de la venta: PROMO HTTP con sus reglas y la lista de conflictos (HTTP ${al.status})`);

// 4) Conflicto real por la API: otra promoción con la MISMA prioridad y el mismo grupo/días ⇒ se rechaza al confirmar.
sql(`insert into public.hotel_temporadas (id, hotel_id, nombre, fecha_inicio, fecha_fin, prioridad, tipo, promo_base_id)
     values (930131, 9301, 'PROMO HTTP 2', '2027-01-01', '2027-01-31', 6, 'descuento_pct', 930101);`);
const k = await http(R.oper_may, "POST", "/rpc/promocion_guardar_reglas", { p_promocion_id: 930131, p_base_id: 930101, p_reglas: [{ grupo_id: S, valor: 5, dias: [2] }], p_previas: { base: 930101, reglas: [] } });
ok(k.status >= 400 && /CONFLICTO_PROMOCIONES/.test(JSON.stringify(k.cuerpo)) && sql("select count(*) from public.hotel_promocion_reglas where promocion_id = 930131;") === "0",
   `misma prioridad y mismo martes: rechazado al confirmar y no queda nada (HTTP ${k.status})`);
const k2 = await http(R.oper_may, "POST", "/rpc/promocion_guardar_reglas", { p_promocion_id: 930131, p_base_id: 930101, p_reglas: [{ grupo_id: S, valor: 5, dias: [4] }], p_previas: { base: 930101, reglas: [] } });
ok(k2.status === 200, `misma prioridad pero el jueves (la otra solo L–X): se acepta (HTTP ${k2.status})`);

// 5) La ocupación del hotel viaja en la lectura de hoteles que ya hacen cotización y generación (0 solicitudes nuevas).
const oc = await http(R.servicio, "GET", `/armado_hoteles?select=${encodeURIComponent("categorias,regimenes,hoteles(nombre,moneda,adults_only,modelo_tarifario,tarifa_bajo_solicitud,hotel_acomodaciones(acomodacion,pax_tarifa))")}&limit=1`);
ok(oc.status === 200, `armado_hoteles → hoteles → hotel_acomodaciones responde (HTTP ${oc.status}${oc.status !== 200 ? " — " + JSON.stringify(oc.cuerpo).slice(0, 160) : ""})`);

console.log(`solicitudes: ${solicitudes}`);
console.log(`=== fallos: ${fallos}`);
process.exit(fallos ? 1 : 0);
