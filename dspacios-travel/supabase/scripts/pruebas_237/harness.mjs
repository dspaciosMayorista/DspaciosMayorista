// Pruebas de la frontera D8/D9 (migración 237) contra un Supabase LOCAL en Docker.
// Ejecuta sesiones REALES (GoTrue + PostgREST), no simulaciones de claims.
//
// Uso (desde dspacios-travel/):
//   API_URL=http://127.0.0.1:54321 ANON_KEY=... SERVICE_ROLE_KEY=... \
//   PSQL_CONTAINER=supabase_db_d5d8local node supabase/scripts/pruebas_237/harness.mjs
//
// CANDADO: se niega a correr si la URL no es loopback o el contenedor no empieza por
// `supabase_db_`. Crea usuarios sintéticos `t237+...@example.test` y filas con prefijo
// `T237`; no toca nada más. NUNCA apuntarlo a un proyecto alojado.
import { execFileSync } from "node:child_process";

const API = process.env.API_URL ?? "http://127.0.0.1:54321";
const ANON = process.env.ANON_KEY;
const SERVICE = process.env.SERVICE_ROLE_KEY;
const CT = process.env.PSQL_CONTAINER ?? "supabase_db_d5d8local";
if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(API)) throw new Error("CANDADO: API_URL no es loopback");
if (!/^supabase_db_[a-z0-9_]+$/.test(CT)) throw new Error("CANDADO: contenedor no válido");
if (!ANON || !SERVICE) throw new Error("Faltan ANON_KEY / SERVICE_ROLE_KEY");

// Mismo arreglo que public.catalogos_globales_registro() (la prueba V12.1 comprueba que coinciden).
const REGISTRO = ["aliados", "asesores", "formas_pago", "rangos_edad", "parametros_tributarios", "destinos", "hoteles", "hotel_acomodaciones", "hotel_blackouts", "hotel_calculadora", "hotel_categorias", "hotel_documentos", "hotel_fotos", "hotel_regimenes", "hotel_temporadas", "hotel_tarifas_unidad", "tarifa_hotel", "categorias_habitacion", "planes_alimentacion", "aerolineas", "aerolinea_tarifas", "proveedores", "proveedores_datos_sensibles", "servicios_adicionales", "servicio_tarifa_pax", "servicio_temporadas"];
const resultados = [];
function reg(id, desc, esperado, observado) {
  const estado = esperado === observado ? "PASA" : "FALLA";
  resultados.push({ id, desc, esperado, observado, estado });
  console.log(`${estado.padEnd(5)} ${id.padEnd(5)} ${desc} | esperado=${esperado} observado=${observado}`);
}

function sql(q) {
  return execFileSync("docker", ["exec", "-i", CT, "psql", "-U", "postgres", "-X", "-q", "-At", "-v", "ON_ERROR_STOP=1", "-c", q], { encoding: "utf8" }).trim();
}
const jwtPayload = (t) => JSON.parse(Buffer.from(t.split(".")[1], "base64url").toString());

async function http(method, path, { token, key = ANON, body, headers = {} } = {}) {
  const r = await fetch(`${API}${path}`, {
    method,
    headers: { apikey: key, "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  const txt = await r.text();
  try { json = txt ? JSON.parse(txt) : null; } catch { json = txt; }
  return { status: r.status, json };
}

const PASS = "T237-clave-sintetica-1";
const tag = Date.now().toString(36);
const usuarios = {};

async function crearUsuario(clave, rol, tenant) {
  const email = `t237+${clave}.${tag}@example.test`;
  const r = await http("POST", "/auth/v1/admin/users", { key: SERVICE, token: SERVICE, body: { email, password: PASS, email_confirm: true } });
  if (r.status >= 300) throw new Error(`crearUsuario ${clave}: ${r.status}`);
  const id = r.json.id;
  sql(`insert into public.usuarios (id, email, nombre, rol, tenant, activo) values ('${id}', '${email}', 'T237 ${clave}', '${rol}', '${tenant}', true) on conflict (id) do update set rol = excluded.rol, tenant = excluded.tenant, activo = true`);
  usuarios[clave] = { id, email };
}
async function login(clave) {
  const r = await http("POST", "/auth/v1/token?grant_type=password", { body: { email: usuarios[clave].email, password: PASS } });
  if (r.status !== 200) throw new Error(`login ${clave}: ${r.status}`);
  return { access: r.json.access_token, refresh: r.json.refresh_token, sid: jwtPayload(r.json.access_token).session_id };
}
const iniciar = (sid, tenant) => http("POST", "/rest/v1/rpc/iniciar_contexto_agencia", { key: SERVICE, token: SERVICE, body: { p_session: sid, p_tenant: tenant } });
const cambiar = (sid, tenant) => http("POST", "/rest/v1/rpc/cambiar_contexto_agencia", { key: SERVICE, token: SERVICE, body: { p_session: sid, p_tenant: tenant } });
const codigo = (r) => (r.status < 300 ? "ok" : (r.json?.message ?? r.json?.code ?? String(r.status)));

// Intento de INSERT en aliados con la sesión del usuario: "ok" | "rls" (42501) | otro.
let n = 0;
async function insertarAliado(token) {
  const r = await http("POST", "/rest/v1/aliados", { token, headers: { Prefer: "return=representation" }, body: { nombre: `T237 aliado ${tag}-${++n}`, tipo: "agencia" } });
  if (r.status < 300) return "ok";
  return r.json?.code === "42501" ? "rls" : `otro:${r.status}:${r.json?.code}`;
}
async function insertarDestino(token) {
  const r = await http("POST", "/rest/v1/destinos", { token, body: { nombre: `T237 destino ${tag}-${++n}` } });
  if (r.status < 300) return "ok";
  return r.json?.code === "42501" ? "rls" : `otro:${r.status}:${r.json?.code}`;
}
async function actualizarFormaPago(token, id) {
  const r = await http("PATCH", `/rest/v1/formas_pago?id=eq.${id}`, { token, headers: { Prefer: "return=representation" }, body: { nombre: `T237 fp ${tag}-${++n}` } });
  if (r.status >= 300) return `otro:${r.status}`;
  return Array.isArray(r.json) && r.json.length === 1 ? "ok" : "0filas";
}
async function borrarFormaPago(token, id) {
  const r = await http("DELETE", `/rest/v1/formas_pago?id=eq.${id}`, { token, headers: { Prefer: "return=representation" } });
  if (r.status >= 300) return `otro:${r.status}`;
  return Array.isArray(r.json) && r.json.length === 1 ? "ok" : "0filas";
}
async function guardarProveedor(token, id = null) {
  const r = await http("POST", "/rest/v1/rpc/guardar_proveedor", { token, body: { p_proveedor: { nombre: `T237 prov ${tag}-${++n}`, tipo: "hotelero", nit: "900T237", numero_cuenta: "123456" }, p_id: id } });
  if (r.status < 300) return { estado: "ok", id: r.json };
  return { estado: r.json?.code === "42501" ? "rls" : `otro:${r.status}:${r.json?.code}` };
}

async function main() {
  // ── Datos de apoyo ───────────────────────────────────────────────────────
  sql(`insert into public.formas_pago (nombre) values ('T237 fp semilla A'), ('T237 fp semilla B') on conflict do nothing`);
  const fpA = sql(`select id from public.formas_pago where nombre = 'T237 fp semilla A'`);
  const fpB = sql(`select id from public.formas_pago where nombre = 'T237 fp semilla B'`);

  for (const [c, r, t] of [
    ["sa", "superadmin", "mayorista"], ["sa2", "superadmin", "mayorista"],
    ["adm_may", "administracion", "mayorista"], ["adm_min", "administracion", "minorista"],
    ["ops_may", "operaciones", "mayorista"], ["ops_min", "operaciones", "minorista"],
    ["ven_may", "venta", "mayorista"], ["ven_min", "venta", "minorista"],
    ["ger_min", "gerencia", "minorista"], ["promo", "administracion", "mayorista"],
    ["inact", "administracion", "mayorista"], ["agenc", "agencia", "mayorista"],
  ]) await crearUsuario(c, r, t);

  // ── SNAPSHOT DE LECTURA (SNAPSHOT=archivo.json) ───────────────────────────
  // Cuenta las filas que cada actor VE en cada catálogo del registro. Se corre con
  // la 237 revertida y con la 237 aplicada y se comparan: la lectura (selectores,
  // uso en hoteles/servicios/CxP/vouchers) no debe cambiar en nada.
  if (process.env.SNAPSHOT) {
    sql(`insert into public.asesores (nombre) select 'T237S asesor' where not exists (select 1 from public.asesores where nombre = 'T237S asesor')`);
    sql(`insert into public.rangos_edad (denominacion) select 'T237S rango' where not exists (select 1 from public.rangos_edad where denominacion = 'T237S rango')`);
    sql(`insert into public.destinos (nombre) select 'T237S destino' where not exists (select 1 from public.destinos where nombre = 'T237S destino')`);
    sql(`insert into public.aliados (nombre, tipo) select 'T237S aliado', 'agencia' where not exists (select 1 from public.aliados where nombre = 'T237S aliado')`);
    sql(`insert into public.hoteles (destino_id, nombre) select d.id, 'T237S hotel' from public.destinos d where d.nombre = 'T237S destino' and not exists (select 1 from public.hoteles where nombre = 'T237S hotel')`);
    sql(`insert into public.hotel_temporadas (hotel_id, nombre) select h.id, 'T237S temp' from public.hoteles h where h.nombre = 'T237S hotel' and not exists (select 1 from public.hotel_temporadas where nombre = 'T237S temp')`);
    sql(`insert into public.aerolineas (nombre) select 'T237S aerolinea' where not exists (select 1 from public.aerolineas where nombre = 'T237S aerolinea')`);
    sql(`insert into public.aerolinea_tarifas (aerolinea_id, nombre, descripcion) select a.id, 'T237S tarifa', 'x' from public.aerolineas a where a.nombre = 'T237S aerolinea' and not exists (select 1 from public.aerolinea_tarifas where nombre = 'T237S tarifa')`);
    sql(`insert into public.servicios_adicionales (nombre) select 'T237S servicio' where not exists (select 1 from public.servicios_adicionales where nombre = 'T237S servicio')`);
    sql(`insert into public.proveedores (tipo, nombre) select 'hotelero', 'T237S prov' where not exists (select 1 from public.proveedores where nombre = 'T237S prov')`);
    sql(`insert into public.proveedores_datos_sensibles (proveedor_id, tenant, nit) select p.id, 'mayorista', '900T237S' from public.proveedores p where p.nombre = 'T237S prov' and not exists (select 1 from public.proveedores_datos_sensibles s where s.proveedor_id = p.id)`);
    const registro = REGISTRO;
    const snap = {};
    for (const [c, r, t] of [["sa", "superadmin", "mayorista"], ["adm_may", "administracion", "mayorista"], ["adm_min", "administracion", "minorista"], ["ops_may", "operaciones", "mayorista"], ["ops_min", "operaciones", "minorista"], ["ven_may", "venta", "mayorista"], ["ven_min", "venta", "minorista"], ["ger_min", "gerencia", "minorista"], ["cv_may", "control_vuelo", "mayorista"], ["agenc", "agencia", "mayorista"]]) {
      if (!usuarios[c]) await crearUsuario(c, r, t);
      const s = await login(c);
      snap[`${c}(${r}/${t})`] = {};
      for (const tabla of registro) {
        const r2 = await fetch(`${API}/rest/v1/${tabla}?select=*`, { method: "HEAD", headers: { apikey: ANON, Authorization: `Bearer ${s.access}`, Prefer: "count=exact", Range: "0-0" } });
        snap[`${c}(${r}/${t})`][tabla] = (r2.headers.get("content-range") ?? `status${r2.status}`).split("/").pop();
      }
    }
    const { writeFileSync } = await import("node:fs");
    const orden = (o) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, v && typeof v === "object" ? orden(v) : v]));
    writeFileSync(process.env.SNAPSHOT, JSON.stringify(orden(snap), null, 1));
    console.log(`snapshot escrito: ${Object.keys(snap).length} actores x ${registro.length} catalogos`);
    return;
  }

  // ── CONTROL NEGATIVO (CONTROL_SIN_237=1, con la 237 revertida) ────────────
  // Demuestra que el hueco existía: sin la 237, un Minorista con perfil de rol
  // administrativo NO se distingue por agencia activa y el superadmin escribe en cualquier caso.
  if (process.env.CONTROL_SIN_237 === "1") {
    const c = await login("sa");
    console.log("CONTROL sin 237 | superadmin (perfil Mayorista) escribe aliados sin contexto de agencia:", await insertarAliado(c.access));
    const cm = await login("adm_min");
    console.log("CONTROL sin 237 | administracion Minorista escribe aliados:", await insertarAliado(cm.access));
    const cd = await login("ops_min");
    console.log("CONTROL sin 237 | operaciones Minorista escribe destinos:", await insertarDestino(cd.access));
    return;
  }

  // ── V1 Superadmin: contexto por sesión ───────────────────────────────────
  const sa = await login("sa");
  reg("V1.1", "superadmin sin contexto NO escribe catálogos (falla cerrado, no se reinicializa solo)", "rls", await insertarAliado(sa.access));
  reg("V1.2", "iniciar contexto mayorista (service_role, sesión recién creada)", "ok", codigo(await iniciar(sa.sid, "mayorista")));
  reg("V1.3", "superadmin en Mayorista escribe aliados (D9)", "ok", await insertarAliado(sa.access));
  reg("V1.4", "superadmin en Mayorista escribe destinos (D8)", "ok", await insertarDestino(sa.access));
  reg("V1.5", "cambiar a Minorista", "ok", codigo(await cambiar(sa.sid, "minorista")));
  reg("V1.6", "superadmin en Minorista NO crea aliados (aunque su perfil es Mayorista)", "rls", await insertarAliado(sa.access));
  reg("V1.7", "superadmin en Minorista NO crea destinos", "rls", await insertarDestino(sa.access));
  reg("V1.8", "superadmin en Minorista NO actualiza formas_pago (0 filas)", "0filas", await actualizarFormaPago(sa.access, fpA));
  reg("V1.9", "superadmin en Minorista NO borra formas_pago (0 filas)", "0filas", await borrarFormaPago(sa.access, fpA));
  const pMin = await guardarProveedor(sa.access);
  reg("V1.10", "superadmin en Minorista NO guarda proveedor (RPC guardar_proveedor)", "rls", pMin.estado);
  const lect = await http("GET", "/rest/v1/destinos?select=id&limit=1", { token: sa.access });
  reg("V1.11", "superadmin en Minorista SÍ lee el catálogo", "ok", lect.status === 200 ? "ok" : String(lect.status));
  reg("V1.12", "volver a Mayorista", "ok", codigo(await cambiar(sa.sid, "mayorista")));
  reg("V1.13", "superadmin de nuevo en Mayorista escribe (actualiza formas_pago)", "ok", await actualizarFormaPago(sa.access, fpA));
  const pMay = await guardarProveedor(sa.access);
  reg("V1.14", "superadmin en Mayorista crea proveedor con datos sensibles", "ok", pMay.estado);
  reg("V1.15", "superadmin en Mayorista edita ese proveedor", "ok", (await guardarProveedor(sa.access, pMay.id)).estado);

  // ── V2 Roles no superadmin (matriz) ──────────────────────────────────────
  const aM = await login("adm_may"), aN = await login("adm_min");
  reg("V2.1", "administracion Mayorista escribe aliados (sin contexto de sesión)", "ok", await insertarAliado(aM.access));
  reg("V2.2", "administracion Minorista NO escribe aliados (D9)", "rls", await insertarAliado(aN.access));
  reg("V2.3", "administracion Minorista NO escribe destinos (D8)", "rls", await insertarDestino(aN.access));
  reg("V2.4", "administracion Minorista NO actualiza formas_pago", "0filas", await actualizarFormaPago(aN.access, fpB));
  reg("V2.5", "administracion Minorista NO guarda proveedor", "rls", (await guardarProveedor(aN.access)).estado);
  const oM = await login("ops_may"), oN = await login("ops_min");
  reg("V2.6", "operaciones Mayorista crea proveedor", "ok", (await guardarProveedor(oM.access)).estado);
  reg("V2.7", "operaciones Minorista NO crea proveedor", "rls", (await guardarProveedor(oN.access)).estado);
  reg("V2.8", "operaciones Mayorista escribe destinos", "ok", await insertarDestino(oM.access));
  reg("V2.9", "operaciones Mayorista NO escribe aliados (matriz vigente: solo administración)", "rls", await insertarAliado(oM.access));
  const vM = await login("ven_may"), vN = await login("ven_min");
  reg("V2.10", "venta Mayorista NO escribe destinos (matriz vigente)", "rls", await insertarDestino(vM.access));
  reg("V2.11", "venta Minorista NO escribe destinos", "rls", await insertarDestino(vN.access));
  const gN = await login("ger_min");
  reg("V2.12", "gerencia Minorista NO escribe aliados", "rls", await insertarAliado(gN.access));

  // ── V3 Lectura / uso por Minorista conservado ────────────────────────────
  for (const [t, tabla] of [["V3.1", "aliados"], ["V3.2", "asesores"], ["V3.3", "formas_pago"], ["V3.4", "rangos_edad"], ["V3.5", "parametros_tributarios"], ["V3.6", "destinos"], ["V3.7", "proveedores"], ["V3.8", "hoteles"], ["V3.9", "servicios_adicionales"]]) {
    const r = await http("GET", `/rest/v1/${tabla}?select=*&limit=1`, { token: aN.access });
    reg(t, `administracion Minorista lee ${tabla} (200, sin error)`, "200", String(r.status));
  }
  const sens = await http("GET", "/rest/v1/proveedores_datos_sensibles?select=nit", { token: aN.access });
  reg("V3.10", "Minorista NO ve datos sensibles de proveedores (0 filas)", "0", String(Array.isArray(sens.json) ? sens.json.length : "err"));
  const sensM = await http("GET", "/rest/v1/proveedores_datos_sensibles?select=nit,numero_cuenta", { token: aM.access });
  reg("V3.11", "administracion Mayorista SÍ ve datos sensibles", "true", String(Array.isArray(sensM.json) && sensM.json.length > 0));
  const base = await http("GET", "/rest/v1/proveedores?select=id,nombre&limit=5", { token: aN.access });
  reg("V3.12", "Minorista ve el catálogo base de proveedores", "true", String(Array.isArray(base.json) && base.json.length > 0));

  // ── V4 Logout: el JWT sigue vigente pero la sesión murió ─────────────────
  const l = await login("sa2");
  await iniciar(l.sid, "mayorista");
  reg("V4.1", "antes del logout escribe", "ok", await insertarAliado(l.access));
  const out = await http("POST", "/auth/v1/logout", { token: l.access });
  reg("V4.2", "logout responde 2xx", "true", String(out.status < 300));
  reg("V4.3", "tras logout, el mismo access token ya NO escribe", "rls", await insertarAliado(l.access));

  // ── V5 Sesiones simultáneas ──────────────────────────────────────────────
  const s1 = await login("sa2"), s2 = await login("sa2");
  await iniciar(s1.sid, "mayorista"); await iniciar(s2.sid, "mayorista");
  await cambiar(s1.sid, "minorista");
  reg("V5.1", "sesiones independientes: s1 (Minorista) no escribe", "rls", await insertarAliado(s1.access));
  reg("V5.2", "sesiones independientes: s2 (Mayorista) sigue escribiendo", "ok", await insertarAliado(s2.access));

  // ── V6 Refresh token ─────────────────────────────────────────────────────
  const rf = await http("POST", "/auth/v1/token?grant_type=refresh_token", { body: { refresh_token: s2.refresh } });
  const nuevo = rf.json?.access_token;
  reg("V6.1", "refresh conserva el session_id", "true", String(nuevo && jwtPayload(nuevo).session_id === s2.sid));
  reg("V6.2", "token refrescado escribe (misma sesión, mismo contexto)", "ok", await insertarAliado(nuevo));
  reg("V6.3", "token ANTERIOR (aún vigente) sigue ligado a la misma sesión", "ok", await insertarAliado(s2.access));
  await cambiar(s2.sid, "minorista");
  reg("V6.4", "tras cambiar a Minorista, el token refrescado NO escribe", "rls", await insertarAliado(nuevo));
  reg("V6.5", "tras cambiar a Minorista, el token anterior tampoco", "rls", await insertarAliado(s2.access));

  // ── V7 Usuario desactivado ───────────────────────────────────────────────
  const ia = await login("inact");
  reg("V7.1", "administracion activa escribe", "ok", await insertarAliado(ia.access));
  sql(`update public.usuarios set activo = false where id = '${usuarios.inact.id}'`);
  reg("V7.2", "desactivado: su JWT vigente ya NO escribe", "rls", await insertarAliado(ia.access));
  sql(`update public.usuarios set activo = true where id = '${usuarios.inact.id}'`);
  reg("V7.3", "reactivado: vuelve a escribir (rol no superadmin)", "ok", await insertarAliado(ia.access));
  sql(`update public.usuarios set activo = false where id = '${usuarios.sa.id}'`);
  reg("V7.4", "superadmin desactivado: no escribe", "rls", await insertarAliado(sa.access));
  sql(`update public.usuarios set activo = true where id = '${usuarios.sa.id}'`);
  reg("V7.5", "superadmin reactivado: contexto invalidado, debe iniciar sesión de nuevo (falla cerrado)", "rls", await insertarAliado(sa.access));
  const saNueva = await login("sa");
  reg("V7.6", "nueva sesión de superadmin inicia contexto", "ok", codigo(await iniciar(saNueva.sid, "mayorista")));
  reg("V7.7", "y vuelve a escribir", "ok", await insertarAliado(saNueva.access));

  // ── V8 Llamadas directas a la API y a las RPC de contexto ────────────────
  reg("V8.1", "anon sin sesión NO escribe aliados", "rls", await insertarAliado(undefined));
  const dir = await http("POST", "/rest/v1/rpc/iniciar_contexto_agencia", { token: aN.access, body: { p_session: aN.sid, p_tenant: "mayorista" } });
  reg("V8.2", "authenticated NO puede invocar iniciar_contexto_agencia", "denegado", dir.status >= 400 ? "denegado" : "ejecutó");
  const dir2 = await http("POST", "/rest/v1/rpc/cambiar_contexto_agencia", { token: sa.access, body: { p_session: sa.sid, p_tenant: "mayorista" } });
  reg("V8.3", "authenticated NO puede invocar cambiar_contexto_agencia", "denegado", dir2.status >= 400 ? "denegado" : "ejecutó");
  const dir3 = await http("POST", "/rest/v1/rpc/iniciar_contexto_agencia", { body: { p_session: aN.sid, p_tenant: "mayorista" } });
  reg("V8.4", "anon NO puede invocar iniciar_contexto_agencia", "denegado", dir3.status >= 400 ? "denegado" : "ejecutó");
  const rd = await http("GET", "/rest/v1/sesion_agencia?select=*", { token: sa.access });
  reg("V8.5", "authenticated no puede leer sesion_agencia (error o vacío)", "true", String(rd.status >= 400 || (Array.isArray(rd.json) && rd.json.length === 0)));
  const wr = await http("POST", "/rest/v1/sesion_agencia", { token: sa.access, body: { session_id: sa.sid, user_id: usuarios.sa.id, tenant: "mayorista" } });
  reg("V8.6", "authenticated no puede escribir sesion_agencia directo", "denegado", wr.status >= 400 ? "denegado" : "escribió");
  const aliasT = await http("POST", "/rest/v1/aliados", { token: aN.access, body: { nombre: `T237 forjado ${tag}`, tipo: "agencia" }, headers: { "x-tenant": "mayorista", "x-session-id": sa.sid } });
  reg("V8.7", "cabeceras forjadas (x-tenant / x-session-id) no cambian nada", "rls", aliasT.json?.code === "42501" ? "rls" : String(aliasT.status));
  const claimForjado = await http("POST", "/rest/v1/rpc/puede_escribir_catalogo_global", { token: aN.access, body: {} });
  reg("V8.8", "puede_escribir_catalogo_global() para Minorista = false", "false", String(claimForjado.json));
  const agente = await login("agenc");
  reg("V8.9", "rol agencia (B2B) NO escribe aliados", "rls", await insertarAliado(agente.access));

  // ── V9 Anti-recreación / ventana / usuario equivocado ────────────────────
  const r9 = await login("sa2");
  reg("V9.1", "iniciar contexto de sesión nueva", "ok", codigo(await iniciar(r9.sid, "mayorista")));
  reg("V9.2", "segundo iniciar de la misma sesión se rechaza (ya_iniciada)", "ya_iniciada", codigo(await iniciar(r9.sid, "mayorista")));
  sql(`delete from public.sesion_agencia where session_id = '${r9.sid}'`);
  reg("V9.3", "contexto borrado con la sesión viva: NO escribe", "rls", await insertarAliado(r9.access));
  reg("V9.4", "y NO se puede recrear (registro de inicio permanece)", "ya_iniciada", codigo(await iniciar(r9.sid, "mayorista")));
  reg("V9.5", "sigue sin escribir tras el intento de recrear", "rls", await insertarAliado(r9.access));
  const r9b = await login("sa2");
  sql(`update auth.sessions set created_at = now() - interval '2 hours' where id = '${r9b.sid}'`);
  reg("V9.6", "sesión creada hace 2 h no puede iniciar contexto (fuera_de_ventana)", "fuera_de_ventana", codigo(await iniciar(r9b.sid, "mayorista")));
  reg("V9.7", "sesión inexistente no inicia", "sesion_inexistente", codigo(await iniciar("00000000-0000-4000-8000-000000000000", "mayorista")));
  const rn = await login("adm_min");
  reg("V9.8", "administracion Minorista no puede iniciar contexto en Mayorista", "agencia_no_permitida", codigo(await iniciar(rn.sid, "mayorista")));
  reg("V9.9", "administracion Minorista no puede cambiar contexto", "agencia_no_permitida", codigo(await cambiar(rn.sid, "mayorista")));
  const r9c = await login("sa2");
  reg("V9.10", "cambiar sin contexto previo falla (sin_contexto)", "sin_contexto", codigo(await cambiar(r9c.sid, "mayorista")));
  reg("V9.11", "tenant inválido", "agencia_invalida", codigo(await iniciar(r9c.sid, "otra")));

  // ── V10 Promoción y degradación ──────────────────────────────────────────
  const pr = await login("promo");
  reg("V10.1", "administracion Mayorista escribe", "ok", await insertarAliado(pr.access));
  sql(`update public.usuarios set rol = 'superadmin' where id = '${usuarios.promo.id}'`);
  reg("V10.2", "promovido a superadmin MID-sesión: sin contexto no escribe (no se inicializa solo)", "rls", await insertarAliado(pr.access));
  sql(`update public.usuarios set rol = 'administracion' where id = '${usuarios.promo.id}'`);
  reg("V10.3", "degradado a administracion Mayorista: vuelve a escribir por su perfil", "ok", await insertarAliado(pr.access));

  // ── V11 Funciones SECURITY DEFINER ───────────────────────────────────────
  const dest1 = sql(`insert into public.destinos (nombre) values ('T237 origen ${tag}') returning id`);
  const dest2 = sql(`insert into public.destinos (nombre) values ('T237 destino ${tag}') returning id`);
  const sm = await login("sa2");
  await iniciar(sm.sid, "mayorista");
  await cambiar(sm.sid, "minorista");
  const f1 = await http("POST", "/rest/v1/rpc/fn_fusionar_destino", { token: sm.access, body: { p_origen: Number(dest1), p_destino: Number(dest2) } });
  reg("V11.1", "fn_fusionar_destino desde Minorista: rechazada por la guarda", "true", String(f1.status >= 400 && /Mayorista/.test(JSON.stringify(f1.json))));
  const f2 = await http("POST", "/rest/v1/rpc/reemplazar_tarifas_hotel_calculadora", { token: sm.access, body: { p_hotel_id: 1, p_regimenes: [], p_filas: [] } });
  reg("V11.2", "reemplazar_tarifas_hotel_calculadora desde Minorista: rechazada", "true", String(f2.status >= 400 && /Mayorista/.test(JSON.stringify(f2.json))));
  const f3 = await http("POST", "/rest/v1/rpc/generar_tarifas_hotel_calculadora", { token: sm.access, body: { p_hotel_id: 1, p_filas: [], p_previas: [], p_reemplazar_todo: false, p_motivo: "t" } });
  reg("V11.3", "generar_tarifas_hotel_calculadora desde Minorista: rechazada", "true", String(f3.status >= 400 && /Mayorista/.test(JSON.stringify(f3.json))));
  await cambiar(sm.sid, "mayorista");
  const f1b = await http("POST", "/rest/v1/rpc/fn_fusionar_destino", { token: sm.access, body: { p_origen: Number(dest1), p_destino: Number(dest2) } });
  reg("V11.4", "fn_fusionar_destino desde Mayorista: ejecuta", "ok", f1b.status < 300 ? "ok" : JSON.stringify(f1b.json));
  const f2b = await http("POST", "/rest/v1/rpc/reemplazar_tarifas_hotel_calculadora", { token: sm.access, body: { p_hotel_id: 999999, p_regimenes: [], p_filas: [] } });
  reg("V11.5", "reemplazar_tarifas… desde Mayorista pasa la guarda (falla después por datos, no por agencia)", "true", String(!/Mayorista/.test(JSON.stringify(f2b.json ?? ""))));
  // aprobar_solicitud_b2b modo 'nueva': la guarda está antes del INSERT en aliados.
  const sol = sql(`select 1`); void sol;

  // ── V12 Regresiones: creación/edición de producto, tablas fuera del registro ─
  reg("V12.1", "REGISTRO del arnés == catalogos_globales_registro() de la base", "true",
    String(JSON.stringify([...REGISTRO].sort()) === JSON.stringify(sql(`select unnest(public.catalogos_globales_registro()) order by 1`).split("\n").sort())));
  const dId = Number(sql(`select id from public.destinos where nombre = 'T237 destino ${tag}'`));
  const crearHotel = async (token, nombre) => http("POST", "/rest/v1/hoteles", { token, headers: { Prefer: "return=representation" }, body: { destino_id: dId, nombre } });
  const hM = await crearHotel(oM.access, `T237 hotel ${tag} A`);
  reg("V12.2", "operaciones Mayorista crea hotel", "ok", hM.status < 300 ? "ok" : String(hM.json?.code));
  const hId = hM.json?.[0]?.id;
  const ed = await http("PATCH", `/rest/v1/hoteles?id=eq.${hId}`, { token: oM.access, headers: { Prefer: "return=representation" }, body: { nombre: `T237 hotel ${tag} B` } });
  reg("V12.3", "operaciones Mayorista edita hotel (1 fila)", "1", String(Array.isArray(ed.json) ? ed.json.length : "err"));
  const edMin = await http("PATCH", `/rest/v1/hoteles?id=eq.${hId}`, { token: oN.access, headers: { Prefer: "return=representation" }, body: { nombre: "forjado" } });
  reg("V12.4", "operaciones Minorista NO edita ese hotel (0 filas)", "0", String(Array.isArray(edMin.json) ? edMin.json.length : "err"));
  const hMin = await crearHotel(oN.access, `T237 hotel ${tag} M`);
  reg("V12.5", "operaciones Minorista NO crea hotel", "rls", hMin.json?.code === "42501" ? "rls" : String(hMin.status));
  const sv = await http("POST", "/rest/v1/servicios_adicionales", { token: aM.access, headers: { Prefer: "return=representation" }, body: { nombre: `T237 servicio ${tag}` } });
  reg("V12.6", "administracion Mayorista crea servicio", "ok", sv.status < 300 ? "ok" : String(sv.json?.code));
  const svMin = await http("POST", "/rest/v1/servicios_adicionales", { token: aN.access, body: { nombre: `T237 servicio min ${tag}` } });
  reg("V12.7", "administracion Minorista NO crea servicio", "rls", svMin.json?.code === "42501" ? "rls" : String(svMin.status));
  const delH = await http("DELETE", `/rest/v1/hoteles?id=eq.${hId}`, { token: oN.access, headers: { Prefer: "return=representation" } });
  reg("V12.8", "operaciones Minorista NO borra hotel (0 filas)", "0", String(Array.isArray(delH.json) ? delH.json.length : "err"));
  // Tablas FUERA del registro siguen operando por Minorista (la frontera no las toca).
  const crm = await http("POST", "/rest/v1/crm_contactos", { token: aN.access, body: { tenant: "minorista", nombre: `T237 contacto ${tag}`, categoria: "cliente" } });
  reg("V12.9", "administracion Minorista sigue escribiendo crm_contactos de SU agencia (fuera del registro)", "ok", crm.status < 300 ? "ok" : `${crm.status}:${crm.json?.code}`);
  const fuera = sql(`select count(*) from pg_policy p join pg_class c on c.oid = p.polrelid where not p.polpermissive and p.polname like 'catalogo global:%' and c.relname not in (select unnest(public.catalogos_globales_registro()))`);
  reg("V12.10", "ninguna policy 'catalogo global' fuera del registro (ventas, sillas, CxP, contratos intactos)", "0", fuera);
  // service-role (Server Actions que regeneran tarifarios, jobs) conserva su acceso: su autorización es CÓDIGO.
  const sr = await http("PATCH", `/rest/v1/hoteles?id=eq.${hId}`, { key: SERVICE, token: SERVICE, headers: { Prefer: "return=representation" }, body: { nombre: `T237 hotel ${tag} SR` } });
  reg("V12.11", "service_role sigue pudiendo escribir catálogos (la autorización de esas rutas va en código)", "1", String(Array.isArray(sr.json) ? sr.json.length : "err"));
  // El superadmin en Mayorista conserva el flujo completo de proveedor (crear -> usar en hotel).
  const pv = await guardarProveedor(sm.access);
  reg("V12.12", "superadmin Mayorista (sesión con contexto) crea proveedor y lo usa", "ok", pv.estado);
  const usa = await http("PATCH", `/rest/v1/hoteles?id=eq.${hId}`, { token: sm.access, headers: { Prefer: "return=representation" }, body: { proveedor_id: pv.id } });
  reg("V12.13", "...y lo asigna a un hotel (o la columna no existe: se informa)", "true", String(usa.status < 300 || usa.json?.code === "PGRST204"));

  // ── V13 Roles no superadmin: exigen session_id y sesión VIVA (agencia sigue fija por perfil) ──
  const nx = await login("adm_may");
  reg("V13.1", "administracion Mayorista con sesión viva escribe", "ok", await insertarAliado(nx.access));
  const outNx = await http("POST", "/auth/v1/logout", { token: nx.access });
  reg("V13.2", "logout de administracion Mayorista responde 2xx", "true", String(outNx.status < 300));
  reg("V13.3", "su JWT ANTERIOR (aún vigente) ya NO escribe tras el logout", "rls", await insertarAliado(nx.access));
  const ox = await login("ops_may");
  reg("V13.4", "operaciones Mayorista con sesión viva escribe destinos", "ok", await insertarDestino(ox.access));
  sql(`delete from auth.sessions where id = '${ox.sid}'`);
  reg("V13.5", "sesión eliminada de auth.sessions: el JWT vigente ya NO escribe", "rls", await insertarDestino(ox.access));
  const ox2 = await login("ops_may");
  sql(`update auth.sessions set not_after = now() - interval '1 minute' where id = '${ox2.sid}'`);
  reg("V13.6", "sesión expirada (not_after pasado): el JWT vigente ya NO escribe", "rls", await insertarDestino(ox2.access));
  const ox3 = await login("ops_may");
  reg("V13.7", "una sesión nueva del mismo usuario SÍ escribe (sin tocar la regla de agencia)", "ok", await insertarDestino(ox3.access));
  const lecturaTrasLogout = await http("GET", "/rest/v1/destinos?select=id&limit=1", { token: nx.access });
  reg("V13.8", "la LECTURA pública de destinos no depende de la sesión (200)", "200", String(lecturaTrasLogout.status));
  const nmin = await login("adm_min");
  reg("V13.9", "administracion Minorista con sesión viva sigue sin escribir (agencia fija por perfil)", "rls", await insertarAliado(nmin.access));
  const fnAgencia = await http("POST", "/rest/v1/rpc/agencia_activa_sesion", { token: nx.access, body: {} });
  reg("V13.10", "agencia_activa_sesion() tras logout = null", "null", String(fnAgencia.json));
  const fnAgencia2 = await http("POST", "/rest/v1/rpc/agencia_activa_sesion", { token: ox3.access, body: {} });
  reg("V13.11", "agencia_activa_sesion() de un no superadmin vivo = su perfil", "mayorista", String(fnAgencia2.json));

  // ── V14 Cambio Mayorista -> Minorista con la RPC FALLANDO ────────────────
  // Invariante: la apariencia (cookie) solo pasa a Minorista si la base pasó. Si la RPC falla, la base
  // conserva su agencia anterior, así que no hay escritura autorizada bajo apariencia de Minorista.
  const f = await login("sa2");
  await iniciar(f.sid, "mayorista");
  const ctx = () => sql(`select tenant from public.sesion_agencia where session_id = '${f.sid}'`);
  reg("V14.1", "contexto inicial = mayorista", "mayorista", ctx());
  reg("V14.2", "RPC con agencia inválida falla", "agencia_invalida", codigo(await cambiar(f.sid, "otra")));
  reg("V14.3", "tras el fallo el contexto NO cambió y la Data API sigue autorizada como Mayorista (UI = Mayorista)", "mayorista|ok", `${ctx()}|${await insertarAliado(f.access)}`);
  reg("V14.4", "RPC con sesión inexistente falla", "sesion_inexistente", codigo(await cambiar("00000000-0000-4000-8000-000000000000", "minorista")));
  reg("V14.5", "tras ese fallo el contexto sigue en mayorista", "mayorista", ctx());
  sql(`delete from public.sesion_agencia where session_id = '${f.sid}'`);
  reg("V14.6", "sin fila de contexto, cambiar falla (sin_contexto) y NO crea fila", "sin_contexto|0", `${codigo(await cambiar(f.sid, "minorista"))}|${sql(`select count(*) from public.sesion_agencia where session_id = '${f.sid}'`)}`);
  reg("V14.7", "y la Data API queda denegada (nunca autorizada bajo apariencia de Minorista)", "rls", await insertarAliado(f.access));
  const g = await login("sa2");
  await iniciar(g.sid, "mayorista");
  reg("V14.8", "cambio exitoso a Minorista", "ok", codigo(await cambiar(g.sid, "minorista")));
  reg("V14.9", "tras cambio exitoso la Data API NO escribe (apariencia = autorización)", "rls", await insertarAliado(g.access));
  reg("V14.10", "el superadmin sin sesión viva (logout) no conserva ningún permiso", "rls",
    await (async () => { await http("POST", "/auth/v1/logout", { token: g.access }); return insertarAliado(g.access); })());

  // ── V15 Desenlaces de la lectura que usa tenantContext(): sin contexto vs ok (respuestas VÁLIDAS) ──
  const lec = async (t) => { const r = await http("POST", "/rest/v1/rpc/agencia_activa_sesion", { token: t, body: {} }); return `${r.status}:${r.json}`; };
  const h = await login("sa2");
  reg("V15.1", "superadmin SIN contexto: respuesta válida 200 con null (distinta de un error)", "200:null", await lec(h.access));
  await iniciar(h.sid, "mayorista");
  reg("V15.2", "con contexto: 200 con la agencia", "200:mayorista", await lec(h.access));
  await cambiar(h.sid, "minorista");
  reg("V15.3", "tras cambiar: 200 con minorista", "200:minorista", await lec(h.access));
  const ra = await http("POST", "/rest/v1/rpc/agencia_activa_sesion", { token: "token.invalido.xx", body: {} });
  reg("V15.4", "token inválido: ERROR (no null) -> el servidor lo trata como error técnico", "true", String(ra.status >= 400));

  // ── Resumen ──────────────────────────────────────────────────────────────
  const fallas = resultados.filter((x) => x.estado === "FALLA");
  console.log(`\nRESUMEN: ${resultados.length} comprobaciones, ${resultados.length - fallas.length} PASA, ${fallas.length} FALLA`);
  if (fallas.length) process.exitCode = 1;
}

main().catch((e) => { console.error("ERROR HARNESS:", e.message); process.exitCode = 2; });
