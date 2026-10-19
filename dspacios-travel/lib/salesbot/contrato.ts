// ─────────────────────────────────────────────────────────────────────────
// Contrato de la consulta interna de programas (#56)
//
// Tipos y constantes PUROS (sin I/O, sin `server-only`) de las dos
// operaciones de solo lectura que alimentarán al SalesBot: `buscarProgramas`
// y `detallePrograma`. La lectura real vive en `lectura.ts` (servidor) y las
// transformaciones puras en `consulta.ts`.
//
// Reglas fijadas por el dueño y el Auditor (bitácora de #56):
//   · Solo Mayorista, solo roles internos aprobados (ver LECTURA_MODULO.salesbot).
//   · PVP por persona como REFERENCIA: nunca totales, subtotales, base
//     comisionable ni monto de comisión mientras #57 no esté resuelto.
//   · Audiencia B2B: solo el % PROPIO de la agencia elegida; nunca el default.
//   · Nunca el neto ni los campos internos del programa (ver CLAVES_PROHIBIDAS).
//   · Un dato consultado vale 15 minutos.
// ─────────────────────────────────────────────────────────────────────────

export const VERSION_CONTRATO = "56.1";

/** Un dato consultado vale 15 minutos (decisión del dueño). */
export const VIGENCIA_DATO_MS = 15 * 60 * 1000;

/** Tamaño máximo de una búsqueda. */
export const LIMITE_MAXIMO_BUSQUEDA = 10;
export const LIMITE_POR_DEFECTO_BUSQUEDA = 5;

/**
 * Claves que NUNCA pueden aparecer en una salida de la consulta, a ninguna
 * profundidad: costos y reglas del proveedor, markup, fee, proveedor, notas
 * internas y los campos de mínimo/máximo de pasajeros del programa (el dueño
 * decidió no usarlos hasta revisar esos datos).
 */
export const CLAVES_PROHIBIDAS: readonly string[] = [
  "neto",
  "neto_sencilla",
  "neto_doble",
  "neto_triple",
  "neto_multiple",
  "neto_nino",
  "tarifa_sencilla",
  "tarifa_doble",
  "tarifa_triple",
  "tarifa_multiple",
  "impuesto_sencilla",
  "impuesto_doble",
  "impuesto_triple",
  "impuesto_multiple",
  "pct_mk",
  "pct_fee_tarjeta",
  "asistencia_medica_dia",
  "regla_comisionable",
  "regla_comisionable_modo",
  "regla_comisionable_valor",
  "regla_comisionable_pct_comision",
  "regla_comisionable_modalidad_mk",
  "regla_comisionable_impuesto_por_acomodacion",
  "proveedor",
  "proveedor_id",
  "proveedorNombre",
  "proveedores",
  "notas",
  "nino_valor_servicios",
  "min_pax",
  "max_pax",
  "base_comisionable",
  "comision",
  "comision_estimada",
  "total",
  "subtotal",
  "banco",
  "tipo_cuenta",
  "numero_cuenta",
  "nit",
];

export type Audiencia = "b2c" | "b2b";

export type TipoTransporte = "ninguno" | "aereo" | "terrestre";

export type MotivoNoAutorizado = "sin_sesion" | "usuario_inactivo" | "rol_no_permitido" | "agencia_no_permitida";

export type CodigoError = "no_autorizado" | "parametros_invalidos" | "sin_resultados" | "no_encontrado" | "error_tecnico";

/** Sello de cada respuesta: cuándo se consultó, hasta cuándo vale y de dónde salió. */
export type Sello = {
  consultado_en: string;
  valido_hasta: string;
  fuente: "buscarProgramas" | "detallePrograma" | "porcentajeAgencia";
  version: string;
};

export type Respuesta<T> =
  | { ok: true; datos: T; sello: Sello }
  | { ok: false; codigo: CodigoError; motivo?: string; campos?: string[]; sello: Sello };

// ── Operación 1: búsqueda ────────────────────────────────────────────────

export type CriteriosBusqueda = {
  texto?: string;
  destino?: string;
  tipoTransporte?: TipoTransporte;
  /** Fecha de salida en formato AAAA-MM-DD (fecha de negocio). */
  fechaSalida?: string;
  presupuestoMaxPorPersona?: { monto: number; moneda: string };
  limite?: number;
};

export type ProgramaEncontrado = {
  id: number;
  nombre: string;
  subtitulo: string | null;
  destino: string | null;
  ciudades: string[];
  dias: number | null;
  noches: number | null;
  moneda: string;
  /** "Desde" por persona como referencia; null si no hay o si la lectura fue parcial. */
  desde_pvp_por_persona: number | null;
  tipo_transporte: TipoTransporte;
  precio_en_revision: boolean;
  url_vitrina: string;
};

export type ResultadoBusqueda = {
  resultados: ProgramaEncontrado[];
  total_encontrados: number;
  truncado: boolean;
  /** true si alguna consulta de enriquecimiento falló: los "Desde" se omiten. */
  parcial: boolean;
  /** Programas que no se pudieron comparar con el presupuesto (otra moneda o sin "Desde"). */
  omitidos_por_presupuesto: number;
};

// ── Operación 2: detalle ─────────────────────────────────────────────────

export type PrecioPorPersona =
  | { acomodacion: string; pvp_por_persona: number }
  | { acomodacion: string; a_solicitud: true };

export type DetalleConsulta = {
  id: number;
  nombre: string;
  subtitulo: string | null;
  destino: string | null;
  tipo_transporte: TipoTransporte;
  dias: number | null;
  noches: number | null;
  moneda: string;
  vigencia: { desde: string | null; hasta: string | null };
  salidas_texto: string | null;
  highlights: string[];
  ciudades: { nombre: string; noches: number; alojamiento_previsto: string | null }[];
  itinerario: { dia: number; titulo: string | null; comidas: string[]; descripcion: string | null }[];
  modo_precio: "categoria" | "salida";
  categorias: { id: number; nombre: string | null; hoteles: { ciudad: string; hotel: string | null }[]; precios: PrecioPorPersona[] }[];
  salidas: {
    id: number;
    etiqueta: string | null;
    fecha_desde: string | null;
    fecha_hasta: string | null;
    noches: number | null;
    columna: string | null;
    a_solicitud: boolean;
    precios: { acomodacion: string; pvp_por_persona: number }[];
  }[];
  incluye: { ciudad: string | null; texto: string }[];
  no_incluye: { ciudad: string | null; texto: string }[];
  tours: { nombre: string; ciudad: string | null; pvp_por_persona: number | null; min_pax_tour: number; dias_operacion: string | null; descripcion: string | null }[];
  blackouts: { desde: string | null; hasta: string | null; motivo: string | null }[];
  edades: { nino_min: number | null; nino_max: number | null; infante_max: number | null };
  condiciones: {
    pago: { tipo: string | null; pct_inicial: number | null; dias_saldo: number | null };
    restriccion_comercial: string | null;
    texto_condiciones: string | null;
    texto_cancelacion: string | null;
    texto_pagos: string | null;
  };
  precio_en_revision: boolean;
  url_vitrina: string;
};

// ── Audiencia B2B: % propio de la agencia ────────────────────────────────

export type AgenciaResumen = { id: number; nombre: string; tipo: string | null };

export type PorcentajeAgencia =
  | { estado: "propio"; agencia: AgenciaResumen; pct: number }
  | { estado: "sin_pct_propio"; agencia: AgenciaResumen }
  /** El % de la ficha no es una fracción válida (0..1): no se muestra ni se corrige. */
  | { estado: "pct_invalido"; agencia: AgenciaResumen }
  | { estado: "no_encontrada" };

/** Sello con la hora del servidor y la vigencia de 15 minutos. */
export function crearSello(fuente: Sello["fuente"], ahora: Date = new Date()): Sello {
  return {
    consultado_en: ahora.toISOString(),
    valido_hasta: new Date(ahora.getTime() + VIGENCIA_DATO_MS).toISOString(),
    fuente,
    version: VERSION_CONTRATO,
  };
}

/** Claves prohibidas presentes en un valor, a cualquier profundidad (vacío = limpio). */
export function clavesProhibidasEn(valor: unknown, ruta = ""): string[] {
  const halladas: string[] = [];
  if (Array.isArray(valor)) {
    valor.forEach((v, i) => halladas.push(...clavesProhibidasEn(v, `${ruta}[${i}]`)));
  } else if (valor && typeof valor === "object") {
    for (const [k, v] of Object.entries(valor as Record<string, unknown>)) {
      const r = ruta ? `${ruta}.${k}` : k;
      if (CLAVES_PROHIBIDAS.includes(k)) halladas.push(r);
      halladas.push(...clavesProhibidasEn(v, r));
    }
  }
  return halladas;
}
