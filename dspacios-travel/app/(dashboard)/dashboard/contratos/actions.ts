"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";
import { precioServicio, noches, factorLiquidacion } from "@/lib/calc/paquetes";
import { normalizarCategoriaServicio, resumirServiciosContrato, tipoProveedorCxpServicio } from "@/lib/reservar/serviciosPaquete";
import { planReconciliacionCxpServicios, type ServicioObjetivo } from "@/lib/reservar/cxpCobertura";
import { asegurarCuentasPorPagar } from "@/lib/reservar/asegurarCuentasPorPagar";
import { mensajeErrorRpc } from "@/lib/vuelos/operaciones";
import { formatMoneda } from "@/lib/utils";
import { fechaElegidaONegocio, fechaNegocio } from "@/lib/fechaNegocio";
import { siguienteNumeroContrato } from "@/lib/contrato/numeracion";
import { contextoCrearContrato } from "@/lib/contrato/contexto";
import { reemplazarAsiento, postearAsientoCxP, eliminarAsientoCxP, postearAsientoAbonoAtomico } from "@/lib/contabilidad/asientos";
import { esInfantePorEdad, pasajeroConsumeSilla } from "@/lib/reservar/pasajeros";
import { payloadGuardarPasajeros } from "@/lib/reservar/pasajerosEdicion";
import {
  planNetoContratoManual, comisionCoincide, esAsesorPropio, aplicarNetoContratoManual, type PlanNetoManual,
} from "@/lib/contrato/netoManual";
import { evaluarMargenContrato, puedeAprobarMargenBajo, mensajeMargenInsuficiente } from "@/lib/contrato/margenContrato";
import type { Json } from "@/types/database";
import {
  generarFlujoId, crearMedidor, registrarEtapa, registrarErrorTecnico,
  crearEstadoFlujo, elevarEstadoFlujo, resultadoTotal,
  type Medidor, type ResultadoEtapa, type EstadoFlujo,
} from "@/lib/observabilidad/medicion";
import { revertirContratoIncompleto, registrarFinancieroContrato, type CxPFinanciera, type CostosContrato } from "@/lib/reservar/financieroContrato";
import { netoTotalExigibleDeContrato } from "@/lib/contrato/netoContrato.server";
import { cobroDeVenta } from "@/lib/finanzas/cobro";

// #30 (CXP-1) — escritura financiera del contrato manual: las mismas RPC de
// sistema que usa reservar (migraciones 171/172, solo service_role), con
// despacho explícito por nombre. Las CxP llevan la marca de "automática"
// (`marca_cxp_automatica()`, como prefijo) para que un reintento las
// reemplace en vez de duplicarlas.
const OBS_CXP_MANUAL = "Generado automáticamente desde el tarifario (contrato manual)";
async function rpcFinancieroManual(fn: string, args: Record<string, unknown>): Promise<{ data: unknown; error: { message: string } | null }> {
  const admin = createAdminClient();
  if (fn === "registrar_financiero_contrato") {
    const { data, error } = await admin.rpc("registrar_financiero_contrato", {
      p_numero_contrato: String(args.p_numero_contrato ?? ""),
      p_tenant: String(args.p_tenant ?? ""),
      p_costos: (args.p_costos ?? {}) as Json,
      p_cxp: (args.p_cxp ?? []) as Json,
    });
    return { data: data as unknown, error: error ? { message: error.message } : null };
  }
  if (fn === "revertir_contrato_incompleto") {
    const { data, error } = await admin.rpc("revertir_contrato_incompleto", {
      p_numero_contrato: String(args.p_numero_contrato ?? ""),
      p_tenant: String(args.p_tenant ?? ""),
    });
    return { data: data as unknown, error: error ? { message: error.message } : null };
  }
  return { data: null, error: { message: `RPC no soportado: ${fn}` } };
}
function depsFinancieroManual(numeroContrato: string, tenant: string, fecha: string) {
  return {
    rpc: rpcFinancieroManual,
    postearAsiento: (c: { id: number; tipo_proveedor: string | null; proveedor: string | null; servicio: string | null; valor_total: number }) =>
      postearAsientoCxP({
        cuentaId: c.id, numeroContrato, tipoProveedor: c.tipo_proveedor, proveedor: c.proveedor,
        servicio: c.servicio, valorTotal: c.valor_total, fecha, tenant,
      }),
    eliminarAsiento: (cuentaId: number) => eliminarAsientoCxP(cuentaId),
    // Intención durable (172): su propio commit, antes del RPC.
    guardarPendiente: async (p: { numeroContrato: string; tenant: string; costos: CostosContrato; cxp: CxPFinanciera[] }) => {
      const { error } = await createAdminClient().from("contrato_financiero_pendiente").upsert({
        numero_contrato: p.numeroContrato, tenant: p.tenant, costos: p.costos as Json, cxp: p.cxp as unknown as Json,
      }, { onConflict: "numero_contrato" });
      return error ? { ok: false, error: error.message } : { ok: true };
    },
  };
}

// Deshace un contrato manual que quedó a medias: borra la venta y sus hijas y
// libera SOLO sus sillas (`revertir_contrato_incompleto`, migración 171). Es
// la misma reversión de la reserva desde tarifario; necesita service_role.
async function revertirContratoManual(numero: string, tenant: string): Promise<{ ok: boolean; error?: string }> {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return { ok: false, error: "Falta la clave de servicio para revertir el contrato." };
  const admin = createAdminClient();
  return revertirContratoIncompleto({
    rpc: async (_fn, args) => {
      const { data, error } = await admin.rpc("revertir_contrato_incompleto", {
        p_numero_contrato: String(args.p_numero_contrato ?? ""),
        p_tenant: String(args.p_tenant ?? ""),
      });
      return { data: data as unknown, error: error ? { message: error.message } : null };
    },
  }, numero, tenant);
}

// Postea (o reemplaza) el asiento de un abono: Debe Caja/Bancos (según forma
// de pago) / Haber Anticipos de clientes (280505) si el contrato AÚN no está
// facturado, o Clientes (130505) si ya lo está. Nunca bloquea el registro del
// abono en sí, pero un fallo ya no es silencioso: se devuelve para avisarlo.
// 208 (M1): lo escribe UNA RPC atómica con el abono y la venta bloqueados (el
// asiento nunca sobrevive a su abono), en los libros de la agencia DEL
// CONTRATO; la cuenta acreedora la decide la base con la factura vigente a la
// vista y se conserva al re-postear. El actor es el usuario de la sesión.
async function postearAsientoAbono(
  sb: Awaited<ReturnType<typeof createClient>>, abonoId: number, tenant: string | undefined,
): Promise<string | null> {
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return "sesión no válida";
  const r = await postearAsientoAbonoAtomico(abonoId, tenant ?? "mayorista", user.id);
  return r.ok ? null : r.error;
}

// Margen mínimo de un contrato manual (dinámico/empaquetado): 20 % sobre el
// PVP; 6 % sobre el total exigible si el comprador B2B compra en NETO (#30).
// Regla y tolerancia en lib/contrato/margenContrato.ts.

// Mensajes públicos FIJOS para fallos TÉCNICOS de crearContrato() (revisión
// posterior — ronda 3, defecto "ERROR.MESSAGE TODAVÍA LLEGA AL NAVEGADOR"):
// antes, un INSERT/consulta de Supabase fallido devolvía `error.message`
// directo al navegador — un mensaje de Postgres puede revelar tablas,
// constraints, policies o valores de fila. Estos dos mensajes son literales
// fijos, nunca derivados del error real (que se registra aparte, server-side,
// vía el helper `registrarErrorTecnico`). Diferenciados solo para que el asesor sepa
// si falló la VERIFICACIÓN (nada se guardó) o el GUARDADO (pudo quedar a
// medias) — ninguno de los dos incluye detalle técnico.
const MSG_ERROR_VALIDACION_CONTRATO = "No fue posible verificar la información del contrato. Intenta nuevamente o contacta a soporte.";
const MSG_ERROR_GUARDAR_CONTRATO = "No fue posible guardar el contrato. Intenta nuevamente o contacta a soporte.";

export type TipoPaquete = "bloqueo" | "porcion_terrestre" | "empaquetado" | "dinamico";

export type PasajeroInput = {
  nombres: string;
  apellidos: string;
  tipoId: string;
  identificacion: string;
  fechaNacimiento: string;
  esInfante: boolean;
  // Posición (0-based) del adulto responsable dentro de este mismo arreglo
  // — solo aplica si este pasajero resulta infante por fecha de nacimiento
  // real. Ver PasajeroReserva en lib/reservar/computo.ts (mismo criterio).
  responsableIndex?: number | null;
};

export type HotelInput = {
  nombre: string;
  categoria: string;
  proveedor: string;
  ciudad: string;
  alimentacion: string;
  acomodacion: string;
  detalleAcomodacion: string;
  fechaIngreso: string;
  fechaSalida: string;
  costo?: number;   // costo neto del hotel (alimenta costo_hotel + CxP al proveedor)
};

// Un tramo/trayecto = una sola dirección de vuelo (aerolínea, origen→destino,
// fecha, número de vuelo, horas). Un viaje redondo son 2 filas (ida y
// regreso); un multi-ciudad, tantas filas como tramos.
export type VueloInput = {
  aerolinea: string;
  record: string;
  direccion: string; // "ida" | "regreso" | "" (tramo suelto/multi-ciudad)
  origenCodigo: string;
  origenCiudad: string;
  destinoCodigo: string;
  destinoCiudad: string;
  numeroVuelo: string;
  fecha: string;
  horaSalida: string;
  horaLlegada: string;
  servicios: string;
  // Índice de la COMPRA (en `compras`) a la que pertenece este tramo, o null si
  // el tramo no tiene costo propio (ej. una escala informativa). El costo ya NO
  // vive en el tramo: ver ComprasAereo abajo.
  compraIdx?: number | null;
};

// Una COMPRA aérea = un pago real a un proveedor/consolidador, que puede cubrir
// VARIOS tramos (ej. ida con Copa + regreso con Wingo compradas juntas en una
// sola transacción) o solo uno. El costo y la cuenta por pagar cuelgan de la
// compra, no del tramo — antes el costo era por tramo, lo que obligaba a
// inventar a qué tramo "cargarle" el total de una compra combinada (y dejaba
// los demás en $0 para no duplicar la CxP).
export type CompraAereaInput = {
  proveedor: string;  // aerolínea, consolidador, OTA… (proveedor real de la CxP)
  referencia: string; // n.º de factura/orden/localizador de la compra (opcional)
  costo: number;      // costo neto TOTAL de la compra (todos sus tramos juntos)
};

export type ItemInput = {
  descripcion: string;
  adultos: number;
  ninos: number;
  tarifaAdulto: number;
  tarifaNino: number;
};

// Servicio con proveedor propio (asistencia médica, traslados, tours…), aparte
// de hotel/vuelo: alimenta el costo interno correspondiente y su CxP.
export type TipoServicio = "asistencia" | "traslado" | "tour" | "otro";
export type ServicioInput = {
  tipo: TipoServicio;
  descripcion: string;
  proveedor: string;
  costo?: number;
};

export type ContratoInput = {
  tipoPaquete: TipoPaquete;
  paqueteId: number | null;
  bloqueoId: number | null; // record asignado (solo bloqueo)
  cliente: string;
  clienteDocumento: string;
  clienteTelefono: string;
  clienteDireccion: string;
  destino: string;
  fechaSalida: string;
  fechaRegreso: string;
  fechaEmision: string;
  asistenciaMedica: boolean;
  planNombre: string;
  toursTraslados: string;
  asesorNombre: string;
  asesorCargo: string;
  asesorCc: string;
  asesorTel: string;
  pasajeros: PasajeroInput[];
  hoteles: HotelInput[];
  vuelos: VueloInput[];
  // Compras aéreas (1 pago = 1+ tramos). Los tramos apuntan aquí por índice.
  comprasAereas?: CompraAereaInput[];
  servicios?: ServicioInput[];
  items: ItemInput[];
  // BNC (Base No Comisionable) — se elige al crear el contrato (dinámico/empaquetado
  // no la traen). modo 'tiquetes' = BNC es el valor de los tiquetes; 'fijo' = un
  // valor fijo que NUNCA puede ser menor al valor de los tiquetes.
  bncModo?: "tiquetes" | "fijo";
  valorTiquetes?: number;
  bncFijo?: number;
  // Canal / asesor. Todo contrato lleva asesor interno; B2B además agencia o freelance.
  tipoVenta?: "interno" | "agencia" | "freelance";
  aliadoId?: number | null;   // id del catálogo de agencias/freelance (B2B)
  // #30 (entrega B): cómo compra el aliado B2B. "pvp" (default) = paga el
  // total y su comisión queda "Por definir" (como dejó #38); "neto" = paga
  // PVP − su comisión, ya descontada. `comisionNetoEsperada` es la comisión
  // que el asesor vio en pantalla: si el servidor o la base calculan otra, se
  // niegan en vez de cobrar un total distinto al mostrado.
  modoCompra?: "pvp" | "neto";
  comisionNetoEsperada?: number | null;
  // Moneda del contrato. En empaquetado/dinámico (todo manual) el asesor puede
  // venderlo en USD; el resto (abonos con TRM, estado de cuenta) fluye igual.
  moneda?: string;
  // Aprobación explícita de superadmin/administración para crear el contrato
  // aunque el margen no cubra el mínimo (lib/contrato/margenContrato.ts). El rol
  // se revalida siempre en el servidor — nunca se confía en este flag solo.
  forzarMargen?: boolean;
};

const oNull = (s: string) => (s && s.trim() !== "" ? s.trim() : null);

// `advertencias`: fallas NO bloqueantes que sí se reportan honestamente
// (nunca se tragan en silencio) — hoy solo las usa el guardado best-effort
// de nombres/apellidos estructurados (migración 187): el contrato y sus
// sillas quedan completos y correctos de todas formas, pero si ese UPDATE
// posterior falla, la creación SIGUE siendo un éxito (`ok: true`) y el
// detalle real de Supabase viaja aquí para que la UI lo muestre.
export type CrearContratoResult =
  | { ok: true; numero: string; advertencias?: string[] }
  | { ok: false; error: string; margenInsuficiente?: true; margenActual?: number; pvpMinimo?: number };

// Flujo real (revisión posterior — corrección de observabilidad): la Server
// Action exportada es un wrapper delgado que SOLO se encarga de generar el
// `flujo_id` de esta ejecución y de medir la duración TOTAL percibida por el
// asesor (incluye `revalidatePath` y cualquier trabajo posterior al último
// INSERT) — la etapa "total" se registra en `finally`, así que se emite
// tanto en éxito como en cualquier rechazo de validación (early-return) o
// excepción no capturada, sin tener que tocar cada uno de los `return`
// anticipados de la lógica real. `crearContratoInterno` es exactamente el
// cuerpo que existía antes de esta ronda, con las llamadas de medición ahora
// atadas al mismo `flujo_id` y con la clasificación de resultado corregida
// (ver `lib/observabilidad/medicion.ts` y el detalle etapa por etapa abajo).
export async function crearContrato(
  input: ContratoInput
): Promise<CrearContratoResult> {
  const flujoId = generarFlujoId();
  const medir = crearMedidor("crear_contrato", flujoId);
  // Estado técnico INTERNO (revisión posterior — ronda 2): distingue un
  // rechazo de negocio/sesión (`{ok:false}` sin nada técnico de por medio) de
  // un fallo TÉCNICO bloqueante (RPC de numeración, insert de `ventas`, un
  // insert obligatorio de tabla hija — también `{ok:false}`, antes ambos se
  // reportaban igual como "rechazado") y de un contrato creado con éxito
  // pero con un paso best-effort caído (antes reportado "ok" a ciegas). Se
  // muta DENTRO de `crearContratoInterno` en los puntos donde la lógica real
  // ya sabe que algo técnico falló; nunca se expone al navegador ni cambia
  // el contrato público de esta función (ver `lib/observabilidad/medicion.ts`).
  const estado = crearEstadoFlujo();
  const _tTotal0 = performance.now();
  let _resultadoTotal: ResultadoEtapa = "error";
  try {
    const res = await crearContratoInterno(input, flujoId, medir, estado);
    _resultadoTotal = resultadoTotal(estado, res.ok);
    return res;
  } catch (err) {
    _resultadoTotal = "error";
    registrarErrorTecnico("crear_contrato", flujoId, "total", "excepcion", err);
    throw err;
  } finally {
    registrarEtapa("crear_contrato", flujoId, "total", Math.round(performance.now() - _tTotal0), _resultadoTotal);
  }
}

async function crearContratoInterno(
  input: ContratoInput,
  flujoId: string,
  medir: Medidor,
  estado: EstadoFlujo
): Promise<CrearContratoResult> {
  // Fallas NO bloqueantes que SÍ se reportan (ver el comentario de
  // CrearContratoResult) — hoy solo las llena el guardado best-effort de
  // nombres/apellidos estructurados, más abajo.
  const advertencias: string[] = [];

  // Contexto fail-closed: sesión + activo=true + rol con permiso real de
  // escritura sobre `ventas` (revisión posterior al PR #274 — antes se
  // resolvía el tenant con la cookie de agencia a secas, sin sesión ni rol
  // verificados, y como el generador de número corre ahora con service_role,
  // esta validación de aplicación es la ÚNICA barrera real antes de gastar
  // un consecutivo DTM/MIN).
  // Medición server-side por etapas (sin PII — solo flujo, flujo_id, nombre
  // de etapa, duración y resultado técnico): diagnóstico de la demora del
  // botón "Generar contrato" pedido en la revisión posterior al PR #274.
  // `contexto` incluye las sub-etapas medidas dentro de
  // `contextoCrearContrato()` (auth.getUser + consulta de perfil, ya no
  // duplicadas — ver lib/contrato/contexto.ts), atadas al mismo `flujo_id`.
  const ctx = await medir("contexto", () => contextoCrearContrato("crear_contrato", flujoId), (r) => (r.ok ? "ok" : r.tecnico ? "error" : "rechazado"));
  if (!ctx.ok) {
    // `ctx.tecnico` (revisión posterior — ronda 3): un fallo TÉCNICO real de
    // auth.getUser()/la consulta de usuarios (nunca un rechazo de negocio
    // legítimo) eleva el TOTAL a "error" — antes quedaba indistinguible de
    // "rechazado". El mensaje público (`ctx.error`) es SIEMPRE el mismo, no
    // cambia según `tecnico` — ese indicador nunca llega al navegador.
    if (ctx.tecnico) elevarEstadoFlujo(estado, "error");
    return { ok: false, error: ctx.error };
  }
  // Reutiliza el MISMO cliente de sesión que `contextoCrearContrato()` ya
  // creó y autenticó — en vez de crear uno nuevo aquí (optimización posterior
  // al PR #274, ver el comentario en `lib/contrato/contexto.ts`).
  const { tenant, sb } = ctx;

  // Etapa "validacion_negocio": tarifas del negociado, ítems, BNC, margen
  // mínimo y catálogo de aliado B2B — varias validaciones con retorno
  // anticipado; el cierre de esta etapa se loguea justo antes de generar el
  // número de contrato (único punto que se alcanza solo si todas pasaron).
  const _tValidacion0 = performance.now();
  // Revisión posterior — ronda 2: antes, un rechazo DENTRO de esta sección
  // (cualquiera de los `return` de abajo) no dejaba NINGÚN log de la etapa —
  // solo se registraba si llegaba al final con éxito. `_rechazarValidacion`
  // envuelve cada `return` de rechazo para que la etapa quede en "rechazado"
  // SIN duplicar el log de éxito (mutuamente excluyentes: solo se ejecuta un
  // `return`) y sin reordenar ninguna validación.
  const _rechazarValidacion = (resultado: CrearContratoResult): CrearContratoResult => {
    registrarEtapa("crear_contrato", flujoId, "validacion_negocio", Math.round(performance.now() - _tValidacion0), "rechazado");
    return resultado;
  };
  // Revisión posterior — ronda 3, defecto "ERRORES DE CONSULTA CONFUNDIDOS
  // CON RECHAZOS COMERCIALES": las consultas de esta sección (paquete_precios,
  // aliados) desestructuraban solo `data` e ignoraban `error` — un fallo
  // TÉCNICO de Supabase (timeout, RLS inesperada, etc.) se comportaba
  // exactamente igual que "sin fila" y terminaba como un rechazo comercial
  // ("El paquete negociado no tiene tarifas configuradas...") en vez de un
  // fallo técnico real. `_errorValidacion` es el camino para ese caso: eleva
  // el TOTAL a "error" (nunca "rechazado"), registra el detalle técnico
  // server-side, y devuelve un mensaje público FIJO y genérico — nunca el
  // `error.message` crudo de Supabase/Postgres.
  const _errorValidacion = (detalle: string, error: unknown): CrearContratoResult => {
    registrarEtapa("crear_contrato", flujoId, "validacion_negocio", Math.round(performance.now() - _tValidacion0), "error");
    registrarErrorTecnico("crear_contrato", flujoId, "validacion_negocio", detalle, error);
    elevarEstadoFlujo(estado, "error");
    return { ok: false, error: MSG_ERROR_VALIDACION_CONTRATO };
  };

  // Precio BLOQUEADO del producto para negociados: se ignoran las tarifas que
  // venga del cliente y se usan las del paquete (el asesor no puede cambiarlas).
  let items = input.items;
  const negociado =
    input.tipoPaquete === "bloqueo" || input.tipoPaquete === "porcion_terrestre";
  if (negociado && input.paqueteId) {
    const { data: precios, error: preciosError } = await sb
      .from("paquete_precios")
      .select("acomodacion, precio")
      .eq("paquete_id", input.paqueteId);
    if (preciosError) return _errorValidacion("error_consulta_paquete_precios", preciosError);
    if (precios && precios.length) {
      const doble =
        precios.find((p) => p.acomodacion === "doble")?.precio ??
        Math.min(...precios.map((p) => p.precio));
      const nino = precios.find((p) => p.acomodacion === "nino")?.precio ?? 0;
      items = input.items.map((it) => ({ ...it, tarifaAdulto: doble, tarifaNino: nino }));
    } else {
      // Sin tarifas configuradas en el catálogo no hay precio confiable que
      // bloquear: mejor fallar que aceptar en silencio la tarifa que mande el
      // cliente para un contrato marcado como negociado.
      return _rechazarValidacion({ ok: false, error: "El paquete negociado no tiene tarifas configuradas. Configúralas antes de reservar." });
    }
  }

  // Las tarifas/cantidades de un item vienen del cliente (aun en no-negociado);
  // deben ser números finitos y no negativos antes de sumar el PVP.
  for (const it of items) {
    if (![it.adultos, it.ninos, it.tarifaAdulto, it.tarifaNino].every((n) => Number.isFinite(n) && n >= 0)) {
      return _rechazarValidacion({ ok: false, error: "Cantidades o tarifas inválidas en los ítems del contrato." });
    }
  }

  const precioVenta = items.reduce(
    (s, it) => s + it.adultos * it.tarifaAdulto + it.ninos * it.tarifaNino,
    0
  );
  // pax = cantidad total de pasajeros (todos: adultos + niños/infantes) — si no
  // se cargaron pasajeros nombrados al crear el contrato, cae al detalle de
  // valores. Ahí "niños" también recibe filas de infante (ej. "Asistencia
  // Médica Infante"), así que suma adultos+niños, no solo adultos.
  const pax =
    input.pasajeros.length ||
    items.reduce((s, it) => s + it.adultos + it.ninos, 0) ||
    1;

  // BNC (Base No Comisionable): tiquetes o valor fijo (≥ tiquetes y ≤ PVP).
  const tiquetes = Math.max(0, Number(input.valorTiquetes) || 0);
  let bnc = tiquetes;
  if (input.bncModo === "fijo") {
    const fijo = Math.max(0, Number(input.bncFijo) || 0);
    if (fijo < tiquetes) return _rechazarValidacion({ ok: false, error: "La BNC fija no puede ser menor al valor de los tiquetes." });
    bnc = fijo;
  }
  if (bnc > precioVenta) return _rechazarValidacion({ ok: false, error: "La BNC no puede ser mayor al valor total del contrato (PVP)." });

  // Costos netos del contrato manual (dinámico/empaquetado): el asesor conoce el
  // costo del hotel y del vuelo; alimentan costo_hotel/costo_aereo, las CxP al
  // proveedor y la rentabilidad. (En negociado los costos vienen del producto.)
  const monedaContrato = !negociado && (input.moneda ?? "COP") === "USD" ? "USD" : "COP";
  const costoHotelManual = !negociado ? input.hoteles.reduce((s, h) => s + Math.max(0, Number(h.costo) || 0), 0) : 0;
  // El costo aéreo sale de las COMPRAS (1 pago = 1+ tramos), no de los tramos:
  // una compra combinada (ida con una aerolínea + regreso con otra, pagadas
  // juntas) se registra una sola vez con su proveedor real. NO se filtra la
  // lista: `vuelos[].compraIdx` apunta por índice a esta misma posición.
  const comprasAereas = input.comprasAereas ?? [];
  const costoAereoManual = !negociado ? comprasAereas.reduce((s, c) => s + Math.max(0, Number(c.costo) || 0), 0) : 0;
  const servicios = input.servicios ?? [];
  // Costo de servicios con proveedor propio, repartido por tipo (columnas ya
  // existentes en ventas): asistencia → costo_asistencia; traslado/tour →
  // costo_receptivo; otro → otros_costos.
  const costoAsistenciaManual = !negociado ? servicios.filter((s) => s.tipo === "asistencia").reduce((s, x) => s + Math.max(0, Number(x.costo) || 0), 0) : 0;
  const costoReceptivoManual = !negociado ? servicios.filter((s) => s.tipo === "traslado" || s.tipo === "tour").reduce((s, x) => s + Math.max(0, Number(x.costo) || 0), 0) : 0;
  const otrosCostosManual = !negociado ? servicios.filter((s) => s.tipo === "otro").reduce((s, x) => s + Math.max(0, Number(x.costo) || 0), 0) : 0;
  const totalCostosManual = costoHotelManual + costoAereoManual + costoAsistenciaManual + costoReceptivoManual + otrosCostosManual;
  // Validación de margen mínimo: (PVP − costo) / PVP ≥ 20 %. Un superadmin o
  // administración puede aprobar explícitamente un contrato que no lo cumpla
  // (`forzarMargen`) — el rol se revalida aquí mismo, nunca se confía en el
  // flag del cliente solo. Si el comprador B2B eligió NETO (#30), el margen se
  // mide más abajo sobre el total exigible (6 %), con el plan NETO ya validado
  // y también antes de numerar.
  if (!negociado && totalCostosManual > 0 && input.modoCompra !== "neto") {
    const margen = evaluarMargenContrato({ modo: "pvp", ingreso: precioVenta, costos: totalCostosManual });
    // El rol ya se resolvió y verificó server-side en `contextoCrearContrato()`
    // (`ctx.rol`) — no hace falta una segunda consulta para revalidarlo aquí.
    if (!margen.cumple && !puedeAprobarMargenBajo(ctx.rol, input.forzarMargen)) {
      return _rechazarValidacion({
        ok: false,
        error: mensajeMargenInsuficiente(margen, (n) => formatMoneda(n, monedaContrato)),
        margenInsuficiente: true,
        margenActual: margen.margenActual,
        pvpMinimo: Math.ceil(margen.ingresoMinimo),
      });
    }
  }

  // Canal / asesor: B2C = solo interno; B2B = interno + agencia o freelance.
  const tipoVenta = input.tipoVenta ?? "interno";
  const canal = tipoVenta === "interno" ? "B2C" : "B2B";
  let agenciaNombre: string | null = null;
  let freelanceNombre: string | null = null;
  // El aliado sigue siendo obligatorio y del catálogo (vínculo ventas.aliado_id),
  // pero el contrato manual ya NO genera la comisión B2B (decisión del dueño,
  // #38): nace "Por definir" y se registra a mano en la pestaña Comisiones
  // (el asesor de su propio contrato, o administración).
  if (tipoVenta !== "interno") {
    if (!input.aliadoId) return _rechazarValidacion({ ok: false, error: `Selecciona la ${tipoVenta} del catálogo.` });
    const { data, error: aliadoQueryError } = await sb.from("aliados").select("nombre").eq("id", input.aliadoId).maybeSingle();
    if (aliadoQueryError) return _errorValidacion("error_consulta_aliados", aliadoQueryError);
    if (!data) return _rechazarValidacion({ ok: false, error: "La agencia/freelance seleccionada no existe." });
    if (tipoVenta === "agencia") agenciaNombre = data.nombre; else freelanceNombre = data.nombre;
  }

  // #30 (entrega B): modalidad del comprador B2B. Se valida TODO antes de
  // numerar: un NETO que la base vaya a rechazar no gasta un consecutivo.
  const modoCompraManual = input.modoCompra ?? "pvp";
  if (modoCompraManual !== "pvp" && modoCompraManual !== "neto") {
    return _rechazarValidacion({ ok: false, error: "Modalidad de compra inválida." });
  }
  let planNeto: PlanNetoManual | null = null;
  if (modoCompraManual === "neto") {
    if (tipoVenta === "interno") {
      return _rechazarValidacion({ ok: false, error: "Una venta directa no tiene modalidad NETO: cobra el PVP (con o sin descuento comercial)." });
    }
    if (ctx.rol === "venta") {
      const { data: { user: yo } } = await sb.auth.getUser();
      const { data: perfilYo, error: perfilYoError } = yo
        ? await sb.from("usuarios").select("nombre, email").eq("id", yo.id).maybeSingle()
        : { data: null, error: null };
      if (perfilYoError) return _errorValidacion("error_consulta_asesor_neto", perfilYoError);
      if (!esAsesorPropio(input.asesorNombre, perfilYo)) {
        return _rechazarValidacion({ ok: false, error: "Solo puedes registrar en NETO tus propios contratos." });
      }
    }
    const plan = await planNetoContratoManual(sb, { tipoVenta, aliadoId: input.aliadoId, precioVenta, impuesto: bnc });
    if (!plan.ok) return _rechazarValidacion({ ok: false, error: plan.error });
    if (!comisionCoincide(input.comisionNetoEsperada, plan.plan.comision)) {
      return _rechazarValidacion({
        ok: false,
        error: `La comisión del aliado cambió: ahora es ${formatMoneda(plan.plan.comision, monedaContrato)} (total NETO ${formatMoneda(plan.plan.totalExigible, monedaContrato)}). Revisa el total antes de generar el contrato.`,
      });
    }
    // Margen NETO: (total exigible − costo) / total exigible ≥ 6 %, con el
    // total del plan recién validado (no el que mande el navegador). Misma
    // aprobación excepcional que en PVP.
    if (!negociado && totalCostosManual > 0) {
      const margen = evaluarMargenContrato({ modo: "neto", ingreso: plan.plan.totalExigible, costos: totalCostosManual });
      if (!margen.cumple && !puedeAprobarMargenBajo(ctx.rol, input.forzarMargen)) {
        return _rechazarValidacion({
          ok: false,
          error: mensajeMargenInsuficiente(margen, (n) => formatMoneda(n, monedaContrato)),
          margenInsuficiente: true,
          margenActual: margen.margenActual,
          // En NETO es el total exigible mínimo.
          pvpMinimo: Math.ceil(margen.ingresoMinimo),
        });
      }
    }
    planNeto = plan.plan;
  }
  registrarEtapa("crear_contrato", flujoId, "validacion_negocio", Math.round(performance.now() - _tValidacion0), "ok");

  // Número de contrato — se genera AQUÍ, justo antes del primer INSERT que lo
  // necesita, DESPUÉS de todas las validaciones que pueden fallar (tarifas del
  // negociado, ítems, BNC, margen mínimo, aliado B2B). Generarlo antes
  // gastaría un consecutivo DTM/MIN por cada formulario inválido — con el RPC
  // ahora en service_role (ver lib/contrato/numeracion.ts), este es el punto
  // razonable más tardío antes del INSERT que lo requiere.
  const numRes = await medir("numero_contrato", () => siguienteNumeroContrato(tenant), (r) => (r.ok ? "ok" : "error"));
  if (!numRes.ok) {
    // Fallo TÉCNICO bloqueante (el RPC de numeración falló) — nunca
    // "rechazado" (eso es para un rechazo de negocio/sesión, no para un
    // fallo técnico). `numRes.error` ya es un mensaje saneado por el propio
    // RPC (revisión posterior al PR #274, "sanitizar mensajes de error del
    // RPC") — no hay detalle crudo adicional que registrar aquí.
    elevarEstadoFlujo(estado, "error");
    return { ok: false, error: numRes.error };
  }
  const numero = numRes.numero;

  // 2. Crear la venta (cabecera del contrato) — estampada con la agencia activa.
  const _tVenta0 = performance.now();
  const { error: ve } = await sb.from("ventas").insert({
    numero_contrato: numero,
    tenant,
    cliente: input.cliente.trim(),
    destino: oNull(input.destino),
    fecha_salida: oNull(input.fechaSalida),
    fecha_regreso: oNull(input.fechaRegreso),
    fecha_emision: oNull(input.fechaEmision),
    pax,
    precio_venta: precioVenta,
    impuesto: bnc,
    estado: "activo",
    // Solo empaquetado/dinámico (manual) pueden ir en USD; negociado sigue su producto (COP).
    moneda: monedaContrato,
    ...(!negociado
      ? {
          costo_hotel: costoHotelManual,
          costo_aereo: costoAereoManual,
          costo_asistencia: costoAsistenciaManual,
          costo_receptivo: costoReceptivoManual,
          otros_costos: otrosCostosManual,
          // #30 (CXP-1): nace con la escritura financiera PENDIENTE — no admite
          // abonos (trigger de la 172) hasta que `registrar_financiero_contrato`
          // escriba costos y CxP en una transacción y lo marque 'completo'. Si
          // el proceso muere antes, la reconciliación lo completa o lo revierte.
          financiero_estado: "pendiente",
        }
      : {}),
    tipo_paquete: input.tipoPaquete,
    // Vínculo DURABLE contrato→bloqueo (columna `bloqueo_ref_id`, migración
    // 022 — ya existía y ya la estampa `reservarDesdeTarifarioInterno`, pero
    // este flujo manual nunca la había llenado). Sin esto, una vez que las
    // sillas del contrato se liberan por completo (0 pax con silla), no hay
    // forma de volver a descubrir a qué bloqueo pertenecía para reasignarle
    // sillas de nuevo — `sillas.numero_contrato` queda null en todas y
    // `ajustar_sillas_por_pasajeros` no tiene de dónde leer el bloqueo_id.
    bloqueo_ref_id: input.tipoPaquete === "bloqueo" ? input.bloqueoId ?? null : null,
    asesor: oNull(input.asesorNombre),
    canal,
    tipo_asesor: tipoVenta,
    agencia_nombre: agenciaNombre,
    freelance_nombre: freelanceNombre,
    // Vínculo FUERTE con el catálogo de aliados (migración 143). El nombre se
    // sigue guardando para el documento y como respaldo de los contratos
    // viejos, pero la pertenencia en el portal B2B se resuelve por este id.
    aliado_id: tipoVenta !== "interno" ? input.aliadoId ?? null : null,
    cliente_documento: oNull(input.clienteDocumento),
    cliente_telefono: oNull(input.clienteTelefono),
    cliente_direccion: oNull(input.clienteDireccion),
    asistencia_medica: input.asistenciaMedica,
    plan_nombre: oNull(input.planNombre),
    tours_traslados: oNull(input.toursTraslados),
    asesor_firma_nombre: oNull(input.asesorNombre),
    asesor_firma_cargo: oNull(input.asesorCargo) ?? "Asesor/a",
    asesor_firma_cc: oNull(input.asesorCc),
    asesor_firma_tel: oNull(input.asesorTel),
  });
  registrarEtapa("crear_contrato", flujoId, "insert_venta", Math.round(performance.now() - _tVenta0), ve ? "error" : "ok");
  if (ve) {
    elevarEstadoFlujo(estado, "error");
    registrarErrorTecnico("crear_contrato", flujoId, "insert_venta", "error_insert_venta", ve);
    return { ok: false, error: MSG_ERROR_GUARDAR_CONTRATO };
  }

  // 3. Tablas hijas — 5 inserts secuenciales (pasajeros/hoteles/vuelos/
  // servicios/items), medidos como un solo grupo (etapa=insert_hijas): no se
  // reordenan ni paralelizan sin antes demostrar sus dependencias (ninguna
  // depende del resultado de otra, pero todas comparten `numero_contrato` de
  // la venta recién creada, así que el orden actual —secuencial, después de
  // la venta— se conserva tal cual en esta ronda).
  //
  // `_errorHijas`: registra la etapa como "error" (nunca "ok" por omisión —
  // antes, un retorno anticipado dentro de este grupo no dejaba NINGÚN log,
  // lo cual se podía confundir con una ejecución exitosa) y manda el detalle
  // técnico SOLO al helper `registrarErrorTecnico` (server-side, saneado),
  // nunca al navegador — el `return` devuelve el mensaje público FIJO
  // `MSG_ERROR_GUARDAR_CONTRATO` (revisión posterior — ronda 3), no
  // `error.message` crudo de Supabase/Postgres.
  // A partir de aquí la venta YA existe: un fallo de las hijas revierte el
  // contrato entero (venta, hijas y sillas, `revertir_contrato_incompleto`)
  // en vez de dejarlo numerado y a medias. Si la reversión misma falla, el
  // mensaje lo dice con el número del contrato.
  const _tHijas0 = performance.now();
  const _errorHijas = async (detalle: string, error: unknown) => {
    registrarEtapa("crear_contrato", flujoId, "insert_hijas", Math.round(performance.now() - _tHijas0), "error");
    registrarErrorTecnico("crear_contrato", flujoId, "insert_hijas", detalle, error);
    elevarEstadoFlujo(estado, "error");
    const rev = await revertirContratoManual(numero, tenant);
    if (rev.ok) return { ok: false as const, error: MSG_ERROR_GUARDAR_CONTRATO };
    registrarErrorTecnico("crear_contrato", flujoId, "insert_hijas", "reversion_fallida", rev.error);
    return { ok: false as const, error: `${MSG_ERROR_GUARDAR_CONTRATO} El contrato ${numero} quedó creado a medias y no se pudo deshacer automáticamente: revísalo antes de volver a intentarlo.` };
  };
  // `es_infante` se recalcula SIEMPRE server-side desde la fecha de
  // nacimiento contra `input.fechaSalida` (la misma fecha ya guardada como
  // `ventas.fecha_salida`) — nunca se confía en el checkbox "Es infante"
  // que manda el cliente (ver lib/reservar/pasajeros.ts). El mismo arreglo
  // se reutiliza más abajo para decidir qué pasajeros ocupan silla.
  const esInfanteReal = input.pasajeros.map((p) => esInfantePorEdad(p.fechaNacimiento, input.fechaSalida));

  // Pasajeros + responsable + sillas del bloqueo negociado, TODOS EN UNA
  // SOLA LLAMADA transaccional (segunda revisión de alto riesgo — B5): antes,
  // los pasajeros se insertaban AQUÍ (bloqueando la creación si fallaban) y
  // las sillas se asignaban DESPUÉS, dentro del bloque best-effort
  // "negociado_admin" más abajo — si el RPC de sillas fallaba por falta de
  // cupo, el contrato quedaba creado con pasajeros pero SIN sillas, marcado
  // solo "parcial", y esta función terminaba devolviendo `ok: true` de
  // todas formas. Ahora `crear_pasajeros_contrato` hace ambas cosas en una
  // sola transacción Postgres: pasajeros, vínculo INF→responsable (exigido
  // por el trigger de la migración 167 para todo infante nuevo — B1) y
  // reconciliación de sillas se confirman o revierten JUNTOS. Si el bloqueo
  // se quedó sin cupo, esto FALLA y BLOQUEA la creación completa del
  // contrato (nunca `ok: true` con estado parcial).
  // `p_holders_min`: igual criterio que ya tenía la sección de sillas —
  // `holders.length` (conteo real por edad) manda siempre que haya
  // pasajeros nombrados, y solo cae a `pax` (total, ver comentario en su
  // definición más arriba) cuando NO se capturaron pasajeros nombrados.
  const esBloqueoConCupo = input.tipoPaquete === "bloqueo" && !!input.bloqueoId;
  let holdersMinPiso = 0;
  if (esBloqueoConCupo) {
    const holdersPiso = input.pasajeros.filter((_, i) => pasajeroConsumeSilla(esInfanteReal[i]));
    holdersMinPiso = input.pasajeros.length ? holdersPiso.length : pax;
  }
  if (input.pasajeros.length || esBloqueoConCupo) {
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return _errorHijas("sin_service_role_para_pasajeros", null);
    }
    const { data: { user: actorPasajeros } } = await ctx.sb.auth.getUser();
    if (!actorPasajeros) return _errorHijas("sin_usuario_para_pasajeros", null);
    const admin = createAdminClient();
    const payloadPasajeros = payloadGuardarPasajeros(
      input.pasajeros.map((p, i) => ({
        nombre: `${p.nombres ?? ""} ${p.apellidos ?? ""}`.trim(),
        tipoId: oNull(p.tipoId) ?? "CC",
        identificacion: oNull(p.identificacion) ?? "",
        fechaNacimiento: p.fechaNacimiento ?? "",
        esInfante: esInfanteReal[i] ?? false,
        responsableIndex: p.responsableIndex ?? null,
      }))
    );
    // Migración 201: la misma transacción reserva las sillas y les copia los
    // datos del pasajero (`sillas.pasajero_*` es el manifiesto del vuelo); si
    // la copia falla, se revierte todo y `_errorHijas` deshace el contrato.
    const { data: pasajerosCreados, error: pasajerosErr } = await admin.rpc("crear_pasajeros_contrato_con_sillas", {
      p_numero_contrato: numero,
      p_pasajeros: payloadPasajeros as unknown as Json,
      p_holders_min: holdersMinPiso,
      p_usuario_id: actorPasajeros.id,
      p_comun: {
        asesor: oNull(input.asesorNombre),
        hotel: input.hoteles[0]?.nombre ?? null,
        acomodacion: input.hoteles[0]?.acomodacion ?? null,
      },
      p_datos_pasajeros: input.pasajeros.map((p) => ({
        pasajero_nombres: oNull(p.nombres),
        pasajero_apellidos: oNull(p.apellidos),
        tipo_doc: oNull(p.tipoId),
        numero_doc: oNull(p.identificacion),
        nacimiento: oNull(p.fechaNacimiento),
      })),
    });
    if (pasajerosErr) return _errorHijas("pasajeros_y_sillas", pasajerosErr);

    // nombres/apellidos ESTRUCTURADOS — POSTERIOR al RPC atómico (no forman
    // parte de v_claves_validas de _reemplazar_pasajeros_nucleo, migración
    // 167; ver el comentario de la migración 187). Un fallo NO revierte el
    // contrato (ya quedó completo y correcto por el RPC de arriba), pero SÍ
    // se revisa `{ error }` de cada UPDATE y se reporta honestamente en
    // `advertencias` — a diferencia del snapshot de `sillas.pasajero_*` de
    // más abajo (que de verdad es solo cosmético para un listado operativo),
    // nombres/apellidos son el dato real que el asesor capturó.
    const filasPasajerosCreados = (pasajerosCreados ?? []).slice().sort((a, b) => a.orden - b.orden);
    await Promise.all(
      filasPasajerosCreados.map(async (f, i) => {
        const p = input.pasajeros[i];
        const patch: { nombres?: string; apellidos?: string } = {};
        const nom = oNull(p?.nombres);
        const ape = oNull(p?.apellidos);
        if (nom) patch.nombres = nom;
        if (ape) patch.apellidos = ape;
        if (Object.keys(patch).length === 0) return;
        const { error: errDemografico } = await admin.from("contrato_pasajeros").update(patch).eq("id", f.id);
        if (errDemografico) {
          const etiqueta = `${p?.nombres ?? ""} ${p?.apellidos ?? ""}`.trim() || `pasajero #${i + 1}`;
          advertencias.push(`No se pudo guardar nombres/apellidos estructurados de ${etiqueta}: ${errDemografico.message}`);
        }
      })
    );
  }

  if (input.hoteles.length) {
    const { error } = await sb.from("contrato_hoteles").insert(
      input.hoteles.map((h, i) => ({
        numero_contrato: numero,
        nombre: h.nombre.trim(),
        categoria: oNull(h.categoria),
        proveedor: oNull(h.proveedor),
        ciudad: oNull(h.ciudad),
        alimentacion: oNull(h.alimentacion),
        acomodacion: oNull(h.acomodacion),
        detalle_acomodacion: oNull(h.detalleAcomodacion),
        fecha_ingreso: oNull(h.fechaIngreso),
        fecha_salida: oNull(h.fechaSalida),
        orden: i,
      }))
    );
    if (error) return _errorHijas("hoteles", error);
  }

  if (input.vuelos.length) {
    const { error } = await sb.from("contrato_vuelos").insert(
      input.vuelos.map((v, i) => ({
        numero_contrato: numero,
        aerolinea: oNull(v.aerolinea),
        record: oNull(v.record),
        direccion: oNull(v.direccion),
        origen_codigo: oNull(v.origenCodigo),
        origen_ciudad: oNull(v.origenCiudad),
        destino_codigo: oNull(v.destinoCodigo),
        destino_ciudad: oNull(v.destinoCiudad),
        numero_vuelo: oNull(v.numeroVuelo),
        hora_salida: oNull(v.horaSalida),
        hora_llegada: oNull(v.horaLlegada),
        servicios: oNull(v.servicios),
        fecha_salida: oNull(v.fecha),
        orden: i,
      }))
    );
    if (error) return _errorHijas("vuelos", error);
  }

  if (servicios.length) {
    const { error } = await sb.from("contrato_servicios").insert(
      servicios.filter((s) => s.descripcion.trim()).map((s, i) => ({
        numero_contrato: numero,
        tipo: s.tipo,
        descripcion: s.descripcion.trim(),
        proveedor: oNull(s.proveedor),
        costo: Math.max(0, Number(s.costo) || 0),
        orden: i,
      }))
    );
    if (error) return _errorHijas("servicios", error);
  }

  if (items.length) {
    const { error } = await sb.from("contrato_items").insert(
      items.map((it, i) => ({
        numero_contrato: numero,
        descripcion: it.descripcion.trim(),
        adultos: it.adultos,
        ninos: it.ninos,
        tarifa_adulto: it.tarifaAdulto,
        tarifa_nino: it.tarifaNino,
        orden: i,
      }))
    );
    if (error) return _errorHijas("items", error);
  }
  registrarEtapa("crear_contrato", flujoId, "insert_hijas", Math.round(performance.now() - _tHijas0), "ok");

  // #30 (entrega B): NETO, último paso OBLIGATORIO. El contrato nació como PVP
  // con la comisión "Por definir"; `aplicar_neto_contrato_manual` rebaja el
  // precio y crea la comisión descontada en UNA transacción (o ninguna de las
  // dos). Si falla, se deshace el contrato entero; si tampoco se puede
  // deshacer, queda como PVP "Por definir" — nunca NETO sin su comisión — y el
  // mensaje nombra el número.
  if (planNeto) {
    const comisionNeto = planNeto.comision;
    const neto = await medir(
      "neto_manual",
      () => aplicarNetoContratoManual(sb, numero, input.aliadoId as number, comisionNeto),
      (r) => (r.ok ? "ok" : "error"),
    );
    if (!neto.ok) {
      elevarEstadoFlujo(estado, "error");
      registrarErrorTecnico("crear_contrato", flujoId, "neto_manual", "error_aplicar_neto", neto.error);
      const rev = await revertirContratoManual(numero, tenant);
      if (rev.ok) {
        return { ok: false, error: `No se pudo registrar el contrato en NETO (${neto.error}), así que no se creó. Revisa los datos e inténtalo de nuevo.` };
      }
      registrarErrorTecnico("crear_contrato", flujoId, "neto_manual", "reversion_fallida", rev.error);
      return {
        ok: false,
        error: `No se pudo registrar el contrato en NETO (${neto.error}) y tampoco se pudo deshacer el contrato ${numero} automáticamente (${rev.error ?? "motivo desconocido"}). Quedó como PVP con la comisión por definir: revísalo antes de volver a intentarlo.`,
      };
    }
  }

  // ── Costos y CxP del contrato manual (dinámico/empaquetado) ──────────────
  // Una cuenta por pagar por hotel, por compra aérea y por servicio con costo
  // > 0 y proveedor, en la moneda del contrato, con la retención del catálogo
  // de proveedores.
  // #30 (CXP-1): ya NO es best-effort. Antes se insertaban con el cliente de
  // SESIÓN: para el rol `venta` la RLS de `cuentas_por_pagar` (116) negaba el
  // insert (42501) y el contrato quedaba creado y cobrable SIN sus costos de
  // proveedor ni su IRT. Ahora va por la escritura financiera del sistema
  // (`registrarFinancieroContrato`, migraciones 171/172 — la misma de
  // reservar): intención durable en `contrato_financiero_pendiente`, costos +
  // CxP en UNA transacción que marca `financiero_estado='completo'`, y si
  // falla, el contrato se revierte entero (o, si ni eso se puede, queda
  // 'pendiente': sin abonos y en manos de la reconciliación). Un reintento no
  // duplica: el RPC reemplaza las CxP automáticas sin pagos ni retenciones.
  // El asiento de cada CxP sigue siendo best-effort (convención contable del
  // proyecto; la reconciliación postea los que falten).
  const _tCxp0 = performance.now();
  let _resultadoCxp: ResultadoEtapa = "ok";
  if (!negociado) {
    const cxpRows: { proveedor: string; tipo: string; servicio: string; valor: number }[] = [];
    for (const h of input.hoteles) {
      const costo = Math.max(0, Number(h.costo) || 0);
      if (costo > 0 && h.proveedor?.trim()) cxpRows.push({ proveedor: h.proveedor.trim(), tipo: "hotel", servicio: `Hotel ${h.nombre}`.trim(), valor: costo });
    }
    // Una CxP por COMPRA aérea (no por tramo): el proveedor es quien cobró
    // (aerolínea, consolidador, OTA) y el servicio nombra los tramos que cubre.
    comprasAereas.forEach((c, ci) => {
      const costo = Math.max(0, Number(c.costo) || 0);
      if (costo <= 0 || !c.proveedor?.trim()) return;
      const rutas = input.vuelos
        .filter((v) => v.compraIdx === ci)
        .map((v) => `${v.origenCodigo || "?"}-${v.destinoCodigo || "?"}`)
        .join(" / ");
      const ref = c.referencia?.trim() ? ` · ${c.referencia.trim()}` : "";
      cxpRows.push({
        proveedor: c.proveedor.trim(), tipo: "aereo",
        servicio: `Aéreo ${c.proveedor.trim()}${rutas ? ` (${rutas})` : ""}${ref}`.trim(),
        valor: costo,
      });
    });
    for (const s of servicios) {
      const costo = Math.max(0, Number(s.costo) || 0);
      if (costo > 0 && s.proveedor?.trim()) cxpRows.push({ proveedor: s.proveedor.trim(), tipo: "servicio", servicio: s.descripcion.trim() || s.tipo, valor: costo });
    }
    const fallarFinanciero = (motivo: string, tecnico: unknown) => {
      elevarEstadoFlujo(estado, "error");
      registrarErrorTecnico("crear_contrato", flujoId, "cxp_automaticas", "error_financiero_manual", tecnico);
      registrarEtapa("crear_contrato", flujoId, "cxp_automaticas", Math.round(performance.now() - _tCxp0), "error");
      return { ok: false as const, error: motivo };
    };
    // Retención del catálogo (lectura de sistema: el asesor no necesita leer
    // proveedores para que su contrato quede completo). Si no se puede leer,
    // no se inventa una retención: se revierte el contrato.
    let provMap = new Map<string, { aplica_retencion: boolean | null; pct_retencion: number | null }>();
    if (cxpRows.length) {
      const nombres = [...new Set(cxpRows.map((r) => r.proveedor))];
      const { data: provs, error: provsError } = await createAdminClient().from("proveedores").select("nombre, aplica_retencion, pct_retencion").in("nombre", nombres);
      if (provsError) {
        const rev = await revertirContratoIncompleto({ rpc: rpcFinancieroManual }, numero, tenant);
        return fallarFinanciero(rev.ok
          ? "No se pudo leer el catálogo de proveedores, así que el contrato no se creó. Inténtalo de nuevo."
          : `No se pudo leer el catálogo de proveedores y tampoco se pudo deshacer el contrato ${numero} (${rev.error ?? "motivo desconocido"}). Quedó sin abonos hasta revisarlo.`, provsError);
      }
      provMap = new Map((provs ?? []).map((p) => [p.nombre as string, p]));
    }
    const hoyCxP = fechaElegidaONegocio(input.fechaEmision);
    const cxp: CxPFinanciera[] = cxpRows.map((r) => {
      const p = provMap.get(r.proveedor);
      return {
        proveedor: r.proveedor,
        tipo_proveedor: r.tipo,
        servicio: r.servicio,
        valor_total: r.valor,
        moneda: monedaContrato,
        fecha_obligacion: hoyCxP,
        aplica_retencion: p?.aplica_retencion ?? false,
        pct_retencion: Number(p?.pct_retencion) || 0,
        observaciones: OBS_CXP_MANUAL,
        servicio_id: null,
      };
    });
    const costos: CostosContrato = {
      costo_hotel: costoHotelManual, costo_aereo: costoAereoManual, costo_asistencia: costoAsistenciaManual,
      costo_receptivo: costoReceptivoManual, otros_costos: otrosCostosManual,
    };
    const fin = await registrarFinancieroContrato(depsFinancieroManual(numero, tenant, hoyCxP), {
      numeroContrato: numero, tenant, costos, cxp, fecha: hoyCxP,
    });
    if (!fin.ok) return fallarFinanciero(fin.error, fin.error);
    if (fin.avisos.length) {
      _resultadoCxp = "parcial";
      registrarErrorTecnico("crear_contrato", flujoId, "cxp_automaticas", "error_asiento_cxp", fin.avisos.join(" | "));
    }
  }
  registrarEtapa("crear_contrato", flujoId, "cxp_automaticas", Math.round(performance.now() - _tCxp0), _resultadoCxp);
  // Un asiento de CxP sin postear no bloquea (el dinero ya quedó escrito),
  // pero eleva el TOTAL a "parcial".
  if (_resultadoCxp !== "ok") elevarEstadoFlujo(estado, "parcial");

  // ── Productos negociados: costos desde el módulo de producto + cupos ──────
  // Se hace con el cliente service-role para que el asesor nunca vea los costos
  // ni necesite permisos sobre sillas. Si no hay llave service-role, se omite.
  const esNegociado =
    input.tipoPaquete === "bloqueo" || input.tipoPaquete === "porcion_terrestre";
  const _tAdmin0 = performance.now();
  let _huboBloqueAdmin = false;
  // Best-effort igual que antes: ningún error de este bloque bloquea la
  // creación del contrato. La diferencia es que la MÉTRICA ya no dice "ok"
  // a ciegas: "parcial" si algún paso individual devolvió `error` sin lanzar
  // excepción (el patrón normal del cliente Supabase), "error" si entró al
  // catch (una excepción real, ej. `createAdminClient()` sin llave configurada).
  let _resultadoAdmin: ResultadoEtapa = "ok";
  if ((esNegociado && input.paqueteId) || (input.tipoPaquete === "bloqueo" && input.bloqueoId)) {
    if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
      _huboBloqueAdmin = true;
      try {
        const admin = createAdminClient();

        // 1) Copiar costos negociados del paquete a la venta (ocultos al asesor)
        if (esNegociado && input.paqueteId) {
          const { data: costos, error: costosError } = await admin
            .from("paquete_costos")
            .select("*")
            .eq("paquete_id", input.paqueteId)
            .maybeSingle();
          if (costosError) {
            _resultadoAdmin = "parcial";
            registrarErrorTecnico("crear_contrato", flujoId, "negociado_admin", "error_consulta_costos", costosError);
          }
          if (costos) {
            const { error: updateError } = await admin
              .from("ventas")
              .update({
                costo_hotel: costos.costo_hotel,
                costo_aereo: costos.costo_aereo,
                costo_receptivo: costos.costo_receptivo,
                costo_asistencia: costos.costo_asistencia,
                otros_costos: costos.otros_costos,
              })
              .eq("numero_contrato", numero);
            if (updateError) {
              _resultadoAdmin = "parcial";
              registrarErrorTecnico("crear_contrato", flujoId, "negociado_admin", "error_update_costos", updateError);
            }
          }
        }

        // El descuento de cupos (sillas del bloqueo negociado) ya NO vive
        // aquí — se movió a la llamada única y BLOQUEANTE a
        // `crear_pasajeros_contrato`, antes de este bloque (best-effort),
        // junto con la creación de pasajeros y su vínculo de responsable
        // (revisión de alto riesgo — B5: un fallo de capacidad no puede
        // quedar como "parcial" con `ok: true`, debe bloquear la creación).
      } catch (e) {
        // No bloquear la creación del contrato si falla el paso
        // administrativo (comportamiento histórico sin cambios) — pero la
        // métrica SÍ debe decir "error", nunca "ok".
        _resultadoAdmin = "error";
        registrarErrorTecnico("crear_contrato", flujoId, "negociado_admin", "excepcion", e);
      }
    }
  }
  if (_huboBloqueAdmin) {
    registrarEtapa("crear_contrato", flujoId, "negociado_admin", Math.round(performance.now() - _tAdmin0), _resultadoAdmin);
    // Best-effort (oculto al asesor): un fallo aquí nunca bloquea el
    // contrato, pero SÍ debe elevar el TOTAL a "parcial" (nunca "ok" a ciegas).
    if (_resultadoAdmin !== "ok") elevarEstadoFlujo(estado, "parcial");
  }

  revalidatePath("/dashboard/contratos");
  return { ok: true, numero, ...(advertencias.length ? { advertencias } : {}) };
}

export type VentaEditInput = {
  cliente: string;
  clienteDocumento: string;
  clienteTelefono: string;
  clienteEmail: string;
  clienteDireccion: string;
  destino: string;
  fechaSalida: string;
  fechaRegreso: string;
  plazo: string;
  tipoAsesor: string;
  agenciaNombre: string;
  agenciaAsesor: string;
  freelanceNombre: string;
  asesorNombre: string;
  planNombre: string;
  observaciones: string;
  precioVenta: string;
  pax: string;
};

export async function actualizarVenta(
  numero: string,
  input: VentaEditInput
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!input.cliente.trim()) return { ok: false, error: "El nombre del cliente es obligatorio." };
  const precioVenta = Number(input.precioVenta);
  if (!Number.isFinite(precioVenta) || precioVenta < 0) return { ok: false, error: "El precio de venta debe ser un número ≥ 0." };
  const pax = Math.trunc(Number(input.pax));
  if (!Number.isFinite(pax) || pax < 1) return { ok: false, error: "La cantidad de pasajeros debe ser al menos 1." };
  const sb = await createClient();
  // #30: un contrato NETO no cambia de modalidad ni de importes después de
  // emitido. Pasarlo a "interno" (B2C) dejaría un precio con la comisión del
  // aliado descontada en una venta directa; mover `precio_venta` lo
  // descuadraría de la comisión ya descontada (congelada en aliados_b2b por la
  // 205): o se cobra de más al aliado o la comisión deja de corresponder. Una
  // corrección de precio en NETO no se hace por este formulario.
  // La lectura va por la vista que todos los roles internos pueden leer (desde
  // la 144 `venta` no lee `ventas`), y la modalidad por la frontera
  // service-role, después de confirmar el acceso.
  const { data: actual, error: actualError } = await sb
    .from("ventas_basica")
    .select("tipo_asesor")
    .eq("numero_contrato", numero)
    .maybeSingle();
  if (actualError) return { ok: false, error: actualError.message };
  if (!actual) return { ok: false, error: "El contrato no existe o no tienes acceso." };
  const netoExigible = await netoTotalExigibleDeContrato(numero);
  if (netoExigible != null) {
    if (oNull(input.tipoAsesor) !== (actual.tipo_asesor ?? null)) {
      return { ok: false, error: "Contrato vendido en NETO: el tipo de venta (agencia/freelance) no se cambia después de emitido." };
    }
    if (Math.abs(precioVenta - netoExigible) > 0.005) {
      return { ok: false, error: "Contrato vendido en NETO: el precio de venta es el total exigible (PVP menos la comisión ya descontada) y no se edita aquí." };
    }
  }
  const { error } = await sb
    .from("ventas")
    .update({
      cliente: input.cliente.trim(),
      cliente_documento: oNull(input.clienteDocumento),
      cliente_telefono: oNull(input.clienteTelefono),
      cliente_email: oNull(input.clienteEmail),
      cliente_direccion: oNull(input.clienteDireccion),
      destino: oNull(input.destino),
      fecha_salida: oNull(input.fechaSalida),
      fecha_regreso: oNull(input.fechaRegreso),
      plazo: oNull(input.plazo),
      tipo_asesor: oNull(input.tipoAsesor),
      agencia_nombre: oNull(input.agenciaNombre),
      agencia_asesor: oNull(input.agenciaAsesor),
      freelance_nombre: oNull(input.freelanceNombre),
      asesor_firma_nombre: oNull(input.asesorNombre),
      plan_nombre: oNull(input.planNombre),
      observaciones: oNull(input.observaciones),
      precio_venta: precioVenta,
      pax,
      updated_at: new Date().toISOString(),
    })
    .eq("numero_contrato", numero);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/dashboard/contratos/${numero}`);
  return { ok: true };
}

// Recalcula TRM promedio (USD) y confirma la venta pendiente si el abonado ya
// alcanza el % mínimo — compartido por registrar/editar un abono (el umbral se
// revisa igual después de cualquiera de las dos operaciones).
// Devuelve un error EXPLÍCITO si la venta debía confirmarse y no se pudo (W7,
// §6.8). La confirmación (venta + sillas) es UNA transacción de la base
// (`confirmar_venta`, migración 197, con la RLS de quien llama): o se aplica
// entera o no cambia nada.
async function recalcularEstadoAbono(sb: Awaited<ReturnType<typeof createClient>>, numeroContrato: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data: venta, error: ventaError } = await sb
    .from("ventas")
    .select("estado, precio_venta, tipo_paquete, moneda, financiero_estado, moneda_cobro, trm_cobro, total_cobro")
    .eq("numero_contrato", numeroContrato)
    .maybeSingle();
  if (ventaError || !venta) return { ok: true };
  // 235 (#90 F): los abonos se llevan en la MONEDA DE COBRO (la de la oferta salvo que se haya elegido otra al contratar).
  const cobro = cobroDeVenta(venta);
  const esUSD = cobro.moneda === "USD";
  const { data: abs } = await sb.from("abonos").select("valor_abono, monto_cop").eq("numero_contrato", numeroContrato);
  const totalAbonado = (abs ?? []).reduce((s, a) => s + (a.valor_abono ?? 0), 0);   // en moneda del contrato
  const totalCop = (abs ?? []).reduce((s, a) => s + (Number(a.monto_cop) || 0), 0); // en pesos

  // TRM efectiva del contrato = promedio ponderado (Σcop / Σmonto-en-moneda).
  if (esUSD && totalAbonado > 0) {
    await sb.from("ventas").update({ trm_contrato: totalCop / totalAbonado }).eq("numero_contrato", numeroContrato);
  }

  const { data: cfg } = await sb.from("config_cobros").select("pct_abono").eq("tipo_paquete", venta?.tipo_paquete ?? "").maybeSingle();
  const pctMin = cfg?.pct_abono ?? 0.3;
  const alcanzaMinimo = totalAbonado >= cobro.total * pctMin;
  if (venta?.estado === "pendiente" && venta.financiero_estado !== "pendiente" && alcanzaMinimo) {
    const { error: eConf } = await sb.rpc("confirmar_venta", { p_numero: numeroContrato });
    if (eConf) return { ok: false, error: mensajeErrorRpc(eConf).error };
    // Respaldo: generar cuentas por pagar desde los costos si aún no existen.
    await asegurarCuentasPorPagar(numeroContrato);
  }
  return { ok: true };
}

export async function registrarAbono(
  numeroContrato: string,
  valor: number,            // monto PAGADO en COP (en USD se convierte con la TRM)
  formaPago: string,
  referencia: string,
  trmInput?: number,        // TRM del día (obligatoria si el contrato es USD)
  fecha?: string,           // fecha del abono (por defecto hoy; editable para registrar abonos atrasados)
): Promise<{ ok: boolean; error?: string }> {
  const sb = await createClient();
  const { data: venta, error: ventaError } = await sb
    .from("ventas")
    .select("estado, precio_venta, tipo_paquete, moneda, tenant, financiero_estado, moneda_cobro, trm_cobro, total_cobro")
    .eq("numero_contrato", numeroContrato)
    .maybeSingle();
  if (ventaError || !venta) return { ok: false, error: ventaError?.message ?? "Contrato no encontrado." };
  // 235 (#90 F): el abono "vale" en la MONEDA DE COBRO del contrato (no en la de la oferta si se cobra en la otra).
  const esUSD = cobroDeVenta(venta).moneda === "USD";
  if (venta?.financiero_estado === "pendiente") {
    return { ok: false, error: "Este contrato todavía tiene pendiente su registro financiero. No se pueden registrar abonos hasta completar la reconciliación." };
  }
  const montoCop = Math.max(0, Number(valor) || 0);
  const trm = esUSD ? (Number(trmInput) || 0) : 1;
  if (esUSD && trm <= 0) return { ok: false, error: "Indica la TRM del día para el abono (contrato en USD)." };
  // El abono "vale" en la MONEDA DEL CONTRATO: USD = COP / TRM; COP = COP.
  const valorAbono = esUSD ? montoCop / trm : montoCop;

  const fechaAbono = fechaElegidaONegocio(fecha);
  const { data: nuevoAbono, error } = await sb.from("abonos").insert({
    numero_contrato: numeroContrato,
    tenant: (venta as { tenant?: string } | null)?.tenant ?? "mayorista",
    valor_abono: valorAbono,
    monto_cop: montoCop,
    trm,
    fecha_abono: fechaAbono,
    forma_pago: formaPago || null,
    referencia: referencia || null,
  }).select("id").single();
  if (error || !nuevoAbono) return { ok: false, error: error?.message ?? "No se pudo registrar el abono." };

  const errAsiento = await postearAsientoAbono(sb, nuevoAbono.id, (venta as { tenant?: string } | null)?.tenant ?? undefined);
  const conf = await recalcularEstadoAbono(sb, numeroContrato);
  if (!conf.ok) {
    revalidatePath(`/dashboard/contratos/${numeroContrato}`);
    return { ok: false, error: `El abono quedó registrado, pero la venta no se pudo confirmar: ${conf.error}` };
  }
  if (errAsiento) {
    revalidatePath(`/dashboard/contratos/${numeroContrato}`);
    revalidatePath("/dashboard/cartera");
    return { ok: false, error: `El abono quedó registrado, pero su asiento contable no: ${errAsiento}. Contabilízalo desde Contabilidad → Facturación.` };
  }
  revalidatePath(`/dashboard/contratos/${numeroContrato}`);
  revalidatePath("/dashboard/cartera");
  revalidatePath("/dashboard/contabilidad/libro-diario");
  revalidatePath("/dashboard/contabilidad/libro-auxiliar");
  return { ok: true };
}

// Corrige un abono ya registrado (valor, fecha, forma de pago o referencia) —
// para cuando el asesor se equivoca al digitar y no quiere crear un segundo
// abono para "cuadrar" el saldo.
export async function actualizarAbono(
  id: number,
  numeroContrato: string,
  input: { valor: number; fecha: string; formaPago: string; referencia: string; trmInput?: number }
): Promise<{ ok: boolean; error?: string }> {
  if (!(input.valor > 0)) return { ok: false, error: "El valor debe ser mayor a 0." };
  const sb = await createClient();
  const { data: venta } = await sb.from("ventas").select("moneda, tenant, precio_venta, moneda_cobro, trm_cobro, total_cobro").eq("numero_contrato", numeroContrato).maybeSingle();
  const esUSD = cobroDeVenta(venta).moneda === "USD";
  const montoCop = Math.max(0, Number(input.valor) || 0);
  const trm = esUSD ? (Number(input.trmInput) || 0) : 1;
  if (esUSD && trm <= 0) return { ok: false, error: "Indica la TRM del día (contrato en USD)." };
  const valorAbono = esUSD ? montoCop / trm : montoCop;
  const fechaAbono = fechaElegidaONegocio(input.fecha);

  const { error } = await sb.from("abonos").update({
    valor_abono: valorAbono,
    monto_cop: montoCop,
    trm,
    fecha_abono: fechaAbono,
    forma_pago: input.formaPago || null,
    referencia: input.referencia || null,
  }).eq("id", id);
  if (error) return { ok: false, error: error.message };

  const errAsiento = await postearAsientoAbono(sb, id, (venta as { tenant?: string } | null)?.tenant ?? undefined);
  const conf = await recalcularEstadoAbono(sb, numeroContrato);
  if (!conf.ok) {
    revalidatePath(`/dashboard/contratos/${numeroContrato}`);
    return { ok: false, error: `El abono quedó actualizado, pero la venta no se pudo confirmar: ${conf.error}` };
  }
  if (errAsiento) {
    revalidatePath(`/dashboard/contratos/${numeroContrato}`);
    revalidatePath("/dashboard/cartera");
    return { ok: false, error: `El abono quedó actualizado, pero su asiento contable no: ${errAsiento}` };
  }
  revalidatePath(`/dashboard/contratos/${numeroContrato}`);
  revalidatePath("/dashboard/cartera");
  revalidatePath("/dashboard/contabilidad/libro-diario");
  revalidatePath("/dashboard/contabilidad/libro-auxiliar");
  return { ok: true };
}

export async function eliminarAbono(id: number, numeroContrato: string): Promise<{ ok: boolean; error?: string }> {
  const sb = await createClient();
  // #30: el asiento del abono vive en los libros de la agencia del contrato.
  const { data: ventaAbono } = await sb.from("ventas").select("tenant").eq("numero_contrato", numeroContrato).maybeSingle();
  const { error } = await sb.from("abonos").delete().eq("id", id);
  if (error) {
    // 208 (F4415): un abono con asiento contable NO se borra. Antes se borraba el abono y, si fallaba el
    // segundo paso, su asiento quedaba huérfano y la acción respondía éxito. Mientras no exista una
    // operación atómica de eliminar abono, se rechaza y no cambia nada.
    if (error.code === "F4415") {
      return { ok: false, error: `Este abono ya tiene asiento contable y todavía no se puede eliminar (falta la operación contable atómica). No se cambió nada: ni el abono ni su asiento.` };
    }
    return { ok: false, error: error.message };
  }
  // Abono sin asiento (el caso que sí se borra): limpia cualquier asiento residual y NO ignora el fallo.
  const limpio = await reemplazarAsiento("abono", `abono:${id}`, null, (ventaAbono?.tenant as string | null) ?? undefined);
  if (!limpio.ok) {
    return { ok: false, error: `El abono se eliminó, pero no se pudo limpiar su asiento contable: ${limpio.error}. Avisa a contabilidad antes de seguir.` };
  }
  revalidatePath(`/dashboard/contratos/${numeroContrato}`);
  revalidatePath("/dashboard/cartera");
  revalidatePath("/dashboard/contabilidad/libro-diario");
  revalidatePath("/dashboard/contabilidad/libro-auxiliar");
  return { ok: true };
}

// ── Editar servicios adicionales de un contrato PENDIENTE ───────────────────
// Re-liquida los servicios del paquete según los seleccionados, actualiza los
// ítems de servicio, el precio de venta y (admin) el costo receptivo + las
// casillas Tours/Asistencia. Solo aplica a contratos en estado 'pendiente'.
export async function actualizarServiciosContrato(
  numeroContrato: string,
  serviciosIds: number[]
): Promise<{ ok: boolean; error?: string }> {
  const sb = await createClient();
  const { data: venta } = await sb
    .from("ventas")
    .select("estado, pax, precio_venta, paquete_armado_id, fecha_salida, fecha_regreso, comision_estado")
    .eq("numero_contrato", numeroContrato)
    .maybeSingle();
  if (!venta) return { ok: false, error: "Contrato no encontrado." };
  // #30: en NETO, agregar o quitar servicios movería `precio_venta` a PVP de
  // esos servicios sin ajustar la comisión ya descontada (congelada por la
  // 205): el total exigible dejaría de ser PVP − comisión.
  if (venta.comision_estado === "descontada") {
    return { ok: false, error: "Contrato vendido en NETO: los servicios no se cambian después de emitido (el precio quedaría descuadrado de la comisión descontada)." };
  }
  if (venta.estado !== "pendiente") return { ok: false, error: "Solo se pueden editar servicios en contratos pendientes." };
  if (!venta.paquete_armado_id) return { ok: false, error: "El contrato no está enlazado a un paquete." };

  const pax = Number(venta.pax) || 0;

  // Servicios disponibles del paquete (PVP) desde el tarifario.
  const { data: servFilas } = await sb
    .from("tarifario_resultado_publicable")
    .select("servicio_id, servicio_nombre, tipo_tarifa, pax_desde, pax_hasta, precio_pvp")
    .eq("paquete_id", venta.paquete_armado_id)
    .eq("modulo", "servicios");
  type Serv = { nombre: string; modo: "persona" | "grupo"; personaPvp: number | null; grupos: { pax_desde: number; pax_hasta: number; precio: number }[] };
  const byServ = new Map<number, Serv>();
  for (const r of servFilas ?? []) {
    if (r.servicio_id == null) continue;
    let s = byServ.get(r.servicio_id);
    if (!s) { s = { nombre: r.servicio_nombre ?? "Servicio", modo: r.tipo_tarifa === "grupo" ? "grupo" : "persona", personaPvp: null, grupos: [] }; byServ.set(r.servicio_id, s); }
    if (s.modo === "grupo") s.grupos.push({ pax_desde: r.pax_desde ?? 1, pax_hasta: r.pax_hasta ?? 1, precio: r.precio_pvp });
    else s.personaPvp = r.precio_pvp;
  }

  // Nuevos ítems de servicio + total.
  const nuevos: { nombre: string; precio: number }[] = [];
  let nuevoTotal = 0;
  for (const id of serviciosIds) {
    const s = byServ.get(id);
    if (!s) continue;
    const p = precioServicio(s.modo, s.personaPvp, s.grupos, pax);
    if (p > 0) { nuevos.push({ nombre: s.nombre, precio: p }); nuevoTotal += p; }
  }

  // ── Costos + reconciliación de CxP — TODO se resuelve ANTES de escribir ──
  // Esta función cambia el conjunto FINANCIERO del contrato (recalcula
  // `costo_receptivo` y el PVP), así que las cuentas por pagar de servicios
  // tienen que moverse con él: si no, el contrato dice una cosa y la
  // contabilidad otra. El emparejamiento es por `cuentas_por_pagar.servicio_id`
  // (migración 170), nunca por nombre.
  //
  // Orden deliberado (fallo cerrado): primero se calcula el objetivo y se
  // valida que el plan sea ejecutable; solo si lo es se escribe algo. Antes,
  // los ítems y el precio se modificaban de una vez y las CxP no se tocaban
  // nunca — el contrato quedaba editado y las obligaciones viejas vivas.
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return { ok: false, error: "No se pueden editar los servicios: falta la configuración del servidor para actualizar costos y cuentas por pagar. Contacta a un administrador." };
  }
  const admin = createAdminClient();
  const nochesStay = venta.fecha_salida && venta.fecha_regreso ? noches(venta.fecha_salida, venta.fecha_regreso) : 1;

  // Objetivo: costo NETO por servicio seleccionado (temporada GENERAL, mismo
  // criterio que ya usaba esta pantalla) + su proveedor real del catálogo.
  const objetivo: ServicioObjetivo[] = [];
  let costoReceptivo = 0;
  if (serviciosIds.length) {
    const [{ data: arm, error: armErr }, { data: gruposNet, error: gruposErr }] = await Promise.all([
      admin.from("armado_servicios")
        .select("servicio_id, modo, servicios_adicionales(precio_persona, categoria, nombre, liquidacion, proveedores(nombre, aplica_retencion, pct_retencion))")
        .eq("paquete_id", venta.paquete_armado_id).in("servicio_id", serviciosIds),
      admin.from("servicio_tarifa_pax").select("servicio_id, pax_desde, pax_hasta, precio").eq("temporada", "GENERAL").in("servicio_id", serviciosIds),
    ]);
    // Fallo cerrado: sin los datos de costo no se puede reconciliar, y
    // editar igual dejaría CxP inconsistentes en silencio.
    if (armErr) return { ok: false, error: "No se pudieron consultar los servicios del paquete. Inténtalo de nuevo." };
    if (gruposErr) return { ok: false, error: "No se pudieron consultar las tarifas por grupo de los servicios. Inténtalo de nuevo." };
    const gruposPorServ = new Map<number, { pax_desde: number; pax_hasta: number; precio: number }[]>();
    for (const g of gruposNet ?? []) {
      const arr = gruposPorServ.get(g.servicio_id) ?? [];
      arr.push({ pax_desde: g.pax_desde, pax_hasta: g.pax_hasta, precio: g.precio });
      gruposPorServ.set(g.servicio_id, arr);
    }
    for (const sRow of arm ?? []) {
      const modo = (sRow.modo as string) === "grupo" ? "grupo" : "persona";
      const srv = sRow.servicios_adicionales as unknown as { precio_persona: number | null; categoria: string | null; nombre: string; liquidacion: string | null; proveedores: { nombre: string | null; aplica_retencion: boolean | null; pct_retencion: number | null } | null } | null;
      const costo = precioServicio(modo, srv?.precio_persona ?? null, gruposPorServ.get(sRow.servicio_id) ?? [], pax) * factorLiquidacion(srv?.liquidacion, nochesStay);
      costoReceptivo += costo;
      const categoria = normalizarCategoriaServicio(srv?.categoria);
      objetivo.push({
        servicioId: sRow.servicio_id,
        nombre: srv?.nombre ?? "Servicio",
        costoNeto: Number.isFinite(costo) ? costo : 0,
        tipoProveedor: tipoProveedorCxpServicio(categoria),
        proveedor: srv?.proveedores?.nombre ?? null,
        aplicaRetencion: srv?.proveedores?.aplica_retencion ?? false,
        pctRetencion: Number(srv?.proveedores?.pct_retencion) || 0,
      });
    }
  }

  // CxP de servicios ya existentes (solo las que declaran su `servicio_id`:
  // hotel/aéreo/manuales/legado quedan intactas) + si ya tienen dinero movido.
  // #63: un contrato nacido de una oferta en COP con TRM tiene sus obligaciones con el equivalente en COP congelado a la TRM
  // de la reserva (`valor_cop_63`). Recalcular servicios aquí movería el precio y los costos con netos/monedas que no son
  // los de ese snapshot y dejaría el equivalente congelado distinto de la obligación: se rechaza (anular y volver a reservar).
  const { data: venta63, error: venta63Err } = await admin
    .from("ventas")
    .select("aceptacion_63_id")
    .eq("numero_contrato", numeroContrato)
    .maybeSingle();
  if (venta63Err) return { ok: false, error: "No se pudo verificar el contrato. Inténtalo de nuevo." };
  if (venta63?.aceptacion_63_id != null) {
    return { ok: false, error: "Este contrato nació de una oferta con conversión por TRM: sus servicios no se editan después de reservar (las obligaciones con proveedores quedaron congeladas a la TRM de la reserva). Anula y vuelve a reservar." };
  }
  const { data: cxpFilas, error: cxpErr } = await admin
    .from("cuentas_por_pagar")
    .select("id, servicio_id, valor_total")
    .eq("numero_contrato", numeroContrato)
    .not("servicio_id", "is", null);
  if (cxpErr) return { ok: false, error: "No se pudieron consultar las cuentas por pagar del contrato. Inténtalo de nuevo." };
  const idsCxp = (cxpFilas ?? []).map((r) => r.id);
  const conMovimiento = new Set<number>();
  if (idsCxp.length) {
    const [{ data: pagos, error: pagosErr }, { data: rets, error: retsErr }] = await Promise.all([
      admin.from("cxp_pagos").select("cuenta_por_pagar_id").in("cuenta_por_pagar_id", idsCxp),
      admin.from("retenciones_cxp").select("cuenta_por_pagar_id").in("cuenta_por_pagar_id", idsCxp),
    ]);
    if (pagosErr || retsErr) return { ok: false, error: "No se pudieron verificar los pagos de las cuentas por pagar. Inténtalo de nuevo." };
    for (const r of pagos ?? []) conMovimiento.add(r.cuenta_por_pagar_id);
    for (const r of rets ?? []) conMovimiento.add(r.cuenta_por_pagar_id);
  }
  const plan = planReconciliacionCxpServicios(
    (cxpFilas ?? []).map((r) => ({ id: r.id, servicio_id: r.servicio_id, valor_total: r.valor_total, tieneMovimientos: conMovimiento.has(r.id) })),
    objetivo
  );
  // Fallo cerrado ANTES de tocar nada: quitar un servicio cuya cuenta ya
  // tiene pagos/retenciones exigiría borrar dinero ya movido. Se rechaza la
  // edición completa con un mensaje accionable, en vez de dejar el contrato
  // y la contabilidad diciendo cosas distintas.
  if (plan.bloqueados.length) {
    return {
      ok: false,
      error: `No se puede quitar/ajustar ${plan.bloqueados.length === 1 ? "un servicio que ya tiene" : "servicios que ya tienen"} pagos o retenciones registrados en su cuenta por pagar. Anula primero esos movimientos en la pestaña Proveedores.`,
    };
  }

  // Quitar ítems de servicio actuales (y su total) para recalcular el precio.
  const { data: oldItems } = await sb
    .from("contrato_items")
    .select("id, descripcion, adultos, ninos, tarifa_adulto, tarifa_nino")
    .eq("numero_contrato", numeroContrato);
  let oldTotal = 0;
  const oldServiceIds: number[] = [];
  for (const it of oldItems ?? []) {
    if (it.descripcion?.startsWith("Servicio · ")) {
      oldTotal += it.adultos * it.tarifa_adulto + it.ninos * it.tarifa_nino;
      oldServiceIds.push(it.id);
    }
  }
  if (oldServiceIds.length) await sb.from("contrato_items").delete().in("id", oldServiceIds);
  if (nuevos.length) {
    await sb.from("contrato_items").insert(
      nuevos.map((s, i) => ({
        numero_contrato: numeroContrato,
        descripcion: `Servicio · ${s.nombre}`,
        adultos: 1, ninos: 0, tarifa_adulto: s.precio, tarifa_nino: 0, orden: 100 + i,
      }))
    );
  }

  const nuevoPrecio = Math.max(0, (Number(venta.precio_venta) || 0) - oldTotal + nuevoTotal);
  await sb.from("ventas").update({ precio_venta: nuevoPrecio }).eq("numero_contrato", numeroContrato);

  // ── Aplicar: costos, resumen y CxP reconciliadas ────────────────────────
  // El plan ya se validó arriba (nada bloqueado), así que acá solo se
  // ejecuta. Los servicios INCLUIDOS del paquete entran al resumen aunque no
  // sean parte de la selección editable: editar los opcionales nunca debe
  // "apagar" en el documento una asistencia/tour que sigue incluida.
  const efectivos: { servicioId: number; nombre: string; categoria: string | null; incluido: boolean }[] =
    objetivo.map((o) => ({ servicioId: o.servicioId, nombre: o.nombre, categoria: null, incluido: false }));
  // La categoría real de los opcionales ya se resolvió al armar `objetivo`
  // (tipoProveedor), pero el resumen necesita la categoría del catálogo tal
  // cual — se vuelve a leer junto con los incluidos en una sola consulta.
  const { data: catRows } = await admin
    .from("armado_servicios")
    .select("servicio_id, incluido, servicios_adicionales(nombre, categoria)")
    .eq("paquete_id", venta.paquete_armado_id);
  const catPorServicio = new Map<number, { nombre: string | null; categoria: string | null }>();
  for (const r of catRows ?? []) {
    const srv = r.servicios_adicionales as unknown as { nombre: string | null; categoria: string | null } | null;
    catPorServicio.set(r.servicio_id, { nombre: srv?.nombre ?? null, categoria: srv?.categoria ?? null });
    if (r.incluido) {
      efectivos.push({ servicioId: r.servicio_id, nombre: srv?.nombre ?? "Servicio", categoria: srv?.categoria ?? null, incluido: true });
    }
  }
  for (const e of efectivos) {
    if (e.categoria == null && !e.incluido) e.categoria = catPorServicio.get(e.servicioId)?.categoria ?? null;
  }
  const resumen = resumirServiciosContrato(
    efectivos.map((e) => ({
      servicioId: e.servicioId, nombre: e.nombre, categoria: normalizarCategoriaServicio(e.categoria),
      incluido: e.incluido, costoNeto: 0, proveedorId: null,
    }))
  );
  await admin.from("ventas").update({
    costo_receptivo: costoReceptivo,
    tours_traslados: resumen.toursTraslados,
    asistencia_medica: resumen.asistenciaMedica,
  }).eq("numero_contrato", numeroContrato);

  // CxP: insertar las nuevas, ajustar el valor de las que siguen y eliminar
  // las de servicios quitados (ninguna con movimientos — ya se bloqueó
  // arriba). Cada cambio arrastra su asiento contable, con los mismos
  // helpers que usa el resto del módulo (`cxp:{id}` como referencia).
  const { data: ventaTenant } = await admin.from("ventas").select("tenant, moneda, plazo, fecha_salida").eq("numero_contrato", numeroContrato).maybeSingle();
  const tenantCxp = (ventaTenant?.tenant as string | null) ?? "mayorista";
  const hoyCxp = fechaNegocio();
  const OBS_EDIT = "Generado automáticamente al editar los servicios del contrato";

  for (const del of plan.eliminar) {
    const { error } = await admin.from("cuentas_por_pagar").delete().eq("id", del.id);
    if (error) return { ok: false, error: "No se pudieron actualizar las cuentas por pagar del contrato. Inténtalo de nuevo." };
    await eliminarAsientoCxP(del.id);
  }
  for (const upd of plan.actualizar) {
    const { error } = await admin.from("cuentas_por_pagar").update({ valor_total: upd.valor, servicio: upd.nombre, tipo_proveedor: upd.tipoProveedor, proveedor: upd.proveedor }).eq("id", upd.id);
    if (error) return { ok: false, error: "No se pudieron actualizar las cuentas por pagar del contrato. Inténtalo de nuevo." };
    await postearAsientoCxP({
      cuentaId: upd.id, numeroContrato, tipoProveedor: upd.tipoProveedor, proveedor: upd.proveedor,
      servicio: upd.nombre, valorTotal: upd.valor, fecha: hoyCxp, tenant: tenantCxp,
    });
  }
  if (plan.insertar.length) {
    const { data: creadas, error } = await admin.from("cuentas_por_pagar").insert(
      plan.insertar.map((o) => ({
        numero_contrato: numeroContrato, tenant: tenantCxp, servicio_id: o.servicioId,
        proveedor: o.proveedor, tipo_proveedor: o.tipoProveedor, servicio: o.nombre,
        valor_total: Math.max(0, o.costoNeto), moneda: (ventaTenant?.moneda as string | null) ?? "COP",
        fecha_obligacion: hoyCxp, fecha_vencimiento: (ventaTenant?.plazo as string | null) ?? (ventaTenant?.fecha_salida as string | null) ?? null,
        aplica_retencion: o.aplicaRetencion, pct_retencion: o.pctRetencion, observaciones: OBS_EDIT,
      }))
    ).select("id, tipo_proveedor, proveedor, servicio, valor_total");
    if (error) return { ok: false, error: "No se pudieron crear las cuentas por pagar de los servicios agregados. Inténtalo de nuevo." };
    for (const c of creadas ?? []) {
      await postearAsientoCxP({
        cuentaId: c.id, numeroContrato, tipoProveedor: c.tipo_proveedor, proveedor: c.proveedor,
        servicio: c.servicio, valorTotal: Number(c.valor_total) || 0, fecha: hoyCxp, tenant: tenantCxp,
      });
    }
  }
  revalidatePath("/dashboard/pagos");
  revalidatePath("/dashboard/contabilidad/libro-diario");
  revalidatePath("/dashboard/contabilidad/libro-auxiliar");

  revalidatePath(`/dashboard/contratos/${numeroContrato}`);
  return { ok: true };
}

// #30 (entrega B): vista previa del NETO de un contrato manual B2B — el mismo
// plan que `crearContrato` vuelve a calcular antes de numerar (y la base al
// aplicarlo). Solo lectura: % del aliado (o el parámetro de su tipo) con la
// sesión de quien arma el contrato; no escribe nada.
// Misma puerta que `crearContrato` (sesión real, usuario activo y rol con
// escritura sobre `ventas`): el plan revela el % y la comisión del aliado, y
// una sesión cualquiera (control_vuelo, por ejemplo, que sí lee `aliados`) no
// debe obtenerlos por aquí. Prueba: pruebas/contratoManualNeto206.pg.ts (P3).
export async function previsualizarNetoContrato(input: {
  tipoVenta: string;
  aliadoId: number | null;
  precioVenta: number;
  impuesto: number;
}): Promise<{ ok: true; plan: PlanNetoManual } | { ok: false; error: string }> {
  const ctx = await contextoCrearContrato("previsualizar_neto", generarFlujoId());
  if (!ctx.ok) return { ok: false, error: ctx.error };
  return planNetoContratoManual(ctx.sb, {
    tipoVenta: input.tipoVenta,
    aliadoId: input.aliadoId,
    precioVenta: Number(input.precioVenta) || 0,
    impuesto: Number(input.impuesto) || 0,
  });
}
