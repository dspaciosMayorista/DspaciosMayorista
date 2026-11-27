// #106 · Forma de la respuesta de `fn_gestion_contratos` (migración 309) y su validación. La RPC devuelve jsonb: aquí se comprueba la forma
// ANTES de pintar, para que una respuesta inesperada sea un error visible y no un «0» o un campo vacío que parezca un dato real.
export type EstadoGrupo = "pendiente" | "confirmado" | "cancelado" | "otro";
export type SaldoClase = "con_saldo" | "pagado" | "sobrepago" | "sin_total";
export type EntregaVoucher = "sin_voucher" | "pendiente" | "entregado";
export type EstadoFactura = "emitida" | "sin_validar" | "sin_factura";
export type EnvioFactura = "sin_factura" | "pendiente" | "enviada" | "desactualizada";
export type ClaseComision = "pendiente" | "parcial" | "pagada" | "descontada" | "revision_neto" | "retenida" | "prevista" | "sin_definir" | "no_aplica";
export type Moneda = "COP" | "USD";

export type EventoSeguimiento = {
  /** Último evento registrado: «marcar» (acuse) o «desmarcar» (retiro). null = nunca se registró nada. */
  evento: "marcar" | "desmarcar" | null;
  en: string | null;
  actor: string | null;
  canal: string | null;
  nota: string | null;
};

export type FilaGestion = {
  numero: string;
  uid: string;
  tenant: "mayorista" | "minorista";
  cliente: string | null;
  destino: string | null;
  tipoPaquete: string | null;
  fechaVenta: string | null;
  fechaSalida: string | null;
  fechaRegreso: string | null;
  estado: string | null;
  estadoGrupo: EstadoGrupo;
  financieroPendiente: boolean;
  monedaOferta: Moneda;
  precioOferta: number | null;
  monedaCobro: Moneda;
  cobroConvertido: boolean;
  /** null = total desconocido (no se inventa un cero). */
  total: number | null;
  pagado: number;
  saldo: number | null;
  saldoClase: SaldoClase;
  nAbonos: number;
  /** `acuseAnterior`: la entrega registrada quedó sustituida por un voucher nuevo (el evento de abajo es ese acuse anterior; sigue en el historial). */
  voucher: EventoSeguimiento & { n: number; entrega: EntregaVoucher; acuseAnterior: boolean; /** ADL-041 (338): un voucher conservó su enlace pero CAMBIÓ de contenido después de la entrega registrada (señal interna; no dice nada de lo que vio el cliente). */ actualizado?: boolean; /** ADL-042 (338): vouchers de vuelo que ya NO corresponden a los tramos guardados (cambiaron → «revisar», o el servicio se retiró). */ aereoNoVigente?: number };
  /** `emitida` = validada en la DIAN (nada más lo establece); `estado` distingue «sin validar» (asiento o número, sin DIAN). */
  factura: EventoSeguimiento & { emitida: boolean; estado: EstadoFactura; contable: boolean; dian: boolean; registros: number; envio: EnvioFactura };
  comision: { clase: ClaseComision; filas: number };
};

export type ResumenGestion = { tenant: "mayorista" | "minorista"; moneda: Moneda; contratos: number; conSaldo: number; saldoPorCobrar: number; sobrepagados: number; sinTotal: number };
export type RespuestaGestion = { total: number; limite: number; desplazamiento: number; resumen: ResumenGestion[]; filas: FilaGestion[] };

const ESTADOS_GRUPO: readonly string[] = ["pendiente", "confirmado", "cancelado", "otro"];
const SALDOS: readonly string[] = ["con_saldo", "pagado", "sobrepago", "sin_total"];
const ENTREGAS: readonly string[] = ["sin_voucher", "pendiente", "entregado"];
const ESTADOS_FACTURA: readonly string[] = ["emitida", "sin_validar", "sin_factura"];
const ENVIOS: readonly string[] = ["sin_factura", "pendiente", "enviada", "desactualizada"];
const COMISIONES: readonly string[] = ["pendiente", "parcial", "pagada", "descontada", "revision_neto", "retenida", "prevista", "sin_definir", "no_aplica"];

type Obj = Record<string, unknown>;
const esObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
function fallo(que: string): never { throw new Error(`Respuesta inválida de Gestión de contratos: ${que}`); }
function txt(o: Obj, k: string, nulo = false): string | null {
  const v = o[k];
  if (v == null) { if (nulo) return null; fallo(`falta ${k}`); }
  if (typeof v !== "string") fallo(`${k} no es texto`);
  return v as string;
}
// numeric de Postgres llega como número JSON; null se conserva (desconocido), NaN/texto se rechaza.
function numero(o: Obj, k: string, nulo = false): number | null {
  const v = o[k];
  if (v == null) { if (nulo) return null; fallo(`falta ${k}`); }
  if (typeof v !== "number" || !Number.isFinite(v)) fallo(`${k} no es un número`);
  return v as number;
}
function enLista<T extends string>(o: Obj, k: string, lista: readonly string[]): T {
  const v = txt(o, k) as string;
  if (!lista.includes(v)) fallo(`${k} con valor inesperado «${v}»`);
  return v as T;
}
function evento(o: unknown): EventoSeguimiento {
  if (!esObj(o)) fallo("bloque de seguimiento ausente");
  const ev = (o as Obj).evento;
  if (ev != null && ev !== "marcar" && ev !== "desmarcar") fallo("evento de seguimiento inesperado");
  return { evento: (ev ?? null) as EventoSeguimiento["evento"], en: txt(o as Obj, "en", true), actor: txt(o as Obj, "actor", true), canal: txt(o as Obj, "canal", true), nota: txt(o as Obj, "nota", true) };
}
function moneda(o: Obj, k: string): Moneda { return enLista<Moneda>(o, k, ["COP", "USD"]); }

function fila(raw: unknown): FilaGestion {
  if (!esObj(raw)) fallo("fila no es un objeto");
  const o = raw as Obj;
  const v = o.voucher, f = o.factura, c = o.comision;
  if (!esObj(v) || !esObj(f) || !esObj(c)) fallo("bloques voucher/factura/comisión ausentes");
  const tenant = enLista<"mayorista" | "minorista">(o, "tenant", ["mayorista", "minorista"]);
  return {
    numero: txt(o, "numero") as string, uid: txt(o, "uid") as string, tenant,
    cliente: txt(o, "cliente", true), destino: txt(o, "destino", true), tipoPaquete: txt(o, "tipo_paquete", true),
    fechaVenta: txt(o, "fecha_venta", true), fechaSalida: txt(o, "fecha_salida", true), fechaRegreso: txt(o, "fecha_regreso", true),
    estado: txt(o, "estado", true), estadoGrupo: enLista<EstadoGrupo>(o, "estado_grupo", ESTADOS_GRUPO), financieroPendiente: o.financiero_pendiente === true,
    monedaOferta: moneda(o, "moneda_oferta"), precioOferta: numero(o, "precio_oferta", true), monedaCobro: moneda(o, "moneda_cobro"), cobroConvertido: o.cobro_convertido === true,
    total: numero(o, "total", true), pagado: numero(o, "pagado") as number, saldo: numero(o, "saldo", true), saldoClase: enLista<SaldoClase>(o, "saldo_clase", SALDOS), nAbonos: numero(o, "n_abonos") as number,
    voucher: { ...evento(v), n: numero(v as Obj, "n") as number, entrega: enLista<EntregaVoucher>(v as Obj, "entrega", ENTREGAS), acuseAnterior: (v as Obj).acuse_anterior === true, actualizado: (v as Obj).actualizado === true, aereoNoVigente: typeof (v as Obj).aereo_no_vigente === "number" ? ((v as Obj).aereo_no_vigente as number) : 0 },
    factura: { ...evento(f), emitida: (f as Obj).emitida === true, estado: enLista<EstadoFactura>(f as Obj, "estado", ESTADOS_FACTURA), contable: (f as Obj).contable === true, dian: (f as Obj).dian === true, registros: numero(f as Obj, "registros") as number, envio: enLista<EnvioFactura>(f as Obj, "envio", ENVIOS) },
    comision: { clase: enLista<ClaseComision>(c as Obj, "clase", COMISIONES), filas: numero(c as Obj, "filas") as number },
  };
}

export function parsearRespuesta(raw: unknown): RespuestaGestion {
  if (!esObj(raw)) fallo("la respuesta no es un objeto");
  const o = raw as Obj;
  if (!Array.isArray(o.filas) || !Array.isArray(o.resumen)) fallo("faltan filas o resumen");
  const resumen = (o.resumen as unknown[]).map((r): ResumenGestion => {
    if (!esObj(r)) fallo("resumen inválido");
    const x = r as Obj;
    return {
      tenant: enLista<"mayorista" | "minorista">(x, "tenant", ["mayorista", "minorista"]), moneda: moneda(x, "moneda"),
      contratos: numero(x, "contratos") as number, conSaldo: numero(x, "con_saldo") as number, saldoPorCobrar: numero(x, "saldo_por_cobrar") as number,
      sobrepagados: numero(x, "sobrepagados") as number, sinTotal: numero(x, "sin_total") as number,
    };
  });
  return { total: numero(o, "total") as number, limite: numero(o, "limite") as number, desplazamiento: numero(o, "desplazamiento") as number, resumen, filas: (o.filas as unknown[]).map(fila) };
}
