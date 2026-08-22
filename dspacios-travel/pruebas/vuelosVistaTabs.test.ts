import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// ─────────────────────────────────────────────────────────────────────────
// § Rediseño de /dashboard/vuelos y /dashboard/vuelos/historico en dos
// pestañas — Inventario (sillas/ocupación, BloqueosTabla) y Control Vuelos
// (modalidad/emisión/pago, ControlVuelosTabla, componente nuevo). Reemplaza
// la columna "Control" que vivía dentro de la tabla de inventario.
//
// Como el resto de guardas de wiring de este proyecto (ver
// vuelosControl.test.ts, programaTarifaComisionable.test.ts), estas pruebas
// inspeccionan el CÓDIGO FUENTE en vez de montar un DOM: no hay entorno de
// pruebas de componentes React en este repo, y estos archivos importan
// "next/link"/JSX que no se pueden `import`-ear fuera de Next.
// ─────────────────────────────────────────────────────────────────────────

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const leer = (p: string) => readFileSync(join(raiz, p), "utf8");

const bloqueosTablaSrc = leer("app/(dashboard)/dashboard/vuelos/BloqueosTabla.tsx");
const controlTablaSrc = leer("app/(dashboard)/dashboard/vuelos/ControlVuelosTabla.tsx");
const vistaTabsSrc = leer("app/(dashboard)/dashboard/vuelos/VistaTabs.tsx");
const pageSrc = leer("app/(dashboard)/dashboard/vuelos/page.tsx");
const historicoSrc = leer("app/(dashboard)/dashboard/vuelos/historico/page.tsx");
const filtrosSrc = leer("lib/vuelos/filtros.ts");

// ── Inventario ya no contiene la columna Control ────────────────────────────

test("BloqueosTabla (Inventario) no importa ni renderiza ControlBadges", () => {
  assert.doesNotMatch(bloqueosTablaSrc, /ControlBadges/, "Inventario todavía referencia ControlBadges");
});

test("BloqueosTabla (Inventario) no tiene un encabezado 'Control'", () => {
  assert.doesNotMatch(bloqueosTablaSrc, /<th[^>]*>Control<\/th>/, "quedó un <th>Control</th> en Inventario");
});

test("BloqueoFila (Inventario) ya no incluye modalidad_emision/estado_emision/estado_pago", () => {
  const tipo = bloqueosTablaSrc.slice(
    bloqueosTablaSrc.indexOf("export type BloqueoFila"),
    bloqueosTablaSrc.indexOf("export function BloqueosTabla")
  );
  assert.doesNotMatch(tipo, /modalidad_emision/, "BloqueoFila conserva modalidad_emision");
  assert.doesNotMatch(tipo, /estado_emision/, "BloqueoFila conserva estado_emision");
  assert.doesNotMatch(tipo, /estado_pago/, "BloqueoFila conserva estado_pago");
});

test("Inventario ya no tiene filtros de modalidad/emisión/pago (solo ruta y mes)", () => {
  assert.doesNotMatch(bloqueosTablaSrc, /fModalidad|fEmision|fPago/, "Inventario conserva filtros de control");
  assert.match(bloqueosTablaSrc, /const \[fRuta, setFRuta\] = useState\(""\)/, "Inventario perdió el filtro de ruta");
  assert.match(bloqueosTablaSrc, /const \[fMes, setFMes\] = useState\(""\)/, "Inventario perdió el filtro de mes");
});

test("BloqueosTabla (Inventario): el tfoot ajustó su colSpan final tras quitar Control (2, no 3)", () => {
  const tfoot = bloqueosTablaSrc.slice(bloqueosTablaSrc.indexOf("<tfoot>"), bloqueosTablaSrc.indexOf("</tfoot>"));
  assert.match(tfoot, /colSpan=\{2\}/, "el tfoot no ajustó su colSpan final a 2");
  assert.doesNotMatch(tfoot, /colSpan=\{3\}/, "quedó el colSpan={3} viejo (contaba la columna Control)");
});

test("BloqueosTabla (Inventario): thead y tbody conservan el mismo número de columnas", () => {
  const thead = bloqueosTablaSrc.slice(bloqueosTablaSrc.indexOf("<thead>"), bloqueosTablaSrc.indexOf("</thead>"));
  const headers = [...thead.matchAll(/<th(?=[\s>])[^>]*>/g)]; // excluye la etiqueta <thead> misma
  const tbody = bloqueosTablaSrc.slice(bloqueosTablaSrc.indexOf("<tbody>"), bloqueosTablaSrc.indexOf("</tbody>"));
  const celdas = [...tbody.matchAll(/<td[^>]*>/g)];
  assert.equal(headers.length, celdas.length, "el thead y el tbody de Inventario no tienen el mismo número de columnas");
});

// ── Control Vuelos: tres encabezados separados, mismo orden que las celdas ─

test("ControlVuelosTabla tiene tres <th> SEPARADOS para Modalidad/Emisión/Pago (no un badge combinado)", () => {
  assert.match(controlTablaSrc, /<th className="px-3 py-2">Modalidad<\/th>/, "falta el encabezado Modalidad");
  assert.match(controlTablaSrc, /<th className="px-3 py-2">Emisión<\/th>/, "falta el encabezado Emisión");
  assert.match(controlTablaSrc, /<th className="px-3 py-2">Pago<\/th>/, "falta el encabezado Pago");
});

test("ControlVuelosTabla no incluye columnas de sillas ni fila de totales", () => {
  assert.doesNotMatch(controlTablaSrc, /\bdisp\b|\bplazo\b|\bconf\b|\bdev\b|\bnven\b/i, "Control Vuelos referencia campos de sillas");
  assert.doesNotMatch(controlTablaSrc, /<tfoot>/, "Control Vuelos tiene una fila de totales");
});

test("ControlVuelosTabla no incluye acción de eliminar (esa acción es solo de Inventario)", () => {
  assert.doesNotMatch(controlTablaSrc, /EliminarBloqueoBtn/, "Control Vuelos permite eliminar records");
});

test("ControlVuelosTabla: el record enlaza al detalle correcto según su origen (bloqueo vs sistema/empaquetado)", () => {
  // PR A (fusión con Empaquetados): ya no hay un único href fijo — una fila
  // puede venir de bloqueos_vuelo o de empaquetados, cada una con su propia
  // ruta de detalle. hrefDetalle() es la única función que decide el link,
  // nunca se construye el href inline en el JSX (así no se puede mezclar el
  // id de una tabla con la ruta de la otra).
  assert.match(controlTablaSrc, /function hrefDetalle\(f: ControlFila\): string/, "falta la función que decide el link según el origen");
  assert.match(controlTablaSrc, /f\.origen === "bloqueo" \? `\/dashboard\/vuelos\/\$\{f\.numericId\}`/, "el link de un bloqueo no usa /dashboard/vuelos/{numericId}");
  assert.match(controlTablaSrc, /`\/dashboard\/vuelos\/empaquetados\/\$\{f\.numericId\}`/, "el link de un empaquetado no usa /dashboard/vuelos/empaquetados/{numericId}");
  assert.match(controlTablaSrc, /href=\{hrefDetalle\(b\)\}/, "la celda Record no usa hrefDetalle(b) para armar el link");
});

test("ControlVuelosTabla: mismo número de encabezados y celdas, EN EL MISMO ORDEN", () => {
  const thead = controlTablaSrc.slice(controlTablaSrc.indexOf("<thead>"), controlTablaSrc.indexOf("</thead>"));
  const headers = [...thead.matchAll(/<th[^>]*>([^<]*)<\/th>/g)].map((m) => m[1].trim());
  assert.deepEqual(headers, [
    "Record", "Aerolínea", "Ruta", "Ida", "Regreso",
    "Fecha límite de emisión", "Modalidad", "Emisión", "Pago",
  ]);

  const tbody = controlTablaSrc.slice(controlTablaSrc.indexOf("<tbody>"), controlTablaSrc.indexOf("</tbody>"));
  const celdas = [...tbody.matchAll(/<td[^>]*>/g)];
  assert.equal(celdas.length, headers.length, "el número de <td> no coincide con el número de <th>");
});

test("ControlVuelosTabla: cada valor va en la celda de SU columna, por posición", () => {
  const tbody = controlTablaSrc.slice(controlTablaSrc.indexOf("<tbody>"), controlTablaSrc.indexOf("</tbody>"));
  const celdas = tbody.split(/<td/).slice(1); // un fragmento por celda, en orden
  assert.equal(celdas.length, 9, "se esperaban 9 celdas por fila");
  assert.match(celdas[0], /b\.record/, "celda 1 (Record) no usa b.record");
  assert.match(celdas[1], /b\.aerolinea/, "celda 2 (Aerolínea) no usa b.aerolinea");
  assert.match(celdas[2], /b\.ruta/, "celda 3 (Ruta) no usa b.ruta");
  assert.match(celdas[3], /b\.fecha_ida/, "celda 4 (Ida) no usa b.fecha_ida");
  assert.match(celdas[4], /b\.fecha_regreso/, "celda 5 (Regreso) no usa b.fecha_regreso");
  assert.match(celdas[5], /b\.fecha_emision/, "celda 6 (Fecha límite de emisión) no usa b.fecha_emision");
  assert.doesNotMatch(celdas[5], /fecha_devolucion/, "celda 6 usa fecha_devolucion en vez de fecha_emision");
  // PR A: la modalidad ahora es "sistema"/serie/grupo (fusión con Empaquetados)
  // — pasa por labelModalidadControl/tonoModalidadControl, no por las
  // versiones sin "Control" (esas solo conocen serie/grupo, nunca "sistema").
  assert.match(celdas[6], /labelModalidadControl\(b\.modalidad\)/, "celda 7 (Modalidad) no usa labelModalidadControl");
  assert.match(celdas[7], /labelEstadoEmision\(b\.estado_emision\)/, "celda 8 (Emisión) no usa labelEstadoEmision");
  assert.match(celdas[8], /labelEstadoPago\(b\.estado_pago\)/, "celda 9 (Pago) no usa labelEstadoPago");
});

// ── Null se muestra como "Sin definir"/"Por confirmar", nunca el valor crudo ─

test("ControlVuelosTabla pasa SIEMPRE por label*() antes de mostrar el badge — nunca el valor crudo de la BD", () => {
  assert.doesNotMatch(controlTablaSrc, /estado=\{b\.modalidad_emision\}/, "Modalidad se renderiza sin pasar por labelModalidad");
  assert.doesNotMatch(controlTablaSrc, /estado=\{b\.estado_emision\}/, "Emisión se renderiza sin pasar por labelEstadoEmision");
  assert.doesNotMatch(controlTablaSrc, /estado=\{b\.estado_pago\}/, "Pago se renderiza sin pasar por labelEstadoPago");
});

test("ControlVuelosTabla reutiliza EstadoBadge (mismos badges/colores de siempre), no un componente nuevo", () => {
  assert.match(controlTablaSrc, /import \{ EstadoBadge \} from "@\/components\/EstadoBadge"/);
  const tbody = controlTablaSrc.slice(controlTablaSrc.indexOf("<tbody>"), controlTablaSrc.indexOf("</tbody>"));
  assert.equal([...tbody.matchAll(/<EstadoBadge/g)].length, 3, "cada fila debe tener exactamente 3 EstadoBadge (modalidad/emisión/pago)");
});

// ── Filtros de las dos tablas, independientes entre sí ──────────────────────

test("ControlVuelosTabla tiene sus 5 filtros propios (ruta, mes, modalidad, emisión, pago), en useState separados", () => {
  assert.match(controlTablaSrc, /const \[fRuta, setFRuta\] = useState\(""\)/);
  assert.match(controlTablaSrc, /const \[fMes, setFMes\] = useState\(""\)/);
  assert.match(controlTablaSrc, /const \[fModalidad, setFModalidad\] = useState\(""\)/);
  assert.match(controlTablaSrc, /const \[fEmision, setFEmision\] = useState\(""\)/);
  assert.match(controlTablaSrc, /const \[fPago, setFPago\] = useState\(""\)/);
});

test("Inventario y Control Vuelos son componentes DISTINTOS (estado de filtros no puede cruzarse)", () => {
  assert.doesNotMatch(bloqueosTablaSrc, /export function ControlVuelosTabla/, "ControlVuelosTabla no debe vivir en BloqueosTabla.tsx");
  assert.doesNotMatch(controlTablaSrc, /export function BloqueosTabla/, "BloqueosTabla no debe vivir en ControlVuelosTabla.tsx");
});

test("matchControl/mesKey/mesLabel viven en un helper puro compartido, sin lógica de React", () => {
  assert.doesNotMatch(filtrosSrc, /useState|useMemo|"use client"/, "lib/vuelos/filtros.ts no debe depender de React");
  assert.match(filtrosSrc, /export function matchControl/);
  assert.match(filtrosSrc, /export function mesKey/);
  assert.match(filtrosSrc, /export function mesLabel/);
});

// ── Activos e históricos no se mezclan ───────────────────────────────────────

test("/dashboard/vuelos: filasControl (lo que recibe ControlVuelosTabla) se arma SOLO desde activos/empActivos, nunca pasados/todos", () => {
  // PR A: el armado de filas se movió a una constante `filasControl` (fusiona
  // bloqueos + empaquetados) calculada ANTES del JSX, en vez de un
  // `.map()` inline dentro de <ControlVuelosTabla ...>. La prueba ahora mira
  // el bloque de esa constante, no los 400 caracteres después del tag.
  const i = pageSrc.indexOf("const filasControl: ControlFila[] = vistaControl");
  assert.notEqual(i, -1, "no se encontró la constante filasControl");
  const bloque = pageSrc.slice(i, pageSrc.indexOf("const tituloVista", i));
  assert.match(bloque, /activos\.map/, "filasControl no usa activos.map para los bloqueos");
  assert.match(bloque, /empActivos\.map/, "filasControl no usa empActivos.map para los empaquetados");
  assert.doesNotMatch(bloque, /\bpasados\.map|\btodos\.map|\bempPasados\.map|\btodosEmp\.map/, "filasControl (vista activa) mezcla con pasados/todos");
  assert.match(pageSrc, /<ControlVuelosTabla filas=\{filasControl\} \/>/, "ControlVuelosTabla ya no recibe filasControl directamente");
});

test("/dashboard/vuelos: BloqueosTabla recibe SOLO activos, nunca pasados ni todos", () => {
  const i = pageSrc.indexOf("<BloqueosTabla");
  const bloque = pageSrc.slice(i, i + 400);
  assert.match(bloque, /activos\.map/, "Inventario (activo) no usa activos.map");
  assert.doesNotMatch(bloque, /pasados\.map|todos\.map/, "Inventario (activo) mezcla con pasados/todos");
});

test("/dashboard/vuelos/historico: filasControl se arma SOLO desde pasados/empPasados, nunca activos/todos", () => {
  const i = historicoSrc.indexOf("const filasControl: ControlFila[] = vistaControl");
  assert.notEqual(i, -1, "no se encontró la constante filasControl");
  const bloque = historicoSrc.slice(i, historicoSrc.indexOf("const tituloVista", i));
  assert.match(bloque, /pasados\.map/, "filasControl (histórico) no usa pasados.map para los bloqueos");
  assert.match(bloque, /empPasados\.map/, "filasControl (histórico) no usa empPasados.map para los empaquetados");
  assert.doesNotMatch(bloque, /\bactivos\.map|\btodos\.map|\bempActivos\.map|\btodosEmp\.map/, "filasControl (histórico) mezcla con activos/todos");
  assert.match(historicoSrc, /<ControlVuelosTabla filas=\{filasControl\} \/>/, "ControlVuelosTabla ya no recibe filasControl directamente");
});

test("/dashboard/vuelos/historico: BloqueosTabla recibe SOLO pasados, nunca activos ni todos", () => {
  const i = historicoSrc.indexOf("<BloqueosTabla");
  const bloque = historicoSrc.slice(i, i + 400);
  assert.match(bloque, /pasados\.map/, "Inventario (histórico) no usa pasados.map");
  assert.doesNotMatch(bloque, /activos\.map|todos\.map/, "Inventario (histórico) mezcla con activos/todos");
});

// ── La pestaña elegida sobrevive a una recarga (estado en la URL) ───────────

test("VistaTabs usa <Link href='?vista=...'> — la pestaña vive en la URL, no en useState", () => {
  assert.doesNotMatch(vistaTabsSrc, /useState\(/, "VistaTabs guarda la pestaña en estado de React en vez de la URL");
  // La directiva "use client" solo cuenta si es la primera línea del archivo
  // (así la interpreta Next) — una mención dentro de un comentario no cuenta.
  assert.ok(!vistaTabsSrc.trimStart().startsWith('"use client"'), "VistaTabs no debería necesitar ser client component (no usa hooks)");
  assert.match(vistaTabsSrc, /href=\{`\$\{basePath\}\?vista=inventario`\}/, "falta el link a ?vista=inventario");
  assert.match(vistaTabsSrc, /href=\{`\$\{basePath\}\?vista=control-vuelos`\}/, "falta el link a ?vista=control-vuelos");
});

test("vistaDeParam: 'control-vuelos'/'empaquetados' explícitos activan su vista; CUALQUIER OTRO valor (ausente, inválido) cae en 'inventario'", () => {
  // PR A: tercera pestaña — ya no es un ternario de una sola línea, pero el
  // criterio de fallback (default duro a "inventario" para cualquier valor
  // que no sea exactamente uno de los otros dos) se mantiene igual.
  const fn = vistaTabsSrc.slice(
    vistaTabsSrc.indexOf("export function vistaDeParam"),
    vistaTabsSrc.indexOf("export function VistaTabs")
  );
  assert.match(fn, /if \(v === "control-vuelos"\) return "control-vuelos";/, "no reconoce 'control-vuelos' explícito");
  assert.match(fn, /if \(v === "empaquetados"\) return "empaquetados";/, "no reconoce 'empaquetados' explícito");
  assert.match(fn, /return "inventario";\s*\}\s*$/, "el fallback final no es un 'inventario' incondicional");
});

test("page.tsx y historico/page.tsx resuelven la pestaña desde searchParams (servidor), no desde el cliente", () => {
  for (const [nombre, src] of [["page.tsx", pageSrc], ["historico/page.tsx", historicoSrc]] as const) {
    assert.match(src, /searchParams: Promise<\{ vista\?: string \}>/, `${nombre} no tipa searchParams.vista`);
    assert.match(src, /const \{ vista: vistaParam \} = await searchParams;/, `${nombre} no espera searchParams`);
    assert.match(src, /const vista = vistaDeParam\(vistaParam\);/, `${nombre} no usa vistaDeParam`);
  }
});

test("Inventario debe ser la vista por defecto: page.tsx y historico/page.tsx importan vistaDeParam de VistaTabs, no reimplementan el fallback", () => {
  assert.match(pageSrc, /import \{ VistaTabs, vistaDeParam \} from "\.\/VistaTabs";/);
  assert.match(historicoSrc, /import \{ VistaTabs, vistaDeParam \} from "\.\.\/VistaTabs";/);
});

// ─────────────────────────────────────────────────────────────────────────
// § Ronda 2 del rediseño: nombre exacto de la pestaña, encabezado por vista,
// navegación ida/vuelta a histórico conservando ?vista=, y Control Vuelos
// sin tocar la consulta de sillas.
// ─────────────────────────────────────────────────────────────────────────

// ── 1) Nombre exacto de la pestaña y encabezado por vista ──────────────────

test("VistaTabs: el texto del tab de Control es EXACTAMENTE 'CONTROL VUELOS'", () => {
  assert.match(vistaTabsSrc, />CONTROL VUELOS<\/TabLink>/, "el texto del tab de Control no es exactamente 'CONTROL VUELOS'");
  assert.doesNotMatch(vistaTabsSrc, />Control Vuelos<\/TabLink>/, "quedó el texto viejo 'Control Vuelos' sin mayúsculas");
});

test("page.tsx: el título (tituloVista) es 'Inventario de vuelos' / 'Empaquetados' / 'Control vuelos' según la vista", () => {
  // PR A: pasó de un ternario inline en el JSX a una constante `tituloVista`
  // (ahora 3 vistas, no 2) — mismo criterio, un valor fijo por vista.
  assert.match(
    pageSrc,
    /const tituloVista = vistaInventario \? "Inventario de vuelos" : vistaEmpaquetados \? "Empaquetados" : "Control vuelos";/,
    "tituloVista no cubre las 3 vistas con los textos esperados"
  );
  assert.match(pageSrc, /<h1[^>]*>\{tituloVista\}<\/h1>/, "el H1 no usa la constante tituloVista");
});

test("page.tsx: el subtítulo (subtituloVista) también cambia según la vista, incluida Empaquetados", () => {
  assert.match(pageSrc, /"Bloqueos de sillas negociadas con la aerolínea"/, "falta el subtítulo de Inventario");
  assert.match(pageSrc, /"Tarifas de Sistema para armar promociones — sin cupo negociado, sin sillas"/, "falta el subtítulo de Empaquetados");
  assert.match(pageSrc, /"Modalidad, emisión y pago por record \(bloqueos \+ empaquetados\)"/, "falta el subtítulo de Control Vuelos");
});

test("historico/page.tsx: tituloVista es 'Histórico de vuelos' / 'Empaquetados histórico' / 'Control vuelos histórico' según la vista", () => {
  assert.match(
    historicoSrc,
    /const tituloVista = vistaInventario \? "Histórico de vuelos" : vistaEmpaquetados \? "Empaquetados histórico" : "Control vuelos histórico";/,
    "tituloVista no cubre las 3 vistas con los textos esperados"
  );
  assert.match(historicoSrc, /<h1[^>]*>\{tituloVista\}<\/h1>/, "el H1 del histórico no usa la constante tituloVista");
});

test("historico/page.tsx: el subtítulo también cambia según la vista, incluida Empaquetados", () => {
  assert.match(historicoSrc, /"Bloqueos cuya fecha de ida ya pasó \(inactivos\)\. Entra a un record para ver sus pasajeros\."/);
  // Defecto 3 (revisión de PR #268): el histórico ahora también agrupa los
  // desactivados-a-mano (no solo los de fecha ya pasada) — texto actualizado.
  assert.match(historicoSrc, /"Empaquetados cuya fecha de ida ya pasó, o que fueron desactivados a mano\."/);
  assert.match(historicoSrc, /"Modalidad, emisión y pago de los records ya pasados \(bloqueos \+ empaquetados\)\."/);
});

// ── 2) La pestaña se conserva navegando a histórico y de vuelta ────────────

test("page.tsx: el botón 'Histórico' conserva el ?vista= actual (no un link estático)", () => {
  assert.match(pageSrc, /href=\{`\/dashboard\/vuelos\/historico\?vista=\$\{vista\}`\}/, "el botón Histórico no manda ?vista=");
  assert.doesNotMatch(pageSrc, /href="\/dashboard\/vuelos\/historico"/, "quedó un link estático a histórico sin ?vista=");
});

test("page.tsx: el link del estado vacío de Inventario (bloqueos ya pasados) conserva ?vista=", () => {
  // PR A: "No hay vuelos activos" ahora aparece en DOS estados vacíos
  // distintos (Control Vuelos fusionado, y el de Inventario que sí trae el
  // link a histórico) — se ancla por un texto único de cada uno para no
  // depender de cuál aparece primero en el archivo.
  const i = pageSrc.indexOf("Todos los bloqueos ya pasaron su fecha de ida");
  assert.notEqual(i, -1, "no se encontró el estado vacío de Inventario (bloqueos activos=0)");
  const bloque = pageSrc.slice(i, i + 400);
  assert.match(bloque, /href=\{`\/dashboard\/vuelos\/historico\?vista=\$\{vista\}`\}/, "el link del estado vacío de Inventario no manda ?vista=");
});

test("historico/page.tsx: el link de regreso a Inventario conserva el ?vista= actual (no un link estático)", () => {
  assert.match(historicoSrc, /href=\{`\/dashboard\/vuelos\?vista=\$\{vista\}`\}/, "el link de regreso no manda ?vista=");
  assert.doesNotMatch(historicoSrc, /href="\/dashboard\/vuelos"\s/, "quedó un link estático de regreso sin ?vista=");
});

test("Round-trip: control-vuelos → historico?vista=control-vuelos → vuelos?vista=control-vuelos (mismo criterio para inventario)", () => {
  // Ambos lados toman `vista` (ya resuelto por vistaDeParam desde searchParams)
  // como fuente del query string — nunca un literal fijo — así que CUALQUIER
  // vista elegida (incluida "control-vuelos") viaja intacta ida y vuelta.
  assert.match(pageSrc, /href=\{`\/dashboard\/vuelos\/historico\?vista=\$\{vista\}`\}/, "ida: /dashboard/vuelos no propaga vista al histórico");
  assert.match(historicoSrc, /href=\{`\/dashboard\/vuelos\?vista=\$\{vista\}`\}/, "vuelta: el histórico no propaga vista de regreso");
});

// ── 3) Control Vuelos no consulta ni depende de sillas ──────────────────────

test("page.tsx: la consulta de sillas está condicionada a vistaInventario (no corre en Control Vuelos)", () => {
  const i = pageSrc.indexOf("Promise.all([");
  const bloque = pageSrc.slice(i, pageSrc.indexOf("]);", i));
  assert.match(bloque, /vistaInventario/, "la consulta de sillas no está condicionada a vistaInventario");
  assert.match(bloque, /sb\.from\("sillas"\)\.select\("bloqueo_id, estado"\)/, "falta la consulta real de sillas para Inventario");
  assert.match(bloque, /Promise\.resolve\(\{ data: null/, "falta el atajo sin red para Control Vuelos");
});

test("page.tsx: conteo/tot/ocup NO se calculan en Control Vuelos (solo si vistaInventario)", () => {
  assert.match(pageSrc, /const conteo: Map<number, ConteoSillas> = vistaInventario \? conteoPorBloqueo\(sillas\) : new Map\(\);/);
  assert.match(pageSrc, /const tot = vistaInventario \? sumarConteos\(conteo, activos\.map\(\(b\) => b\.id\)\) : conteoCero\(\);/);
  assert.match(pageSrc, /const ocup = vistaInventario \? ocupacionPct\(tot\) : 0;/);
});

test("historico/page.tsx: la consulta de sillas está condicionada a vistaInventario (no corre en Control Vuelos)", () => {
  const i = historicoSrc.indexOf("Promise.all([");
  const bloque = historicoSrc.slice(i, historicoSrc.indexOf("]);", i));
  assert.match(bloque, /vistaInventario/, "la consulta de sillas no está condicionada a vistaInventario");
  assert.match(bloque, /sb\.from\("sillas"\)\.select\("bloqueo_id, estado"\)/, "falta la consulta real de sillas para Inventario");
  assert.match(bloque, /Promise\.resolve\(\{ data: null/, "falta el atajo sin red para Control Vuelos");
});

test("historico/page.tsx: gen/totPas NO se calculan en Control Vuelos (solo si vistaInventario)", () => {
  assert.match(historicoSrc, /const conteo: Map<number, ConteoSillas> = vistaInventario \? conteoPorBloqueo\(sillas\) : new Map\(\);/);
  assert.match(historicoSrc, /const gen = vistaInventario \? sumarConteos\(conteo, todos\.map\(\(b\) => b\.id\)\) : conteoCero\(\);/);
  assert.match(historicoSrc, /const totPas = vistaInventario \? sumarConteos\(conteo, pasados\.map\(\(b\) => b\.id\)\) : conteoCero\(\);/);
});

test("page.tsx y historico/page.tsx: bloqueos_vuelo Y empaquetados se consultan UNA sola vez cada una (nunca duplicadas)", () => {
  for (const [nombre, src] of [["page.tsx", pageSrc], ["historico/page.tsx", historicoSrc]] as const) {
    const vecesBloqueos = [...src.matchAll(/\.from\("bloqueos_vuelo"\)/g)].length;
    assert.equal(vecesBloqueos, 1, `${nombre} llama a .from("bloqueos_vuelo") ${vecesBloqueos} veces — debía ser exactamente 1`);
    const vecesEmpaquetados = [...src.matchAll(/\.from\("empaquetados"\)/g)].length;
    assert.equal(vecesEmpaquetados, 1, `${nombre} llama a .from("empaquetados") ${vecesEmpaquetados} veces — debía ser exactamente 1`);
  }
});

test("ControlVuelosTabla en ambas páginas no referencia conteo ni campos de sillas en su mapeo de filas", () => {
  for (const [nombre, src] of [["page.tsx", pageSrc], ["historico/page.tsx", historicoSrc]] as const) {
    const i = src.indexOf("<ControlVuelosTabla");
    const bloque = src.slice(i, src.indexOf("/>", i) + 2);
    assert.doesNotMatch(bloque, /conteo|disp:|plazo:|conf:|dev:|nven:/, `${nombre}: ControlVuelosTabla referencia datos de sillas`);
  }
});
