// RECORRIDO LOCAL REAL de #125 con el CÓDIGO REAL de las acciones de servidor (lo lanza recorrido_125.sh, que crea la base y PostgREST desechables).
// Solo se sustituyen `next/headers` (cookie de sesión como @supabase/ssr), `next/cache` y `server-only`; un GoTrue mínimo responde getUser() con el usuario del token.
// computarReserva, cotizar, liquidación, composición, resumen por pasajero, conversión y finanzas del contrato son los REALES (RLS con el JWT `authenticated`).
// Cada escenario: acción → RELEER de la base (ventas, contrato_items, CxP del hotel, composición, resumen congelado) y comparar con la CUENTA A MANO escrita al lado.
// Mercado: COP, markup 20 % (pct_mk 0,2): venta = neto / 0,8 y PVP por persona redondeado hacia arriba al millar.
import { createHmac } from "node:crypto";
import { execSync } from "node:child_process";
import nodeModule from "node:module";
import http from "node:http";

const REST = process.env.R125_REST, SECRETO = process.env.R125_SECRETO, PS = process.env.R125_PS;
const b64 = (s) => Buffer.from(s).toString("base64url");
const jwt = (p) => { const h = b64(JSON.stringify({ alg: "HS256", typ: "JWT" })); const c = b64(JSON.stringify({ ...p, exp: Math.floor(Date.now() / 1000) + 7200 }));
  return `${h}.${c}.${createHmac("sha256", SECRETO).update(`${h}.${c}`).digest("base64url")}`; };
const USUARIOS = {
  oper: { sub: "00000000-0000-4000-8000-000000012501", sid: "00000000-0000-4000-8000-00000000b501", email: "t125-oper@x.test", nombre: "T125 Operaciones" },
  venta: { sub: "00000000-0000-4000-8000-000000012502", sid: "00000000-0000-4000-8000-00000000b502", email: "t125-venta@x.test", nombre: "T125 Venta" },
};
Object.assign(process.env, { NEXT_PUBLIC_SUPABASE_URL: REST.replace(/\/$/, "") + "/__", NEXT_PUBLIC_SUPABASE_ANON_KEY: jwt({ role: "anon" }), SUPABASE_SERVICE_ROLE_KEY: jwt({ role: "service_role" }) });
delete process.env.CRON_SECRET; delete process.env.MANTENIMIENTO_CLAVE;

let solicitudes = 0; // consumo: cada llamada HTTP a PostgREST equivale a una solicitud a Supabase en producción
const destino = new URL(REST);
const proxy = http.createServer((req, res) => {
  if (req.url.startsWith("/__/auth/v1/user")) {
    // GoTrue mínimo: responde el usuario del token de la petición.
    let sub = USUARIOS.oper.sub, email = USUARIOS.oper.email;
    try { const t = String(req.headers.authorization ?? "").replace(/^Bearer /, "").split(".")[1]; const c = JSON.parse(Buffer.from(t, "base64url").toString()); if (c.sub) { sub = c.sub; email = Object.values(USUARIOS).find((u) => u.sub === sub)?.email ?? email; } } catch { /* usuario por defecto */ }
    res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ id: sub, aud: "authenticated", role: "authenticated", email })); return;
  }
  solicitudes++;
  const ruta = req.url.replace(/^\/__\/rest\/v1/, "").replace(/^\/__/, "") || "/";
  const p = http.request({ host: destino.hostname, port: destino.port, path: ruta, method: req.method, headers: { ...req.headers, host: destino.host } }, (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
  p.on("error", (e) => { res.writeHead(502); res.end(String(e)); });
  req.pipe(p);
});
await new Promise((ok) => proxy.listen(0, "127.0.0.1", ok));
process.env.NEXT_PUBLIC_SUPABASE_URL = `http://127.0.0.1:${proxy.address().port}/__`;

function entrar(clave) {
  const u = USUARIOS[clave];
  const token = jwt({ role: "authenticated", sub: u.sub, session_id: u.sid, aud: "authenticated" });
  const sesion = JSON.stringify({ access_token: token, token_type: "bearer", expires_in: 7200, expires_at: Math.floor(Date.now() / 1000) + 7200, refresh_token: "x", user: { id: u.sub, aud: "authenticated", role: "authenticated" } });
  globalThis.__r125 = { cookie: { name: "sb-127-auth-token", value: "base64-" + Buffer.from(sesion).toString("base64url") } };
}
entrar("oper");
const datos = (src) => `data:text/javascript,${encodeURIComponent(src)}`;
nodeModule.registerHooks({ resolve(s, c, n) {
  if (s === "server-only") return { url: datos("export {}"), shortCircuit: true };
  if (s === "next/headers") return { url: datos("export async function cookies(){ const c = globalThis.__r125.cookie; return { getAll: () => [c], get: (n) => (n === c.name ? c : undefined), set(){} }; } export async function headers(){ return new Map([['host','localhost']]); }"), shortCircuit: true };
  if (s === "next/cache") return { url: datos("export function revalidatePath(){} export function revalidateTag(){} export function unstable_noStore(){}"), shortCircuit: true };
  if (s.startsWith(".") && !/\.[cm]?[jt]sx?$/.test(s)) { for (const ext of [".ts", ".tsx", "/index.ts"]) { try { return n(s + ext, c); } catch { /* siguiente */ } } }
  return n(s, c);
} });

const sql = (q) => execSync(`${PS} -c "${q.replace(/"/g, '\\"')}"`, { encoding: "utf8" }).trim();
const sqlJson = (q) => { const t = sql(q); return t ? JSON.parse(t) : null; };
let fallos = 0, aciertos = 0;
const ok = (c, m) => { console.log(`  ${c ? "PASS " : "FALLO"} ${m}`); if (c) aciertos++; else fallos++; };
const igual = (obs, esp, m) => ok(Math.abs(Number(obs) - Number(esp)) < 0.005, `${m}: observado ${pesos(obs)} · esperado ${pesos(esp)}`);
const pesos = (n) => Number(n).toLocaleString("es-CO", { maximumFractionDigits: 2 });
const titulo = (t) => console.log(`\n### ${t}`);

const reservar = await import("../../app/(dashboard)/dashboard/reservar/actions.ts");
const hoteles = await import("../../app/(dashboard)/dashboard/producto/hoteles/actions.ts");
const checkout = await import("../../app/tarifario/checkout/actions.ts");

// ── Entradas ─────────────────────────────────────────────────────────────
const nac = (edad, ida) => `${Number(ida.slice(0, 4)) - edad}-01-01`; // cumple el 1 de enero: la edad a la entrada es exacta
const CLIENTE = { nombres: "Cliente", apellidos: "Recorrido125", tipoDoc: "CC", numeroDoc: "125999", telefono: "3000000000", email: "cliente@local.test" };
let seqDoc = 0;
const adulto = (i, ida) => ({ nombres: `Adulto${i}`, apellidos: "R125", tipoDoc: "CC", numeroDoc: `125${100 + i}`, fechaNacimiento: "1985-03-04", nacionalidad: "Colombia", esInfante: false });
const menor = (edad, ida, infante = false) => ({ nombres: `Menor${edad}`, apellidos: "R125", tipoDoc: "RC", numeroDoc: `126${++seqDoc}${edad}`, fechaNacimiento: nac(edad, ida), nacionalidad: "Colombia", esInfante: infante, ...(infante ? { responsableIndex: 1 } : {}) });
const pasajeros = (adultos, edades, ida) => [...Array.from({ length: adultos }, (_, i) => adulto(i + 1, ida)), ...edades.map((e) => menor(e, ida, e <= 2))];
const reservaDe = (o) => ({
  paqueteId: o.hotel, bloqueoId: null, modulo: "porcion_terrestre", hotelId: o.hotel, fechaIda: o.ida, fechaRegreso: o.regreso, categoria: "Estandar", regimen: "PAM",
  habitaciones: o.hab ?? { doble: 1 }, ninos: 0, ninos2: 0, infantes: 0, ...(o.edades === undefined ? {} : { edadesMenores: o.edades, cantidadMenores: o.edades.length }),
  ...(o.salidaId ? { modulo: "dinamico", salidaId: o.salidaId, bloqueoId: null } : {}),
  ...(o.manual ?? {}), cliente: CLIENTE, tipoAsesor: "interno", asesorInterno: USUARIOS.oper.nombre, agenciaNombre: "", agenciaAsesor: "", freelanceNombre: "", plazo: "",
  pasajeros: o.pasajeros ?? pasajeros(2 * Object.values(o.hab ?? { doble: 1 }).reduce((a, b) => a + b, 0), o.edades ?? [], o.ida), servicios: [],
});

const { identidadDe } = await import("../../lib/contrato/identidad.ts");
/** Confirma el contrato con la acción REAL (confirmarVenta): las obligaciones previstas (288) se materializan como CxP. */
async function confirmar(numero) {
  const uid = sql(`select contrato_uid from public.ventas where numero_contrato = '${numero}'`);
  const r = await reservar.confirmarVenta(numero, identidadDe(numero, uid));
  return r;
}
/** Lee de la BASE lo que dejó un contrato: precio, costo del hotel, CxP, ítems y su suma. */
function leerContrato(numero) {
  const v = sqlJson(`select row_to_json(t) from (select precio_venta, costo_hotel from public.ventas where numero_contrato = '${numero}') t`);
  const cxpFilas = sqlJson(`select coalesce(json_agg(row_to_json(t)), '[]') from (select tipo_proveedor, proveedor, servicio, valor_total from public.cuentas_por_pagar where numero_contrato = '${numero}') t`);
  const previstas = sqlJson(`select coalesce(json_agg(payload), '[]') from public.contrato_obligaciones_previstas where numero_contrato = '${numero}' and clase = 'cxp'`);
  const previsto = previstas.filter((x) => /hotel/i.test(String(x.tipo_proveedor) + " " + String(x.servicio))).reduce((s, x) => s + Number(x.valor_total), 0);
  const cxp = cxpFilas.filter((x) => /hotel/i.test(String(x.tipo_proveedor) + " " + String(x.servicio))).reduce((s, x) => s + Number(x.valor_total), 0);
  if (process.env.R125_DEBUG) console.log("  CxP filas:", JSON.stringify(cxpFilas), "| financiero_estado:", sql(`select financiero_estado from public.ventas where numero_contrato = '${numero}'`), "| CxP totales en la base:", sql("select count(*) from public.cuentas_por_pagar"), "| pendientes:", sql("select count(*) from public.contrato_financiero_pendiente"));
  const items = sqlJson(`select coalesce(json_agg(row_to_json(t) order by id), '[]') from (select id, descripcion, adultos, ninos, tarifa_adulto, tarifa_nino, valor_total, modo_precio from public.contrato_items where numero_contrato = '${numero}') t`);
  const suma = items.reduce((s, i) => s + (i.modo_precio === "total" ? Number(i.valor_total ?? 0) : Number(i.adultos) * Number(i.tarifa_adulto) + Number(i.ninos) * Number(i.tarifa_nino)), 0);
  const gratis = items.filter((i) => /Niño gratis por habitación/.test(i.descripcion));
  return { precio: Number(v.precio_venta), costo: Number(v.costo_hotel), previsto, cxp, items, suma, gratis };
}
const composicionDe = (cotId) => sqlJson(`select composicion::text from public.cotizacion_composicion where cotizacion_id = ${cotId}`);
const detalleDe = (cotId) => sqlJson(`select coalesce(detalle, '{}'::jsonb)::text from public.cotizaciones where id = ${cotId}`);

/** Reservar: crearCotizacion → convertirCotizacion, releyendo la base. `esp` = cuenta a mano. */
async function reservarJornada(nombre, o, esp) {
  titulo(nombre);
  const reserva = reservaDe(o);
  const cot = await reservar.crearCotizacion(reserva);
  if (!cot.ok) { ok(false, `crear cotización: ${cot.error}`); return null; }
  const comp = composicionDe(cot.id);
  const cuadra = comp?.hoteles?.[0]?.composicion?.cuadra;
  console.log(`  cotización ${cot.id}: composición guardada ${comp ? "sí" : "NO"} · cuadra=${cuadra}`);
  ok(cuadra === true, "la composición guardada cuadra (Σ líneas + adicionales = total)");
  const conv = await reservar.convertirCotizacion(cot.id, reserva.pasajeros, undefined, undefined, null, o.monedaCobro ?? null, null);
  if (!conv.ok) { ok(false, `convertir a contrato: ${conv.error}`); return null; }
  const c = leerContrato(conv.numero);
  console.log(`  contrato ${conv.numero}: precio ${pesos(c.precio)} · costo_hotel ${pesos(c.costo)} · hotel PREVISTO ${pesos(c.previsto)} · Σ ítems ${pesos(c.suma)}`);
  for (const i of c.items) console.log(`    ítem: ${i.descripcion} | adultos ${i.adultos} × ${pesos(i.tarifa_adulto)} + niños ${i.ninos} × ${pesos(i.tarifa_nino)}`);
  if (esp.precio !== undefined) igual(c.precio, esp.precio, "precio de venta del contrato");
  if (esp.costo !== undefined) {
    igual(c.costo, esp.costo, "ventas.costo_hotel (releído de la base)");
    igual(c.previsto, esp.costo, "obligación PREVISTA con el hotel (contrato pendiente, 288)");
    const conf = await confirmar(conv.numero);
    ok(conf.ok, `confirmarVenta real${conf.ok ? "" : ": " + conf.error}`);
    const despues = leerContrato(conv.numero);
    igual(despues.cxp, esp.costo, "CxP del hotel MATERIALIZADA al confirmar (releída de la base)");
  }
  igual(c.suma, c.precio, "Σ ítems del contrato = precio de venta");
  if (esp.gratis !== undefined) {
    ok(c.gratis.length === (esp.gratis === 0 ? 0 : 1), `línea firmada «Niño gratis por habitación»: ${c.gratis.length} (esperada ${esp.gratis === 0 ? 0 : 1})`);
    if (esp.gratis !== 0 && c.gratis[0]) igual(Number(c.gratis[0].adultos) * Number(c.gratis[0].tarifa_adulto), -esp.gratis, "importe de la línea firmada (venta condonada con el compositor)");
  }
  if (esp.descripcion) ok(esp.descripcion.test(c.gratis[0]?.descripcion ?? ""), `la línea nombra habitación, edad y tarifa: «${c.gratis[0]?.descripcion ?? "(sin línea)"}»`);
  return { cot, conv, c, comp };
}

// ═══════════════════════════════════════════════════════════════════════════════
// S1 (F1) H2 «R125 ESTADIA», 2 noches desde 5-dic, 1 doble + niño de 8 años. BASE X: adulto 200.000, niño 100.000 por noche; promoción −10 % (5–12 dic) + niño gratis;
//   promoción de estadía «noche gratis» (promedio: la mitad del total).
//   Adulto: 2 × 180.000 = 360.000 → × ½ = 180.000 neto por persona → venta 225.000 (PVP 225.000) → 2 adultos 450.000.
//   Niño:   2 × 90.000 = 180.000 → × ½ = 90.000 pagadero → venta 112.500 → PVP 113.000 (redondeo al millar). Gratis: se condona el PVP completo (113.000); el niño paga 0.
//   Precio = 450.000. Costo del hotel = 2 × 180.000 + 90.000 − 90.000 = 360.000 (el valor erróneo de la auditoría era 270.000).
// ═══════════════════════════════════════════════════════════════════════════════
await reservarJornada("S1 (F1) estadía con noche gratis «promedio» + niño gratis — Reservar", { hotel: 126002, ida: "2026-12-05", regreso: "2026-12-07", edades: [8] },
  { precio: 450000, costo: 360000, gratis: 113000 });
// S2a «ultima»: 3 noches desde 4-dic. Adulto 3 × 180.000 = 540.000 − 180.000 (última noche) = 360.000 → venta 450.000 → 2 adultos 900.000.
//   Niño 3 × 90.000 = 270.000 − 90.000 = 180.000 pagadero → venta 225.000 (PVP 225.000) → se condona 225.000. Precio 900.000. Costo = 2 × 360.000 + 180.000 − 180.000 = 720.000.
await reservarJornada("S2a estadía con noche gratis «ultima» + niño gratis — Reservar", { hotel: 126005, ida: "2026-12-04", regreso: "2026-12-07", edades: [8] },
  { precio: 900000, costo: 720000, gratis: 225000 });
// S2b monto fijo 30.000 por persona de la estadía: 2 noches desde 4-dic. Adulto 360.000 − 30.000 = 330.000 → venta 412.500 → PVP 413.000 → 2 adultos 826.000.
//   Niño 180.000 − 30.000 = 150.000 → venta 187.500 → PVP 188.000 → se condona 188.000. Precio 826.000. Costo = 2 × 330.000 + 150.000 − 150.000 = 660.000.
await reservarJornada("S2b estadía con monto fijo por persona + niño gratis — Reservar", { hotel: 126006, ida: "2026-12-04", regreso: "2026-12-06", edades: [8] },
  { precio: 826000, costo: 660000, gratis: 188000 });
// S2c estadía PARCIAL: H2 (promoción desde el 5-dic), 4 noches desde 4-dic: noche 4 base (200.000 / 100.000), noches 5–7 con promoción (180.000 / 90.000); noche gratis «promedio» × ¾.
//   Adulto (200.000 + 3 × 180.000) × ¾ = 555.000 → venta 693.750 → PVP 694.000 → 2 adultos 1.388.000.
//   Niño (100.000 + 3 × 90.000) × ¾ = 277.500 → venta 346.875 → PVP 347.000. Pagadero de las noches de la promoción = 3 × 90.000 × ¾ = 202.500; queda a cargo del niño la noche 4: 75.000 → PVP 94.000.
//   Condonado (venta) = 347.000 − 94.000 = 253.000 → el niño paga 94.000. Precio = 1.388.000 + 347.000 − 253.000 = 1.482.000. Costo = 2 × 555.000 + 277.500 − 202.500 = 1.185.000.
await reservarJornada("S2c estadía PARCIALMENTE promocional (noche 4 sin promoción) — Reservar", { hotel: 126002, ida: "2026-12-04", regreso: "2026-12-08", edades: [8] },
  { precio: 1482000, costo: 1185000, gratis: 253000 });

// S2d (EBB legítimo): H4, 2 noches desde 10-ene-2027 (≈ 54 días de anticipación ⇒ EBB 12 % con umbral 30 aplica HOY; la fecha de la prueba es la del servidor, válida hasta el 11-dic-2026),
//   1 doble + niño de 8. Promoción SIGUE E (−10 %, niño gratis) + estadía NOCHE GRATIS «promedio» (×½) + EBB 12 %. La promoción nace PENDIENTE (301): primero se configura con la acción real
//   guardarCombinacionPromocion({acumulable:{ebb:true}}) sobre 12600402 (SIGUE E) Y 12600403 (NOCHE GRATIS: también nace pendiente por coincidir con EBB). Cuenta a mano (la regla EBB va sobre la neta hotelera de la estadía, DESPUÉS de la promoción de estadía; decisión #90):
//   Adulto: 2 × 180.000 = 360.000 × ½ = 180.000 × 0,88 = 158.400 → venta 198.000 → 2 adultos 396.000.
//   Niño:   2 × 90.000 = 180.000 × ½ = 90.000 × 0,88 = 79.200 pagadero → venta 99.000. Gratis: se condona 99.000 (neto 79.200).
//   Precio = 396.000. Costo del hotel = 2 × 158.400 + 79.200 − 79.200 = 316.800.
titulo("S2d (EBB) H4: promoción que sigue la base + noche gratis «promedio» + EBB 12 % acumulable + niño gratis — Reservar");
entrar("oper");
const comb = await hoteles.guardarCombinacionPromocion(12600402, { acumulable: { ebb: true } });
ok(comb.ok, `guardarCombinacionPromocion(12600402, ebb acumulable)${comb.ok ? "" : ": " + comb.error}`);
// 301: la promoción de estadía también nace PENDIENTE donde coincide con EBB y el motor la ignora (no se vende) hasta configurarla: se configura igual.
const comb2 = await hoteles.guardarCombinacionPromocion(12600403, { acumulable: { ebb: true } });
ok(comb2.ok, `guardarCombinacionPromocion(12600403 NOCHE GRATIS, ebb acumulable)${comb2.ok ? "" : ": " + comb2.error}`);
console.log(`  (antes) promociones del hotel 126004 y su combinación: ${sql("select string_agg(t.id || '/' || t.nombre || '=' || coalesce(c.estado, 'sin fila') || coalesce(' alt=' || c.alternativas::text, ''), ' ; ') from public.hotel_temporadas t left join public.hotel_promocion_combinacion c on c.promocion_id = t.id where t.hotel_id = 126004 and t.tipo <> 'tarifa'")}`);
console.log(`  estado de la combinación guardada: ${sql("select coalesce((select estado || ' · acumulable_ebb=' || coalesce(acumulable_ebb::text, 'null') from public.hotel_promocion_combinacion where promocion_id = 12600402), '(sin fila)')")}`);
const s2d = await reservarJornada("S2d cotizar y convertir", { hotel: 126004, ida: "2027-01-10", regreso: "2027-01-12", edades: [8] }, { precio: 396000, costo: 316800, gratis: 99000 });
if (s2d) {
  igual(s2d.c.costo, 2 * 158400, "neto del beneficio = pagadero del niño (79.200): el costo del hotel conserva SOLO a los adultos (2 × 158.400)");
  const g = s2d.comp?.hoteles?.[0]?.composicion;
  console.log("  composición (resumen): " + JSON.stringify({ total: g?.total, cuadra: g?.cuadra, descuento: g?.descuento ?? g?.regla ?? null, lineas: (g?.lineas ?? []).map((l) => [l.concepto ?? l.descripcion, l.valor ?? l.total]) }).slice(0, 700));
  console.log("  ítems: " + s2d.c.items.map((i) => `${i.descripcion} | ${i.adultos}×${pesos(i.tarifa_adulto)} + ${i.ninos}×${pesos(i.tarifa_nino)}`).join(" || "));
}

// ═══════════════════════════════════════════════════════════════════════════════
// S3 H1 «R125 SIGUE», 4 → 9 dic (5 noches: 4–5 en BASE A, 6–8 en BASE B), promoción −10 % que sigue la base de cada noche.
//   Adulto: 2 × 90.000 + 3 × 135.000 = 585.000 neto → venta 731.250 → PVP 732.000 → 2 adultos 1.464.000.
//   Niño 1: 2 × 45.000 + 3 × 67.500 = 292.500 → venta 365.625 → PVP 366.000 (gratis: se condona completo).
//   Niño 2: 2 × 36.000 + 3 × 54.000 = 234.000 → venta 292.500 → PVP 293.000. Infante (sin %): 2 × 20.000 + 3 × 30.000 = 130.000.
// ═══════════════════════════════════════════════════════════════════════════════
await reservarJornada("S3a cruce A→B, 1 doble + 1 niño (8) — Reservar", { hotel: 126001, ida: "2026-12-04", regreso: "2026-12-09", edades: [8] },
  { precio: 1464000, costo: 1170000, gratis: 366000 });
// Dos niños en UNA doble [9, 5] sin edad propia (regla del hotel): el primero declarado (Niño 1) es el gratis; el segundo paga Niño 2.
//   Precio = 1.464.000 + 366.000 + 293.000 − 366.000 = 1.757.000. Costo = 1.170.000 + 292.500 + 234.000 − 292.500 = 1.404.000.
await reservarJornada("S3b cruce A→B, 1 doble + 2 niños [9, 5] — exactamente UNO gratis", { hotel: 126001, ida: "2026-12-04", regreso: "2026-12-09", edades: [9, 5] },
  { precio: 1757000, costo: 1404000, gratis: 366000 });
// Dos habitaciones (H1b: chd_min 1 ⇒ un niño por habitación): 2 dobles + niños [8, 6] ⇒ UN niño gratis POR habitación.
//   Adultos 4 × 732.000 = 2.928.000; 2 × Niño 1 (366.000) = 732.000; gratis 2 × 366.000 = 732.000. Precio 2.928.000. Costo = 4 × 585.000 + 2 × 292.500 − 2 × 292.500 = 2.340.000.
const s3c = await reservarJornada("S3c 2 dobles + niños [8, 6] (chd_min 1) — un niño gratis POR habitación", { hotel: 126007, ida: "2026-12-04", regreso: "2026-12-09", hab: { doble: 2 }, edades: [8, 6] },
  { precio: 2928000, costo: 2340000 });
if (s3c) ok(s3c.c.gratis.length === 1 && /hab\. 1/.test(s3c.c.gratis[0]?.descripcion ?? "") && /hab\. 2/.test(s3c.c.gratis[0]?.descripcion ?? ""), `una sola línea firmada que nombra las dos habitaciones: «${s3c.c.gratis[0]?.descripcion}»`);
if (s3c?.c.gratis[0]) igual(Number(s3c.c.gratis[0].adultos) * Number(s3c.c.gratis[0].tarifa_adulto), -732000, "importe de la línea firmada de las 2 habitaciones");
// Infante con niño gratis: el infante conserva su tarifa base (130.000, sin −10 %). Costo = 1.170.000 (adultos) + 0 (niño gratis) + 130.000 = 1.300.000.
await reservarJornada("S3d cruce A→B, niño (8) gratis + infante (1) — el infante conserva su tarifa base", { hotel: 126001, ida: "2026-12-04", regreso: "2026-12-09", edades: [8, 1] },
  { costo: 1300000, gratis: 366000 });

// ═══════════════════════════════════════════════════════════════════════════════
// S4 (F2) H3 «R125 EDAD» (niño gratis solo de 3 a 6 años), mismas bases que H1.
//   [9, 5]: el niño de 9 ocupa Niño 1 (declarado primero) y el de 5 años Niño 2 ⇒ gratis = Niño 2 (293.000 de PVP); el de 9 paga Niño 1 (366.000).
//   Precio = 1.464.000 + 366.000 + 293.000 − 293.000 = 1.830.000. Costo = 1.170.000 + 292.500 + 234.000 − 234.000 = 1.462.500.
// ═══════════════════════════════════════════════════════════════════════════════
await reservarJornada("S4a (F2) rango 3–6, niños [9, 5]: el de 5 años ocupa Niño 2 ⇒ se condona la tarifa REAL de Niño 2", { hotel: 126003, ida: "2026-12-04", regreso: "2026-12-09", edades: [9, 5] },
  { precio: 1830000, costo: 1462500, gratis: 293000, descripcion: /hab\. 1: niño de 5 años \(Niño 2\)/ });
// [9, 10]: ninguno entre 3 y 6 ⇒ sin beneficio, cotización normal y la explicación visible. Precio = 1.464.000 + 366.000 + 293.000 = 2.123.000. Costo = 1.170.000 + 292.500 + 234.000 = 1.696.500.
{
  const r = await reservarJornada("S4b (F2) rango 3–6, niños [9, 10]: ninguno elegible — sin beneficio y con explicación", { hotel: 126003, ida: "2026-12-04", regreso: "2026-12-09", edades: [9, 10] },
    { precio: 2123000, costo: 1696500, gratis: 0 });
  if (r) {
    const tablas = sql(`select coalesce(string_agg(table_name, ', '), '') from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' and (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from public.%I t where t::text like %L', table_name, '%ningún niño está entre 3–6 años%'), false, true, '')))[1]::text::int > 0`);
    const tablasNota = sql(`select coalesce(string_agg(table_name, ', '), '') from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' and (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from public.%I t where t::text like %L', table_name, '%NOTA R125 no reembolsable%'), false, true, '')))[1]::text::int > 0`);
    console.log(`  (diagnóstico) la NOTA de tarifa existente quedó guardada en: ${tablasNota || "(ninguna tabla)"}`);
    console.log(`  la explicación quedó guardada en: ${tablas || "(ninguna tabla)"}`);
    // HALLAZGO (no es fallo de esta prueba): en la ruta Reservar de un solo hotel la explicación solo vive en la vista previa (computarReserva.condicionesTarifa); no se persiste en cotización ni contrato (solo la ruta de carrito guarda contrato_hoteles.condiciones_tarifa, ver S6e).
    console.log(`  HALLAZGO: ruta Reservar — explicación persistida: ${tablas ? "SÍ (" + tablas + ")" : "NO (solo en la vista previa)"}`);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// S5 (F4) rechazos reales.
// ═══════════════════════════════════════════════════════════════════════════════
titulo("S5 (F4) legacy manual (solo cantidades) con una promoción de niño gratis: se RECHAZA con explicación, no se cotiza sin el beneficio");
{
  const r = await reservar.crearCotizacion(reservaDe({ hotel: 126003, ida: "2026-12-04", regreso: "2026-12-09", manual: { ninos: 1 }, pasajeros: pasajeros(2, [8], "2026-12-04") }));
  console.log(`  respuesta: ok=${r.ok} · ${r.ok ? "(cotizó)" : r.error}`);
  ok(!r.ok && /edad de cada niño/i.test(r.error ?? ""), "rechazada con un mensaje accionable (declarar la edad de cada niño)");
}
titulo("S5b H3 con conteos manuales pero SIN menores: nada se pierde, se cotiza normal");
{
  const r = await reservar.crearCotizacion(reservaDe({ hotel: 126003, ida: "2026-12-04", regreso: "2026-12-09", manual: { ninos: 0 }, pasajeros: pasajeros(2, [], "2026-12-04") }));
  ok(r.ok, `cotiza sin menores${r.ok ? "" : ": " + r.error}`);
}
titulo("S5c H3 con edad propia y menores con edades declaradas pero sin rango aplicable: ya cubierto por S4b (sin rechazo, con explicación)");

// ═══════════════════════════════════════════════════════════════════════════════
// S6 (F3) CARRITO: crearSolicitudReserva → cotizaciones.detalle.resumenPrecios → convertirCotizacionCarrito → contrato_resumen_precios.
// ═══════════════════════════════════════════════════════════════════════════════
const itemCarrito = (hotelId, o) => ({
  itemId: `h${hotelId}`, modulo: "porcion_terrestre", paqueteId: hotelId, hotelId, bloqueoId: null, hotelNombre: o.nombre, destino: "R125 DESTINO", categoria: "Estandar", regimen: "PAM",
  fechaIda: o.ida, fechaRegreso: o.regreso, noches: o.noches, habitaciones: o.hab ?? { doble: 1 }, ninos: 0, ninos2: 0, infantes: 0, pax: 2 + o.edades.length, precio: 1,
  edadesMenores: o.edades, cantidadMenores: o.edades.length,
});
const CLAVES_PROHIBIDAS = /"(neto[A-Za-z]*|netosOrigen|markup|pctMk|porNoche|ninoGratisNoches|costoNeto)"[ ]*:/;
async function carritoJornada(nombre, { hotel, nombre: nombreHotel, ida, regreso, noches, edades, asistencia, sesion, esp, item, monedaCobro, soloCotizacion }) {
  titulo(nombre);
  entrar(sesion);
  const entrada = { items: [item ?? itemCarrito(hotel, { nombre: nombreHotel, ida, regreso, noches, edades })], tours: [], cliente: CLIENTE, ...(asistencia ? { asistencia } : {}) };
  const sol = await checkout.crearSolicitudReserva(entrada);
  if (!sol.ok) { ok(false, `crearSolicitudReserva: ${sol.error}`); return null; }
  const id = sol.cotizacion?.id ?? sol.id;
  const det = detalleDe(id);
  const resumen = det?.resumenPrecios ?? null;
  console.log(`  cotización ${id}: resumenPrecios ${resumen ? "PRESENTE" : "AUSENTE"}${det?.resumenPendiente ? ` · pendiente: ${JSON.stringify(det.resumenPendiente)}` : ""}`);
  ok(!!resumen, "cotizaciones.detalle.resumenPrecios existe (no se omite en silencio)");
  if (resumen) {
    const txt = JSON.stringify(resumen);
    console.log(`  resumen (claves): ${Object.keys(resumen).join(", ")}`);
    ok(!CLAVES_PROHIBIDAS.test(txt), "el resumen guardado no trae neto, markup ni detalle por noche");
    if (process.env.R125_DEBUG) console.log("  resumen:", JSON.stringify(resumen));
    if (esp?.revisar) esp.revisar(resumen, id);
  }
  if (soloCotizacion) return { id, resumen };
  const pas = [...Array.from({ length: 2 }, (_, i) => adulto(i + 1, ida)), ...edades.map((e) => menor(e, ida, e <= 2))];
  const conv = await reservar.convertirCotizacionCarrito(id, { agrupar: "todo", pasajeros: pas, asesorInterno: USUARIOS[sesion].nombre, asignaciones: [pas.map((_, i) => i + 1)], asignacionesTours: [], monedaCobro: monedaCobro ?? "COP" });
  if (!conv.ok) { ok(false, `convertirCotizacionCarrito: ${conv.error}`); return { id, resumen }; }
  const numero = conv.numeros[0];
  const c = leerContrato(numero);
  const congelado = sqlJson(`select resumen::text from public.contrato_resumen_precios where numero_contrato = '${numero}'`);
  console.log(`  contrato ${numero}: precio ${pesos(c.precio)} · costo_hotel ${pesos(c.costo)} · CxP ${pesos(c.cxp)} · Σ ítems ${pesos(c.suma)} · resumen congelado ${congelado ? "SÍ" : "NO"}`);
  ok(!!congelado, "contrato_resumen_precios congeló el resumen (no se pierde en la conversión)");
  if (congelado) ok(!CLAVES_PROHIBIDAS.test(JSON.stringify(congelado)), "el resumen congelado no trae neto, markup ni detalle por noche");
  if (esp?.sumaItems !== undefined) igual(c.suma, esp.sumaItems, "Σ ítems del contrato (en NETO los ítems llevan el PVP; el precio de venta es el neto del aliado)");
  else igual(c.suma, c.precio, "Σ ítems del contrato = precio de venta");
  if (esp?.precio !== undefined) igual(c.precio, esp.precio, "precio de venta del contrato");
  if (esp?.costo !== undefined) {
    igual(c.costo, esp.costo, "ventas.costo_hotel"); igual(c.previsto, esp.costo, "obligación PREVISTA con el hotel (contrato pendiente)");
    entrar("oper"); const conf = await confirmar(numero); ok(conf.ok, `confirmarVenta real${conf.ok ? "" : ": " + conf.error}`);
    igual(leerContrato(numero).cxp, esp.costo, "CxP del hotel MATERIALIZADA al confirmar");
  }
  if (esp?.revisarContrato) esp.revisarContrato(congelado, c, numero);
  return { id, resumen, numero, c, congelado };
}

const B2C = { canal: "b2c" };
const AG = (modo) => ({ canal: "b2b", aliadoId: 12501, modo });
const comun = { hotel: 126002, nombre: "R125 ESTADIA", ida: "2026-12-05", regreso: "2026-12-07", noches: 2, edades: [8] };
const grupos = (r) => r.unidades.flatMap((u) => u.grupos);
/** El resumen por pasajero reconcilia: Σ subtotales de los grupos = total del resumen (y, en PVP, = precio de venta del contrato). */
const cuadraResumen = (r, m_) => ok(grupos(r).reduce((s, g) => s + g.subtotalCentavos, 0) + r.unidades.reduce((s, u) => s + (u.ajusteCentavos ?? 0), 0) === r.totalCentavos, `${m_}: Σ grupos (${pesos(grupos(r).reduce((s, g) => s + g.subtotalCentavos, 0) / 100)}) + ajuste = total del resumen (${pesos(r.totalCentavos / 100)})`);
const tarifaDe = (r, tipo) => grupos(r).filter((g) => g.tipo === tipo).map((g) => g.tarifaCentavos / 100);

// S6a B2C: estadía con noche gratis + niño gratis. Adultos 225.000 × 2 = 450.000; el niño gratis queda en 0 (se condonó su PVP completo de 113.000) — NO desaparece ni se inventa un adulto.
await carritoJornada("S6a CARRITO B2C: niño totalmente gratis (precio 450.000, costo 360.000)", { ...comun, sesion: "venta", asistencia: B2C, esp: { precio: 450000, costo: 360000,
  revisar: (r) => { cuadraResumen(r, "B2C"); ok(r.modalidad === "pvp" && r.totalCentavos === 45000000, "modalidad PVP y total 450.000"); ok(JSON.stringify(tarifaDe(r, "adulto")) === "[225000]" && JSON.stringify(tarifaDe(r, "nino")) === "[0]", `adulto 225.000 y niño 0 (observado adulto ${tarifaDe(r, "adulto")} · niño ${tarifaDe(r, "nino")})`); ok(grupos(r).filter((g) => g.tipo === "adulto").reduce((s, g) => s + g.cantidad, 0) === 2, "sigue habiendo exactamente 2 adultos (sin adulto ficticio)"); } } });
// S6b B2C: el niño NO queda totalmente gratis (estadía parcialmente promocional): su tarifa baja de 347.000 a 94.000 (la noche 4 sin promoción sigue a su cargo). Precio 1.482.000.
await carritoJornada("S6b CARRITO B2C: niño que conserva la noche sin promoción (precio 1.482.000, costo 1.185.000)", { ...comun, ida: "2026-12-04", regreso: "2026-12-08", noches: 4, sesion: "venta", asistencia: B2C, esp: { precio: 1482000, costo: 1185000,
  revisar: (r) => { cuadraResumen(r, "B2C parcial"); ok(r.totalCentavos === 148200000, "total 1.482.000"); ok(JSON.stringify(tarifaDe(r, "adulto")) === "[694000]" && JSON.stringify(tarifaDe(r, "nino")) === "[94000]", `adulto 694.000 y niño 94.000 (observado adulto ${tarifaDe(r, "adulto")} · niño ${tarifaDe(r, "nino")})`); } } });
// S6c B2B asistido COMISIONABLE (agencia 10 %): mismo precio; el resumen existe y reconcilia; la comisión sale del precio realmente cobrado (450.000 → 45.000).
const c6 = await carritoJornada("S6c CARRITO B2B asistido comisionable (agencia 10 %)", { ...comun, sesion: "venta", asistencia: AG("comisionable"), esp: { precio: 450000, costo: 360000,
  revisar: (r) => { cuadraResumen(r, "B2B comisionable"); ok(r.totalCentavos === 45000000, "total 450.000"); ok(JSON.stringify(tarifaDe(r, "nino")) === "[0]", `niño gratis en 0 también en B2B (observado ${tarifaDe(r, "nino")})`); } } });
if (c6?.numero) { const f = sql(`select coalesce(string_agg(row_to_json(t)::text, ';'), '') from (select * from public.aliados_b2b where numero_contrato = '${c6.numero}') t`); console.log(`  comisión comisionable (aliados_b2b): ${f.slice(0, 700) || "(sin fila)"}`); }
// S6d B2B asistido NETO (agencia compra neta): el resumen por pasajero parte del NETO del aliado; el niño gratis sigue en 0 y la suma = total neto exigible.
const c7 = await carritoJornada("S6d CARRITO B2B asistido NETO", { ...comun, sesion: "venta", asistencia: AG("neta"), esp: { precio: 405000, costo: 360000, sumaItems: 450000, revisar: (r) => { console.log(`  modalidad ${r.modalidad} · total ${pesos(r.totalCentavos / 100)} · tarifas adulto ${tarifaDe(r, "adulto")} niño ${tarifaDe(r, "nino")}`); cuadraResumen(r, "NETO"); ok(r.modalidad === "neto", "modalidad NETO"); ok(JSON.stringify(tarifaDe(r, "nino")) === "[0]", "el niño gratis queda en 0 en el NETO"); } } });
if (c7?.numero) { const f = sql(`select coalesce(string_agg(row_to_json(t)::text, ';'), '') from (select * from public.aliados_b2b where numero_contrato = '${c7.numero}') t`); console.log(`  fila de comisión NETO: ${f.slice(0, 400) || "(sin fila)"}`); }
// S6e: la explicación de un niño no elegible viaja al carrito (H3, niños [9, 10]) — diagnóstico de dónde se guarda.
{
  titulo("S6e CARRITO H3 niños [9, 10] (ninguno elegible): ¿dónde queda la explicación y la nota de tarifa?");
  entrar("venta");
  const sol = await checkout.crearSolicitudReserva({ items: [itemCarrito(126003, { nombre: "R125 EDAD", ida: "2026-12-04", regreso: "2026-12-09", noches: 5, edades: [9, 10] })], tours: [], cliente: CLIENTE, asistencia: B2C });
  ok(sol.ok, `cotiza${sol.ok ? "" : ": " + sol.error}`);
  if (sol.ok) {
    const id = sol.cotizacion?.id ?? sol.id;
    const t1 = sql(`select coalesce(string_agg(table_name, ', '), '') from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' and (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from public.%I t where t::text like %L', table_name, '%ningún niño está entre 3–6 años%'), false, true, '')))[1]::text::int > 0`);
    console.log(`  explicación guardada en: ${t1 || "(ninguna tabla)"}`);
    ok(t1 !== "", "la explicación de «niño gratis no aplica» quedó guardada con la cotización del carrito");
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// S8 BÚSQUEDA → cotización: el MISMO total y el MISMO beneficio con la misma ocupación (buscarHoteles real, vía la acción de Reservar) que la cotización que se crea después.
//   `buscarHoteles` parte de `tarifario_resultado_publicable`: se PUBLICA el tarifario de los paquetes con la acción real `generarTarifario` (como la ficha del paquete).
//   H1 (4 → 9 dic, 1 doble + niño de 8): adultos 2 × 732.000 + niño 366.000 − gratis 366.000 = 1.464.000 (beneficio −366.000).
//   H3 (rango 3–6) [9, 5]: 1.464.000 + 366.000 + 293.000 − 293.000 = 1.830.000 (beneficio −293.000 = Niño 2). [9, 10]: ninguno elegible ⇒ 2.123.000 sin beneficio.
// ═══════════════════════════════════════════════════════════════════════════════
titulo("S8 búsqueda → cotización: mismo total y mismo beneficio (buscarHoteles real)");
entrar("oper");
const paquetesActions = await import("../../app/(dashboard)/dashboard/paquetes/actions.ts");
for (const p of [126001, 126003]) {
  const g = await paquetesActions.generarTarifario(p);
  ok(g?.ok !== false, `generarTarifario(${p}) publica el tarifario${g?.ok === false ? ": " + g.error : ""}`);
}
const totalCotizacion = (cotId) => Number(composicionDe(cotId)?.hoteles?.[0]?.composicion?.total);
async function busquedaVsCotizacion(etq, { hotel, ida, regreso, edades, totalEsp, gratisEsp, descripcion }) {
  const b = await reservar.buscarHoteles({ fechaIda: ida, fechaRegreso: regreso, habitaciones: [{ acom: "doble" }], adultos: 2, cantidadMenores: edades.length, edadesMenores: edades, destino: "R125 DESTINO" });
  if (!b.ok) { ok(false, `${etq}: buscarHoteles: ${b.error}`); return; }
  const r = b.resultados.find((x) => x.hotelId === hotel);
  console.log(`  ${etq}: búsqueda → ${r ? `total ${pesos(r.total)} · beneficio ${r.beneficioNinoGratis ? pesos(r.beneficioNinoGratis.total) + " «" + r.beneficioNinoGratis.descripcion + "»" : "(ninguno)"}` : "(el hotel no aparece) " + (b.diagnostico ?? "")}`);
  ok(!!r, `${etq}: el hotel aparece en la búsqueda`);
  if (!r) return;
  igual(r.total, totalEsp, `${etq}: total de la búsqueda (cuenta a mano)`);
  if (gratisEsp) { ok(!!r.beneficioNinoGratis, `${etq}: la búsqueda EXPONE el beneficio (no lo omite)`); if (r.beneficioNinoGratis) igual(r.beneficioNinoGratis.total, -gratisEsp, `${etq}: beneficio de la búsqueda`); }
  else ok(!r.beneficioNinoGratis, `${etq}: sin beneficio (ningún niño elegible), el total no lo supone`);
  if (descripcion) ok(descripcion.test(r.beneficioNinoGratis?.descripcion ?? ""), `${etq}: la búsqueda nombra habitación, edad y tarifa: «${r.beneficioNinoGratis?.descripcion ?? ""}»`);
  const cot = await reservar.crearCotizacion(reservaDe({ hotel, ida, regreso, edades }));
  if (!cot.ok) { ok(false, `${etq}: crearCotizacion: ${cot.error}`); return; }
  igual(totalCotizacion(cot.id), r.total, `${etq}: total de la COTIZACIÓN guardada = total de la BÚSQUEDA`);
}
await busquedaVsCotizacion("S8a H1 [8]", { hotel: 126001, ida: "2026-12-04", regreso: "2026-12-09", edades: [8], totalEsp: 1464000, gratisEsp: 366000 });
await busquedaVsCotizacion("S8b H3 rango 3–6, [9, 5]", { hotel: 126003, ida: "2026-12-04", regreso: "2026-12-09", edades: [9, 5], totalEsp: 1830000, gratisEsp: 293000, descripcion: /hab\. 1: niño de 5 años \(Niño 2\)/ });
await busquedaVsCotizacion("S8c H3 rango 3–6, [9, 10] (ninguno elegible)", { hotel: 126003, ida: "2026-12-04", regreso: "2026-12-09", edades: [9, 10], totalEsp: 2123000, gratisEsp: 0 });
{
  // La búsqueda SOLO acepta edades exactas: unas «cantidades» sin edades no producen precio alguno (no hay un precio que omita el beneficio).
  const r = await reservar.buscarHoteles({ fechaIda: "2026-12-04", fechaRegreso: "2026-12-09", habitaciones: [{ acom: "doble" }], adultos: 2, cantidadMenores: 1, edadesMenores: [], destino: "R125 DESTINO" });
  console.log(`  S8d búsqueda con cantidad de menores sin edades: ok=${r.ok} · ${r.ok ? "(devolvió resultados)" : r.error}`);
  ok(!r.ok, "S8d: la búsqueda rechaza menores sin edad exacta (no cotiza sin el beneficio); el rechazo de conteos manuales en la cotización está en S5");
  // cotizarPorFechas es la tabla de tarifas POR PERSONA de la fecha (no conoce la ocupación): no puede incluir el beneficio; se documenta qué expone.
  const t = await reservar.cotizarPorFechas({ paqueteId: 126001, hotelId: 126001, fechaIda: "2026-12-04", fechaRegreso: "2026-12-09" });
  if (t.ok) {
    const c0 = t.combos[0];
    console.log(`  S8e cotizarPorFechas (por persona): doble ${pesos(c0.precios.doble)} · niño ${pesos(c0.precios.nino)} · claves del combo: ${Object.keys(c0).join(", ")}`);
    ok(c0.precios.doble === 732000 && c0.precios.nino === 366000, "S8e: tarifas por persona de siempre (doble 732.000, niño 366.000), sin descontar nada");
    console.log(`  HALLAZGO S8e: cotizarPorFechas ${JSON.stringify(t).includes("ino gratis") || JSON.stringify(t).toLowerCase().includes("ninogratis") ? "SÍ" : "NO"} avisa de la promoción «niño gratis» (la tabla por persona no depende de la ocupación)`);
  } else ok(false, `S8e: cotizarPorFechas: ${t.error}`);
}



// ═══════════════════════════════════════════════════════════════════════════════
// S7 (F4) OFERTA CON TRM, de verdad: paquete DINÁMICO en modo cop_trm_63 (oferta en COP, TRM 4.000, markup 20 %), hotel en USD, salida manual 4 → 7 dic con tiquete 400.000 COP por adulto
//   (venta del tiquete 400.000 / 0,8 = 500.000). Tarifario PUBLICADO con la acción real generarTarifario (convierte el neto USD × TRM). H5: BASE T doble 100 USD, niño 50 USD; promoción −10 % + niño gratis.
//   3 noches: adulto 3 × 90 = 270 USD → × 4.000 = 1.080.000 → venta 1.350.000 + tiquete 500.000 = 1.850.000 → PVP 1.850.000 → 2 adultos 3.700.000.
//   Niño (8 años: paga el tiquete como adulto): 3 × 45 = 135 USD → 540.000 → venta 675.000 + tiquete 500.000 = 1.175.000 → PVP 1.175.000.
//   Gratis: solo el ALOJAMIENTO. Condonado = PVP del niño − PVP recompuesto sin su hotel = 1.175.000 − 500.000 = 675.000 (el niño sigue pagando el tiquete: 500.000, nunca el paquete completo).
//   Precio = 3.700.000 + 1.175.000 − 675.000 = 4.200.000. Costo del hotel en USD: adultos 2 × 270 + niño 135 − 135 = 540 USD (= 2.160.000 COP a 4.000).
// ═══════════════════════════════════════════════════════════════════════════════
titulo("S7 (F4) oferta con TRM (hotel USD, oferta COP, TRM 4.000) + niño gratis: venta convertida, costo en USD, solo alojamiento");
entrar("oper");
const g7 = await paquetesActions.generarTarifario(126008);
console.log(`  generarTarifario(126008): ${JSON.stringify(g7).slice(0, 300)}`);
ok(g7?.ok !== false, `el tarifario de la oferta con TRM se PUBLICA con la acción real${g7?.ok === false ? ": " + g7.error : ""}`);
console.log(`  filas publicadas del paquete 126008: ${sql("select count(*) from public.tarifario_resultado_publicable where paquete_id = 126008")}`);
const s7 = await reservarJornada("S7 cotizar y convertir (salida dinámica con oferta TRM)", { hotel: 126008, ida: "2026-12-04", regreso: "2026-12-07", edades: [8], salidaId: 12600801, monedaCobro: "COP" },
  { precio: 4200000, gratis: 675000, descripcion: /hab\. 1: niño de 8 años \(Niño 1\)/ });
if (s7) {
  const num = s7.conv.numero;
  const cxp = sqlJson(`select coalesce(json_agg(row_to_json(t)), '[]') from (select tipo_proveedor, servicio, valor_total, moneda from public.cuentas_por_pagar where numero_contrato = '${num}') t`);
  const previstas = sqlJson(`select coalesce(json_agg(payload), '[]') from public.contrato_obligaciones_previstas where numero_contrato = '${num}' and clase = 'cxp'`);
  console.log(`  costo_hotel (COP equivalente): ${pesos(s7.c.costo)} · obligaciones previstas: ${JSON.stringify(previstas).slice(0, 500)}`);
  const conf = await confirmar(num);
  ok(conf.ok, `confirmarVenta real${conf.ok ? "" : ": " + conf.error}`);
  const cxp2 = sqlJson(`select coalesce(json_agg(row_to_json(t)), '[]') from (select tipo_proveedor, servicio, valor_total, moneda from public.cuentas_por_pagar where numero_contrato = '${num}') t`);
  console.log(`  CxP tras confirmar: ${JSON.stringify(cxp2)}`);
  const hotelCxp = cxp2.filter((x) => /hotel/i.test(String(x.tipo_proveedor) + " " + String(x.servicio)));
  ok(hotelCxp.length >= 1, "existe la CxP del hotel");
  if (hotelCxp[0]) {
    ok(String(hotelCxp[0].moneda).toUpperCase() === "USD", `la CxP del hotel conserva la moneda del hotel (USD): ${hotelCxp[0].moneda}`);
    igual(hotelCxp.reduce((t, x) => t + Number(x.valor_total), 0), 540, "CxP del hotel en USD = 2 adultos × 270 + niño (135 − 135 condonado) = 540 USD");
  }
  igual(s7.c.costo, 540 * 4000, "ventas.costo_hotel (equivalente COP a la TRM 4.000) = 540 USD × 4.000");
  const comp = s7.comp?.hoteles?.[0]?.composicion;
  console.log(`  composición: moneda ${comp?.moneda} · trm ${comp?.trm} · cuadra ${comp?.cuadra}`);
  ok(comp?.cuadra === true && Number(comp?.trm) === 4000, "la composición guardada cuadra y lleva la TRM de la oferta");
}

{
  // F4 también en la oferta con TRM: cantidades manuales de niños (sin edades) con la promoción de niño gratis ⇒ rechazo accionable, no una cotización sin el beneficio.
  const r = await reservar.crearCotizacion(reservaDe({ hotel: 126008, ida: "2026-12-04", regreso: "2026-12-07", salidaId: 12600801, manual: { ninos: 1 }, pasajeros: pasajeros(2, [8], "2026-12-04") }));
  console.log(`  S7b conteos manuales en la oferta TRM: ok=${r.ok} · ${r.ok ? "(cotizó)" : r.error}`);
  ok(!r.ok && /edad de cada niño/i.test(r.error ?? ""), "S7b: la oferta con TRM también RECHAZA cantidades sin edades cuando hay un niño gratis (mensaje accionable)");
  // Oferta con TRM SIN TRM (desde la 233 la base ya no la exige; la guarda real es el resolver de la oferta: con una fuente en USD, sin TRM no se cotiza). Se vacía la TRM, se intenta cotizar y se restaura.
  sql("update public.armado_paquetes set trm_oferta = null where id = 126008");
  const sinTrm = await reservar.crearCotizacion(reservaDe({ hotel: 126008, ida: "2026-12-04", regreso: "2026-12-07", edades: [8], salidaId: 12600801 }));
  sql("update public.armado_paquetes set trm_oferta = 4000 where id = 126008");
  console.log(`  S7c oferta con TRM sin TRM: ok=${sinTrm.ok} · ${sinTrm.ok ? "(cotizó)" : sinTrm.error}`);
  ok(!sinTrm.ok && /TRM/i.test(sinTrm.error ?? ""), "S7c: sin TRM en una oferta con hotel en USD NO se cotiza (rechazo explícito, no un total sin convertir)");
}

// ═══════════════════════════════════════════════════════════════════════════════
// S9 (re-auditoría R1/R2) el MISMO niño recibe alojamiento gratis de DOS promociones SUCESIVAS. La composición del PVP y su redondeo se hacen UNA vez por niño real (no una por promoción),
//   y el resumen por pasajero del carrito suma TODAS las entradas del pasajero (resumenPrecios no debe faltar). Todas las cuentas a mano van junto a cada escenario.
// ═══════════════════════════════════════════════════════════════════════════════
const comisionDe = (num) => sqlJson(`select row_to_json(t) from (select precio_venta, base_comision, pct_comision, comision_valor, descontada_en_precio, estado from public.aliados_b2b where numero_contrato = '${num}') t`);
const ambas = (a, b, ...mas) => new RegExp(`^${[a, b, ...mas].map((x) => `(?=.*${x})`).join("")}`, "s");
const noNino = (r) => grupos(r).filter((g) => g.tipo !== "adulto").map((g) => g.tarifaCentavos / 100).sort((x, y) => x - y);
const adultosEn = (r) => grupos(r).filter((g) => g.tipo === "adulto").reduce((s, g) => s + g.cantidad, 0);

// ── S9a H6 «R125 SUCESIVAS» (markup 0): 2 noches desde 4-dic, 1 doble + niño de 8. «S9 UNO» (noche 4) y «S9 DOS» (noche 5), cada una −10 % + niño gratis.
//   Adulto: 2 × 90.000 = 180.000 neto = venta (markup 0) = PVP 180.000 → 2 adultos 360.000.
//   Niño (Niño 1): 2 × 56.000 × 0,9 = 100.800 neto = venta 100.800 → PVP 101.000 (redondeo al millar, UNA sola vez). Gratis en las DOS noches ⇒ se condona el PVP completo, 101.000; el niño paga 0.
//   Precio = 360.000 + 101.000 − 101.000 = 360.000 (el código viejo guardaba 361.000: recomponía el PVP por promoción y dejaba 1.000 al niño). Costo del hotel = 2 × 180.000 + 100.800 − 100.800 = 360.000.
const D9 = ambas("S9 UNO", "S9 DOS", "niño de 8 años \\(Niño 1\\)");
const s9aR = await reservarJornada("S9a RESERVAR (audit R1): dos promociones sucesivas para el mismo niño — total 360.000, no 361.000", { hotel: 126011, ida: "2026-12-04", regreso: "2026-12-06", edades: [8] },
  { precio: 360000, costo: 360000, gratis: 101000, descripcion: D9 });
if (s9aR) {
  const det = detalleDe(s9aR.cot.id);
  console.log(`  S9a Reservar: cotizaciones.detalle.resumenPrecios ${det?.resumenPrecios ? "PRESENTE" : "AUSENTE (la ruta Reservar de un hotel no lo genera por diseño: solo el carrito)"}`);
  igual(s9aR.c.items.filter((i) => Number(i.ninos) === 1).reduce((s, i) => s + Number(i.tarifa_nino), 0), 101000, "ítem del niño (Niño 1) = su PVP recompuesto UNA vez (101.000)");
}
const revisarCarritoS9a = (r) => { cuadraResumen(r, "S9a carrito"); ok(r.totalCentavos === 36000000, "total del resumen 360.000"); ok(JSON.stringify(tarifaDe(r, "adulto")) === "[180000]" && JSON.stringify(noNino(r)) === "[0]", `adulto 180.000 y niño 0 (observado adulto ${tarifaDe(r, "adulto")} · niño ${noNino(r)})`); ok(adultosEn(r) === 2, "exactamente 2 adultos (sin adulto ficticio)"); };
const revisarContratoS9a = (esperadoTotal, tarifaAdulto, totalGratis, desc) => (cong, c) => {
  ok(c.gratis.length === 1, `una sola línea firmada «Niño gratis por habitación» (observadas ${c.gratis.length})`);
  if (c.gratis[0]) { igual(Number(c.gratis[0].adultos) * Number(c.gratis[0].tarifa_adulto), -totalGratis, "importe de la línea firmada"); ok(desc.test(c.gratis[0].descripcion), `la línea nombra las dos promociones, habitación, edad y tarifa: «${c.gratis[0].descripcion}»`); }
  if (cong) { ok(cong.totalCentavos === esperadoTotal, `resumen CONGELADO en el contrato: total ${pesos(cong.totalCentavos / 100)} (esperado ${pesos(esperadoTotal / 100)})`); cuadraResumen(cong, "resumen congelado"); ok(JSON.stringify(tarifaDe(cong, "adulto")) === JSON.stringify([tarifaAdulto]), `tarifa de adulto congelada ${tarifaAdulto}`); }
};
await carritoJornada("S9a CARRITO B2C (audit R2): resumenPrecios presente, niño en 0", { hotel: 126011, nombre: "R125 SUCESIVAS", ida: "2026-12-04", regreso: "2026-12-06", noches: 2, edades: [8], sesion: "venta", asistencia: B2C,
  esp: { precio: 360000, costo: 360000, revisar: revisarCarritoS9a, revisarContrato: (cong, c, n) => { revisarContratoS9a(36000000, 180000, 101000, D9)(cong, c); ok(noNino(cong).join() === "0", `niño en 0 en el resumen congelado (observado ${noNino(cong)})`); } } });

// ── S9b mismas cuentas en B2B asistido (agencia 10 %): comisionable y NETO.
//   Comisionable: se cobra el PVP (360.000); base de comisión = lo cobrado (360.000), comisión 10 % = 36.000.
//   NETO: el aliado paga 360.000 − 10 % = 324.000 (precio del contrato), los ítems conservan el PVP (suma 360.000); base 360.000 − comisión 36.000 (descontada en el precio) = 324.000 cobrados.
const c9c = await carritoJornada("S9b CARRITO B2B asistido COMISIONABLE (agencia 10 %)", { hotel: 126011, nombre: "R125 SUCESIVAS", ida: "2026-12-04", regreso: "2026-12-06", noches: 2, edades: [8], sesion: "venta", asistencia: AG("comisionable"),
  esp: { precio: 360000, costo: 360000, revisar: (r) => { revisarCarritoS9a(r); ok(r.modalidad === "pvp", "modalidad PVP"); }, revisarContrato: (cong, c, n) => revisarContratoS9a(36000000, 180000, 101000, D9)(cong, c) } });
if (c9c?.numero) { const f = comisionDe(c9c.numero); console.log(`  comisión comisionable: ${JSON.stringify(f)}`); igual(f?.base_comision, 360000, "base de comisión = lo realmente cobrado (360.000)"); igual(f?.comision_valor, 36000, "comisión 10 % = 36.000"); igual(c9c.c.precio, f?.base_comision, "precio del contrato = base de comisión (sin 1.000 de redondeo sobrante)"); }
const c9n = await carritoJornada("S9b CARRITO B2B asistido NETO", { hotel: 126011, nombre: "R125 SUCESIVAS", ida: "2026-12-04", regreso: "2026-12-06", noches: 2, edades: [8], sesion: "venta", asistencia: AG("neta"),
  esp: { precio: 324000, costo: 360000, sumaItems: 360000, revisar: (r) => { console.log(`  modalidad ${r.modalidad} · total ${pesos(r.totalCentavos / 100)} · adulto ${tarifaDe(r, "adulto")} · no adultos ${noNino(r)}`); cuadraResumen(r, "S9b NETO"); ok(r.modalidad === "neto", "modalidad NETO"); ok(noNino(r).join() === "0", "el niño queda en 0 en el NETO"); },
    revisarContrato: (cong, c) => { ok(c.gratis.length === 1, `una sola línea firmada (observadas ${c.gratis.length})`); if (cong) { cuadraResumen(cong, "NETO congelado"); ok(cong.modalidad === "neto", "el resumen congelado es NETO"); ok(noNino(cong).join() === "0", "niño en 0 en el resumen NETO congelado"); } } } });
if (c9n?.numero) { const f = comisionDe(c9n.numero); console.log(`  comisión NETO: ${JSON.stringify(f)}`); igual(f?.base_comision, 360000, "base de comisión NETO = PVP de los ítems (360.000)"); ok(f?.descontada_en_precio === true && f?.comision_valor == null, "NETO: la comisión va DESCONTADA en el precio (comision_valor nulo por diseño, igual que S6d)"); igual(Number(f?.base_comision) * Number(f?.pct_comision), 36000, "comisión implícita = base × 10 % = 36.000"); igual(Number(f?.base_comision) * (1 - Number(f?.pct_comision)), c9n.c.precio, "base × (1 − 10 %) = precio realmente cobrado (324.000)"); }

// ── S9c H7 «R125 SUCESIVAS EDAD» (markup 20 %): niños [9, 5] en UNA doble (Niño 1 = 9, Niño 2 = 5), 2 noches desde 4-dic.
//   «S9 EDAD UNO» (noche 4, niños de 3 a 6) ⇒ el de 5 años (Niño 2). «S9 EDAD DOS» (noche 5, niños de 7 a 10) ⇒ el de 9 años (Niño 1). Los dos pagan −10 % en las dos noches.
//   Adulto: 2 × 90.000 = 180.000 → venta 225.000 → 2 adultos 450.000.
//   Niño de 9 (Niño 1): 2 × 50.400 = 100.800 → venta 126.000 (PVP 126.000). Gratis la noche 5 ⇒ queda a su cargo la noche 4: 50.400 → 63.000. Condona 126.000 − 63.000 = 63.000.
//   Niño de 5 (Niño 2): 2 × 36.000 = 72.000 → venta 90.000. Gratis la noche 4 ⇒ queda la noche 5: 36.000 → 45.000. Condona 90.000 − 45.000 = 45.000.
//   Precio = 450.000 + 126.000 + 90.000 − 63.000 − 45.000 = 558.000. Costo del hotel = 360.000 + (100.800 − 50.400) + (72.000 − 36.000) = 446.400.
const D9c = ambas("S9 EDAD UNO", "S9 EDAD DOS", "niño de 5 años \\(Niño 2\\)", "niño de 9 años \\(Niño 1\\)");
await reservarJornada("S9c RESERVAR niños distintos elegibles por promoción — [9, 5]", { hotel: 126012, ida: "2026-12-04", regreso: "2026-12-06", edades: [9, 5] },
  { precio: 558000, costo: 446400, gratis: 108000, descripcion: D9c });
await carritoJornada("S9c CARRITO B2C niños [9, 5]: filas reducidas por niño", { hotel: 126012, nombre: "R125 SUCESIVAS EDAD", ida: "2026-12-04", regreso: "2026-12-06", noches: 2, edades: [9, 5], sesion: "venta", asistencia: B2C,
  esp: { precio: 558000, costo: 446400, revisar: (r) => { cuadraResumen(r, "S9c"); ok(r.totalCentavos === 55800000, "total del resumen 558.000"); ok(JSON.stringify(tarifaDe(r, "adulto")) === "[225000]", `adulto 225.000 (observado ${tarifaDe(r, "adulto")})`); ok(noNino(r).join() === "45000,63000", `niños reducidos por separado: 45.000 (de 5 años) y 63.000 (de 9) — observado ${noNino(r)}`); },
    revisarContrato: (cong, c) => { ok(c.gratis.length === 1, `una línea firmada (observadas ${c.gratis.length})`); if (c.gratis[0]) { igual(Number(c.gratis[0].adultos) * Number(c.gratis[0].tarifa_adulto), -108000, "importe firmado (63.000 + 45.000)"); ok(D9c.test(c.gratis[0].descripcion), `nombra ambas promociones y ambos niños: «${c.gratis[0].descripcion}»`); } if (cong) { ok(cong.totalCentavos === 55800000, "resumen congelado 558.000"); ok(noNino(cong).join() === "45000,63000", `filas por niño congeladas: ${noNino(cong)}`); } } } });

// ── S9d H8 «R125 SUC PARCIAL» (paquete DINÁMICO, tiquete 400.000 COP por adulto/niño de 2+ años → venta 500.000 con markup 20 %): 3 noches 4 → 7 dic, niño de 8.
//   Noche 4 «S9 P UNO» y noche 5 «S9 P DOS» (−10 % + niño gratis); noche 6 SIN promoción (a cargo del niño); el tiquete queda a cargo del niño (solo se condona alojamiento).
//   Adulto: hotel 90.000 + 90.000 + 100.000 = 280.000 → venta 350.000; + tiquete 500.000 = PVP 850.000 → 2 adultos 1.700.000.
//   Niño: hotel 50.400 + 50.400 + 56.000 = 156.800 → venta 196.000; + tiquete 500.000 = PVP 696.000. Sin las dos noches gratis queda 56.000 → 70.000 + 500.000 = 570.000. Condona 696.000 − 570.000 = 126.000.
//   Precio = 1.700.000 + 696.000 − 126.000 = 2.270.000. Costo del hotel = 2 × 280.000 + 156.800 − 100.800 = 616.000. CxP aérea = 3 × 400.000 = 1.200.000 (el niño sigue volando).
entrar("oper");
const g9d = await paquetesActions.generarTarifario(126014);
ok(g9d?.ok !== false, `generarTarifario(126014) publica el tarifario${g9d?.ok === false ? ": " + g9d.error : ""}`);
const D9d = ambas("S9 P UNO", "S9 P DOS", "niño de 8 años \\(Niño 1\\)");
const s9d = await reservarJornada("S9d RESERVAR estadía parcial con tiquete retenido (paquete dinámico)", { hotel: 126014, ida: "2026-12-04", regreso: "2026-12-07", edades: [8], salidaId: 12601401, monedaCobro: "COP" },
  { precio: 2270000, costo: 616000, gratis: 126000, descripcion: D9d });
if (s9d) {
  const aereo = Number(sql(`select coalesce(sum(valor_total), 0) from public.cuentas_por_pagar where numero_contrato = '${s9d.conv.numero}' and tipo_proveedor = 'aereo'`));
  igual(aereo, 1200000, "CxP AÉREA = 3 × 400.000 (el niño conserva su tiquete)");
  igual(s9d.c.items.filter((i) => Number(i.ninos) === 1).reduce((s, i) => s + Number(i.tarifa_nino), 0), 696000, "ítem del niño = PVP completo con tiquete (696.000); la línea firmada condona solo el alojamiento");
}
{
  const item = { ...itemCarrito(126014, { nombre: "R125 SUC PARCIAL", ida: "2026-12-04", regreso: "2026-12-07", noches: 3, edades: [8] }), modulo: "dinamico", salidaId: 12601401 };
  await carritoJornada("S9d CARRITO B2C (paquete dinámico con tiquete, SOLO cotización: el carrito no convierte salidas dinámicas, se convierten desde Reservar)", { hotel: 126014, nombre: "R125 SUC PARCIAL", ida: "2026-12-04", regreso: "2026-12-07", noches: 3, edades: [8], sesion: "venta", asistencia: B2C, item, soloCotizacion: true,
    esp: { precio: 2270000, costo: 616000, revisar: (r) => { cuadraResumen(r, "S9d"); ok(r.totalCentavos === 227000000, `total del resumen 2.270.000 (observado ${pesos(r.totalCentavos / 100)})`); ok(JSON.stringify(tarifaDe(r, "adulto")) === "[850000]" && noNino(r).join() === "570000", `adulto 850.000 y niño 570.000 (observado adulto ${tarifaDe(r, "adulto")} · niño ${noNino(r)})`); } } });
}

// ── S9e H9 «R125 SUC USD» (oferta en USD, tiquete 400.000 COP / TRM 4.000 = 100 USD → venta 125 USD con markup 20 %): 2 noches 4 → 6 dic, niño de 8.
//   Adulto: hotel 2 × 90 = 180 USD → venta 225; + tiquete 125 = PVP 350 USD → 2 adultos 700.
//   Niño: neto por noche 33,33 × 0,9 = 29,997 → 2 noches 59,994 USD (CON centavos) → venta 74,9925; + tiquete 125 = 199,9925 → PVP 200 USD (redondeo al dólar, UNA vez).
//   Gratis las dos noches: el niño conserva solo el tiquete (125). Condona 200 − 125 = 75 USD (si se recompusiera por promoción: 200 − 163 = 37 y luego otra vez ⇒ resultado distinto).
//   Precio = 700 + 200 − 75 = 825 USD. Costo del hotel = 2 × 180 + 59,994 − 59,994 = 360 USD (solo adultos).
entrar("oper");
const g9e = await paquetesActions.generarTarifario(126015);
ok(g9e?.ok !== false, `generarTarifario(126015) publica el tarifario USD${g9e?.ok === false ? ": " + g9e.error : ""}`);
const s9e = await reservarJornada("S9e RESERVAR oferta USD con TRM: centavos del niño, PVP al dólar, una sola recomposición", { hotel: 126015, ida: "2026-12-04", regreso: "2026-12-06", edades: [8], salidaId: 12601501, monedaCobro: "USD" },
  { precio: 825, gratis: 75, descripcion: ambas("S9 USD UNO", "S9 USD DOS", "niño de 8 años \\(Niño 1\\)") });
if (s9e) {
  const cxpUsd = sqlJson(`select coalesce(json_agg(row_to_json(t)), '[]') from (select tipo_proveedor, valor_total, moneda from public.cuentas_por_pagar where numero_contrato = '${s9e.conv.numero}') t`);
  console.log(`  costo_hotel de la venta: ${pesos(s9e.c.costo)} · hotel PREVISTO ${pesos(s9e.c.previsto)} · CxP ANTES de confirmar: ${JSON.stringify(cxpUsd)}`);
  const conf = await confirmar(s9e.conv.numero); ok(conf.ok, `confirmarVenta real${conf.ok ? "" : ": " + conf.error}`);
  const hot = sqlJson(`select coalesce(json_agg(row_to_json(t)), '[]') from (select tipo_proveedor, valor_total, moneda from public.cuentas_por_pagar where numero_contrato = '${s9e.conv.numero}') t`).filter((x) => x.tipo_proveedor === "hotel");
  ok(hot.length === 1 && String(hot[0].moneda).toUpperCase() === "USD", `la CxP del hotel conserva USD (${JSON.stringify(hot)})`);
  igual(hot.reduce((s, x) => s + Number(x.valor_total), 0), 360, "CxP del hotel en USD = solo adultos (360 USD)");
  igual(s9e.c.previsto, 360, "obligación PREVISTA del hotel en USD = 360");
  igual(s9e.c.costo, 360, "ventas.costo_hotel = 360 USD (solo adultos)");
}

console.log(`\n=== ${aciertos} verificación(es) PASS · ${fallos} fallo(s) · ${solicitudes} solicitudes a PostgREST`);
proxy.close();
process.exit(fallos ? 1 : 0);
