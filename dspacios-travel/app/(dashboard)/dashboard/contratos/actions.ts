"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";
import { precioServicio, noches, factorLiquidacion } from "@/lib/calc/paquetes";
import { asegurarCuentasPorPagar } from "../reservar/actions";
import { formatMoneda } from "@/lib/utils";
import { siguienteNumeroContrato } from "@/lib/contrato/numeracion";
import { contextoCrearContrato } from "@/lib/contrato/contexto";
import { reemplazarAsiento, cuentaDisponible, postearAsientoCxP, CUENTA } from "@/lib/contabilidad/asientos";
import {
  generarFlujoId, crearMedidor, registrarEtapa, registrarErrorTecnico,
  crearEstadoFlujo, elevarEstadoFlujo, resultadoTotal,
  type Medidor, type ResultadoEtapa, type EstadoFlujo,
} from "@/lib/observabilidad/medicion";

// Postea (o reemplaza) el asiento de un abono: Debe Caja/Bancos (según forma
// de pago) / Haber Anticipos de clientes (280505) si el contrato AÚN no está
// facturado, o Clientes (130505) si ya lo está — best-effort, nunca bloquea
// el registro del abono en sí.
async function postearAsientoAbono(
  sb: Awaited<ReturnType<typeof createClient>>,
  numeroContrato: string, abonoId: number, fecha: string, montoCop: number, formaPago: string | null, moneda: string
): Promise<void> {
  if (montoCop <= 0) return;
  const { data: fact } = await sb.from("contrato_facturacion").select("numero_contrato").eq("numero_contrato", numeroContrato).maybeSingle();
  const cuentaCredito = fact ? CUENTA.CLIENTES : CUENTA.ANTICIPOS_CLIENTES;
  await reemplazarAsiento("abono", `abono:${abonoId}`, {
    fecha,
    descripcion: `Abono ${numeroContrato}${formaPago ? ` (${formaPago})` : ""}`,
    lineas: [
      { cuentaCodigo: cuentaDisponible(formaPago, moneda), tercero: numeroContrato, descripcion: "Abono recibido", debe: montoCop, haber: 0 },
      { cuentaCodigo: cuentaCredito, tercero: numeroContrato, descripcion: fact ? "Aplicación a cartera" : "Anticipo de cliente", debe: 0, haber: montoCop },
    ],
  });
}

// Margen mínimo que debe dejar un contrato manual (dinámico/empaquetado):
// PVP ≥ total de costos ÷ (1 − 20%).
const MARKUP_MIN = 0.20;

// Mensajes públicos FIJOS para fallos TÉCNICOS de crearContrato() (revisión
// posterior — ronda 3, defecto "ERROR.MESSAGE TODAVÍA LLEGA AL NAVEGADOR"):
// antes, un INSERT/consulta de Supabase fallido devolvía `error.message`
// directo al navegador — un mensaje de Postgres puede revelar tablas,
// constraints, policies o valores de fila. Estos dos mensajes son literales
// fijos, nunca derivados del error real (que se registra aparte, server-side,
// vía `registrarErrorTecnico()`). Diferenciados solo para que el asesor sepa
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
  // Moneda del contrato. En empaquetado/dinámico (todo manual) el asesor puede
  // venderlo en USD; el resto (abonos con TRM, estado de cuenta) fluye igual.
  moneda?: string;
  // Aprobación explícita de superadmin/administración para crear el contrato
  // aunque el margen no cubra el mínimo (ver validación de MARKUP_MIN). El rol
  // se revalida siempre en el servidor — nunca se confía en este flag solo.
  forzarMargen?: boolean;
};

const oNull = (s: string) => (s && s.trim() !== "" ? s.trim() : null);

export type CrearContratoResult =
  | { ok: true; numero: string }
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
  // Validación de margen mínimo: PVP ≥ costos ÷ (1 − 20%). Un superadmin o
  // administración puede aprobar explícitamente un contrato que no lo cumpla
  // (`forzarMargen`) — el rol se revalida aquí mismo, nunca se confía en el
  // flag del cliente solo.
  if (!negociado && totalCostosManual > 0) {
    const pvpMin = totalCostosManual / (1 - MARKUP_MIN);
    if (precioVenta + 0.5 < pvpMin) {
      const margenActual = precioVenta > 0 ? 1 - totalCostosManual / precioVenta : 0;
      // El rol ya se resolvió y verificó server-side en `contextoCrearContrato()`
      // (`ctx.rol`) — no hace falta una segunda consulta para revalidarlo aquí.
      const autorizado = !!input.forzarMargen && ["superadmin", "administracion"].includes(ctx.rol);
      if (!autorizado) {
        return _rechazarValidacion({
          ok: false,
          error: `El PVP (${formatMoneda(precioVenta, monedaContrato)}) no cubre el margen mínimo del ${MARKUP_MIN * 100}%. Con costos de ${formatMoneda(totalCostosManual, monedaContrato)}, el PVP mínimo es ${formatMoneda(Math.ceil(pvpMin), monedaContrato)}.`,
          margenInsuficiente: true,
          margenActual,
          pvpMinimo: Math.ceil(pvpMin),
        });
      }
    }
  }

  // Canal / asesor: B2C = solo interno; B2B = interno + agencia o freelance.
  const tipoVenta = input.tipoVenta ?? "interno";
  const canal = tipoVenta === "interno" ? "B2C" : "B2B";
  let agenciaNombre: string | null = null;
  let freelanceNombre: string | null = null;
  let aliado: { nombre: string; nit: string | null; pct_comision: number | null; aplica_retencion: boolean; pct_retencion: number } | null = null;
  if (tipoVenta !== "interno") {
    if (!input.aliadoId) return _rechazarValidacion({ ok: false, error: `Selecciona la ${tipoVenta} del catálogo.` });
    const { data, error: aliadoQueryError } = await sb.from("aliados").select("nombre, nit, pct_comision, aplica_retencion, pct_retencion").eq("id", input.aliadoId).maybeSingle();
    if (aliadoQueryError) return _errorValidacion("error_consulta_aliados", aliadoQueryError);
    if (!data) return _rechazarValidacion({ ok: false, error: "La agencia/freelance seleccionada no existe." });
    aliado = data;
    if (tipoVenta === "agencia") agenciaNombre = data.nombre; else freelanceNombre = data.nombre;
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
        }
      : {}),
    tipo_paquete: input.tipoPaquete,
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
  // técnico SOLO a `registrarErrorTecnico()` (server-side, saneado), nunca al
  // navegador — el `return` devuelve el mensaje público FIJO
  // `MSG_ERROR_GUARDAR_CONTRATO` (revisión posterior — ronda 3), no
  // `error.message` crudo de Supabase/Postgres.
  const _tHijas0 = performance.now();
  const _errorHijas = (detalle: string, error: unknown) => {
    registrarEtapa("crear_contrato", flujoId, "insert_hijas", Math.round(performance.now() - _tHijas0), "error");
    registrarErrorTecnico("crear_contrato", flujoId, "insert_hijas", detalle, error);
    elevarEstadoFlujo(estado, "error");
    return { ok: false as const, error: MSG_ERROR_GUARDAR_CONTRATO };
  };
  if (input.pasajeros.length) {
    const { error } = await sb.from("contrato_pasajeros").insert(
      input.pasajeros.map((p, i) => ({
        numero_contrato: numero,
        nombre: `${p.nombres ?? ""} ${p.apellidos ?? ""}`.trim(),
        tipo_id: oNull(p.tipoId) ?? "CC",
        identificacion: oNull(p.identificacion),
        fecha_nacimiento: oNull(p.fechaNacimiento),
        es_infante: p.esInfante,
        orden: i,
      }))
    );
    if (error) return _errorHijas("pasajeros", error);
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

  // ── CxP automáticas del contrato manual (dinámico/empaquetado) ────────────
  // Una cuenta por pagar por hotel y por vuelo con costo > 0 y proveedor, en la
  // moneda del contrato. Toma la retención del catálogo de proveedores.
  // Best-effort, igual que antes (no bloquea la creación del contrato si algo
  // aquí falla) — pero ahora la MÉTRICA distingue "error" (la consulta de
  // proveedores o el insert de la CxP en sí fallaron — probablemente ninguna
  // cuenta se creó bien) de "parcial" (las CxP se crearon, pero algún asiento
  // contable individual no se pudo postear) en vez de reportar "ok" a ciegas.
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
    if (cxpRows.length) {
      const nombres = [...new Set(cxpRows.map((r) => r.proveedor))];
      const { data: provs, error: provsError } = await sb.from("proveedores").select("nombre, aplica_retencion, pct_retencion").in("nombre", nombres);
      if (provsError) {
        _resultadoCxp = "error";
        registrarErrorTecnico("crear_contrato", flujoId, "cxp_automaticas", "error_consulta_proveedores", provsError);
      }
      const provMap = new Map((provs ?? []).map((p) => [p.nombre, p]));
      const hoyCxP = oNull(input.fechaEmision) ?? new Date().toISOString().slice(0, 10);
      const { data: cxpCreadas, error: cxpInsertError } = await sb.from("cuentas_por_pagar").insert(
        cxpRows.map((r) => {
          const p = provMap.get(r.proveedor);
          return {
            numero_contrato: numero,
            tenant,
            proveedor: r.proveedor,
            tipo_proveedor: r.tipo,
            servicio: r.servicio,
            valor_total: r.valor,
            moneda: monedaContrato,
            fecha_obligacion: hoyCxP,
            aplica_retencion: p?.aplica_retencion ?? false,
            pct_retencion: p?.pct_retencion ?? 0,
          };
        })
      ).select("id, tipo_proveedor, proveedor, servicio, valor_total");
      if (cxpInsertError) {
        _resultadoCxp = "error";
        registrarErrorTecnico("crear_contrato", flujoId, "cxp_automaticas", "error_insert_cuentas_por_pagar", cxpInsertError);
      }
      for (const c of cxpCreadas ?? []) {
        const asiento = await postearAsientoCxP({
          cuentaId: c.id, numeroContrato: numero, tipoProveedor: c.tipo_proveedor, proveedor: c.proveedor,
          servicio: c.servicio, valorTotal: Number(c.valor_total) || 0, fecha: hoyCxP,
        });
        if (!asiento.ok) {
          if (_resultadoCxp === "ok") _resultadoCxp = "parcial";
          registrarErrorTecnico("crear_contrato", flujoId, "cxp_automaticas", "error_asiento_cxp", asiento.error);
        }
      }
    }
  }
  registrarEtapa("crear_contrato", flujoId, "cxp_automaticas", Math.round(performance.now() - _tCxp0), _resultadoCxp);
  // Best-effort: NUNCA bloquea la creación del contrato, pero un fallo aquí
  // sí debe elevar el TOTAL a "parcial" (el contrato se creó, pero algo
  // best-effort quedó incompleto) — antes el total no reflejaba esto.
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

        // 2) Descontar cupos del record (asignar N sillas disponibles)
        if (input.tipoPaquete === "bloqueo" && input.bloqueoId) {
          const holders = input.pasajeros.filter((p) => !p.esInfante);
          const adultos = holders.length || pax;
          const { data: libres, error: libresError } = await admin
            .from("sillas")
            .select("id")
            .eq("bloqueo_id", input.bloqueoId)
            .in("estado", ["disponible", "cambio_entrante"])
            .order("numero_silla")
            .limit(adultos);
          if (libresError) {
            _resultadoAdmin = "parcial";
            registrarErrorTecnico("crear_contrato", flujoId, "negociado_admin", "error_consulta_sillas", libresError);
          }
          if (libres && libres.length) {
            const resultadosSillas = await Promise.all(
              libres.map((s, i) => {
                const p = holders[i];
                return admin.from("sillas").update({
                  estado: "en_plazo",
                  numero_contrato: numero,
                  asesor: oNull(input.asesorNombre),
                  hotel: input.hoteles[0]?.nombre ?? null,
                  acomodacion: input.hoteles[0]?.acomodacion ?? null,
                  pasajero_nombres: oNull(p?.nombres),
                  pasajero_apellidos: oNull(p?.apellidos),
                  tipo_doc: oNull(p?.tipoId),
                  numero_doc: oNull(p?.identificacion),
                  nacimiento: oNull(p?.fechaNacimiento),
                }).eq("id", s.id);
              })
            );
            if (resultadosSillas.some((r) => r.error)) {
              _resultadoAdmin = "parcial";
              registrarErrorTecnico("crear_contrato", flujoId, "negociado_admin", "error_update_sillas", resultadosSillas.find((r) => r.error)?.error);
            }
          }
        }
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

  // Auto-comisión B2B: usa el % propio del aliado o, si no tiene, el default general.
  const _tAliado0 = performance.now();
  let _resultadoAliado: ResultadoEtapa = "ok";
  if (aliado) {
    const defParam = tipoVenta === "agencia" ? "COMISION_AGENCIA" : "COMISION_FREELANCE";
    const { data: p } = await sb.from("parametros_tributarios").select("valor").eq("parametro", defParam).maybeSingle();
    const pct = aliado.pct_comision ?? Number(p?.valor) ?? (tipoVenta === "agencia" ? 0.12 : 0.11);
    const { error: aliadoError } = await sb.from("aliados_b2b").insert({
      numero_contrato: numero,
      tenant,
      aliado: aliado.nombre,
      nit: aliado.nit,
      precio_venta: precioVenta,
      base_comision: precioVenta,
      pct_comision: pct,
      recobro_total: 0,
      pct_recobro_aliado: 0,
      aplica_retencion: aliado.aplica_retencion,
      pct_retencion: aliado.pct_retencion,
      estado: "pendiente",
    });
    if (aliadoError) {
      _resultadoAliado = "error";
      registrarErrorTecnico("crear_contrato", flujoId, "aliado_b2b", "error_insert", aliadoError);
    }
  }
  if (aliado) {
    registrarEtapa("crear_contrato", flujoId, "aliado_b2b", Math.round(performance.now() - _tAliado0), _resultadoAliado);
    // Best-effort: no bloquea la creación del contrato, pero eleva el TOTAL.
    if (_resultadoAliado !== "ok") elevarEstadoFlujo(estado, "parcial");
  }

  revalidatePath("/dashboard/contratos");
  return { ok: true, numero };
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
async function recalcularEstadoAbono(sb: Awaited<ReturnType<typeof createClient>>, numeroContrato: string): Promise<void> {
  const { data: venta } = await sb
    .from("ventas")
    .select("estado, precio_venta, tipo_paquete, moneda")
    .eq("numero_contrato", numeroContrato)
    .maybeSingle();
  const esUSD = (venta?.moneda ?? "COP") === "USD";
  const { data: abs } = await sb.from("abonos").select("valor_abono, monto_cop").eq("numero_contrato", numeroContrato);
  const totalAbonado = (abs ?? []).reduce((s, a) => s + (a.valor_abono ?? 0), 0);   // en moneda del contrato
  const totalCop = (abs ?? []).reduce((s, a) => s + (Number(a.monto_cop) || 0), 0); // en pesos

  // TRM efectiva del contrato = promedio ponderado (Σcop / Σmonto-en-moneda).
  if (esUSD && totalAbonado > 0) {
    await sb.from("ventas").update({ trm_contrato: totalCop / totalAbonado }).eq("numero_contrato", numeroContrato);
  }

  const { data: cfg } = await sb.from("config_cobros").select("pct_abono").eq("tipo_paquete", venta?.tipo_paquete ?? "").maybeSingle();
  const pctMin = cfg?.pct_abono ?? 0.3;
  const alcanzaMinimo = totalAbonado >= (venta?.precio_venta ?? 0) * pctMin;
  if (venta?.estado === "pendiente" && alcanzaMinimo) {
    await sb.from("ventas").update({ estado: "confirmado" }).eq("numero_contrato", numeroContrato);
    const client = process.env.SUPABASE_SERVICE_ROLE_KEY ? createAdminClient() : sb;
    await client
      .from("sillas")
      .update({ estado: "confirmada" })
      .eq("numero_contrato", numeroContrato)
      .eq("estado", "en_plazo");
    // Respaldo: generar cuentas por pagar desde los costos si aún no existen.
    await asegurarCuentasPorPagar(numeroContrato);
  }
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
  const { data: venta } = await sb
    .from("ventas")
    .select("estado, precio_venta, tipo_paquete, moneda, tenant")
    .eq("numero_contrato", numeroContrato)
    .maybeSingle();
  const esUSD = (venta?.moneda ?? "COP") === "USD";
  const montoCop = Math.max(0, Number(valor) || 0);
  const trm = esUSD ? (Number(trmInput) || 0) : 1;
  if (esUSD && trm <= 0) return { ok: false, error: "Indica la TRM del día para el abono (contrato en USD)." };
  // El abono "vale" en la MONEDA DEL CONTRATO: USD = COP / TRM; COP = COP.
  const valorAbono = esUSD ? montoCop / trm : montoCop;

  const fechaAbono = fecha || new Date().toISOString().slice(0, 10);
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

  await postearAsientoAbono(sb, numeroContrato, nuevoAbono.id, fechaAbono, montoCop, formaPago, (venta as { moneda?: string } | null)?.moneda ?? "COP");
  await recalcularEstadoAbono(sb, numeroContrato);
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
  const { data: venta } = await sb.from("ventas").select("moneda").eq("numero_contrato", numeroContrato).maybeSingle();
  const esUSD = (venta?.moneda ?? "COP") === "USD";
  const montoCop = Math.max(0, Number(input.valor) || 0);
  const trm = esUSD ? (Number(input.trmInput) || 0) : 1;
  if (esUSD && trm <= 0) return { ok: false, error: "Indica la TRM del día (contrato en USD)." };
  const valorAbono = esUSD ? montoCop / trm : montoCop;
  const fechaAbono = input.fecha || new Date().toISOString().slice(0, 10);

  const { error } = await sb.from("abonos").update({
    valor_abono: valorAbono,
    monto_cop: montoCop,
    trm,
    fecha_abono: fechaAbono,
    forma_pago: input.formaPago || null,
    referencia: input.referencia || null,
  }).eq("id", id);
  if (error) return { ok: false, error: error.message };

  await postearAsientoAbono(sb, numeroContrato, id, fechaAbono, montoCop, input.formaPago, (venta as { moneda?: string } | null)?.moneda ?? "COP");
  await recalcularEstadoAbono(sb, numeroContrato);
  revalidatePath(`/dashboard/contratos/${numeroContrato}`);
  revalidatePath("/dashboard/cartera");
  revalidatePath("/dashboard/contabilidad/libro-diario");
  revalidatePath("/dashboard/contabilidad/libro-auxiliar");
  return { ok: true };
}

export async function eliminarAbono(id: number, numeroContrato: string): Promise<{ ok: boolean; error?: string }> {
  const sb = await createClient();
  const { error } = await sb.from("abonos").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  await reemplazarAsiento("abono", `abono:${id}`, null);
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
    .select("estado, pax, precio_venta, paquete_armado_id, fecha_salida, fecha_regreso")
    .eq("numero_contrato", numeroContrato)
    .maybeSingle();
  if (!venta) return { ok: false, error: "Contrato no encontrado." };
  if (venta.estado !== "pendiente") return { ok: false, error: "Solo se pueden editar servicios en contratos pendientes." };
  if (!venta.paquete_armado_id) return { ok: false, error: "El contrato no está enlazado a un paquete." };

  const pax = Number(venta.pax) || 0;

  // Servicios disponibles del paquete (PVP) desde el tarifario.
  const { data: servFilas } = await sb
    .from("tarifario_resultado")
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

  // Costo receptivo neto + casillas Tours/Asistencia (admin: oculto al asesor).
  if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
    try {
      const admin = createAdminClient();
      let costoReceptivo = 0;
      const tours: string[] = [];
      let hayAsistencia = false;
      if (serviciosIds.length) {
        const [{ data: arm }, { data: gruposNet }] = await Promise.all([
          admin.from("armado_servicios").select("servicio_id, modo, servicios_adicionales(precio_persona, categoria, nombre, liquidacion)").eq("paquete_id", venta.paquete_armado_id).in("servicio_id", serviciosIds),
          admin.from("servicio_tarifa_pax").select("servicio_id, pax_desde, pax_hasta, precio").eq("temporada", "GENERAL").in("servicio_id", serviciosIds),
        ]);
        const gruposPorServ = new Map<number, { pax_desde: number; pax_hasta: number; precio: number }[]>();
        for (const g of gruposNet ?? []) {
          const arr = gruposPorServ.get(g.servicio_id) ?? [];
          arr.push({ pax_desde: g.pax_desde, pax_hasta: g.pax_hasta, precio: g.precio });
          gruposPorServ.set(g.servicio_id, arr);
        }
        const nochesStay = venta.fecha_salida && venta.fecha_regreso ? noches(venta.fecha_salida, venta.fecha_regreso) : 1;
        for (const s of arm ?? []) {
          const modo = (s.modo as string) === "grupo" ? "grupo" : "persona";
          const srv = s.servicios_adicionales as unknown as { precio_persona: number | null; categoria: string | null; nombre: string; liquidacion: string | null } | null;
          costoReceptivo += precioServicio(modo, srv?.precio_persona ?? null, gruposPorServ.get(s.servicio_id) ?? [], pax) * factorLiquidacion(srv?.liquidacion, nochesStay);
          const cat = srv?.categoria ?? "otro";
          if (cat === "asistencia") hayAsistencia = true;
          else if (cat === "tour_traslado" && srv?.nombre) tours.push(srv.nombre);
        }
      }
      await admin.from("ventas").update({
        costo_receptivo: costoReceptivo,
        tours_traslados: tours.length ? tours.join(", ") : null,
        asistencia_medica: hayAsistencia,
      }).eq("numero_contrato", numeroContrato);
    } catch {
      // Costo neto informativo; no bloquea la edición.
    }
  }

  revalidatePath(`/dashboard/contratos/${numeroContrato}`);
  return { ok: true };
}
