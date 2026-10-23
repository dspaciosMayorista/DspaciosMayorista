// Salida DINÁMICA en el checkout PÚBLICO (B2C, visitante sin sesión) — hallazgo de la prueba humana del paquete 54:
// Vista Booking le ofrecía al visitante "Ingresar al portal" en vez de dejarlo cotizar. El flujo público de siempre es
// carrito → /tarifario/checkout → `crearSolicitudReserva`, que solo aceptaba `bloqueo`/`porcion_terrestre`.
//   · el validador acepta `dinamico` SOLO con su `salidaId` (y sin `bloqueoId`);
//   · `crearSolicitudReserva` re-liquida con `computarReserva` usando ESA salida (modulo + salidaId), sin fechas del navegador;
//   · la cotización guarda paquete, hotel, salida, acomodación y las fechas que resolvió el servidor (las de la salida);
//   · la comparativa y la conversión a contrato no aceptan todavía un ítem dinámico (fallan con un mensaje claro).
// Se ejecuta el código real de producción; solo se reemplazan Supabase, next/headers y los motores de liquidación.
import { test, describe, mock, beforeEach } from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://dummy.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "dummy-anon";
process.env.SUPABASE_SERVICE_ROLE_KEY = "dummy-service-role";

type Insert = { tabla: string; fila: Record<string, unknown> };
const inserts: Insert[] = [];
const SALIDA_540 = {
  aerolinea: "Avianca", ruta: "BOG - CTG - BOG", fecha_ida: "2030-03-01", fecha_regreso: "2030-03-04",
  hora_salida_ida: "06:00", hora_llegada_ida: "07:30", hora_salida_reg: "18:00", hora_llegada_reg: "19:30",
};
// Respuesta de `salidas_dinamicas` (vuelo de la salida) y sesión — configurables por caso.
let RESP_SALIDA: { data: unknown; error: unknown } = { data: SALIDA_540, error: null };
let ADMIN_FALLA = false;
// null = visitante SIN sesión; si no, una cuenta autenticada con ese rol (sin permiso de reservar si es cliente_final).
let ROL_SESION: string | null = null;
function clienteFalso() {
  const builder = (tabla: string) => {
    const b: Record<string, unknown> = {};
    Object.assign(b, {
      select: () => b, eq: () => b, order: () => b, limit: () => b, in: () => b,
      maybeSingle: async () => {
        if (tabla === "salidas_dinamicas") return RESP_SALIDA;
        if (tabla === "usuarios" && ROL_SESION) return { data: { nombre: "Cliente", email: "cli@example.com", rol: ROL_SESION, agencia_id: null, pct_comision: null, activo: true }, error: null };
        return { data: null, error: null };
      },
      single: async () => ({ data: { id: 77, codigo: "COT-77", share_token: "tok" }, error: null }),
      insert: (fila: Record<string, unknown>) => { inserts.push({ tabla, fila }); return b; },
      then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(ok, ko),
    });
    return b;
  };
  const user = ROL_SESION ? { id: "u-cli", email: "cli@example.com" } : null;
  return { from: builder, auth: { getUser: async () => ({ data: { user }, error: null }) } };
}

const reservas: Record<string, unknown>[] = [];
mock.module("@/lib/reservar/computo", {
  namedExports: {
    computarReserva: async (_sb: unknown, input: Record<string, unknown>) => {
      reservas.push(input);
      return {
        ok: true,
        data: {
          // Fechas que resuelve el SERVIDOR (las de la salida), distintas de las que manda el navegador.
          meta: { hotel_nombre: "Hotel Nacional 54", destino_nombre: "CARTAGENA", fecha_ida: "2030-03-01", fecha_regreso: "2030-03-04" },
          precioVenta: 1_800_000, monedaReserva: "COP",
          lineasHab: [{ acom: "doble", habitaciones: 1, pax: 2, pvp: 900_000 }], pvpPorAcom: { doble: 900_000 },
          lineasMenores: [], numMenoresDeDos: 0, numNinos: 0, numNinos2: 0, numInfantes: 0, totalPax: 2,
          edadesMenoresUsadas: [], serviciosIncluidos: [], distribucionMenores: [], condicionesTarifa: null,
        },
      };
    },
  },
});
mock.module("@/lib/reservar/computoReservaBernalo", {
  namedExports: { computarReservaBernalo: async () => { throw new Error("no se usa en esta prueba"); } },
});
mock.module("@/lib/reservar/cotizar", {
  namedExports: { liquidarServicioPuntual: async () => ({ ok: false, tipo: "no_disponible", mensaje: "no disponible" }) },
});
mock.module("@/lib/supabase/server", { namedExports: { createClient: async () => clienteFalso() } });
mock.module("@/lib/supabase/admin", {
  namedExports: { createAdminClient: () => { if (ADMIN_FALLA) throw new Error("sin cliente de servicio"); return clienteFalso(); } },
});
mock.module("next/headers", { namedExports: { headers: async () => new Map([["host", "localhost"]]) } });

const { crearSolicitudReserva, crearComparativaCarrito } = await import("../app/tarifario/checkout/actions.ts");
const { validarSolicitudItem } = await import("../lib/reservar/edadesMenores.ts");

const cliente = { nombres: "Ana", apellidos: "Pérez", numeroDoc: "123", telefono: "3000000000", email: "ana@example.com" };
// Lo que arma el carrito al agregar la salida 540 del paquete 54 (doble, 2 adultos) desde el modal del Dinámico.
const item = {
  modulo: "dinamico", paqueteId: 54, hotelId: 2540, bloqueoId: null, salidaId: 540, hotelNombre: "Hotel Nacional 54", destino: "CARTAGENA",
  categoria: "Estándar", regimen: "PAE", fechaIda: "2030-02-01", fechaRegreso: "2030-02-09", noches: 3,
  habitaciones: { doble: 1 }, ninos: 0, ninos2: 0, infantes: 0, pax: 2, precio: 1, edadesMenores: [], cantidadMenores: 0,
};
const cotizaciones = () => inserts.filter((i) => i.tabla === "cotizaciones").map((i) => i.fila);

describe("validarSolicitudItem con una salida dinámica", () => {
  test("acepta `dinamico` con su salidaId y lo conserva", () => {
    const r = validarSolicitudItem(item, 0);
    assert.equal(r.ok, true, r.ok ? "" : r.error);
    if (!r.ok) return;
    assert.equal(r.item.modulo, "dinamico");
    assert.equal(r.item.salidaId, 540);
  });
  test("rechaza `dinamico` sin salida, con una salida inválida o con un bloqueo", () => {
    assert.equal(validarSolicitudItem({ ...item, salidaId: undefined }, 0).ok, false);
    assert.equal(validarSolicitudItem({ ...item, salidaId: 0 }, 0).ok, false);
    assert.equal(validarSolicitudItem({ ...item, salidaId: "540" }, 0).ok, false);
    assert.equal(validarSolicitudItem({ ...item, bloqueoId: 111 }, 0).ok, false);
  });
  test("los ítems de bloqueo/porción no ganan `salidaId` (su forma serializada no cambia)", () => {
    const r = validarSolicitudItem({ ...item, modulo: "porcion_terrestre", salidaId: undefined }, 0);
    assert.equal(r.ok, true);
    if (r.ok) assert.equal("salidaId" in r.item, false);
    assert.equal(validarSolicitudItem({ ...item, modulo: "bloqueo", bloqueoId: 111 }, 0).ok, false, "un bloqueo no usa salida dinámica");
  });
});

describe("crearSolicitudReserva (visitante sin sesión) con una salida dinámica", () => {
  beforeEach(() => {
    inserts.length = 0; reservas.length = 0;
    RESP_SALIDA = { data: SALIDA_540, error: null }; ADMIN_FALLA = false; ROL_SESION = null;
    process.env.SUPABASE_SERVICE_ROLE_KEY = "dummy-service-role";
  });

  test("re-liquida con computarReserva sobre ESA salida y guarda la cotización con paquete, hotel, salida, acomodación y fechas del servidor", async () => {
    const r = await crearSolicitudReserva({ items: [item], tours: [], cliente }) as { ok: boolean; error?: string };
    assert.equal(r.ok, true, r.error);
    assert.equal(reservas.length, 1);
    const reserva = reservas[0];
    assert.equal(reserva.modulo, "dinamico");
    assert.equal(reserva.salidaId, 540);
    assert.equal(reserva.paqueteId, 54);
    assert.equal(reserva.hotelId, 2540);
    assert.equal(reserva.fechaIda, undefined, "las fechas de un Dinámico salen de la salida, nunca del navegador");
    assert.equal(reserva.fechaRegreso, undefined);
    assert.deepEqual(reserva.habitaciones, { doble: 1 });

    const [cot] = cotizaciones();
    assert.ok(cot, "se creó la cotización");
    assert.equal(cot.precio_venta, 1_800_000, "precio autoritativo del servidor (el navegador mandó 1)");
    assert.equal(cot.fecha_salida, "2030-03-01");
    assert.equal(cot.fecha_regreso, "2030-03-04");
    const [guardado] = (cot.payload as { items: Record<string, unknown>[] }).items;
    assert.equal(guardado.modulo, "dinamico");
    assert.equal(guardado.salidaId, 540);
    assert.equal(guardado.paqueteId, 54);
    assert.equal(guardado.hotelId, 2540);
    assert.equal(guardado.categoria, "Estándar");
    assert.equal(guardado.regimen, "PAE");
    assert.deepEqual(guardado.habitaciones, { doble: 1 });
    assert.equal(guardado.fechaIda, "2030-03-01", "las de la salida resuelta, no 2030-02-01 del navegador");
    assert.equal(guardado.fechaRegreso, "2030-03-04");
    const vuelos = (cot.detalle as { vuelos?: Record<string, unknown>[] }).vuelos ?? [];
    assert.deepEqual(vuelos.map((v) => `${v.direccion}:${v.origen_codigo}-${v.destino_codigo}:${v.fecha_salida}`), ["ida:BOG-CTG:2030-03-01", "regreso:CTG-BOG:2030-03-04"], "el vuelo de la salida (sin tarifa)");
    assert.ok(vuelos.every((v) => !("valor_tiquete" in v)));
  });

  test("CUENTA CON SESIÓN sin permiso de reservar (cliente_final): cotiza por el checkout público igual que un visitante", async () => {
    ROL_SESION = "cliente_final";
    const r = await crearSolicitudReserva({ items: [item], tours: [], cliente }) as { ok: boolean; error?: string };
    assert.equal(r.ok, true, r.error);
    assert.equal(reservas[0]?.salidaId, 540);
    const [cot] = cotizaciones();
    assert.ok(cot, "se creó la cotización");
    assert.equal(cot.precio_venta, 1_800_000);
    assert.equal(cot.creado_por, "cli@example.com", "la cotización queda atribuida a la cuenta que la pidió");
    assert.equal(((cot.detalle as { vuelos?: unknown[] }).vuelos ?? []).length, 2);
  });

  // El vuelo es parte de la salida dinámica: sin él, la cotización mostraría hotel + fechas de un paquete con vuelo que no aparece.
  const sinVuelo: [string, () => void][] = [
    ["falta la llave de servicio", () => { delete process.env.SUPABASE_SERVICE_ROLE_KEY; }],
    ["el cliente de servicio no se puede crear", () => { ADMIN_FALLA = true; }],
    ["la consulta de la salida falla", () => { RESP_SALIDA = { data: null, error: { message: "boom", code: "XX000" } }; }],
    ["la salida no existe (null)", () => { RESP_SALIDA = { data: null, error: null }; }],
    ["la ruta no permite armar los tramos (sin destino)", () => { RESP_SALIDA = { data: { ...SALIDA_540, ruta: "BOG" }, error: null }; }],
    ["la salida no trae fecha de ida", () => { RESP_SALIDA = { data: { ...SALIDA_540, fecha_ida: null }, error: null }; }],
  ];
  for (const [caso, preparar] of sinVuelo) {
    test(`VUELO OBLIGATORIO — ${caso}: error claro y NO se guarda la cotización`, async () => {
      preparar();
      const r = await crearSolicitudReserva({ items: [item], tours: [], cliente }) as { ok: boolean; error?: string };
      assert.equal(r.ok, false);
      assert.match(r.error ?? "", /vuelo de la salida/i);
      assert.doesNotMatch(r.error ?? "", /boom|XX000|service/i, "sin detalles técnicos al navegador");
      assert.equal(cotizaciones().length, 0, "ninguna cotización sin vuelo");
      assert.equal(inserts.length, 0, "ni el contacto del CRM");
    });
  }

  test("un ítem dinámico sin salida no llega al motor ni crea cotización", async () => {
    const r = await crearSolicitudReserva({ items: [{ ...item, salidaId: undefined }], tours: [], cliente }) as { ok: boolean; error?: string };
    assert.equal(r.ok, false);
    assert.equal(reservas.length, 0);
    assert.equal(cotizaciones().length, 0);
  });

  test("comparativa: un Dinámico (salida con vuelo fijo) todavía no se compara — mensaje claro, sin cotizar", async () => {
    const r = await crearComparativaCarrito({ items: [item, { ...item, hotelId: 2541 }], tours: [], cliente }) as { ok: boolean; error?: string };
    assert.equal(r.ok, false);
    assert.match(r.error ?? "", /vuelo/);
    assert.equal(reservas.length, 0);
  });
});

describe("conversión a contrato de una cotización con un Dinámico (fuera de alcance: falla cerrada y explícita)", () => {
  test("convertirCotizacionCarrito rechaza el ítem dinámico antes de re-liquidar", () => {
    const src = readFileSync(fileURLToPath(new URL("../app/(dashboard)/dashboard/reservar/actions.ts", import.meta.url)), "utf8");
    assert.ok(/\(it\.modulo as string\) === "dinamico"\) return \{ ok: false, error: `\$\{it\.hotelNombre\}: [^`]*salida dinámica/.test(src), "falta la guarda explícita del Dinámico en convertirCotizacionCarrito");
  });
});
