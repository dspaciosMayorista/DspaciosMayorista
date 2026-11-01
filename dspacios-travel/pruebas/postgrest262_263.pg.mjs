// 262/263 por HTTP contra PostgREST local (lo lanza supabase/scripts/test_262_263_postgrest.sh). SOLO base local desechable.
import { createHmac } from "node:crypto";
import { execFileSync } from "node:child_process";

const { PG262_CONTENEDOR: CT, PG262_BASE: DB, PG262_POSTGREST: URL, PG262_JWT_SECRET: SECRETO } = process.env;
if (!CT || !DB || !URL || !SECRETO) throw new Error("Faltan variables: usa supabase/scripts/test_262_263_postgrest.sh");
const b64 = (s) => Buffer.from(s).toString("base64url");
const jwt = (p) => { const h = b64(JSON.stringify({ alg: "HS256", typ: "JWT" })), c = b64(JSON.stringify({ ...p, exp: Math.floor(Date.now() / 1000) + 3600 })); return `${h}.${c}.${createHmac("sha256", SECRETO).update(`${h}.${c}`).digest("base64url")}`; };
const sql = (q) => execFileSync("docker", ["exec", "-i", "-e", "PGPASSWORD=postgres", CT, "psql", "-h", "127.0.0.1", "-U", "supabase_admin", "-d", DB, "-X", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1"], { input: q, encoding: "utf8" }).trim();
const uid = (n) => `00000000-0000-0000-0000-0000002620${String(n).padStart(2, "0")}`;
const ROLES = { superadmin: 1, gerencia: 2, administracion: 3, operaciones: 4, venta: 5 };
const tok = (rol) => jwt({ role: "authenticated", sub: uid(ROLES[rol]) });
const ANON = jwt({ role: "anon" });

let ok = 0, mal = 0;
const check = (c, msg, extra = "") => { if (c) { ok++; console.log(`  OK    ${msg}`); } else { mal++; console.log(`  FALLA ${msg} ${extra}`); } };
async function http(metodo, ruta, token, cuerpo, extra = {}) {
  const r = await fetch(`${URL}${ruta}`, { method: metodo, headers: { "content-type": "application/json", prefer: "return=representation", ...(token ? { authorization: `Bearer ${token}` } : {}), ...extra }, body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo) });
  const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; }
  return { s: r.status, j, t };
}
const rpc = (tk, id, filas) => http("POST", "/rpc/reemplazar_precios_alcance", tk, { p_temporada_id: id, p_filas: filas });
const estado = (vig) => sql(`select coalesce(string_agg(alcance||':'||coalesce(pax_desde::text,'-')||'-'||coalesce(pax_hasta::text,'-')||'='||precio::bigint, ',' order by alcance, pax_desde nulls first, precio), '(vacío)') from public.servicio_precio_alcance where servicio_temporada_id=${vig}`);

// ── semilla ──
sql(`
 insert into auth.users (id, email) values ${Object.entries(ROLES).map(([r, n]) => `('${uid(n)}','${r}262@x.test')`).join(",")} on conflict do nothing;
 insert into public.usuarios (id, email, nombre, rol, activo, tenant) values ${Object.entries(ROLES).map(([r, n]) => `('${uid(n)}','${r}262@x.test','${r} 262','${r}',true,'mayorista')`).join(",")}
   on conflict (id) do update set rol=excluded.rol, activo=true, tenant=excluded.tenant;
 insert into public.proveedores (id, nombre) values (26201,'Prov 262') on conflict do nothing;
 insert into public.servicios_adicionales (id, nombre, proveedor_id, precio_persona, categoria, moneda, tipo_tarifa) values (26201,'Traslado 262',26201,0,'tour_traslado','COP','persona') on conflict do nothing;
 insert into public.servicio_temporadas (id, servicio_id, nombre, fecha_inicio, fecha_fin) values (26211,26201,'ALTA','2030-01-01','2030-12-31'),(26212,26201,'GENERAL',null,null),(26213,26201,'BAJA','2031-01-01','2031-06-30') on conflict do nothing;
`);
const V = 26211, VG = 26212, VB = 26213;
const A = [{ alcance: "trayecto", precio: 100000 }, { alcance: "ida_regreso", precio: 170000 }];
const B = [{ alcance: "trayecto", pax_desde: 1, pax_hasta: 4, precio: 90000 }, { alcance: "trayecto", pax_desde: 5, pax_hasta: 8, precio: 80000 }, { alcance: "ida_regreso", precio: 150000 }];
const EST_A = "ida_regreso:---=170000,trayecto:---=100000";
const EST_B = "ida_regreso:---=150000,trayecto:1-4=90000,trayecto:5-8=80000";

console.log("== anon ==");
let r = await rpc(ANON, V, A); check(r.s === 401 || r.s === 403 || r.s === 404, `anon no ejecuta la RPC (HTTP ${r.s})`, r.t);
r = await rpc(null, V, A); check(r.s === 401 || r.s === 403 || r.s === 404, `sin token no ejecuta la RPC (HTTP ${r.s})`, r.t);
r = await http("GET", "/servicio_precio_alcance", ANON); check(r.s === 401 || r.s === 403, `anon no lee la tabla (HTTP ${r.s})`, r.t);
r = await http("POST", "/servicio_precio_alcance", ANON, { servicio_temporada_id: V, alcance: "trayecto", precio: 1 }); check(r.s === 401 || r.s === 403, `anon no inserta (HTTP ${r.s})`, r.t);
r = await http("DELETE", "/servicio_precio_alcance?servicio_temporada_id=eq." + V, ANON); check(r.s === 401 || r.s === 403, `anon no borra (HTTP ${r.s})`);
check(estado(V) === "(vacío)", "tras los intentos anónimos la vigencia sigue vacía");

console.log("== roles permitidos guardan ==");
for (const rol of ["superadmin", "gerencia", "administracion", "operaciones"]) {
  r = await rpc(tok(rol), V, A); check(r.s === 200 && r.j === 2, `${rol}: guarda 2 filas (HTTP ${r.s} → ${r.t})`);
  check(estado(V) === EST_A, `${rol}: estado = configuración A`, estado(V));
}
console.log("== venta rechazado, configuración previa INTACTA ==");
r = await rpc(tok("venta"), V, B); check(r.s >= 400, `venta rechazado (HTTP ${r.s}) ${String(r.t).slice(0, 120)}`);
check(estado(V) === EST_A, "tras el rechazo de venta la configuración A queda intacta", estado(V));
r = await http("GET", "/servicio_precio_alcance?servicio_temporada_id=eq." + V, tok("venta")); check(r.s === 200 && Array.isArray(r.j) && r.j.length === 0, "venta no ve filas por RLS", r.t);
r = await http("POST", "/servicio_precio_alcance", tok("venta"), { servicio_temporada_id: V, alcance: "trayecto", pax_desde: 1, pax_hasta: 2, precio: 1 }); check(r.s >= 400, `venta no inserta directo (HTTP ${r.s})`);
r = await http("DELETE", "/servicio_precio_alcance?servicio_temporada_id=eq." + V, tok("venta")); check(estado(V) === EST_A, `venta no borra directo (HTTP ${r.s}); A intacta`);

console.log("== GENERAL, vigencia inexistente, entradas inválidas ==");
r = await rpc(tok("superadmin"), VG, A); check(r.s >= 400 && /GENERAL/.test(r.t), `GENERAL rechazada (HTTP ${r.s})`, r.t);
check(estado(VG) === "(vacío)", "GENERAL queda sin filas");
r = await rpc(tok("superadmin"), 99999999, A); check(r.s >= 400, `vigencia inexistente rechazada (HTTP ${r.s})`);
r = await http("POST", "/rpc/reemplazar_precios_alcance", tok("superadmin"), { p_temporada_id: V, p_filas: { x: 1 } }); check(r.s >= 400, `filas no-lista rechazadas (HTTP ${r.s})`);
check(estado(V) === EST_A, "A intacta tras entradas inválidas");

console.log("== fallo INTERMEDIO (3ª fila inválida) ==");
for (const [nom, tercera] of [["alcance ajeno", { alcance: "mitad", precio: 5 }], ["precio negativo", { alcance: "ida_regreso", precio: -1 }], ["rango incompleto", { alcance: "trayecto", pax_desde: 9, precio: 5 }], ["rango invertido", { alcance: "trayecto", pax_desde: 9, pax_hasta: 3, precio: 5 }], ["alcance nulo", { precio: 5 }]]) {
  r = await rpc(tok("operaciones"), V, [{ alcance: "trayecto", pax_desde: 1, pax_hasta: 4, precio: 1 }, { alcance: "trayecto", pax_desde: 5, pax_hasta: 8, precio: 2 }, tercera]);
  check(r.s >= 400, `${nom}: rechazado (HTTP ${r.s})`, r.t); check(estado(V) === EST_A, `${nom}: configuración anterior ÍNTEGRA`, estado(V));
}
console.log("== rangos cruzados / dos precios por persona ==");
r = await rpc(tok("operaciones"), V, [{ alcance: "trayecto", pax_desde: 1, pax_hasta: 5, precio: 1 }, { alcance: "trayecto", pax_desde: 5, pax_hasta: 8, precio: 2 }]);
check(r.s >= 400 && /cruza/.test(r.t), `rangos cruzados rechazados (HTTP ${r.s})`, r.t); check(estado(V) === EST_A, "A intacta tras rangos cruzados");
r = await rpc(tok("operaciones"), V, [{ alcance: "trayecto", precio: 1 }, { alcance: "trayecto", precio: 2 }]);
check(r.s >= 400, `dos precios por persona del mismo alcance rechazados (HTTP ${r.s})`, r.t); check(estado(V) === EST_A, "A intacta tras dos precios por persona");
r = await rpc(tok("operaciones"), V, [{ alcance: "trayecto", pax_desde: 1, pax_hasta: 5, precio: 1 }, { alcance: "ida_regreso", pax_desde: 3, pax_hasta: 8, precio: 2 }]);
check(r.s === 200, `mismos rangos en alcances DISTINTOS no se cruzan (HTTP ${r.s})`, r.t);
r = await rpc(tok("operaciones"), V, B); check(r.s === 200 && r.j === 3, "rangos contiguos y sin cruce aceptados (config B)"); check(estado(V) === EST_B, "estado = B", estado(V));

console.log("== idempotencia ==");
r = await rpc(tok("operaciones"), V, B); check(r.s === 200 && r.j === 3 && estado(V) === EST_B, "repetir B deja exactamente B (3 filas)");
check(sql(`select count(*) from public.servicio_precio_alcance where servicio_temporada_id=${V}`) === "3", "sin filas duplicadas");
r = await rpc(tok("operaciones"), V, []); check(r.s === 200 && r.j === 0 && estado(V) === "(vacío)", "lista vacía limpia la vigencia (0 filas)");
r = await rpc(tok("operaciones"), V, B);

console.log("== concurrencia (misma vigencia, 8 llamadas simultáneas A/B) ==");
for (let ronda = 1; ronda <= 3; ronda++) {
  const res = await Promise.all(Array.from({ length: 8 }, (_, i) => rpc(tok("operaciones"), V, i % 2 ? A : B)));
  const e = estado(V);
  check(res.every((x) => x.s === 200), `ronda ${ronda}: las 8 respondieron 200 (${res.map((x) => x.s).join(",")})`, res.find((x) => x.s !== 200)?.t);
  check(e === EST_A || e === EST_B, `ronda ${ronda}: resultado = exactamente A o B, sin mezcla`, e);
  check(sql(`select count(*) from public.servicio_precio_alcance where servicio_temporada_id=${V}`) === (e === EST_A ? "2" : "3"), `ronda ${ronda}: número de filas coherente`);
}
console.log("== concurrencia con una invalida (vs válida) ==");
{
  const mala = [{ alcance: "trayecto", pax_desde: 1, pax_hasta: 4, precio: 1 }, { alcance: "trayecto", pax_desde: 3, pax_hasta: 6, precio: 2 }];
  const res = await Promise.all([rpc(tok("operaciones"), V, A), rpc(tok("gerencia"), V, mala), rpc(tok("operaciones"), V, B), rpc(tok("administracion"), V, mala)]);
  const e = estado(V);
  check(res[1].s >= 400 && res[3].s >= 400, "las inválidas fallan", res.map((x) => x.s).join(","));
  check(e === EST_A || e === EST_B, "el estado final es A o B (nunca la inválida ni vacío)", e);
}

console.log("== franjas: pax_desde/pax_hasta ==");
const F = (o) => http("POST", "/servicio_suplementos_franja", tok("operaciones"), { servicio_temporada_id: V, hora_desde: "19:00", hora_hasta: "06:00", tramo: "llegada", tipo: "monto", cobro: "grupo", ...o });
r = await F({ valor: 45000, pax_desde: 1, pax_hasta: 4 }); check(r.s === 201, `franja 1-4 insertada (HTTP ${r.s})`, r.t);
r = await F({ valor: 80000, pax_desde: 5, pax_hasta: 12 }); check(r.s === 201, `franja 5-12 contigua aceptada (HTTP ${r.s})`, r.t);
r = await F({ valor: 1, pax_desde: 4, pax_hasta: 6 }); check(r.s >= 400, `franja 4-6 se cruza con 1-4 y 5-12: rechazada (HTTP ${r.s})`, r.t);
r = await F({ valor: 1 }); check(r.s >= 400, `franja sin rango (todos) se cruza con las anteriores: rechazada (HTTP ${r.s})`, r.t);
r = await F({ valor: 1, pax_desde: 13, pax_hasta: 20 }); check(r.s === 201, `franja 13-20 contigua aceptada (HTTP ${r.s})`, r.t);
r = await F({ valor: 7, pax_desde: 1, pax_hasta: 4, tramo: "salida" }); check(r.s === 201, `mismo rango y hora en OTRO tramo (salida) aceptado (HTTP ${r.s})`, r.t);
r = await F({ valor: 7, pax_desde: 1, pax_hasta: 4, hora_desde: "08:00", hora_hasta: "10:00" }); check(r.s === 201, `mismo rango en OTRA hora (sin solape horario) aceptado (HTTP ${r.s})`, r.t);
r = await F({ valor: 7, pax_desde: 3 }); check(r.s >= 400, `rango incompleto (solo desde) rechazado por CHECK (HTTP ${r.s})`, r.t);
r = await F({ valor: 7, pax_desde: 0, pax_hasta: 3 }); check(r.s >= 400, `pax_desde=0 rechazado (HTTP ${r.s})`);
r = await F({ valor: 7, pax_desde: 9, pax_hasta: 3 }); check(r.s >= 400, `rango invertido rechazado (HTTP ${r.s})`);
r = await http("POST", "/servicio_suplementos_franja", tok("venta"), { servicio_temporada_id: V, hora_desde: "01:00", hora_hasta: "02:00", tramo: "llegada", tipo: "monto", cobro: "grupo", valor: 1 }); check(r.s >= 400, `venta no inserta franjas (HTTP ${r.s})`);
check(sql(`select count(*) from public.servicio_suplementos_franja where servicio_temporada_id=${V}`) === "5", "quedaron exactamente 5 franjas válidas");

console.log("== permisos efectivos (catálogo) ==");
const priv = (rol, obj) => sql(`select coalesce(string_agg(p, ',' order by p),'(nada)') from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p where has_table_privilege('${rol}','${obj}',p)`);
check(priv("authenticated", "public.servicio_precio_alcance") === "DELETE,INSERT,SELECT,UPDATE", "authenticated: solo SELECT/INSERT/UPDATE/DELETE", priv("authenticated", "public.servicio_precio_alcance"));
check(priv("anon", "public.servicio_precio_alcance") === "(nada)", "anon: sin ningún permiso de tabla", priv("anon", "public.servicio_precio_alcance"));
const fx = (rol) => sql(`select has_function_privilege('${rol}','public.reemplazar_precios_alcance(bigint,jsonb)','execute')`);
check(fx("anon") === "f" && fx("authenticated") === "t", `EXECUTE de la RPC: anon=${fx("anon")} authenticated=${fx("authenticated")}`);
check(sql(`select prosecdef from pg_proc where oid='public.reemplazar_precios_alcance(bigint,jsonb)'::regprocedure`) === "f", "la RPC es SECURITY INVOKER");
r = await http("POST", "/rpc/tg_servicio_precio_alcance_solape", tok("superadmin"), {}); check(r.s >= 400, `la función de trigger no se expone como RPC (HTTP ${r.s})`);
r = await http("GET", "/servicio_precio_alcance", tok("superadmin")); check(r.s === 200, "superadmin lee la tabla (HTTP 200)");

console.log(`\nRESULTADO postgrest262_263: ${ok} correctas, ${mal} fallas`);
process.exit(mal ? 1 : 0);
