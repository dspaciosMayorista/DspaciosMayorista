// ─────────────────────────────────────────────────────────────────────────
// Medición por etapas de `generarTarifario` — módulo PURO (sin Supabase ni Next).
//
// Solo diagnóstico: no decide nada ni cambia el cálculo o la publicación. Produce UNA línea de log por intento con: paquete, generación, resultado, etapa
// (la que falló, o la última si terminó), cuánto tardó cada etapa y cuántas filas se calcularon. Sin SQL, sin texto de Postgres, sin datos de personas ni
// secretos: solo números, nombres fijos de etapa y el id del paquete.
//
// Import relativo/sin alias: se prueba directo con `node --test`.
// ─────────────────────────────────────────────────────────────────────────

export type ResultadoGeneracion = "ok" | "descartado" | "fallo_negocio" | "fallo_tecnico" | "timeout";

/** SQLSTATE 57014 (query_canceled) o el texto de statement_timeout / lock_timeout. Acepta el error de PostgREST o solo su mensaje. */
export function esTimeoutPostgres(e: unknown): boolean {
  if (typeof e === "string") return /statement timeout|lock timeout|57014/i.test(e);
  if (typeof e === "object" && e !== null) {
    const o = e as { code?: unknown; message?: unknown };
    if (o.code === "57014" || o.code === "55P03") return true;
    if (typeof o.message === "string") return /statement timeout|lock timeout/i.test(o.message);
  }
  return false;
}

/** Cronómetro de etapas: `etapa(nombre)` cierra la anterior y abre otra; `actual()` da la etapa en curso y cuánto lleva en ella. */
export function crearCronometro(ahora: () => number = Date.now) {
  const inicio = ahora();
  let nombre = "inicio";
  let desde = inicio;
  const cerradas: { etapa: string; ms: number }[] = [];
  return {
    etapa(siguiente: string) {
      const t = ahora();
      cerradas.push({ etapa: nombre, ms: t - desde });
      nombre = siguiente;
      desde = t;
    },
    actual() {
      const t = ahora();
      return { etapa: nombre, msEtapa: t - desde, msTotal: t - inicio };
    },
    /** Etapas ya cerradas como `nombre=ms,…` (la etapa en curso va aparte, en `actual()`). */
    cerradasTexto() {
      return cerradas.map((c) => `${c.etapa}=${c.ms}ms`).join(",");
    },
  };
}

export type Cronometro = ReturnType<typeof crearCronometro>;

export type FilasPorModulo = Record<string, number>;

/** Cuenta filas por módulo (`bloqueo`, `servicios`, …) sin leer ningún otro campo de la fila. */
export function contarPorModulo(filas: readonly { modulo?: unknown }[]): FilasPorModulo {
  const out: FilasPorModulo = {};
  for (const f of filas) {
    const m = typeof f.modulo === "string" && /^[a-z_]{1,32}$/.test(f.modulo) ? f.modulo : "otro";
    out[m] = (out[m] ?? 0) + 1;
  }
  return out;
}

/** Línea única y estable (clave=valor) para copiar de Vercel Logs. */
export function lineaMedicionGeneracion(d: {
  paqueteId: number;
  generacion: number | null;
  resultado: ResultadoGeneracion;
  etapa: string;
  msEtapa: number;
  msTotal: number;
  etapasCerradas: string;
  filas: number | null;
  filasPorModulo: FilasPorModulo | null;
}): string {
  const modulos = d.filasPorModulo
    ? Object.entries(d.filasPorModulo).map(([k, v]) => `${k}:${v}`).join(",")
    : "?";
  return [
    "generarTarifario: medicion",
    `paquete_id=${d.paqueteId}`,
    `generacion=${d.generacion ?? "?"}`,
    `resultado=${d.resultado}`,
    `etapa=${d.etapa}`,
    `ms_etapa=${d.msEtapa}`,
    `ms_total=${d.msTotal}`,
    `filas_calculadas=${d.filas ?? "?"}`,
    `filas_por_modulo=[${modulos}]`,
    `etapas_previas=[${d.etapasCerradas}]`,
  ].join(" ");
}
