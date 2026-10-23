// ===========================================================================
// Salesbot — contratos de SOLO LECTURA sobre Programas/Cotización.
//
// Fase A. No depende de CRM Leads, ni de Meta, ni de ningún canal.
//
// Este archivo no tiene imports a propósito: son tipos puros, para que
// cualquier capa (el servicio, un Server Action, un test, un prompt) los
// consuma sin arrastrar nada.
// ===========================================================================

/**
 * Tenant SOLO para trazabilidad.
 *
 * `programas` / `programa_*` NO tienen columna `tenant` y su RLS filtra por
 * `mi_rol()`, no por tenant (la migración 116 no las tocó). El catálogo de
 * Programas es COMPARTIDO entre las dos agencias: el aislamiento real empieza
 * en CRM Leads, que sí es tenant-scoped.
 *
 * Por eso el `tenant` de aquí no promises aislamiento: sirve para que el log
 * diga desde qué conversación se leyó. `salesbot_aislamiento_real()` devuelve
 * false mientras el catálogo no tenga la columna.
 */
export type SalesbotTenant = "mayorista" | "minorista";

export type SalesbotContextoLectura = {
  /**
   * Cliente Supabase. SOLO el cliente de servidor con anon key y cookies
   * (`lib/supabase/server.ts`), que respeta RLS. Este módulo NUNCA crea su
   * propio cliente y NUNCA usa `service_role`.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sb: any;
  /** Trazabilidad únicamente. Ver la nota de arriba. */
  tenant?: SalesbotTenant | null;
};

// ─── ENTRADAS ─────────────────────────────────────────────────────────────

export type SalesbotBuscarProgramasInput = {
  texto?: string;
  destino?: string;
  tipoTransporte?: "ninguno" | "aereo" | "terrestre";
  limite?: number;
};

// --- SALIDA: RESUMEN --------------------------------------------------

/**
 * Espejo de `ProgramaResumen` (`app/tarifario/TarifarioPublic.tsx`), que ya
 * viene SIN columnas internas. La lista blanca se vuelve a aplicar igual,
 * para que agregar un campo al resumen no lo Filtrado por accidente.
 */
export type SalesbotProgramaResumen = {
  id: number;
  nombre: string;
  subtitulo: string | null;
  dias: number | null;
  noches: number | null;
  moneda: string;
  /** `null` NO es cero: significa que no hay precio mínimo publicable. */
  desde_pvp: number | null;
  tipo_transporte: "ninguno" | "aereo" | "terrestre";
  portada_url: string | null;
  ciudades: string[];
};

// ─── SALIDA: PRECIO ───────────────────────────────────────────────────────

/**
 * Los tres estados que ya usa la vitrina pública
 * (`app/tarifario/programa/[id]/page.tsx`):
 *   `s.bajo_solicitud ? "A solicitud" : pr?.pvp != null ? formatMoneda(...) : "-"`
 *
 * El DTO lleva la INTERPRETACIÓN (`estado_precio`), no solo el `null`. Así el
 * modelo no puede leer `null` yengerar un número.
 */
export type SalesbotEstadoPrecio = "CONFIRMADO" | "A_SOLICITUD" | "NO_CONFIRMADO";

export type SalesbotPrecioResultado = {
  moneda: string;
  /** PVP YA calculado por la capa de lectura. Esta capa NUNCA lo recalcula. */
  pvp: number | null;
  estado_precio: SalesbotEstadoPrecio;
  origen: "categoria" | "salida";
  /** Valor crudo de la BD. Se conserva para auditoría, no para el cliente. */
  bajo_solicitud: boolean;
  acomodacion: string;
  categoria_id?: number;
  salida_id?: number;
  etiqueta?: string | null;
  fecha_desde?: string | null;
  fecha_hasta?: string | null;
  noches?: number | null;
};

// ─── SALIDA: DETALLE SEGURO ──────────────────────────────────────────────

/**
 * Proyección de lista blanca. Las columnas que existen en `programas` pero NO
 * aparecen aquí son, todas, internas:
 *
 *   notas, pct_mk, pct_fee_tarjeta, asistencia_medica_dia,
 *   desde_precio, incluye_aereo (legacy), regla_comisionable,
 *   regla_comisionable_modo, regla_comisionable_valor,
 *   regla_comisionable_pct_comision, regla_comisionable_modalidad_mk,
 *   regla_comisionable_impuesto_por_acomodacion
 *
 * De los hijos tampoco sale ningún `neto`, `neto_*`, `tarifa_*` ni
 * `impuesto_*`: son costo del proveedor.
 */
export type SalesbotCategoriaSegura = {
  id: number;
  nombre: string | null;
  hoteles: { ciudad: string; hotel: string | null }[];
  precios: SalesbotPrecioResultado[];
};

export type SalesbotDetalleProgramaSeguro = {
  id: number;
  nombre: string;
  subtitulo: string | null;
  dias: number | null;
  noches: number | null;
  moneda: string;
  tipo_transporte: "ninguno" | "aereo" | "terrestre";
  proveedor_nombre: string | null;

  portada_url: string | null;
  flyer_url: string | null;
  historia_url: string | null;
  video_url: string | null;
  highlights: string[];

  texto_condiciones: string | null;
  texto_cancelacion: string | null;
  texto_pagos: string | null;

  vigencia_desde: string | null;
  vigencia_hasta: string | null;
  min_pax: number | null;
  max_pax: number | null;
  edad_nino_min: number | null;
  edad_nino_max: number | null;
  edad_infante_max: number | null;

  ciudades: { nombre: string; noches: number | null; codigo_iata: string | null }[];
  itinerario: {
    dia: number;
    titulo: string | null;
    desayuno: boolean;
    almuerzo: boolean;
    cena: boolean;
    descripcion: string | null;
  }[];
  categorias: SalesbotCategoriaSegura[];
  salidas: {
    id: number;
    etiqueta: string | null;
    fecha_desde: string | null;
    fecha_hasta: string | null;
    noches: number | null;
    bajo_solicitud: boolean;
    precios: SalesbotPrecioResultado[];
  }[];
  inclusiones: { ciudad: string | null; tipo: string; texto: string }[];
  tours: {
    ciudad: string | null;
    nombre: string;
    precio: number | null;
    min_pax: number;
    dias_operacion: string | null;
    descripcion: string | null;
  }[];
  /** Fechas bloqueadas. NO es disponibilidad. */
  blackouts: { fecha_inicio: string | null; fecha_fin: string | null; motivo: string | null; ciudad: string | null }[];
};

// ─── ERRORES TIPADOS ──────────────────────────────────────────────────────

export type SalesbotCodigoError =
  /** La consulta fue correcta y no hay nada que devolver. */
  | "SIN_RESULTADOS"
  /** Sin fecha / pax / edades / destino no se puede cotizar. */
  | "FALTAN_DATOS_USUARIO"
  /** No existe, no está publicado, o está inactivo. Indistinguible a propósito. */
  | "PROGRAMA_NO_PUBLICADO"
  /** Hay producto pero no hay precio confirmado. */
  | "PRECIO_BAJO_SOLICITUD"
  /** Fallo técnico. NUNCA se disfraza de SIN_RESULTADOS. */
  | "CONSULTA_FALLIDA"
  /** No existe fuente de cupos. No es un fallo: es una abstención deliberada. */
  | "DISPONIBILIDAD_NO_CONSULTABLE"
  /** Se pidió un dato que esta consulta no trae. */
  | "DATO_NO_CONSULTADO";

export type SalesbotConsultaError = {
  codigo: SalesbotCodigoError;
  /** Redacción honesta para el usuario. Sin jerga interna. */
  mensaje: string;
  /** true si requiere un asesor humano. */
  escalable: boolean;
  /** Solo para log. NUNCA sale hacia el modelo ni hacia el cliente. */
  traza?: {
    /** Solo para log. Texto libre: lo usa el gate y también la disponibilidad. */
    motivo?: string;
    consulta?: string;
    error?: string;
  };
};

// ─── ENVOLTORIO ───────────────────────────────────────────────────────────

export type SalesbotOk<T> = {
  ok: true;
  datos: T;
  /** Trazabilidad. No es aislamiento: ver la nota de `SalesbotTenant`. */
  tenant: SalesbotTenant | null;
  consultado_en: string;
};

export type SalesbotError = {
  ok: false;
  error: SalesbotConsultaError;
  tenant: SalesbotTenant | null;
  consultado_en: string;
};

export type SalesbotResultado<T> = SalesbotOk<T> | SalesbotError;

export type SalesbotBusquedaResultado = {
  programas: SalesbotProgramaResumen[];
  /**
   * Lo que NO se consultó. Sirve para que la respuesta no afirme lo que no
   * sabe: desde el resumen no hay vigencia, ni condiciones, ni pax.
   */
  no_consultado: ("vigencia" | "condiciones" | "min_max_pax" | "disponibilidad")[];
};

/** ¿El catálogo de Programas aísla por tenant? Hoy, no. */
export function salesbot_aislamiento_real(): false {
  return false;
}