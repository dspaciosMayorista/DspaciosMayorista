// ===========================================================================
// Piloto de la Ventana de Programas — plantillas y normalizacion.
//
// Logica pura: no toca Supabase, no toca red, no toca la base. Todo lo que se
// prueba aqui es lo que decides que affirmo el texto y cuando NO lo afirmo.
//
// La razon de que estas pruebas vivan en `plantillas.ts` y no en el componente
// es que el motor corre en el SERVIDOR. Si la redaccion estuviera en React, un
// cambio de componente podria cambiar lo que se le dice a un cliente sin que
// ninguna prueba se enterar.
// ===========================================================================

import { test } from "node:test";
import assert from "node:assert/strict";

import { generarBorrador } from "@/app/(dashboard)/dashboard/cotizaciones/ventana-programas/plantillas";
import { normalizarEntrada } from "@/app/(dashboard)/dashboard/cotizaciones/ventana-programas/tiposVista";
import type {
  ConsultaVentanaInput,
  FuenteBorrador,
} from "@/app/(dashboard)/dashboard/cotizaciones/ventana-programas/tiposVista";
import type {
  SalesbotBusquedaResultado,
  SalesbotDetalleProgramaSeguro,
} from "@/lib/salesbot/types";

// ─── Fixtures ──────────────────────────────────────────────────────────────

const BUSQUEDA: SalesbotBusquedaResultado = {
  programas: [
    {
      id: 1,
      nombre: "Amazonas 4 noches",
      subtitulo: "Circuito nacional",
      dias: 4,
      noches: 4,
      moneda: "USD",
      desde_pvp: 1_060_000,
      tipo_transporte: "terrestre",
      portada_url: null,
      ciudades: ["Leticia", "Puerto Narino"],
    },
    {
      id: 2,
      nombre: "Costa Rica",
      subtitulo: null,
      dias: 5,
      noches: 4,
      moneda: "USD",
      // Sin precio minimo publicable: `desde_pvp` null.
      desde_pvp: null,
      tipo_transporte: "aereo",
      portada_url: null,
      ciudades: ["San Jose"],
    },
  ],
  no_consultado: ["vigencia", "condiciones", "min_max_pax", "disponibilidad"],
};

function precio(over: Partial<SalesbotDetalleProgramaSeguro["categorias"][number]["precios"][number]> = {}) {
  return {
    moneda: "USD",
    pvp: 1_060_000,
    estado_precio: "CONFIRMADO" as const,
    origen: "categoria" as const,
    bajo_solicitud: false,
    acomodacion: "doble",
    ...over,
  };
}

function detalle(over: Partial<SalesbotDetalleProgramaSeguro> = {}): SalesbotDetalleProgramaSeguro {
  return {
    id: 1,
    nombre: "Amazonas 4 noches",
    subtitulo: "Circuito nacional",
    dias: 4,
    noches: 4,
    moneda: "USD",
    tipo_transporte: "terrestre",
    proveedor_nombre: "Proveedor Andes",
    portada_url: null,
    flyer_url: null,
    historia_url: null,
    video_url: null,
    highlights: [],
    texto_condiciones: "Venta sujeta a confirmacion de cupos por el operador.",
    texto_cancelacion: "Cancelacion sin costo hasta 15 dias antes.",
    texto_pagos: "50% para reservar, 50% contra entrega.",
    vigencia_desde: "2026-01-01",
    vigencia_hasta: "2026-12-31",
    min_pax: 2,
    max_pax: 16,
    edad_nino_min: 2,
    edad_nino_max: 11,
    edad_infante_max: 1,
    ciudades: [{ nombre: "Leticia", noches: 4, codigo_iata: null }],
    itinerario: [],
    categorias: [{ id: 1, nombre: "General", hoteles: [], precios: [precio()] }],
    salidas: [
      {
        id: 10,
        etiqueta: "Salida enero",
        fecha_desde: "2026-01-10",
        fecha_hasta: "2026-01-14",
        noches: 4,
        bajo_solicitud: false,
        precios: [precio({ origen: "salida" })],
      },
    ],
    inclusiones: [],
    tours: [],
    blackouts: [],
    ...over,
  };
}

const VIAJERO_COMPLETO: Partial<ConsultaVentanaInput> = {
  destino: "Leticia",
  fechaSalida: "2026-01-10",
  pax: 2,
  edades: [30, 28],
  acomodacion: "doble",
};

function entrada(over: Partial<ConsultaVentanaInput> = {}): ConsultaVentanaInput {
  return { tipoConsulta: "precio", ...VIAJERO_COMPLETO, ...over };
}

function fuenteDetalle(over: Partial<SalesbotDetalleProgramaSeguro> = {}): FuenteBorrador {
  return { clase: "detalle", datos: detalle(over) };
}

// ─── 1 y 2. El formulario y las edades ────────────────────────────────────

test("1. sin pax no pide edades: la respuesta es pedir el conteo y nada mas", () => {
  const b = generarBorrador(
    { tipoConsulta: "precio", destino: "Leticia", fechaSalida: "2026-01-10" },
    fuenteDetalle(),
  );
  assert.equal(b.seguro, true);
  assert.match(b.texto, /número de pasajeros/);
  // La edad no se pide todavia: no se sabe cuantos son.
  assert.ok(!/edad/.test(b.texto), `no debia pedir edad: ${b.texto}`);
});

test("2. con pax valido si pide edades cuando faltan", () => {
  const dos = generarBorrador(entrada({ pax: 2, edades: [] }), fuenteDetalle());
  assert.match(dos.texto, /edad de cada pasajero/);

  const uno = generarBorrador(entrada({ pax: 1, edades: [] }), fuenteDetalle());
  assert.match(uno.texto, /edad del pasajero/);
  assert.ok(!/cada pasajero/.test(uno.texto), "con pax=1 va en singular");

  // Con las edades completas ya no se pide nada.
  const completo = generarBorrador(entrada(), fuenteDetalle());
  assert.ok(!/necesito/.test(completo.texto), `no debia pedir datos: ${completo.texto}`);
});

test("2b. `programas` no exige datos del viaje: lista sin pax ni fecha", () => {
  const b = generarBorrador({ tipoConsulta: "programas", destino: "Leticia" }, {
    clase: "busqueda",
    datos: BUSQUEDA,
  });
  assert.equal(b.seguro, true);
  assert.match(b.texto, /Amazonas 4 noches/);
  assert.ok(!/necesito/.test(b.texto), "listar no necesita pax");
});

// ─── 3. Disponibilidad: abstension obligatoria ─────────────────────────────

test("3. disponibilidad siempre se abstiene, con datos o sin ellos", () => {
  const casos: ConsultaVentanaInput[] = [
    { tipoConsulta: "disponibilidad" },
    { tipoConsulta: "disponibilidad", destino: "Leticia", fechaSalida: "2026-01-10", pax: 2, edades: [30, 28] },
    { tipoConsulta: "disponibilidad", programaId: 1 },
  ];
  for (const e of casos) {
    const b = generarBorrador(e, fuenteDetalle());
    assert.equal(b.seguro, true);
    assert.equal(b.requiereEscalamiento, true);
    assert.match(b.texto, /No tengo disponibilidad en tiempo real/);
    // Ni una afirmacion de cupos, aunque el detalle tenga salidas y precios.
    assert.ok(!/hay cupos/i.test(b.texto));
    assert.ok(!/quedan \d+/i.test(b.texto));
    assert.ok(!/disponibles/i.test(b.texto));
  }
});

test("3b. la fecha de salida no se confunde con disponibilidad", () => {
  const b = generarBorrador(entrada({ tipoConsulta: "fechas" }), fuenteDetalle());
  assert.equal(b.seguro, true);
  assert.match(b.texto, /2026-01-10/);
  assert.ok(!/hay cupos|queda disponibilidad|disponible/i.test(b.texto), b.texto);
});

// ─── 4. Precio: nunca 0, nunca "confirmado" ───────────────────────────────

test("4. pvp null o cero NUNCA se muestra como 0 ni como $0", () => {
  const nulos: SalesbotDetalleProgramaSeguro[] = [
    detalle({
      categorias: [{ id: 1, nombre: "G", hoteles: [], precios: [precio({ pvp: null, estado_precio: "A_SOLICITUD", bajo_solicitud: true })] }],
      salidas: [],
    }),
    detalle({
      categorias: [{ id: 1, nombre: "G", hoteles: [], precios: [precio({ pvp: null, estado_precio: "NO_CONFIRMADO" })] }],
      salidas: [],
    }),
  ];
  for (const d of nulos) {
    const b = generarBorrador(entrada(), { clase: "detalle", datos: d });
    assert.equal(b.seguro, true, b.texto);
    // Sin cifra: ni "$ 0", ni "0 USD", ni un 0 suelto precedido de espacio.
    assert.ok(!/\$\s*0\b/.test(b.texto), `aparecio $0: ${b.texto}`);
    assert.ok(!/\b0\s*(USD|COP|EUR)/.test(b.texto), `aparecio 0 con moneda: ${b.texto}`);
    assert.ok(!/(^|\s)0(\s|$)/.test(b.texto), `aparecio un 0 suelto: ${b.texto}`);
  }

  // El centinela `0` de `pvpPrograma` es el caso peligroso: llega con
  // estado CONFIRMADO, asi que sin el filtro `> 0` se imprimiria como "$0".
  const cero = generarBorrador(entrada(), fuenteDetalle({
    categorias: [{ id: 1, nombre: "G", hoteles: [], precios: [precio({ pvp: 0 })] }],
    salidas: [],
  }));
  assert.equal(cero.seguro, true);
  assert.match(cero.texto, /precio a confirmar/, "un pvp de 0 se trata como sin precio");
  assert.ok(!/\$\s*0\b/.test(cero.texto), `aparecio $0: ${cero.texto}`);
});

test("4b. los tres estados de precio producen las tres redacciones", () => {
  const conPvp = generarBorrador(entrada(), fuenteDetalle());
  // `formatearMoneda` en es-CO rinde "US$ 1.060.000", no "USD".
  assert.match(conPvp.texto, /US\$\s*1\.060\.000/);
  assert.ok(!/confirmado/i.test(conPvp.texto), `nunca 'precio confirmado': ${conPvp.texto}`);
  assert.match(conPvp.texto, /referencia/);

  const aSolicitud = generarBorrador(entrada(), fuenteDetalle({
    categorias: [{ id: 1, nombre: "G", hoteles: [], precios: [precio({ pvp: null, estado_precio: "A_SOLICITUD", bajo_solicitud: true })] }],
    salidas: [],
  }));
  assert.match(aSolicitud.texto, /a solicitud/);
  assert.equal(aSolicitud.requiereEscalamiento, true);
  assert.ok(!/US\$/.test(aSolicitud.texto), `a solicitud no lleva cifra: ${aSolicitud.texto}`);

  const sinPrecio = generarBorrador(entrada(), fuenteDetalle({
    categorias: [{ id: 1, nombre: "G", hoteles: [], precios: [precio({ pvp: null, estado_precio: "NO_CONFIRMADO" })] }],
    salidas: [],
  }));
  assert.match(sinPrecio.texto, /precio a confirmar/);
});

test("4c. si la acomodacion pedida no existe, NO se listan precios de otra", () => {
  const b = generarBorrador(entrada({ acomodacion: "cuadruple" }), fuenteDetalle());
  assert.equal(b.seguro, true);
  assert.ok(!/US\$/.test(b.texto), `no debia mostrar precio de otra acomodacion: ${b.texto}`);
  assert.ok(b.avisos.some((a) => /acomodacion/i.test(a)), b.avisos.join(" | "));
});

// ─── 5. "desde" solo con `desde_pvp` ─────────────────────────────────────

test("5. 'desde' solo aparece cuando hay `desde_pvp` real", () => {
  const conPrecio = generarBorrador({ tipoConsulta: "programas", destino: "Leticia" }, {
    clase: "busqueda",
    datos: BUSQUEDA,
  });
  assert.match(conPrecio.texto, /Valores desde US\$\s*1\.060\.000/);

  const sinPrecio = generarBorrador({ tipoConsulta: "programas", destino: "Leticia" }, {
    clase: "busqueda",
    datos: { ...BUSQUEDA, programas: BUSQUEDA.programas.map((p) => ({ ...p, desde_pvp: null })) },
  });
  assert.ok(!/desde/i.test(sinPrecio.texto), `no debia decir 'desde': ${sinPrecio.texto}`);
  assert.ok(!/\$/.test(sinPrecio.texto), `no debia inventar cifra: ${sinPrecio.texto}`);

  const cero = generarBorrador({ tipoConsulta: "programas", destino: "Leticia" }, {
    clase: "busqueda",
    datos: { ...BUSQUEDA, programas: BUSQUEDA.programas.map((p) => ({ ...p, desde_pvp: 0 })) },
  });
  assert.ok(!/desde/i.test(cero.texto), `un 0 no es un precio: ${cero.texto}`);
});

test("5b. 'programas' dice programas publicados, nunca disponibles", () => {
  const b = generarBorrador({ tipoConsulta: "programas", destino: "Leticia" }, {
    clase: "busqueda",
    datos: BUSQUEDA,
  });
  assert.match(b.texto, /publicado/);
  assert.ok(!/disponible/i.test(b.texto), b.texto);
});

// ─── 6. El guard bloquea texto inseguro ───────────────────────────────────

test("6. texto con frase comercial queda bloqueado: sin texto y sin frases copiables", () => {
  // Un `texto_condiciones` del catálogo que afirma disponibilidad.
  const b = generarBorrador(entrada({ tipoConsulta: "condiciones" }), fuenteDetalle({
    texto_condiciones: "El hotel esta disponible y le garantizamos el cupo.",
  }));
  assert.equal(b.seguro, false);
  assert.equal(b.texto, "", "el texto no debe viajar al navegador");
  assert.ok(b.frasesBloqueadas.length > 0);
  assert.equal(b.requiereEscalamiento, true);
});

test("6b. la negacion es la redaccion honesta: pasa", () => {
  const b = generarBorrador(entrada({ tipoConsulta: "condiciones" }), fuenteDetalle({
    texto_condiciones: "No hay disponibilidad en tiempo real; se confirma con el asesor.",
  }));
  assert.equal(b.seguro, true, b.texto);
  assert.match(b.texto, /No hay disponibilidad en tiempo real/);
});

test("6c. 'otro' deriva sin afirmar nada", () => {
  const b = generarBorrador({ tipoConsulta: "otro", destino: "Leticia" }, fuenteDetalle());
  assert.equal(b.seguro, true);
  assert.match(b.texto, /asesor/);
  assert.ok(!/hay cupos|disponible|confirmado/i.test(b.texto), b.texto);
});

// ─── 7. Errores y escalamiento ────────────────────────────────────────────

test("7. un error escalable cierra con derivacion y el codigo se ve en el panel", () => {
  const b = generarBorrador(entrada(), {
    clase: "error",
    codigo: "PROGRAMA_NO_PUBLICADO",
    mensaje: "Ese programa no esta disponible.",
    escalable: false,
  });
  assert.equal(b.seguro, true);
  assert.match(b.texto, /Ese programa no esta disponible/);
  assert.equal(b.requiereEscalamiento, false);
  assert.ok(b.avisos.some((a) => a.includes("PROGRAMA_NO_PUBLICADO")), b.avisos.join(" | "));
});

test("7b. todo borrador de precio termina confirmando con un asesor", () => {
  const b = generarBorrador(entrada(), fuenteDetalle());
  assert.match(b.texto, /asesor responsable antes de reservar/);
});

// ─── Normalizacion de entrada (server action) ─────────────────────────────

test("8. normalizarEntrada descarta lo que no se puede interpretar", () => {
  const n = normalizarEntrada({
    tipoConsulta: "precio",
    destino: "  Leticia  ",
    pax: "2",
    edades: ["30", "28", "basura"],
    programaId: "7",
    tipoTransporte: "inventado",
  });
  assert.ok(!("error" in n));
  if ("error" in n) return;
  assert.equal(n.destino, "Leticia");
  assert.equal(n.pax, 2);
  assert.deepEqual(n.edades, [30, 28], "la edad no numerica se descarta");
  assert.equal(n.programaId, 7);
  assert.equal(n.tipoTransporte, undefined, "un transporte inventado no pasa");
});

test("8b. sin pax no se guarda lista de edades, y el tipo debe ser valido", () => {
  const n = normalizarEntrada({ tipoConsulta: "precio", pax: 0, edades: [30, 28] });
  assert.ok(!("error" in n));
  if ("error" in n) return;
  assert.equal(n.pax, null);
  assert.deepEqual(n.edades, []);

  const malo = normalizarEntrada({ tipoConsulta: "inventado" });
  assert.ok("error" in malo);
});