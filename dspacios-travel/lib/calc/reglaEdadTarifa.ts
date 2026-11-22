// ─────────────────────────────────────────────────────────────────────────
// Regla de edad EFECTIVA (infante/niño) de una fila de `tarifa_hotel` —
// fuente ÚNICA compartida entre `lib/reservar/computo.ts`,
// `lib/reservar/cotizar.ts` (vía `lib/reservar/liquidacionHotel.ts`) y
// `lib/calc/calculadoras.ts` (validación de "edades propias" de la
// calculadora Dubai). Ninguno de esos archivos debe reimplementar esta
// cadena de fallback ni las reglas del CHECK — todos importan de acá.
//
// Cadena de resolución (orden fijo, nunca al revés):
//   override de la fila `tarifa_hotel` (4 columnas nuevas, migración 177,
//   propuesta y NO aplicada aún — ver el informe de la ronda anterior)
//     ?? regla general de `hoteles` (edad_infante_max, edad_nino_max) — OBLIGATORIA si hay menores
//   O3 (2026-11-17): ya NO hay defaults inventados. La configuración de edades del hotel es obligatoria para todo hotel que acepta menores;
//   si falta o es inválida, cotizar/reservar CON menores falla con un motivo accionable (`validarEdadesGeneralesHotel`) y un override de una
//   tarifa NO la reemplaza en silencio. Sin menores en la consulta la regla es irrelevante (`REGLA_SIN_MENORES`, nunca se aplica).
//
// El override de la fila es "todo o nada": las 4 columnas son NULL (sin
// override → sigue la cadena) o las 4 tienen valor (override completo) — el
// mismo CHECK que impone la migración 177 en SQL. La regla general de
// `hoteles` puede llegar PARCIAL (hoy `computo.ts` solo seleccionaba
// `edad_infante_max`/`edad_nino_max`, nunca los "_min") — los campos
// faltantes se normalizan con los defaults de abajo, nunca con `NaN`/`undefined`
// silencioso.
//
// Multitemporada: una estadía puede liquidar noches de VARIAS temporadas
// (`lib/calc/paquetes.ts::liquidarHotelNoches`, "mezcla temporadas" — ver el
// informe de diseño). Si las filas de `tarifa_hotel` que realmente aportaron
// noches para esa categoría/alimentación resuelven reglas de edad EFECTIVAS
// distintas entre sí, no hay una respuesta única — se falla cerrado
// (`resolverReglaEdadEstadia`), nunca se elige una arbitrariamente. La
// comparación es SIEMPRE sobre la regla YA RESUELTA (override ?? general ??
// default), nunca sobre el override crudo: dos filas donde una declara un
// override IDÉNTICO al fallback de la otra deben tratarse como "iguales",
// nunca como un cruce que bloquea la reserva.
//
// Módulo PURO (sin "use client"/"use server", sin I/O): se importa directo
// desde `node --test` y desde ambos motores.
// ─────────────────────────────────────────────────────────────────────────

/** Regla de edad COMPLETA (las 4 columnas, ya resueltas — nunca parcial). */
export type ReglaEdadTarifa = {
  infanteMin: number;
  infanteMax: number;
  ninoMin: number;
  ninoMax: number;
};

/** Override de UNA fila de `tarifa_hotel` — `null` = las 4 columnas vienen
 * NULL (sin override, sigue la cadena de fallback). Nunca un objeto con
 * algunas de las 4 presentes y otras no: eso lo impide el CHECK SQL y
 * `validarRangoReglaEdad` antes de guardar. */
export type ReglaEdadOverrideFila = ReglaEdadTarifa | null;

/** Regla general de `hoteles` — puede llegar PARCIAL (columnas no
 * seleccionadas, o legítimamente NULL en la fila). `null` = no se consultó
 * nada de `hoteles` (equivalente a objeto vacío). */
export type ReglaEdadGeneralParcial = {
  infanteMin?: number | null;
  infanteMax?: number | null;
  ninoMin?: number | null;
  ninoMax?: number | null;
} | null;

/** Defaults históricos — los mismos valores que YA usaba `computo.ts` antes
 * de esta ronda (`?? 2`/`?? 10`), con `infanteMin`/`ninoMin` completados de
 * forma compatible (nunca se leían antes; `ninoMin` nace de `infanteMax+1`,
 * no de un número fijo, para no dejar un hueco/solape con el default de
 * infante). */
/** SOLO punto de partida visual del editor de «edades propias» de una tarifa/promoción cuando una persona decide activarlas (CalculadoraEditor). NUNCA se usa
 * para resolver ni cobrar: la regla del hotel es obligatoria (O3). */
export const REGLA_EDAD_DEFAULT: ReglaEdadTarifa = { infanteMin: 0, infanteMax: 2, ninoMin: 3, ninoMax: 10 };

/** Marcador para consultas SIN menores: la regla no clasifica a nadie (clasificar cero menores no consulta umbrales). No es un dato del hotel. */
export const REGLA_SIN_MENORES: ReglaEdadTarifa = { infanteMin: 0, infanteMax: 0, ninoMin: 0, ninoMax: 0 };

/** Campos obligatorios de la configuración de edades de un hotel que acepta menores (el mínimo de infante es siempre 0 y el de niño, infante+1). */
export const CAMPOS_EDAD_HOTEL = [
  { col: "edad_infante_max", etiqueta: "Infante hasta (edad)" },
  { col: "edad_nino_max", etiqueta: "Niño hasta (edad)" },
] as const;

export type ValidacionEdadesHotel =
  | { ok: true; regla: ReglaEdadTarifa }
  | { ok: false; faltantes: string[]; invalidos: string[]; error: string };

/**
 * O-1: texto para visitantes, aliados B2B y cualquier respuesta que salga del servidor hacia un usuario externo cuando un hotel no se puede
 * cotizar con menores por su configuración interna. No nombra campos, rutas internas ni instrucciones de Producto.
 */
export const MENSAJE_EDADES_HOTEL_PUBLICO = "Este hotel no está disponible para cotizar con menores en este momento. Consulta con un asesor o cotiza solo con adultos.";

/** Mensaje accionable SOLO INTERNO (nombra campos y la ruta de Producto). Nunca debe llegar a un usuario externo: ver `lib/tarifario/detalleInterno.ts`. */
export function mensajeEdadesHotel(nombreHotel: string | null | undefined, faltantes: readonly string[], invalidos: readonly string[]): string {
  const quien = nombreHotel && nombreHotel.trim() ? `El hotel «${nombreHotel.trim()}»` : "Este hotel";
  const detalle = [
    faltantes.length ? `falta: ${faltantes.map((x) => `«${x}»`).join(", ")}` : "",
    invalidos.length ? `valor no válido: ${invalidos.join("; ")}` : "",
  ].filter(Boolean).join(" · ");
  return `${quien} no tiene completa la configuración de edades de infantes y niños (${detalle}), por eso no se puede cotizar ni reservar con menores. ` +
    "Producto debe completarla en Producto → Hoteles → Configuración del hotel (campos «Infante hasta» y «Niño hasta»); mientras tanto se puede cotizar solo con adultos.";
}

/** Mensaje al GUARDAR/PUBLICAR un hotel que acepta menores: indica exactamente qué falta o es inválido y cómo salir (completarlo o marcar el hotel como Adults Only). */
export function mensajeEdadesAlGuardar(faltantes: readonly string[], invalidos: readonly string[]): string {
  const detalle = [
    faltantes.length ? `falta: ${faltantes.map((x) => `«${x}»`).join(", ")}` : "",
    invalidos.length ? `valor no válido: ${invalidos.join("; ")}` : "",
  ].filter(Boolean).join(" · ");
  return `Completa la configuración de edades del hotel antes de guardarlo (${detalle}). Todo hotel que acepta menores necesita «Infante hasta» y «Niño hasta» (enteros, infante menor que niño, máximo 17). Si no admite menores, márcalo como Adults Only.`;
}

/**
 * Valida la configuración GENERAL de edades de un hotel (obligatoria si acepta menores): `edad_infante_max` y `edad_nino_max` enteros, 0 <= infante < niño <= 17.
 * No inventa nada: si falta o es inválida devuelve el motivo. `ok` devuelve la regla completa derivada (infanteMin 0, ninoMin infante+1).
 */
export function validarEdadesGeneralesHotel(general: ReglaEdadGeneralParcial, nombreHotel?: string | null): ValidacionEdadesHotel {
  const inf = general?.infanteMax ?? null;
  const nino = general?.ninoMax ?? null;
  const faltantes: string[] = [];
  const invalidos: string[] = [];
  const revisar = (v: number | null, etiqueta: string) => {
    if (v == null) faltantes.push(etiqueta);
    else if (!Number.isInteger(v) || v < 0 || v > 17) invalidos.push(`«${etiqueta}» = ${v} (debe ser un entero entre 0 y 17)`);
  };
  revisar(inf, CAMPOS_EDAD_HOTEL[0].etiqueta);
  revisar(nino, CAMPOS_EDAD_HOTEL[1].etiqueta);
  if (!faltantes.length && !invalidos.length && !((inf as number) < (nino as number))) {
    invalidos.push(`«Infante hasta» (${inf}) debe ser menor que «Niño hasta» (${nino})`);
  }
  if (faltantes.length || invalidos.length) return { ok: false, faltantes, invalidos, error: mensajeEdadesHotel(nombreHotel, faltantes, invalidos) };
  return { ok: true, regla: construirReglaEdadDesdeMaximos(inf as number, nino as number) };
}

/**
 * Construye una regla de edad COMPLETA a partir de los ÚNICOS dos grados de
 * libertad reales del contrato (mismo criterio que el CHECK SQL de la
 * migración 177 y `validarRangoReglaEdad`): `infanteMin` es SIEMPRE 0 y
 * `ninoMin` SIEMPRE `infanteMax + 1` (nunca un hueco ni un solape) — el
 * operador nunca los escribe a mano. Única fuente de esta derivación:
 * `CalculadoraEditor.tsx` (edades propias de base/promoción) la usa en cada
 * cambio de `infanteMax`/`ninoMax`, así el objeto que se envía a
 * `DubaiParams` siempre trae los 4 valores completos y consistentes.
 */
export function construirReglaEdadDesdeMaximos(infanteMax: number, ninoMax: number): ReglaEdadTarifa {
  return { infanteMin: 0, infanteMax, ninoMin: infanteMax + 1, ninoMax };
}

/** Resuelve la regla EFECTIVA de una sola fila: override de la fila si existe (completo, nunca parcial); si no, la regla general del hotel YA validada
 * (`validarEdadesGeneralesHotel`) — nunca un valor inventado. */
export function resolverReglaEdadEfectiva(
  overrideFila: ReglaEdadOverrideFila,
  generalValidada: ReglaEdadTarifa
): ReglaEdadTarifa {
  return overrideFila ?? generalValidada;
}

/** Compara dos reglas YA RESUELTAS — nunca overrides crudos. */
export function reglasEdadIguales(a: ReglaEdadTarifa, b: ReglaEdadTarifa): boolean {
  return a.infanteMin === b.infanteMin && a.infanteMax === b.infanteMax && a.ninoMin === b.ninoMin && a.ninoMax === b.ninoMax;
}

/**
 * Valida los rangos de una regla de edad — MISMAS reglas que el CHECK SQL
 * de la migración 177 (propuesta, no aplicada): `infanteMin` debe ser
 * EXACTAMENTE 0, `ninoMin` debe ser EXACTAMENTE `infanteMax + 1` (nunca un
 * hueco ni un solape — es lo que colapsa "rangos discontinuos/solapados" a
 * un caso estructuralmente imposible), y `ninoMax` no puede superar 17.
 * `null` = válida; string = mensaje de rechazo.
 */
export function validarRangoReglaEdad(r: ReglaEdadTarifa): string | null {
  if (!Number.isInteger(r.infanteMin) || r.infanteMin !== 0) {
    return `"Edad mínima de infante" debe ser exactamente 0 (recibido: ${r.infanteMin}).`;
  }
  if (!Number.isInteger(r.infanteMax) || r.infanteMax < 0) {
    return `"Edad máxima de infante" debe ser un entero >= 0 (recibido: ${r.infanteMax}).`;
  }
  if (!Number.isInteger(r.ninoMin) || r.ninoMin !== r.infanteMax + 1) {
    return `"Edad mínima de niño" debe ser exactamente "edad máxima de infante" + 1 (esperado ${r.infanteMax + 1}, recibido ${r.ninoMin}).`;
  }
  if (!Number.isInteger(r.ninoMax) || r.ninoMax < r.ninoMin) {
    return `"Edad máxima de niño" debe ser un entero >= "edad mínima de niño" (${r.ninoMin}) (recibido: ${r.ninoMax}).`;
  }
  if (r.ninoMax > 17) {
    return `"Edad máxima de niño" no puede ser mayor a 17 (recibido: ${r.ninoMax}).`;
  }
  return null;
}

/** Una fila de `tarifa_hotel` que aportó noches/precio a la estadía, con su
 * temporada (para el mensaje de error) y su override (o `null`). */
export type FilaConTemporadaParaEdad = { temporada: string; overrideFila: ReglaEdadOverrideFila };

export type ResultadoReglaEdadEstadia =
  | { ok: true; regla: ReglaEdadTarifa }
  | { ok: false; error: string; temporadas: string[]; codigo?: "edades_hotel_incompletas"; faltantes?: string[]; invalidos?: string[] };

function falloEdadesHotel(g: Extract<ValidacionEdadesHotel, { ok: false }>): Extract<ResultadoReglaEdadEstadia, { ok: false }> {
  return { ok: false, temporadas: [], error: g.error, codigo: "edades_hotel_incompletas", faltantes: g.faltantes, invalidos: g.invalidos };
}

/**
 * Resuelve la regla de edad de una estadía completa a partir de TODAS las
 * filas de `tarifa_hotel` que realmente aportaron noches/precio (nunca se
 * vuelve a consultar nada acá — las filas ya deben venir resueltas por el
 * llamador, que es quien liquidó la estadía noche a noche). Si todas
 * resuelven a la MISMA regla efectiva, esa es la de la estadía. Si alguna
 * difiere, falla cerrado — nunca se elige una arbitrariamente.
 */
export function resolverReglaEdadEstadia(
  filas: FilaConTemporadaParaEdad[],
  general: ReglaEdadGeneralParcial
): ResultadoReglaEdadEstadia {
  // La configuración del hotel es obligatoria aunque una tarifa traiga override: el override no se usa para inventar la del hotel.
  const g = validarEdadesGeneralesHotel(general);
  if (!g.ok) return falloEdadesHotel(g);
  if (filas.length === 0) return { ok: true, regla: g.regla };
  const resueltas = filas.map((f) => ({ temporada: f.temporada, regla: resolverReglaEdadEfectiva(f.overrideFila, g.regla) }));
  const primera = resueltas[0].regla;
  const hayDistinta = resueltas.some((r) => !reglasEdadIguales(r.regla, primera));
  if (hayDistinta) {
    const temporadas = [...new Set(resueltas.map((r) => r.temporada))].sort();
    return {
      ok: false,
      temporadas,
      error:
        `Esta estadía cruza temporadas con reglas de edad de niño/infante distintas (${temporadas.join(", ")}) — ` +
        "no se puede clasificar automáticamente a los menores. Ajusta las fechas para que no crucen temporadas con " +
        "reglas de edad distintas, o iguala la configuración de edades de esas temporadas/promociones antes de recotizar.",
    };
  }
  return { ok: true, regla: primera };
}

/** Fila CRUDA de `tarifa_hotel` (o un subconjunto ya cargado de ella) con lo
 * mínimo necesario para resolver su regla de edad: identidad
 * (categoría/régimen/temporada) + las 4 columnas de override (migración 177).
 * `tipo_habitacion`/`alimentacion` opcionales SOLO cuando el llamador ya
 * filtró la consulta por esa categoría/régimen a nivel SQL (ej. `.eq(...)`) —
 * aun así se recomienda seleccionarlas siempre: sin ellas, el emparejamiento
 * por categoría/régimen de `resolverReglaEdadEstadiaSegura` no puede
 * confirmar que la fila es la correcta y la tratará como no-coincidente. */
export type FilaTarifaHotelEdadCruda = {
  tipo_habitacion?: string | null;
  alimentacion?: string | null;
  temporada: string | null;
  edad_infante_min: number | null;
  edad_infante_max: number | null;
  edad_nino_min: number | null;
  edad_nino_max: number | null;
  /** #43/#60: grupo de días de la fila (null/ausente = todos los días). */
  grupo_id?: string | null;
};

/**
 * Resuelve la regla de edad efectiva de una estadía a partir de filas CRUDAS
 * de `tarifa_hotel` YA CARGADAS (nunca dispara una consulta nueva — ni acá ni
 * en el llamador, que debe reusar datos ya en memoria) + el conjunto de
 * nombres de temporada que el liquidador afirma haber usado para la
 * categoría/régimen/acomodaciones pedidas (`temporadasUsadas`).
 *
 * FALLA CERRADO — nunca cae al fallback general por accidente — si:
 *  - `temporadasUsadas` no está vacío pero no hay ninguna fila
 *    categoría+régimen+temporada que calce (fila que el liquidador afirmó
 *    usar pero no existe en el catálogo ya cargado — desincronización real);
 *  - hay MÁS DE UNA fila para la misma categoría+régimen+temporada
 *    (configuración ambigua/duplicada);
 *  - una fila trae un override PARCIAL (alguna de las 4 columnas en NULL y
 *    otra no) — defensivo, pese a que el CHECK SQL de la migración 177 debería
 *    impedirlo, nunca se asume 0 en el campo faltante;
 *  - las reglas efectivas de las distintas temporadas usadas no coinciden
 *    entre sí (delega en `resolverReglaEdadEstadia`).
 *
 * El fallback general (la regla VALIDADA del hotel, nunca un valor inventado) SOLO se aplica cuando
 * `temporadasUsadas` está vacío, o cuando la fila usada existe (única) y sus
 * 4 columnas de override son NULL.
 */
export function resolverReglaEdadEstadiaSegura(args: {
  filas: FilaTarifaHotelEdadCruda[];
  categoria: string;
  regimen: string;
  temporadasUsadas: Iterable<string>;
  general: ReglaEdadGeneralParcial;
}): ResultadoReglaEdadEstadia {
  const temporadas = [...new Set(args.temporadasUsadas)];
  const g = validarEdadesGeneralesHotel(args.general);
  if (!g.ok) return falloEdadesHotel(g);
  if (temporadas.length === 0) return { ok: true, regla: g.regla };

  const filasEdad: FilaConTemporadaParaEdad[] = [];
  for (const temp of temporadas) {
    const candidatas = args.filas.filter(
      (f) =>
        (f.tipo_habitacion ?? "") === args.categoria &&
        (f.alimentacion ?? "") === args.regimen &&
        f.temporada === temp
    );
    if (candidatas.length === 0) {
      return {
        ok: false,
        temporadas: [temp],
        error:
          `No se encontró la fila de tarifa (${args.categoria} / ${args.regimen} / ${temp}) que el sistema usó para ` +
          "liquidar esta estadía — no se puede determinar con certeza la regla de edad de niño/infante. Revisa el " +
          "catálogo (tarifa_hotel) antes de continuar.",
      };
    }
    // #43/#60: varias filas de la misma vigencia son válidas SOLO si cada una es de un grupo
    // de días distinto (filas por grupo). Duplicados «todos los días» o mezclas: error, como antes.
    const grupos = candidatas.map((f) => f.grupo_id ?? null);
    const porGrupo = candidatas.length > 1 && grupos.every((g) => g != null) && new Set(grupos).size === grupos.length;
    if (candidatas.length > 1 && !porGrupo) {
      return {
        ok: false,
        temporadas: [temp],
        error:
          `Hay ${candidatas.length} filas de tarifa cargadas para (${args.categoria} / ${args.regimen} / ${temp}) — ` +
          "configuración ambigua (temporada duplicada), corrígela en el catálogo antes de continuar.",
      };
    }
    const delaVigencia: FilaConTemporadaParaEdad[] = [];
    for (const f of candidatas) {
      const valores = [f.edad_infante_min, f.edad_infante_max, f.edad_nino_min, f.edad_nino_max];
      const algunoConValor = valores.some((v) => v != null);
      const todosConValor = valores.every((v) => v != null);
      if (algunoConValor && !todosConValor) {
        return {
          ok: false,
          temporadas: [temp],
          error:
            `La tarifa (${args.categoria} / ${args.regimen} / ${temp}) trae un override de edad incompleto (algunas de ` +
            "las 4 columnas en NULL y otras no) — dato corrupto pese a la restricción de la base de datos, corrígelo " +
            "antes de continuar.",
        };
      }
      delaVigencia.push({
        temporada: temp,
        overrideFila: todosConValor
          ? {
              infanteMin: f.edad_infante_min as number, infanteMax: f.edad_infante_max as number,
              ninoMin: f.edad_nino_min as number, ninoMax: f.edad_nino_max as number,
            }
          : null,
      });
    }
    if (porGrupo && !resolverReglaEdadEstadia(delaVigencia, args.general).ok) {
      return {
        ok: false,
        temporadas: [temp],
        error:
          `Las tarifas por grupo de días de (${args.categoria} / ${args.regimen} / ${temp}) tienen reglas de edad de ` +
          "niño/infante distintas — no se puede clasificar automáticamente a los menores. Iguala la configuración de " +
          "edades de esos grupos antes de continuar.",
      };
    }
    filasEdad.push(...delaVigencia);
  }
  return resolverReglaEdadEstadia(filasEdad, args.general);
}
