// #14-A — reglas puras del recobro del carrito. Los ejemplos numéricos son los acordados con el dueño; las propiedades comprueban exactitud (nada de dinero sin asignar).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { participacionAliado } from "../lib/cotizacion/acuerdoComision.ts";
import { acuerdosPorContrato, pctParticipacionDeParametro, repartirRecobroEntreAdultos, tarifasNetoPorPersona, validarRecobro, type PersonaNeto } from "../lib/cotizacion/recobroCarrito.ts";

const c = (pesos: number) => BigInt(Math.round(pesos * 100));
const suma = (xs: readonly bigint[]) => xs.reduce((a, b) => a + b, BigInt(0));
const pesos = (x: bigint) => Number(x) / 100;

describe("repartirRecobroEntreAdultos", () => {
  test("varios hoteles: por igual entre adultos y el centavo sobrante al adulto de menor posición (los contratos reciben EXACTAMENTE 100.000)", () => {
    const r = repartirRecobroEntreAdultos(100000, [{ ref: "item-0", adultos: 2 }, { ref: "item-1", adultos: 1 }]);
    assert.ok(r.ok); const v = r.valor;
    assert.deepEqual(v.porAdulto.map(pesos), [33333.34, 33333.33, 33333.33]);
    assert.equal(pesos(v.porUnidad["item-0"]), 66666.67);
    assert.equal(pesos(v.porUnidad["item-1"]), 33333.33);
    assert.equal(suma(Object.values(v.porUnidad)), c(100000), "A + B = 100.000,00 exacto");
  });
  test("es determinista: la misma entrada da el mismo reparto", () => {
    const u = [{ ref: "a", adultos: 3 }, { ref: "b", adultos: 4 }];
    assert.deepEqual(repartirRecobroEntreAdultos(100000.01, u), repartirRecobroEntreAdultos(100000.01, u));
  });
  test("sin adultos y con recobro: error; sin recobro: ceros", () => {
    assert.equal(repartirRecobroEntreAdultos(10, [{ ref: "a", adultos: 0 }]).ok, false);
    const r = repartirRecobroEntreAdultos(0, [{ ref: "a", adultos: 0 }]); assert.ok(r.ok);
  });
});

describe("acuerdosPorContrato — ejemplos del dueño (2 adultos 1.000.000 c/u + 1 niño 500.000, 10 %, BNC 0, recobro 100.000)", () => {
  const un = (recobro: number, part: { modo: "valor"; valor: number } | { modo: "pct"; pct: number } | null) => {
    const rep = repartirRecobroEntreAdultos(recobro, [{ ref: "item-0", adultos: 2 }]); assert.ok(rep.ok);
    const r = acuerdosPorContrato({ contratos: [{ clave: "A", pvpCent: c(2500000), bncCent: BigInt(0), recobroCent: rep.valor.total }], recobroTotal: recobro, participacion: part, pct: 0.1 });
    assert.ok(r.ok); return r.valor[0];
  };
  test("A · aliado directo, participación 50 % (del parámetro): ordinaria 250.000 + 50.000 = 300.000; la empresa conserva 50.000 del recobro", () => {
    const a = un(100000, { modo: "pct", pct: 0.5 });
    assert.equal(pesos(a.totalCent), 2600000); assert.equal(pesos(a.baseCent), 2500000); assert.equal(pesos(a.ordinariaCent), 250000);
    assert.equal(pesos(a.participacionCent), 50000); assert.equal(pesos(a.totalAliadoCent), 300000); assert.equal(pesos(a.recobroNetoEmpresaCent), 50000);
  });
  test("B1 · asistida CON distribución 40 %: 250.000 + 40.000 = 290.000; empresa 60.000; NETO exigible 2.310.000", () => {
    const a = un(100000, { modo: "pct", pct: 0.4 });
    assert.equal(a.excluyeRecobro, true);
    assert.equal(pesos(a.ordinariaCent), 250000); assert.equal(pesos(a.totalAliadoCent), 290000); assert.equal(pesos(a.recobroNetoEmpresaCent), 60000);
    assert.equal(pesos(a.exigibleNetoCent), 2310000);
  });
  test("B2 · asistida SIN distribución: el recobro queda en la base ⇒ ordinaria 260.000; el aliado cobra 10.000 más que sin recobro y la empresa conserva 90.000 (no 100.000)", () => {
    const a = un(100000, null);
    assert.equal(a.excluyeRecobro, false);
    assert.equal(pesos(a.baseCent), 2600000); assert.equal(pesos(a.ordinariaCent), 260000); assert.equal(pesos(a.participacionCent), 0);
    assert.equal(pesos(a.comisionSinRecobroCent), 250000);
    assert.equal(pesos(a.totalAliadoCent - a.comisionSinRecobroCent), 10000, "el aliado recibe 10.000 más");
    assert.equal(pesos(a.recobroNetoEmpresaCent), 90000);
    assert.equal(pesos(a.exigibleNetoCent), 2340000);
  });
  test("un % que redondea a 0 pesos deja el recobro en la base (regla #97 sobre el importe final)", () => {
    const a = un(100, { modo: "pct", pct: 0.001 });
    assert.equal(a.participacionCent, BigInt(0)); assert.equal(a.excluyeRecobro, false);
  });
  test("varios contratos: participación 40 % ⇒ 26.667 + 13.333 = 40.000 y el recobro por contrato suma exacto", () => {
    const rep = repartirRecobroEntreAdultos(100000, [{ ref: "item-0", adultos: 2 }, { ref: "item-1", adultos: 1 }]); assert.ok(rep.ok);
    const r = acuerdosPorContrato({
      contratos: [{ clave: "A", pvpCent: c(2000000), bncCent: BigInt(0), recobroCent: rep.valor.porUnidad["item-0"] }, { clave: "B", pvpCent: c(900000), bncCent: BigInt(0), recobroCent: rep.valor.porUnidad["item-1"] }],
      recobroTotal: 100000, participacion: { modo: "pct", pct: 0.4 }, pct: 0.1,
    });
    assert.ok(r.ok); const [A, B] = r.valor;
    assert.equal(pesos(A.participacionCent), 26667); assert.equal(pesos(B.participacionCent), 13333);
    assert.equal(pesos(A.participacionCent + B.participacionCent), 40000);
    assert.equal(A.recobroCent + B.recobroCent, c(100000));
    assert.equal(pesos(A.ordinariaCent), 200000); assert.equal(pesos(B.ordinariaCent), 90000);
  });
  test("rechaza un recobro repartido que no suma, o un % inválido", () => {
    assert.equal(acuerdosPorContrato({ contratos: [{ clave: "A", pvpCent: c(1000), bncCent: BigInt(0), recobroCent: c(5) }], recobroTotal: 6, participacion: null, pct: 0.1 }).ok, false);
    assert.equal(acuerdosPorContrato({ contratos: [], recobroTotal: 0, participacion: null, pct: 1.5 }).ok, false);
  });
});

describe("tarifasNetoPorPersona — NETO con adultos y niño (comisión entre adultos y niños; participación solo a los adultos que llevan el recobro)", () => {
  const personas = (recobroPorAdulto: bigint): PersonaNeto[] => [
    { tipo: "adulto", pvpCent: c(1000000), recobroCent: recobroPorAdulto }, { tipo: "adulto", pvpCent: c(1000000), recobroCent: recobroPorAdulto }, { tipo: "nino", pvpCent: c(500000), recobroCent: BigInt(0) },
  ];
  test("B1: adulto 930.000, adulto 930.000, niño 450.000 = 2.310.000", () => {
    const t = tarifasNetoPorPersona({ personas: personas(c(50000)), ordinariaCent: c(250000), participacionCent: c(40000), excluyeRecobro: true });
    assert.ok(t.ok);
    assert.deepEqual(t.valor.map((x) => pesos(x.netoCent)), [930000, 930000, 450000]);
    assert.deepEqual(t.valor.map((x) => pesos(x.descuentoOrdinariaCent)), [100000, 100000, 50000]);
    assert.deepEqual(t.valor.map((x) => pesos(x.descuentoParticipacionCent)), [20000, 20000, 0]);
    assert.equal(pesos(suma(t.valor.map((x) => x.netoCent))), 2310000);
  });
  test("B2: el recobro pesa en la ordinaria: adulto 945.000, adulto 945.000, niño 450.000 = 2.340.000", () => {
    const t = tarifasNetoPorPersona({ personas: personas(c(50000)), ordinariaCent: c(260000), participacionCent: BigInt(0), excluyeRecobro: false });
    assert.ok(t.ok);
    assert.deepEqual(t.valor.map((x) => pesos(x.netoCent)), [945000, 945000, 450000]);
    assert.equal(pesos(suma(t.valor.map((x) => x.netoCent))), 2340000);
  });
  test("no carga toda la deducción a los adultos: el niño también recibe parte de la comisión", () => {
    const t = tarifasNetoPorPersona({ personas: personas(c(50000)), ordinariaCent: c(250000), participacionCent: c(40000), excluyeRecobro: true });
    assert.ok(t.ok); assert.ok(t.valor[2].descuentoOrdinariaCent > BigInt(0));
  });
  test("participación sin adultos que lleven recobro: error (no se pierde dinero)", () => {
    const t = tarifasNetoPorPersona({ personas: [{ tipo: "nino", pvpCent: c(500000), recobroCent: BigInt(0) }], ordinariaCent: BigInt(0), participacionCent: c(10), excluyeRecobro: true });
    assert.equal(t.ok, false);
  });
});

describe("parámetro del aliado directo y validación del formulario", () => {
  test("pctParticipacionDeParametro: lee el parámetro; ausente o fuera de [0, 1] falla cerrado (sin constante de respaldo)", () => {
    assert.deepEqual(pctParticipacionDeParametro("0.5"), { ok: true, valor: 0.5 });
    assert.deepEqual(pctParticipacionDeParametro(0.3), { ok: true, valor: 0.3 });
    assert.deepEqual(pctParticipacionDeParametro(0), { ok: true, valor: 0 });
    for (const malo of [undefined, null, "", "abc", NaN, 1.5, -0.1, "2"]) assert.equal(pctParticipacionDeParametro(malo).ok, false, String(malo));
  });
  test("validarRecobro: vacío = 0; negativo, texto, Infinity o más de 2 decimales se rechazan", () => {
    assert.deepEqual(validarRecobro(undefined), { ok: true, valor: 0 });
    assert.deepEqual(validarRecobro("100000"), { ok: true, valor: 100000 });
    assert.deepEqual(validarRecobro(1234.56), { ok: true, valor: 1234.56 });
    for (const malo of [-1, "abc", Infinity, 1.234, "1e400"]) assert.equal(validarRecobro(malo).ok, false, String(malo));
  });
});

describe("propiedades: todo cuadra en centavos para cualquier combinación", () => {
  test("500 combinaciones aleatorias reproducibles: Σ recobro, Σ participación y Σ NETO exactos", () => {
    let s = 12345; const rnd = (n: number) => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s % n; };
    for (let k = 0; k < 500; k++) {
      const nUnidades = 1 + rnd(3), unidades = Array.from({ length: nUnidades }, (_, i) => ({ ref: `item-${i}`, adultos: 1 + rnd(4) }));
      const recobro = rnd(5_000_000) + rnd(100) / 100, pct = rnd(30) / 100, partPct = rnd(101) / 100;
      const rep = repartirRecobroEntreAdultos(recobro, unidades); assert.ok(rep.ok);
      assert.equal(suma(Object.values(rep.valor.porUnidad)), c(recobro), "Σ recobro por unidad = recobro");
      const contratos = unidades.map((u) => ({ clave: u.ref, pvpCent: c(rnd(9_000_000) + 100_000), bncCent: c(rnd(50_000)), recobroCent: rep.valor.porUnidad[u.ref] }));
      const r = acuerdosPorContrato({ contratos, recobroTotal: recobro, participacion: { modo: "pct", pct: partPct }, pct }); assert.ok(r.ok);
      const part = r.valor.reduce((x, a) => x + a.participacionCent, BigInt(0));
      assert.equal(part, c(participacionAliado(recobro, { modo: "pct", pct: partPct })), "la participación asignada a los contratos es EXACTAMENTE la pactada (sin dinero perdido)");
      assert.ok(part <= c(recobro), "la participación nunca supera el recobro");
      for (const a of r.valor) {
        const ni = rnd(3), personas: PersonaNeto[] = [];
        const u = unidades.find((x) => x.ref === a.clave)!;
        const adultosTar = a.totalCent - a.recobroCent; // PVP sin recobro del contrato, repartido por igual (solo para la propiedad)
        const nPer = u.adultos + ni; const base = adultosTar / BigInt(nPer);
        const idx0 = unidades.indexOf(u); let adultoGlobal = unidades.slice(0, idx0).reduce((x, y) => x + y.adultos, 0);
        for (let i = 0; i < u.adultos; i++) personas.push({ tipo: "adulto", pvpCent: base, recobroCent: rep.valor.porAdulto[adultoGlobal++] });
        for (let i = 0; i < ni; i++) personas.push({ tipo: "nino", pvpCent: base, recobroCent: BigInt(0) });
        const pvpPersonas = suma(personas.map((p) => p.pvpCent + p.recobroCent));
        if (a.ordinariaCent === BigInt(0) && a.participacionCent === BigInt(0)) continue;
        const t = tarifasNetoPorPersona({ personas, ordinariaCent: a.ordinariaCent, participacionCent: a.participacionCent, excluyeRecobro: a.excluyeRecobro }); assert.ok(t.ok, t.ok ? "" : t.error);
        assert.equal(suma(t.valor.map((x) => x.netoCent)), pvpPersonas - a.ordinariaCent - a.participacionCent, "Σ NETO = Σ PVP − descuento (exacto)");
      }
    }
  });
});
