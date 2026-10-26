// #102 — Cotización asistida B2B del carrito: reglas PURAS (lib/cotizacion/asistidaB2B.ts). Se ejecutan con npm run test:unit.
// Cubre: quién puede asistir (lista explícita), qué ELIGE el navegador, el aliado/% (propio, general, 0 explícito, defecto), el plan congelado en
// PVP con comisión y NETO (base 0, COP/USD), su consistencia al releerlo, la comparación congelado-vs-vivo (porcentaje, impuesto, precio,
// moneda, aliado) y el plan por contrato cuando se convierte "1 contrato por destino".
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  ROLES_ASISTENCIA_B2B, autorizarActorAsistenciaB2B, leerAsistenciaB2BEntrada, evaluarAliadoAsistencia, resolverPctB2B, construirPlanB2B,
  leerPlanB2BDePayload, compararAliadoConCongelado, compararLineasConCongeladas, verificarCoberturaLineasB2B, planDeGrupoB2B, netoTotalExigibleParaDocumento,
  MENSAJE_TERMINOS_CAMBIARON, MENSAJE_COTIZACION_B2B_INVALIDA, MENSAJE_SIN_PERMISO_B2B,
  type AliadoAsistencia, type LineaB2B, type PlanB2BCotizacion,
} from "../lib/cotizacion/asistidaB2B.ts";

const ACTOR = { id: "00000000-0000-0000-0000-000000000102", email: "ana@dspacios.test", rol: "venta" as const };
const ALIADO: AliadoAsistencia = { id: 7, nombre: "Viajes Aurora", tipo: "agencia", pctAliado: 0.1 };
const LINEAS: LineaB2B[] = [
  { clave: "item-0", pvp: 600_000, impuesto: 100_000 },
  { clave: "item-1", pvp: 400_000, impuesto: 100_000 },
  { clave: "tour-0", pvp: 0, impuesto: 0 },
];
const construir = (over: Partial<Parameters<typeof construirPlanB2B>[0]> = {}) =>
  construirPlanB2B({ aliado: ALIADO, pct: 0.1, pctOrigen: "aliado", modo: "comisionable", moneda: "COP", lineas: LINEAS, actor: ACTOR, congeladoEn: "2030-01-01T00:00:00.000Z", ...over });
const plan = (over: Partial<Parameters<typeof construirPlanB2B>[0]> = {}): PlanB2BCotizacion => {
  const r = construir(over);
  assert.ok(r.ok, r.ok ? "" : r.error);
  return r.plan;
};
/** Lo que queda guardado en la base y se relee: JSON ida y vuelta. */
const guardado = (p: PlanB2BCotizacion) => ({ b2bAsistido: JSON.parse(JSON.stringify(p)) as Record<string, unknown> });

describe("quién puede asistir (lista explícita de roles)", () => {
  test("la lista son exactamente superadmin, gerencia, administración, operaciones y venta", () => {
    assert.deepEqual([...ROLES_ASISTENCIA_B2B], ["superadmin", "gerencia", "administracion", "operaciones", "venta"]);
  });

  test("cada rol de la lista, activo y en Mayorista, puede", () => {
    for (const rol of ROLES_ASISTENCIA_B2B) {
      const r = autorizarActorAsistenciaB2B({ rol, activo: true, tenant: "mayorista" });
      assert.equal(r.ok, true, rol);
    }
  });

  test("control_vuelo (interno pero no comercial), aliados y clientes NO pueden", () => {
    for (const rol of ["control_vuelo", "agencia", "freelance", "cliente_final", "publico", "", null, undefined]) {
      const r = autorizarActorAsistenciaB2B({ rol, activo: true, tenant: "mayorista" });
      assert.deepEqual(r, { ok: false, error: MENSAJE_SIN_PERMISO_B2B }, String(rol));
    }
  });

  test("usuario inactivo, sin perfil o con `activo` ambiguo: nadie pasa (ni superadmin)", () => {
    for (const activo of [false, null, undefined]) {
      assert.equal(autorizarActorAsistenciaB2B({ rol: "superadmin", activo, tenant: "mayorista" }).ok, false);
    }
    assert.equal(autorizarActorAsistenciaB2B(null).ok, false);
    assert.equal(autorizarActorAsistenciaB2B(undefined).ok, false);
  });

  test("personal de Minorista no asiste ventas del Tarifario de Mayorista; superadmin sí opera sobre cualquiera", () => {
    assert.equal(autorizarActorAsistenciaB2B({ rol: "venta", activo: true, tenant: "minorista" }).ok, false);
    assert.equal(autorizarActorAsistenciaB2B({ rol: "gerencia", activo: true, tenant: null }).ok, false);
    assert.equal(autorizarActorAsistenciaB2B({ rol: "superadmin", activo: true, tenant: "minorista" }).ok, true);
  });
});

describe("la entrada del navegador solo ELIGE", () => {
  test("sin `asistencia`, null o canal b2c ⇒ cotización B2C de siempre", () => {
    for (const raw of [undefined, null, {}, { asistencia: undefined }, { asistencia: null }, { asistencia: { canal: "b2c" } }, "texto", 7]) {
      assert.deepEqual(leerAsistenciaB2BEntrada(raw), { ok: true, asistencia: null }, JSON.stringify(raw));
    }
  });

  test("b2b válido devuelve SOLO aliado y modalidad: porcentaje, base, comisión o total enviados se ignoran", () => {
    const r = leerAsistenciaB2BEntrada({ asistencia: { canal: "b2b", aliadoId: 7, modo: "neta", pct: 0.99, pctComision: 1, base: 1, comision: 1, total: 1, totalExigible: 1, tipoAsesor: "freelance" } });
    assert.deepEqual(r, { ok: true, asistencia: { aliadoId: 7, modo: "neta" } });
  });

  test("aliado ausente o inválido, modalidad inválida y canal desconocido se rechazan (nunca se vuelve B2C en silencio)", () => {
    const malas: unknown[] = [
      { canal: "b2b", modo: "neta" },
      { canal: "b2b", aliadoId: 0, modo: "neta" },
      { canal: "b2b", aliadoId: -3, modo: "neta" },
      { canal: "b2b", aliadoId: 1.5, modo: "neta" },
      { canal: "b2b", aliadoId: "7", modo: "neta" },
      { canal: "b2b", aliadoId: Number.NaN, modo: "neta" },
      { canal: "b2b", aliadoId: 7 },
      { canal: "b2b", aliadoId: 7, modo: "PVP" },
      { canal: "b2b", aliadoId: 7, modo: "NETO" },
      { canal: "agencia", aliadoId: 7, modo: "neta" },
      { aliadoId: 7, modo: "neta" },
      "b2b",
      [],
    ];
    for (const a of malas) assert.equal(leerAsistenciaB2BEntrada({ asistencia: a }).ok, false, JSON.stringify(a));
  });
});

describe("aliado del catálogo y porcentaje", () => {
  const fila = { id: 7, nombre: " Viajes Aurora ", tipo: "agencia", pct_comision: 0.1, activo: true };

  test("aliado válido: tipo y nombre salen del catálogo", () => {
    const r = evaluarAliadoAsistencia(fila);
    assert.deepEqual(r, { ok: true, aliado: { id: 7, nombre: "Viajes Aurora", tipo: "agencia", pctAliado: 0.1 } });
  });

  test("inexistente, inactivo (false/null/undefined), de otro tipo o sin nombre se rechazan", () => {
    assert.equal(evaluarAliadoAsistencia(null).ok, false);
    assert.equal(evaluarAliadoAsistencia({ ...fila, id: null }).ok, false);
    for (const activo of [false, null, undefined]) {
      const r = evaluarAliadoAsistencia({ ...fila, activo });
      assert.equal(r.ok, false);
      if (!r.ok) assert.match(r.error, /inactivo/);
    }
    for (const tipo of ["otro", "", null, "AGENCIA"]) assert.equal(evaluarAliadoAsistencia({ ...fila, tipo }).ok, false, String(tipo));
    assert.equal(evaluarAliadoAsistencia({ ...fila, nombre: "   " }).ok, false);
  });

  test("porcentaje propio manda; un 0 explícito del aliado se respeta", () => {
    assert.deepEqual(resolverPctB2B(0.15, 0.12, "agencia"), { pct: 0.15, origen: "aliado" });
    assert.deepEqual(resolverPctB2B(0, 0.12, "agencia"), { pct: 0, origen: "aliado" });
    assert.deepEqual(resolverPctB2B("0.2" as unknown as number, 0.12, "agencia"), { pct: 0.2, origen: "aliado" });
  });

  test("sin porcentaje propio (NULL) usa el parámetro general de su tipo; un 0 explícito del parámetro se respeta", () => {
    assert.deepEqual(resolverPctB2B(null, 0.08, "agencia"), { pct: 0.08, origen: "general" });
    assert.deepEqual(resolverPctB2B(undefined, "0.09", "freelance"), { pct: 0.09, origen: "general" });
    assert.deepEqual(resolverPctB2B(null, 0, "freelance"), { pct: 0, origen: "general" });
  });

  test("sin porcentaje propio ni parámetro: 12 % agencia / 11 % freelance, marcado como por defecto", () => {
    assert.deepEqual(resolverPctB2B(null, null, "agencia"), { pct: 0.12, origen: "defecto" });
    assert.deepEqual(resolverPctB2B(null, "", "freelance"), { pct: 0.11, origen: "defecto" });
    assert.deepEqual(resolverPctB2B(null, "no-numero", "agencia"), { pct: 0.12, origen: "defecto" });
  });
});

describe("plan congelado", () => {
  test("PVP con comisión: el comprador paga el PVP, la comisión queda pendiente, base = PVP − impuesto", () => {
    const p = plan();
    assert.equal(p.pvp, 1_000_000);
    assert.equal(p.impuesto, 200_000);
    assert.equal(p.base, 800_000);
    assert.equal(p.comision, 80_000);
    assert.equal(p.comision_estado, "pendiente");
    assert.equal(p.total_exigible, 1_000_000);
    assert.equal(p.modo_compra, "comisionable");
    assert.equal(p.tipo_asesor, "agencia");
    assert.equal(p.aliado_id, 7);
  });

  test("NETO: lo exigible es PVP − comisión y la comisión queda descontada", () => {
    const p = plan({ modo: "neta" });
    assert.equal(p.comision, 80_000);
    assert.equal(p.comision_estado, "descontada");
    assert.equal(p.total_exigible, 920_000);
    assert.equal(p.pvp, 1_000_000);
  });

  test("freelance con porcentaje general (origen registrado)", () => {
    const p = plan({ aliado: { ...ALIADO, tipo: "freelance", pctAliado: null }, pct: 0.11, pctOrigen: "general" });
    assert.equal(p.tipo_asesor, "freelance");
    assert.equal(p.pct_origen, "general");
    assert.equal(p.comision, 88_000);
  });

  test("0 explícito: sin comisión, y en NETO se cobra el PVP completo (nada que descontar)", () => {
    for (const modo of ["comisionable", "neta"] as const) {
      const p = plan({ pct: 0, modo });
      assert.equal(p.comision, 0, modo);
      assert.equal(p.total_exigible, 1_000_000, modo);
    }
  });

  test("base 0 (el impuesto cubre todo el PVP): comisión 0 y total exigible = PVP, nunca negativo", () => {
    const lineas = [{ clave: "item-0", pvp: 500_000, impuesto: 500_000 }];
    for (const modo of ["comisionable", "neta"] as const) {
      const p = plan({ lineas, modo });
      assert.equal(p.base, 0);
      assert.equal(p.comision, 0);
      assert.equal(p.total_exigible, 500_000);
    }
    const mayor = plan({ lineas: [{ clave: "item-0", pvp: 500_000, impuesto: 650_000 }], modo: "neta" });
    assert.equal(mayor.base, 0, "impuesto mayor que el PVP: la base se acota en 0");
    assert.equal(mayor.total_exigible, 500_000);
  });

  test("USD con centavos: sumas a 2 decimales, comisión redondeada como la base (round(base × %))", () => {
    const p = plan({ moneda: "USD", lineas: [{ clave: "item-0", pvp: 1234.56, impuesto: 100.1 }, { clave: "tour-0", pvp: 99.99, impuesto: 0 }], modo: "neta" });
    assert.equal(p.moneda, "USD");
    assert.equal(p.pvp, 1334.55);
    assert.equal(p.impuesto, 100.1);
    assert.equal(p.base, 1234.45);
    assert.equal(p.comision, Math.round(1234.45 * 0.1));
    assert.equal(p.total_exigible, 1334.55 - 123);
  });

  test("rechaza datos imposibles: sin líneas, claves repetidas, importes negativos o no finitos, total 0, porcentaje fuera de 0–100 %", () => {
    assert.equal(construir({ lineas: [] }).ok, false);
    assert.equal(construir({ lineas: [{ clave: "a", pvp: 1, impuesto: 0 }, { clave: "a", pvp: 1, impuesto: 0 }] }).ok, false);
    assert.equal(construir({ lineas: [{ clave: "a", pvp: -1, impuesto: 0 }] }).ok, false);
    assert.equal(construir({ lineas: [{ clave: "a", pvp: Number.NaN, impuesto: 0 }] }).ok, false);
    assert.equal(construir({ lineas: [{ clave: "a", pvp: 100, impuesto: -5 }] }).ok, false);
    assert.equal(construir({ lineas: [{ clave: "a", pvp: 0, impuesto: 0 }] }).ok, false);
    assert.equal(construir({ pct: -0.01 }).ok, false);
    assert.equal(construir({ pct: 1.01 }).ok, false);
    assert.equal(construir({ pct: Number.NaN }).ok, false);
  });

  test("la comisión es exactamente la de planComisionReserva / la base: Math.round(base × %) (espejo de registrar_comision_b2b_reserva)", () => {
    for (const [pvp, imp, pct] of [[1_000_000, 200_000, 0.12], [999_999, 1, 0.115], [3_333_333, 333_333, 0.0875], [250_000, 0, 0.11]] as const) {
      const p = plan({ lineas: [{ clave: "a", pvp, impuesto: imp }], pct });
      assert.equal(p.comision, Math.round(Math.max(pvp - imp, 0) * pct));
    }
  });
});

describe("releer el plan guardado (la cotización viaja como JSON)", () => {
  test("ida y vuelta: el plan se relee igual", () => {
    const p = plan({ modo: "neta" });
    const r = leerPlanB2BDePayload(guardado(p));
    assert.ok(r.ok && r.plan);
    assert.deepEqual(r.plan, p);
  });

  test("sin bloque `b2bAsistido` (o null) ⇒ cotización B2C/legada: ningún plan", () => {
    for (const payload of [{}, { items: [] }, { b2bAsistido: null }, null, undefined, "x"]) {
      assert.deepEqual(leerPlanB2BDePayload(payload), { ok: true, plan: null });
    }
  });

  test("bloque presente pero ilegible o manipulado ⇒ error (jamás se convierte como B2C)", () => {
    const base = guardado(plan({ modo: "neta" })).b2bAsistido;
    const retoca = (cambio: Record<string, unknown>) => leerPlanB2BDePayload({ b2bAsistido: { ...base, ...cambio } });
    const casos: Record<string, Record<string, unknown>> = {
      "comisión alterada": { comision: 1 },
      "porcentaje alterado": { pct: 0.5 },
      "total exigible alterado": { total_exigible: 1_000_000 },
      "base alterada": { base: 999_999 },
      "pvp alterado": { pvp: 5 },
      "impuesto alterado": { impuesto: 0 },
      "modalidad cambiada a PVP con la misma comisión": { modo_compra: "comisionable" },
      "estado de comisión incoherente": { comision_estado: "pendiente" },
      "versión desconocida": { version: 2 },
      "aliado inválido": { aliado_id: 0 },
      "tipo inválido": { tipo_asesor: "otro" },
      "origen inválido": { pct_origen: "navegador" },
      "moneda vacía": { moneda: "" },
      "líneas ausentes": { lineas: undefined },
      "líneas vacías": { lineas: [] },
      "línea sin clave": { lineas: [{ clave: "", pvp: 1, impuesto: 0 }] },
      "autor inválido": { asistido_por: { id: "x", email: null, rol: "control_vuelo" } },
      "porcentaje fuera de rango": { pct: 2 },
    };
    for (const [nombre, cambio] of Object.entries(casos)) {
      const r = retoca(cambio);
      assert.deepEqual(r, { ok: false, error: MENSAJE_COTIZACION_B2B_INVALIDA }, nombre);
    }
    assert.equal(leerPlanB2BDePayload({ b2bAsistido: "texto" }).ok, false);
    assert.equal(leerPlanB2BDePayload({ b2bAsistido: [] }).ok, false);
  });
});

describe("conversión: lo congelado contra lo vivo", () => {
  const p = plan();

  test("mismo aliado, tipo y porcentaje ⇒ pasa", () => {
    assert.deepEqual(compararAliadoConCongelado(p, { aliadoId: 7, tipo: "agencia", pct: 0.1 }), { ok: true });
    assert.deepEqual(compararAliadoConCongelado(p, { aliadoId: 7, tipo: "agencia", pct: 0.1 + 1e-12 }), { ok: true });
  });

  test("cambió el porcentaje (aunque sea a 0), el aliado o su tipo ⇒ se rechaza con el mensaje de términos cambiados", () => {
    for (const vivo of [
      { aliadoId: 7, tipo: "agencia" as const, pct: 0.12 },
      { aliadoId: 7, tipo: "agencia" as const, pct: 0 },
      { aliadoId: 8, tipo: "agencia" as const, pct: 0.1 },
      { aliadoId: 7, tipo: "freelance" as const, pct: 0.1 },
    ]) {
      assert.deepEqual(compararAliadoConCongelado(p, vivo), { ok: false, error: MENSAJE_TERMINOS_CAMBIARON }, JSON.stringify(vivo));
    }
  });

  test("unidades con el mismo PVP e impuesto ⇒ pasa; un precio, un impuesto o la moneda distintos ⇒ se rechaza", () => {
    assert.deepEqual(compararLineasConCongeladas(p, LINEAS, "COP"), { ok: true });
    const cambio = (i: number, c: Partial<LineaB2B>) => LINEAS.map((l, n) => (n === i ? { ...l, ...c } : l));
    assert.equal(compararLineasConCongeladas(p, cambio(0, { pvp: 600_001 }), "COP").ok, false, "precio");
    assert.equal(compararLineasConCongeladas(p, cambio(1, { impuesto: 0 }), "COP").ok, false, "impuesto");
    assert.equal(compararLineasConCongeladas(p, LINEAS, "USD").ok, false, "moneda");
    const sinCongelada = compararLineasConCongeladas(p, [{ clave: "item-9", pvp: 1, impuesto: 0 }], "COP");
    assert.deepEqual(sinCongelada, { ok: false, error: MENSAJE_COTIZACION_B2B_INVALIDA });
  });

  test("un subconjunto de unidades (un contrato por destino) se compara solo contra sus propias líneas", () => {
    assert.deepEqual(compararLineasConCongeladas(p, [LINEAS[1]], "COP"), { ok: true });
  });
});

describe("1 contrato por destino: plan de cada contrato con los términos congelados", () => {
  test("PVP con comisión: cada contrato conserva su PVP; las comisiones suman la del plan completo", () => {
    const p = plan();
    const a = planDeGrupoB2B(p, [LINEAS[0]]);
    const b = planDeGrupoB2B(p, [LINEAS[1], LINEAS[2]]);
    assert.ok(a.ok && b.ok);
    if (!a.ok || !b.ok) return;
    assert.equal(a.plan.precioFinal, 600_000);
    assert.equal(b.plan.precioFinal, 400_000);
    assert.equal(a.plan.comision, 50_000);
    assert.equal(b.plan.comision, 30_000);
    assert.equal((a.plan.comision ?? 0) + (b.plan.comision ?? 0), p.comision);
    assert.equal(a.plan.comisionEstado, "pendiente");
  });

  test("NETO: cada contrato cobra su PVP menos su comisión; los exigibles suman el del plan completo", () => {
    const p = plan({ modo: "neta" });
    const a = planDeGrupoB2B(p, [LINEAS[0]]);
    const b = planDeGrupoB2B(p, [LINEAS[1], LINEAS[2]]);
    assert.ok(a.ok && b.ok);
    if (!a.ok || !b.ok) return;
    assert.equal(a.plan.precioFinal, 550_000);
    assert.equal(b.plan.precioFinal, 370_000);
    assert.equal(a.plan.precioFinal + b.plan.precioFinal, p.total_exigible);
    assert.equal(a.plan.comisionEstado, "descontada");
  });

  test("un solo contrato con todo coincide EXACTAMENTE con el plan congelado", () => {
    for (const modo of ["comisionable", "neta"] as const) {
      const p = plan({ modo });
      const g = planDeGrupoB2B(p, LINEAS);
      assert.ok(g.ok);
      if (!g.ok) return;
      assert.equal(g.plan.comision, p.comision);
      assert.equal(g.plan.precioFinal, p.total_exigible);
      assert.equal(g.plan.base, p.base);
    }
  });

  test("el redondeo por contrato difiere del agregado en menos de una unidad por contrato", () => {
    const lineas = [{ clave: "a", pvp: 100_005, impuesto: 0 }, { clave: "b", pvp: 100_005, impuesto: 0 }];
    const p = plan({ lineas, pct: 0.115 });
    const a = planDeGrupoB2B(p, [lineas[0]]);
    const b = planDeGrupoB2B(p, [lineas[1]]);
    assert.ok(a.ok && b.ok);
    if (!a.ok || !b.ok) return;
    assert.ok(Math.abs((a.plan.comision ?? 0) + (b.plan.comision ?? 0) - p.comision) <= 1);
  });

  test("grupo vacío o con importes inválidos se rechaza", () => {
    const p = plan();
    assert.equal(planDeGrupoB2B(p, []).ok, false);
    assert.equal(planDeGrupoB2B(p, [{ clave: "x", pvp: -1, impuesto: 0 }]).ok, false);
  });
});

describe("documento externo", () => {
  test("solo NETO expone un único dato al documento del comprador: el total exigible (nunca PVP ni comisión)", () => {
    const neta = plan({ modo: "neta" });
    assert.equal(netoTotalExigibleParaDocumento(neta), 920_000);
    assert.equal(netoTotalExigibleParaDocumento(plan({ modo: "comisionable" })), null);
    assert.equal(netoTotalExigibleParaDocumento(null), null);
    assert.equal(typeof netoTotalExigibleParaDocumento(neta), "number");
  });
});

describe("cobertura exacta de las unidades contra las líneas congeladas (antes de reservar número)", () => {
  const p = () => plan();
  const MAL = { ok: false, error: MENSAJE_COTIZACION_B2B_INVALIDA };

  test("un solo contrato: todas las unidades, una vez cada una", () => {
    assert.deepEqual(verificarCoberturaLineasB2B(p(), [["item-0", "item-1", "tour-0"]]), { ok: true });
  });

  test("«por destino»: los grupos suman, en cualquier orden, exactamente el conjunto congelado", () => {
    assert.deepEqual(verificarCoberturaLineasB2B(p(), [["item-1"], ["tour-0", "item-0"]]), { ok: true });
    assert.deepEqual(verificarCoberturaLineasB2B(p(), [["item-0"], ["item-1"], ["tour-0"]]), { ok: true });
  });

  test("falta una unidad (p. ej. un tour quitado del payload), aunque cada grupo por separado pareciera válido", () => {
    assert.deepEqual(verificarCoberturaLineasB2B(p(), [["item-0", "item-1"]]), MAL);
    assert.deepEqual(verificarCoberturaLineasB2B(p(), [["item-0"], ["item-1"]]), MAL);
  });

  test("una unidad repetida (en el mismo grupo o en dos grupos) o ajena al plan", () => {
    assert.deepEqual(verificarCoberturaLineasB2B(p(), [["item-0", "item-1", "tour-0", "tour-0"]]), MAL);
    assert.deepEqual(verificarCoberturaLineasB2B(p(), [["item-0", "item-1"], ["item-1", "tour-0"]]), MAL);
    assert.deepEqual(verificarCoberturaLineasB2B(p(), [["item-0", "item-1", "tour-0", "item-9"]]), MAL);
    assert.deepEqual(verificarCoberturaLineasB2B(p(), [["item-0", "item-1", "tour-9"]]), MAL, "mismo conteo pero una clave distinta");
  });

  test("clave vacía (ítem sin ref) o sin ninguna unidad", () => {
    assert.deepEqual(verificarCoberturaLineasB2B(p(), [["", "item-1", "tour-0"]]), MAL);
    assert.deepEqual(verificarCoberturaLineasB2B(p(), []), MAL);
  });
});
