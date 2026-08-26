import "server-only";

// ── Medición server-side por etapas (sin PII) ───────────────────────────────
// Diagnóstico de la demora del botón "Reservar"/"Generar contrato" (revisión
// posterior al PR #274: `contextoCrearContrato()` duplicaba `auth.getUser()`
// y la consulta de `usuarios` llamando a `getTenant()`). Este helper deja un
// rastro liviano en los logs del servidor (Vercel) por etapa: SOLO nombre
// estable de la etapa, duración en milisegundos y un resultado técnico
// saneado ("ok" | "error" | el valor que indique el caller vía `resultadoDe`).
//
// ⚠️ NUNCA registrar aquí: documentos, nombres, teléfonos, correos, el
// payload de la Server Action, mensajes de error crudos (pueden traer datos
// de negocio) ni ningún secreto. `etapa` es un identificador fijo elegido en
// el código, nunca un valor dinámico del request.
type ResultadoEtapa = "ok" | "error" | (string & {});

export async function medirEtapa<T>(
  etapa: string,
  // `PromiseLike`, no `Promise`: los query builders de Supabase (ej.
  // `sb.from(...).select(...).maybeSingle()`) son "thenables" pero no
  // Promise reales (no implementan `catch`/`finally`), así que exigir
  // `Promise<T>` aquí rompería la inferencia de tipos en esos casos.
  fn: () => PromiseLike<T>,
  resultadoDe?: (valor: T) => ResultadoEtapa
): Promise<T> {
  const inicio = performance.now();
  try {
    const valor = await fn();
    const duracionMs = Math.round(performance.now() - inicio);
    const resultado = resultadoDe ? resultadoDe(valor) : "ok";
    console.log(`[medicion] etapa=${etapa} duracion_ms=${duracionMs} resultado=${resultado}`);
    return valor;
  } catch (err) {
    const duracionMs = Math.round(performance.now() - inicio);
    console.log(`[medicion] etapa=${etapa} duracion_ms=${duracionMs} resultado=error`);
    throw err;
  }
}
