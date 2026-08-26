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

// ── Registro seguro de errores técnicos (revisión posterior — corrección de
// observabilidad, ronda 2) ───────────────────────────────────────────────────
// Antes de esta ronda, varios call sites de `crearContrato()`/
// `reservarPrograma()` pasaban `error.message`/`asiento.error`/`e.message`/
// `String(e)` (o el objeto de error de Supabase/PostgREST directo) a
// `console.error`. Aunque sea server-side, Vercel CONSERVA esos logs, y un
// mensaje de error de Postgres puede traer el valor de una fila, el nombre
// de una tabla/constraint o un dato comercial (ej. `Key (documento)=
// (123456789) already exists`, `permission denied for table ventas`,
// `Failing row contains (...)`). Este es el ÚNICO punto autorizado para
// mandar detalle técnico a `console.error` dentro de esos dos flujos — nunca
// imprime `message`/`details`/`hint` ni el objeto de error completo, solo:
//   - `flujo`/`flujoId`: ya controlados (no vienen del error);
//   - `etapa`/`detalle`: identificadores FIJOS que decide el caller (un
//     literal de texto en el código, nunca un valor derivado del error o
//     del request);
//   - `codigo`: el campo `.code` del error, SOLO si es un string corto y de
//     forma segura (alfanumérico/guion bajo, ≤32 caracteres) — el código de
//     error de Postgres/PostgREST (ej. "23505", "42501", "PGRST116") nunca
//     trae datos de fila, solo identifica la CLASE de fallo. Si el campo
//     `code` no existe, no es texto, o no cumple la forma segura, se
//     descarta por completo (nunca se registra tal cual).
//   - si no hay código seguro (excepción de JS sin `.code`, string suelto,
//     código con forma rara), se registra `tipo=exception` — una
//     clasificación ESTABLE, nunca `err.message`, `String(err)` ni el stack.
function codigoTecnicoSeguro(error: unknown): string | null {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string" && /^[A-Za-z0-9_]{1,32}$/.test(code)) return code;
  }
  return null;
}

export function registrarErrorTecnico(flujo: string, flujoId: string, etapa: string, detalle: string, error: unknown): void {
  const codigo = codigoTecnicoSeguro(error);
  const clasificacion = codigo ? `codigo=${codigo}` : "tipo=exception";
  console.error(`[medicion-error] flujo=${flujo} flujo_id=${flujoId} etapa=${etapa} detalle=${detalle} ${clasificacion}`);
}

// ── Estado técnico INTERNO peor-de-todos de una ejecución (revisión
// posterior — corrección de observabilidad, ronda 2) ────────────────────────
// El resultado público de `crearContrato()`/`reservarPrograma()`
// (`{ok:true}`/`{ok:false,error}`) no alcanza para clasificar el TOTAL: un
// rechazo de negocio/sesión y un fallo TÉCNICO bloqueante (RPC de
// numeración, insert de `ventas`, insert obligatorio de una tabla hija)
// ambos devuelven `{ok:false}` — antes de esta ronda el wrapper los trataba
// igual ("rechazado" para los dos). Y un contrato creado con éxito pero con
// un paso best-effort caído (CxP automáticas, bloque admin de negociado,
// comisión B2B) devolvía `{ok:true}` sin que el TOTAL reflejara la falla
// parcial. `EstadoFlujo` se muta en los puntos donde la lógica real YA sabe
// que algo técnico falló — nunca se expone al navegador (vive solo dentro de
// la Server Action, del lado del servidor) ni cambia el contrato público de
// `crearContrato()`/`reservarPrograma()`.
export type EstadoFlujo = { peor: "error" | "parcial" | null };

export function crearEstadoFlujo(): EstadoFlujo {
  return { peor: null };
}

// Solo puede subir de nivel, nunca bajar: "error" (falló un paso técnico
// REQUERIDO, o hubo una excepción real) es la peor condición y siempre gana
// sobre "parcial" (el contrato/reserva SÍ se creó, pero un paso best-effort
// falló) si ambas ocurren en la misma ejecución.
export function elevarEstadoFlujo(estado: EstadoFlujo, nivel: "error" | "parcial"): void {
  if (nivel === "error") estado.peor = "error";
  else if (estado.peor !== "error") estado.peor = "parcial";
}

// Resultado TOTAL real de la ejecución: si algo técnico se elevó (error o
// parcial), manda sobre lo que haya devuelto la lógica pública — así un
// fallo técnico bloqueante nunca queda clasificado como "rechazado", y un
// paso best-effort caído nunca queda oculto tras un "ok" a secas. Si nada se
// elevó, el resultado es exactamente el que ya calculaba el wrapper antes de
// esta ronda: "ok" si la lógica terminó en éxito, "rechazado" si terminó en
// cualquier otro `{ok:false}` (sesión, rol, o validación de negocio).
export function resultadoTotal(estado: EstadoFlujo, ok: boolean): ResultadoEtapa {
  return estado.peor ?? (ok ? "ok" : "rechazado");
}
