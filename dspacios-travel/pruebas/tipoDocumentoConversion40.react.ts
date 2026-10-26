// Se ejecuta con npm run test:react (loader del arnés).
//
// #40 E2 — El tipo de documento (CC/CE) sobrevive a la conversión cotización → contrato, de punta a punta con el código REAL de
// `convertirCotizacion` (reservar) contra la BD en memoria del arnés, en PVP con comisión y en NETO, y a una edición posterior (`actualizarVenta`).
// En NETO el cliente es el ALIADO y la persona es el titular: cada uno conserva SU tipo (`camposClienteVenta`, prueba pura abajo).
// Por inspección de fuente (wiring) porque exigen superficie que el arnés no simula: reservarPrograma y convertirCotizacionCarrito.
// La RPC SQL de la cotización manual (migración 241) NO corre aquí: se valida con preflight/postcheck en Postgres.
import * as nodeModule from "node:module";
import { readFileSync } from "node:fs";
import { usarBD, type Fila } from "./support/fechaNegocioArnes.ts";
import { test } from "node:test";
import assert from "node:assert/strict";

type ResolveHook = (s: string, c: { parentURL?: string }, n: (s: string, c: unknown) => unknown) => unknown;
const { registerHooks } = nodeModule as unknown as { registerHooks: (h: { resolve: ResolveHook }) => void };
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@/lib/reservar/computo") {
      const src = "export async function computarReserva(sb, input) { return globalThis.__computo40(input); }";
      return { url: `data:text/javascript,${encodeURIComponent(src)}`, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});

process.env.SUPABASE_SERVICE_ROLE_KEY ??= "clave-de-prueba";
(globalThis as unknown as { __computo40: () => unknown }).__computo40 = () => ({
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
const { actualizarVenta } = await import("../app/(dashboard)/dashboard/contratos/actions.ts");
const { camposClienteVenta, titularDeCliente, fiscalDeFilaAliado } = await import("../lib/cotizacion/identidadB2B.ts");
const { tipoDocumentoParaVenta } = await import("../lib/personas/tiposDocumento.ts");

const PASAJERO = (tipoDoc: string) => ({ nombres: "Ana", apellidos: "Ruiz", tipoDoc, numeroDoc: "1010", fechaNacimiento: "1990-01-01", nacionalidad: "", esInfante: false });
const payload = (tipoDoc: string, extra: Record<string, unknown> = {}) => ({
  paqueteId: 7, bloqueoId: null, empaquetadoId: null, salidaId: null, modulo: "servicios", hotelId: null,
  categoria: "", regimen: "", habitaciones: {}, ninos: 0, ninos2: 0, infantes: 0, mascotas: 0, paxServicios: 1,
  cliente: { nombres: "Ana", apellidos: "Ruiz", tipoDoc, numeroDoc: "1010", telefono: "300", email: "" },
  tipoAsesor: "agencia", asesorInterno: "Asesor", agenciaNombre: "Agencia Uno", agenciaAsesor: "", freelanceNombre: "",
  aliadoId: 9205, modoCompra: "comisionable", plazo: "2026-10-20", pasajeros: [PASAJERO(tipoDoc)], servicios: [],
  ...extra,
});

function montar(cots: { id: number; tipoDoc: string; extra?: Record<string, unknown> }[]) {
  const bd = usarBD({
    usuarios: [{ id: "u-arnes", rol: "superadmin", activo: true, tenant: "mayorista", nombre: "Asesor" }],
    cotizaciones: cots.map((c) => ({ id: c.id, estado: "abierta", numero_contrato: null, tenant: "mayorista", payload: payload(c.tipoDoc, c.extra) })),
    aliados: [{ id: 9205, nombre: "Agencia Uno", nit: "901", tipo: "agencia", pct_comision: 0.1, aplica_retencion: false, pct_retencion: 0 }],
    parametros_tributarios: [],
  }, {
    registrar_comision_b2b_reserva: (args) => {
      const v = bd.filas("ventas").find((x) => x.numero_contrato === args.p_numero)!;
      bd.filas("aliados_b2b").push({ id: 501 + bd.filas("aliados_b2b").length, numero_contrato: v.numero_contrato, tenant: v.tenant, aliado_id: args.p_aliado_id });
      return 501;
    },
    crear_pasajeros_contrato_con_sillas: () => [],
    congelar_condiciones_contrato: () => "OK",
    registrar_financiero_contrato: () => ({ creadas: [], eliminadas: [] }),
    revertir_contrato_incompleto: () => null,
  });
  return bd;
}

async function convertir(bd: ReturnType<typeof montar>, id: number, tipoDoc: string) {
  const r = await convertirCotizacion(id, [PASAJERO(tipoDoc)]);
  assert.equal(r.ok, true, JSON.stringify(r));
  return bd.filas("ventas").find((v) => v.numero_contrato === (r as { numero: string }).numero)!;
}

for (const modo of ["comisionable", "neta"] as const) {
  test(`${modo}: mismo número con CC y con CE → cada contrato conserva el tipo elegido; el PVP/NETO no cambia por el tipo`, async () => {
    const bd = montar([{ id: 41, tipoDoc: "CC", extra: { modoCompra: modo } }, { id: 42, tipoDoc: "CE", extra: { modoCompra: modo } }]);
    const a = await convertir(bd, 41, "CC");
    const b = await convertir(bd, 42, "CE");
    assert.deepEqual([a.cliente_documento, a.cliente_tipo_documento], ["1010", "CC"]);
    assert.deepEqual([b.cliente_documento, b.cliente_tipo_documento], ["1010", "CE"]);
    assert.equal(a.precio_venta, b.precio_venta);
    assert.equal(a.precio_venta, modo === "neta" ? 920_000 : 1_000_000);
  });

  test(`${modo}: una edición posterior del contrato no pierde el tipo (ni al cambiar otros datos ni al reenviar el mismo número)`, async () => {
    const bd = montar([{ id: 41, tipoDoc: "CE", extra: { modoCompra: modo } }]);
    const v = await convertir(bd, 41, "CE");
    bd.filas("ventas_basica").push({ numero_contrato: v.numero_contrato, tipo_asesor: v.tipo_asesor ?? null });
    const base = {
      cliente: String(v.cliente), clienteDocumento: String(v.cliente_documento), clienteTelefono: "301", clienteEmail: "", clienteDireccion: "",
      destino: "SAN ANDRES", fechaSalida: "2026-11-01", fechaRegreso: "2026-11-04", plazo: "", tipoAsesor: String(v.tipo_asesor ?? "interno"),
      agenciaNombre: String(v.agencia_nombre ?? ""), agenciaAsesor: "", freelanceNombre: "", asesorNombre: "Asesor", planNombre: "", observaciones: "",
      precioVenta: String(v.precio_venta), pax: String(v.pax),
    };
    assert.equal((await actualizarVenta(String(v.numero_contrato), base)).ok, true); // llamador viejo: sin campo de tipo
    assert.equal(v.cliente_tipo_documento, "CE");
    assert.equal((await actualizarVenta(String(v.numero_contrato), { ...base, clienteTipoDocumento: "CE" })).ok, true);
    assert.equal(v.cliente_tipo_documento, "CE");
  });
}

test("NETO (carrito): el cliente lleva el tipo del ALIADO y el titular el SUYO; nunca se cruzan", () => {
  const fiscal = fiscalDeFilaAliado({ nombre: "Viajes Aurora", nit: "900123456", tipo_documento: "NIT" });
  const titular = titularDeCliente({ nombres: "Ana", apellidos: "Ruiz", numeroDoc: "1010", tipoDoc: "CE" });
  const neto = camposClienteVenta({ modo: "neta", fiscal, titular });
  assert.deepEqual([neto.cliente_documento, neto.cliente_tipo_documento], ["900123456", "NIT"]);
  assert.deepEqual([neto.titular_documento, neto.titular_tipo_documento], ["1010", "CE"]);
  const pvp = camposClienteVenta({ modo: "comisionable", fiscal, titular });
  assert.deepEqual([pvp.cliente_documento, pvp.cliente_tipo_documento, pvp.titular_tipo_documento], ["1010", "CE", null]);
  const b2c = camposClienteVenta({ modo: null, fiscal: null, titular });
  assert.deepEqual([b2c.cliente_tipo_documento, b2c.titular_nombre], ["CE", null]);
  // Aliado sin documento o con una etiqueta fuera del catálogo: sin tipo (no se hereda el del titular).
  const sinDoc = camposClienteVenta({ modo: "neta", fiscal: fiscalDeFilaAliado({ nombre: "X", nit: null, tipo_documento: "NIT" }), titular });
  assert.equal(sinDoc.cliente_tipo_documento, null);
  const raro = camposClienteVenta({ modo: "neta", fiscal: fiscalDeFilaAliado({ nombre: "X", nit: "5", tipo_documento: "Cédula" }), titular });
  assert.equal(raro.cliente_tipo_documento, null);
});

test("tipoDocumentoParaVenta: catálogo, «PASAPORTE» legado → PAS, desconocido o sin número → null", () => {
  assert.equal(tipoDocumentoParaVenta("ce", "1"), "CE");
  assert.equal(tipoDocumentoParaVenta("PASAPORTE", "A1"), "PAS");
  assert.equal(tipoDocumentoParaVenta("XX", "1"), null);
  assert.equal(tipoDocumentoParaVenta("CC", ""), null);
  assert.equal(tipoDocumentoParaVenta(undefined, "1"), null);
});

test("wiring: programa, carrito y reservar escriben el tipo; la migración 241 copia el de la cotización manual", () => {
  const src = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
  const reservar = src("app/(dashboard)/dashboard/reservar/actions.ts");
  assert.equal((reservar.match(/cliente_tipo_documento: tipoDocumentoParaVenta\(input\.cliente\.tipoDoc/g) ?? []).length, 2, "reservar directo + programa");
  assert.match(reservar, /camposClienteVenta\(\{ modo: planB2BCot/, "el carrito usa camposClienteVenta (con los dos tipos)");
  assert.match(src("supabase/migrations/20260601000241_tipo_documento_conversion.sql"), /set cliente_tipo_documento = t\.tipo/);
});
