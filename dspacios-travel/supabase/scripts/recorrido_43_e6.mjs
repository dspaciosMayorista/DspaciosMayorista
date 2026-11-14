// RECORRIDO LOCAL REAL de #43/#60 entrega 6 + CONTEO DE SOLICITUDES (lo lanza recorrido_43_e6.sh, que crea la base y PostgREST desechables).
// Código REAL de las acciones; solo se sustituyen next/headers, next/cache y server-only. R6_RAIZ = árbol cuyo código se ejecuta (por defecto
// este; para el «antes», un worktree limpio de HEAD) y R6_MODO = completo | conteo (el «antes» solo cuenta: HEAD no tiene el «desde» real).
//  1) Semana 100.000 / Fin de semana 150.000: activar los grupos (acción de la ficha) ⇒ generación ⇒ publicación ⇒ lectura de la tarjeta
//     (cargarResumenTarifario, la misma que alimenta la vitrina) ⇒ cotización con la entrada precargada. Debe anunciar y cotizar 550.000.
//  2) Conteo: solicitudes HTTP a PostgREST por operación, con y sin promociones, por fechas y sobre tarifa publicada (dinámico).
import { createHmac } from "node:crypto";
import { execSync } from "node:child_process";
import nodeModule from "node:module";
import http from "node:http";
import path from "node:path";
import { pathToFileURL } from "node:url";

const REST = process.env.R6_REST, SECRETO = process.env.R6_SECRETO, PS = process.env.R6_PS;
const RAIZ = path.resolve(process.env.R6_RAIZ ?? path.join(import.meta.dirname, "../.."));
const MODO = process.env.R6_MODO ?? "completo";
const b64 = (s) => Buffer.from(s).toString("base64url");
const jwt = (p) => { const h = b64(JSON.stringify({ alg: "HS256", typ: "JWT" })); const c = b64(JSON.stringify({ ...p, exp: Math.floor(Date.now() / 1000) + 3600 }));
  return `${h}.${c}.${createHmac("sha256", SECRETO).update(`${h}.${c}`).digest("base64url")}`; };
const SUB = "00000000-0000-4000-8000-000000009302";
const token = jwt({ role: "authenticated", sub: SUB, session_id: "00000000-0000-4000-8000-00000000a302", aud: "authenticated" });
Object.assign(process.env, { NEXT_PUBLIC_SUPABASE_ANON_KEY: jwt({ role: "anon" }), SUPABASE_SERVICE_ROLE_KEY: jwt({ role: "service_role" }) });
delete process.env.CRON_SECRET; delete process.env.MANTENIMIENTO_CLAVE;

// Proxy: quita /rest/v1, responde un GoTrue mínimo y CUENTA cada solicitud a PostgREST (método + tabla/función).
const destino = new URL(REST);
let registro = null;
const proxy = http.createServer((req, res) => {
  if (req.url.startsWith("/__/auth/v1/user")) { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ id: SUB, aud: "authenticated", role: "authenticated", email: "t293-oper-may@x.test", app_metadata: {}, user_metadata: {} })); return; }
  const ruta = req.url.replace(/^\/__\/rest\/v1/, "").replace(/^\/__/, "") || "/";
  if (registro) registro.push(`${req.method} ${ruta.split("?")[0]}`);
  const p = http.request({ host: destino.hostname, port: destino.port, path: ruta, method: req.method, headers: { ...req.headers, host: destino.host } }, (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
  p.on("error", (e) => { res.writeHead(502); res.end(String(e)); });
  req.pipe(p);
});
await new Promise((ok) => proxy.listen(0, "127.0.0.1", ok));
process.env.NEXT_PUBLIC_SUPABASE_URL = `http://127.0.0.1:${proxy.address().port}/__`;
const sesion = JSON.stringify({ access_token: token, token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: "x", user: { id: SUB, aud: "authenticated", role: "authenticated" } });
globalThis.__r6 = { cookie: { name: "sb-127-auth-token", value: "base64-" + Buffer.from(sesion).toString("base64url") } };
const datos = (src) => `data:text/javascript,${encodeURIComponent(src)}`;
nodeModule.registerHooks({ resolve(s, c, n) {
  if (s === "server-only") return { url: datos("export {}"), shortCircuit: true };
  if (s === "next/headers") return { url: datos("export async function cookies(){ const c = globalThis.__r6.cookie; return { getAll: () => [c], get: (n) => (n === c.name ? c : undefined), set(){} }; } export async function headers(){ return new Map(); }"), shortCircuit: true };
  if (s === "next/cache") return { url: datos("export function revalidatePath(){} export function revalidateTag(){} export function unstable_noStore(){}"), shortCircuit: true };
  if (s.startsWith(".") && !/\.[cm]?[jt]sx?$/.test(s)) { for (const ext of [".ts", ".tsx", "/index.ts"]) { try { return n(s + ext, c); } catch { /* siguiente */ } } }
  return n(s, c);
} });
const imp = (rel) => import(pathToFileURL(path.join(RAIZ, rel)).href);
const sql = (q) => execSync(`${PS} -c "${q.replace(/"/g, '\\"')}"`, { encoding: "utf8" }).trim();
let fallos = 0;
const ok = (c, m) => { console.log(`${c ? "OK   " : "FALLO"} ${m}`); if (!c) fallos++; };
const pesos = (n) => Number(n).toLocaleString("es-CO");

const reservar = await imp("app/(dashboard)/dashboard/reservar/actions.ts");
const hoteles = await imp("app/(dashboard)/dashboard/producto/hoteles/actions.ts");
const paq = await imp("app/(dashboard)/dashboard/paquetes/actions.ts");
const { createClient } = await imp("lib/supabase/server.ts");
const { computarReserva } = await imp("lib/reservar/computo.ts");
console.log(`Código ejecutado: ${RAIZ} · modo ${MODO}`);

// La promoción por habitación del hotel 9306 acumula con EBB (como en el recorrido de la entrega 5).
// (En el código de HEAD no existe la combinación: allí la promoción se vende tal cual; solo se cuenta.)
if (typeof hoteles.guardarCombinacionPromocion === "function") {
  const rc = await hoteles.guardarCombinacionPromocion(930610, { acumulable: { ebb: true } });
  ok(rc.ok, `combinación de la promoción del hotel 9306${rc.ok ? "" : ": " + rc.error}`);
}

if (MODO === "completo" || MODO === "revision") {
  const acc = await imp("app/(dashboard)/dashboard/producto/hoteles/[id]/grupos-actions.ts");
  const { planActivacion, payloadHabilitaciones } = await imp("lib/hoteles/activacionGrupos.ts");
  const { cargarResumenTarifario } = await imp("lib/tarifario/resumen.ts");
  const { desdeDoble, estadiaDesdeDoble, textoEstadiaDesde } = await imp("lib/tarifario/desdeDoble.ts");
  console.log("\n### 1) Semana 100.000 / Fin de semana 150.000 — paquete 9601 (ventana 4–10 ene 2027, 5 noches, sin markup)");
  const al = await acc.leerAlcanceGrupos(930101);
  if (!al.ok) ok(false, `leer alcance: ${al.error}`);
  else {
    const plan = planActivacion(al.alcance);
    ok(plan.bloqueos.length === 0, `plan de activación sin bloqueos${plan.bloqueos.length ? ": " + plan.bloqueos.join(" · ") : ""}`);
    const r = await acc.aplicarGruposVenta(930101, al.alcance.huella, payloadHabilitaciones(plan, new Set(plan.habilitaciones.map((h) => h.clave))));
    ok(r.ok, `aplicar los grupos a la venta (genera y publica los paquetes del hotel)${r.ok ? "" : ": " + r.error}`);
  }
  console.log(`  tarifas por grupo vendidas (ALTA): ${sql("select string_agg(coalesce(g.nombre, 'todos') || '=' || t.neto_doble::int, ', ' order by g.nombre) from public.tarifa_hotel t left join public.hotel_temporada_grupos g on g.id = t.grupo_id where t.hotel_id = 9301 and t.temporada = 'ALTA'")}`);
  const fila = sql("select coalesce(precio_pvp::text, '') || '|' || coalesce(desde_entrada::text, '') || '|' || noches from public.tarifario_resultado_publicable where paquete_id = 9601 and acomodacion = 'doble'");
  console.log(`  fila publicada (doble): precio|entrada|noches = ${fila}`);
  ok(/^550000(\.00)?\|2027-01-04\|5$/.test(fila), "generación + publicación: doble 550.000 con su entrada 04/01/2027 y 5 noches");
  ok(sql("select count(*) from public.tarifario_resultado_publicable where paquete_id = 9601 and precio_pvp = 500000") === "0", "ninguna fila publicada a 500.000 (5 × la noche más barata)");
  const sb = await createClient();
  const res = await cargarResumenTarifario(sb, "recorrido_e6", "r6");
  if (!res.ok) ok(false, `lectura de la vitrina: ${res.error}`);
  else {
    const filas = res.datos.filasVisibles.filter((f) => f.paquete_id === 9601 && f.hotel_id === 9301);
    const desde = desdeDoble(filas, "COP"), est = estadiaDesdeDoble(filas, "COP");
    console.log(`  tarjeta (lectura real de la vitrina): «Desde ${pesos(desde)} · por persona · ${est ? textoEstadiaDesde(est) : "—"}»`);
    ok(desde === 550000 && est?.entrada === "2027-01-04" && est?.salida === "2027-01-09" && est?.noches === 5, "la tarjeta anuncia 550.000 · 5 noches · Entrada 04/01/2027");
    ok(desde !== 500000, "la tarjeta NO anuncia 500.000");
    if (est) {
      const c = await reservar.cotizarPorFechas({ paqueteId: 9601, hotelId: 9301, fechaIda: est.entrada, fechaRegreso: est.salida });
      const doble = c.ok ? c.combos[0]?.precios?.doble : null;
      console.log(`  cotización con la entrada precargada (${est.entrada} → ${est.salida}): doble ${c.ok ? pesos(doble) : c.error}`);
      ok(doble === 550000, "la cotización precargada da 550.000 (paridad con lo anunciado)");
      const c2 = await reservar.cotizarPorFechas({ paqueteId: 9601, hotelId: 9301, fechaIda: "2027-01-05", fechaRegreso: "2027-01-10" });
      ok(c2.ok && c2.combos[0]?.precios?.doble === 600000, `la otra entrada posible (05/01) vale 600.000 (${c2.ok ? pesos(c2.combos[0]?.precios?.doble) : c2.error})`);
    }
  }
}

// ── Modo «revision»: deja datos para que el dueño revise en pantalla (con las acciones reales, no SQL suelto) ──
if (MODO === "revision") {
  console.log("\n### Revisión: hotel 9307 (etiqueta por acomodación) y cambio pendiente persistente (P3)");
  // Combinación del proveedor para «PROMO DOBLE»: acumula con EBB y con Long Stay; orden promoción → EBB → Long Stay.
  const rc = await hoteles.guardarCombinacionPromocion(930710, { acumulable: { ebb: true, long_stay: true }, orden: ["promocion", "ebb", "long_stay"] });
  ok(rc.ok, `combinación de «PROMO DOBLE» configurada${rc.ok ? "" : ": " + rc.error}`);
  const g = await paq.generarTarifario(9307);
  ok(g?.ok, `tarifario del paquete 9307 generado y publicado${g?.ok ? "" : ": " + g?.error}`);
  const c = await reservar.cotizarPorFechas({ paqueteId: 9307, hotelId: 9307, fechaIda: "2027-06-07", fechaRegreso: "2027-06-10" });
  const etq = c.ok ? (c.combos[0]?.descuentoHotel?.etiqueta ?? c.descuentoHotel?.etiqueta ?? "") : c.error;
  console.log(`  9307 del 07/06 al 10/06/2027: doble ${c.ok ? pesos(c.combos[0].precios.doble) : "—"} · triple ${c.ok ? pesos(c.combos[0].precios.triple) : "—"} · etiqueta «${etq}»`);
  ok(c.ok && c.combos[0].precios.doble === 297000 && c.combos[0].precios.triple === 287000 && /^Doble: .*EBB.* · Triple: .*Long Stay/.test(etq), "etiqueta por acomodación (doble 297.000, triple 287.000)");
  // P3: abrir la compra de «P3 TARDIA» deja el cambio PENDIENTE (persistente); se sigue vendiendo la versión autorizada.
  const r = await hoteles.actualizarTemporada(930711, { hotelId: 9307, nombre: "P3 TARDIA", inicio: "2027-06-20", fin: "2027-06-30", prioridad: 2, minNoches: 1,
    compraInicio: "2026-01-01", compraFin: "2027-05-31", tipo: "descuento_pct", descuentoValor: 20, regimenRestringido: null, rangos: [], blackouts: [], condicionPagoTipo: null });
  ok(r.ok && !!r.cambioPendiente, `«P3 TARDIA»: cambio PENDIENTE guardado${r.ok ? "" : ": " + r.error}`);
  ok(sql("select count(*) from public.hotel_promocion_cambio_pendiente where promocion_id = 930711") === "1" && sql("select compra_fin from public.hotel_temporadas where id = 930711") === "2026-02-01",
    "pendiente en la base y la vigencia autorizada sin cambios");

  // Promoción NUEVA por grupo (hotel 9309, fixture_revision_43.sql): se ensaya el recorrido del dueño con las acciones reales y se
  // deshace, para que él lo haga desde cero. Base Semana 100.000 → promoción −10 % = 90.000 calculado; base 120.000 → 108.000;
  // en ningún momento existe una fila de tarifa para la promoción.
  console.log("\n### Revisión: promoción nueva por grupo (hotel 9309, paquete 9605, 1 noche)");
  const acc9 = await imp("app/(dashboard)/dashboard/producto/hoteles/[id]/grupos-actions.ts");
  const { planActivacion: plan9, payloadHabilitaciones: pay9 } = await imp("lib/hoteles/activacionGrupos.ts");
  const al9 = await acc9.leerAlcanceGrupos(930901);
  if (!al9.ok) ok(false, `leer alcance 9309: ${al9.error}`);
  else {
    const p = plan9(al9.alcance);
    const r9 = await acc9.aplicarGruposVenta(930901, al9.alcance.huella, pay9(p, new Set(p.habilitaciones.map((h) => h.clave))));
    ok(r9.ok, `9309: Semana 100.000 / Fin de semana 150.000 aplicados a la venta${r9.ok ? "" : ": " + r9.error}`);
  }
  const desde9 = () => sql("select coalesce(min(precio_pvp)::int::text, '—') from public.tarifario_resultado_publicable where paquete_id = 9605 and acomodacion = 'doble'");
  const filasPromo = () => sql("select count(*) from public.tarifa_hotel t join public.hotel_temporadas v on v.hotel_id = t.hotel_id and v.nombre = t.temporada where t.hotel_id = 9309 and v.tipo <> 'tarifa'");
  ok(desde9() === "100000", `sin promoción, el «desde» de 9605 es la base de la Semana (${desde9()})`);
  const cp = await hoteles.crearTemporada({ hotelId: 9309, nombre: "ENSAYO PROMO GRUPO", inicio: "2027-02-01", fin: "2027-02-28", prioridad: 2, minNoches: 1,
    tipo: "descuento_pct", descuentoValor: 10, regimenRestringido: null, rangos: [], blackouts: [], condicionPagoTipo: null });
  ok(cp.ok, `crear la promoción −10 %${cp.ok ? "" : ": " + cp.error}`);
  const idPromo = Number(sql("select id from public.hotel_temporadas where hotel_id = 9309 and nombre = 'ENSAYO PROMO GRUPO'"));
  const rg = await hoteles.guardarReglasPromocion({ hotelId: 9309, promocionId: idPromo, baseId: 930901,
    reglas: [{ grupo_id: "00000000-0000-4000-8000-0000000c0901", valor: 10, dias: null }], previas: { base: null, reglas: [] } });
  ok(rg.ok, `reglas por grupo: Semana −10 % sobre la base ALTA${rg.ok ? "" : ": " + rg.error}`);
  ok(desde9() === "90000" && filasPromo() === "0", `resultado automático 90.000 sin fila promocional (desde ${desde9()} · filas de la promoción ${filasPromo()})`);
  // Vista explicativa de «Tarifas generadas»: los MISMOS datos que lee la ficha (vigencias con reglas + tarifas, con RLS).
  const { promocionesDinamicasHotel } = await imp("lib/hoteles/promocionesDinamicas.ts");
  const { SELECT_PROMO_VIGENCIA } = await imp("lib/calc/promocionesGrupo.ts");
  const vista = async () => {
    const sb = await createClient();
    const [{ data: tv }, { data: tt }] = await Promise.all([
      sb.from("hotel_temporadas").select(`id, nombre, tipo, prioridad, descuento_valor, regimen_restringido, min_noches, hotel_temporada_grupos(id, nombre, dias, activo), ${SELECT_PROMO_VIGENCIA}`).eq("hotel_id", 9309),
      sb.from("tarifa_hotel").select("*").eq("hotel_id", 9309),
    ]);
    const p = promocionesDinamicasHotel(tv ?? [], tt ?? [], []).find((x) => x.id === idPromo);
    const l = p?.lineas.find((x) => x.acomodacion === "Doble");
    return l ? `${l.base} · ${l.grupo} · ${l.categoria} · ${l.regimen} · ${l.acomodacion}: ${l.netoBase} − ${l.valor} = ${l.netoResultante}` : "(sin línea)";
  };
  const v90 = await vista();
  ok(v90 === "ALTA · Semana · Estándar · PAM · Doble: 100000 − 10 = 90000", `vista «Tarifas generadas»: ${v90}`);
  // La base de un grupo que se vende se cambia como en la ficha: «Grupos de días» → editar la propuesta → «Aplicar cambios a la venta».
  const { ACOMS, extrasDe } = await imp("lib/hoteles/alcanceGrupos.ts");
  const tarifaSemana = async (doble) => {
    const cfg = await acc9.leerConfigGrupos(930901);
    if (!cfg.ok) return cfg;
    const p = cfg.config.propuestas.find((x) => x.grupo_id === "00000000-0000-4000-8000-0000000c0901");
    const netos = { ...Object.fromEntries(ACOMS.map((a) => [a.col, p[a.col] ?? null])), neto_doble: doble };
    const g = await acc9.guardarPropuestaGrupos(930901, cfg.config.huella, "actualizar", null,
      [{ grupo_id: p.grupo_id, tipo_habitacion: p.tipo_habitacion, alimentacion: p.alimentacion, netos, origen_tarifa_id: p.origen_tarifa_id, extras: extrasDe(p) }]);
    if (!g.ok) return g;
    const al = await acc9.leerAlcanceGrupos(930901);
    if (!al.ok) return al;
    const pl = plan9(al.alcance);
    return acc9.aplicarGruposVenta(930901, al.alcance.huella, pay9(pl, new Set(pl.habilitaciones.map((h) => h.clave))));
  };
  const tb = await tarifaSemana(120000);
  ok(tb.ok, `base de la Semana a 120.000${tb.ok ? "" : ": " + tb.error}`);
  ok(desde9() === "108000" && filasPromo() === "0", `la promoción se recalcula sola: 108.000 sin escribir tarifa promocional (desde ${desde9()} · filas ${filasPromo()})`);
  const v108 = await vista();
  ok(v108 === "ALTA · Semana · Estándar · PAM · Doble: 120000 − 10 = 108000" && filasPromo() === "0", `vista tras subir la base: ${v108} (sin fila promocional)`);
  // Se deshace el ensayo: el dueño parte de la base 100.000 sin promoción.
  const d1 = await hoteles.eliminarTemporada(idPromo, 9309), d2 = await tarifaSemana(100000);
  ok(d1.ok && d2.ok && desde9() === "100000", `ensayo deshecho: sin promoción y base 100.000 (desde ${desde9()})`);
  console.log(`\n=== ${fallos} fallo(s)`);
  proxy.close();
  process.exit(fallos ? 1 : 0);
}

// ── 2) Conteo de solicitudes a PostgREST ──
console.log("\n### 2) Conteo de solicitudes (PostgREST) por operación");
for (const id of [9602, 9603, 9604, 9306]) {
  const g = await paq.generarTarifario(id);
  if (!g?.ok) ok(false, `generar el tarifario del paquete ${id}: ${g?.error}`);
}
const comp = sql("select string_agg(paquete_id || ':' || (case when (composicion::jsonb ? 'promociones') then 'con promociones' else 'sin promociones' end), ', ' order by paquete_id) from public.tarifario_resultado_composicion where paquete_id in (9602, 9603)");
console.log(`  composición publicada de los dinámicos: ${comp || "(sin composición)"}`);
async function contar(etiqueta, fn) {
  registro = [];
  const r = await fn();
  const n = registro.length, detalle = [...registro];
  registro = null;
  return { etiqueta, n, detalle, r };
}
const reservaBase = (o) => ({ bloqueoId: null, categoria: "Estándar", regimen: "PAM", habitaciones: { doble: 1 }, ninos: 0, ninos2: 0, infantes: 0, edadesMenores: [], cantidadMenores: 0,
  cliente: { nombres: "", apellidos: "", tipoDoc: "CC", numeroDoc: "", telefono: "", email: "" }, tipoAsesor: "interno", asesorInterno: "", agenciaNombre: "", agenciaAsesor: "", freelanceNombre: "", aliadoId: null, plazo: "", pasajeros: [], servicios: [], ...o });
const medidas = [
  await contar("cotizar por fechas · porción CON promoción (9306)", () => reservar.cotizarPorFechas({ paqueteId: 9306, hotelId: 9306, fechaIda: "2027-06-07", fechaRegreso: "2027-06-10" })),
  await contar("cotizar por fechas · porción SIN promoción (9308)", () => reservar.cotizarPorFechas({ paqueteId: 9604, hotelId: 9308, fechaIda: "2027-06-07", fechaRegreso: "2027-06-10" })),
  await contar("reserva sobre tarifa PUBLICADA · dinámico CON promoción (9306)", async () => computarReserva(await createClient(), reservaBase({ paqueteId: 9602, modulo: "dinamico", salidaId: 960201, hotelId: 9306 }))),
  await contar("reserva sobre tarifa PUBLICADA · dinámico SIN promoción (9308)", async () => computarReserva(await createClient(), reservaBase({ paqueteId: 9603, modulo: "dinamico", salidaId: 960301, hotelId: 9308 }))),
];
for (const m of medidas) {
  const okR = m.r?.ok !== false;
  const combis = m.detalle.filter((d) => /hotel_temporadas/.test(d)).length;
  console.log(`  ${String(m.n).padStart(3)} solicitudes · ${m.etiqueta}${okR ? "" : ` (resultado: ${m.r?.error})`} · lecturas de hotel_temporadas: ${combis}`);
  console.log(`      ${m.detalle.join(" · ")}`);
}
console.log(`CONTEO_JSON ${JSON.stringify(Object.fromEntries(medidas.map((m) => [m.etiqueta, m.n])))}`);
console.log(`\n=== ${fallos} fallo(s)`);
proxy.close();
process.exit(fallos ? 1 : 0);
