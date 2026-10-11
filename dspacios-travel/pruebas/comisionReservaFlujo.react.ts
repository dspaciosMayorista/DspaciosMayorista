// Se ejecuta con npm run test:react (loader del arnés).
//
// #38 · Reserva B2B de punta a punta: convertirCotizacion → reservar REAL
// (numeración, venta, comisión, pasajeros, escritura financiera y reversión)
// contra la BD en memoria del arnés. Solo se sustituye el motor de precios
// (`computarReserva`, ya probado aparte) por un cómputo fijo de un paquete de
// servicios: PVP 1.000.000, impuesto 200.000 → base 800.000, comisión 10 %.
//
// La función SQL `registrar_comision_b2b_reserva` se simula aquí como lo hace
// la base (inserta UNA fila o falla); su comportamiento REAL con roles,
// tenant, aliado, NETO, duplicados y carreras se prueba en Postgres:
// supabase/scripts/test_205_comisiones_b2b.sql (RES1–RES17) y
// test_205_carrera_abonos.sh (C5).
import * as nodeModule from "node:module";
import { usarBD, type Fila } from "./support/fechaNegocioArnes.ts";
import { test } from "node:test";
import assert from "node:assert/strict";

type ResolveHook = (s: string, c: { parentURL?: string }, n: (s: string, c: unknown) => unknown) => unknown;
const { registerHooks } = nodeModule as unknown as { registerHooks: (h: { resolve: ResolveHook }) => void };
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@/lib/reservar/computo") {
      const src = "export async function computarReserva(sb, input) { return globalThis.__computo38(input); }";
      return { url: `data:text/javascript,${encodeURIComponent(src)}`, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});

process.env.SUPABASE_SERVICE_ROLE_KEY ??= "clave-de-prueba";
(globalThis as unknown as { __computo38: () => unknown }).__computo38 = () => ({
  ok: true,
  data: {
    origen: { tipo: "ninguno" },
    meta: { hotel_nombre: null, destino_nombre: "SAN ANDRES", fecha_ida: "2026-11-01", fecha_regreso: "2026-11-04" },
    pvpPorAcom: {}, netoPorAcom: {}, precioVenta: 1_000_000, paxConSilla: 0, totalPax: 1,
    numNinos: 0, numNinos2: 0, numInfantes: 0, distribucionMenores: null, edadesMenoresUsadas: null,
    lineasHab: [], serviciosItems: [], serviciosIncluidos: [], impuestoTotal: 200_000, monedaReserva: "COP",
    notaNino: null, cargoMascota: null, notaMascota: null,
  },
});

const { convertirCotizacion } = await import("../app/(dashboard)/dashboard/reservar/actions.ts");

const PASAJERO = { nombres: "Ana", apellidos: "Ruiz", tipoDoc: "CC", numeroDoc: "1010", fechaNacimiento: "1990-01-01", nacionalidad: "", esInfante: false };
const payload = (extra: Record<string, unknown> = {}) => ({
  paqueteId: 7, bloqueoId: null, empaquetadoId: null, salidaId: null, modulo: "servicios", hotelId: null,
  categoria: "", regimen: "", habitaciones: {}, ninos: 0, ninos2: 0, infantes: 0, mascotas: 0, paxServicios: 1,
  cliente: { nombres: "Ana", apellidos: "Ruiz", tipoDoc: "CC", numeroDoc: "1010", telefono: "300", email: "" },
  tipoAsesor: "agencia", asesorInterno: "Asesor", agenciaNombre: "Agencia Uno", agenciaAsesor: "", freelanceNombre: "",
  aliadoId: 9205, modoCompra: "comisionable", plazo: "2026-10-20", pasajeros: [PASAJERO], servicios: [],
  ...extra,
});

/** Base en memoria + RPC simuladas como las resuelve Postgres. */
function montar(opts: { rol?: string; cot?: Record<string, unknown>; falla?: string; aliado?: Fila | null } = {}) {
  const semilla: Record<string, Fila[]> = {
    usuarios: [{ id: "u-arnes", rol: opts.rol ?? "venta", activo: true, tenant: "mayorista", nombre: "Asesor" }],
    cotizaciones: [{ id: 41, estado: "abierta", numero_contrato: null, tenant: "mayorista", payload: payload(opts.cot) }],
    aliados: opts.aliado === null ? [] : [opts.aliado ?? { id: 9205, nombre: "Agencia Uno", nit: "901", tipo: "agencia", pct_comision: 0.1, aplica_retencion: false, pct_retencion: 0 }],
    parametros_tributarios: [],
  };
  const bd = usarBD(semilla, {
    registrar_comision_b2b_reserva: (args) => {
      if (opts.falla) throw new Error(opts.falla);
      const v = bd.filas("ventas").find((x) => x.numero_contrato === args.p_numero);
      if (!v) throw new Error("El contrato no existe.");
      if (bd.filas("aliados_b2b").some((x) => x.numero_contrato === args.p_numero)) throw new Error(`El contrato ${args.p_numero} ya tiene comisión B2B.`);
      const neta = v.modo_compra === "neta";
      const bruto = Number(v.precio_venta) + (neta ? Number(v.comision_b2b) : 0);
      const fila = {
        id: 501 + bd.filas("aliados_b2b").length, numero_contrato: v.numero_contrato, tenant: v.tenant, aliado_id: args.p_aliado_id,
        precio_venta: bruto, base_comision: bruto - Number(v.impuesto), base_explicita: true, pct_comision: 0.1,
        estado: neta ? "pagada" : "pendiente", descontada_en_precio: neta,
      };
      bd.filas("aliados_b2b").push(fila);
      return fila.id;
    },
    crear_pasajeros_contrato_con_sillas: () => [],
    congelar_condiciones_contrato: () => "OK",
    registrar_financiero_contrato: () => ({ creadas: [], eliminadas: [] }),
    revertir_contrato_incompleto: (args) => {
      const n = args.p_numero_contrato;
      for (const t of ["aliados_b2b", "ventas", "contrato_items", "contrato_pasajeros", "contrato_financiero_pendiente"]) {
        bd.tablas.set(t, bd.filas(t).filter((x) => x.numero_contrato !== n));
      }
      return null;
    },
  });
  return bd;
}
const llamadas = (bd: ReturnType<typeof montar>, fn: string) => bd.llamadasRpc.filter((c) => c.fn === fn);

test("venta (antes rechazado por RLS) convierte una reserva COMISIONABLE: la comisión se registra, una sola", async () => {
  const bd = montar();
  const r = await convertirCotizacion(41, [PASAJERO]);
  assert.equal(r.ok, true, JSON.stringify(r));
  const [venta] = bd.filas("ventas");
  assert.equal(venta?.modo_compra, "comisionable");
  assert.equal(venta?.comision_b2b, 80_000);
  assert.equal(venta?.precio_venta, 1_000_000);
  assert.equal(venta?.aliado_id, 9205);
  const regs = llamadas(bd, "registrar_comision_b2b_reserva");
  assert.equal(regs.length, 1);
  assert.deepEqual(regs[0].args, { p_numero: venta?.numero_contrato, p_aliado_id: 9205 });
  assert.equal(bd.filas("aliados_b2b").length, 1);
  assert.equal(bd.filas("aliados_b2b").filter((f) => "insert_directo" in f).length, 0);
});

test("venta convierte una reserva NETO: precio neto en la venta, comisión descontada", async () => {
  const bd = montar({ cot: { modoCompra: "neta" } });
  const r = await convertirCotizacion(41, [PASAJERO]);
  assert.equal(r.ok, true, JSON.stringify(r));
  const [venta] = bd.filas("ventas");
  assert.equal(venta?.precio_venta, 920_000);
  assert.equal(venta?.comision_estado, "descontada");
  const [com] = bd.filas("aliados_b2b");
  assert.equal(com?.descontada_en_precio, true);
  assert.equal(com?.precio_venta, 1_000_000);
});

test("si la base rechaza la comisión, la reserva FALLA y se revierte: sin contrato ni comisión", async () => {
  const bd = montar({ falla: "No autorizado para registrar la comisión de la reserva." });
  const r = await convertirCotizacion(41, [PASAJERO]);
  assert.equal(r.ok, false);
  assert.match((r as { error: string }).error, /comisión B2B de la reserva: No autorizado/);
  assert.equal(llamadas(bd, "revertir_contrato_incompleto").length, 1);
  assert.equal(bd.filas("ventas").length, 0, "no queda contrato a medias");
  assert.equal(bd.filas("aliados_b2b").length, 0);
  assert.equal(llamadas(bd, "crear_pasajeros_contrato_con_sillas").length, 0, "se detuvo antes de los pasajeros");
  assert.equal(bd.filas("cotizaciones")[0]?.estado, "abierta", "la cotización no queda convertida");
});

test("reserva B2B SIN aliado: falla antes de numerar y no crea nada (antes omitía la comisión en silencio)", async () => {
  const bd = montar({ cot: { aliadoId: null } });
  const r = await convertirCotizacion(41, [PASAJERO]);
  assert.equal(r.ok, false);
  assert.match((r as { error: string }).error, /falta la agencia/);
  assert.equal(bd.filas("ventas").length, 0);
  assert.equal(bd.llamadasRpc.length, 0, "ni numeración, ni pasajeros, ni comisión");
});

test("aliado inexistente o de otro tipo: falla antes de numerar", async () => {
  const sinAliado = montar({ aliado: null });
  const r1 = await convertirCotizacion(41, [PASAJERO]);
  assert.equal(r1.ok, false);
  assert.match((r1 as { error: string }).error, /no existe en el catálogo/);
  assert.equal(sinAliado.filas("ventas").length, 0);
  const otroTipo = montar({ aliado: { id: 9205, nombre: "F", nit: "1", tipo: "freelance", pct_comision: 0.1 } });
  const r2 = await convertirCotizacion(41, [PASAJERO]);
  assert.equal(r2.ok, false);
  assert.match((r2 as { error: string }).error, /es de tipo "freelance"/);
  assert.equal(otroTipo.filas("ventas").length, 0);
});

test("modo de compra inválido: falla antes de numerar", async () => {
  const bd = montar({ cot: { modoCompra: "regalada" } });
  const r = await convertirCotizacion(41, [PASAJERO]);
  assert.equal(r.ok, false);
  assert.equal(bd.filas("ventas").length, 0);
});

test("sin duplicados: convertir dos veces la misma cotización no registra otra comisión", async () => {
  const bd = montar();
  const r1 = await convertirCotizacion(41, [PASAJERO]);
  assert.equal(r1.ok, true);
  const r2 = await convertirCotizacion(41, [PASAJERO]);
  assert.equal(r2.ok, true);
  assert.equal(r1.ok && r2.ok && r1.numero === r2.numero, true, "devuelve el mismo contrato");
  assert.equal(llamadas(bd, "registrar_comision_b2b_reserva").length, 1);
  assert.equal(bd.filas("aliados_b2b").length, 1);
  assert.equal(bd.filas("ventas").length, 1);
});

test("venta interna: no pide aliado ni registra comisión", async () => {
  const bd = montar({ cot: { tipoAsesor: "interno", aliadoId: null, modoCompra: undefined } });
  const r = await convertirCotizacion(41, [PASAJERO]);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(llamadas(bd, "registrar_comision_b2b_reserva").length, 0);
  assert.equal(bd.filas("aliados_b2b").length, 0);
});
