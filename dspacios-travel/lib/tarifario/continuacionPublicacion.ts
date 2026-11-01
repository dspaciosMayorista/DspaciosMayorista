// ─────────────────────────────────────────────────────────────────────────────
// Continuación SIN navegador de la publicación por lotes (módulo puro). La ruta /api/cron/publicacion-tarifario la usa cuando pg_cron no está habilitado, o como red de seguridad
// (respaldo, sin cron programado) y como «empujón» inmediato tras dejar la publicación en la cola. El trabajo real lo hace `tarifario_cola_correr` en la base: un solo trabajador por
// publicación (SKIP LOCKED), reintentos con espera creciente y tope de intentos; aquí solo se le da tiempo de ejecución y, si queda trabajo, se encadena otra invocación.
// ─────────────────────────────────────────────────────────────────────────────

export type RpcAdmin = (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }>;

/** Presupuesto de UNA invocación de la ruta (su `maxDuration` es 60 s). Cada llamada al trabajador usa ≤ 12 s de pasos (+ el último paso, ≤ 5,5 s medido). */
export const PRESUPUESTO_RUTA_MS = 48_000;
export const PRESUPUESTO_LLAMADA_MS = 12_000;
/** Cuánto puede tardar la llamada más larga (presupuesto de pasos + último paso + red). */
export const PEOR_LLAMADA_MS = 20_000;
/** Tope de invocaciones encadenadas (≈ 48 s cada una): defensa contra una cadena infinita si la cola nunca se vacía. */
export const MAX_CADENA = 60;
export const ESPERA_SIN_TRABAJO_MS = 5_000;

export type ResumenCola = { llamadas: number; pasos: number; enCola: number; ultimo: string | null; error: string | null };

export async function correrCola(rpc: RpcAdmin, op: { reloj?: () => number; dormir?: (ms: number) => Promise<void>; presupuestoMs?: number } = {}): Promise<ResumenCola> {
  const reloj = op.reloj ?? (() => Date.now());
  const dormir = op.dormir ?? ((ms: number) => new Promise<void>((ok) => setTimeout(ok, ms)));
  const limite = reloj() + (op.presupuestoMs ?? PRESUPUESTO_RUTA_MS);
  const r: ResumenCola = { llamadas: 0, pasos: 0, enCola: 0, ultimo: null, error: null };
  while (reloj() + PEOR_LLAMADA_MS <= limite) {
    const { data, error } = await rpc("tarifario_cola_correr", { p_presupuesto_ms: PRESUPUESTO_LLAMADA_MS });
    r.llamadas++;
    if (error) { r.error = error.message; break; }
    const j = (data ?? {}) as { pasos?: number; ultimo?: string | null; en_cola?: number };
    r.pasos += Number(j.pasos) || 0; r.ultimo = j.ultimo ?? null; r.enCola = Number(j.en_cola) || 0;
    if (r.enCola === 0) break;
    // Con trabajo en la cola pero nada vencido (esperando su reintento): se espera un poco en vez de girar en vacío.
    if (!(Number(j.pasos) > 0)) await dormir(ESPERA_SIN_TRABAJO_MS);
  }
  return r;
}

/** ¿Hay que encadenar otra invocación? Solo si queda trabajo, no hubo error y no se alcanzó el tope de la cadena. */
export function debeEncadenar(r: ResumenCola, cadena: number): boolean {
  return !r.error && r.enCola > 0 && cadena < MAX_CADENA;
}

export function cadenaDe(valor: string | null): number {
  const n = Number(valor);
  return Number.isInteger(n) && n >= 0 && n < 1000 ? n : 0;
}

/** URL pública de la ruta (el mismo criterio que usa app/layout.tsx para el sitio). */
export function urlRuta(env: Record<string, string | undefined> = process.env): string {
  const base = env.NEXT_PUBLIC_SITE_URL || (env.VERCEL_URL ? `https://${env.VERCEL_URL}` : "http://localhost:3000");
  return `${base.replace(/\/+$/, "")}/api/cron/publicacion-tarifario`;
}
