// #43/#60 entrega 3b — COMPATIBILIDAD DE DESPLIEGUE de la 297 por HTTP contra PostgREST local (lo lanza
// supabase/scripts/test_297_compatibilidad.sh). Con tres calculadoras ya existentes (Dubai, Mixta, Corporativa):
//   A) código ANTERIOR antes de la 297 (línea base);
//   B) se aplica la 297 (preflight → 297 → postcheck: params intactos, todas en versión 1);
//   C) código ANTERIOR después de la 297: lee y guarda igual que antes (y su escritura ahora sube la versión);
//   D) código NUEVO: lectura con versión, escritura condicionada (pasa / 0 filas), RPC de grupo, borrado con bases.
// Las peticiones del código anterior reproducen exactamente lo que enviaba supabase-js en esas acciones.
import { createHmac } from "node:crypto";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

const URL = process.env.T297_URL, SECRETO = process.env.T297_SECRETO, SQL = process.env.T297_SQL;
const b64 = (s) => Buffer.from(s).toString("base64url");
const jwt = (p) => {
  const h = b64(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const c = b64(JSON.stringify({ ...p, exp: Math.floor(Date.now() / 1000) + 3600 }));
  return `${h}.${c}.${createHmac("sha256", SECRETO).update(`${h}.${c}`).digest("base64url")}`;
};
const OPER = jwt({ role: "authenticated", sub: "00000000-0000-4000-8000-000000009302", session_id: "00000000-0000-4000-8000-00000000a302" });
const sql = (q) => execSync(SQL, { input: q, encoding: "utf8" }).trim();
let fallos = 0;
const ok = (c, m) => { if (c) console.log(`OK    ${m}`); else { fallos++; console.log(`FALLO ${m}`); } };
async function http(metodo, ruta, cuerpo, extra = {}) {
  const r = await fetch(`${URL}${ruta}`, { method: metodo, headers: { "content-type": "application/json", authorization: `Bearer ${OPER}`, ...extra }, body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo) });
  const t = await r.text();
  let c; try { c = JSON.parse(t); } catch { c = t; }
  return { status: r.status, cuerpo: c };
}
const params = (h) => sql(`select params::text from public.hotel_calculadora where hotel_id = ${h};`);
const version = (h) => sql(`select version from public.hotel_calculadora where hotel_id = ${h};`);
const HOTELES = { dubai: 9301, mixta: 9303, corporativa: 9304 };

// Lo que hacía el código anterior en cada acción (supabase-js):
const viejo = {
  // page.tsx: .from("hotel_calculadora").select("tipo, params").eq("hotel_id", id).maybeSingle()
  leer: (h) => http("GET", `/hotel_calculadora?select=tipo,params&hotel_id=eq.${h}`, undefined, { accept: "application/vnd.pgrst.object+json" }),
  // guardarCalculadora: .upsert({ hotel_id, tipo, params, updated_at }, { onConflict: "hotel_id" })
  guardar: (h, tipo, p) => http("POST", "/hotel_calculadora?on_conflict=hotel_id", { hotel_id: h, tipo, params: p, updated_at: new Date().toISOString() },
    { prefer: "resolution=merge-duplicates,return=minimal" }),
  // renombrarTemporadaEnDatos: .update({ params, updated_at }).eq("hotel_id", id)
  renombrar: (h, p) => http("PATCH", `/hotel_calculadora?hotel_id=eq.${h}`, { params: p, updated_at: new Date().toISOString() }, { prefer: "return=minimal" }),
};

// ── A) Código anterior ANTES de la 297 ───────────────────────────────────────────────
const original = Object.fromEntries(Object.entries(HOTELES).map(([t, h]) => [t, params(h)]));
for (const [tipo, h] of Object.entries(HOTELES)) {
  const r = await viejo.leer(h);
  ok(r.status === 200 && r.cuerpo.tipo === tipo && JSON.stringify(r.cuerpo.params) === JSON.stringify(JSON.parse(original[tipo])), `A ${tipo}: el código anterior lee la calculadora (línea base)`);
}
ok(sql("select count(*) from information_schema.columns where table_name = 'hotel_calculadora' and column_name = 'version';") === "0", "A sin columna version todavía");

// ── B) Preflight → 297 → postcheck ───────────────────────────────────────────────────
const fila = (salida, n) => salida.split("\n").map((l) => l.split("|")).find((c) => c[0] === String(n));
const pre = sql(readFileSync("supabase/scripts/preflight_297_calculadora_grupos_dias.sql", "utf8"));
ok([1, 2, 3, 4, 5, 6, 7, 8].every((n) => fila(pre, n)?.[4] === "OK"), "B preflight: controles 1–8 en OK");
ok(fila(pre, 12)?.[2] === "3", `B el preflight ve las 3 calculadoras existentes (${fila(pre, 12)?.[2]})`);
sql(readFileSync("supabase/migrations/20260601000297_calculadora_grupos_dias.sql", "utf8"));
const post = sql(readFileSync("supabase/scripts/postcheck_297_calculadora_grupos_dias.sql", "utf8"));
ok([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].every((n) => fila(post, n)?.[4] === "OK"), "B postcheck: controles 1–11 en OK (todas en versión 1)");
ok(fila(post, 12)?.[2] === fila(pre, 9)?.[2] && fila(post, 15)?.[2] === "3", "B huella de calculadoras (id, hotel, tipo, params) idéntica antes y después");
for (const [tipo, h] of Object.entries(HOTELES)) ok(params(h) === original[tipo] && version(h) === "1", `B ${tipo}: params byte a byte iguales y versión 1`);
sql("notify pgrst, 'reload schema';");
for (let i = 0; i < 20; i++) { if ((await http("GET", "/hotel_calculadora?select=version&limit=1")).status === 200) break; await new Promise((r) => setTimeout(r, 300)); }

// ── C) Código anterior DESPUÉS de la 297 ─────────────────────────────────────────────
for (const [tipo, h] of Object.entries(HOTELES)) {
  const r = await viejo.leer(h);
  ok(r.status === 200 && JSON.stringify(r.cuerpo.params) === JSON.stringify(JSON.parse(original[tipo])), `C ${tipo}: el código anterior sigue leyendo igual`);
  const p = { ...JSON.parse(original[tipo]), infante_nota: `cambio ${tipo}` };
  const g = await viejo.guardar(h, tipo, p);
  ok(g.status === 201 || g.status === 200 || g.status === 204, `C ${tipo}: el código anterior sigue guardando (upsert, HTTP ${g.status})`);
  ok(JSON.parse(params(h)).infante_nota === `cambio ${tipo}` && version(h) === "2", `C ${tipo}: lo guardado quedó y la versión subió (v${version(h)}) aunque el código anterior no la conoce`);
}
const ren = await viejo.renombrar(9301, JSON.parse(params(9301)));
ok(ren.status === 204 && version(9301) === "3", `C la cascada de renombre del código anterior sigue escribiendo (HTTP ${ren.status}, v${version(9301)})`);
const insNuevo = await viejo.guardar(9302, "dubai", { bases: [] });
ok((insNuevo.status === 201 || insNuevo.status === 200) && version(9302) === "1", "C el código anterior crea una calculadora nueva: nace en versión 1");
const cfgViejo = await http("POST", "/rpc/grupos_dias_config", { p_temporada_id: 930101 });
ok(cfgViejo.status === 200 && cfgViejo.cuerpo.huella, "C el panel de grupos anterior (grupos_dias_config de la 295) sigue funcionando");

// ── D) Código nuevo ──────────────────────────────────────────────────────────────────
for (const [tipo, h] of Object.entries(HOTELES)) {
  const leido = (await http("GET", `/hotel_calculadora?select=tipo,params,version&hotel_id=eq.${h}`, undefined, { accept: "application/vnd.pgrst.object+json" })).cuerpo;
  const pasa = await http("PATCH", `/hotel_calculadora?hotel_id=eq.${h}&version=eq.${leido.version}&select=version`, { tipo, params: leido.params }, { prefer: "return=representation" });
  ok(pasa.status === 200 && pasa.cuerpo.length === 1 && pasa.cuerpo[0].version === leido.version + 1, `D ${tipo}: guardar condicionado con la versión leída pasa (v${leido.version} → v${pasa.cuerpo[0]?.version})`);
  const vieja = await http("PATCH", `/hotel_calculadora?hotel_id=eq.${h}&version=eq.${leido.version}&select=version`, { tipo, params: leido.params }, { prefer: "return=representation" });
  ok(vieja.status === 200 && vieja.cuerpo.length === 0, `D ${tipo}: con la versión vieja, 0 filas (pide recargar)`);
  ok(JSON.stringify(JSON.parse(params(h))) === JSON.stringify(leido.params), `D ${tipo}: los params no cambiaron por el guardado rechazado`);
}
// Un grupo, su cálculo por la RPC y su borrado con las bases revisadas.
const cfg0 = (await http("POST", "/rpc/grupos_dias_config_bases", { p_temporada_id: 930101 })).cuerpo;
const g = await http("POST", "/rpc/grupos_dias_guardar", { p_temporada_id: 930101, p_huella: cfg0.huella, p_grupos: [{ nombre: "Fin de semana", dias: [5, 6, 7] }] });
const grupo = g.cuerpo.config.grupos[0].id;
const v = Number(version(9301));
const guardado = await http("POST", "/rpc/grupos_dias_guardar_calculadora", { p_temporada_id: 930101, p_huella: g.cuerpo.config.huella, p_grupo_id: grupo, p_tipo: "dubai",
  p_calc_version: v, p_bases_version: null, p_bases: [{ categoria: "Estándar", precio: 120000 }],
  p_filas: [{ grupo_id: grupo, tipo_habitacion: "Estándar", alimentacion: "PAM", neto_doble: 120000 }] });
ok(guardado.status === 200 && guardado.cuerpo.bases_version === 1 && version(9301) === String(v), "D la RPC del grupo guarda con la versión de la calculadora (y no la cambia)");
const cfg1 = (await http("POST", "/rpc/grupos_dias_config_bases", { p_temporada_id: 930101 })).cuerpo;
ok(cfg1.bases?.length === 1 && cfg1.bases[0].grupo_id === grupo && cfg1.bases[0].version === 1, "D la lectura con bases las muestra con su versión");
const viejoBorra = await http("POST", "/rpc/grupos_dias_borrar", { p_grupo_id: grupo, p_huella: cfg1.huella });
ok(viejoBorra.status === 409 && viejoBorra.cuerpo.code === "23503" && sql(`select count(*) from public.hotel_calculadora_grupo_bases where grupo_id = '${grupo}';`) === "1",
  `D el borrado ANTERIOR (295) no puede llevarse las bases: rechazado (HTTP ${viejoBorra.status} ${viejoBorra.cuerpo.code}), nada se borra`);
const borra = await http("POST", "/rpc/grupos_dias_borrar_con_bases", { p_grupo_id: grupo, p_huella: cfg1.huella, p_bases: [{ tipo: "dubai", version: 1 }] });
ok(borra.status === 200 && borra.cuerpo.bases_eliminadas === 1, "D el borrado nuevo con las bases revisadas borra grupo, propuesta y bases");
for (const [tipo, h] of Object.entries(HOTELES)) {
  const p = JSON.parse(params(h)), o = JSON.parse(original[tipo]);
  ok(JSON.stringify({ ...p, infante_nota: o.infante_nota }) === JSON.stringify(o), `D ${tipo}: todas las opciones originales siguen en los params (solo cambió lo que la prueba guardó)`);
}
console.log(`=== ${fallos} fallo(s)`);
process.exit(fallos ? 1 : 0);
