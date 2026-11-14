// #43/#60 entrega 3c — venta por grupos (299) por HTTP contra PostgREST local (lo lanza test_299_postgrest.sh).
// Usa EL MISMO cálculo del panel (planPropuesta → payloadFilas, planActivacion → payloadHabilitaciones, planVolver →
// payloadVolver), reabre desde Postgres, prueba los permisos por rol y la comprobación diferida de empates al
// confirmar una escritura directa por la API, y cuenta solicitudes.
import { createHmac } from "node:crypto";
import { execSync } from "node:child_process";

const URL = process.env.T299_URL, SECRETO = process.env.T299_SECRETO, SQL = process.env.T299_SQL;
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
async function http(token, metodo, ruta, cuerpo, extra = {}) {
  solicitudes++;
  const r = await fetch(`${URL}${ruta}`, { method: metodo, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}), ...extra }, body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo) });
  const t = await r.text();
  let c; try { c = JSON.parse(t); } catch { c = t; }
  return { status: r.status, bytes: Buffer.byteLength(t), cuerpo: c };
}
const rpc = (token, fn, args) => http(token, "POST", `/rpc/${fn}`, args);
const una = async (token, fn, args) => { const antes = solicitudes; const r = await rpc(token, fn, args); ok(solicitudes - antes === 1, `${fn}: una sola solicitud (HTTP ${r.status}, ${r.bytes} bytes)`); return r; };

const { planPropuesta, payloadFilas, NETOS_VACIOS } = await import("../lib/hoteles/alcanceGrupos.ts");
const { planActivacion, puedeAplicar, payloadHabilitaciones, planVolver, payloadVolver, claveComboVolver } = await import("../lib/hoteles/activacionGrupos.ts");
const S = "00000000-0000-4000-8000-0000000c0001";
const huellaTodo = () => sql("select md5(concat_ws('|', (select string_agg(to_jsonb(t)::text, E'\\n' order by t.id) from public.tarifa_hotel t), (select string_agg(to_jsonb(g)::text, E'\\n' order by g.id) from public.hotel_temporada_grupos g), (select string_agg(to_jsonb(h)::text, E'\\n' order by h.id) from public.hotel_temporadas h)));");
// Estado de partida: PUENTE con prioridad 2 (no compite) y la Semana con la misma regla de edad que el Fin de semana.
sql("update public.hotel_temporadas set prioridad = 2 where id = 930106;");

// 1) Propuesta de la Semana con el MISMO plan del panel.
let cfg = (await una(R.oper_may, "grupos_dias_config_bases", { p_temporada_id: 930101 })).cuerpo;
const filaSemana = { grupo_id: S, tipo_habitacion: "Estándar", alimentacion: "PAM", origen_tarifa_id: null,
  netos: { ...NETOS_VACIOS, neto_sencilla: 150000, neto_doble: 95000, neto_triple: 80000.5 },
  extras: { nota_infante: null, notas: null, edad_infante_min: 0, edad_infante_max: 1, edad_nino_min: 2, edad_nino_max: 11 } };
const pp = planPropuesta(cfg, "actualizar", null, [filaSemana]);
const g = await una(R.oper_may, "grupos_dias_guardar_propuesta", { p_temporada_id: 930101, p_huella: cfg.huella, p_modo: "actualizar", p_grupo_id: null, p_filas: payloadFilas(pp.filas) });
ok(g.status === 200 && g.cuerpo.config.estado === "preparado", "propuesta guardada; la vigencia sigue preparada (no se vende)");

// 2) Permisos del alcance y de aplicar.
ok((await rpc(R.anon, "grupos_dias_alcance", { p_temporada_id: 930101 })).status === 401, "anon: alcance rechazado (401)");
ok((await rpc(R.venta, "grupos_dias_alcance", { p_temporada_id: 930101 })).status === 403, "venta: alcance rechazado (403)");
ok((await rpc(R.oper_min, "grupos_dias_alcance", { p_temporada_id: 930101 })).status === 200, "operaciones Minorista: lee el alcance");

// 3) Revisión = UNA lectura; el plan del panel exige confirmar la habilitación del triple.
const al = (await una(R.oper_may, "grupos_dias_alcance", { p_temporada_id: 930101 })).cuerpo;
const plan = planActivacion(al);
ok(plan.bloqueos.length === 0, `sin bloqueos (${plan.bloqueos.join(" | ") || "—"})`);
ok(plan.habilitaciones.length === 1 && plan.habilitaciones[0].acomodacion === "triple", "una habilitación: el triple de la Semana");
ok(!puedeAplicar(plan, new Set()), "sin confirmar no se puede aplicar");
const sinConfirmar = await rpc(R.oper_may, "grupos_dias_activar", { p_temporada_id: 930101, p_huella: al.huella, p_habilitaciones: [] });
ok(sinConfirmar.status === 409 && /HABILITACIONES/.test(sinConfirmar.cuerpo.message), `la base también lo rechaza (HTTP ${sinConfirmar.status})`);
const prohibido = await rpc(R.oper_min, "grupos_dias_activar", { p_temporada_id: 930101, p_huella: al.huella, p_habilitaciones: [] });
ok(prohibido.status === 403, `operaciones Minorista no aplica (HTTP ${prohibido.status})`);
const todas = new Set(plan.habilitaciones.map((h) => h.clave));
const ap = await una(R.oper_may, "grupos_dias_activar", { p_temporada_id: 930101, p_huella: al.huella, p_habilitaciones: payloadHabilitaciones(plan, todas) });
ok(ap.status === 200 && ap.cuerpo.config.estado === "activo" && ap.cuerpo.todos_los_dias_quitadas === 2, "aplicado: activo; las 2 filas «todos los días» salieron de la venta");
const vSemana = ap.cuerpo.config.vigentes.find((v) => v.grupo_id === S);
ok(vSemana && Number(vSemana.neto_triple) === 80000.5 && vSemana.edad_nino_max === 11, "Postgres vende exactamente la propuesta (80.000,5 y la regla de edad)");
const repetida = await rpc(R.oper_may, "grupos_dias_activar", { p_temporada_id: 930101, p_huella: al.huella, p_habilitaciones: payloadHabilitaciones(plan, todas) });
ok(repetida.status === 409, `la misma confirmación otra vez = obsoleta (HTTP ${repetida.status}); no se aplica dos veces`);

// 4) Escrituras directas por la API: tarifas por grupo y grupos, prohibidas.
const idFila = sql(`select id from public.tarifa_hotel where grupo_id = '${S}';`);
const parche = await http(R.oper_may, "PATCH", `/tarifa_hotel?id=eq.${idFila}`, { neto_doble: 1 });
ok(parche.status === 403, `editar una tarifa por grupo por la API: rechazado (HTTP ${parche.status})`);
const alta = await http(R.oper_may, "POST", "/hotel_temporada_grupos", { temporada_id: 930105, nombre: "X", dias: [1] });
ok(alta.status === 403 || alta.status === 401, `crear un grupo directo por la API: rechazado (HTTP ${alta.status})`);

// 5) Empate creado por una escritura directa (prioridad de PUENTE 2 → 1): la comprobación DIFERIDA lo rechaza al confirmar.
const antes = huellaTodo();
const emp = await http(R.oper_may, "PATCH", "/hotel_temporadas?id=eq.930106", { prioridad: 1 });
ok(emp.status >= 400 && /EMPATE_PRIORIDAD/.test(JSON.stringify(emp.cuerpo)), `bajar la prioridad de PUENTE: rechazado al confirmar (HTTP ${emp.status}: ${String(emp.cuerpo?.message ?? emp.cuerpo).slice(0, 90)})`);
ok(huellaTodo() === antes, "nada cambió (la transacción entera se deshizo)");
const sinEmp = await http(R.oper_may, "PATCH", "/hotel_temporadas?id=eq.930106", { prioridad: 3 });
ok(sinEmp.status >= 200 && sinEmp.status < 300, `un cambio que no empata sí pasa (HTTP ${sinEmp.status})`);

// 6) Volver a «todos los días» con el plan del panel: sin elegir no hay payload; eligiendo la Semana, 1 RPC.
cfg = (await una(R.oper_may, "grupos_dias_config_bases", { p_temporada_id: 930101 })).cuerpo;
const pv = planVolver(cfg);
ok(payloadVolver(pv, {}) === null, "sin elegir cada combinación no hay nada que enviar");
const vo = await una(R.oper_may, "grupos_dias_volver_todos", { p_temporada_id: 930101, p_huella: cfg.huella,
  p_elecciones: payloadVolver(pv, Object.fromEntries(pv.combos.map((c) => [claveComboVolver(c), S]))) });
ok(vo.status === 200 && vo.cuerpo.config.estado === "preparado" && vo.cuerpo.todos_los_dias_nuevas === 1, "vuelve a «todos los días» con la tarifa de la Semana; los grupos quedan preparados");
ok(sql("select count(*) from public.tarifa_hotel where hotel_id = 9301 and temporada = 'ALTA' and grupo_id is null and neto_triple = 80000.5;") === "1", "la tarifa conservada es la elegida");
ok(sql("select count(*) from public.tarifa_hotel_historial where hotel_id = 9301 and motivo in ('grupos_aplicar', 'grupos_volver_todos');") === "4", "historial: 2 al aplicar + 2 al volver");
ok(sql("select count(*) from public.hotel_temporada_grupos where activo;") === "0", "nada quedó activo");
console.log(`=== ${fallos} fallo(s); ${solicitudes} solicitud(es) HTTP`);
process.exit(fallos ? 1 : 0);
