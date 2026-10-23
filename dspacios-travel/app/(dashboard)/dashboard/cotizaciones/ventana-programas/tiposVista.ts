// ===========================================================================
// Ventana de Programas — tipos de la vista.
//
// Módulo PURO: sin "use server", sin "use client", sin Next, sin Supabase.
// Solo describe las formas que viajan entre el server action, el componente de
// React y el motor de plantillas. Los tipos que vienen de `lib/salesbot` se
// REEXPORTAN sin modificar: la vista no inventa una segunda forma del dato,
// porque dos formas del mismo dato divergen.
//
// Regla de oro de esta fase: el DTO de `lib/salesbot` es la única fuente. Si un
// campo no está en el DTO seguro, no existe para la pantalla. En particular NO
// hay forma de representar `notas`, `neto`, `pct_mk`, `regla_comisionable*`,
// `tarifa_*`, `impuesto_*` ni `traza` acá: si no tienen tipo, no se pueden
// pintar ni copiar.
// ===========================================================================

import type { Rol } from "@/lib/constants";
import type {
  SalesbotBusquedaResultado,
  SalesbotCodigoError,
  SalesbotDetalleProgramaSeguro,
  SalesbotProgramaResumen,
} from "@/lib/salesbot/types";

export type { SalesbotBusquedaResultado, SalesbotDetalleProgramaSeguro, SalesbotProgramaResumen };

/**
 * Roles del piloto.
 *
 * Vive aqui y NO en `consultas.ts` porque un archivo "use server" solo puede
 * exportar funciones async (lo dice el build de Next). Ademas es donde tiene
 * que estar: lo necesitan tanto la pagina como las actions, y es la lista que
 * las pruebas de wiring verifican.
 *
 * `control_vuelo` queda FUERA a proposito: no opera viajes comercialmente y no
 * necesita la ventana. Deliberadamente NO es `ROLES_INTERNOS`, para que ampliar
 * la herramienta sea una decision explicita y no una consecuencia de cambiar
 * una constante global.
 */
export const ROLES_PILOTO_VENTANA: readonly Rol[] = [
  "superadmin",
  "gerencia",
  "administracion",
  "operaciones",
  "venta",
];

/** Las seis consultas del piloto. El orden es el del formulario. */
export type TipoConsulta = "programas" | "precio" | "condiciones" | "fechas" | "disponibilidad" | "otro";

export const TIPOS_CONSULTA: readonly TipoConsulta[] = [
  "programas",
  "precio",
  "condiciones",
  "fechas",
  "disponibilidad",
  "otro",
] as const;

export const ETIQUETA_TIPO: Record<TipoConsulta, string> = {
  programas: "Programas",
  precio: "Precio",
  condiciones: "Condiciones",
  fechas: "Fechas de salida",
  disponibilidad: "Disponibilidad / cupos",
  otro: "Otro",
};

/** Descripción corta de cada tipo, para que el asesor sepa qué va a obtener. */
export const AYUDA_TIPO: Record<TipoConsulta, string> = {
  programas: "Lista los programas publicados que coinciden con la búsqueda.",
  precio: "Valor de referencia del programa para la acomodación elegida.",
  condiciones: "Condiciones, cancelaciones, pagos, vigencia y límites de edad o*pax*.",
  fechas: "Fechas de salida registradas en el catálogo. No son disponibilidad.",
  disponibilidad: "No hay fuente de cupos: la respuesta va a ser una abstención.",
  otro: "No lo consulté. Se responde con una derivación a asesor.",
};

/** `precio` y `fechas` no se redactan sin los datos del viaje. */
export const TIPOS_QUE_EXIGEN_PRECIO: readonly TipoConsulta[] = ["precio", "fechas"] as const;

export function exigeDatosDeViaje(tipo: TipoConsulta): boolean {
  return TIPOS_QUE_EXIGEN_PRECIO.includes(tipo);
}

// ─── Entrada del formulario ────────────────────────────────────────────────

export type ConsultaVentanaInput = {
  tipoConsulta: TipoConsulta;
  /** Combo de destino. Va a `SalesbotBuscarProgramasInput.destino`. */
  destino?: string;
  /** Búsqueda libre. Va a `SalesbotBuscarProgramasInput.texto`. */
  texto?: string;
  tipoTransporte?: "ninguno" | "aereo" | "terrestre";
  /** Elegido de la lista. `null` mientras el asesor no ha seleccionado. */
  programaId?: number | null;
  fechaSalida?: string;
  pax?: number | null;
  /** Edad por pasajero, en el mismo orden que `pax`. */
  edades?: number[];
  acomodacion?: string;
  /** Solo para encabezado del borrador. NO se persiste en ningún lado. */
  nombreAsesor?: string;
};

// ─── Errores hacia la vista ────────────────────────────────────────────────

/**
 * Error SIN `traza`. `SalesbotConsultaError.traza` es "solo para log, nunca
 * sale hacia el cliente" (Fase A), así que las actions la descartan antes de
 * devolver: la pantalla no puede mostrarla ni aunque se lo pidan.
 */
export type ErrorVentana = {
  ok: false;
  codigo: SalesbotCodigoError;
  mensaje: string;
  escalable: boolean;
};

export type ResultadoBusquedaVentana =
  | { ok: true; programas: SalesbotProgramaResumen[]; noConsultado: string[] }
  | ErrorVentana;

export type ResultadoDetalleVentana =
  | { ok: true; detalle: SalesbotDetalleProgramaSeguro }
  | ErrorVentana;

// ─── Borrador ──────────────────────────────────────────────────────────────

export type FraseBloqueada = { frase: string; porQue: string };

export type BorradorVentana = {
  /**
   * Texto listo para copiar. SIEMPRE cadena vacía cuando `seguro` es `false`:
   * el bloqueo es estructural (no hay texto que mostrar), no un `disabled` que
   * un devtools podría quitar.
   */
  texto: string;
  seguro: boolean;
  /** Por qué lo bloqueó el guard. Solo para el asesor; nunca se copia. */
  frasesBloqueadas: FraseBloqueada[];
  /** Avisos de la pantalla: `no_consultado`, bloqueos, precio a confirmar. */
  avisos: string[];
  /** El texto termina con una derivación a asesor humano. */
  requiereEscalamiento: boolean;
};

export type GenerarBorradorResultado = { ok: true; borrador: BorradorVentana } | ErrorVentana;

/** Lo que el motor necesita para redactar, ya resuelto desde el servidor. */
export type FuenteBorrador =
  | { clase: "busqueda"; datos: SalesbotBusquedaResultado }
  | { clase: "detalle"; datos: SalesbotDetalleProgramaSeguro }
  | { clase: "error"; codigo: SalesbotCodigoError; mensaje: string; escalable: boolean };

// ─── Normalizacion de entrada ──────────────────────────────────────────────
//
// Vive aqui, y no en `consultas.ts`, por una razon concreta: `consultas.ts` es
// "use server" e importa `next/headers`, asi que un `node --test` pelado no lo
// puede cargar. Al estar la validacion en un modulo puro, se puede probar de
// verdad sin base de datos ni stubs de Next.

function esTipoConsulta(v: unknown): v is TipoConsulta {
  return typeof v === "string" && (TIPOS_CONSULTA as readonly string[]).includes(v);
}

/** Recorta longitudes absurdas para no arrastrar texto de otro origen. */
function textoCorto(v: unknown, max = 200): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

function paxValido(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isInteger(n) && n >= 1 && n <= 40 ? n : null;
}

/** Id de programa: entero positivo. No tiene tope de negocio. */
function idPrograma(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isInteger(n) && n > 0 ? n : null;
}

function edadesValidas(v: unknown, pax: number | null): number[] {
  if (!Array.isArray(v)) return [];
  const out = v
    .map((e) => (typeof e === "number" ? e : Number(e)))
    .filter((e) => Number.isFinite(e) && e >= 0 && e <= 120);
  // Sin pax conocido no hay lista de edades util: se descarta entera.
  if (pax == null) return [];
  return out.slice(0, pax);
}

/**
 * Normaliza la entrada del formulario. Lo que no se puede interpretar se
 * devuelve como `null` o se descarta, nunca se pasa "para que el motor lo
 * maneje": una edad no numerica llega a `NaN` y contaminaria el conteo.
 */
export function normalizarEntrada(entrada: unknown): ConsultaVentanaInput | { error: string } {
  const e = (entrada ?? {}) as Record<string, unknown>;
  const tipo = e.tipoConsulta;

  if (!esTipoConsulta(tipo)) return { error: "Elige un tipo de consulta." };

  const pax = paxValido(e.pax);
  const transporte = e.tipoTransporte;

  return {
    tipoConsulta: tipo,
    destino: textoCorto(e.destino, 80),
    texto: textoCorto(e.texto, 80),
    tipoTransporte:
      transporte === "aereo" || transporte === "terrestre" || transporte === "ninguno"
        ? transporte
        : undefined,
    programaId: idPrograma(e.programaId),
    fechaSalida: textoCorto(e.fechaSalida, 20),
    pax,
    edades: edadesValidas(e.edades, pax),
    acomodacion: textoCorto(e.acomodacion, 30),
    nombreAsesor: textoCorto(e.nombreAsesor, 60),
  };
}