// Presentación: cada infante debe aparecer como renglón SUBORDINADO
// inmediatamente debajo de la fila de su adulto responsable — nunca en una
// tabla o sección aparte — en las dos superficies de vuelos:
//   1) app/(dashboard)/dashboard/vuelos/[id]/page.tsx (detalle de un bloqueo)
//   2) app/(dashboard)/dashboard/vuelos/pasajeros/page.tsx (listado global,
//      vía su Client Component PasajerosBuscador.tsx)
//
// La agrupación es EXCLUSIVAMENTE por `responsable_id` (nunca por nombre ni
// coincidencia parcial — ver pruebas/manifiestoInfantes.test.ts para la
// lógica pura), resuelto por lib/vuelos/manifiestoInfantes.ts a partir del
// documento (nunca el nombre) que ya trae `resolverManifiestoAutorizado`
// (lib/vuelos/contratoManual.ts, cross-tenant, PR #289 — intacto).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function leer(ruta: string): string {
  return readFileSync(new URL(`../${ruta}`, import.meta.url), "utf8");
}

const RUTA_BLOQUEO = "app/(dashboard)/dashboard/vuelos/[id]/page.tsx";
const RUTA_PASAJEROS = "app/(dashboard)/dashboard/vuelos/pasajeros/page.tsx";
const RUTA_BUSCADOR = "app/(dashboard)/dashboard/vuelos/pasajeros/PasajerosBuscador.tsx";

describe("vuelos/[id]/page.tsx — infante subordinado a su silla responsable", () => {
  const src = leer(RUTA_BLOQUEO);

  test("REQUERIDO 1/2: el renglón del infante se interpola DENTRO del mismo .map de sillas, inmediatamente después de la fila de su silla (agrupa consecutivamente si hay varios)", () => {
    // La JSX de la tabla (no la construcción de datos, que reutiliza el
    // mismo texto de patrón "(sillas ?? []).map((s) => (" para armar el
    // arreglo que recibe emparejarInfantesConSilla) — se busca a partir de
    // <tbody>.
    const inicioTbody = src.indexOf("<tbody>");
    const inicioMap = src.indexOf("(sillas ?? []).map((s) => (", inicioTbody);
    assert.ok(inicioMap > -1, "no encuentra el .map de sillas dentro de <tbody>");
    const inicioFragment = src.indexOf("<Fragment key={s.id}>", inicioMap);
    assert.ok(inicioFragment > -1 && inicioFragment - inicioMap < 50, "cada silla debe envolverse en un <Fragment key={s.id}> para poder interpolar su(s) infante(s) justo debajo, sin romper la key de React");
    const inicioInfantes = src.indexOf("infantesPorSillaId.get(s.id)", inicioFragment);
    assert.ok(inicioInfantes > -1, "no interpola infantesPorSillaId.get(s.id) dentro del mismo Fragment que la silla");
    // El .map de infantes por silla debe venir DESPUÉS del </tr> de la
    // silla (no antes) — así el infante siempre queda debajo.
    const finTrSilla = src.indexOf("</tr>", inicioFragment);
    assert.ok(finTrSilla > -1 && finTrSilla < inicioInfantes, "el renglón del infante debe venir DESPUÉS del </tr> de su silla, no antes");
  });

  test("REQUERIDO 3: el infante se agrupa por responsable_id (documento), nunca por nombre — el emparejamiento viene de emparejarInfantesConSilla, no de comparar pasajero_nombres", () => {
    assert.match(src, /emparejarInfantesConSilla\(/, "no delega en el módulo puro de agrupación por responsable");
    assert.doesNotMatch(
      src,
      /pasajero_nombres\s*===|===\s*.*pasajero_nombres/,
      "no debe comparar por pasajero_nombres para ubicar al infante — la agrupación es solo por documento del responsable"
    );
  });

  test("REQUERIDO 4: los infantes no alteran la numeración ni el conteo de sillas (conteo/totalReal siguen derivándose solo de `sillas`)", () => {
    const inicioConteo = src.indexOf("const conteo = (sillas ?? [])");
    const inicioTotal = src.indexOf("const totalReal = (sillas ?? [])");
    assert.ok(inicioConteo > -1, "conteo debe seguir derivándose de (sillas ?? [])");
    assert.ok(inicioTotal > -1, "totalReal debe seguir derivándose de (sillas ?? [])");
  });

  test("REQUERIDO 5: NO queda ninguna tabla ni sección independiente para infantes (una sola <table> en la pestaña Pasajeros, sin encabezado propio de infantes)", () => {
    const nTablas = (src.match(/<table\b/g) ?? []).length;
    assert.equal(nTablas, 1, "debe haber una única <table> — los infantes no viven en una tabla propia");
    assert.doesNotMatch(
      src,
      /Infantes de este vuelo\s*<span/,
      "ya no debe existir el encabezado JSX de la sección/tabla separada de infantes"
    );
  });

  test("el renglón del infante no tiene estado ni acciones de silla (sin SillaEstado/PasajeroAcciones/SillaContrato) y no ocupa silla (sin sillaId)", () => {
    const inicio = src.indexOf("infantesPorSillaId.get(s.id)");
    const bloque = src.slice(inicio, inicio + 700);
    assert.doesNotMatch(bloque, /SillaEstado|PasajeroAcciones|SillaContrato/, "el renglón del infante no debe incluir controles de silla");
    assert.doesNotMatch(bloque, /sillaId:/, "el renglón del infante no debe asignar sillaId");
  });

  test("REQUERIDO 6: responsable ausente en este bloqueo genera una advertencia compacta (no una tabla, no una fila normal)", () => {
    assert.match(src, /infantesSinResponsable/, "no maneja infantesSinResponsable (el resultado de emparejarInfantesConSilla)");
    const inicio = src.indexOf("infantesSinResponsable.length > 0");
    assert.ok(inicio > -1, "no renderiza la advertencia condicionada a infantesSinResponsable.length > 0");
    const bloque = src.slice(inicio, inicio + 500);
    assert.match(bloque, /TriangleAlert/, "la advertencia debe usar un ícono (lucide-react), nunca un emoji");
    assert.doesNotMatch(bloque, /<table/i, "la advertencia no debe ser una tabla");
  });

  test("mantiene intacta la solución cross-tenant del PR #289 (resolverManifiestoAutorizado sigue siendo el único punto de lectura de contrato_pasajeros/ventas)", () => {
    assert.match(src, /resolverManifiestoAutorizado\(/, "no sigue usando resolverManifiestoAutorizado");
    assert.doesNotMatch(src, /createAdminClient|SUPABASE_SERVICE_ROLE_KEY/, "no debe construir el cliente admin directamente en la página");
  });

  test("diseño compacto: el renglón del infante usa texto pequeño (text-xs) y ocupa todo el ancho de la tabla vía colSpan (se mantiene legible dentro del mismo contenedor overflow-x-auto ya usado para escritorio/móvil)", () => {
    // Ventana generosa: entre el inicio del .map de infantes y su <tr> ahora
    // cabe la resolución del enlace "Editar en contrato" (enlaceContratoEnVuelo,
    // PR del enlace cross-tenant); colSpan/text-xs viven en el mismo renglón,
    // más adelante en esa misma región.
    const inicio = src.indexOf("infantesPorSillaId.get(s.id)");
    const bloque = src.slice(inicio, inicio + 2000);
    assert.match(bloque, /colSpan=\{13\}/, "debe usar colSpan para ocupar el ancho completo de la tabla (13 columnas)");
    assert.match(bloque, /text-xs/, "el renglón del infante debe usar tipografía compacta (text-xs)");
    assert.match(src, /overflow-x-auto/, "la tabla debe seguir dentro de un contenedor con scroll horizontal para pantallas angostas");
  });
});

describe("vuelos/pasajeros/page.tsx — resolución de infante↔silla vía responsable_id (la presentación vive en PasajerosBuscador.tsx)", () => {
  const src = leer(RUTA_PASAJEROS);

  test("REQUERIDO 3: usa emparejarInfantesConSilla (responsable_id → documento), nunca compara por nombre", () => {
    assert.match(src, /emparejarInfantesConSilla\(/, "no delega en el módulo puro de agrupación por responsable");
  });

  test("cada infante lleva padreId apuntando a la fila (silla) de su responsable — es la clave que usa PasajerosBuscador para subordinarlo", () => {
    const inicio = src.indexOf("filasInfantes.push");
    const bloque = src.slice(inicio, inicio + 700);
    assert.match(bloque, /padreId:\s*base\.id/, "no asigna padreId a la fila del infante");
  });

  test("REQUERIDO 6: los infantes sin responsable ubicable se pasan aparte (advertenciasInfantes), nunca como fila normal", () => {
    assert.match(src, /sinResponsable/, "no maneja el resultado sinResponsable de emparejarInfantesConSilla");
    assert.match(src, /advertenciasInfantes=\{advertenciasInfantes\}/, "no pasa advertenciasInfantes a PasajerosBuscador");
  });
});

describe("PasajerosBuscador.tsx — renderizado subordinado (Client Component, cubre escritorio y móvil vía el mismo contenedor con scroll)", () => {
  const src = leer(RUTA_BUSCADOR);

  test("REQUERIDO 1/2: agrupa infantes por padreId (Map) y los renderiza dentro del mismo Fragment/.map que su adulto, inmediatamente después de su <tr>", () => {
    assert.match(src, /infantesPorPadre/, "no construye un mapa de infantes por padreId");
    assert.match(src, /p\.esInfante\s*&&\s*!?p\.padreId|!p\.esInfante/, "no distingue adultos de infantes por esInfante/padreId al agrupar");
    const inicioMap = src.indexOf("vis.map((p) => (");
    assert.ok(inicioMap > -1, "no encuentra el .map de filas visibles");
    const inicioFragment = src.indexOf("<Fragment key={p.id}>", inicioMap);
    assert.ok(inicioFragment > -1 && inicioFragment - inicioMap < 60, "cada fila visible debe envolverse en un Fragment para interpolar sus infantes justo debajo");
    const finTr = src.indexOf("</tr>", inicioFragment);
    // Búsqueda DESPUÉS del </tr> del adulto (no del `.get(p.id)` usado más
    // arriba en el filtro de búsqueda, que es otra ocurrencia de la misma
    // llamada con otro propósito).
    const inicioInfantes = src.indexOf("infantesPorPadre.get(p.id)", finTr);
    assert.ok(inicioInfantes > -1 && finTr < inicioInfantes, "el renglón del infante debe interpolarse DESPUÉS del </tr> del adulto");
  });

  test("REQUERIDO 5: no hay una tabla ni sección propia para infantes — una sola <table>, sin columna 'Infante' aparte", () => {
    const nTablas = (src.match(/<table\b/g) ?? []).length;
    assert.equal(nTablas, 1, "debe haber una única <table>");
  });

  test("el renglón del infante no ocupa silla ni expone acciones — solo texto informativo con el ícono conector y 'No ocupa silla'", () => {
    const finTbody = src.indexOf("<tbody>");
    const inicio = src.indexOf("infantesPorPadre.get(p.id)", finTbody);
    const bloque = src.slice(inicio, inicio + 900);
    assert.match(bloque, /CornerDownRight/, "debe usar un ícono conector (lucide-react) para dejar clara la relación con el responsable — nunca un emoji");
    assert.match(bloque, /No ocupa silla/, "debe indicar explícitamente que el infante no ocupa silla");
    assert.match(bloque, /colSpan=\{10\}/, "debe ocupar el ancho completo de la tabla (10 columnas)");
  });

  test("REQUERIDO 6: advertencia compacta (no tabla) para infantes sin responsable ubicable, con ícono de alerta", () => {
    assert.match(src, /advertenciasInfantes/, "no recibe advertenciasInfantes como prop");
    const inicio = src.indexOf("advertenciasInfantes.length > 0");
    assert.ok(inicio > -1, "no condiciona la advertencia a advertenciasInfantes.length > 0");
    const bloque = src.slice(inicio, inicio + 500);
    assert.match(bloque, /TriangleAlert/, "la advertencia debe usar un ícono (lucide-react), nunca un emoji");
    assert.doesNotMatch(bloque, /<table/i, "la advertencia no debe ser una tabla");
  });

  test("REQUERIDO 4: los infantes no alteran la numeración/orden — el ordenamiento (sort) sigue aplicándose solo sobre los adultos", () => {
    const inicioVis = src.indexOf("const vis = useMemo");
    const inicioSort = src.indexOf(".sort((a, b)", inicioVis);
    assert.ok(inicioVis > -1 && inicioSort > -1, "no encuentra el .sort de la lista visible");
    // El array que se ordena debe partir de `adultos` (filas sin esInfante),
    // no de `filas` completa con infantes mezclados.
    const bloque = src.slice(inicioVis, inicioSort);
    assert.match(bloque, /return adultos/, "vis debe partir de 'adultos' (filas sin esInfante), no de la lista completa con infantes mezclados");
    assert.match(src, /const adultos = useMemo\(\(\) => filas\.filter\(\(p\) => !p\.esInfante\)/, "adultos debe excluir explícitamente las filas esInfante");
  });

  test("diseño compacto: texto pequeño (text-xs) en el renglón subordinado, dentro del mismo contenedor con scroll horizontal ya usado por la tabla", () => {
    const finTbody = src.indexOf("<tbody>");
    const inicio = src.indexOf("infantesPorPadre.get(p.id)", finTbody);
    const bloque = src.slice(inicio, inicio + 900);
    assert.match(bloque, /text-xs/, "el renglón del infante debe usar tipografía compacta");
    assert.match(src, /overflow-x-auto/, "la tabla debe seguir dentro de un contenedor con scroll horizontal para pantallas angostas");
  });
});
