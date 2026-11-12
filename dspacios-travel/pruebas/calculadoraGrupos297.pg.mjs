// #43/#60 entrega 3b — RPC grupos_dias_guardar_calculadora y escritores de hotel_calculadora por HTTP contra
// PostgREST local (lo lanza supabase/scripts/test_297_postgrest.sh). Usa el MISMO cálculo y la MISMA revisión
// del editor (calcularGrupo → revisarCalculo → payloadFilas), reabre desde Postgres y cuenta solicitudes.
import { createHmac } from "node:crypto";
import { execSync } from "node:child_process";

const URL = process.env.T297_URL, SECRETO = process.env.T297_SECRETO, SQL = process.env.T297_SQL;
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
const una = async (token, fn, args) => { const antes = solicitudes; const r = await rpc(token, fn, args); ok(solicitudes - antes === 1, `${fn}: una sola solicitud (${r.bytes} bytes)`); return r; };

const { calcularGrupo, revisarCalculo, decidirTodas, claveBases, DECISIONES_VACIAS } = await import("../lib/hoteles/calculadoraGrupos.ts");
const { payloadFilas } = await import("../lib/hoteles/alcanceGrupos.ts");
const G1 = "00000000-0000-4000-8000-0000000c0001", G2 = "00000000-0000-4000-8000-0000000c0002";
const huellaTarifas = () => sql("select md5(string_agg(to_jsonb(t)::text, E'\\n' order by t.id)) from public.tarifa_hotel t;");
const H0 = huellaTarifas();
const leerCalc = async (token = R.oper_may) => (await http(token, "GET", "/hotel_calculadora?hotel_id=eq.9301&select=tipo,params,version")).cuerpo[0];

// 1) Recorrido del editor: leer calculadora (la página ya la trae), revisar (1), confirmar (1), reabrir.
const calc = await leerCalc();
ok(calc && calc.tipo === "dubai" && calc.version === 1, `la calculadora trae su versión (v${calc?.version})`);
const bases = [{ categoria: "Estándar", precio: 120000, usarEdadesPropias: true, edadesPropias: { infanteMin: 0, infanteMax: 1, ninoMin: 2, ninoMax: 11 }, condicionesPropias: "Semana 2027" }];
const calculadas = calcularGrupo("dubai", calc.params, "ALTA", bases, false);
const cfg = (await una(R.oper_may, "grupos_dias_config", { p_temporada_id: 930101 })).cuerpo;
let rev = revisarCalculo(cfg, G1, "dubai", calculadas, DECISIONES_VACIAS);
ok(rev.pendientes.length > 0, `sin decisiones hay ${rev.pendientes.length} pendiente(s): no se confirma`);
let d = decidirTodas(rev, DECISIONES_VACIAS, "habilitar");
rev = revisarCalculo(cfg, G1, "dubai", calculadas, d);
d = { ...d, aplicar: Object.fromEntries(rev.combos.flatMap((c) => c.conflictos.filter((k) => k.obligatorio).map((k) => [k.clave, true]))) };
rev = revisarCalculo(cfg, G1, "dubai", calculadas, d);
ok(rev.pendientes.length === 0, "resueltas explícitamente las habilitaciones, edades y condición");
const g = await una(R.oper_may, "grupos_dias_guardar_calculadora", { p_temporada_id: 930101, p_huella: cfg.huella, p_grupo_id: G1, p_tipo: "dubai",
  p_calc_version: calc.version, p_bases_version: null, p_bases: bases, p_filas: payloadFilas(rev.filas) });
ok(g.status === 200 && g.cuerpo.bases_version === 1 && g.cuerpo.config, `guardado atómico (HTTP ${g.status}); la respuesta trae la configuración nueva (sin lectura extra)`);
const props = (g.cuerpo.config?.propuestas ?? []).filter((p) => p.grupo_id === G1);
const pam = props.find((p) => p.alimentacion === "PAM");
const esperado = calculadas.find((f) => f.alimentacion === "PAM");
ok(pam && Number(pam.neto_doble) === esperado.neto_doble && Number(pam.neto_triple) === esperado.neto_triple && pam.notas === "Semana 2027" && pam.edad_nino_max === 11,
  "Postgres guarda exactamente lo calculado, con la condición y las edades aceptadas");
ok(props.length === 2 && (g.cuerpo.config.propuestas ?? []).every((p) => p.grupo_id === G1 || p.grupo_id === G2), "solo el grupo pedido recibió filas");
const fs = (g.cuerpo.config.propuestas ?? []).find((p) => p.grupo_id === G2);
ok(fs && Number(fs.neto_doble) === 130000 && fs.notas === "Vista al mar", "el otro grupo quedó intacto (notas y edades incluidas)");
const basesLeidas = await http(R.oper_may, "GET", `/hotel_calculadora_grupo_bases?grupo_id=eq.${G1}&select=tipo,bases,version`);
ok(basesLeidas.status === 200 && claveBases(basesLeidas.cuerpo[0].bases) === claveBases(bases) && basesLeidas.cuerpo[0].version === 1, "las bases se reabren idénticas (mismo contenido; jsonb reordena las claves)");
ok(JSON.stringify(basesLeidas.cuerpo[0].bases) !== JSON.stringify(bases), "control: el orden de claves SÍ cambia, por eso se compara canónicamente");

// 2) Versión: cambia en cada escritura por la API; los escritores condicionados no pisan.
const v1 = (await leerCalc()).version;
const w1 = await http(R.oper_may, "PATCH", `/hotel_calculadora?hotel_id=eq.9301&version=eq.${v1}&select=version`, { params: calc.params }, { prefer: "return=representation" });
ok(w1.status === 200 && w1.cuerpo.length === 1 && w1.cuerpo[0].version === v1 + 1, `guardar la calculadora condicionado: pasa y la versión sube (v${v1} → v${w1.cuerpo[0]?.version})`);
const w1b = await http(R.oper_may, "PATCH", `/hotel_calculadora?hotel_id=eq.9301&version=eq.${v1}&select=version`, { params: calc.params }, { prefer: "return=representation" });
ok(w1b.status === 200 && Array.isArray(w1b.cuerpo) && w1b.cuerpo.length === 0, "con la versión vieja: 0 filas (la app pide recargar)");
const fijar = await http(R.oper_may, "PATCH", `/hotel_calculadora?hotel_id=eq.9301&select=version`, { version: 1 }, { prefer: "return=representation" });
ok(fijar.status === 200 && fijar.cuerpo[0].version === v1 + 2, "un cliente directo no puede fijar la versión: igual sube");
const vieja = await rpc(R.oper_may, "grupos_dias_guardar_calculadora", { p_temporada_id: 930101, p_huella: g.cuerpo.config.huella, p_grupo_id: G1, p_tipo: "dubai",
  p_calc_version: calc.version, p_bases_version: 1, p_bases: bases, p_filas: [] });
ok(vieja.status === 409 && vieja.cuerpo.code === "PT409" && /calculadora del hotel cambió/.test(vieja.cuerpo.message), `versión de la calculadora vieja ⇒ HTTP 409 PT409 (${vieja.status})`);
const basesViejas = await rpc(R.oper_may, "grupos_dias_guardar_calculadora", { p_temporada_id: 930101, p_huella: g.cuerpo.config.huella, p_grupo_id: G1, p_tipo: "dubai",
  p_calc_version: v1 + 2, p_bases_version: null, p_bases: bases, p_filas: [] });
ok(basesViejas.status === 409 && /bases de este grupo cambiaron/.test(basesViejas.cuerpo.message), "versión de las bases vieja ⇒ 409");

// 3) Permisos por rol
const args = { p_temporada_id: 930101, p_huella: g.cuerpo.config.huella, p_grupo_id: G1, p_tipo: "dubai", p_calc_version: v1 + 2, p_bases_version: 1, p_bases: bases, p_filas: [] };
const sup = await rpc(R.superadmin, "grupos_dias_guardar_calculadora", args);
ok(sup.status === 200 && sup.cuerpo.bases_version === 2, `superadmin (sesión Mayorista) guarda (HTTP ${sup.status})`);
const min = await rpc(R.oper_min, "grupos_dias_guardar_calculadora", { ...args, p_bases_version: 2 });
ok(min.status === 403 && min.cuerpo.code === "42501", `operaciones Minorista no escribe (HTTP ${min.status})`);
const ven = await rpc(R.venta, "grupos_dias_guardar_calculadora", { ...args, p_bases_version: 2 });
ok(ven.status === 403, `venta no escribe (HTTP ${ven.status})`);
const an = await rpc(R.anon, "grupos_dias_guardar_calculadora", { ...args, p_bases_version: 2 });
ok(an.status === 401 || an.status === 403, `anon no ejecuta (HTTP ${an.status})`);
const lv = await http(R.venta, "GET", "/hotel_calculadora_grupo_bases?select=id");
ok(lv.status === 200 && lv.cuerpo.length === 0, "venta no lee las bases");
const directo = await http(R.oper_may, "POST", "/hotel_calculadora_grupo_bases", { grupo_id: G2, tipo: "dubai", bases: [] });
ok(directo.status === 401 || directo.status === 403, `escribir las bases directo por la API: rechazado (HTTP ${directo.status})`);
const otro = await rpc(R.oper_may, "grupos_dias_guardar_calculadora", { ...args, p_bases_version: 2,
  p_filas: [{ grupo_id: G2, tipo_habitacion: "Estándar", alimentacion: "PAM", neto_doble: 1 }] });
ok(otro.status === 400 && /grupo solicitado/.test(otro.cuerpo.message), `fila de otro grupo ⇒ rechazada (HTTP ${otro.status})`);

// 4) Compra cerrada y borrado con bases (297)
const cerrada = await rpc(R.oper_may, "grupos_dias_guardar_calculadora", { p_temporada_id: 930109, p_huella: (await rpc(R.oper_may, "grupos_dias_config", { p_temporada_id: 930109 })).cuerpo.huella,
  p_grupo_id: "00000000-0000-4000-8000-0000000c0004", p_tipo: "dubai", p_calc_version: v1 + 2, p_bases_version: null, p_bases: bases,
  p_filas: [{ grupo_id: "00000000-0000-4000-8000-0000000c0004", tipo_habitacion: "Estándar", alimentacion: "PAM", neto_doble: 1 }] });
ok(cerrada.status === 400 && /compra cerrada/.test(cerrada.cuerpo.message) && sql("select count(*) from public.hotel_calculadora_grupo_bases where grupo_id = '00000000-0000-4000-8000-0000000c0004';") === "0",
  `vigencia con la compra cerrada ⇒ rechazada sin escrituras (HTTP ${cerrada.status})`);
const lect = await una(R.oper_may, "grupos_dias_config_bases", { p_temporada_id: 930101 });
const basesG1 = lect.cuerpo.bases.filter((b) => b.grupo_id === G1).map((b) => ({ tipo: b.tipo, version: b.version }));
ok(basesG1.length === 1 && basesG1[0].version === 2, `la lectura con bases trae las del grupo con su versión (v${basesG1[0]?.version})`);
const borraViejo = await rpc(R.oper_may, "grupos_dias_borrar_con_bases", { p_grupo_id: G1, p_huella: lect.cuerpo.huella, p_bases: [{ tipo: "dubai", version: 1 }] });
ok(borraViejo.status === 409 && /cambiaron desde que revisaste el borrado/.test(borraViejo.cuerpo.message)
   && sql(`select count(*) from public.hotel_temporada_grupos where id = '${G1}';`) === "1", `borrado con versión de bases vieja ⇒ 409 y nada se borra`);
const borra = await una(R.oper_may, "grupos_dias_borrar_con_bases", { p_grupo_id: G1, p_huella: lect.cuerpo.huella, p_bases: basesG1 });
ok(borra.status === 200 && borra.cuerpo.bases_eliminadas === 1 && borra.cuerpo.config.bases.every((b) => b.grupo_id !== G1), "borrado con las bases revisadas: borra y devuelve la configuración con bases");

ok(huellaTarifas() === H0, "tarifas vigentes intactas");
ok(sql("select count(*) from public.hotel_temporada_grupos where activo;") === "0", "ningún grupo activo");
console.log(`=== ${fallos} fallo(s); ${solicitudes} solicitud(es) HTTP`);
process.exit(fallos ? 1 : 0);
