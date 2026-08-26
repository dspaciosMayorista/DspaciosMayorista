import { randomUUID } from "node:crypto";

// Deliberadamente SIN `import "server-only"` (a diferencia de
// lib/contrato/contexto.ts/lib/tenant.server.ts): este módulo no toca
// sesión, cookies ni ninguna llave — solo genera un UUID (`node:crypto`) y
// escribe a `console.log`/`console.error`. Si por error se importara en un
// componente cliente, el bundler fallaría igual al no poder resolver
// `node:crypto` en el navegador (misma protección en la práctica), y a
// cambio queda IMPORTABLE por `node --test` (`pruebas/medicion.test.ts`)
// para probar con ejecución real, no solo grep, que el `flujo_id` es
// aleatorio y consistente y que la clasificación de resultado funciona.
//
// ── Medición server-side por etapas (sin PII) ───────────────────────────────
// Diagnóstico de la demora del botón "Generar contrato"/"Generar reserva"
// (revisión posterior al PR #274: `contextoCrearContrato()` duplicaba
// `auth.getUser()` y la consulta de `usuarios` llamando a `getTenant()`; una
// segunda revisión posterior detectó que la medición original no tenía
// identificador por ejecución, no cubría el tiempo TOTAL de la Server Action,
// y varias etapas reportaban "ok" aunque una consulta hubiera fallado). Cada
// línea de log deja: el nombre del FLUJO (`crear_contrato`/`reservar_
// programa`), un `flujo_id` aleatorio por ejecución (para poder agrupar las
// etapas de una reserva concreta cuando hay varias en simultáneo), el nombre
// estable de la ETAPA, la duración en milisegundos y un resultado técnico
// saneado.
//
// ⚠️ NUNCA registrar aquí: numero_contrato, documentos, nombres, teléfonos,
// correos, el payload de la Server Action, mensajes de error crudos (pueden
// traer datos de negocio) ni ningún secreto. `flujo_id` es un UUID aleatorio
// generado server-side (`crypto.randomUUID()`) — NO es el numero_contrato ni
// ningún identificador de negocio. `etapa`/`flujo` son identificadores FIJOS
// elegidos en el código, nunca un valor dinámico del request.
export type ResultadoEtapa = "ok" | "error" | "parcial" | "rechazado" | (string & {});

// UUID v4 aleatorio, sin relación con ningún dato de negocio (no es
// numero_contrato, no es el id de ningún usuario/cliente).
export function generarFlujoId(): string {
  return randomUUID();
}

function formatearLinea(flujo: string, flujoId: string, etapa: string, duracionMs: number, resultado: ResultadoEtapa): string {
  return `[medicion] flujo=${flujo} flujo_id=${flujoId} etapa=${etapa} duracion_ms=${duracionMs} resultado=${resultado}`;
}

export type Medidor = <T>(
  etapa: string,
  // `PromiseLike`, no `Promise`: los query builders de Supabase (ej.
  // `sb.from(...).select(...).maybeSingle()`) son "thenables" pero no
  // Promise reales (no implementan `catch`/`finally`), así que exigir
  // `Promise<T>` aquí rompería la inferencia de tipos en esos casos.
  fn: () => PromiseLike<T>,
  resultadoDe?: (valor: T) => ResultadoEtapa
) => Promise<T>;

// Fábrica de medidor ligado a un flujo+flujo_id concreto — evita repetir
// ambos valores en cada llamada. Úsese UNA vez por ejecución de la Server
// Action (`crearMedidor("crear_contrato", flujoId)`) y reutilizar el mismo
// medidor para todas las etapas de esa ejecución.
export function crearMedidor(flujo: string, flujoId: string): Medidor {
  return async function medir<T>(
    etapa: string,
    fn: () => PromiseLike<T>,
    resultadoDe?: (valor: T) => ResultadoEtapa
  ): Promise<T> {
    const inicio = performance.now();
    try {
      const valor = await fn();
      const duracionMs = Math.round(performance.now() - inicio);
      const resultado = resultadoDe ? resultadoDe(valor) : "ok";
      console.log(formatearLinea(flujo, flujoId, etapa, duracionMs, resultado));
      return valor;
    } catch (err) {
      const duracionMs = Math.round(performance.now() - inicio);
      console.log(formatearLinea(flujo, flujoId, etapa, duracionMs, "error"));
      throw err;
    }
  };
}

// Para etapas que mezclan varios pasos con retorno anticipado propio (no se
// pueden envolver limpiamente en una sola función async sin tocar ese
// control de flujo) — mismo formato de línea que `crearMedidor`, pero el
// caller mide la duración con `performance.now()` y decide el resultado él
// mismo (ok/error/parcial), en vez de que se infiera automáticamente.
export function registrarEtapa(flujo: string, flujoId: string, etapa: string, duracionMs: number, resultado: ResultadoEtapa): void {
  console.log(formatearLinea(flujo, flujoId, etapa, duracionMs, resultado));
}
