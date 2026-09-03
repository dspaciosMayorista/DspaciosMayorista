// ─────────────────────────────────────────────────────────────────────────
// Lógica PURA del guard de espejo de la migración 164 (R1, Commit 7).
//
// Compartida entre dos consumidores que deben tomar EXACTAMENTE la misma
// decisión:
//   1. test_164_espejo.sh (vía verificar_espejo_cli.mjs) — contra Postgres
//      real (Docker) y el texto real de la migración 164.
//   2. pruebas/espejo164.test.ts — controles negativos reproducibles con
//      fixtures sintéticos, sin Docker ni base de datos.
//
// Corrige el falso positivo original: `"".includes("")` es `true` en
// JavaScript, así que una extracción vacía/fallida (prosrc NULL/"" o el
// bloque de la migración no encontrado) reportaba "OK" sin comparar nada de
// verdad. Aquí CADA precondición se valida explícitamente antes de comparar.
// ─────────────────────────────────────────────────────────────────────────

// Extrae, de forma independiente, el cuerpo (`$$ ... $$`) de
// `create or replace function public.<nombre>(` en el texto REAL de la
// migración 164. No asume que el bloque exista: si cualquier ancla falla,
// devuelve `{ ok: false, motivo }` en vez de una cadena vacía silenciosa.
export function extraerCuerpoMigracion(migSrc, nombre) {
  const marca = `create or replace function public.${nombre}(`;
  const inicioDDL = migSrc.indexOf(marca);
  if (inicioDDL === -1) {
    return { ok: false, motivo: `no se encontró "${marca}" en la migración (extracción del bloque falló)` };
  }
  const abre = migSrc.indexOf("$$", inicioDDL);
  if (abre === -1) {
    return { ok: false, motivo: "no se encontró el delimitador $$ de apertura del cuerpo en la migración" };
  }
  const cierra = migSrc.indexOf("$$", abre + 2);
  if (cierra === -1) {
    return { ok: false, motivo: "no se encontró el delimitador $$ de cierre del cuerpo en la migración" };
  }
  const cuerpo = migSrc.slice(abre + 2, cierra);
  if (cuerpo.trim() === "") {
    return { ok: false, motivo: "el bloque extraído de la migración quedó vacío" };
  }
  return { ok: true, cuerpo };
}

// Decide el veredicto de UNA función espejada, cubriendo explícitamente los
// 6 modos de falla pedidos:
//   1. la función esperada no existe            -> cnt=0, cntCualquierFirma=0
//   2. la firma no coincide                      -> cnt=0, cntCualquierFirma>0
//   3. prosrc es NULL o vacío                     -> prosrc == null/""
//   4. más o menos de una función                 -> cnt !== 1
//   5. el cuerpo no está realmente contenido       -> difiere tras extraer
//   6. la extracción de la migración no encuentra  -> extraerCuerpoMigracion falla
//      el bloque esperado
export function verificarEspejo({ nombre, args, cnt, cntCualquierFirma, prosrc, migSrc }) {
  if (!Number.isInteger(cnt) || cnt !== 1) {
    if (cntCualquierFirma === 0) {
      return { ok: false, motivo: `${nombre}: la función NO EXISTE en el esquema de prueba` };
    }
    if (cnt === 0) {
      return {
        ok: false,
        motivo: `${nombre}: existe(n) ${cntCualquierFirma} función(es) con ese nombre pero NINGUNA con la firma exacta esperada (${args})`,
      };
    }
    return {
      ok: false,
      motivo: `${nombre}(${args}): se esperaba EXACTAMENTE 1 función con esa firma, se obtuvieron ${cnt} (overload inesperado)`,
    };
  }

  if (prosrc == null || String(prosrc).trim() === "") {
    return { ok: false, motivo: `${nombre}(${args}): prosrc está NULL o vacío en la BD — no hay nada que comparar` };
  }

  const extraccion = extraerCuerpoMigracion(migSrc, nombre);
  if (!extraccion.ok) {
    return { ok: false, motivo: `${nombre}: ${extraccion.motivo}` };
  }

  if (extraccion.cuerpo.trim() !== String(prosrc).trim()) {
    return { ok: false, motivo: `${nombre}: el cuerpo vivo (prosrc) DIFIERE del texto real de la migración 164` };
  }

  return { ok: true, motivo: `${nombre}: el cuerpo vivo es idéntico, VERBATIM, al bloque real de la migración 164` };
}
