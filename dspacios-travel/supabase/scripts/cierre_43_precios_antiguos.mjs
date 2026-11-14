// PRUEBA DE CIERRE INTEGRAL #43/#60 (entrega 7): después de ACTIVAR grupos, ACTUALIZAR una tarifa por grupo y VOLVER
// a «todos los días», ningún paquete que usa el hotel puede seguir publicando precios ANTERIORES a la operación.
// Código REAL de las acciones (grupos-actions → RPC → regeneración acotada → generarTarifario) contra una base LOCAL
// desechable y su PostgREST (lo lanza cierre_43_precios_antiguos.sh). Solo se sustituyen next/headers, next/cache y
// server-only, como en medir_299_recorrido.mjs.
//
// Criterio de «precio antiguo» (por paquete activo que usa el hotel): tras la operación, la generación PUBLICADA debe
// ser una generación nueva (posterior a la operación) o el paquete no debe tener filas publicadas. Si el intento de
// regenerar falló y sigue publicada la generación anterior, esas filas tienen precios de antes ⇒ FALLO.
// Resultado esperado desde la entrega 6 (2026-11-12, 301 + 302): 0 FALLO y 0 AVISO — los paquetes de porción del hotel con grupos se
// regeneran con el «desde» por estadía real y SIGUEN mostrándose, cada fila con su justificación (desde_entrada). Antes de la entrega 6
// el resultado era 0 FALLO y 2 AVISO (la porción dejaba de mostrarse).
import http from "node:http";
import { createHmac } from "node:crypto";
import nodeModule from "node:module";
import { execSync } from "node:child_process";

const REST = process.env.C43_REST, SECRETO = process.env.C43_SECRETO, SQL = process.env.C43_SQL;
const b64 = (s) => Buffer.from(s).toString("base64url");
const jwt = (p) => { const h = b64(JSON.stringify({ alg: "HS256", typ: "JWT" })); const c = b64(JSON.stringify({ ...p, exp: Math.floor(Date.now() / 1000) + 3600 }));
  return `${h}.${c}.${createHmac("sha256", SECRETO).update(`${h}.${c}`).digest("base64url")}`; };
const SUB = "00000000-0000-4000-8000-000000009302";
const token = jwt({ role: "authenticated", sub: SUB, session_id: "00000000-0000-4000-8000-00000000a302", aud: "authenticated" });
const sql = (q) => execSync(SQL, { input: q, encoding: "utf8" }).trim();

// Sin proxy contador: se habla directo con PostgREST (la medición de consumo está en medir_299_recorrido).
const destino = new URL(REST);
const proxy = http.createServer((req, res) => {
  const p = http.request({ host: destino.hostname, port: destino.port, path: req.url.replace(/^\/rest\/v1/, "") || "/", method: req.method, headers: { ...req.headers, host: destino.host } },
    (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
  p.on("error", (e) => { res.writeHead(502); res.end(String(e)); });
  req.pipe(p);
});
await new Promise((ok) => proxy.listen(0, "127.0.0.1", ok));
Object.assign(process.env, { NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${proxy.address().port}`, NEXT_PUBLIC_SUPABASE_ANON_KEY: jwt({ role: "anon" }), SUPABASE_SERVICE_ROLE_KEY: jwt({ role: "service_role" }) });
delete process.env.CRON_SECRET; delete process.env.MANTENIMIENTO_CLAVE;
const sesion = JSON.stringify({ access_token: token, token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: "x", user: { id: SUB, aud: "authenticated", role: "authenticated" } });
globalThis.__c43 = { cookie: { name: "sb-127-auth-token", value: "base64-" + Buffer.from(sesion).toString("base64url") } };
const datos = (src) => `data:text/javascript,${encodeURIComponent(src)}`;
nodeModule.registerHooks({ resolve(s, c, n) {
  if (s === "server-only") return { url: datos("export {}"), shortCircuit: true };
  if (s === "next/headers") return { url: datos("export async function cookies(){ const c = globalThis.__c43.cookie; return { getAll: () => [c], get: (n) => (n === c.name ? c : undefined), set(){} }; } export async function headers(){ return new Map(); }"), shortCircuit: true };
  if (s === "next/cache") return { url: datos("export function revalidatePath(){} export function revalidateTag(){} export function unstable_noStore(){}"), shortCircuit: true };
  if (s.startsWith(".") && !/\.[cm]?[jt]sx?$/.test(s)) {
    for (const ext of [".ts", ".tsx", "/index.ts"]) { try { return n(s + ext, c); } catch { /* siguiente */ } }
  }
  return n(s, c);
} });

const acc = await import("../../app/(dashboard)/dashboard/producto/hoteles/[id]/grupos-actions.ts");
const paq = await import("../../app/(dashboard)/dashboard/paquetes/actions.ts");
const reservar = await import("../../app/(dashboard)/dashboard/reservar/actions.ts");
const { estadiaDesdeDoble, textoEstadiaDesde, desdeDoble } = await import("../../lib/tarifario/desdeDoble.ts");
const { planActivacion, payloadHabilitaciones, planVolver, payloadVolver } = await import("../../lib/hoteles/activacionGrupos.ts");
const { planPropuesta, NETOS_VACIOS } = await import("../../lib/hoteles/alcanceGrupos.ts");
const VIG = 930101, HOTEL = 9301, S = "00000000-0000-4000-8000-0000000c0001";

const estado = () => Object.fromEntries(sql(`select id || '|' || nombre || '|' || coalesce(tarifario_generacion::text, '') || '|' || coalesce(tarifario_generacion_publicada::text, '')
  || '|' || (select count(*) from public.tarifario_resultado_publicable r where r.paquete_id = p.id)
  || '|' || (select count(*) from public.tarifario_resultado r where r.paquete_id = p.id and r.generacion is not distinct from p.tarifario_generacion_publicada)
  || '|' || coalesce(tarifario_estado, '')
  from public.armado_paquetes p where p.id in (select paquete_id from public.armado_hoteles where hotel_id = ${HOTEL}) order by id;`)
  .split("\n").filter(Boolean).map((l) => { const [id, nombre, gen, pub, filas, crudas, est] = l.split("|");
    return [id, { nombre, gen: Number(gen) || 0, pub: Number(pub) || 0, filas: Number(filas), crudas: Number(crudas), est }]; }));
let fallos = 0, avisos = 0;
// FALLO = precios de antes VISIBLES (vista comercial única, 260). AVISO = el paquete deja de mostrarse (sin precio publicado).
// INFO = filas de la generación anterior que siguen en la tabla, ocultas (solo las ve la ficha interna del paquete).
function verificar(op, antes) {
  const despues = estado();
  for (const [id, d] of Object.entries(despues)) {
    const a = antes[id] ?? { pub: 0, filas: 0 };
    const viejoVisible = d.filas > 0 && d.pub <= a.pub;
    if (viejoVisible) fallos++;
    const ocultas = d.filas === 0 && d.crudas > 0 && d.pub <= a.pub;
    if (!viejoVisible && d.filas === 0 && a.filas > 0) avisos++;
    console.log(`${viejoVisible ? "FALLO" : d.filas === 0 && a.filas > 0 ? "AVISO" : "OK   "} ${op} · ${d.nombre}: ${viejoVisible
      ? `sigue VISIBLE la generación ${d.pub} (anterior a la operación; último intento ${d.gen}) ⇒ PRECIOS ANTIGUOS`
      : d.filas ? `publicada la generación ${d.pub}, nueva` : `sin filas visibles (estado ${d.est})${a.filas > 0 ? " — DEJA DE MOSTRARSE" : ""}`}${ocultas ? ` · INFO: ${d.crudas} fila(s) de la generación ${d.pub} siguen en la tabla, ocultas (ficha interna del paquete)` : ""}`);
  }
}
async function paso(op, fn) {
  const antes = estado();
  const r = await fn();
  if (!r?.ok) { fallos++; console.log(`FALLO ${op}: la operación no se ejecutó — ${r?.error}`); return; }
  verificar(op, antes);
  justificacion(op);
}
// Entrega 6: con el hotel vendiendo por grupos, toda fila de habitación de porción publicada lleva la entrada que la justifica, y esa
// estadía cabe en la ventana del paquete. Sin grupos (publicación inicial y tras volver), ninguna la lleva (comportamiento de siempre).
function justificacion(op) {
  const [conGrupos, sinJ, conJ, fuera] = sql(`select
      (exists (select 1 from public.hotel_temporada_grupos g join public.hotel_temporadas t on t.id = g.temporada_id where t.hotel_id = ${HOTEL} and g.activo))::text
      || '|' || count(*) filter (where r.desde_entrada is null and r.acomodacion in ('sencilla','doble','triple','multiple'))
      || '|' || count(*) filter (where r.desde_entrada is not null)
      || '|' || count(*) filter (where r.desde_entrada is not null and (r.desde_entrada < r.fecha_ida or r.desde_entrada + r.noches > r.fecha_regreso))
    from public.tarifario_resultado_publicable r where r.hotel_id = ${HOTEL} and r.modulo = 'porcion_terrestre'`).split("|");
  const bien = conGrupos === "true" ? Number(sinJ) === 0 && Number(conJ) > 0 && Number(fuera) === 0 : Number(conJ) === 0;
  if (!bien) fallos++;
  console.log(`${bien ? "OK   " : "FALLO"} ${op} · justificación del «desde»: grupos activos=${conGrupos}, filas con entrada=${conJ}, habitaciones sin entrada=${sinJ}, fuera de la ventana=${fuera}`);
}

// 0) Publicación inicial con «todos los días» (el hotel todavía no vende por grupos).
const r0 = await paq.regenerarTarifariosDeHotelAcotado(HOTEL);
console.log(`publicación inicial: ${JSON.stringify(r0)}`);
justificacion("publicación inicial");
const precioInicial = sql(`select min(precio_pvp) from public.tarifario_resultado_publicable where hotel_id = ${HOTEL} and acomodacion = 'doble'`);

// 1) ACTIVAR (primera aplicación a la venta).
await paso("activar", async () => {
  const al = await acc.leerAlcanceGrupos(VIG); if (!al.ok) return al;
  const plan = planActivacion(al.alcance);
  if (plan.bloqueos.length) return { ok: false, error: plan.bloqueos.join(" · ") };
  return acc.aplicarGruposVenta(VIG, al.alcance.huella, payloadHabilitaciones(plan, new Set(plan.habilitaciones.map((h) => h.clave))));
});

// 2) ACTUALIZAR una tarifa por grupo (borrador) y aplicar el cambio a la venta.
await paso("actualizar", async () => {
  const cfg = await acc.leerConfigGrupos(VIG); if (!cfg.ok) return cfg;
  const fila = { grupo_id: S, tipo_habitacion: "Estándar", alimentacion: "PAM", origen_tarifa_id: null,
    netos: { ...NETOS_VACIOS, neto_sencilla: 151000, neto_doble: 97000 },
    extras: { nota_infante: null, notas: null, edad_infante_min: 0, edad_infante_max: 1, edad_nino_min: 2, edad_nino_max: 11 } };
  const g = await acc.guardarPropuestaGrupos(VIG, cfg.config.huella, "actualizar", null, planPropuesta(cfg.config, "actualizar", null, [fila]).filas);
  if (!g.ok) return g;
  const al = await acc.leerAlcanceGrupos(VIG); if (!al.ok) return al;
  const plan = planActivacion(al.alcance);
  return acc.aplicarGruposVenta(VIG, al.alcance.huella, payloadHabilitaciones(plan, new Set(plan.habilitaciones.map((h) => h.clave))));
});

// 2b) Entrega 6 — PARIDAD: lo que la vitrina anuncia (tarifario_resumen, la misma vista que lee la tarjeta) y su estadía, cotizados como
// lo hace el cotizador al abrirse con la entrada precargada, dan el MISMO precio doble por persona (el hotel no tiene EBB / Long Stay).
{
  const filasResumen = JSON.parse(sql(`select coalesce(json_agg(r), '[]') from (select paquete_id, categoria, regimen, noches, moneda, precio_doble::float as precio_doble, desde_entrada_doble
    from public.tarifario_resumen where hotel_id = ${HOTEL} and modulo = 'porcion_terrestre' order by paquete_id) r`));
  for (const pid of [...new Set(filasResumen.map((f) => f.paquete_id))]) {
    const filas = filasResumen.filter((f) => f.paquete_id === pid);
    const desde = desdeDoble(filas, "COP"), est = estadiaDesdeDoble(filas, "COP");
    if (desde == null || !est) { fallos++; console.log(`FALLO paridad · paquete ${pid}: sin «desde» o sin estadía que lo justifique`); continue; }
    const origen = filas.find((f) => f.precio_doble === desde);
    const c = await reservar.cotizarPorFechas({ paqueteId: pid, hotelId: HOTEL, fechaIda: est.entrada, fechaRegreso: est.salida });
    const enVivo = c.ok ? c.combos.find((x) => x.categoria === origen.categoria && x.regimen === origen.regimen)?.precios?.doble : null;
    const igual = enVivo === desde;
    if (!igual) fallos++;
    console.log(`${igual ? "OK   " : "FALLO"} paridad · paquete ${pid}: tarjeta «Desde ${desde} por persona · ${textoEstadiaDesde(est)}» · cotizado en vivo ${est.entrada} → ${est.salida}: ${c.ok ? enVivo : c.error}`);
  }
}

// 3) VOLVER a «todos los días» conservando la tarifa de la Semana en cada combinación.
await paso("volver a todos los días", async () => {
  const al = await acc.leerAlcanceGrupos(VIG); if (!al.ok) return al;
  const plan = planVolver(al.alcance);
  const elecciones = Object.fromEntries(plan.combos.map((c) => [`${c.tipo_habitacion}\u001f${c.alimentacion}`, c.opciones.find((o) => o.grupo_id === S)?.grupo_id ?? c.opciones[0]?.grupo_id ?? null]));
  return acc.volverATodosLosDias(VIG, al.alcance.huella, payloadVolver(plan, elecciones));
});
const precioFinal = sql(`select min(precio_pvp) from public.tarifario_resultado_publicable where hotel_id = ${HOTEL} and acomodacion = 'doble'`);
console.log(`doble publicada: antes ${precioInicial || "—"} · al final ${precioFinal || "—"} (tras volver se vende la tarifa de la Semana todos los días)`);

proxy.close();
console.log(`=== fallos: ${fallos} · avisos: ${avisos}`);
process.exit(fallos || avisos ? 1 : 0);
