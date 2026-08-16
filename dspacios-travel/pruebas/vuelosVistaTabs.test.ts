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

test("ControlVuelosTabla: el record enlaza al detalle del bloqueo", () => {
  assert.match(controlTablaSrc, /href=\{`\/dashboard\/vuelos\/\$\{b\.id\}`\}/, "el record ya no enlaza a /dashboard/vuelos/{id}");
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
  assert.match(celdas[6], /labelModalidad\(b\.modalidad_emision\)/, "celda 7 (Modalidad) no usa labelModalidad");
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

test("/dashboard/vuelos: ControlVuelosTabla recibe SOLO activos, nunca pasados ni todos", () => {
  const i = pageSrc.indexOf("<ControlVuelosTabla");
  const bloque = pageSrc.slice(i, i + 400);
  assert.match(bloque, /activos\.map/, "Control Vuelos (activo) no usa activos.map");
  assert.doesNotMatch(bloque, /pasados\.map|todos\.map/, "Control Vuelos (activo) mezcla con pasados/todos");
});

test("/dashboard/vuelos: BloqueosTabla recibe SOLO activos, nunca pasados ni todos", () => {
  const i = pageSrc.indexOf("<BloqueosTabla");
  const bloque = pageSrc.slice(i, i + 400);
  assert.match(bloque, /activos\.map/, "Inventario (activo) no usa activos.map");
  assert.doesNotMatch(bloque, /pasados\.map|todos\.map/, "Inventario (activo) mezcla con pasados/todos");
});

test("/dashboard/vuelos/historico: ControlVuelosTabla recibe SOLO pasados, nunca activos ni todos", () => {
  const i = historicoSrc.indexOf("<ControlVuelosTabla");
  const bloque = historicoSrc.slice(i, i + 400);
  assert.match(bloque, /pasados\.map/, "Control Vuelos (histórico) no usa pasados.map");
  assert.doesNotMatch(bloque, /activos\.map|todos\.map/, "Control Vuelos (histórico) mezcla con activos/todos");
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

test("vistaDeParam: 'control-vuelos' explícito activa Control; CUALQUIER OTRO valor (ausente, inválido) cae en 'inventario'", () => {
  assert.match(
    vistaTabsSrc,
    /export function vistaDeParam\(v: string \| undefined\): VistaVuelos \{\s*return v === "control-vuelos" \? "control-vuelos" : "inventario";\s*\}/,
    "vistaDeParam ya no tiene el fallback incondicional a 'inventario'"
  );
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

test("page.tsx: el encabezado H1 es 'Inventario de vuelos' en inventario, 'Control vuelos' en control-vuelos", () => {
  assert.match(pageSrc, /\{vistaInventario \? "Inventario de vuelos" : "Control vuelos"\}/, "el H1 no cambia según vistaInventario");
});

test("page.tsx: el subtítulo también cambia según la vista (no solo el H1)", () => {
  assert.match(pageSrc, /"Bloqueos de sillas negociadas con la aerolínea"/, "falta el subtítulo de Inventario");
  assert.match(pageSrc, /"Modalidad, emisión y pago por record"/, "falta el subtítulo de Control Vuelos");
});

test("historico/page.tsx: el encabezado H1 es 'Histórico de vuelos' en inventario, 'Control vuelos histórico' en control-vuelos", () => {
  assert.match(
    historicoSrc,
    /\{vistaInventario \? "Histórico de vuelos" : "Control vuelos histórico"\}/,
    "el H1 del histórico no cambia según vistaInventario"
  );
});

test("historico/page.tsx: el subtítulo también cambia según la vista", () => {
  assert.match(historicoSrc, /"Bloqueos cuya fecha de ida ya pasó \(inactivos\)\. Entra a un record para ver sus pasajeros\."/);
  assert.match(historicoSrc, /"Modalidad, emisión y pago de los records ya pasados\."/);
});

// ── 2) La pestaña se conserva navegando a histórico y de vuelta ────────────

test("page.tsx: el botón 'Histórico' conserva el ?vista= actual (no un link estático)", () => {
  assert.match(pageSrc, /href=\{`\/dashboard\/vuelos\/historico\?vista=\$\{vista\}`\}/, "el botón Histórico no manda ?vista=");
  assert.doesNotMatch(pageSrc, /href="\/dashboard\/vuelos\/historico"/, "quedó un link estático a histórico sin ?vista=");
});

test("page.tsx: el link del estado vacío 'No hay vuelos activos' también conserva ?vista=", () => {
  const i = pageSrc.indexOf("No hay vuelos activos");
  const bloque = pageSrc.slice(i, i + 400);
  assert.match(bloque, /href=\{`\/dashboard\/vuelos\/historico\?vista=\$\{vista\}`\}/, "el link del estado vacío no manda ?vista=");
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

test("page.tsx y historico/page.tsx: bloqueos_vuelo se consulta UNA sola vez cada una (nunca duplicada)", () => {
  for (const [nombre, src] of [["page.tsx", pageSrc], ["historico/page.tsx", historicoSrc]] as const) {
    const veces = [...src.matchAll(/\.from\("bloqueos_vuelo"\)/g)].length;
    assert.equal(veces, 1, `${nombre} llama a .from("bloqueos_vuelo") ${veces} veces — debía ser exactamente 1`);
  }
});

test("ControlVuelosTabla en ambas páginas no referencia conteo ni campos de sillas en su mapeo de filas", () => {
  for (const [nombre, src] of [["page.tsx", pageSrc], ["historico/page.tsx", historicoSrc]] as const) {
    const i = src.indexOf("<ControlVuelosTabla");
    const bloque = src.slice(i, src.indexOf("/>", i) + 2);
    assert.doesNotMatch(bloque, /conteo|disp:|plazo:|conf:|dev:|nven:/, `${nombre}: ControlVuelosTabla referencia datos de sillas`);
  }
});
