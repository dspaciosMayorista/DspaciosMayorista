// #43/#60 incremento 3 — RPC grupos_dias_* por HTTP contra PostgREST local (la lanza
// supabase/scripts/test_295_postgrest.sh). Por rol: una solicitud por operación, permisos, PT409 → 409.
import { createHmac } from "node:crypto";
import { execSync } from "node:child_process";

const URL = process.env.T293_URL, SECRETO = process.env.T293_SECRETO, SQL = process.env.T293_SQL;
const b64 = (s) => Buffer.from(s).toString("base64url");
const jwt = (p) => {
  const h = b64(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const c = b64(JSON.stringify({ ...p, exp: Math.floor(Date.now() / 1000) + 3600 }));
  return `${h}.${c}.${createHmac("sha256", SECRETO).update(`${h}.${c}`).digest("base64url")}`;
};
const usuario = (n) => jwt({ role: "authenticated", sub: `00000000-0000-4000-8000-00000000930${n}`, session_id: `00000000-0000-4000-8000-00000000a30${n}` });
const R = { superadmin: usuario(1), oper_may: usuario(2), oper_min: usuario(3), venta: usuario(4), anon: null };
const sql = (q) => execSync(SQL, { input: q, encoding: "utf8" }).trim();
let fallos = 0, solicitudes = 0;
const ok = (c, m) => { if (c) console.log(`OK    ${m}`); else { fallos++; console.log(`FALLO ${m}`); } };
async function rpc(token, fn, args) {
  solicitudes++;
  const r = await fetch(`${URL}/rpc/${fn}`, { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(args) });
  const t = await r.text();
  let cuerpo; try { cuerpo = JSON.parse(t); } catch { cuerpo = t; }
  return { status: r.status, bytes: Buffer.byteLength(t), cuerpo };
}
const una = async (token, fn, args) => { const antes = solicitudes; const r = await rpc(token, fn, args); ok(solicitudes - antes === 1, `${fn}: una sola solicitud`); return r; };

const huellaTarifas = () => sql("select md5(string_agg(to_jsonb(t)::text, E'\\n' order by t.id)) from public.tarifa_hotel t;");
const H0 = huellaTarifas();

// Lectura por rol
const cfg = await una(R.oper_may, "grupos_dias_config", { p_temporada_id: 930101 });
ok(cfg.status === 200 && cfg.cuerpo.huella, `operaciones Mayorista lee (HTTP ${cfg.status}, ${cfg.bytes} bytes)`);
ok((await rpc(R.oper_min, "grupos_dias_config", { p_temporada_id: 930101 })).status === 200, "operaciones Minorista lee");
ok((await rpc(R.superadmin, "grupos_dias_config", { p_temporada_id: 930101 })).status === 200, "superadmin lee");
const v = await rpc(R.venta, "grupos_dias_config", { p_temporada_id: 930101 });
ok(v.status === 403 && v.cuerpo.code === "42501", `venta no lee (HTTP ${v.status} ${v.cuerpo.code})`);
const a = await rpc(R.anon, "grupos_dias_config", { p_temporada_id: 930101 });
ok(a.status === 401 || a.status === 403, `anon no ejecuta (HTTP ${a.status})`);

// Escrituras
const g = await una(R.oper_may, "grupos_dias_guardar", { p_temporada_id: 930101, p_huella: cfg.cuerpo.huella, p_grupos: [{ nombre: "Semana", dias: [1, 2, 3, 4] }] });
ok(g.status === 200 && g.cuerpo.altas === 1 && g.cuerpo.config.grupos.length === 1, "operaciones Mayorista guarda un grupo; la respuesta trae la configuración nueva (sin lectura extra)");
const grupo = g.cuerpo.config.grupos[0].id;
const p = await una(R.oper_may, "grupos_dias_guardar_propuesta", { p_temporada_id: 930101, p_huella: g.cuerpo.config.huella, p_modo: "actualizar", p_grupo_id: null,
  p_filas: [{ grupo_id: grupo, tipo_habitacion: "Estándar", alimentacion: "PAM", neto_doble: 100000 }] });
ok(p.status === 200 && p.cuerpo.nuevas === 1, "guarda una propuesta");
const vieja = await rpc(R.oper_may, "grupos_dias_guardar_propuesta", { p_temporada_id: 930101, p_huella: cfg.cuerpo.huella, p_modo: "actualizar", p_grupo_id: null, p_filas: [] });
ok(vieja.status === 409 && vieja.cuerpo.code === "PT409" && /CONFIG_DESACTUALIZADA/.test(vieja.cuerpo.message), `huella obsoleta ⇒ HTTP 409 PT409 (${vieja.status})`);
const min = await rpc(R.oper_min, "grupos_dias_guardar", { p_temporada_id: 930101, p_huella: p.cuerpo.config.huella, p_grupos: [] });
ok(min.status === 403 && min.cuerpo.code === "42501", `operaciones Minorista no escribe (HTTP ${min.status})`);
const ven = await rpc(R.venta, "grupos_dias_borrar", { p_grupo_id: grupo, p_huella: p.cuerpo.config.huella });
ok(ven.status === 403, `venta no borra (HTTP ${ven.status})`);
const directo = await (async () => { solicitudes++; const r = await fetch(`${URL}/hotel_grupo_tarifa_propuesta`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${R.oper_may}` }, body: JSON.stringify({ grupo_id: grupo, tipo_habitacion: "Superior", alimentacion: "PC", neto_doble: 1 }) }); return r.status; })();
ok(directo === 401 || directo === 403, `escribir la tabla directo por la API: rechazado (HTTP ${directo})`);
// ── Persistencia real con el MISMO cálculo del editor (planPropuesta → payloadFilas) y reapertura ──
const { planPropuesta, payloadFilas, leerNeto, formatNeto, netosDe, extrasDe, NETOS_VACIOS, EXTRAS_VACIOS } = await import("../lib/hoteles/alcanceGrupos.ts");
sql("insert into public.tarifa_hotel (hotel_id, tipo_habitacion, alimentacion, temporada, neto_doble, neto_infante, notas, edad_infante_min, edad_infante_max, edad_nino_min, edad_nino_max) values (9301, 'Superior', 'PAM', 'ALTA', 200000.5, 0, 'Origen', 0, 2, 3, 12);");
const leerCfg = async () => (await rpc(R.oper_may, "grupos_dias_config", { p_temporada_id: 930101 })).cuerpo;
const guardar = async (cfgActual, modo, filas, grupoId = null) => {
  const plan = planPropuesta(cfgActual, modo, grupoId, filas);
  const r = await una(R.oper_may, "grupos_dias_guardar_propuesta", { p_temporada_id: 930101, p_huella: cfgActual.huella, p_modo: modo, p_grupo_id: modo === "reemplazar_grupo" ? grupoId : null, p_filas: payloadFilas(plan.filas) });
  ok(r.status === 200, `guardar (${modo}): HTTP ${r.status}${r.status !== 200 ? " " + JSON.stringify(r.cuerpo) : ""}`);
  return { plan, cfg: r.cuerpo.config };
};
const n = (t) => leerNeto(t).valor;
const EXTRAS = { nota_infante: "Cuna", notas: "Vista al mar", edad_infante_min: 0, edad_infante_max: 1, edad_nino_min: 2, edad_nino_max: 11 };
const filaEstandar = (c) => c.propuestas.find((x) => x.tipo_habitacion === "Estándar" && x.alimentacion === "PAM");
let c1 = await leerCfg();
// 1) Decimal, entero con miles, cero y vacío, con override completo de edades y notas.
let res = await guardar(c1, "actualizar", [{ grupo_id: grupo, tipo_habitacion: "Estándar", alimentacion: "PAM",
  netos: { ...NETOS_VACIOS, neto_doble: n("123,45"), neto_sencilla: n("150.000"), neto_nino: n("0") }, origen_tarifa_id: null, extras: EXTRAS }]);
let c2 = await leerCfg();
let pe = filaEstandar(c2);
ok(Number(pe.neto_doble) === 123.45 && Number(pe.neto_sencilla) === 150000 && Number(pe.neto_nino) === 0 && pe.neto_triple === null,
  "Postgres guarda 123.45 / 150000 / 0 / vacío exactos");
ok(formatNeto(pe.neto_doble) === "123,45", "al reabrir, el editor muestra «123,45» (no 12345)");
ok(JSON.stringify(extrasDe(pe)) === JSON.stringify(EXTRAS), "notas y edades guardadas");
// 2) Editar SOLO otro neto (notas y edades omitidas): se conservan.
res = await guardar(c2, "actualizar", [{ grupo_id: grupo, tipo_habitacion: "Estándar", alimentacion: "PAM",
  netos: { ...netosDe(pe), neto_triple: n("99,9") }, origen_tarifa_id: null }]);
ok(JSON.stringify(res.plan.lineas.map((l) => l.texto)) === JSON.stringify(["Semana · Estándar / PAM · Triple: vacío → 99,9"]), "la revisión lista solo la celda editada");
let c3 = await leerCfg(); pe = filaEstandar(c3);
ok(Number(pe.neto_triple) === 99.9 && Number(pe.neto_doble) === 123.45 && JSON.stringify(extrasDe(pe)) === JSON.stringify(EXTRAS),
  "reabrir: 99.9 nuevo, 123.45 y notas/edades conservados");
// 3) Aceptar la sugerencia (con decimales y cero) de otra combinación.
const orig = c3.origen.find((o) => o.tipo_habitacion === "Superior" && o.alimentacion === "PAM");
res = await guardar(c3, "actualizar", [{ grupo_id: grupo, tipo_habitacion: "Superior", alimentacion: "PAM", netos: netosDe(orig), origen_tarifa_id: orig.id }]);
let c4 = await leerCfg();
const ps = c4.propuestas.find((x) => x.tipo_habitacion === "Superior");
ok(Number(ps.neto_doble) === 200000.5 && Number(ps.neto_infante) === 0 && ps.origen_tarifa_id === orig.id && ps.notas === null,
  "sugerencia aceptada: 200000.5 y 0 exactos, origen registrado, sus notas NO (no se aceptaron)");
ok(JSON.stringify(extrasDe(filaEstandar(c4))) === JSON.stringify(EXTRAS), "la otra combinación sigue intacta");
// 4) Reemplazar el grupo con lo que hay en pantalla (filas completas): importes y notas/edades se conservan.
const enPantalla = c4.propuestas.map((x) => ({ grupo_id: grupo, tipo_habitacion: x.tipo_habitacion, alimentacion: x.alimentacion, netos: netosDe(x), origen_tarifa_id: x.origen_tarifa_id, extras: extrasDe(x) }));
res = await guardar(c4, "reemplazar_grupo", enPantalla, grupo);
ok(res.plan.lineas.length === 0 && res.plan.reescritasSinCambio === 2, "reemplazar con lo mismo: sin líneas de cambio, 2 filas reescritas (declaradas)");
let c5 = await leerCfg(); pe = filaEstandar(c5);
ok(Number(pe.neto_doble) === 123.45 && Number(pe.neto_triple) === 99.9 && JSON.stringify(extrasDe(pe)) === JSON.stringify(EXTRAS)
  && c5.propuestas.find((x) => x.tipo_habitacion === "Superior").origen_tarifa_id === orig.id, "tras el reemplazo: importes, notas/edades y origen intactos");
// 5) Borrado intencional de notas y edades.
res = await guardar(c5, "actualizar", [{ grupo_id: grupo, tipo_habitacion: "Estándar", alimentacion: "PAM", netos: netosDe(pe), origen_tarifa_id: null, extras: EXTRAS_VACIOS }]);
ok(res.plan.lineas.some((l) => /Notas: «Vista al mar» → vacío \(se borra\)/.test(l.texto)), "la revisión anuncia el borrado de notas");
let c6 = await leerCfg(); pe = filaEstandar(c6);
ok(JSON.stringify(extrasDe(pe)) === JSON.stringify(EXTRAS_VACIOS) && Number(pe.neto_doble) === 123.45, "borrado intencional aplicado; los netos siguen");
// 6) Reemplazar la vigencia con una sola fila: la otra se elimina y la revisión lo detalla.
res = await guardar(c6, "reemplazar_vigencia", [{ grupo_id: grupo, tipo_habitacion: "Estándar", alimentacion: "PAM", netos: netosDe(pe), origen_tarifa_id: null, extras: EXTRAS_VACIOS }]);
ok(res.plan.lineas.some((l) => l.tipo === "quita" && /Superior \/ PAM \(antes: Doble 200\.000,5, Infante 0\)/.test(l.texto)), "la revisión detalla lo eliminado con sus importes");
const c7 = await leerCfg();
ok(c7.propuestas.length === 1, "Postgres quedó con exactamente lo confirmado");

const b = await una(R.superadmin, "grupos_dias_borrar", { p_grupo_id: grupo, p_huella: c7.huella });
ok(b.status === 200 && b.cuerpo.propuestas_eliminadas === 1, "superadmin (sesión Mayorista) borra el grupo y su única propuesta");
sql("delete from public.tarifa_hotel where hotel_id = 9301 and tipo_habitacion = 'Superior' and alimentacion = 'PAM' and temporada = 'ALTA';");

ok(huellaTarifas() === H0, "las tarifas vigentes no cambiaron");
ok(sql("select count(*) from public.hotel_temporada_grupos where activo;") === "0" && sql("select count(*) from public.tarifa_hotel where grupo_id is not null;") === "0", "ningún grupo activo ni tarifa por grupo");
console.log(`\nVolumen: lectura de configuración ${cfg.bytes} bytes (vigencia con 2 tarifas de origen y 1 promoción vinculada)`);
console.log(`Solicitudes HTTP totales: ${solicitudes}`);
console.log(`=== ${fallos} fallo(s)`);
process.exit(fallos ? 1 : 0);
