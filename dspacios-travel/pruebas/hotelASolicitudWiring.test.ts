import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { modalidadDelVinculo } from "../lib/reservar/solicitudHotelServidor.ts";

// #120 · Verificación por inspección del cableado (los archivos de servidor/React no son ejecutables bajo `node --test`) + la función de modalidad con un cliente simulado.

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const leer = (rel: string) => readFileSync(join(raiz, rel), "utf8").replace(/\r\n/g, "\n");
const sinComentarios = (f: string) => f.split("\n").filter((l) => !/^\s*\/\//.test(l) && !/^\s*\*/.test(l)).join("\n");

/** Cliente de Supabase simulado: toda la cadena de filtros devuelve el mismo objeto y `maybeSingle` resuelve el resultado dado. */
function falso(resultado: { data: unknown; error: unknown }) {
  const cadena: Record<string, unknown> = {};
  for (const m of ["from", "select", "eq", "in"]) cadena[m] = () => cadena;
  cadena.maybeSingle = async () => resultado;
  return cadena as never;
}

describe("modalidad del vínculo = marca del hotel (única fuente de verdad)", () => {
  test("hotel marcado y seleccionado en el paquete → bajo_solicitud", async () => {
    const r = await modalidadDelVinculo(falso({ data: { hoteles: { tarifa_bajo_solicitud: true } }, error: null }), 1, 2);
    assert.deepEqual(r, { ok: true, modalidad: "bajo_solicitud" });
  });
  test("hotel NO marcado → tarifada: nada cambia para los hoteles tarifados", async () => {
    for (const marca of [false, null, undefined]) {
      const r = await modalidadDelVinculo(falso({ data: { hoteles: { tarifa_bajo_solicitud: marca } }, error: null }), 1, 2);
      assert.deepEqual(r, { ok: true, modalidad: "tarifada" });
    }
  });
  test("hotel sin vínculo con el paquete → null (solo aparece donde fue seleccionado)", async () => {
    assert.deepEqual(await modalidadDelVinculo(falso({ data: null, error: null }), 1, 2), { ok: true, modalidad: null });
  });
  test("error de lectura → falla cerrado (ni tarifado ni a solicitud)", async () => {
    assert.deepEqual(await modalidadDelVinculo(falso({ data: null, error: { message: "x" } }), 1, 2), { ok: false });
  });
});

describe("marcar / desmarcar el hotel", () => {
  const mig = leer("supabase/migrations/20260601000270_hotel_a_solicitud.sql");
  test("columna apagada por defecto, sin backfill ni heurística", () => {
    assert.match(mig, /add column if not exists tarifa_bajo_solicitud boolean not null default false/);
    assert.doesNotMatch(sinComentarios(mig), /update public\.hoteles/i);
    assert.doesNotMatch(sinComentarios(mig), /insert into public\.hoteles/i);
    assert.doesNotMatch(mig, /modalidad_tarifa/); // no hay segunda fuente de verdad en armado_hoteles
  });
  test("la base impide marcar con tarifas, marcar un hotel por unidad, cargar tarifas a un marcado y desmarcar con solicitudes abiertas", () => {
    assert.match(mig, /hoteles_bajo_solicitud_no_unidad check \(not \(tarifa_bajo_solicitud and modelo_tarifario = 'unidad'\)\)/);
    assert.match(mig, /new\.tarifa_bajo_solicitud and not old\.tarifa_bajo_solicitud\s+and exists \(select 1 from public\.tarifa_hotel/);
    assert.match(mig, /old\.tarifa_bajo_solicitud and not new\.tarifa_bajo_solicitud[\s\S]{0,400}estado = 'pendiente_tarifa'[\s\S]{0,400}estado = 'abierta'/);
    assert.match(mig, /before insert on public\.tarifa_hotel/);
  });
  test("la acción traduce el mensaje de la base y detecta un cambio sin permiso (0 filas)", () => {
    const a = leer("app/(dashboard)/dashboard/producto/hoteles/actions.ts");
    assert.match(a, /export async function setHotelBajoSolicitud\(hotelId: number, valor: boolean\)/);
    assert.match(a, /\.update\(\{ tarifa_bajo_solicitud: !!valor \}\)[\s\S]{0,80}\.select\("id"\)/);
    assert.match(a, /HOTEL_BAJO_SOLICITUD/);
    assert.match(a, /No tienes permiso para cambiar este hotel/);
  });
  test("el control vive en HotelConfigEditor, con la marca apagada por defecto y revertida si el servidor rechaza", () => {
    assert.match(leer("app/(dashboard)/dashboard/producto/hoteles/[id]/HotelConfigEditor.tsx"), /<HotelBajoSolicitudControl hotelId=\{hotelId\} inicial=\{inicial\.tarifaBajoSolicitud \?\? false\}/);
    const c = leer("app/(dashboard)/dashboard/producto/hoteles/[id]/HotelBajoSolicitudControl.tsx");
    assert.match(c, /else \{ setError\(r\.error\); setMarcado\(guardado\); \}/);
    assert.doesNotMatch(c, /🙂|✅|⚠/u);
  });
  test("la tarjeta sale solo de hoteles MARCADOS y seleccionados en el paquete (armado_hoteles), sin tocar tarifario_resultado", () => {
    const d = sinComentarios(leer("lib/tarifario/datosSolicitud.ts"));
    assert.match(d, /from\("armado_hoteles"\)[\s\S]{0,200}hoteles!inner\([^)]*tarifa_bajo_solicitud[^)]*\)/);
    assert.match(d, /\.eq\("hoteles\.tarifa_bajo_solicitud", true\)/);
    assert.doesNotMatch(d, /tarifario_resultado/);
    assert.match(d, /\.eq\("activo", true\)/);
    assert.match(d, /paqueteVendibleHoy/);
  });
});

describe("hotel único sin tarifa: el paquete y su tarjeta siguen apareciendo", () => {
  test("generarTarifario no falla por un hotel a solicitud y no lo tarifa", () => {
    const g = leer("app/(dashboard)/dashboard/paquetes/actions.ts");
    assert.match(g, /const hotelesSolicitud = hoteles\.filter\(marcaSolicitud\)/);
    assert.match(g, /modelo_tarifario !== "unidad" && !marcaSolicitud\(h\)/); // sus tarifas se ignoran: ni filas, ni error, ni invalidación por neto
    assert.match(g, /hotelesBernaloValidos\.length === 0 && hotelesSolicitud\.length === 0\)/);
  });
  test("setHotel no exige tarifas (el hotel marcado se elige igual que cualquiera)", () => {
    const g = leer("app/(dashboard)/dashboard/paquetes/actions.ts");
    const i = g.indexOf("export async function setHotel(");
    const cuerpo = g.slice(i, g.indexOf("export async function", i + 10));
    assert.doesNotMatch(cuerpo, /tarifa_hotel/);
  });
  test("el modal de filtros no bloquea a un hotel marcado y la fila muestra el texto exacto", () => {
    const a = leer("app/(dashboard)/dashboard/paquetes/[id]/ArmadoClient.tsx");
    assert.match(a, /hotel\.tarifa_bajo_solicitud\s+\? TEXTO_BAJO_SOLICITUD/);
    assert.match(a, /no necesita tarifas ni filtros/);
    assert.doesNotMatch(a, /setHotelModalidad|modalidad_tarifa/);
  });
  test("Vista Booking muestra la tarjeta aunque no haya tarjetas tarifadas, y no la mezcla con el carrito", () => {
    const v = leer("app/tarifario/VistaBooking.tsx");
    assert.match(v, /!tarjetas\.length && !enBusquedaPorcion && !solicitudesPortada\.length/);
    assert.match(v, /data-testid="hoteles-bajo-solicitud"/);
    const c = leer("app/tarifario/SolicitudHotelCard.tsx");
    assert.match(c, /TEXTO_BAJO_SOLICITUD/);
    assert.doesNotMatch(sinComentarios(c), /useCart|CartContext|formatMoneda|desde/i);
    assert.match(c, /Solicitar cotización/);
  });
  test("page.tsx carga la fuente paralela y monta el tarifario aunque solo haya hoteles a solicitud", () => {
    const p = leer("app/tarifario/page.tsx");
    assert.match(p, /cargarHotelesBajoSolicitud\(\)/);
    assert.match(p, /!hotelesBernalo\.length && !hotelesSolicitud\.length/);
    assert.match(p, /hotelesSolicitud=\{hotelesSolicitud\}/);
  });
});

describe("carrito con una opción tarifada + solicitud: dos cotizaciones independientes", () => {
  const acc = leer("app/tarifario/solicitudHotelActions.ts");
  test("la solicitud crea SU propia cotización pendiente (sin pasar por el carrito) y la tarifada sigue el camino de siempre", () => {
    assert.doesNotMatch(sinComentarios(acc), /crearCotizacionCarrito|crearSolicitudReserva|CartContext/);
    assert.match(acc, /estado: ESTADO_PENDIENTE_TARIFA/);
    assert.match(acc, /precio_venta: 0/);
    const co = leer("app/tarifario/checkout/actions.ts");
    assert.doesNotMatch(co, /solicitudHotel|pendiente_tarifa/); // el checkout tarifado no se tocó
  });
  test("un hotel a solicitud metido en un carrito se rechaza: nunca entra como producto tarifado", () => {
    const c = leer("lib/reservar/computo.ts");
    assert.match(c, /marcaSolicitud && !solicitud\) return \{ ok: false, error: MENSAJE_HOTEL_SOLO_SOLICITUD \}/);
  });
  test("la solicitud valida paquete vendible, tipo, vínculo marcado, salida real y toma la identidad B2B de la sesión", () => {
    assert.match(acc, /paqueteVendibleHoy\(pq, hoy\)/);
    assert.match(acc, /modalidad !== "bajo_solicitud"\) return \{ ok: false, error: "Este hotel no se ofrece bajo solicitud/);
    assert.match(acc, /from\("armado_vuelos"\)[\s\S]{0,200}eq\("paquete_id", input\.paqueteId\)/);
    assert.match(acc, /await getContextoB2B\(\)/);
    assert.match(acc, /contieneImportes\(payload\) \|\| contieneImportes\(detalle\)/);
  });
  test("reintento / doble clic no duplica (clave estable)", () => {
    assert.match(acc, /\.contains\("detalle", \{ solicitudHotel: \{ clave: detalle\.solicitudHotel\.clave \} \}/);
    assert.match(acc, /repetida = true/);
  });
});

describe("solicitud sin importes y venta imposible antes de completarla", () => {
  test("el documento pendiente no tiene ningún importe", () => {
    const d = leer("components/cotizacion/SolicitudPendiente.tsx");
    assert.doesNotMatch(d, /formatMoneda|precio_venta|\$\{?[a-z]*\.?(total|neto|precio)/i);
    for (const ruta of ["app/cot/[token]/page.tsx", "app/cotizacion/[id]/page.tsx", "app/(dashboard)/dashboard/cotizaciones/[id]/page.tsx"])
      assert.match(leer(ruta), /estaPendienteTarifa\(c(ot)?\.estado\)/, ruta);
  });
  test("ninguna conversión acepta una cotización pendiente (código) y la base lo impide aunque se salte el código", () => {
    const a = leer("app/(dashboard)/dashboard/reservar/actions.ts");
    assert.equal((a.match(/if \(estaPendienteTarifa\(cot\.estado\)\) return \{ ok: false, error: MENSAJE_PENDIENTE_TARIFA \}/g) ?? []).length, 2); // convertirCotizacion y convertirCotizacionCarrito
    const mig = leer("supabase/migrations/20260601000270_hotel_a_solicitud.sql");
    assert.match(mig, /new\.estado = 'convertida' or new\.numero_contrato is not null/);
    assert.match(mig, /before insert or update of estado, numero_contrato, precio_venta on public\.cotizaciones/);
  });
  test("asignar neta: rol de producto, neta válida, idempotente y la neta distinta se rechaza; RPC atómica", () => {
    const a = leer("app/(dashboard)/dashboard/reservar/actions.ts");
    const i = a.indexOf("export async function asignarNetaSolicitud");
    const f = a.slice(i, a.indexOf("export async function convertirCotizacion(", i));
    assert.match(f, /puedeEscribir\("producto", perfil\.rol\)/);
    // los conteos salen de la solicitud GUARDADA + reglas del hotel (nunca del navegador) y la elección se valida en servidor
    assert.match(f, /evaluarOcupacionHotel\(admin, payload\.hotelId, payload\.habitaciones \?\? \{\}, payload\.edadesMenores \?\? \[\], payload\.adultosReales\)/);
    assert.match(f, /validarReparto\(entradaRaw, ocupacion\.conteos\)/);
    // idempotencia: solo la MISMA elección (con los conteos ya congelados) es un no-op
    assert.match(f, /mismaEleccion\(previa\.neta, \{ netaTotal: r\.netaTotal, moneda: previa\.neta\.moneda, reparto: r\.reparto \}\)\) return \{ ok: true, id: cotizacionId \}/);
    assert.match(f, /ya tiene cargada otra neta u otra distribución/);
    assert.match(f, /crearCotizacionInterna\(payload/);
    const mig = leer("supabase/migrations/20260601000270_hotel_a_solicitud.sql");
    assert.match(mig, /unique \(cotizacion_id, item_ref\)/);
    assert.match(mig, /revoke all on table public\.cotizacion_tarifa_solicitud from anon/);
    // la RPC vigente es la de la 271 (15 argumentos): atómica, rol de producto, misma elección = no-op, otra neta / otra distribución = rechazo, infante $0
    const m271 = leer("supabase/migrations/20260601000271_reparto_neta_solicitud.sql");
    assert.match(m271, /from public\.cotizaciones where id = p_cotizacion for update/);
    assert.match(m271, /NETA_DISTINTA/);
    assert.match(m271, /DISTRIBUCION_DISTINTA/);
    assert.match(m271, /public\.mi_rol\(\) not in \('superadmin', 'administracion', 'gerencia', 'operaciones'\)/);
    assert.match(m271, /check \(neta_infante = 0\)/);
    assert.match(m271, /drop function if exists public\.cargar_neta_solicitud\(bigint, text, numeric, text, numeric, numeric, jsonb, date\)/);
  });
  test("la neta nunca viaja en payload/detalle y el cómputo la recibe solo por parámetro de servidor", () => {
    const a = leer("app/(dashboard)/dashboard/reservar/actions.ts");
    assert.match(a, /export async function crearCotizacion\(input: ReservaInput, opts\?: \{ vigenciaHasta\?: string \}\): Promise<CotizacionResult> \{\n  return crearCotizacionInterna\(input, opts\);/);
    assert.doesNotMatch(leer("lib/reservar/computo.ts").split("export type ReservaInput")[1].split("export type ComputoReserva")[0], /(neta|netaTotal|solicitudw*)??:/);
  });
  test("al convertir, la neta y el precio congelado salen de la base y el precio no cambia en silencio", () => {
    const a = leer("app/(dashboard)/dashboard/reservar/actions.ts");
    assert.match(a, /netaCargada\(createAdminClient\(\), id\)/);
    assert.match(a, /Math\.abs\(comp\.data\.precioVenta - solicitud\.precioCongelado\) > 0\.5/);
  });
});

describe("regresión: un hotel NO marcado se comporta exactamente igual", () => {
  test("el motor de fechas no cambia sin neta (sin vuelo ni redondeo a centavos)", () => {
    const l = leer("lib/reservar/liquidacionHotel.ts");
    assert.match(l, /const aporteVueloSol = Number\(datos\.vuelo\?\.aporte\) \|\| 0;/); // sin `vuelo` = 0, como antes
    assert.match(l, /if \(datos\.redondeoCentavos\) costoHotel/);
    const c = leer("lib/reservar/cotizar.ts");
    // liquidarHotelPaquete conserva su firma de 5 parámetros y su cuerpo; la variante con neta es OTRA función.
    assert.match(c, /export async function liquidarHotelPaquete\(\s*admin: ReturnType<typeof createAdminClient>,\s*paqueteId: number,\s*hotelId: number,\s*fechaIda: string,\s*numNoches: number\s*\)/);
    assert.match(c, /export async function liquidarHotelPaqueteSolicitud\(/);
    assert.match(leer("lib/reservar/computo.ts"), /liquidarHotelPaquete\(admin, input\.paqueteId, input\.hotelId, input\.fechaIda!, numNoches\)/); // #439: ahora dentro de leerCompartida(...)
  });
  test("computarReserva: un hotel tarifado sin neta sigue su camino; con neta se rechaza", () => {
    const c = leer("lib/reservar/computo.ts");
    assert.match(c, /if \(solicitud && !marcaSolicitud\) return/);
    assert.match(c, /\.select\("modelo_tarifario, tarifa_bajo_solicitud"\)/); // la misma lectura de siempre: sin consulta extra por reserva
  });
  test("buscarHoteles, tarifario/datos y el generador siguen leyendo tarifario_resultado/tarifa_hotel (no se tocaron)", () => {
    assert.doesNotMatch(leer("lib/tarifario/datos.ts"), /tarifa_bajo_solicitud/);
    assert.doesNotMatch(leer("lib/reservar/cotizar.ts").split("export type CotizarResult")[1], /tarifa_bajo_solicitud|solicitud/i);
  });
});
