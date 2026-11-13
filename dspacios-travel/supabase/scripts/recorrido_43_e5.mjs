// RECORRIDO LOCAL REAL de #43/#60 (entregas 4 y 5) con el CÓDIGO REAL de las acciones (lo lanza recorrido_43_e5.sh, que crea la base y
// PostgREST desechables). Solo se sustituyen `next/headers` (cookie de sesión como @supabase/ssr), `next/cache` y `server-only`.
// Por cada configuración de la promoción frente a EBB: combinación (acción de la ficha) → cotizar por fechas → crear cotización →
// convertir a contrato → RELEER de la base: composición guardada, ventas.costo_hotel y la CxP del hotel. Cuentas a mano en el informe.
import { createHmac } from "node:crypto";
import { execSync } from "node:child_process";
import nodeModule from "node:module";

const REST = process.env.R43_REST, SECRETO = process.env.R43_SECRETO, PS = process.env.R43_PS;
const b64 = (s) => Buffer.from(s).toString("base64url");
const jwt = (p) => { const h = b64(JSON.stringify({ alg: "HS256", typ: "JWT" })); const c = b64(JSON.stringify({ ...p, exp: Math.floor(Date.now() / 1000) + 3600 }));
  return `${h}.${c}.${createHmac("sha256", SECRETO).update(`${h}.${c}`).digest("base64url")}`; };
const SUB = "00000000-0000-4000-8000-000000009302"; // operaciones (fixture 293)
const token = jwt({ role: "authenticated", sub: SUB, session_id: "00000000-0000-4000-8000-00000000a302", aud: "authenticated" });
Object.assign(process.env, { NEXT_PUBLIC_SUPABASE_URL: REST.replace(/\/$/, "") + "/__", NEXT_PUBLIC_SUPABASE_ANON_KEY: jwt({ role: "anon" }), SUPABASE_SERVICE_ROLE_KEY: jwt({ role: "service_role" }) });
delete process.env.CRON_SECRET; delete process.env.MANTENIMIENTO_CLAVE;

// supabase-js pide <url>/rest/v1/...: un proxy mínimo quita el prefijo para el PostgREST desnudo.
import http from "node:http";
const destino = new URL(REST);
const proxy = http.createServer((req, res) => {
  // GoTrue mínimo: getUser() de supabase-js pide /auth/v1/user con el token de la sesión; aquí responde el usuario del token.
  if (req.url.startsWith("/__/auth/v1/user")) { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ id: SUB, aud: "authenticated", role: "authenticated", email: "t293-oper-may@x.test", app_metadata: {}, user_metadata: {} })); return; }
  const ruta = req.url.replace(/^\/__\/rest\/v1/, "").replace(/^\/__/, "") || "/";
  const p = http.request({ host: destino.hostname, port: destino.port, path: ruta, method: req.method, headers: { ...req.headers, host: destino.host } }, (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
  p.on("error", (e) => { res.writeHead(502); res.end(String(e)); });
  req.pipe(p);
});
await new Promise((ok) => proxy.listen(0, "127.0.0.1", ok));
process.env.NEXT_PUBLIC_SUPABASE_URL = `http://127.0.0.1:${proxy.address().port}/__`;

const sesion = JSON.stringify({ access_token: token, token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: "x", user: { id: SUB, aud: "authenticated", role: "authenticated" } });
globalThis.__r43 = { cookie: { name: "sb-127-auth-token", value: "base64-" + Buffer.from(sesion).toString("base64url") } };
const datos = (src) => `data:text/javascript,${encodeURIComponent(src)}`;
nodeModule.registerHooks({ resolve(s, c, n) {
  if (s === "server-only") return { url: datos("export {}"), shortCircuit: true };
  if (s === "next/headers") return { url: datos("export async function cookies(){ const c = globalThis.__r43.cookie; return { getAll: () => [c], get: (n) => (n === c.name ? c : undefined), set(){} }; } export async function headers(){ return new Map(); }"), shortCircuit: true };
  if (s === "next/cache") return { url: datos("export function revalidatePath(){} export function revalidateTag(){} export function unstable_noStore(){}"), shortCircuit: true };
  if (s.startsWith(".") && !/\.[cm]?[jt]sx?$/.test(s)) { for (const ext of [".ts", ".tsx", "/index.ts"]) { try { return n(s + ext, c); } catch { /* siguiente */ } } }
  return n(s, c);
} });

const sql = (q) => execSync(`${PS} -c "${q.replace(/"/g, '\\"')}"`, { encoding: "utf8" }).trim();
let fallos = 0;
const ok = (c, m) => { console.log(`${c ? "OK   " : "FALLO"} ${m}`); if (!c) fallos++; };
const pesos = (n) => Number(n).toLocaleString("es-CO");

const reservar = await import("../../app/(dashboard)/dashboard/reservar/actions.ts");
const hoteles = await import("../../app/(dashboard)/dashboard/producto/hoteles/actions.ts");

const IDA = "2027-06-07", REG = "2027-06-10"; // 3 noches
const pax = (i) => ({ nombres: `Pax${i}`, apellidos: "Recorrido", tipoDoc: "CC", numeroDoc: `43${1000 + i}`, fechaNacimiento: "1985-03-0" + ((i % 9) + 1), nacionalidad: "Colombia", esInfante: false });
const PASAJEROS = Array.from({ length: 7 }, (_, i) => pax(i + 1));
const reserva = {
  paqueteId: 9306, bloqueoId: null, modulo: "porcion_terrestre", hotelId: 9306, fechaIda: IDA, fechaRegreso: REG, categoria: "Estándar", regimen: "PAM",
  habitaciones: { doble: 2, triple: 1 }, ninos: 0, ninos2: 0, infantes: 0, edadesMenores: [], cantidadMenores: 0,
  cliente: { nombres: "Cliente", apellidos: "Recorrido", tipoDoc: "CC", numeroDoc: "43999", telefono: "3000000000", email: "cliente@local.test" },
  tipoAsesor: "interno", asesorInterno: "T293 Operaciones", agenciaNombre: "", agenciaAsesor: "", freelanceNombre: "", plazo: "", pasajeros: PASAJEROS, servicios: [],
};

// Cuentas a mano (neto del hotel, 3 noches). Habitación doble 2 × 100.000 = 200.000/noche; triple 3 × 90.000 = 270.000/noche. Descuento por
// habitación −20.000/noche. EBB 12 % (reserva hoy, ida 7-jun-2027: > 30 días) sobre el TOTAL de cada habitación, una sola vez.
const ESCENARIOS = [
  { nombre: "acumula con EBB", combinacion: { acumulable: { ebb: true } },
    doble: (200000 - 20000) * 3 * 0.88, triple: (270000 - 20000) * 3 * 0.88 },      // 475.200 y 660.000
  { nombre: "NO acumula; orden EBB > promoción (EBB excluye la promoción)", combinacion: { acumulable: { ebb: false }, orden: ["ebb", "promocion"] },
    doble: 200000 * 3 * 0.88, triple: 270000 * 3 * 0.88 },                            // 528.000 y 712.800
];

console.log(`Estado inicial de la promoción: ${sql("select estado || ' ' || array_to_string(alternativas, ',') from public.hotel_promocion_combinacion where promocion_id = 930610")}`);
const pend = await reservar.cotizarPorFechas({ paqueteId: 9306, hotelId: 9306, fechaIda: IDA, fechaRegreso: REG });
const pvpPend = pend.ok ? pend.combos?.[0]?.precios?.doble : null;
ok(pend.ok && pvpPend === Math.ceil((200000 * 3 * 0.88 / 2) / 0.8 / 1000) * 1000,
  `PENDIENTE: la promoción no se vende; se cotiza la base con EBB (doble ${pend.ok ? pesos(pvpPend) : pend.error})`);

for (const e of ESCENARIOS) {
  console.log(`\n### ${e.nombre}`);
  const rc = await hoteles.guardarCombinacionPromocion(930610, e.combinacion);
  ok(rc.ok, `combinación guardada con la acción de la ficha${rc.ok ? "" : ": " + rc.error}`);
  const c = await reservar.cotizarPorFechas({ paqueteId: 9306, hotelId: 9306, fechaIda: IDA, fechaRegreso: REG });
  if (!c.ok) { ok(false, `cotizar por fechas: ${c.error}`); continue; }
  const combo = c.combos[0];
  console.log(`  cotizar por fechas: doble ${pesos(combo.precios.doble)} · triple ${pesos(combo.precios.triple)} por persona · regla mostrada: ${c.descuentoHotel?.etiqueta ?? "ninguna"}`);
  const cot = await reservar.crearCotizacion(reserva);
  if (!cot.ok) { ok(false, `crear cotización: ${cot.error}`); continue; }
  const comp = JSON.parse(sql(`select composicion::text from public.cotizacion_composicion where cotizacion_id = ${cot.id}`) || "null");
  const lineas = comp?.hoteles?.[0]?.composicion?.lineas ?? comp?.lineas ?? [];
  console.log(`  cotización ${cot.id}: composición guardada ${comp ? "sí" : "NO"}`);
  for (const l of lineas) if (l.habitacion) console.log(`    línea ${l.acom ?? l.clave}: ${l.habitacion.habitaciones} hab × neto ${pesos(l.habitacion.netoPorHabitacion)} (descuento ${pesos(l.habitacion.descuento)}; reparto ${l.habitacion.repartoDescuento?.map(pesos).join(" + ")})`);
  const conv = await reservar.convertirCotizacion(cot.id, PASAJEROS);
  if (!conv.ok) { ok(false, `convertir a contrato: ${conv.error}`); continue; }
  const costo = Number(sql(`select costo_hotel from public.ventas where numero_contrato = '${conv.numero}'`));
  const cxp = sql(`select coalesce(sum(valor_total), 0) || '|' || count(*) from public.cuentas_por_pagar where numero_contrato = '${conv.numero}' and tipo_proveedor = 'hotel'`).split("|");
  const esperado = 2 * e.doble + e.triple;
  console.log(`  contrato ${conv.numero}: ventas.costo_hotel ${pesos(costo)} · CxP hotel ${pesos(cxp[0])} (${cxp[1]} fila/s) · esperado ${pesos(esperado)} = 2 × ${pesos(e.doble)} + ${pesos(e.triple)}`);
  ok(Math.abs(costo - esperado) < 0.005, `costo del hotel releído de la base = ${pesos(esperado)} (exacto)`);
  ok(Math.abs(Number(cxp[0]) - esperado) < 0.005 && Number(cxp[1]) >= 1, `obligación con el hotel (CxP) releída = ${pesos(esperado)}`);
}

// ── Hotel 9307: la precedencia decide DISTINTO por acomodación (doble con la promoción + EBB; triple sin promoción: Long Stay) ──
// Combinación del proveedor: la promoción acumula con EBB y con Long Stay; orden promoción → EBB → Long Stay (EBB y Long Stay nunca juntos).
const COMB_9307 = { acumulable: { ebb: true, long_stay: true }, orden: ["promocion", "ebb", "long_stay"] };
console.log("\n### Hotel 9307: decisión distinta por acomodación");
{
  const rc = await hoteles.guardarCombinacionPromocion(930710, COMB_9307);
  ok(rc.ok, `combinación de «PROMO DOBLE» guardada${rc.ok ? "" : ": " + rc.error}`);
  const c = await reservar.cotizarPorFechas({ paqueteId: 9307, hotelId: 9307, fechaIda: IDA, fechaRegreso: REG });
  if (!c.ok) ok(false, `cotizar 9307: ${c.error}`);
  else {
    const combo = c.combos[0];
    const etq = combo.descuentoHotel?.etiqueta ?? c.descuentoHotel?.etiqueta ?? "";
    console.log(`  cotizar por fechas: doble ${pesos(combo.precios.doble)} · triple ${pesos(combo.precios.triple)} por persona · etiqueta mostrada: ${etq}`);
    // Doble: (90.000 × 2 × 3) × 0,88 = 475.200 por habitación ⇒ 237.600 / 0,8 = 297.000. Triple: (90.000 × 3 × 3) × 0,85 = 688.500 ⇒ 229.500 / 0,8 = 286.875 → 287.000.
    ok(combo.precios.doble === 297000 && combo.precios.triple === 287000, "importes y redondeo PVP de siempre (doble 297.000, triple 287.000)");
    ok(/^Doble: .*EBB.* · Triple: .*Long Stay/.test(etq) && combo.descuentoHotel?.tipo === undefined,
      "la etiqueta dice la regla de CADA acomodación (no la de la doble como si fuera de todas)");
    ok(c.descuentoHotel?.etiqueta === etq, "la etiqueta general es la del combo mostrado, no la de la estadía");
  }
  const res9307 = { ...reserva, paqueteId: 9307, hotelId: 9307, cliente: { ...reserva.cliente, numeroDoc: "43998" } };
  const cot = await reservar.crearCotizacion(res9307);
  if (!cot.ok) ok(false, `crear cotización 9307: ${cot.error}`);
  else {
    const comp = JSON.parse(sql(`select composicion::text from public.cotizacion_composicion where cotizacion_id = ${cot.id}`) || "null");
    const dh = comp?.hoteles?.[0]?.composicion?.descuentoHotel ?? comp?.descuentoHotel;
    console.log(`  cotización ${cot.id}: etiqueta guardada en la composición: ${dh?.etiqueta ?? "(ninguna)"}`);
    ok(Array.isArray(dh?.porAcomodacion) && dh.porAcomodacion.map((x) => x.acom).join(",") === "doble,triple", "la composición guardada conserva la etiqueta por acomodación");
    const conv = await reservar.convertirCotizacion(cot.id, PASAJEROS);
    if (!conv.ok) ok(false, `convertir 9307: ${conv.error}`);
    else {
      const costo = Number(sql(`select costo_hotel from public.ventas where numero_contrato = '${conv.numero}'`));
      const cxp = Number(sql(`select coalesce(sum(valor_total), 0) from public.cuentas_por_pagar where numero_contrato = '${conv.numero}' and tipo_proveedor = 'hotel'`));
      const esperado = 2 * 475200 + 688500; // 1.638.900
      console.log(`  contrato ${conv.numero}: costo ${pesos(costo)} · CxP ${pesos(cxp)} · esperado ${pesos(esperado)} = 2 × 475.200 + 688.500`);
      ok(Math.abs(costo - esperado) < 0.005 && Math.abs(cxp - esperado) < 0.005, "costo y obligación del hotel exactos con la decisión por acomodación");
    }
  }
}

// ── P3: cambio PENDIENTE de una promoción que se vende (persistente; la versión autorizada se sigue vendiendo) ──
console.log("\n### P3: cambio pendiente de «P3 TARDIA»");
{
  const IDA2 = "2027-06-21", REG2 = "2027-06-24";
  const doble = async () => { const c = await reservar.cotizarPorFechas({ paqueteId: 9307, hotelId: 9307, fechaIda: IDA2, fechaRegreso: REG2 }); return c.ok ? c.combos[0].precios.doble : c.error; };
  // Antes: P3 TARDIA tiene la compra cerrada ⇒ se vende ALTA con Long Stay 15 % (mayor %): 510.000 / 2 / 0,8 = 318.750 → 319.000.
  ok((await doble()) === 319000, "antes: la doble se vende con la base y Long Stay (319.000)");
  const input = { hotelId: 9307, nombre: "P3 TARDIA", inicio: "2027-06-20", fin: "2027-06-30", prioridad: 2, minNoches: 1, compraInicio: "2026-01-01", compraFin: "2027-05-31",
    tipo: "descuento_pct", descuentoValor: 20, regimenRestringido: null, rangos: [], blackouts: [], condicionPagoTipo: null };
  const r = await hoteles.actualizarTemporada(930711, input);
  ok(r.ok && r.cambioPendiente?.familias.join(",") === "ebb,long_stay", `abrir la compra: el cambio queda PENDIENTE (${r.ok ? r.aviso : r.error})`);
  ok(sql("select compra_fin from public.hotel_temporadas where id = 930711") === "2026-02-01", "la vigencia autorizada no cambió");
  ok(sql("select cambios->>'compra_fin' from public.hotel_promocion_cambio_pendiente where promocion_id = 930711") === "2027-05-31",
    "al cerrar y reabrir (otra conexión) el cambio pendiente sigue guardado");
  ok((await doble()) === 319000, "mientras está pendiente se sigue vendiendo la versión autorizada (319.000)");
  // Dos activaciones a la vez (dos peticiones reales a PostgREST): una aplica; la otra ve que ya no está pendiente.
  const [a, b] = await Promise.all([hoteles.activarCambioPromocion(930711, COMB_9307), hoteles.activarCambioPromocion(930711, COMB_9307)]);
  const oks = [a, b].filter((x) => x.ok).length, rech = [a, b].find((x) => !x.ok);
  console.log(`  activaciones simultáneas: ${oks} aplicada(s); rechazo: ${rech && !rech.ok ? rech.error : "(ninguno)"}`);
  ok(oks === 1 && !!rech && !rech.ok && /ya no está pendiente/.test(rech.error), "activación concurrente: exactamente una aplica, la otra se rechaza");
  ok(sql("select compra_fin || '|' || (select count(*) from public.hotel_promocion_cambio_pendiente where promocion_id = 930711) || '|' || (select estado from public.hotel_promocion_combinacion where promocion_id = 930711) from public.hotel_temporadas where id = 930711") === "2027-05-31|0|configurada",
    "activado una sola vez: cambio aplicado, configurado y sin pendiente");
  // Después: doble con la promoción (80.000) + EBB 12 %: 422.400 / 2 / 0,8 = 264.000.
  ok((await doble()) === 264000, "después de activar se vende el cambio (264.000)");
}

console.log(`\n=== ${fallos} fallo(s)`);
proxy.close();
process.exit(fallos ? 1 : 0);
