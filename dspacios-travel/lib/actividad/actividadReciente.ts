// #11 — Presencia RECIENTE observada del personal interno y de los aliados B2B (solo superadmin). Módulo PURO: clasifica y rotula lo que devuelve `fn_actividad_reciente` (migración 343).
//
// Qué se puede afirmar y qué no:
//   · «Actividad observada» = el último instante en que el navegador de la persona, con la pestaña VISIBLE y uso real (carga, clic o tecla), avisó a la aplicación (`registrar_presencia`).
//     El navegador avisa como mucho cada 5 min y la base escribe como mucho cada 4 min por persona. NO hay temporizador ni sondeo: sin uso, la observación simplemente envejece.
//   · VENTANA DE FRESCURA = 10 minutos (el doble del intervalo de aviso): una observación más reciente se rotula «reciente». Es evidencia de uso reciente, NO prueba de una conexión continua
//     (la persona pudo cerrar la pestaña un minuto después de la última observación).
//   · «Último ingreso» (inicio de sesión) y «último cambio guardado» (auditoría) se muestran aparte como contexto: no son presencia.
//   · Las horas se muestran en America/Bogota con fecha y hora; el instante almacenado no se modifica.
export const INTERVALO_PING_MIN = 5;
export const UMBRAL_RECIENTE_MIN = 10;

export type NivelPresencia = "reciente" | "hoy" | "antes" | "ninguna";

export type FilaActividad = {
  usuario_id: string; nombre: string | null; email: string | null; rol: string; tenant: string | null; aliado: string | null;
  visto_en: string | null; ultima_actividad: string | null; eventos_ventana: number; eventos_24h: number; ultimo_ingreso: string | null; total: number;
};

const TZ = "America/Bogota";
const fechaBogota = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: TZ });

export const esAliado = (rol: string | null | undefined): boolean => rol === "agencia" || rol === "freelance";

export function minutosDesde(ahora: Date, iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.floor((ahora.getTime() - t) / 60_000));
}

/** Nivel de la ÚLTIMA presencia observada. Sin dato = `ninguna` («todavía no se ha observado»; nunca se supone actividad ni ausencia). */
export function nivelPresencia(ahora: Date, vistoEn: string | null | undefined): NivelPresencia {
  const min = minutosDesde(ahora, vistoEn);
  if (min === null) return "ninguna";
  if (min <= UMBRAL_RECIENTE_MIN) return "reciente";
  return fechaBogota(new Date(vistoEn!)) === fechaBogota(ahora) ? "hoy" : "antes";
}

export function etiquetaNivel(n: NivelPresencia): string {
  switch (n) {
    case "reciente": return `Actividad observada en los últimos ${UMBRAL_RECIENTE_MIN} min`;
    case "hoy": return "Actividad observada hoy";
    case "antes": return "Actividad observada antes de hoy";
    default: return "Sin actividad observada todavía";
  }
}

/** «hace 12 min», «hace 3 h», «hace 2 días». */
export function haceTexto(ahora: Date, iso: string | null | undefined): string {
  const min = minutosDesde(ahora, iso);
  if (min === null) return "—";
  if (min < 1) return "hace menos de 1 min";
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.floor(h / 24);
  return `hace ${d} ${d === 1 ? "día" : "días"}`;
}

/** «25/11/2026 09:32» en hora de Bogotá. */
export function fechaHoraBogota(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "—";
  const p = new Intl.DateTimeFormat("es-CO", { timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(d).reduce<Record<string, string>>((m, x) => { m[x.type] = x.value; return m; }, {});
  return `${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}`;
}

export type ResumenPresencia = { recientesPersonal: number; recientesAliados: number; hoy: number; sinObservacion: number; mostrados: number; total: number };

export function resumenPresencia(filas: readonly FilaActividad[], ahora: Date): ResumenPresencia {
  let recientesPersonal = 0, recientesAliados = 0, hoy = 0, sinObservacion = 0;
  for (const f of filas) {
    const n = nivelPresencia(ahora, f.visto_en);
    if (n === "reciente") { if (esAliado(f.rol)) recientesAliados++; else recientesPersonal++; }
    else if (n === "hoy") hoy++;
    else if (n === "ninguna") sinObservacion++;
  }
  return { recientesPersonal, recientesAliados, hoy, sinObservacion, mostrados: filas.length, total: filas.length ? Math.max(filas[0].total, filas.length) : 0 };
}
