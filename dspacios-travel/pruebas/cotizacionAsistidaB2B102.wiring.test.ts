// #102 — Cableado de la cotización asistida B2B (se verifica el código FUENTE, mismo criterio que el resto de pruebas de wiring; la EJECUCIÓN real
// contra Postgres está en pruebas/cotizacionAsistidaB2B102.pg.ts). Guarda el ORDEN de las barreras (todo se decide antes de numerar), que la
// autoridad nunca salga del navegador, que el contrato B2B nazca del plan congelado y que los documentos externos no reciban comisión.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const leer = (rel: string) => readFileSync(join(raiz, rel), "utf8").replace(/\r\n/g, "\n");
// Quita comentarios de línea completa y bloques /* … */ (los comentarios explican por qué; las barreras se miden en el código).
const sinComentarios = (f: string) => f.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");

const checkout = sinComentarios(leer("app/tarifario/checkout/actions.ts"));
const reservar = sinComentarios(leer("app/(dashboard)/dashboard/reservar/actions.ts"));
const puroConComentarios = leer("lib/cotizacion/asistidaB2B.ts");
const puro = sinComentarios(puroConComentarios);
const servidor = sinComentarios(leer("lib/cotizacion/asistidaB2BServidor.ts"));

function cuerpo(fuente: string, ancla: string, hasta?: string): string {
  const i = fuente.indexOf(ancla);
  assert.ok(i > -1, `no se encontró «${ancla}»`);
  const f = hasta ? fuente.indexOf(hasta, i + ancla.length) : fuente.length;
  assert.ok(f > i, `no se encontró el fin «${hasta}»`);
  return fuente.slice(i, f);
}
const antes = (src: string, a: string, b: string) => {
  const ia = src.indexOf(a), ib = src.indexOf(b);
  assert.ok(ia > -1, `falta «${a}»`);
  assert.ok(ib > -1, `falta «${b}»`);
  return ia < ib;
};

describe("autoridad: el navegador solo elige; el servidor decide", () => {
  test("la lista de roles es explícita: nada de ROLES_INTERNOS (incluiría control_vuelo) en la lógica de la venta asistida", () => {
    assert.doesNotMatch(puro, /ROLES_INTERNOS/);
    assert.doesNotMatch(servidor, /ROLES_INTERNOS/);
    assert.match(puro, /export const ROLES_ASISTENCIA_B2B = \["superadmin", "gerencia", "administracion", "operaciones", "venta"\] as const;/);
  });

  test("crearSolicitudReserva resuelve actor y aliado en servidor ANTES de crear la cotización y solo lee del navegador la elección", () => {
    const f = cuerpo(checkout, "export async function crearSolicitudReserva", "function lineasMensajeB2BAsistido");
    assert.match(f, /leerAsistenciaB2BEntrada\(inputRaw\)/);
    assert.match(f, /prepararAsistenciaB2B\(await createClient\(\), asistencia\.asistencia\)/);
    assert.ok(antes(f, "prepararAsistenciaB2B(", "await crearCotizacionCarrito("), "la autorización va antes de crear nada");
    assert.match(f, /\{ b2b: b2bAsistido \}/);
    // Nada de lo que podría mandar el navegador para fijar dinero se lee de `input`/`inputRaw` en este camino.
    assert.doesNotMatch(f, /inputRaw[^;\n]*(pct|porcentaje|comision|base|total)/i);
    assert.doesNotMatch(f, /asistencia\.asistencia\.(pct|porcentaje|comision|base|total|tipo)/i);
  });

  test("el tenant de la cotización sigue FIJO en el servidor (mayorista) y el plan se construye con lo que liquidó el servidor", () => {
    assert.match(checkout, /tenant: "mayorista",\n\s+tipo: "carrito",/);
    const c = cuerpo(checkout, "let planB2B: PlanB2BCotizacion | null = null;", "const ventaSnap");
    assert.match(c, /construirPlanB2B\(\{/);
    assert.match(c, /pct: opts\.b2b\.aliado\.pct/);
    assert.match(c, /lineas: lineasB2B/);
    assert.match(c, /moneda,/, "la moneda del plan es la de la cotización, no una enviada");
  });

  test("las líneas del plan salen de lo liquidado: persona (precio + impuesto de comp.data), Bernalo (impuesto 0) y tours (precio re-liquidado)", () => {
    assert.match(checkout, /lineasB2B\.push\(\{ clave: ref, pvp: precioVenta, impuesto: comp\.data\.impuestoTotal \}\);/);
    assert.match(checkout, /lineasB2B\.push\(\{ clave: ref, pvp: resultadoBernalo\.precioVenta, impuesto: 0 \}\);/);
    assert.match(checkout, /lineasB2B\.push\(\{ clave: `tour-\$\{toursOk\.length\}`, pvp: resultado\.resultado\.total, impuesto: 0 \}\);/);
  });

  test("el plan se guarda en payload.b2bAsistido; el enlace público y el imprimible solo reciben detalle.b2bExterno (total exigible NETO)", () => {
    assert.match(checkout, /\.\.\.\(planB2B \? \{ b2bAsistido: planB2B \} : \{\}\)/);
    assert.match(checkout, /b2bExterno: \{ netoTotalExigible: planB2B\.total_exigible \}/);
    const pub = sinComentarios(leer("app/cot/[token]/page.tsx"));
    assert.doesNotMatch(pub, /payload|b2bAsistido|comision/);
  });

  test("una sesión sin permiso (aliado B2B, control_vuelo…) que manda `asistencia` es rechazada por el actor, no ignorada", () => {
    assert.match(servidor, /autorizarActorAsistenciaB2B\(perfil\)/);
    assert.match(servidor, /export async function prepararAsistenciaB2B[\s\S]*resolverActorAsistencia\(sb\)[\s\S]*if \(!a\.ok\) return a;/);
  });
});

describe("conversión: todo se decide ANTES de numerar y el contrato nace del plan congelado", () => {
  const conv = cuerpo(reservar, "export async function convertirCotizacionCarrito(", "export async function actualizarVigenciaCotizacion");

  test("el plan se lee del payload y el actor B2B se exige antes de devolver contratos ya creados o de escribir nada", () => {
    assert.ok(antes(conv, "leerPlanB2BDePayload(cot.payload)", 'if (cot.estado === "convertida")'));
    assert.ok(antes(conv, "resolverActorAsistencia(sb)", 'if (cot.estado === "convertida")'));
    assert.match(conv, /if \(!lecturaB2B\.ok\) return \{ ok: false, error: lecturaB2B\.error \};/);
  });

  test("aliado vivo, líneas vivas y moneda se comparan contra lo congelado antes de siquiera pedir un número de contrato", () => {
    const num = conv.indexOf("siguienteNumeroContrato(tenantCotizacion)");
    assert.ok(num > -1);
    for (const ancla of ["verificarAliadoVivoParaConversion(sb, planB2BCot)", "compararLineasConCongeladas(planB2BCot, vivas, cot.moneda", "monedaOfertaConversion !== planB2BCot.moneda"]) {
      const i = conv.indexOf(ancla);
      assert.ok(i > -1 && i < num, `«${ancla}» debe ir antes de numerar`);
    }
  });

  test("un grupo ya convertido no se vuelve a juzgar: el aliado vivo solo se verifica si quedan grupos pendientes", () => {
    assert.match(conv, /if \(planB2BCot && gruposPendientes\.length\) \{[\s\S]*?const aliadoVivo = await verificarAliadoVivoParaConversion/);
  });

  test("lo exigible del contrato (cobro, precio, saldo) parte del plan del grupo; el contrato nace B2B del aliado congelado", () => {
    assert.match(conv, /const precioExigibleGrupo = planGrupoB2B \? planGrupoB2B\.precioFinal : precioTotal;/);
    assert.match(conv, /cobroDeContratoCarrito\(\{ precioVenta: precioExigibleGrupo,/);
    const v = cuerpo(conv, 'sb.from("ventas").insert({', "if (ve) {");
    assert.match(v, /precio_venta: precioExigibleGrupo,/);
    for (const campo of ['canal: "B2B"', "tipo_asesor: planB2BCot.tipo_asesor", "modo_compra: planGrupoB2B.modoCompra", "comision_b2b: planGrupoB2B.comision", "comision_estado: planGrupoB2B.comisionEstado", "aliado_id: planB2BCot.aliado_id"]) {
      assert.ok(v.includes(campo), `falta ${campo}`);
    }
    // La rama B2C de siempre sigue siendo B2C/interno: una cotización SIN plan nunca nace B2B ni al revés.
    assert.match(v, /: \{ canal: "B2C", tipo_asesor: "interno" \}\)/);
    assert.doesNotMatch(v, /canal: "B2B"[\s\S]*canal: "B2B"/);
  });

  test("la comisión la crea la base justo después de la venta, antes de pasajeros/sillas, y un fallo revierte el contrato del grupo", () => {
    assert.ok(antes(conv, "registrarComisionReserva(sb, numero, planB2BCot.aliado_id)", "crear_pasajeros_contrato_multi_con_sillas"));
    assert.ok(antes(conv, "const fallarYRevertirGrupo = async", "registrarComisionReserva(sb, numero, planB2BCot.aliado_id)"));
    assert.match(conv, /if \(!com\.ok\) return fallarYRevertirGrupo\(com\.error\);/);
  });

  test("el impuesto del contrato es el mismo que se usó para la base (la base de datos recalcula la comisión desde ventas.impuesto)", () => {
    assert.match(conv, /impuesto: validadosPersona\.reduce\(\(s, v\) => s \+ v\.comp\.impuestoTotal, 0\),/);
  });

  test("las claves de las líneas vivas coinciden con las congeladas: ref del ítem y tour-N por posición en payload.tours", () => {
    assert.match(conv, /clave: v\.item\.ref \?\? ""/);
    assert.match(conv, /clave: `tour-\$\{t\.__idx\}`/);
    assert.match(conv, /toursAsign\.push\(\{ \.\.\.t, __posiciones: posiciones, __idx: i \}\);/);
  });
});

describe("documentos y portal", () => {
  test("la ficha interna muestra los términos congelados; el imprimible y el enlace público no importan el panel ni leen comisión", () => {
    const ficha = leer("app/(dashboard)/dashboard/cotizaciones/[id]/page.tsx");
    assert.match(ficha, /<TerminosB2BAsistido plan=\{planB2B\} \/>/);
    for (const rel of ["app/cotizacion/[id]/page.tsx", "app/cot/[token]/page.tsx"]) {
      assert.doesNotMatch(sinComentarios(leer(rel)), /TerminosB2BAsistido/, rel);
    }
  });

  test("la migración 238 es aditiva: agrega aliados.activo (default true) y las dos marcas de conversión con su índice único parcial; no toca RLS ni datos; su única función es el disparador que hace inmutable payload.b2bAsistido", () => {
    const sql = leer("supabase/migrations/20260601000238_cotizacion_asistida_b2b.sql");
    const codigo = sql.replace(/--.*$/gm, "");
    assert.match(codigo, /add column if not exists activo boolean not null default true/);
    assert.match(codigo, /add column if not exists cotizacion_origen_id bigint,\s+add column if not exists grupo_conversion text/);
    assert.match(codigo, /create unique index if not exists ux_ventas_conversion_cotizacion_grupo\s+on public\.ventas \(cotizacion_origen_id, grupo_conversion\)\s+where cotizacion_origen_id is not null;/);
    assert.match(codigo, /check \(\(cotizacion_origen_id is null\) = \(grupo_conversion is null\)\)/);
    // La única función/trigger permitido es el disparador de la frontera del plan congelado; todo lo demás sigue prohibido.
    const sinDisparador = codigo
      .replace(/create or replace function public\.tg_cot_b2b_asistido_inmutable\(\)[\s\S]*?\$\$;/, "")
      .replace(/revoke all on function public\.tg_cot_b2b_asistido_inmutable\(\) from public, anon, authenticated;/, "")
      .replace(/drop trigger if exists trg_cot_b2b_asistido_inmutable on public\.cotizaciones;/, "")
      .replace(/create trigger trg_cot_b2b_asistido_inmutable[^;]*;/, "");
    assert.doesNotMatch(sinDisparador, /create (or replace )?function|create policy|create trigger|drop |delete |update public\.|alter table public\.ventas\s+alter column/i);
    assert.match(codigo, /before update on public\.cotizaciones\s+for each row execute function public\.tg_cot_b2b_asistido_inmutable\(\)/);
    assert.match(codigo, /\(old\.payload -> 'b2bAsistido'\) is distinct from \(new\.payload -> 'b2bAsistido'\)/);
  });

  test("el candado de doble envío: la conversión B2B escribe las dos marcas y traduce la violación de unicidad a un aviso, sin escribir nada más", () => {
    const conv = cuerpo(reservar, "export async function convertirCotizacionCarrito(", "export async function actualizarVigenciaCotizacion");
    const v = cuerpo(conv, 'sb.from("ventas").insert({', "if (ve) {");
    assert.match(v, /cotizacion_origen_id: id,\s+grupo_conversion: claveGrupo,/);
    // Solo la rama B2B las escribe (un contrato B2C o de otro flujo queda sin marca, igual que antes).
    assert.ok(antes(v, "...(planB2BCot && planGrupoB2B", "cotizacion_origen_id: id,"));
    assert.ok(antes(v, "cotizacion_origen_id: id,", ': { canal: "B2C", tipo_asesor: "interno" }'));
    const manejo = cuerpo(conv, "if (ve) {", "const fallarYRevertirGrupo = async");
    assert.match(manejo, /ve\.code === "23505" && \/ux_ventas_conversion_cotizacion_grupo\/\.test\(ve\.message\)/);
    assert.match(manejo, /No se creó un contrato duplicado/);
    // El rechazo ocurre en el insert de la venta: antes de pasajeros, comisión y CxP.
    assert.ok(antes(conv, "if (ve) {", "registrarComisionReserva(sb, numero, planB2BCot.aliado_id)"));
    assert.ok(antes(conv, "if (ve) {", "crear_pasajeros_contrato_multi_con_sillas"));
  });

  test("el catálogo de aliados permite desactivar: la acción solo escribe `activo` cuando viene y la lista lo trae", () => {
    const acciones = leer("app/(dashboard)/dashboard/aliados/actions.ts");
    assert.match(acciones, /if \(patch\.activo !== undefined\) upd\.activo = patch\.activo;/);
    assert.match(leer("app/(dashboard)/dashboard/aliados/page.tsx"), /numero_cuenta, activo"\)/);
  });
});

describe("cobertura exacta antes de numerar (#102)", () => {
  const conv = cuerpo(reservar, "export async function convertirCotizacionCarrito(", "export async function actualizarVigenciaCotizacion");
  test("la conversión verifica, con las unidades de TODOS los grupos, antes de la validación por grupo y de reservar número", () => {
    const iCob = conv.indexOf("verificarCoberturaLineasB2B(");
    assert.ok(iCob > 0, "la conversión llama a verificarCoberturaLineasB2B");
    assert.match(conv, /grupos\.map\(\(g\) => \[\.\.\.g\.items\.map\(\(it\) => it\.ref \?\? ""\), \.\.\.g\.tours\.map\(\(t\) => `tour-\$\{t\.__idx\}`\)\]\)/);
    assert.ok(iCob < conv.indexOf("siguienteNumeroContrato(tenantCotizacion)"), "antes de reservar el número");
    assert.ok(iCob < conv.indexOf("compararLineasConCongeladas(planB2BCot"), "antes de la comparación por grupo");
  });
});
