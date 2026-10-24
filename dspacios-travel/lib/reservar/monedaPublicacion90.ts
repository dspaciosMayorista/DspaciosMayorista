// ─────────────────────────────────────────────────────────────────────────
// #90 Entrega D / #93 — moneda de PUBLICACIÓN elegida por quien monta el paquete y TRM condicional.
//
// Módulo PURO (sin I/O, sin alias `@/`): lo usan el panel del armado, `generarTarifario`, la cotización de la oferta #63 y las
// pruebas, para que los tres respondan LO MISMO con las mismas fuentes (paridad).
//
// Reglas del dueño (ADL-035, TASKS #90/#93):
//   · La moneda de publicación (COP o USD) la ELIGE el usuario al montar el paquete; nunca se deriva de los hoteles disponibles ni
//     cambia en silencio. Las fuentes se evalúan con su moneda REAL guardada.
//   · Modo `cop_trm_63` (solo Dinámico; oferta con conversión por TRM): admite fuentes COP y USD y se publica en la moneda ELEGIDA.
//       - Publicación en COP (la de siempre): la TRM es obligatoria y positiva SOLO si alguna fuente está en USD. Si todas son COP
//         no hace falta TRM ("No requiere conversión").
//       - Publicación en USD: una fuente en USD entra SIN conversión; una en COP se convierte COP / TRM. La TRM de publicación es
//         obligatoria, positiva y queda congelada en la oferta SOLO si alguna fuente está en COP. Con fuentes EXCLUSIVAMENTE en USD se
//         publica y se cotiza sin TRM ("No requiere conversión"); la contabilidad está en pesos, así que la TRM PROVISIONAL (la de
//         referencia) se captura y congela AL CONTRATAR, antes de crear CxP o asientos en COP (aceptar_oferta_63, migración 234).
//     Nunca se usa una TRM de 1 implícita ni se decide por el país del destino.
//   · Fuera del modo 63 la mezcla se rechaza (Entrega E, atada a E4 contable): las fuentes deben tener la moneda de publicación.
//     Fuentes uniformes en OTRA moneda que la elegida necesitarían una conversión que depende de E4: NO se publican (subcaso
//     detenido), sin inventar importes.
// ─────────────────────────────────────────────────────────────────────────

export type MonedaPublicacion90 = "COP" | "USD";
export type ModoPublicacion90 = "legacy" | "cop_trm_63";
export type TipoFuente90 = "hotel" | "servicio" | "salida" | "vuelo";

export type FuenteMoneda90 = {
  tipo: TipoFuente90;
  nombre: string;
  /** Moneda GUARDADA de la fuente. null / texto raro = sin acreditar (no se infiere como COP). */
  moneda: string | null | undefined;
};

export type EntradaPublicacion90 = {
  modo: ModoPublicacion90;
  /** Lo elegido por el usuario (`armado_paquetes.moneda_publicacion`). null = sin elegir. */
  monedaPublicacion: unknown;
  /** TRM guardada del paquete (`trm_oferta`). */
  trm: unknown;
  fuentes: readonly FuenteMoneda90[];
};

export type CodigoBloqueo90 =
  | "sin_moneda"
  | "moneda_fuente_invalida"
  | "mezcla_fuera_modo63"
  | "conversion_no_disponible"
  | "trm_faltante"
  | "trm_invalida";

export type Bloqueo90 = { codigo: CodigoBloqueo90; mensaje: string; componentes: string[] };

export type EstadoTrm90 = "no_requiere" | "ok" | "falta" | "invalida";

export type EvaluacionPublicacion90 = {
  ok: boolean;
  monedaPublicacion: MonedaPublicacion90 | null;
  requiereTrm: boolean;
  /** TRM guardada y válida (> 0), o null. Es la única que se usa: nunca 1. */
  trm: number | null;
  estadoTrm: EstadoTrm90;
  /** Componentes (con su tipo) por moneda real, para explicarlos en pantalla. */
  componentesUsd: string[];
  componentesCop: string[];
  bloqueos: Bloqueo90[];
};

export const ETIQUETA_SIN_CONVERSION_90 = "No requiere conversión";

const NOMBRE_TIPO: Record<TipoFuente90, string> = { hotel: "Hotel", servicio: "Servicio", salida: "Salida", vuelo: "Vuelo" };

export function etiquetaFuente90(f: FuenteMoneda90): string {
  return `${NOMBRE_TIPO[f.tipo]} ${f.nombre}`.trim();
}

/** 234: una oferta USD sin TRM de publicación se contrata SOLO con la TRM provisional que ingresa quien la convierte (no hay respaldo automático). */
export const MENSAJE_TRM_PROVISIONAL_REQUERIDA_63 =
  "Esta oferta está en USD y no tiene TRM: ingresa la TRM provisional del contrato (pesos por dólar) para poder generarlo.";

export function monedaPublicacionValida90(v: unknown): v is MonedaPublicacion90 {
  return v === "COP" || v === "USD";
}

/** TRM estricta: número finito > 0. vacío / null / texto / booleano / 0 / negativo → null (nunca 1). */
export function trmValida90(v: unknown): number | null {
  if (typeof v === "boolean" || v == null) return null;
  if (typeof v === "string" && v.trim() === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  // Mismo tope que la base (armado_paquetes_trm_finita_chk: finita y < 1e11): nunca llega a la columna un valor que la desborde.
  return Number.isFinite(n) && n > 0 && n < 100000000000 ? n : null;
}

function hayTrmEscrita(v: unknown): boolean {
  if (v == null) return false;
  if (typeof v === "string") return v.trim() !== "";
  return true;
}

function lista(c: string[]): string {
  return c.slice(0, 4).join(", ") + (c.length > 4 ? ` y ${c.length - 4} más` : "");
}

export function evaluarPublicacion90(e: EntradaPublicacion90): EvaluacionPublicacion90 {
  const bloqueos: Bloqueo90[] = [];
  const modo63 = e.modo === "cop_trm_63";
  // El modo 63 sin moneda elegida (paquetes anteriores a la 233) publica en COP POR DEFINICIÓN (no es una deducción desde las fuentes);
  // si la eligió (COP o USD) se respeta. Fuera del modo 63 la moneda debe estar elegida.
  const mp = monedaPublicacionValida90(e.monedaPublicacion) ? e.monedaPublicacion : modo63 && (e.monedaPublicacion == null || e.monedaPublicacion === "") ? "COP" : null;

  // Qué entra a la evaluación según el modo:
  //   · modo 63: hoteles + servicios + salidas dinámicas (manuales y vinculadas); un vuelo de Bloqueo/Sistema del armado no entra a la oferta;
  //   · modo de siempre: hoteles + servicios + vuelos de Bloqueo/Sistema. La `moneda` de una salida dinámica MANUAL solo se acredita para el
  //     modo 63 (por defecto 'COP' en todas): el tiquete de una salida de siempre se toma en la moneda del paquete, así que no cuenta aquí.
  const fuentes = e.fuentes.filter((f) => (modo63 ? f.tipo !== "vuelo" : f.tipo !== "salida"));
  const invalidas = fuentes.filter((f) => f.moneda !== "COP" && f.moneda !== "USD");
  const usd = fuentes.filter((f) => f.moneda === "USD");
  const cop = fuentes.filter((f) => f.moneda === "COP");
  const componentesUsd = usd.map(etiquetaFuente90);
  const componentesCop = cop.map(etiquetaFuente90);

  if (mp === null) {
    bloqueos.push({
      codigo: "sin_moneda",
      mensaje: "Elige la moneda de publicación del paquete (COP o USD) en su configuración. No se deduce de los hoteles.",
      componentes: [],
    });
  }
  if (invalidas.length) {
    const c = invalidas.map(etiquetaFuente90);
    bloqueos.push({
      codigo: "moneda_fuente_invalida",
      mensaje: `Sin moneda válida (COP o USD) en: ${lista(c)}. Acredítala en su catálogo antes de publicar; no se asume COP.`,
      componentes: c,
    });
  }

  let requiereTrm = false;
  if (modo63) {
    // Solo si hay algo que CONVERTIR: en COP, alguna fuente en USD; en USD, alguna fuente en COP.
    requiereTrm = mp === "USD" ? cop.length > 0 : usd.length > 0;
  } else if (mp !== null && !invalidas.length) {
    const distintas = fuentes.filter((f) => f.moneda !== mp);
    if (distintas.length) {
      const hayDeLaElegida = fuentes.some((f) => f.moneda === mp);
      const c = distintas.map(etiquetaFuente90);
      if (hayDeLaElegida) {
        bloqueos.push({
          codigo: "mezcla_fuera_modo63",
          mensaje: `El paquete se publica en ${mp} pero hay componentes en ${mp === "COP" ? "USD" : "COP"}: ${lista(c)}. Mezclar monedas (COP y USD) solo existe en el modo con conversión por TRM (Entrega E aún no disponible).`,
          componentes: c,
        });
      } else {
        bloqueos.push({
          codigo: "conversion_no_disponible",
          mensaje: `Todos los componentes están en ${mp === "COP" ? "USD" : "COP"} y el paquete se publica en ${mp}: esa conversión depende de E4 y aún no está disponible. Publica en ${mp === "COP" ? "USD" : "COP"} o usa el modo con conversión por TRM.`,
          componentes: c,
        });
      }
    }
  }

  // TRM: solo cuenta si hay algo que convertir.
  const trm = modo63 ? trmValida90(e.trm) : null;
  let estadoTrm: EstadoTrm90 = "no_requiere";
  if (requiereTrm) {
    if (trm !== null) estadoTrm = "ok";
    else if (hayTrmEscrita(e.trm)) estadoTrm = "invalida";
    else estadoTrm = "falta";
    if (estadoTrm !== "ok") {
      const cabecera = estadoTrm === "falta" ? "Falta la TRM" : "La TRM no es válida (debe ser un número positivo)";
      const detalle = mp === "USD"
        ? `el paquete se publica en USD y hay componentes en COP que se convierten (COP / TRM) (${lista(componentesCop)})`
        : `hay componentes en USD que se convierten a COP (${lista(componentesUsd)})`;
      bloqueos.push({
        codigo: estadoTrm === "falta" ? "trm_faltante" : "trm_invalida",
        mensaje: `${cabecera}: ${detalle}. Configúrala en el paquete antes de publicar o cotizar.`,
        componentes: mp === "USD" ? componentesCop : componentesUsd,
      });
    }
  } else if (modo63 && trm !== null) {
    estadoTrm = "ok";
  }

  return {
    ok: bloqueos.length === 0,
    monedaPublicacion: mp,
    requiereTrm,
    trm,
    estadoTrm,
    componentesUsd,
    componentesCop,
    bloqueos,
  };
}

/** Primer motivo para devolver al usuario (los demás se ven en el panel). */
export function mensajeEvaluacion90(ev: EvaluacionPublicacion90): string {
  return ev.bloqueos.map((b) => b.mensaje).join(" ");
}

/** Texto corto del estado de la TRM para el panel. */
export function textoEstadoTrm90(ev: EvaluacionPublicacion90): string {
  if (!ev.requiereTrm) return ETIQUETA_SIN_CONVERSION_90;
  if (ev.estadoTrm === "ok") return `TRM ${ev.trm} (COP por USD)`;
  const motivo = ev.monedaPublicacion === "USD" ? "hay componentes en COP" : "hay componentes en USD";
  return ev.estadoTrm === "invalida" ? "TRM inválida: se necesita un número positivo" : `Falta la TRM: ${motivo}`;
}
