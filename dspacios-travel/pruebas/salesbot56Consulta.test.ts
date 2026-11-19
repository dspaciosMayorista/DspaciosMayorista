import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { resolverAccesoConsulta, ROLES_CONSULTA } from "../lib/salesbot/acceso.ts";
import { CLAVES_PROHIBIDAS, VIGENCIA_DATO_MS, clavesProhibidasEn, crearSello } from "../lib/salesbot/contrato.ts";
import {
  filtrarProgramas,
  normalizarTexto,
  precioEnRevision,
  puedeSalirEnFecha,
  resolverPorcentajeAgencia,
  validarCriterios,
  type DatosInternosPrograma,
} from "../lib/salesbot/consulta.ts";
import type { ProgramaResumen } from "../app/tarifario/TarifarioPublic.tsx";

// #56 — lógica PURA de la consulta interna de programas: acceso, criterios,
// filtros, fecha, marca de revisión (#57), % propio de la agencia y lista negra.

describe("acceso a la consulta (#56)", () => {
  const APROBADOS = ["superadmin", "gerencia", "administracion", "operaciones", "venta"];

  test("los roles de la consulta son exactamente los aprobados por el dueño", () => {
    assert.deepEqual([...ROLES_CONSULTA].sort(), [...APROBADOS].sort());
  });

  test("cada rol aprobado entra en Mayorista", () => {
    for (const rol of APROBADOS) assert.deepEqual(resolverAccesoConsulta({ rol, activo: true }, "mayorista"), { ok: true, rol });
  });

  test("control_vuelo queda fuera", () => {
    assert.deepEqual(resolverAccesoConsulta({ rol: "control_vuelo", activo: true }, "mayorista"), { ok: false, motivo: "rol_no_permitido" });
  });

  test("un usuario externo (agencia, freelance, cliente final) no es usuario de la consulta", () => {
    for (const rol of ["agencia", "freelance", "cliente_final"]) {
      assert.deepEqual(resolverAccesoConsulta({ rol, activo: true }, "mayorista"), { ok: false, motivo: "rol_no_permitido" });
    }
  });

  test("sin sesión, inactivo o con activo nulo: no entra", () => {
    assert.deepEqual(resolverAccesoConsulta(null, "mayorista"), { ok: false, motivo: "sin_sesion" });
    assert.deepEqual(resolverAccesoConsulta({ rol: "venta", activo: false }, "mayorista"), { ok: false, motivo: "usuario_inactivo" });
    assert.deepEqual(resolverAccesoConsulta({ rol: "venta", activo: null }, "mayorista"), { ok: false, motivo: "usuario_inactivo" });
  });

  test("solo Mayorista: un superadmin con Minorista activa no consulta", () => {
    assert.deepEqual(resolverAccesoConsulta({ rol: "superadmin", activo: true }, "minorista"), { ok: false, motivo: "agencia_no_permitida" });
    assert.deepEqual(resolverAccesoConsulta({ rol: "venta", activo: true }, null), { ok: false, motivo: "agencia_no_permitida" });
  });
});

describe("validación de criterios", () => {
  test("todo vacío es una búsqueda válida sin filtros", () => {
    assert.deepEqual(validarCriterios({}), { ok: true, criterios: {} });
  });

  test("un campo mal formado se rechaza con su nombre, nunca se corrige", () => {
    assert.deepEqual(validarCriterios({ tipoTransporte: "barco" }), { ok: false, campos: ["tipoTransporte"] });
    assert.deepEqual(validarCriterios({ fechaSalida: "2027-02-30" }), { ok: false, campos: ["fechaSalida"] });
    assert.deepEqual(validarCriterios({ fechaSalida: "30/01/2027" }), { ok: false, campos: ["fechaSalida"] });
    assert.deepEqual(validarCriterios({ presupuesto: "-5", monedaPresupuesto: "COP" }), { ok: false, campos: ["presupuesto"] });
    assert.deepEqual(validarCriterios({ presupuesto: "100", monedaPresupuesto: "EUR" }), { ok: false, campos: ["monedaPresupuesto"] });
    assert.deepEqual(validarCriterios({ limite: "11" }), { ok: false, campos: ["limite"] });
    assert.deepEqual(validarCriterios({ limite: "0" }), { ok: false, campos: ["limite"] });
  });

  test("presupuesto con separador de miles colombiano", () => {
    const r = validarCriterios({ presupuesto: "1.500.000", monedaPresupuesto: "cop" });
    assert.deepEqual(r, { ok: true, criterios: { presupuestoMaxPorPersona: { monto: 1500000, moneda: "COP" } } });
  });

  test("normaliza tildes y mayúsculas", () => {
    assert.equal(normalizarTexto("  Bogotá   ÁMAZONAS "), "bogota amazonas");
  });
});

const prog = (p: Partial<ProgramaResumen> & { id: number; nombre: string }): ProgramaResumen => ({
  subtitulo: null,
  dias: 5,
  noches: 4,
  moneda: "USD",
  desde_pvp: 1000,
  tipo_transporte: "ninguno",
  portada_url: null,
  ciudades: [],
  destino: { id: 1, nombre: "Turquía" },
  ...p,
});

const PROGRAMAS: ProgramaResumen[] = [
  prog({ id: 1, nombre: "Turquía Mágica", ciudades: ["Estambul", "Capadocia"], desde_pvp: 1100, tipo_transporte: "aereo" }),
  prog({ id: 2, nombre: "Amazonas Salvaje", destino: { id: 2, nombre: "Amazonas" }, ciudades: ["Leticia"], moneda: "COP", desde_pvp: 2500000 }),
  prog({ id: 3, nombre: "Caño Cristales", destino: { id: 3, nombre: "Meta" }, moneda: "COP", desde_pvp: null, tipo_transporte: "terrestre" }),
  prog({ id: 4, nombre: "Egipto Clásico", destino: { id: 4, nombre: "Egipto" }, desde_pvp: 1800 }),
];

const internos = (extra: Partial<Record<number, Partial<DatosInternosPrograma>>> = {}) =>
  new Map<number, DatosInternosPrograma>(
    PROGRAMAS.map((p) => [p.id, { vigencia_desde: null, vigencia_hasta: null, blackouts: [], precio_en_revision: false, ...(extra[p.id] ?? {}) }])
  );

describe("filtrarProgramas", () => {
  test("texto por palabras, sin tildes, contra nombre, destino y ciudades", () => {
    const r = filtrarProgramas(PROGRAMAS, { texto: "capadocia turquia" }, internos(), false);
    assert.deepEqual(r.resultados.map((p) => p.id), [1]);
  });

  test("destino y tipo de transporte", () => {
    assert.deepEqual(filtrarProgramas(PROGRAMAS, { destino: "amazonas" }, internos(), false).resultados.map((p) => p.id), [2]);
    assert.deepEqual(filtrarProgramas(PROGRAMAS, { tipoTransporte: "terrestre" }, internos(), false).resultados.map((p) => p.id), [3]);
  });

  test("fecha de salida: vigencia y blackouts como en reservar; sin datos internos se excluye", () => {
    const mapa = internos({
      1: { vigencia_desde: "2027-01-01", vigencia_hasta: "2027-12-31" },
      2: { blackouts: [{ fecha_inicio: "2027-03-01", fecha_fin: "2027-03-10" }] },
    });
    mapa.delete(4);
    const r = filtrarProgramas(PROGRAMAS, { fechaSalida: "2027-03-05" }, mapa, false);
    assert.deepEqual(r.resultados.map((p) => p.id), [1, 3]);
  });

  test("presupuesto: compara el Desde en la misma moneda y cuenta los que no se pudieron comparar", () => {
    const r = filtrarProgramas(PROGRAMAS, { presupuestoMaxPorPersona: { monto: 1500, moneda: "USD" } }, internos(), false);
    assert.deepEqual(r.resultados.map((p) => p.id), [1]);
    assert.equal(r.omitidos_por_presupuesto, 2); // 2 (COP) y 3 (COP sin Desde)
  });

  test("lectura parcial: sin Desde y sin comparar presupuesto", () => {
    const r = filtrarProgramas(PROGRAMAS, {}, internos(), true);
    assert.equal(r.parcial, true);
    assert.ok(r.resultados.every((p) => p.desde_pvp_por_persona === null));
    const conPresupuesto = filtrarProgramas(PROGRAMAS, { presupuestoMaxPorPersona: { monto: 9999, moneda: "USD" } }, internos(), true);
    assert.equal(conPresupuesto.resultados.length, 0);
  });

  test("límite, truncado, marca de revisión y vitrina", () => {
    const r = filtrarProgramas(PROGRAMAS, { limite: 2 }, internos({ 2: { precio_en_revision: true } }), false);
    assert.deepEqual(r.resultados.map((p) => p.id), [1, 2]);
    assert.equal(r.total_encontrados, 4);
    assert.equal(r.truncado, true);
    assert.equal(r.resultados[1].precio_en_revision, true);
    assert.equal(r.resultados[0].url_vitrina, "/tarifario/programa/1");
  });

  test("la salida de la búsqueda no trae claves prohibidas", () => {
    assert.deepEqual(clavesProhibidasEn(filtrarProgramas(PROGRAMAS, {}, internos(), false)), []);
  });
});

describe("puedeSalirEnFecha (bordes)", () => {
  const d = { vigencia_desde: "2027-01-10", vigencia_hasta: "2027-01-20", blackouts: [{ fecha_inicio: "2027-01-15", fecha_fin: "2027-01-16" }] };
  test("los extremos de la vigencia cuentan; antes o después no", () => {
    assert.equal(puedeSalirEnFecha(d, "2027-01-10"), true);
    assert.equal(puedeSalirEnFecha(d, "2027-01-20"), true);
    assert.equal(puedeSalirEnFecha(d, "2027-01-09"), false);
    assert.equal(puedeSalirEnFecha(d, "2027-01-21"), false);
  });
  test("el blackout incluye su inicio y su fin", () => {
    assert.equal(puedeSalirEnFecha(d, "2027-01-15"), false);
    assert.equal(puedeSalirEnFecha(d, "2027-01-16"), false);
    assert.equal(puedeSalirEnFecha(d, "2027-01-17"), true);
  });
});

describe("precioEnRevision (casos de #57)", () => {
  const sal = (s: Partial<{ noches: number | null; tarifa_doble: number | null }> = {}) => ({
    noches: 4,
    tarifa_sencilla: null,
    tarifa_doble: null,
    tarifa_triple: null,
    tarifa_multiple: null,
    ...s,
  });
  const base = { modo_precio: "salida", regla_comisionable: true, regla_comisionable_modalidad_mk: "base_neta_impuestos_al_final", asistencia_medica_dia: 0 };

  test("modalidad nueva con tarifa cargada: en revisión", () => {
    assert.equal(precioEnRevision(base, [sal({ tarifa_doble: 1000 })]), true);
  });
  test("modalidad nueva sin tarifa, o modalidad histórica con tarifa: no", () => {
    assert.equal(precioEnRevision(base, [sal()]), false);
    assert.equal(precioEnRevision({ ...base, regla_comisionable_modalidad_mk: "historica" }, [sal({ tarifa_doble: 1000 })]), false);
    assert.equal(precioEnRevision({ ...base, regla_comisionable: false }, [sal({ tarifa_doble: 1000 })]), false);
  });
  test("salida sin noches solo cuenta si hay asistencia médica", () => {
    const sinRegla = { ...base, regla_comisionable: false };
    assert.equal(precioEnRevision({ ...sinRegla, asistencia_medica_dia: 10 }, [sal({ noches: null })]), true);
    assert.equal(precioEnRevision({ ...sinRegla, asistencia_medica_dia: 0 }, [sal({ noches: null })]), false);
  });
  test("modo categoría nunca está en revisión", () => {
    assert.equal(precioEnRevision({ ...base, modo_precio: "categoria", asistencia_medica_dia: 10 }, [sal({ tarifa_doble: 1000, noches: null })]), false);
  });
});

describe("porcentaje propio de la agencia (audiencia B2B)", () => {
  const fila = { id: 7, nombre: "Viajes Sol", tipo: "agencia", pct_comision: 0.12 };
  test("con % propio en su ficha", () => {
    assert.deepEqual(resolverPorcentajeAgencia(fila), { estado: "propio", agencia: { id: 7, nombre: "Viajes Sol", tipo: "agencia" }, pct: 0.12 });
  });
  test("sin % propio: se dice así y NO se usa ningún porcentaje general", () => {
    const r = resolverPorcentajeAgencia({ ...fila, pct_comision: null });
    assert.deepEqual(r, { estado: "sin_pct_propio", agencia: { id: 7, nombre: "Viajes Sol", tipo: "agencia" } });
    assert.equal("pct" in r, false);
  });
  test("% fuera de rango (12 en vez de 0,12): inválido, nunca se corrige", () => {
    assert.equal(resolverPorcentajeAgencia({ ...fila, pct_comision: 12 }).estado, "pct_invalido");
  });
  test("agencia inexistente", () => {
    assert.deepEqual(resolverPorcentajeAgencia(null), { estado: "no_encontrada" });
  });
  test("nunca trae base ni monto de comisión, ni datos bancarios o documento", () => {
    assert.deepEqual(clavesProhibidasEn(resolverPorcentajeAgencia(fila)), []);
  });
});

describe("sello y lista negra", () => {
  test("un dato vale 15 minutos", () => {
    const s = crearSello("detallePrograma", new Date("2027-01-01T15:00:00.000Z"));
    assert.equal(VIGENCIA_DATO_MS, 15 * 60 * 1000);
    assert.equal(s.consultado_en, "2027-01-01T15:00:00.000Z");
    assert.equal(s.valido_hasta, "2027-01-01T15:15:00.000Z");
    assert.equal(s.fuente, "detallePrograma");
  });
  test("detecta claves prohibidas a cualquier profundidad", () => {
    assert.deepEqual(clavesProhibidasEn({ a: [{ b: { neto: 1 } }], pct_mk: 0.2 }), ["a[0].b.neto", "pct_mk"]);
  });
  test("la lista negra cubre costos, markup, proveedor, notas, comisión y mínimo/máximo de pax", () => {
    for (const k of ["neto", "neto_doble", "tarifa_doble", "impuesto_doble", "pct_mk", "pct_fee_tarjeta", "proveedor_id", "notas", "base_comisionable", "comision_estimada", "total", "min_pax", "max_pax", "numero_cuenta"]) {
      assert.ok(CLAVES_PROHIBIDAS.includes(k), k);
    }
  });
});
