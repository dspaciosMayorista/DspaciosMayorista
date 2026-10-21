// #50 — cálculo PURO del precio NETO de la hija manual (lib/cotizacion/netoHija.ts).
// Pruebas M1 (margen), M3 (descuento 0), R1 (reparto del snapshot) y T2 (paridad de
// constantes con la migración 222). La paridad con la función SQL real corre en CI
// (supabase/scripts/test_222_neto_hija.sql), con los MISMOS vectores de este archivo.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  aCentavos,
  calcularNetoHija,
  comisionOrdinaria,
  decidirNeto,
  evaluarMargenNeto,
  leerEntradaModalidad,
  puedeAutorizarMargen,
  puedeFijarNeto,
  repartir,
  ROLES_AUTORIZAN_SOLO_TIQUETES,
  ROLES_FIJAN_NETO,
  type EntradaNeto,
  type ServicioNeto,
} from "@/lib/cotizacion/netoHija";
import { evaluarMargenContrato, ROLES_EXCEPCION_MARGEN } from "@/lib/contrato/margenContrato";
import { ROLES_CONTRATO_COMPLETO } from "@/lib/roles";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const leer = (rel: string) => readFileSync(join(raiz, rel), "utf8");
const c = (n: number) => BigInt(Math.round(n * 100));
type VectorNeto = {
  id: string; entrada: EntradaNeto;
  esperado: { neto: number; descuento: number; costos: number; descuentosFila: number[]; cumple: boolean; bajoCosto: boolean; costoCero: boolean; soloTiquetes: boolean };
};
const VECTORES_NETO_50: VectorNeto[] = JSON.parse(leer("pruebas/netoHija50.vectores.json"));

// Filas comunes del ejemplo del dueño (decisión 2): PVP 10.000.000.
function servicios(costoHotel = 5_100_000): ServicioNeto[] {
  return [
    { id: 1, orden: 0, tipo: "aereo", valor: 2_000_000, costoNeto: 1_900_000 },
    { id: 2, orden: 1, tipo: "hotel", valor: 6_000_000, costoNeto: costoHotel },
    { id: 3, orden: 2, tipo: "traslado", valor: 1_000_000, costoNeto: 850_000 },
    { id: 4, orden: 3, tipo: "asistencia", valor: 500_000, costoNeto: 400_000 },
  ];
}
function entrada(parcial: Partial<EntradaNeto> = {}): EntradaNeto {
  return {
    servicios: servicios(), precioVenta: 10_000_000, recobro: 500_000, ninos: 0, tarifaNino: 0,
    recobroAliado: 250_000, reconoceRecobro: true, pct: 0.12, ...parcial,
  };
}
const exigido = (r: ReturnType<typeof calcularNetoHija>) =>
  r.filas.reduce((s, f) => s + (f.tipo === "aereo" ? f.neto : (f.neto * BigInt(30)) / BigInt(100)), BigInt(0));

test("V1 — directo, reconoce participación: base 7.500.000, D 1.150.000, NETO 8.850.000", () => {
  const r = calcularNetoHija(entrada());
  assert.equal(r.base, c(7_500_000));
  assert.equal(r.ordinaria, c(900_000));
  assert.equal(r.participacion, c(250_000));
  assert.equal(r.descuento, c(1_150_000));
  assert.equal(r.neto, c(8_850_000));
  assert.equal(r.costos, c(8_250_000));
  assert.equal(r.soloTiquetes, false);
  // Reparto por fila: el tiquete no se toca; la ordinaria se reparte por PVP entre las filas no-tiquete.
  assert.deepEqual(r.filas.map((f) => f.descuento), [c(0), c(720_000), c(120_000), c(60_000)]);
  assert.deepEqual(r.filas.map((f) => f.neto), [c(2_000_000), c(5_280_000), c(880_000), c(440_000)]);
  // Exigido del snapshot a NETO (30 % no-aéreo, 100 % aéreo): 3.980.000 (a PVP serían 4.250.000).
  assert.equal(exigido(r), c(3_980_000));
  const ev = evaluarMargenNeto(r.neto, r.costos, r.soloTiquetes);
  assert.equal(ev.cumple, true);
  assert.equal(ev.margen, 0.067797); // 6,78 %
  assert.deepEqual(decidirNeto(r, { rol: "operaciones", autorizarMargen: false }), { ok: true, autorizado: false });
});

test("V2 — costo 8.350.000: margen 5,65 %, exige autorización de superadmin o administración", () => {
  const r = calcularNetoHija(entrada({ servicios: servicios(5_200_000) }));
  assert.equal(r.costos, c(8_350_000));
  const ev = evaluarMargenNeto(r.neto, r.costos, false);
  assert.equal(ev.cumple, false);
  assert.equal(ev.margen, 0.056497);
  const sin = decidirNeto(r, { rol: "administracion", autorizarMargen: false });
  assert.equal(sin.ok === false && sin.codigo, "MARGEN_BAJO");
  assert.deepEqual(decidirNeto(r, { rol: "administracion", autorizarMargen: true }), { ok: true, autorizado: true });
  assert.deepEqual(decidirNeto(r, { rol: "superadmin", autorizarMargen: true }), { ok: true, autorizado: true });
  for (const rol of ["gerencia", "operaciones", "venta", null]) {
    const d = decidirNeto(r, { rol, autorizarMargen: true });
    assert.equal(d.ok === false && d.codigo, "ROL_NO_AUTORIZA", String(rol));
  }
});

test("V3/V3b — el total NETO nunca baja del costo: igual al costo pasa con excepción; un peso menos, no, ni superadmin", () => {
  const igual = calcularNetoHija(entrada({ servicios: servicios(5_700_000) })); // costo 8.850.000 = NETO
  assert.equal(igual.costos, igual.neto);
  assert.deepEqual(decidirNeto(igual, { rol: "superadmin", autorizarMargen: true }), { ok: true, autorizado: true });
  const bajo = calcularNetoHija(entrada({ servicios: servicios(5_700_001) })); // costo 8.850.001 > NETO
  for (const rol of ["superadmin", "administracion"]) {
    const d = decidirNeto(bajo, { rol, autorizarMargen: true });
    assert.equal(d.ok === false && d.codigo, "BAJO_COSTO", rol);
  }
});

const SOLO_TIQ = (costo: number): EntradaNeto => ({
  servicios: [{ id: 1, orden: 0, tipo: "aereo", valor: 2_000_000, costoNeto: costo }],
  precioVenta: 2_100_000, recobro: 100_000, ninos: 0, tarifaNino: 0, recobroAliado: 50_000, reconoceRecobro: true, pct: 0.12,
});

test("V4 — solo tiquetes: D = participación 50.000, NETO 2.050.000; el 2 % EXACTO cumple en el límite", () => {
  const r = calcularNetoHija(SOLO_TIQ(2_009_000));
  assert.equal(r.soloTiquetes, true);
  assert.equal(r.base, c(0));
  assert.equal(r.ordinaria, c(0));
  assert.equal(r.descuento, c(50_000));
  assert.equal(r.neto, c(2_050_000));
  const ev = evaluarMargenNeto(r.neto, r.costos, true);
  assert.equal(ev.pisoBps, 200);
  assert.equal(ev.cumple, true);
  assert.deepEqual(decidirNeto(r, { rol: "operaciones", autorizarMargen: false }), { ok: true, autorizado: false });
});

test("V4b/V4c — un centavo por debajo del 2 % ya NO cumple (sin tolerancia) y solo superadmin autoriza", () => {
  for (const costo of [2_009_000.01, 2_009_001]) {
    const r = calcularNetoHija(SOLO_TIQ(costo));
    assert.equal(evaluarMargenNeto(r.neto, r.costos, true).cumple, false, String(costo));
    assert.equal((decidirNeto(r, { rol: "administracion", autorizarMargen: true }) as { codigo?: string }).codigo, "ROL_NO_AUTORIZA");
    assert.equal((decidirNeto(r, { rol: "operaciones", autorizarMargen: false }) as { codigo?: string }).codigo, "MARGEN_BAJO");
    assert.deepEqual(decidirNeto(r, { rol: "superadmin", autorizarMargen: true }), { ok: true, autorizado: true });
  }
  // El 6 % sí conserva la tolerancia de medio peso (identico a #30): 8.776.595,25 es el mínimo de NETO con la tolerancia (8.776.595,74 sin ella).
  assert.equal(evaluarMargenNeto(c(8_776_595.25), c(8_250_000), false).cumple, true);
  assert.equal(evaluarMargenNeto(c(8_776_595.24), c(8_250_000), false).cumple, false);
});

test("V5 — descuento 0: no hay NETO (sin recobro, porcentaje 0 o redondeo a 0)", () => {
  const soloTiqSinRecobro: EntradaNeto = {
    servicios: [{ id: 1, orden: 0, tipo: "aereo", valor: 2_000_000, costoNeto: 1_900_000 }],
    precioVenta: 2_000_000, recobro: 0, ninos: 0, tarifaNino: 0, recobroAliado: 0, reconoceRecobro: true, pct: 0.12,
  };
  const a = calcularNetoHija(soloTiqSinRecobro);
  assert.equal(a.descuento, c(0));
  assert.equal((decidirNeto(a, { rol: "superadmin", autorizarMargen: true }) as { codigo?: string }).codigo, "SIN_DESCUENTO");
  const b = calcularNetoHija(entrada({ pct: 0, reconoceRecobro: false }));
  assert.equal(b.descuento, c(0));
  assert.equal((decidirNeto(b, { rol: "superadmin", autorizarMargen: true }) as { codigo?: string }).codigo, "SIN_DESCUENTO");
  // Redondeo a cero: 4 pesos al 10 % = 0,4 → 0.
  assert.equal(comisionOrdinaria(c(4), 0.1), BigInt(0));
});

test("Q-2 — costo total 0: rechazo sin excepción; una fila suelta con costo 0 se permite si el total es mayor que 0", () => {
  const sinCostos = calcularNetoHija(entrada({ servicios: servicios().map((s) => ({ ...s, costoNeto: 0 })) }));
  assert.equal(sinCostos.costos, BigInt(0));
  for (const rol of ["superadmin", "administracion"]) {
    assert.equal((decidirNeto(sinCostos, { rol, autorizarMargen: true }) as { codigo?: string }).codigo, "COSTO_CERO", rol);
  }
  const unaSinCosto = servicios().map((s, i) => (i === 3 ? { ...s, costoNeto: 0 } : s)); // asistencia sin costo
  const r = calcularNetoHija(entrada({ servicios: unaSinCosto }));
  assert.equal(r.costos, c(7_850_000));
  assert.deepEqual(decidirNeto(r, { rol: "operaciones", autorizarMargen: false }), { ok: true, autorizado: false });
});

test("V6 — asistida sin reconocer participación: el recobro entra a la base; D 960.000, NETO 9.040.000", () => {
  const r = calcularNetoHija(entrada({ reconoceRecobro: false }));
  assert.equal(r.base, c(8_000_000));
  assert.equal(r.ordinaria, c(960_000));
  assert.equal(r.participacion, c(0));
  assert.equal(r.neto, c(9_040_000));
  // hotel 720.000, traslado 120.000, asistencia 60.000 (y 60.000 al recobro, que no es una fila).
  assert.deepEqual(r.filas.map((f) => f.descuento), [c(0), c(720_000), c(120_000), c(60_000)]);
  const suma = r.filas.reduce((s, f) => s + f.descuento, BigInt(0));
  assert.equal(suma + c(60_000), r.ordinaria);
});

test("V7 — el centavo sobrante va a la fila de menor posición; pesos 0 no reciben", () => {
  assert.deepEqual(repartir(BigInt(100), [BigInt(1000), BigInt(1000), BigInt(1000)]), [BigInt(34), BigInt(33), BigInt(33)]);
  assert.deepEqual(repartir(BigInt(100), [BigInt(1000), BigInt(0), BigInt(1000)]), [BigInt(50), BigInt(0), BigInt(50)]);
  assert.deepEqual(repartir(BigInt(0), [BigInt(5), BigInt(5)]), [BigInt(0), BigInt(0)]);
  assert.deepEqual(repartir(BigInt(7), [BigInt(0), BigInt(0)]), [BigInt(0), BigInt(0)]);
  assert.deepEqual(repartir(BigInt(7), []), []);
});

test("V9 — los niños entran a la base del descuento (reparto proporcional hotel/niños)", () => {
  const r = calcularNetoHija({
    servicios: [{ id: 1, orden: 0, tipo: "hotel", valor: 4_000_000, costoNeto: 3_400_000 }],
    precioVenta: 4_600_000, recobro: 0, ninos: 2, tarifaNino: 300_000, recobroAliado: 0, reconoceRecobro: true, pct: 0.1,
  });
  assert.equal(r.ninos, c(600_000));
  assert.equal(r.base, c(4_600_000));
  assert.equal(r.ordinaria, c(460_000));
  assert.equal(r.filas[0].descuento, c(400_000)); // 60.000 caen sobre los niños (no es una fila del snapshot)
  assert.equal(r.neto, c(4_140_000));
});

test("redondeo de la comisión ordinaria: a la unidad de moneda, mitad hacia arriba (igual que #30)", () => {
  assert.equal(comisionOrdinaria(c(5), 0.1), c(1)); // 0,5 → 1
  assert.equal(comisionOrdinaria(c(7_500_000), 0.12), c(900_000));
  assert.equal(comisionOrdinaria(c(1_000_005), 0.1), c(100_001)); // 100.000,5 → 100.001
});

test("Q-9a: bordes de .5 en COP y USD — la comisión se calcula en enteros, igual que SQL (manda SQL)", () => {
  // Vectores compartidos con SQL: base × pct cae EXACTAMENTE en .5 (sube) o justo debajo (baja).
  const esperados: Record<string, bigint> = { B5a: c(125_001), B5b: c(117_524), B5c: c(201), B5d: c(125_000) };
  for (const [id, ordinaria] of Object.entries(esperados)) {
    const v = VECTORES_NETO_50.find((x) => x.id === id);
    assert.ok(v, id);
    assert.equal(calcularNetoHija(v.entrada).ordinaria, ordinaria, id);
  }
  assert.equal((VECTORES_NETO_50.find((x) => x.id === "B5c")!.entrada as { moneda?: string }).moneda, "USD");
  // Referencia independiente SIN coma flotante: base (centavos) × bp / 1.000.000 con resto exacto.
  for (const [baseCent, bp] of [[BigInt(100000400), BigInt(1250)], [BigInt(100020000), BigInt(1175)], [BigInt(160400), BigInt(1250)], [BigInt(100000300), BigInt(1250)]] as const) {
    const num = baseCent * bp;
    const unidades = num / BigInt(1000000) + (num % BigInt(1000000) >= BigInt(500000) ? BigInt(1) : BigInt(0));
    assert.equal(comisionOrdinaria(baseCent, Number(bp) / 10000), unidades * BigInt(100), `${baseCent} × ${bp} bp`);
  }
});

test("Q-9a: el porcentaje a puntos base es exacto para los 10 001 valores de 4 decimales (sin deriva de flotante)", () => {
  for (let bp = 0; bp <= 10_000; bp++) {
    assert.equal(Math.round((bp / 10000) * 10000), bp, String(bp));
    // El producto base × bp es entero: nunca se redondea sobre un flotante.
    assert.equal(comisionOrdinaria(BigInt(100), bp / 10000), BigInt(Math.floor((bp + 5000) / 10000)) * BigInt(100));
  }
});

// Generador determinista (LCG) para lotes amplios.
function lcg(semilla: number) {
  let s = semilla >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}

test("invariantes en un lote determinista: Σ descuentos de filas ≤ ordinaria, NETO = PVP − D, reparto exacto", () => {
  const rnd = lcg(50);
  for (let i = 0; i < 3000; i++) {
    const tipos = ["aereo", "hotel", "traslado", "asistencia", "otro"];
    const n = 1 + Math.floor(rnd() * 5);
    const svcs: ServicioNeto[] = Array.from({ length: n }, (_, k) => ({
      id: k + 1, orden: k, tipo: tipos[Math.floor(rnd() * tipos.length)],
      valor: Math.round(rnd() * 5_000_000) / 100 * 100, costoNeto: Math.round(rnd() * 4_000_000),
    }));
    const recobro = rnd() < 0.5 ? Math.round(rnd() * 800_000) : 0;
    const ninos = Math.floor(rnd() * 3);
    const tarifa = ninos ? Math.round(rnd() * 400_000) : 0;
    const suma = svcs.reduce((s, x) => s + x.valor, 0);
    const e: EntradaNeto = {
      servicios: svcs, precioVenta: suma + recobro + ninos * tarifa, recobro, ninos, tarifaNino: tarifa,
      recobroAliado: Math.round(rnd() * recobro), reconoceRecobro: rnd() < 0.5, pct: [0.11, 0.12, 0.1, 0.0875][Math.floor(rnd() * 4)],
    };
    const r = calcularNetoHija(e);
    assert.equal(r.neto, r.precio - r.descuento);
    assert.equal(r.descuento, r.ordinaria + r.participacion);
    const sumaFilas = r.filas.reduce((s, f) => s + f.descuento, BigInt(0));
    assert.ok(sumaFilas <= r.ordinaria, `lote ${i}`);
    r.filas.forEach((f) => { assert.equal(f.neto, f.pvp - f.descuento); assert.ok(f.descuento >= BigInt(0)); if (f.tipo === "aereo") assert.equal(f.descuento, BigInt(0)); });
    // Sin niños ni recobro en la base, TODA la ordinaria cae en filas.
    if (ninos === 0 && (e.reconoceRecobro || recobro === 0)) {
      const hayNoTiquete = r.filas.some((f) => f.tipo !== "aereo");
      if (hayNoTiquete) assert.equal(sumaFilas, r.ordinaria, `lote ${i}`);
    }
  }
});

test("el 6 % de evaluarMargenNeto coincide con evaluarMargenContrato('neto') fuera del borde exacto", () => {
  const rnd = lcg(6);
  let comparados = 0;
  for (let i = 0; i < 4000; i++) {
    const neto = Math.round(1_000_000 + rnd() * 9_000_000);
    const costos = Math.round(neto * (0.85 + rnd() * 0.2));
    const minimo = costos / 0.94;
    if (Math.abs(neto + 0.5 - minimo) < 1e-6) continue; // el borde exacto lo decide el entero (SQL), no la coma flotante
    const a = evaluarMargenNeto(c(neto), c(costos), false).cumple;
    const b = evaluarMargenContrato({ modo: "neto", ingreso: neto, costos }).cumple;
    assert.equal(a, b, `neto=${neto} costos=${costos}`);
    comparados++;
  }
  assert.ok(comparados > 3900);
});

test("roles: fijan NETO los cuatro de siempre (venta no); el 6 % lo autorizan los de #30; el 2 % solo superadmin", () => {
  assert.deepEqual([...ROLES_FIJAN_NETO].sort(), [...ROLES_CONTRATO_COMPLETO].sort());
  for (const rol of ROLES_CONTRATO_COMPLETO) assert.equal(puedeFijarNeto(rol), true);
  for (const rol of ["venta", "agencia", "freelance", "control_vuelo", "cliente_final", null, undefined]) {
    assert.equal(puedeFijarNeto(rol as string | null), false, String(rol));
  }
  assert.deepEqual([...ROLES_EXCEPCION_MARGEN], ["superadmin", "administracion"]);
  assert.equal(puedeAutorizarMargen("administracion", false), true);
  assert.equal(puedeAutorizarMargen("administracion", true), false);
  assert.equal(puedeAutorizarMargen("superadmin", true), true);
  assert.deepEqual([...ROLES_AUTORIZAN_SOLO_TIQUETES], ["superadmin"]);
});

test("T2 — las constantes de la migración 222 son las del módulo TS (roles, pisos y tolerancia)", () => {
  const sql = leer("supabase/migrations/20260601000222_neto_hija_manual.sql");
  assert.match(sql, /p_rol in \('superadmin', 'gerencia', 'administracion', 'operaciones'\)/);
  assert.match(sql, /else p_rol in \('superadmin', 'administracion'\) end/);
  assert.match(sql, /when p_solo_tiquetes then p_rol = 'superadmin'/);
  assert.match(sql, /p_neto::numeric \* 9800 >= p_costos::numeric \* 10000/); // 2 % exacto
  assert.match(sql, /\(p_neto \+ 50\)::numeric \* 9400 >= p_costos::numeric \* 10000/); // 6 % con medio peso
  assert.match(sql, /case when p_solo then 200 else 600 end/);
});

test("entrada de las acciones: sin modalidad = comportamiento de siempre; mal formada = error", () => {
  assert.deepEqual(leerEntradaModalidad({ token: "x" }), { ok: true, datos: null });
  assert.deepEqual(leerEntradaModalidad(null), { ok: true, datos: null });
  assert.deepEqual(leerEntradaModalidad({ modalidad: "pvp" }), { ok: true, datos: { modalidad: "pvp", reconoceRecobro: null, autorizarMargen: false } });
  assert.deepEqual(leerEntradaModalidad({ modalidad: "neto", reconoceRecobro: false, autorizarMargen: true }),
    { ok: true, datos: { modalidad: "neto", reconoceRecobro: false, autorizarMargen: true } });
  assert.equal(leerEntradaModalidad({ modalidad: "neto" }).ok, false); // falta decidir el recobro
  assert.equal(leerEntradaModalidad({ modalidad: "NETO", reconoceRecobro: true }).ok, false);
  assert.equal(leerEntradaModalidad({ modalidad: "neto", reconoceRecobro: "si" }).ok, false);
  // La bandera de margen solo vale si es literalmente true.
  assert.deepEqual(leerEntradaModalidad({ modalidad: "pvp", autorizarMargen: "true" }), { ok: true, datos: { modalidad: "pvp", reconoceRecobro: null, autorizarMargen: false } });
});

test("los vectores compartidos con SQL (netoHija50.vectores) dan lo esperado en TS", () => {
  assert.ok(VECTORES_NETO_50.length >= 10);
  for (const v of VECTORES_NETO_50) {
    const r = calcularNetoHija(v.entrada);
    assert.equal(aCentavos(v.esperado.neto), c(v.esperado.neto), v.id);
    assert.equal(r.neto, c(v.esperado.neto), `${v.id} neto`);
    assert.equal(r.descuento, c(v.esperado.descuento), `${v.id} descuento`);
    assert.equal(r.costos, c(v.esperado.costos), `${v.id} costos`);
    assert.deepEqual(r.filas.map((f) => f.descuento), v.esperado.descuentosFila.map(c), `${v.id} filas`);
    const ev = evaluarMargenNeto(r.neto, r.costos, r.soloTiquetes);
    assert.equal(ev.cumple, v.esperado.cumple, `${v.id} cumple`);
    assert.equal(ev.bajoCosto, v.esperado.bajoCosto, `${v.id} bajoCosto`);
    assert.equal(ev.costoCero, v.esperado.costoCero, `${v.id} costoCero`);
    assert.equal(r.soloTiquetes, v.esperado.soloTiquetes, `${v.id} soloTiquetes`);
  }
});
