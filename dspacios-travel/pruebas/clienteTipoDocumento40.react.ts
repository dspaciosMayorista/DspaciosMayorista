// Se ejecuta con npm run test:react (loader del arnés).
//
// #40 E2 — El tipo de documento del cliente se persiste hasta la base (ventas.cliente_tipo_documento, migración 240), con el código REAL de
// `crearContrato` y `actualizarVenta` contra la BD en memoria del arnés: el mismo número con tipos distintos (CE frente a CC) no se confunde,
// todos los tipos que devuelve la RPC de personas (incluidos PAS, RC y PPT) se aceptan, y uno fuera del catálogo se rechaza sin escribir.
import { usarBD, type Fila } from "./support/fechaNegocioArnes.ts";
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.SUPABASE_SERVICE_ROLE_KEY ??= "clave-de-prueba";

const { crearContrato, actualizarVenta } = await import("../app/(dashboard)/dashboard/contratos/actions.ts");
const { TIPOS_DOC_PERSONA } = await import("../lib/personas/identidad.ts");

const YO: Fila = { id: "u-arnes", nombre: "Asesor", email: "arnes@dspacios.test", rol: "superadmin", tenant: "mayorista", activo: true, aliado_id: null, acceso_legacy_nombre: false };

function contrato(extra: Record<string, unknown> = {}) {
  return {
    tipoPaquete: "dinamico" as const, paqueteId: null, bloqueoId: null,
    cliente: "Cliente Prueba", clienteDocumento: "123456", clienteTelefono: "", clienteDireccion: "",
    destino: "CARTAGENA", fechaSalida: "2026-12-01", fechaRegreso: "2026-12-04", fechaEmision: "2026-10-11",
    asistenciaMedica: false, planNombre: "", toursTraslados: "",
    asesorNombre: "Asesor", asesorCargo: "", asesorCc: "", asesorTel: "",
    pasajeros: [],
    hoteles: [{
      nombre: "Hotel Sol", categoria: "Estándar", proveedor: "Operador Sol", ciudad: "Cartagena", alimentacion: "PC",
      acomodacion: "Doble", detalleAcomodacion: "", fechaIngreso: "2026-12-01", fechaSalida: "2026-12-04", costo: 900_000,
    }],
    vuelos: [],
    items: [{ descripcion: "Paquete Cartagena", adultos: 2, ninos: 0, tarifaAdulto: 1_000_000, tarifaNino: 0 }],
    tipoVenta: "interno" as const,
    bncModo: "fijo" as const,
    bncFijo: 400_000,
    ...extra,
  };
}

function bd() {
  let id = 900;
  return usarBD({ usuarios: [YO], parametros_tributarios: [] }, {
    registrar_financiero_contrato: (args: Record<string, unknown>) => {
      const b = bd_.ref!;
      const v = b.filas("ventas").find((x) => x.numero_contrato === args.p_numero_contrato)!;
      Object.assign(v, args.p_costos as Record<string, unknown>, { financiero_estado: "completo" });
      const creadas = (args.p_cxp as Record<string, unknown>[]).map((c) => {
        const fila = { id: ++id, numero_contrato: v.numero_contrato, tenant: args.p_tenant, ...c };
        b.filas("cuentas_por_pagar").push(fila);
        return { id: fila.id, tipo_proveedor: c.tipo_proveedor, proveedor: c.proveedor, servicio: c.servicio, valor_total: c.valor_total };
      });
      return { creadas, eliminadas: [] };
    },
  });
}
const bd_: { ref?: ReturnType<typeof usarBD> } = {};
const nuevaBD = () => (bd_.ref = bd());

async function crear(extra: Record<string, unknown>) {
  const r = await crearContrato(contrato(extra));
  assert.equal(r.ok, true, JSON.stringify(r));
  return (r as { numero: string }).numero;
}
const venta = (numero: string) => bd_.ref!.filas("ventas").find((v) => v.numero_contrato === numero)!;

test("mismo número con CC y con CE: cada contrato conserva el tipo elegido", async () => {
  nuevaBD();
  const a = await crear({ clienteTipoDocumento: "CC" });
  const b = await crear({ clienteTipoDocumento: "CE" });
  assert.deepEqual([venta(a).cliente_documento, venta(a).cliente_tipo_documento], ["123456", "CC"]);
  assert.deepEqual([venta(b).cliente_documento, venta(b).cliente_tipo_documento], ["123456", "CE"]);
});

test("cada tipo del catálogo (PAS, RC, PPT, NIT…) se acepta al crear y al editar", async () => {
  nuevaBD();
  for (const t of TIPOS_DOC_PERSONA) {
    const n = await crear({ clienteTipoDocumento: t });
    assert.equal(venta(n).cliente_tipo_documento, t, `crear ${t}`);
    const otro = TIPOS_DOC_PERSONA[(TIPOS_DOC_PERSONA.indexOf(t) + 1) % TIPOS_DOC_PERSONA.length];
    const r = await actualizarVenta(n, edicion(n, { clienteTipoDocumento: otro }));
    assert.equal(r.ok, true, `${t} → ${otro}: ${JSON.stringify(r)}`);
    assert.equal(venta(n).cliente_tipo_documento, otro, `editar ${t} → ${otro}`);
  }
});

// actualizarVenta lee la modalidad por la vista `ventas_basica`: el arnés no la tiene, se espeja la fila.
function edicion(numero: string, extra: Record<string, unknown>) {
  const v = venta(numero);
  const vista = bd_.ref!.filas("ventas_basica");
  if (!vista.some((f) => f.numero_contrato === numero)) vista.push({ numero_contrato: numero, tipo_asesor: v.tipo_asesor ?? null });
  return {
    cliente: String(v.cliente), clienteDocumento: String(v.cliente_documento ?? ""), clienteTelefono: "", clienteEmail: "", clienteDireccion: "",
    destino: "CARTAGENA", fechaSalida: "2026-12-01", fechaRegreso: "2026-12-04", plazo: "", tipoAsesor: "interno",
    agenciaNombre: "", agenciaAsesor: "", freelanceNombre: "", asesorNombre: "Asesor", planNombre: "", observaciones: "",
    precioVenta: String(v.precio_venta), pax: String(v.pax),
    ...extra,
  } as Parameters<typeof actualizarVenta>[1];
}

test("editar: ausente no toca el tipo guardado; vacío lo quita; fuera del catálogo se rechaza sin escribir", async () => {
  nuevaBD();
  const n = await crear({ clienteTipoDocumento: "PPT", clienteDocumento: "ab12345" });
  assert.equal((await actualizarVenta(n, edicion(n, { cliente: "Otro Nombre" }))).ok, true);
  assert.equal(venta(n).cliente_tipo_documento, "PPT", "un llamador que no manda el campo no borra el tipo");
  const mal = await actualizarVenta(n, edicion(n, { clienteTipoDocumento: "PASAPORTE" }));
  assert.equal(mal.ok, false);
  assert.equal(venta(n).cliente_tipo_documento, "PPT");
  assert.equal((await actualizarVenta(n, edicion(n, { clienteTipoDocumento: "" }))).ok, true);
  assert.equal(venta(n).cliente_tipo_documento ?? null, null, "vacío quita el tipo");
});

test("sin tipo elegido el contrato se crea igual (no se inventa un CC) y un tipo sin número no se guarda", async () => {
  nuevaBD();
  const a = await crear({});
  assert.equal(venta(a).cliente_tipo_documento ?? null, null);
  const b = await crear({ clienteTipoDocumento: "CE", clienteDocumento: "" });
  assert.equal(venta(b).cliente_tipo_documento ?? null, null);
  const r = await crearContrato(contrato({ clienteTipoDocumento: "XX" }));
  assert.equal(r.ok, false);
});

// El arnés sirve el consecutivo con un contador (`seq`): cada número reservado lo avanza.
const consecutivos = () => (globalThis as unknown as { __arnesFechas: { seq?: number } }).__arnesFechas.seq ?? 450;

test("tipo inválido se rechaza ANTES de reservar el consecutivo: no consume número", async () => {
  nuevaBD();
  const antes = consecutivos();
  const r = await crearContrato(contrato({ clienteTipoDocumento: "PASAPORTE" }));
  assert.equal(r.ok, false);
  assert.equal(consecutivos(), antes, "un tipo inválido no debe pedir consecutivo");
  assert.equal(bd_.ref!.filas("ventas").length, 0);
  await crear({ clienteTipoDocumento: "CC" });
  assert.equal(consecutivos(), antes + 1, "uno válido sí consume exactamente uno");
});

test("editar el NÚMERO sin enviar tipo no hereda el tipo del documento anterior; sin cambiar el número lo conserva", async () => {
  nuevaBD();
  const n = await crear({ clienteTipoDocumento: "CE", clienteDocumento: "111111" });
  const sinTipo = (extra: Record<string, unknown>) => {
    const e = edicion(n, extra) as Record<string, unknown>;
    delete e.clienteTipoDocumento;
    return e as Parameters<typeof actualizarVenta>[1];
  };
  assert.equal((await actualizarVenta(n, sinTipo({ cliente: "Mismo número" }))).ok, true);
  assert.equal(venta(n).cliente_tipo_documento, "CE", "mismo número, sin tipo: compatibilidad, se conserva");
  assert.equal((await actualizarVenta(n, sinTipo({ clienteDocumento: "222222" }))).ok, true);
  assert.equal(venta(n).cliente_documento, "222222");
  assert.equal(venta(n).cliente_tipo_documento ?? null, null, "número nuevo sin tipo: el tipo anterior NO se conserva");
  assert.equal((await actualizarVenta(n, edicion(n, { clienteDocumento: "333333", clienteTipoDocumento: "PPT" }))).ok, true);
  assert.deepEqual([venta(n).cliente_documento, venta(n).cliente_tipo_documento], ["333333", "PPT"]);
});
