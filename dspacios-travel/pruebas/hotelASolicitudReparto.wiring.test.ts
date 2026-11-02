import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// #120 · Regla de reparto CONFIRMADA (adultos / distribuir; infantes $0): verificación por inspección del cableado de servidor, formulario, aviso de acomodación y migración 271.
const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const leer = (rel: string) => readFileSync(join(raiz, rel), "utf8").replace(/\r\n/g, "\n");

describe("formulario de valoración", () => {
  const f = leer("app/(dashboard)/dashboard/cotizaciones/[id]/NetaSolicitudForm.tsx");
  test("ofrece «Cargar hotel a los adultos» y «Distribuir» solo si hay niños; sin niños no hay elección", () => {
    assert.match(f, /Cargar hotel a los adultos/);
    assert.match(f, /Distribuir/);
    assert.match(f, /ninos === 0 \? \(\s*<p[^>]*data-testid="neta-sin-ninos"/);
  });
  test("pide neta por adulto y por niño para toda la estadía, muestra la suma contra la neta total y fija el infante en $0", () => {
    assert.match(f, /Neta por ADULTO \(toda la estadía\)/);
    assert.match(f, /Neta por NIÑO \(toda la estadía\)/);
    assert.match(f, /data-testid="neta-cuadre"/);
    assert.match(f, /Infantes \(\{infantes\}\): neta hotelera <strong>\$0<\/strong>/);
    assert.match(f, /netaInfante: 0/);
  });
  test("los conteos vienen del servidor (solicitud guardada), no se capturan en el navegador", () => {
    const p = leer("app/(dashboard)/dashboard/cotizaciones/[id]/page.tsx");
    assert.match(p, /evaluarOcupacionHotel\(createAdminClient\(\), Number\(pagoSol\.hotelId\)/);
    assert.match(p, /conteos=\{ocupacion\.ok \? ocupacion\.conteos : null\}/);
  });
});

describe("servidor: elección privada, reacreditada y costo exacto", () => {
  const a = leer("app/(dashboard)/dashboard/reservar/actions.ts");
  test("la RPC recibe la elección completa y el infante siempre $0", () => {
    assert.match(a, /p_modo: solicitud\.neta\.reparto\.modo, p_adultos: solicitud\.neta\.reparto\.adultos, p_ninos: solicitud\.neta\.reparto\.ninos, p_infantes: solicitud\.neta\.reparto\.infantes/);
    assert.match(a, /p_neta_infante: 0/);
  });
  test("costo del hotel del contrato y CxP = neta TOTAL exacta (la suma por tipo solo puede diferir por centavos)", () => {
    assert.match(a, /costoHotelTotal = solicitud\.neta\.netaTotal;/);
    assert.match(a, /Math\.abs\(costoHotelTotal - solicitud\.neta\.netaTotal\) > toleranciaCentavos\(rp\.adultos \+ rp\.ninos\)/);
  });
  test("al convertir, la elección sale de la base (netaCargada) y se reacredita contra la clasificación vigente", () => {
    assert.match(a, /const nc = await netaCargada\(createAdminClient\(\), id\)/);
    const c = leer("lib/reservar/computo.ts");
    assert.match(c, /La clasificación de los viajeros cambió desde que se valoró la solicitud/);
    assert.match(c, /rp\.adultos !== adultosAhora \|\| rp\.ninos !== numNinos \+ numNinos2 \|\| rp\.infantes !== numInfantes/);
  });
  test("el PVP por tipo sale del motor existente (tarifa sintética por tipo → evaluarHotelPorFechas), sin fórmulas nuevas", () => {
    const c = leer("lib/reservar/cotizar.ts");
    assert.match(c, /tarifaSinteticaPorTipo\(\{ reparto: solicitud\.neta\.reparto/);
    assert.match(c, /evaluarHotelPorFechas\(aplicarNetaSolicitud\(carga\.datos/);
  });
});

describe("aviso de acomodación ANTES de enviar", () => {
  test("la tarjeta consulta la ocupación mientras se edita y bloquea el envío si no cabe; el servidor lo vuelve a exigir", () => {
    const c = leer("app/tarifario/SolicitudHotelCard.tsx");
    assert.match(c, /validarOcupacionSolicitud\(\{ paqueteId: hotel\.paqueteId, hotelId: hotel\.hotelId, habitaciones: hab, edadesMenores: edadesParsed, adultos: adultosNum \}\)/);
    assert.match(c, /data-testid="aviso-ocupacion"/);
    assert.match(c, /disabled=\{pendiente \|\| \(ocupacion != null && !ocupacion\.ok\)\}/);
    const s = leer("app/tarifario/solicitudHotelActions.ts");
    assert.match(s, /const ocupacion = await evaluarOcupacionHotel\(admin, input\.hotelId, input\.habitaciones, input\.edadesMenores, input\.adultos\);/);
    assert.match(s, /export async function validarOcupacionSolicitud\(raw: unknown\)/);
  });
  test("la regla es la del motor: defaultAcomConfig sin hotel_acomodaciones, umbrales de edad del hotel, distribuirPorHabitaciones", () => {
    const o = leer("lib/reservar/solicitudOcupacion.ts");
    assert.match(o, /i\.reglas\.find\(\(x\) => x\.acomodacion === a\) \?\? defaultAcomConfig\(a\)/);
    assert.match(o, /clasificarMenoresPorEdad\(/);
    assert.match(o, /distribuirPorHabitaciones\(/);
  });
});

describe("migración 271", () => {
  const m = leer("supabase/migrations/20260601000271_reparto_neta_solicitud.sql");
  test("aditiva sobre la 270 (que no se edita): columnas privadas, CHECK de la regla y RPC única de 15 argumentos", () => {
    for (const col of ["modo", "adultos", "ninos", "infantes", "neta_adulto", "neta_nino", "neta_infante"]) assert.match(m, new RegExp(`add column if not exists ${col} `));
    assert.match(m, /cts_modo_distribuir_check/);
    assert.match(m, /cts_infante_cero_check check \(neta_infante = 0\)/);
    assert.match(m, /drop function if exists public\.cargar_neta_solicitud\(bigint, text, numeric, text, numeric, numeric, jsonb, date\);/);
    const codigo = m.split("\n").filter((l) => !/^\s*--/.test(l)).join("\n");
    assert.doesNotMatch(codigo.replace(/update public\.cotizaciones set estado = 'abierta'[^;]*;/, ""), /alter table public\.cotizaciones|update public\.cotizaciones|payload =/, "no toca cotizaciones salvo el paso a abierta de la RPC");
  });
  test("tiene rollback, preflight y postcheck", () => {
    for (const f of ["rollback_271_reparto_neta_solicitud.sql", "preflight_271_reparto_neta_solicitud.sql", "postcheck_271_reparto_neta_solicitud.sql"])
      assert.ok(leer(`supabase/scripts/${f}`).length > 200, f);
  });
});

describe("cierre #120: mismo total en ambos modos y ocupación real (cableado)", () => {
  const c = leer("lib/reservar/computo.ts");
  const a = leer("app/(dashboard)/dashboard/reservar/actions.ts");
  test("el residuo de redondeo se calcula contra la corrida de REFERENCIA («adultos») y entra al precio UNA sola vez; la referencia no recurre", () => {
    assert.match(c, /computarReserva\(sb, input, \{ neta: repartoDeReferencia\(solicitud\.neta\), referencia: true \}\)/);
    assert.match(c, /if \(solicitud && !solicitud\.referencia && solicitud\.neta\.reparto\.modo === "distribuir"\)/);
    assert.equal((c.match(/precioVenta \+= aj\.ajuste/g) ?? []).length, 1);
    assert.match(c, /unidad: monedaReserva === "USD" \? 1 : 1000/, "el tope usa 1 USD por persona en dólares y 1.000 en pesos");
  });
  test("adultosReales solo se honra con la neta puesta por el servidor: el navegador no cambia la ocupación de un hotel tarifado", () => {
    assert.match(c, /solicitud \? input\.adultosReales : undefined/);
    assert.match(c, /resolverMenoresPorEdad\(input, reglaEdad\.infanteMax, reglaEdad\.ninoMax, pvpPorAcom, reglas\);/, "la rama tarifada no recibe el parámetro");
    assert.match(c, /adultosReales: solicitud \? lineasHab\.reduce\(\(s, l\) => s \+ l\.pax, 0\) : undefined/);
  });
  test("la línea del hotel lleva los adultos REALES (vuelo, sillas, servicios y contrato siguen ese número, sin pasajero ficticio)", () => {
    assert.match(c, /distribucionMenores\.filter\(\(d\) => d\.acom === a\)\.reduce\(\(s, d\) => s \+ d\.adultos, 0\)/);
  });
  test("el ajuste es una línea explícita en cotización y contrato; el costo del hotel sigue siendo la neta TOTAL", () => {
    assert.match(a, /items\.push\(\{ numero_contrato: numero, descripcion: ajusteRedondeo\.descripcion, adultos: 1, ninos: 0, tarifa_adulto: ajusteRedondeo\.total/);
    assert.match(a, /itemsSnap\.push\(\{ id: 202, descripcion: ajusteRedondeo\.descripcion, adultos: 1, ninos: 0, tarifa_adulto: ajusteRedondeo\.total/);
    assert.match(a, /costoHotelTotal = solicitud\.neta\.netaTotal;/);
  });
  test("la solicitud guarda los adultos reales en el payload SOLO cuando se declararon, y la valoración los lee de ahí", () => {
    const s = leer("app/tarifario/solicitudHotelActions.ts");
    assert.match(s, /\.\.\.\(input\.adultos != null \? \{ adultosReales: input\.adultos \} : \{\}\)/);
    assert.match(a, /payload\.edadesMenores \?\? \[\], payload\.adultosReales\)/);
    // la cotización nace con las personas REALES en `pax` (con 0 la ficha mostraba «Pasajeros 0» y el formulario de conversión pedía 1 solo pasajero)
    assert.match(s, /pax: ocupacion\.conteos\.adultos \+ ocupacion\.conteos\.ninos \+ ocupacion\.conteos\.infantes, precio_venta: 0/);
  });
});

describe("cierre #120: TRM de costos de un contrato en USD (reserva por persona)", () => {
  const a = leer("app/(dashboard)/dashboard/reservar/actions.ts");
  const i = a.indexOf("async function reservarDesdeTarifarioInterno(input: ReservaInput");
  const cuerpo = a.slice(i, a.indexOf("\nexport async function convertirCotizacion", i));
  test("la TRM la decide el servidor ANTES de numerar, solo en un contrato en USD sin oferta #63 (en COP no se ejecuta)", () => {
    assert.match(cuerpo, /if \(!oferta63 && !esServicios && monedaReserva === "USD"\) \{\s*const rTrm = await trmCostoContratoUsd\(/);
    assert.ok(cuerpo.indexOf("trmCostoContratoUsd(") < cuerpo.indexOf("siguienteNumeroContrato(tenant)"), "antes de numerar");
    assert.match(a, /esInterno: p\.costo\?\.esInterno === true, congelada: null/);
  });
  test("las CxP solo llevan moneda y equivalente cuando hay TRM (USD); en COP quedan como siempre", () => {
    assert.match(cuerpo, /if \(trmCostoUsd != null\) cxp = cxp\.map\(\(c\) => cxpEnUsdConEquivalente\(c, trmCostoUsd as number\)\);/);
  });
  test("convertirCotizacion recibe la TRM como argumento propio y el permiso (interno) lo resuelve el servidor, nunca el navegador", () => {
    assert.match(a, /trmCosto\?: unknown,\r?\n\): Promise<ReservaResult> \{/);
    assert.match(a, /\{ trmRecibida: trmCosto, esInterno: ctx\.ok && ctx\.interno !== false \}/);
  });
  test("el helper falla cerrado antes de escribir: sin TRM válida o sin las columnas de la 236, no se numera nada", () => {
    const h = a.slice(a.indexOf("async function trmCostoContratoUsd("), a.indexOf("// NO EXPORTADA a propósito"));
    assert.match(h, /decidirTrmCosto\(\{ requiere: pre\.cxp\.some\(\(c\) => c\.valor_total > 0\)/);
    assert.match(h, /select\("valor_cop_costo, trm_costo"\)\.limit\(1\)/);
    assert.doesNotMatch(h, /trm_referencia|trmReferenciaAproximada/, "no se infiere de una tasa de referencia");
  });
  test("UI: el campo «TRM de costos» solo aparece si la cotización está en USD sin oferta #63 y viaja como último argumento", () => {
    const p = leer("app/(dashboard)/dashboard/cotizaciones/[id]/page.tsx");
    assert.match(p, /pideTrmCosto=\{c\.moneda === "USD" && oferta63Cot == null\}/);
    const u = leer("app/(dashboard)/dashboard/cotizaciones/[id]/CotizacionAcciones.tsx");
    assert.equal((u.match(/cb\.monedaCobro, cb\.trmCobro, tc\.valor\)/g) ?? []).length, 3);
  });
});
