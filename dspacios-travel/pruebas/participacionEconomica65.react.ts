// Se ejecuta con npm run test:react (loader del arnés).
//
// #65 — Participación por comisión: solo una fila de aliados_b2b con comisión ECONÓMICA real da visibilidad.
// La definición es la del cálculo del portal (`calcularComisionFila(...).totalPagar > 0`), no una regla aparte.
//
// REAL vs SINTÉTICO (precheck real, 1-nov-2026). REAL, y solo esto: los ids y contratos (1, 100, 101, 121, 135, 137; 0476/0498/0519),
// el importe de la fila 137 ($139.000) y su abono REGISTRADO de $139.000 (= el total: saldo 0, NO $39.000), que la fila 135 de Yaqueline
// tiene ficha NULL (y un abono registrado de $351.852,16 que aquí NO se reproduce), que Javier es la ficha 8 y que en la fila 1 los
// abonos (1.617.580) superan el total (1.260.903,68). SINTÉTICO: los importes de 100/101/1/121/135, los nombres «Aliado N», la venta
// MIN-X-CERO y el sobrepago de la 121 (el real está en la fila 1, que no tiene ficha y por eso el portal no lo muestra).
//
// TRES COSAS DISTINTAS: (1) ASIGNACIÓN confirmada (a qué ficha debe ir una fila; 135→37 y 137→37 confirmadas por el dueño) · (2) ABONO REGISTRADO (lo que
// hay en comision_b2b_pagos) · (3) DESTINATARIO DEL PAGO, que sigue DESCONOCIDO. El «Pagada» del portal sale de (2); no prueba (3).
// REGLA DE LA LÍNEA 1 (dueño, 1-nov-2026): la comisión se paga a la persona de la línea 1 (menor id del contrato); Javier figura en la línea 2 porque asistió.
// En 0462 la línea 1 es Tatiana (#79, ficha 3) y NO se cambia a Javier; #80 (Javier, línea 2; total y abono registrado de $142.494) → ficha 3: asignación CONFIRMADA, pero EXCLUIDA
// del UPDATE hasta conciliar a quién se pagó su abono (destinatario desconocido). Estas pruebas no asignan ni cambian nada.
// Estas pruebas fijan lo que el portal muestra HOY y no afirman que los pagos hayan llegado a nadie. #415 no excluye ids en el código.
//
// CORRECCIÓN: una versión anterior de esta prueba trataba la fila de Javier en MIN-00-0519 como una fila en CERO. Es falso:
// el resultado real de la auditoría muestra la fila 137 con $139.000 y un abono. Aquí se reproduce el importe positivo real.
// Los COMPONENTES exactos de esos $139.000 salen del script de auditoría; la prueba usa dos descomposiciones equivalentes
// (solo recobro / solo comisión base) y el resultado no depende de cuál sea.
//
// Esta prueba FIJA el comportamiento ACTUAL del portal (no lo cambia): una fila positiva con la ficha del aliado da
// participación, incluso cuando el beneficiario es una persona de doble rol (Javier). Qué filas son comisión B2B y cuáles
// segunda comisión interna lo decide el dueño (docs/tecnico/comisiones-aliado-vs-interna-65.md); hasta entonces no se toca.
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";

const { contratosPorParticipacion } = await import("../lib/auth/participacionComisionB2B.ts");
const { cargarConjuntoPortal } = await import("../lib/portal/b2bPortalServidor.ts");
const { calcularComisionFila } = await import("../lib/finanzas/comisionB2B.ts");
const { default: PortalVentas } = await import("../app/portal/b2b/ventas/page.tsx");
const { default: PortalCartera } = await import("../app/portal/b2b/cartera/page.tsx");
const { default: PortalDocumentos } = await import("../app/portal/b2b/documentos/page.tsx");
const { supabaseEnMemoria } = await import("./support/memoriaSupabase.ts");
const { __setClient, __resetClient } = await import("./support/stubs/supabaseServerStub.mjs");
const { __setAdmin, __resetAdmin } = await import("./support/stubs/supabaseAdminStub.mjs");

type Fila = Record<string, unknown>;
afterEach(() => { __resetClient(); __resetAdmin(); });

const venta = (numero: string, aliadoId: number | null, extra: Fila = {}): Fila => ({
  numero_contrato: numero, tenant: "minorista", cliente: `Cliente ${numero}`, destino: "SMR", fecha_salida: "2026-12-01",
  estado: "confirmado", precio_venta: 2_000_000, moneda: "COP", b2b_usuario_id: null, aliado_id: aliadoId,
  agencia_nombre: null, freelance_nombre: null, tipo_asesor: "freelance", modo_compra: "comisionable", comision_b2b: null, comision_estado: null, ...extra,
});
const fila = (id: number, numero: string, aliadoId: number | null, extra: Fila = {}): Fila => ({
  id, numero_contrato: numero, tenant: "minorista", aliado: `Aliado ${aliadoId}`, tipo_aliado: "freelance", aliado_id: aliadoId,
  precio_venta: 2_000_000, base_comision: 0, base_explicita: false, comision_valor: null, pct_comision: 0,
  recobro_total: 0, pct_recobro_aliado: 0, aplica_retencion: false, pct_retencion: 0, estado: "pendiente", descontada_en_precio: false, ...extra,
});
const BASE = { base_comision: 1_000_000, base_explicita: true };
/** $139.000 por la vía del recobro (278.000 × 50 %), con base y % en cero: la fila es positiva SOLO por el recobro. */
const IMPORTE_139_RECOBRO = { recobro_total: 278_000, pct_recobro_aliado: 0.5 };
/** $139.000 por la vía de la comisión base (1.390.000 × 10 %). */
const IMPORTE_139_BASE = { base_comision: 1_390_000, base_explicita: true, pct_comision: 0.1 };

const usuario = (id: string, nombre: string, rol: string, aliadoId: number | null): Fila =>
  ({ id, nombre, rol, activo: true, tenant: "minorista", agencia_id: null, pct_comision: null, aliado_id: aliadoId, acceso_legacy_nombre: false });

/** Los tres casos reales de la auditoría + una venta de control + una fila genuinamente en cero (sintética, otro número). */
function tablas(importe0519: Fila = IMPORTE_139_RECOBRO): Record<string, Fila[]> {
  return {
    usuarios: [usuario("u-yaq", "Yaqueline", "freelance", 37), usuario("u-jav", "Javier", "freelance", 8), usuario("u-ter", "Tercero", "agencia", 9)],
    aliados: [{ id: 37, nombre: "Yaqueline", nit: "37" }, { id: 8, nombre: "JAVIER A VIEIRA P", nit: "8" }, { id: 9, nombre: "Tercero", nit: "9" }],
    ventas: [
      venta("MIN-00-0476", 9),                        // de un tercero; Javier con DOS filas (100 y 101)
      venta("MIN-00-0498", 8),                        // de Javier; fila 1 sin ficha «JAVIER VIEIRA» y fila 121 con ficha 8
      venta("MIN-00-0519", 37),                       // de Yaqueline; Javier con la fila 137 de $139.000 y un abono
      venta("MIN-X-CERO", 9),                         // SINTÉTICA: una fila genuinamente en cero
    ],
    aliados_b2b: [
      fila(100, "MIN-00-0476", 8, { aliado: "JAVIER A VIEIRA P", ...BASE, pct_comision: 0.05 }),
      fila(101, "MIN-00-0476", 8, { aliado: "JAVIER A VIEIRA P", recobro_total: 100_000, pct_recobro_aliado: 0.5 }),
      fila(1, "MIN-00-0498", null, { aliado: "JAVIER VIEIRA", ...BASE, pct_comision: 0.04 }),
      fila(121, "MIN-00-0498", 8, { aliado: "JAVIER A VIEIRA P", ...BASE, pct_comision: 0.03 }),
      fila(135, "MIN-00-0519", null, { aliado: "Yaqueline", ...BASE, pct_comision: 0.1 }),   // REAL: ficha NULL (importe sintético)
      fila(137, "MIN-00-0519", 8, { aliado: "JAVIER A VIEIRA P", ...importe0519 }),
      fila(900, "MIN-X-CERO", 8),                     // base 0, pct 0, valor null, sin recobro → total 0
    ],
    // REAL: la 137 registra un abono de $139.000 (= su total).
    comision_b2b_pagos: [{ id: 1, aliado_b2b_id: 137, valor: 139_000, fecha: "2026-10-05" }],
  };
}
const ctx = (userId: string, aliadoId: number, rol: "agencia" | "freelance" = "freelance") => ({
  estado: "ok" as const, userId, email: `${userId}@t.test`, nombre: userId, rol, tenant: "minorista",
  aliadoId, accesoLegacyNombre: false, agenciaId: null, pctPerfil: null, esTitularAgencia: false,
});
const montar = (t: Record<string, Fila[]>, sesion = "u") => { __setAdmin(supabaseEnMemoria(t)); __setClient(supabaseEnMemoria(t, {}, sesion)); };
const nums = (c: { ventas: { numero_contrato: string; relacion: string }[] }, rel: string) => c.ventas.filter((v) => v.relacion === rel).map((v) => v.numero_contrato).sort();
const texto = (n: unknown): string => {
  if (n == null || typeof n === "boolean") return "";
  if (typeof n === "string" || typeof n === "number") return String(n);
  if (Array.isArray(n)) return n.map(texto).join(" ");
  return texto((n as { props?: { children?: unknown } }).props?.children);
};
const hrefs = (n: unknown, out: string[] = []): string[] => {
  if (!n || typeof n !== "object") return out;
  if (Array.isArray(n)) { n.forEach((h) => hrefs(h, out)); return out; }
  const p = (n as { props?: { href?: string; children?: unknown } }).props;
  if (typeof p?.href === "string") out.push(p.href);
  return hrefs(p?.children, out);
};
const pantalla = async (t: Record<string, Fila[]>, sesion: string, pagina: () => Promise<unknown>) => { montar(t, sesion); return texto(await pagina()).replace(/\s+/g, " "); };

for (const [nombre, importe] of [["solo recobro", IMPORTE_139_RECOBRO], ["solo comisión base", IMPORTE_139_BASE]] as const) {
  test(`MIN-00-0519 (fila 137 = $139.000, ${nombre}, abono REAL de $139.000): la fila es POSITIVA; con el código actual Javier SÍ la ve como participación, con saldo $0 y «Pagada»`, async () => {
    const t = tablas(importe);
    assert.equal(calcularComisionFila(t.aliados_b2b.find((f) => f.id === 137) as never).totalPagar, 139_000);
    montar(t, "u-jav");
    const jav = await cargarConjuntoPortal(ctx("u-jav", 8) as never);
    assert.ok(nums(jav, "participacion").includes("MIN-00-0519"), "Javier la ve como participación");
    assert.ok(!nums(jav, "propio").includes("MIN-00-0519"), "pero NO como contrato propio");
    // Su importe es el SALDO de SU fila: 139.000 − 139.000 de abono REGISTRADO = 0 (la fila de Yaqueline no se mezcla). Sigue visible aunque no deba nada.
    // «pagada» es el estado derivado del abono registrado; el destinatario real de ese pago es desconocido (sin conciliar).
    const com = jav.comisiones.get("MIN-00-0519");
    assert.equal(com?.importe, 0);
    assert.equal(com?.estado, "pagada");
    assert.deepEqual(com?.ids, [137]);
    // Yaqueline conserva su contrato propio; la fila de Javier no le da nada más.
    montar(t, "u-yaq");
    const yaq = await cargarConjuntoPortal(ctx("u-yaq", 37) as never);
    assert.deepEqual(nums(yaq, "propio"), ["MIN-00-0519"]);
    assert.deepEqual(nums(yaq, "participacion"), []);
    // Su fila 135 tiene ficha NULL y no trae su documento: el portal NO se la atribuye (falla cerrado). Ve su contrato SIN comisión.
    assert.equal(yaq.comisiones.get("MIN-00-0519")?.importe ?? null, null, "Yaqueline no ve su comisión mientras la 135 no tenga ficha");
  });
}

test("MIN-00-0519, lo que Javier alcanza a VER en pantalla: contrato, destino, estado y su comisión; NO cliente, cartera, documentos ni cuenta de cobro", async () => {
  const t = tablas();
  montar(t, "u-jav");
  const enlaces = hrefs(await PortalVentas({ searchParams: Promise.resolve({ vista: "asistidas" }) }));
  assert.ok(!enlaces.some((h) => /0519/.test(h)), "ningún enlace (cuenta de cobro, estado de cuenta, documentos) lleva a MIN-00-0519");
  const ventas = await pantalla(t, "u-jav", () => PortalVentas({ searchParams: Promise.resolve({ vista: "asistidas" }) }));
  assert.ok(ventas.includes("0519"), "aparece en Mis ventas");
  assert.match(ventas, /Participación por comisión/);
  assert.ok(!ventas.includes("Cliente MIN-00-0519"), "sin nombre del cliente");
  assert.match(ventas, /Pagada/, "su fila 137 está pagada por completo (abono $139.000)");
  assert.ok(!/Abono parcial/.test(ventas), "ya no es «Abono parcial»");
  const cartera = await pantalla(t, "u-jav", () => PortalCartera({ searchParams: Promise.resolve({}) }));
  const docs = await pantalla(t, "u-jav", () => PortalDocumentos());
  for (const s of [cartera, docs]) assert.ok(!s.includes("0519") && !s.includes("0476"), "cartera y documentos solo de contratos propios");
});

test("MIN-00-0519 en el INICIO de Javier: aparece como «Solo comisión» y sin nombre de cliente", async () => {
  const { default: PortalInicio } = await import("../app/portal/b2b/page.tsx");
  const t = tablas({ ...IMPORTE_139_RECOBRO });
  const inicio = await pantalla(t, "u-jav", () => PortalInicio({ searchParams: Promise.resolve({ contratos: "asistidas" }) }));
  assert.ok(inicio.includes("0519"));
  assert.match(inicio, /Participación por comisión/);
  assert.match(inicio, /Solo comisión/);
  assert.ok(!inicio.includes("Cliente MIN-00-0519"));
});

test("los tres casos reales para Javier: 0476 y 0519 son participación (ajenos), 0498 es propio; cada fila positiva suma en SU importe", async () => {
  const t = tablas(); montar(t, "u-jav");
  const jav = await cargarConjuntoPortal(ctx("u-jav", 8) as never);
  assert.deepEqual(nums(jav, "participacion"), ["MIN-00-0476", "MIN-00-0519"]);
  assert.deepEqual(nums(jav, "propio"), ["MIN-00-0498"]);
  // 0476: las dos filas son suyas (misma ficha) y el portal las SUMA: 50.000 + 50.000.
  assert.equal(jav.comisiones.get("MIN-00-0476")?.importe, 100_000);
  assert.deepEqual(jav.comisiones.get("MIN-00-0476")?.ids, [100, 101]);
  // 0498: la fila 121 (ficha 8) es suya; la fila 1 «JAVIER VIEIRA» no tiene ficha ni documento que la ligue → NO se suma sola por nombre.
  assert.deepEqual(jav.comisiones.get("MIN-00-0498")?.ids, [121]);
  assert.equal(jav.comisiones.get("MIN-00-0498")?.importe, 30_000);
});

test("PRECHECK REAL (20 líneas: totales y abonos registrados REALES; cuentas y titular de cada venta sintéticos): hoy el portal muestra a Javier participación en ocho contratos donde la línea 1 es de otra persona; cada asesor ve solo su línea 1", async () => {
  // [contrato, fila, ficha ACTUAL, total de la línea, abonos registrados]. Fuente: consulta completa del 1-nov-2026.
  const LINEAS: [string, number, number | null, number, number][] = [
    ["MIN-00-0422", 44, 33, 857_197, 857_197], ["MIN-00-0422", 81, 8, 599_964, 600_000],
    ["MIN-00-0432", 53, 1, 768_949.2, 768_949.2], ["MIN-00-0432", 82, 8, 141_360, 141_360],
    ["MIN-00-0433", 54, 1, 1_808_519.68, 1_808_519.68], ["MIN-00-0433", 83, 8, 541_036, 541_036],   // 83 y 85 tienen 2 abonos reales; aquí uno solo por el total
    ["MIN-00-0439", 59, 24, 693_266.64, 693_266.64], ["MIN-00-0439", 85, 8, 140_180, 140_180],
    ["MIN-00-0462", 79, 3, 191_224, 191_224], ["MIN-00-0462", 80, 8, 142_494, 142_494],
    ["MIN-00-0463", 88, 28, 172_629.6, 172_629.6], ["MIN-00-0463", 89, 8, 207_831, 207_831],
    ["MIN-00-0476", 100, 8, 484_747.56, 484_748], ["MIN-00-0476", 101, 8, 349_782, 350_000],
    ["MIN-00-0484", 106, 7, 125_468.2, 125_469], ["MIN-00-0484", 107, 8, 71_296.5, 71_297],
    ["MIN-00-0498", 1, null, 1_260_903.68, 1_617_580], ["MIN-00-0498", 121, 8, 137_747, 137_747],
    ["MIN-00-0519", 135, null, 351_852.16, 351_852.16], ["MIN-00-0519", 137, 8, 139_000, 139_000],
  ];
  // SINTÉTICO: titular de la venta = persona de la línea 1 (el ventas.aliado_id real no consta).
  const DUENO: Record<string, number> = {
    "MIN-00-0422": 33, "MIN-00-0432": 1, "MIN-00-0433": 1, "MIN-00-0439": 24, "MIN-00-0462": 3,
    "MIN-00-0463": 28, "MIN-00-0476": 8, "MIN-00-0484": 7, "MIN-00-0498": 8, "MIN-00-0519": 37,
  };
  const fichas = [1, 3, 7, 8, 24, 28, 33, 37];
  const t: Record<string, Fila[]> = {
    usuarios: fichas.map((f) => usuario(`u-${f}`, `Ficha ${f}`, "freelance", f)),
    aliados: fichas.map((id) => ({ id, nombre: `Ficha ${id}`, nit: String(id) })),
    ventas: Object.entries(DUENO).map(([n, d]) => venta(n, d)),
    aliados_b2b: LINEAS.map(([n, id, ficha, total]) => fila(id, n, ficha, { comision_valor: total })),   // total = comision_valor (sin base ni recobro)
    comision_b2b_pagos: LINEAS.map(([, id, , , abonado], i) => ({ id: i + 1, aliado_b2b_id: id, valor: abonado, fecha: "2026-10-05" })),
  };
  const ver = async (f: number) => { montar(t, `u-${f}`); return cargarConjuntoPortal(ctx(`u-${f}`, f) as never); };

  const jav = await ver(8);
  assert.deepEqual(nums(jav, "propio"), ["MIN-00-0476", "MIN-00-0498"], "Javier es la línea 1 solo de 0476 y 0498");
  assert.deepEqual(nums(jav, "participacion"), ["MIN-00-0422", "MIN-00-0432", "MIN-00-0433", "MIN-00-0439", "MIN-00-0462", "MIN-00-0463", "MIN-00-0484", "MIN-00-0519"]);
  const idsJav: Record<string, number[]> = { "MIN-00-0422": [81], "MIN-00-0432": [82], "MIN-00-0433": [83], "MIN-00-0439": [85], "MIN-00-0462": [80], "MIN-00-0463": [89], "MIN-00-0476": [100, 101], "MIN-00-0484": [107], "MIN-00-0498": [121], "MIN-00-0519": [137] };
  for (const [n, ids] of Object.entries(idsJav)) {
    assert.deepEqual(jav.comisiones.get(n)?.ids, ids, `${n}: líneas de Javier`);
    assert.equal(jav.comisiones.get(n)?.importe, 0, `${n}: saldo 0 (abonos registrados >= total)`);
    assert.equal(jav.comisiones.get(n)?.estado, "pagada", `${n}: «pagada» sale del abono REGISTRADO; el destinatario del abono sigue desconocido`);
  }
  // La persona de la línea 1 ve SU línea (y solo esa) como contrato propio; Yaqueline no ve nada de la 135 (sin ficha).
  const linea1: [number, string, number][] = [[33, "MIN-00-0422", 44], [1, "MIN-00-0432", 53], [24, "MIN-00-0439", 59], [3, "MIN-00-0462", 79], [28, "MIN-00-0463", 88], [7, "MIN-00-0484", 106]];
  for (const [f, n, id] of linea1) {
    const c = await ver(f);
    assert.ok(nums(c, "propio").includes(n), `ficha ${f}: ${n} propio`);
    assert.deepEqual(c.comisiones.get(n)?.ids, [id], `ficha ${f}: solo su línea 1 (#${id})`);
    assert.deepEqual(nums(c, "participacion"), [], `ficha ${f}: sin participaciones ajenas`);
  }
  const k = await ver(1);
  assert.deepEqual(k.comisiones.get("MIN-00-0433")?.ids, [54]);
  const yaq = await ver(37);
  assert.deepEqual(nums(yaq, "propio"), ["MIN-00-0519"]);
  assert.equal(yaq.comisiones.get("MIN-00-0519")?.importe ?? null, null, "la 135 sin ficha: Yaqueline no ve su comisión (faltante, no fuga)");
  // Ninguna asignación ni dato cambia por leer.
  const antes = JSON.stringify(t); await ver(8); assert.equal(JSON.stringify(t), antes);
});

test("SINTÉTICO: abonos mayores al total (sobrepago, como la fila 1 real) no dan saldo negativo: saldo 0 y «pagada»; el exceso no se muestra", async () => {
  const t = tablas();
  t.comision_b2b_pagos.push({ id: 2, aliado_b2b_id: 121, valor: 40_000, fecha: "2026-10-06" });   // sintético: 40.000 sobre un total de 30.000
  montar(t, "u-jav");
  const jav = await cargarConjuntoPortal(ctx("u-jav", 8) as never);
  // 0498: fila 121 total 30.000 con abono de 40.000 → el portal lo recorta a 0 y no avisa del exceso (eso es de Contabilidad).
  assert.equal(jav.comisiones.get("MIN-00-0498")?.importe, 0);
  assert.equal(jav.comisiones.get("MIN-00-0498")?.estado, "pagada");
});

test("una fila genuinamente en CERO (sintética) no da participación; las positivas con ficha sí", async () => {
  const t = tablas(); montar(t, "u-jav");
  const jav = await cargarConjuntoPortal(ctx("u-jav", 8) as never);
  assert.ok(!jav.ventas.some((v) => v.numero_contrato === "MIN-X-CERO"));
  assert.ok(nums(jav, "participacion").length > 0);
});

test("misma definición económica que el cálculo del portal: una fila cuenta si y solo si calcularComisionFila().totalPagar > 0", async () => {
  const t = tablas();
  for (const f of t.aliados_b2b.filter((x) => x.aliado_id != null)) {
    const r = await contratosPorParticipacion(supabaseEnMemoria(t) as never, f.aliado_id as number, "numero_contrato", new Set());
    const visible = r.filas.some((x) => x.numero_contrato === f.numero_contrato);
    const hayPositivaSuya = t.aliados_b2b.some((g) => g.aliado_id === f.aliado_id && g.numero_contrato === f.numero_contrato && calcularComisionFila(g as never).totalPagar > 0);
    assert.equal(visible, hayPositivaSuya, `fila ${f.id}`);
  }
});

test("lecturas fallidas: sin comisión legible o sin ventas legibles no se muestra participación y se avisa (fail-closed)", async () => {
  for (const tabla of ["aliados_b2b", "ventas"]) {
    for (const fallo of ["error", "sin_conteo"] as const) {
      const db = supabaseEnMemoria(tablas(), { fallar: (c: { tabla: string }) => (c.tabla === tabla ? fallo : null) });
      assert.deepEqual(await contratosPorParticipacion(db as never, 8, "numero_contrato", new Set()), { filas: [], completa: false }, `${tabla}/${fallo}`);
    }
  }
});

test("no modifica filas, importes ni abonos: las tablas quedan idénticas tras leer", async () => {
  const t = tablas(); const antes = JSON.parse(JSON.stringify(t));
  montar(t, "u-jav");
  await cargarConjuntoPortal(ctx("u-jav", 8) as never);
  await contratosPorParticipacion(supabaseEnMemoria(t) as never, 8, "numero_contrato, aliado_id", new Set());
  assert.deepEqual(t, antes);
});

test("cada aliado conserva SOLO su acceso: la participación de otro no se filtra y Yaqueline/Tercero no ven las filas de Javier", async () => {
  const t = tablas();
  montar(t, "u-yaq");
  assert.deepEqual(nums(await cargarConjuntoPortal(ctx("u-yaq", 37) as never), "participacion"), [], "Yaqueline: sin participaciones");
  montar(t, "u-ter");
  const ter = await cargarConjuntoPortal(ctx("u-ter", 9, "agencia") as never);
  assert.deepEqual(nums(ter, "propio"), ["MIN-00-0476", "MIN-X-CERO"]);
  assert.deepEqual(nums(ter, "participacion"), [], "el tercero no cobra comisión en ninguno de los tres casos");
  assert.equal(ter.comisiones.get("MIN-00-0476")?.importe ?? null, null, "no ve el importe de las filas de Javier");
});
