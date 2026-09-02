// ─────────────────────────────────────────────────────────────────────────
// Database164 · superficie de tipos de la migración 164 (condiciones de pago
// por componente).
//
// NO modifica `types/database.ts` (archivo curado a mano que refleja el schema
// real de producción y contra el que compila el código existente; regenerarlo
// entero cambia nullability y rompe páginas). En su lugar, este módulo declara
// SOLO los objetos nuevos de la 164 y los cruza por intersección con el tipo
// base:
//
//   type Database164 = Database & { public: { Tables: …&…; Functions: …&… } };
//
// Los clientes que operen las tablas/RPC de la 164 se tipan con `<Database164>`
// (no con `<Database>`), de modo que el resto de la app queda intacto y el
// código nuevo typechecka. La forma de cada objeto se tomó del schema 164 tal
// como se aplicó en local (`supabase gen types --local`), fiel a la DDL.
//
// ⚠️ Aquí no hay lógica de negocio: solo tipos. La matemática y reglas viven en
// `lib/cotizacion/condicionPago.ts` y `lib/cotizacion/snapshotCondiciones.ts`.
// ─────────────────────────────────────────────────────────────────────────
import type { Database, Json } from "./database";

// ── 1) Columnas ADITIVAS sobre tablas existentes (mig 164) ──────────────
type HotelTemporadasCond = {
  condicion_pago_tipo: string; // 'sin_condicion' | 'pago_total' | 'anticipo_saldo' (texto con CHECK)
  condicion_pago_pct_inicial: number | null;
  condicion_pago_dias_saldo: number | null;
};

type ArmadoPaquetesCond = {
  condicion_pago_tipo: string; // 'normal' | 'pago_total' | 'anticipo_saldo'
  condicion_pago_pct_inicial: number | null;
  condicion_pago_dias_saldo: number | null;
  restriccion_comercial: string; // 'normal' | 'promocional_no_reembolsable' | 'no_reembolsable_no_endosable'
};

type ProgramasCond = {
  condicion_pago_tipo: string;
  condicion_pago_pct_inicial: number | null;
  condicion_pago_dias_saldo: number | null;
  restriccion_comercial: string;
};

type CotizacionesCond = {
  condicion_pago_congelada_en: string | null; // timestamptz
  moneda_congelada: string | null;
  trm_autoritativa: number | null;
  precio_total_congelado: number | null;
  monto_exigido_total: number | null;
  monto_exigido_total_cop: number | null;
  pct_efectivo_informativo: number | null; // solo informativo (0..100)
};

type VentasCond = {
  cotizacion_id: number | null; // UNIQUE nullable → UN SOLO CONTRATO por cotización
};

// Optionalizar un set de columnas para los Insert/Update aditivos.
type Optional<T> = { [K in keyof T]?: T[K] };

// ── 2) Tablas NUEVAS (mig 164) ──────────────────────────────────────────
/** Config por tipo de componente: % de abono mínimo ("primera cuota") exigido
 *  cuando el componente no declara condición propia. El aéreo empaquetado NO
 *  tiene fila: siempre 100% de su propio valor (lo impone el motor). */
interface ConfigCobrosComponenteRow {
  tipo_componente: string; // 'hotel' | 'vuelo_bloqueo' | 'servicio'
  pct_abono: number | null;
  updated_at: string | null;
}

/** Snapshot CONGELADO de una condición por componente de la cotización. */
interface CotizacionCondicionRow {
  id: number;
  cotizacion_id: number;
  orden: number;
  tipo_componente: string; // 'hotel' | 'aereo_bloqueo' | 'aereo_empaquetado' | 'servicio' | 'programa' | 'paquete' | 'otros'
  referencia_externa: string | null;
  paquete_id: number | null;
  programa_id: number | null;
  hotel_temporada_id: number | null;
  valor_componente: number;
  condicion_pago_tipo: string;
  condicion_pago_pct_aplicable: number | null;
  condicion_pago_dias_saldo: number | null;
  condicion_pago_fecha_limite: string | null;
  monto_exigido: number;
  restriccion_comercial: string;
  congelado: boolean;
  created_at: string | null;
}

/** Un pago previo (pre-pago manual de un rol autorizado) sobre una cotización,
 *  antes de su conversión a contrato. */
interface CotizacionPagoPrevioRow {
  id: number;
  cotizacion_id: number;
  estado: string; // 'activo' | 'aplicado' | 'anulado'
  monto_cop: number;
  moneda: string;
  trm: number | null;
  fecha_pago: string | null;
  forma_pago: string;
  referencia: string | null;
  registrado_por_id: string;
  registrado_por_email: string | null;
  abono_id: number | null; // al aplicarse en la conversión → abonos.id
  motivo_anulacion: string | null;
  idempotency_key: string | null;
  tenant: string;
  created_at: string | null;
}

/** Condiciones de pago del CONTRATO ya creado (fuente única de cláusulas y de
 *  la restricción no-reembolsable/no-endosable por componente). */
interface ContratoCondicionRow {
  id: number;
  numero_contrato: string;
  orden: number;
  tipo_componente: string;
  referencia_externa: string | null;
  valor_componente: number;
  condicion_pago_tipo: string;
  condicion_pago_pct_aplicable: number | null;
  condicion_pago_dias_saldo: number | null;
  condicion_pago_fecha_limite: string | null;
  monto_exigido: number;
  restriccion_comercial: string;
  moneda: string | null;
  trm: number | null;
  creado_en: string | null;
}

/** Override de restricción, solo superadmin, con motivo y auditoría durable. */
interface RestriccionOverrideRow {
  id: number;
  numero_contrato: string;
  tabla_afectada: string; // ej. 'contrato_condiciones'
  accion: string; // ej. 'forzar_no_restricto'
  motivo: string;
  usuario_id: string;
  usuario_email: string | null;
  creado_en: string | null;
}

// ── 3) Funciones de dinero (RPC) de la 164 ──────────────────────────────
interface RegistrarPagoPrevioArgs {
  p_cotizacion_id: number;
  p_monto_cop: number;
  p_moneda: string;
  p_trm: number;
  p_forma_pago: string;
  p_referencia: string;
  p_fecha_pago: string;
  p_usuario_id: string;
  p_idempotency_key?: string;
}
interface AnularPagoPrevioArgs {
  p_pago_id: number;
  p_motivo?: string;
  p_usuario_id: string;
}
interface TransferirPagosPreviosArgs {
  p_cotizacion_id: number;
  p_numero_contrato: string;
  p_usuario_id: string;
}

// ── 4) Intersección: Database164 ────────────────────────────────────────
type AddTables = {
  // tablas existentes → solo columnas nuevas (se cruzan con la base)
  hotel_temporadas: {
    Row: HotelTemporadasCond;
    Insert: Optional<HotelTemporadasCond>;
    Update: Optional<HotelTemporadasCond>;
  };
  armado_paquetes: {
    Row: ArmadoPaquetesCond;
    Insert: Optional<ArmadoPaquetesCond>;
    Update: Optional<ArmadoPaquetesCond>;
  };
  programas: {
    Row: ProgramasCond;
    Insert: Optional<ProgramasCond>;
    Update: Optional<ProgramasCond>;
  };
  cotizaciones: {
    Row: CotizacionesCond;
    Insert: Optional<CotizacionesCond>;
    Update: Optional<CotizacionesCond>;
  };
  ventas: {
    Row: VentasCond;
    Insert: Optional<VentasCond>;
    Update: Optional<VentasCond>;
  };
  // tablas nuevas (definición completa)
  config_cobros_componente: {
    Row: ConfigCobrosComponenteRow;
    Insert: ConfigCobrosComponenteRow;
    Update: Partial<ConfigCobrosComponenteRow>;
  };
  cotizacion_condiciones: {
    Row: CotizacionCondicionRow;
    Insert: Omit<CotizacionCondicionRow, "id" | "created_at"> & Partial<Pick<CotizacionCondicionRow, "created_at">>;
    Update: Partial<CotizacionCondicionRow>;
  };
  cotizacion_pagos_previos: {
    Row: CotizacionPagoPrevioRow;
    Insert: Omit<CotizacionPagoPrevioRow, "id" | "estado" | "moneda" | "trm" | "fecha_pago" | "referencia" | "registrado_por_email" | "abono_id" | "motivo_anulacion" | "idempotency_key" | "tenant" | "created_at"> &
      Partial<
        Pick<
          CotizacionPagoPrevioRow,
          | "id"
          | "estado"
          | "moneda"
          | "trm"
          | "fecha_pago"
          | "referencia"
          | "registrado_por_email"
          | "abono_id"
          | "motivo_anulacion"
          | "idempotency_key"
          | "tenant"
          | "created_at"
        >
      >;
    Update: Partial<CotizacionPagoPrevioRow>;
  };
  contrato_condiciones: {
    Row: ContratoCondicionRow;
    Insert: Omit<ContratoCondicionRow, "id" | "creado_en">;
    Update: Partial<ContratoCondicionRow>;
  };
  restriccion_overrides: {
    Row: RestriccionOverrideRow;
    Insert: Omit<RestriccionOverrideRow, "id" | "creado_en" | "usuario_email"> &
      Partial<Pick<RestriccionOverrideRow, "usuario_email">>;
    Update: Partial<RestriccionOverrideRow>;
  };
};

type AddFunctions = {
  registrar_pago_previo: { Args: RegistrarPagoPrevioArgs; Returns: string };
  anular_pago_previo: { Args: AnularPagoPrevioArgs; Returns: string };
  transferir_pagos_previos_a_abonos: { Args: TransferirPagosPreviosArgs; Returns: string };
};

export type Database164 = Database & {
  public: {
    Tables: Database["public"]["Tables"] & AddTables;
    Functions: Database["public"]["Functions"] & AddFunctions;
  };
};

// ── 5) Helpers tipados para el código nuevo ──────────────────────────────
export type TableRow164<T extends keyof AddTables> = Database164["public"]["Tables"][T]["Row"];
export type TableInsert164<T extends keyof AddTables> = Database164["public"]["Tables"][T]["Insert"];

export type ConfigCobrosComponente = TableRow164<"config_cobros_componente">;
export type CotizacionCondicion = TableRow164<"cotizacion_condiciones">;
export type CotizacionPagoPrevio = TableRow164<"cotizacion_pagos_previos">;
export type ContratoCondicion = TableRow164<"contrato_condiciones">;
export type RestriccionOverride = TableRow164<"restriccion_overrides">;

// Re-export del tipo Json (por si algún call-site lo necesita).
export type { Json };
