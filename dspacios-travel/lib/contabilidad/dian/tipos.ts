// Contrato de salida del módulo DIAN — fase AISLADA (sin base de datos, sin
// contabilización, sin servidor). Ver `docs/tecnico/contabilidad-dian.md`.
//
// Todo lo que entra es TEXTO (el XML de un documento o las filas copiadas del
// Excel de la DIAN) y todo lo que sale es un objeto normalizado en memoria más
// una lista explícita de problemas. Nunca se adivina un valor: si un campo no
// se puede leer con certeza, queda en `null` y se reporta el problema.
//
// Estas funciones NO son la fuente de verdad de una factura: solo copian y
// normalizan lo que el emisor declaró. Ni validan reglas tributarias, ni
// clasifican contra el PUC, ni crean asientos.

export type TipoDocumento = "factura" | "nota_credito" | "nota_debito";

/**
 * Problema detectado al leer un documento. `error` = el documento NO debe
 * seguir al siguiente paso de la bandeja; `aviso` = se puede seguir, pero una
 * persona tiene que confirmarlo.
 */
export type Severidad = "error" | "aviso";

export type CodigoProblema =
  // ── Estructura del archivo ──
  | "XML_VACIO"
  | "XML_MAL_FORMADO"
  | "XML_RAIZ_NO_RECONOCIDA"
  | "ADJUNTO_AUSENTE"
  | "ADJUNTO_VACIO"
  | "ADJUNTO_INVALIDO"
  | "ADJUNTO_NO_ES_XML"
  // ── Encabezado del Excel ──
  | "FILA_SIN_COLUMNAS"
  | "ENCABEZADO_DESCONOCIDO"
  // ── Campos ──
  | "CAMPO_AUSENTE"
  | "CAMPO_VACIO"
  | "CAMPO_AMBIGUO"
  | "NIT_INVALIDO"
  | "CUFE_INVALIDO"
  | "NUMERO_INVALIDO"
  | "FECHA_INVALIDA"
  | "FECHA_FUTURA"
  | "MONEDA_INVALIDA"
  | "MONTO_INVALIDO"
  | "TOTAL_NO_CUADRA";

export type ProblemaDian = {
  codigo: CodigoProblema;
  severidad: Severidad;
  /** Ruta del campo dentro del documento ("proveedor.nit", "LegalMonetaryTotal.PayableAmount"…). */
  campo: string;
  detalle: string;
};

/** Impuesto declarado en el documento (19 = 19 %, igual que lo muestra la DIAN). */
export type ImpuestoDian = {
  /** Código DIAN del impuesto: "01" IVA, "02" IVA no facturable, "03" IC, "04" consumo, "05" RER. */
  codigo: string;
  nombre: string | null;
  /** Porcentaje como número entero o decimal (0.19 → 19). `null` si el documento no lo declara. */
  tasa: number | null;
  base: number;
  valor: number;
};

/** Retención declarada en el documento (retefuente, reteICA, RER…). */
export type RetencionDian = {
  /** "01" retención IVA, "02" reteICA, "03" retención a cuenta propia de terceros, "04" RER, "05" retención renta. */
  codigo: string;
  nombre: string | null;
  base: number;
  valor: number;
};

export type FormaPagoDian = {
  codigo: string;
  /** Fecha de pago pactada (YYYY-MM-DD) cuando el documento la declara. */
  fecha: string | null;
  /** Monto pagado, cuando el documento lo declara. */
  monto: number | null;
};

export type LineaDian = {
  numero: number;
  descripcion: string | null;
  cantidad: number | null;
  /** Precio unitario SIN impuestos (0.19 no aplica: el documento ya lo separa). */
  precioUnitario: number | null;
  /** Base de la línea antes de impuestos. */
  base: number;
  /** Descuento de la línea, si lo declara. */
  descuento: number | null;
  impuestos: ImpuestoDian[];
  /** Cuenta contable que declara el emisor. NO es el PUC de D'spacios: es la cuenta del proveedor. */
  cuentaContable: string | null;
};

export type IdentidadTercero = {
  /** Sin puntos, guiones ni espacios. */
  identificacion: string | null;
  /** "NI", "CC", "CE", "NIT"… si el documento lo declara. */
  tipoIdentificacion: string | null;
  nombre: string | null;
};

/**
 * Identidad de proveedor o cliente con el NIT ya descompuesto. El staging
 * necesita el NIT por separado del DV para poder cruzar contra `proveedores` y
 * contra `cuentas_por_pagar`, que identifican por NIT.
 */
export type IdentidadDocumento = IdentidadTercero & {
  nit: string | null;
  dv: string | null;
  pais: string | null;
};

/**
 * Aritmética del documento tal como la declara el emisor. `totalDeclarado` es
 * el número que manda (`PayableAmount`); `totalCalculado` es lo que sale de
 * aplicar la fórmula real de la DIAN. Que difieran es exactamente lo que la
 * bandeja debe mostrarle al contador antes de clasificar nada.
 *
 * Fórmula verificada contra facturas electrónicas reales:
 * `TaxExclusiveAmount − AllowanceTotalAmount + ChargeTotalAmount
 *  + Σ TaxSubtotal.TaxAmount − PrepaidAmount + PayableRoundingAmount`.
 */
export type AritmeticaDian = {
  /** Suma de las líneas (`LineExtensionAmount`): la base de la fórmula real. */
  subtotal: number;
  /**
   * Base gravable declarada (`TaxExclusiveAmount`). NO es la base de la
   * fórmula: difiere del subtotal cuando hay líneas exentas o fuera de la
   * base, y usarla descuadra el documento.
   */
  baseGravable: number | null;
  descuentos: number;
  cargos: number;
  /** Anticipos ya pagados: se RESTAN del total a pagar. */
  anticipos: number;
  /** Redondeo del pago (`PayableRoundingAmount`). */
  redondeo: number;
  impuestos: number;
  retenciones: number;
  totalCalculado: number;
  totalDeclarado: number;
  diferencia: number;
};

/** Valores originales tal como venían, para cuando la clasificación fue ambigua. */
export type ValoresOriginales = {
  id: string | null;
  uuid: string | null;
  referenciaInterna: string | null;
  otrosIdentificadores: string[];
};

/** Cambio de divisa declarado en el documento (`cac:PaymentExchangeRate`). */
export type DivisaExtranjera = {
  /** Moneda en la que están los montos del documento. */
  origen: string | null;
  /** Moneda de la tasa informada. */
  destino: string | null;
  fecha: string | null;
  tasa: number | null;
};

export type DocumentoDian = {
  // ── Identificación del documento ──
  /** CUFE de una factura. */
  cufe: string | null;
  /** CUDE de una nota crédito o débito. */
  cude: string | null;
  tipoDocumento: TipoDocumento;
  /** Número del documento tal como lo compone la DIAN, sin guiones. */
  numero: string | null;
  /** YYYY-MM-DD. */
  fecha: string;
  // ── Quien emite y quien recibe ──
  proveedor: IdentidadDocumento;
  sujeto: IdentidadDocumento;
  // ── Montos ──
  moneda: string;
  /** Solo aplica si la moneda no es COP; `null` si el documento no lo declara. */
  trm: number | null;
  /** Datos de `cac:PaymentExchangeRate`, cuando el documento trae cambio. */
  divisa: DivisaExtranjera | null;
  aritmetica: AritmeticaDian;
  impuestos: ImpuestoDian[];
  retenciones: RetencionDian[];
  formasPago: FormaPagoDian[];
  lineas: LineaDian[];
  // ── Trazabilidad de la fuente ──
  software: string | null;
  /** XML tal cual llegó, para poder reprocesar sin volver a la fuente. */
  xml: string;
  originales: ValoresOriginales;
};

export type ResultadoDocumento =
  | { ok: true; documento: DocumentoDian; problemas: ProblemaDian[] }
  | { ok: false; documento: DocumentoDian | null; problemas: ProblemaDian[] };

/** Fila del Excel que no se pudo convertir en documento, con su motivo. */
export type FilaRechazada = {
  /** 1 = primera fila de datos (la cuenta la cabecera si viene incluida). */
  indice: number;
  celdas: string[];
  problemas: ProblemaDian[];
};

export type ResultadoLote = {
  /** `null` cuando no se pudo reconocer el encabezado de columnas. */
  columnas: Record<string, number> | null;
  cabecerasOriginales: string[];
  documentos: DocumentoDian[];
  rechazadas: FilaRechazada[];
  problemas: ProblemaDian[];
};

export function problema(
  codigo: CodigoProblema,
  campo: string,
  detalle: string,
  severidad: Severidad = "error"
): ProblemaDian {
  return { codigo, severidad, campo, detalle };
}

export function tieneErrores(problemas: ProblemaDian[]): boolean {
  return problemas.some((p) => p.severidad === "error");
}
