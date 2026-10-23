import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { avanzar, type ServiciosConversacion } from "../lib/salesbot/conversacion/flujo.ts";
import { estadoInicial, type EstadoConversacion, type RespuestaConversacion } from "../lib/salesbot/conversacion/contrato.ts";
import { clavesProhibidasEn, crearSello } from "../lib/salesbot/contrato.ts";

// #56 MVP de conversación guiada — TRANSICIONES del flujo determinista con las
// consultas simuladas (la misma forma saneada que devuelven las reales):
// tres productos de punta a punta, datos faltantes y ambiguos, cambio de
// respuesta, selección caducada o manipulada, errores, B2B y no filtración.

const HOY = "2026-10-20";

type Llamada = { op: string; arg: unknown };
const llamadas: Llamada[] = [];
let fallar: Partial<Record<keyof ServiciosConversacion, unknown>> = {};
let ofertaVigente = true;

const ok = <T>(datos: T, fuente = "buscarBloqueos") => ({ ok: true as const, datos, sello: crearSello(fuente as never) });

const OFERTA = {
  clave: "5-b10-7",
  paquete_id: 5,
  paquete_nombre: "San Andrés marzo",
  origen_vuelo: "bloqueo" as const,
  bloqueo_id: 10,
  empaquetado_id: null,
  fecha_ida: "2027-03-10",
  fecha_regreso: "2027-03-13",
  noches: 3,
  destino: "SAN ANDRÉS",
  hotel_id: 7,
  hotel_nombre: "Hotel Caribe",
  moneda: "COP",
  combos: [
    { categoria: "Estándar", regimen: "PAE", pvp_por_persona: { doble: 1_000_000 } },
    { categoria: "Superior", regimen: "PC", pvp_por_persona: { doble: 1_300_000 } },
  ],
  desde_pvp_por_persona: 1_000_000,
  sillas_libres: 3,
  disponibilidad_vuelo: "sillas_libres" as const,
};

const COTIZACION = {
  producto: "bloqueo" as const,
  paquete_id: 5,
  hotel_id: 7,
  hotel_nombre: "Hotel Caribe",
  destino: "SAN ANDRÉS",
  fecha_ida: "2027-03-10",
  fecha_regreso: "2027-03-13",
  categoria: "Estándar",
  regimen: "PAE",
  moneda: "COP",
  lineas: [{ acomodacion: "doble" as const, habitaciones: 1, pax: 2, pvp_por_persona: 1_000_000 }],
  menores: { nino: 1, nino2: 0, infante: 0 },
  pvp_menores_por_persona: { nino: 400_000, nino2: null, infante: null },
  total_pax: 3,
  total_orientativo: 2_400_000,
  condiciones_tarifa: ["No reembolsable"],
  nota_nino: null,
  sillas_libres: 3,
  alcanzan_sillas: true,
  disponibilidad_vuelo: "sillas_libres" as const,
  disponibilidad_hotel: "sujeto_a_confirmacion" as const,
  sujeto_a_confirmacion: true as const,
};

const DETALLE = {
  id: 10, nombre: "Turquía Mágica", subtitulo: null, destino: "TURQUÍA", tipo_transporte: "terrestre" as const, dias: 9, noches: 8, moneda: "USD",
  vigencia: { desde: null, hasta: null }, salidas_texto: null, highlights: [], ciudades: [], itinerario: [], modo_precio: "categoria" as const,
  categorias: [{ id: 1, nombre: "Turista", hoteles: [], precios: [{ acomodacion: "doble", pvp_por_persona: 1100 }] }],
  salidas: [], incluye: [{ ciudad: null, texto: "Hoteles" }], no_incluye: [], tours: [], blackouts: [],
  edades: { nino_min: null, nino_max: null, infante_max: null },
  condiciones: { pago: { tipo: null, pct_inicial: null, dias_saldo: null }, restriccion_comercial: null, texto_condiciones: null, texto_cancelacion: null, texto_pagos: null },
  precio_en_revision: false, url_vitrina: "/tarifario/programa/10",
};

function sv(): ServiciosConversacion {
  const reg = (op: string, arg: unknown) => llamadas.push({ op, arg });
  const f = <T>(op: keyof ServiciosConversacion, normal: () => T): T => (op in fallar ? (fallar[op] as T) : normal());
  return {
    buscarProgramas: async (e) => (reg("buscarProgramas", e), f("buscarProgramas", () => ok({ resultados: [{ id: 10, nombre: "Turquía Mágica", subtitulo: null, destino: "TURQUÍA", ciudades: [], dias: 9, noches: 8, moneda: "USD", desde_pvp_por_persona: 1100, tipo_transporte: "terrestre" as const, precio_en_revision: false, url_vitrina: "/tarifario/programa/10" }], total_encontrados: 1, truncado: false, parcial: false, omitidos_por_presupuesto: 0 }, "buscarProgramas"))),
    detallePrograma: async (id) => (reg("detallePrograma", id), f("detallePrograma", () => (id === "10" ? ok(DETALLE, "detallePrograma") : { ok: false as const, codigo: "no_encontrado" as const, motivo: "Ese programa ya no está publicado.", sello: crearSello("detallePrograma") }))),
    buscarBloqueos: async (e) => (reg("buscarBloqueos", e), f("buscarBloqueos", () => ok({ ofertas: ofertaVigente ? [OFERTA] : [], total_encontradas: ofertaVigente ? 1 : 0, truncado: false }))),
    ofertaBloqueo: async (c) => (reg("ofertaBloqueo", c), f("ofertaBloqueo", () => (c === OFERTA.clave && ofertaVigente ? OFERTA : null))),
    cotizarBloqueo: async (e) => (reg("cotizarBloqueo", e), f("cotizarBloqueo", () => ok(COTIZACION, "cotizarBloqueo"))),
    destinosPorcion: async () => (reg("destinosPorcion", null), f("destinosPorcion", () => ["SAN ANDRÉS", "CARTAGENA"])),
    buscarPorcion: async (e) => (reg("buscarPorcion", e), f("buscarPorcion", () => ok({
      resultados: [{ hotel_id: 217, hotel_nombre: "Hotel Isla", destino: "SAN ANDRÉS", paquete_id: 50, paquete_nombre: "Porción", fecha_ida: "2027-03-10", fecha_regreso: "2027-03-13", noches: 3, moneda: "COP", combos: [{ categoria: "Estándar", regimen: "PAE", total_orientativo: 1_800_000, pax: 2 }], condicion_pago: null, disponibilidad_hotel: "sujeto_a_confirmacion" as const }],
      total_encontrados: 1, truncado: false, sugerencias_fecha: [],
    }, "buscarPorcion"))),
    cotizarPorcion: async (e) => (reg("cotizarPorcion", e), f("cotizarPorcion", () => ok({
      paquete_id: 50, hotel_id: 217, fecha_ida: "2027-03-10", fecha_regreso: "2027-03-13", noches: 3, moneda: "COP", combos: [], condicion_pago: null, servicios_grupo_pendientes: [], precio_no_final: false,
      cotizacion: { ...COTIZACION, producto: "porcion_terrestre" as const, hotel_id: 217, hotel_nombre: "Hotel Isla", total_orientativo: 1_800_000, total_pax: 2, menores: { nino: 0, nino2: 0, infante: 0 }, lineas: [{ acomodacion: "doble" as const, habitaciones: 1, pax: 2, pvp_por_persona: 750_000 }], sillas_libres: null, alcanzan_sillas: null, disponibilidad_vuelo: null },
      disponibilidad_hotel: "sujeto_a_confirmacion" as const,
    }, "cotizarPorcion"))),
    listarAgencias: async () => (reg("listarAgencias", null), f("listarAgencias", () => ok([{ id: 3, nombre: "Viajes Sol", tipo: "agencia" }, { id: 4, nombre: "Ruta Andina", tipo: "freelance" }], "porcentajeAgencia"))),
    porcentajeAgencia: async (id) => (reg("porcentajeAgencia", id), f("porcentajeAgencia", () => ok(id === "3" ? { estado: "propio" as const, agencia: { id: 3, nombre: "Viajes Sol", tipo: "agencia" }, pct: 0.1 } : { estado: "no_encontrada" as const }, "porcentajeAgencia"))),
  };
}

beforeEach(() => {
  llamadas.length = 0;
  fallar = {};
  ofertaVigente = true;
});

/** Conversación: aplica entradas en orden y devuelve todas las respuestas. */
async function charla(entradas: (string | { op: string })[], inicio: EstadoConversacion = estadoInicial()) {
  let estado: unknown = inicio;
  const respuestas: RespuestaConversacion[] = [];
  for (const x of entradas) {
    const entrada = typeof x === "string" ? { tipo: "texto", texto: x } : { tipo: "opcion", valor: x.op };
    const r = await avanzar(estado, entrada, sv(), HOY);
    respuestas.push(r);
    estado = r.estado;
  }
  return { respuestas, ultima: respuestas[respuestas.length - 1] };
}
const textos = (r: RespuestaConversacion) => r.mensajes.map((m) => [m.texto, ...(m.lineas ?? [])].join(" | ")).join(" || ");
const valores = (r: RespuestaConversacion) => r.mensajes.flatMap((m) => (m.opciones ?? []).map((o) => o.valor));

describe("inicio y comandos generales", () => {
  test("inicio: saludo con los tres productos", async () => {
    const r = await avanzar(null, { tipo: "inicio" }, sv(), HOY);
    assert.ok(r.ok);
    assert.deepEqual(valores(r), ["producto:programa", "producto:bloqueo", "producto:porcion"]);
    assert.deepEqual(r.estado, estadoInicial());
  });
  test("empezar de nuevo borra todo lo dado", async () => {
    const { ultima } = await charla(["bloqueo a san andres", "empezar de nuevo"]);
    assert.deepEqual(ultima.estado, estadoInicial());
  });
  test("asesor: mensaje de escalamiento sin cambiar el estado", async () => {
    const { respuestas } = await charla(["bloqueo", "hablar con un asesor"]);
    assert.match(textos(respuestas[1]), /administración u operaciones/);
    assert.equal(respuestas[1].estado.producto, "bloqueo");
  });
  test("entrada inválida u opción desconocida: aviso, sin efecto", async () => {
    const a = await avanzar(estadoInicial(), { tipo: "texto", texto: "x".repeat(400) }, sv(), HOY);
    const b = await avanzar(estadoInicial(), { tipo: "opcion", valor: "borrar_base" }, sv(), HOY);
    assert.equal(a.ok, false);
    assert.equal(b.ok, false);
    assert.equal(llamadas.length, 0);
  });
});

describe("Programas: referencia por persona, nunca un total", () => {
  test("búsqueda → selección → detalle", async () => {
    const { respuestas, ultima } = await charla(["programas a turquía", "1"]);
    assert.deepEqual(llamadas.find((l) => l.op === "buscarProgramas")?.arg, { destino: "turquia", limite: "6" });
    assert.ok(valores(respuestas[0]).includes("sel:prog:10"));
    assert.match(textos(ultima), /Turquía Mágica/);
    assert.match(textos(ultima), /solo de referencia/);
    assert.match(textos(ultima), /lo calcula el asesor/);
    assert.doesNotMatch(textos(ultima), /ORIENTATIVA|Cotización/i);
    assert.equal(ultima.mensajes[0].enlace?.href, "/tarifario/programa/10");
  });
  test("cualquier destino", async () => {
    await charla([{ op: "producto:programa" }, { op: "destino:*" }]);
    assert.deepEqual(llamadas.find((l) => l.op === "buscarProgramas")?.arg, { destino: undefined, limite: "6" });
  });
  test("selección manipulada (fuera de la lista visible): pide elegir de las actuales y no consulta el detalle", async () => {
    const { ultima } = await charla(["programas a turquía", { op: "sel:prog:999" }]);
    assert.match(textos(ultima), /no está en la lista actual/);
    assert.ok(valores(ultima).includes("sel:prog:10"));
    assert.equal(llamadas.some((l) => l.op === "detallePrograma"), false);
    assert.equal(ultima.estado.seleccion, null);
    assert.equal(ultima.estado.pendiente, "seleccion");
  });
  test("selección de la lista pero despublicada en el servidor: aviso y resultados actuales", async () => {
    fallar.detallePrograma = { ok: false, codigo: "no_encontrado", motivo: "Ese programa ya no está publicado.", sello: crearSello("detallePrograma") };
    const { ultima } = await charla(["programas a turquía", "1"]);
    assert.deepEqual(llamadas.filter((l) => l.op === "detallePrograma").map((l) => l.arg), ["10"]);
    assert.match(textos(ultima), /ya no está disponible/);
    assert.ok(valores(ultima).includes("sel:prog:10"));
  });
});

describe("Bloqueos: de punta a punta", () => {
  test("producto → destino → oferta → combo → habitaciones → menores → cotización ORIENTATIVA", async () => {
    const { respuestas, ultima } = await charla([{ op: "producto:bloqueo" }, "San Andrés", "1", { op: "combo:Estándar|PAE" }, "1 doble", "5"]);
    assert.equal(respuestas[0].estado.pendiente, "destino");
    assert.ok(valores(respuestas[1]).includes("sel:blo:5-b10-7"));
    assert.equal(respuestas[2].estado.pendiente, "combo");
    assert.equal(respuestas[3].estado.pendiente, "habitaciones");
    assert.equal(respuestas[4].estado.pendiente, "menores");
    assert.deepEqual(llamadas.find((l) => l.op === "cotizarBloqueo")?.arg, { oferta: "5-b10-7", combo: "Estándar|PAE", hab_doble: "1", edadesMenores: "5" });
    assert.match(textos(ultima), /Cotización ORIENTATIVA: \$\s?2\.400\.000/);
    assert.match(textos(ultima), /3 silla\(s\) libre\(s\)/);
    assert.match(textos(ultima), /sujeto a confirmación/);
  });
  test("cambiar habitaciones conserva la oferta y vuelve a cotizar", async () => {
    await charla([{ op: "producto:bloqueo" }, "San Andrés", "1", { op: "combo:Estándar|PAE" }, "1 doble", "sin menores", "cambiar habitaciones", "2 dobles"]);
    const cot = llamadas.filter((l) => l.op === "cotizarBloqueo");
    assert.equal(cot.length, 2);
    assert.deepEqual(cot[1].arg, { oferta: "5-b10-7", combo: "Estándar|PAE", hab_doble: "2" });
  });
  test("combo manipulado (no publicado en la oferta): se vuelve a pedir", async () => {
    const { ultima } = await charla([{ op: "producto:bloqueo" }, "San Andrés", "1", { op: "combo:Lujo|TODO" }]);
    assert.equal(ultima.estado.pendiente, "combo");
    assert.equal(llamadas.some((l) => l.op === "cotizarBloqueo"), false);
  });
  test("selección caducada: la oferta dejó de estar vigente → aviso y nueva búsqueda", async () => {
    const { respuestas } = await charla([{ op: "producto:bloqueo" }, "San Andrés", "1"]);
    ofertaVigente = false;
    const r = await avanzar(respuestas[2].estado, { tipo: "opcion", valor: "combo:Estándar|PAE" }, sv(), HOY);
    assert.match(textos(r), /ya no está disponible/);
    assert.equal(r.estado.seleccion, null);
  });
  test("selección inyectada en el estado del navegador se revalida contra el servidor", async () => {
    const r = await avanzar({ ...estadoInicial(), producto: "bloqueo", destino: "san andres", seleccion: "blo:9-b99-9", combo: "Estándar|PAE", habitaciones: { doble: 1 }, edadesMenores: [] }, { tipo: "opcion", valor: "reintentar" }, sv(), HOY);
    assert.match(textos(r), /ya no está disponible/);
    assert.equal(llamadas.some((l) => l.op === "cotizarBloqueo"), false);
  });
  test("sin resultados: opciones para ajustar o consultar a un asesor", async () => {
    ofertaVigente = false;
    fallar.buscarBloqueos = { ok: false, codigo: "sin_resultados", motivo: "No hay bloqueos publicados que cumplan esos criterios.", sello: crearSello("buscarBloqueos") };
    const { ultima } = await charla([{ op: "producto:bloqueo" }, "Marte"]);
    assert.match(textos(ultima), /No hay bloqueos/);
    assert.ok(valores(ultima).includes("corregir:destino"));
    assert.ok(valores(ultima).includes("asesor"));
  });
  test("error técnico: reintentar o asesor", async () => {
    fallar.buscarBloqueos = { ok: false, codigo: "error_tecnico", motivo: "x", sello: crearSello("buscarBloqueos") };
    const { ultima } = await charla([{ op: "producto:bloqueo" }, "San Andrés"]);
    assert.deepEqual(valores(ultima).slice(0, 2), ["reintentar", "asesor"]);
  });
});

describe("Porción terrestre", () => {
  test("todo en una frase → resultados sin preguntas → cotización ORIENTATIVA", async () => {
    const { respuestas, ultima } = await charla(["porción terrestre en San Andrés del 10 al 13 de marzo de 2027 para 2 adultos, 1 doble, sin menores", "1"]);
    assert.deepEqual(llamadas.find((l) => l.op === "buscarPorcion")?.arg, { destino: "SAN ANDRÉS", fechaIda: "2027-03-10", fechaRegreso: "2027-03-13", adultos: "2", hab_doble: "1", limite: "6" });
    assert.ok(valores(respuestas[0]).includes("sel:por:50-217#Estándar|PAE"));
    assert.deepEqual(llamadas.find((l) => l.op === "cotizarPorcion")?.arg, { paquete: "50", hotel: "217", fechaIda: "2027-03-10", fechaRegreso: "2027-03-13", combo: "Estándar|PAE", hab_doble: "1" });
    assert.match(textos(ultima), /Cotización ORIENTATIVA: \$\s?1\.800\.000/);
    assert.match(textos(ultima), /Sujeto a disponibilidad del hotel/);
  });
  test("datos faltantes en orden: destino, fechas, adultos, habitaciones, menores", async () => {
    const { respuestas } = await charla([{ op: "producto:porcion" }, "cartagena", "del 10 al 13 de marzo de 2027", "2", "1 doble"]);
    assert.deepEqual(respuestas.map((r) => r.estado.pendiente), ["destino", "fechas", "adultos", "habitaciones", "menores"]);
  });
  test("destino fuera de la lista: no se adivina, se ofrece la lista", async () => {
    const { ultima } = await charla([{ op: "producto:porcion" }, "París"]);
    assert.ok(valores(ultima).includes("destino:SAN ANDRÉS"));
    assert.equal(ultima.estado.destino, null);
  });
  test("fecha ambigua (día/mes): pregunta con las dos lecturas", async () => {
    const { ultima } = await charla([{ op: "producto:porcion" }, "cartagena", "03/04/2027 al 10/04/2027"]);
    assert.equal(ultima.estado.fechaIda, null);
    assert.ok(valores(ultima).some((v) => v.startsWith("fechas:")));
  });
  test("fecha pasada: se rechaza", async () => {
    const { ultima } = await charla([{ op: "producto:porcion" }, "cartagena", "del 10 al 13 de marzo de 2020"]);
    assert.match(textos(ultima), /ya pasó/);
    assert.equal(ultima.estado.fechaIda, null);
  });
  test("cantidad ambigua: pide un número exacto", async () => {
    const { ultima } = await charla([{ op: "producto:porcion" }, "cartagena", "del 10 al 13 de marzo de 2027", "2 o 3"]);
    assert.match(textos(ultima), /número exacto/);
    assert.equal(ultima.estado.adultos, null);
  });
  test("menores sin edades: pregunta las edades", async () => {
    const { ultima } = await charla([{ op: "producto:porcion" }, "cartagena", "del 10 al 13 de marzo de 2027", "2", "1 doble", "2 niños"]);
    assert.match(textos(ultima), /Qué edad/);
    assert.equal(ultima.estado.edadesMenores, null);
  });
  test("corregir fechas borra la selección y vuelve a preguntar", async () => {
    const { respuestas, ultima } = await charla(["porción terrestre en San Andrés del 10 al 13 de marzo de 2027 para 2 adultos, 1 doble, sin menores", "1", "cambiar fechas"]);
    assert.equal(respuestas[1].estado.seleccion, "por:50-217#Estándar|PAE");
    assert.equal(ultima.estado.seleccion, null);
    assert.equal(ultima.estado.fechaIda, null);
    assert.equal(ultima.estado.pendiente, "fechas");
  });
  test("selección de otro producto inyectada (bloqueo en porción): fuera de la lista, nunca cotiza", async () => {
    const { respuestas } = await charla(["porción terrestre en San Andrés del 10 al 13 de marzo de 2027 para 2 adultos, 1 doble, sin menores"]);
    const r = await avanzar(respuestas[0].estado, { tipo: "opcion", valor: "sel:blo:5-b10-7" }, sv(), HOY);
    assert.match(textos(r), /no está en la lista actual/);
    assert.ok(valores(r).includes("sel:por:50-217#Estándar|PAE"));
    assert.equal(llamadas.some((l) => l.op === "cotizarPorcion" || l.op === "ofertaBloqueo"), false);
  });
  test("motivo comercial del motor (no cotiza): opciones para ajustar", async () => {
    fallar.cotizarPorcion = { ok: false, codigo: "no_cotizable", motivo: "Para las fechas elegidas no encontramos una tarifa.", sugerencias_fecha: [{ fecha_ida: "2027-03-11", fecha_regreso: "2027-03-14", noches: 3, etiqueta: "11 mar - 14 mar" }], sello: crearSello("cotizarPorcion") };
    const { ultima } = await charla(["porción terrestre en San Andrés del 10 al 13 de marzo de 2027 para 2 adultos, 1 doble, sin menores", "1"]);
    assert.match(textos(ultima), /no encontramos una tarifa/);
    assert.ok(valores(ultima).includes("fechas:2027-03-11,2027-03-14"));
  });
});

describe("selección: solo de la última lista visible (opción y número)", () => {
  const PORCION_COMPLETA = "porción terrestre en San Andrés del 10 al 13 de marzo de 2027 para 2 adultos, 1 doble, sin menores";
  const NO_ESTA = /no está en la lista actual/;

  // Positivas: la selección de la lista visible se acepta y el servidor la revalida.
  test("opción de la lista visible (Programas): consulta el detalle", async () => {
    const { ultima } = await charla(["programas a turquía", { op: "sel:prog:10" }]);
    assert.deepEqual(llamadas.filter((l) => l.op === "detallePrograma").map((l) => l.arg), ["10"]);
    assert.match(textos(ultima), /Turquía Mágica/);
    assert.doesNotMatch(textos(ultima), NO_ESTA);
  });
  test("número de la lista visible (Bloqueos): revalida la oferta y pide el combo", async () => {
    const { ultima } = await charla([{ op: "producto:bloqueo" }, "San Andrés", "1"]);
    assert.deepEqual(llamadas.filter((l) => l.op === "ofertaBloqueo").map((l) => l.arg), ["5-b10-7"]);
    assert.equal(ultima.estado.seleccion, "blo:5-b10-7");
    assert.equal(ultima.estado.pendiente, "combo");
  });
  test("opción de la lista visible (Porción): cotiza con el servidor", async () => {
    const { ultima } = await charla([PORCION_COMPLETA, { op: "sel:por:50-217#Estándar|PAE" }]);
    assert.equal(llamadas.filter((l) => l.op === "cotizarPorcion").length, 1);
    assert.match(textos(ultima), /Cotización ORIENTATIVA/);
  });
  test("de la lista pero ya no vigente: el filtro de lista no reemplaza la revalidación del servidor", async () => {
    const { ultima: lista } = await charla([{ op: "producto:bloqueo" }, "San Andrés"]);
    ofertaVigente = false;
    const r = await avanzar(lista.estado, { tipo: "opcion", valor: "sel:blo:5-b10-7" }, sv(), HOY);
    assert.deepEqual(llamadas.filter((l) => l.op === "ofertaBloqueo").map((l) => l.arg), ["5-b10-7"]);
    assert.match(textos(r), /ya no está disponible/);
    assert.equal(r.estado.seleccion, null);
  });
  test("lista manipulada en el navegador: pasa el filtro de lista pero el servidor la rechaza", async () => {
    const { ultima: lista } = await charla([{ op: "producto:bloqueo" }, "San Andrés"]);
    const manipulado = { ...lista.estado, ultimaLista: [...lista.estado.ultimaLista, "sel:blo:9-b99-9"] };
    const r = await avanzar(manipulado, { tipo: "opcion", valor: "sel:blo:9-b99-9" }, sv(), HOY);
    assert.ok(llamadas.some((l) => l.op === "ofertaBloqueo" && l.arg === "9-b99-9"));
    assert.match(textos(r), /ya no está disponible/);
    assert.equal(llamadas.some((l) => l.op === "cotizarBloqueo"), false);
  });

  // Negativas: fuera de la lista visible, o sin lista, se pide elegir de las opciones actuales.
  test("opción fuera de la lista visible (Bloqueos): no consulta la oferta y vuelve a listar", async () => {
    const { ultima } = await charla([{ op: "producto:bloqueo" }, "San Andrés", { op: "sel:blo:9-b99-9" }]);
    assert.match(textos(ultima), NO_ESTA);
    assert.equal(llamadas.some((l) => l.op === "ofertaBloqueo"), false);
    assert.equal(llamadas.filter((l) => l.op === "buscarBloqueos").length, 2);
    assert.ok(valores(ultima).includes("sel:blo:5-b10-7"));
    assert.equal(ultima.estado.seleccion, null);
    assert.equal(ultima.estado.pendiente, "seleccion");
  });
  test("sin lista (inicio): no consulta nada y pide el producto", async () => {
    const r = await avanzar(estadoInicial(), { tipo: "opcion", valor: "sel:prog:10" }, sv(), HOY);
    assert.match(textos(r), NO_ESTA);
    assert.equal(llamadas.length, 0);
    assert.deepEqual(valores(r).slice(0, 3), ["producto:programa", "producto:bloqueo", "producto:porcion"]);
    assert.equal(r.estado.seleccion, null);
  });
  test("lista anterior que ya no es la visible (eligiendo combo): no cambia la selección", async () => {
    const { ultima } = await charla([{ op: "producto:bloqueo" }, "San Andrés", "1", { op: "sel:blo:5-b10-7" }]);
    assert.match(textos(ultima), NO_ESTA);
    assert.equal(ultima.estado.pendiente, "combo");
    assert.ok(valores(ultima).includes("combo:Estándar|PAE"));
    assert.equal(llamadas.some((l) => l.op === "cotizarBloqueo"), false);
  });
  test("tras mostrar un resultado (sin lista visible): la selección no se acepta", async () => {
    const { ultima } = await charla(["programas a turquía", "1", { op: "sel:prog:10" }]);
    assert.match(textos(ultima), NO_ESTA);
    assert.equal(valores(ultima).some((v) => v.startsWith("sel:")), false);
    assert.ok(valores(ultima).includes("corregir:seleccion"));
  });
  test("agencia pendiente: una selección vuelve a mostrar las agencias", async () => {
    const { ultima } = await charla([{ op: "producto:bloqueo" }, "San Andrés", "es para una agencia", { op: "sel:blo:5-b10-7" }]);
    assert.match(textos(ultima), NO_ESTA);
    assert.deepEqual(valores(ultima), ["ag:3", "ag:4"]);
    assert.equal(ultima.estado.pendiente, "agencia");
    assert.equal(llamadas.some((l) => l.op === "ofertaBloqueo"), false);
  });
  test("número fuera de rango: no consulta y pide elegir de la lista", async () => {
    const { ultima } = await charla([{ op: "producto:bloqueo" }, "San Andrés", "7"]);
    assert.match(textos(ultima), /Elige una de las opciones/);
    assert.equal(llamadas.some((l) => l.op === "ofertaBloqueo"), false);
    assert.equal(ultima.estado.pendiente, "seleccion");
  });
  test("número que apunta a una selección mientras se elige combo (lista manipulada): no cambia la oferta", async () => {
    const { ultima: combos } = await charla([{ op: "producto:bloqueo" }, "San Andrés", "1"]);
    const manipulado = { ...combos.estado, ultimaLista: ["sel:blo:9-b99-9"] };
    const r = await avanzar(manipulado, { tipo: "texto", texto: "1" }, sv(), HOY);
    assert.match(textos(r), NO_ESTA);
    assert.equal(llamadas.some((l) => l.op === "ofertaBloqueo" && l.arg === "9-b99-9"), false);
    assert.equal(r.estado.seleccion, "blo:5-b10-7");
    assert.equal(r.estado.pendiente, "combo");
  });
});

describe("ambigüedad de producto y productos no disponibles", () => {
  test("«paquete» pregunta entre Bloqueo y Porción", async () => {
    const { ultima } = await charla(["quiero un paquete"]);
    assert.deepEqual(valores(ultima).slice(0, 2), ["producto:bloqueo", "producto:porcion"]);
    assert.equal(ultima.estado.producto, null);
  });
  test("tours: todavía no; ofrece los productos disponibles", async () => {
    const { ultima } = await charla(["tours en cartagena"]);
    assert.match(textos(ultima), /todavía no se consultan/);
    assert.equal(ultima.estado.producto, null);
  });
});

describe("B2B: solo el porcentaje propio de la agencia", () => {
  test("elegir agencia muestra su % y nunca un monto", async () => {
    const { respuestas, ultima } = await charla([{ op: "producto:bloqueo" }, "es para una agencia sol", { op: "ag:3" }]);
    assert.deepEqual(valores(respuestas[1]), ["ag:3"]);
    assert.match(textos(ultima), /Comisión de Viajes Sol: 10% \(porcentaje propio/);
    assert.match(textos(ultima), /La base y el monto los calcula y confirma el asesor/);
    assert.equal(ultima.estado.agenciaId, 3);
  });
  test("agencia inexistente o manipulada: no se fija", async () => {
    const { ultima } = await charla([{ op: "producto:bloqueo" }, { op: "ag:999" }]);
    assert.equal(ultima.estado.agenciaId, null);
    assert.match(textos(ultima), /No se encontró/);
  });
});

describe("no filtración", () => {
  test("una conversación completa no contiene claves prohibidas ni datos internos", async () => {
    const { respuestas } = await charla([{ op: "producto:bloqueo" }, "San Andrés", "1", { op: "combo:Estándar|PAE" }, "1 doble", "5"]);
    for (const r of respuestas) {
      assert.deepEqual(clavesProhibidasEn(r), []);
      const json = JSON.stringify(r);
      for (const v of ["record", "PNR", "netoPorAcom", "proveedor", "numero_silla", "tarifa_neta"]) assert.equal(json.includes(v), false, v);
    }
  });
  test("si una consulta trajera un dato prohibido, la respuesta entera se descarta", async () => {
    fallar.buscarBloqueos = ok({ ofertas: [{ ...OFERTA, record: "L93FYZ", tarifa_neta: 400_000 }], total_encontradas: 1, truncado: false });
    const { ultima } = await charla([{ op: "producto:bloqueo" }, "San Andrés"]);
    const json = JSON.stringify(ultima);
    // Los datos prohibidos no llegan al texto: el flujo solo arma mensajes con campos de lista blanca.
    assert.equal(json.includes("L93FYZ"), false);
    assert.equal(json.includes("400000"), false);
    assert.deepEqual(clavesProhibidasEn(ultima), []);
  });
});
