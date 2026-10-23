import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  COLUMNAS_INTERNAS_PROHIBIDAS,
  contieneColumnaInterna,
  crearLectoresSalesbot,
  proyectarDetalle,
  salesbotBuscarProgramas,
  salesbotDetallePrograma,
  estadoPrecio,
  type SalesbotLectores,
} from "../lib/salesbot/programas.ts";
import {
  MENSAJE_ERROR,
  datosFaltantesParaCotizar,
  detectarFrasesProhibidas,
  errorDesdeCodigo,
  representarFechasSalida,
  representarPrecio,
  representarPrecioDesde,
  salesbotConsultarDisponibilidad,
  textoEsSeguro,
} from "../lib/salesbot/respuestas.ts";
import { salesbot_aislamiento_real, type SalesbotContextoLectura } from "../lib/salesbot/types.ts";
import type { ProgramaDetalle } from "../lib/programas.ts";

// ===========================================================================
// Ejecución REAL de la capa de lectura del Salesbot (Fase A).
//
// Lo que importa aquí es que `proyectarDetalle` se ejecuta de verdad sobre una
// fila CRUDA que trae TODAS las columnas internas (`notas`, `pct_mk`,
// `regla_comisionable*`, `neto` en los hijos...), y se comprueba que ninguna
// sobreviva. Si el crudo no las tuviera, la prueba sería un tautología.
//
// Para el gate y los errores se inyectan lectores. Inyectar NO salta el gate:
// `salesbotDetallePrograma` exige `publicado && activo` sobre lo que el lector
// devuelva, y eso se comprueba con un lector que devuelve un borrador.
// ===========================================================================

type Row = Record<string, unknown>;

/** Fila cruda de `programas`, tal como la devuelve `select('*')`. */
function programaCrudo(over: Partial<Row> = {}): Row {
  return {
    id: 1,
    nombre: "Amazonas 4 noches",
    subtitulo: "Circuito nacional",
    dias: 4,
    noches: 4,
    moneda: "USD",
    tipo_transporte: "terrestre",
    proveedor_id: 9,
    // --- columnas INTERNAS: ninguna debe salir ---
    notas: "INTERNAL: margen negociado con el proveedor, no publicar",
    pct_mk: 0.25,
    pct_fee_tarjeta: 0.03,
    asistencia_medica_dia: 7.5,
    desde_precio: 999_999,
    incluye_aereo: false,
    regla_comisionable: true,
    regla_comisionable_modo: "pct",
    regla_comisionable_valor: 10,
    regla_comisionable_pct_comision: 20,
    regla_comisionable_modalidad_mk: "base_neta_impuestos_al_final",
    regla_comisionable_impuesto_por_acomodacion: true,
    // --- gate ---
    activo: true,
    publicado: true,
    // --- presentacion / comercial publicable ---
    portada_url: "https://cdn/p.png",
    flyer_url: "https://cdn/f.pdf",
    historia_url: "https://cdn/h.html",
    video_url: "https://cdn/v.mp4",
    highlights: ["Río Arapi", "Comunidad Upreis"],
    texto_condiciones: "No incluye propelina.",
    texto_cancelacion: "Cancelación según política del proveedor.",
    texto_pagos: "50% y 50%.",
    vigencia_desde: "2026-01-01",
    vigencia_hasta: "2026-12-31",
    min_pax: 2,
    max_pax: 16,
    edad_nino_min: 2,
    edad_nino_max: 11,
    edad_infante_max: 1,
    ...over,
  };
}

/** Detalle crudo: shape de `ProgramaDetalle` CON `neto` en los hijos. */
function detalleCrudo(over: { programa?: Row } = {}): ProgramaDetalle {
  const crudo = {
    programa: over.programa ?? programaCrudo(),
    proveedorNombre: "PROVEEDOR TURISMO",
    ciudades: [{ id: 1, nombre: "Leticia", noches: 4, codigo_iata: "SKMU" }],
    dias: [{ dia: 1, titulo: "Leticia", desayuno: true, almuerzo: true, cena: true, descripcion: "Recepción" }],
    categorias: [
      {
        id: 5,
        nombre: "Estándar",
        hoteles: [{ ciudad: "Leticia", hotel: "HOTEL AMAZONAS" }],
        precios: [
          { acomodacion: "sencilla", neto: 800_000, pvp: 1_060_000, bajo_solicitud: false },
          { acomodacion: "doble", neto: 900_000, pvp: null, bajo_solicitud: true },
        ],
      },
    ],
    salidas: [
      {
        id: 20,
        etiqueta: "Salida enero",
        fecha_desde: "2026-01-10",
        fecha_hasta: null,
        noches: 4,
        columna: null,
        bajo_solicitud: false,
        precios: [
          { acomodacion: "doble", neto: 900_000, pvp: 1_190_000 },
          { acomodacion: "triple", neto: 950_000, pvp: null },
        ],
      },
    ],
    inclusiones: [{ ciudad: "Leticia", tipo: "incluye", texto: "Aéreo interno" }],
    tours: [
      { ciudad: "Leticia", nombre: "Delfín", precio: 120_000, min_pax: 2, dias_operacion: "Mar-Sab", descripcion: null },
      { ciudad: "Leticia", nombre: "Arapinga", precio: null, min_pax: 4, dias_operacion: null, descripcion: "Terrestre" },
    ],
    blackouts: [{ fecha_inicio: "2026-02-01", fecha_fin: "2026-02-10", motivo: "Feriado", ciudad: "Leticia" }],
  };
  // El unico `as` del archivo: el fixture es parcial a proposito. No replica las
  // ~40 columnas de `programas`; las que el modulo lee estan todas presentes y
  // verificadas por asercion.
  return crudo as unknown as ProgramaDetalle;
}

const CTX: SalesbotContextoLectura = { sb: {}, tenant: "mayorista" };

const RESUMEN_UNO = [
  {
    id: 1,
    nombre: "Amazonas 4 noches",
    subtitulo: "Circuito nacional",
    dias: 4,
    noches: 4,
    moneda: "USD",
    desde_pvp: 1_060_000,
    tipo_transporte: "terrestre" as const,
    portada_url: null,
    ciudades: ["Leticia", "Puerto Nariño"],
  },
];

function lectores(over: Partial<SalesbotLectores> = {}): SalesbotLectores {
  return crearLectoresSalesbot({
    resumen: async () => ({ programas: RESUMEN_UNO, error: null }),
    detalle: async () => detalleCrudo(),
    ...over,
  });
}

// ───────────────────────────────────────────────────────────────────────────
// Pruebas 1 y 2: el gate
// ───────────────────────────────────────────────────────────────────────────

describe("salesbotDetallePrograma - gate de publicación (pruebas 1 y 2)", () => {
  test("1. un programa NO publicado se rechaza", async () => {
    const r = await salesbotDetallePrograma(1, CTX, lectores({
      detalle: async () => detalleCrudo({ programa: programaCrudo({ publicado: false }) }),
    }));
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.error.codigo, "PROGRAMA_NO_PUBLICADO");
      assert.equal(r.error.traza?.motivo, "no_publicado");
      // El mensaje NO revela que es un borrador: indistinguible de "no existe".
      assert.equal(r.error.mensaje, MENSAJE_ERROR.PROGRAMA_NO_PUBLICADO.mensaje);
      assert.ok(!/borrador/i.test(r.error.mensaje));
      assert.ok(!/publicado/i.test(r.error.mensaje));
    }
  });

  test("2. un programa INACTIVO también se rechaza (hueco de la página pública)", async () => {
    const r = await salesbotDetallePrograma(1, CTX, lectores({
      detalle: async () => detalleCrudo({ programa: programaCrudo({ activo: false }) }),
    }));
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.error.codigo, "PROGRAMA_NO_PUBLICADO");
      assert.equal(r.error.traza?.motivo, "inactivo");
    }
  });

  test("2b. los cuatro rechazos dan el MISMO mensaje de usuario", async () => {
    const msgs = new Set<string>();
    const casos = [
      lectores({ detalle: async () => detalleCrudo({ programa: programaCrudo({ publicado: false }) }) }),
      lectores({ detalle: async () => detalleCrudo({ programa: programaCrudo({ activo: false }) }) }),
      lectores({ detalle: async () => null }),
    ];
    // Y el id invalido, que se rechaza sin consultar.
    for (const l of casos) {
      const r = await salesbotDetallePrograma(1, CTX, l);
      assert.equal(r.ok, false);
      if (!r.ok) msgs.add(r.error.mensaje);
    }
    // 'inexistente' con id 1 cae en 'no existe'; se compara contra el mismo texto.
    assert.equal(msgs.size, 1, `mensajes divergentes: ${[...msgs].join(" | ")}`);
  });

  test("2c. un id inválido se rechaza antes de consultar", async () => {
    let consulto = false;
    const r = await salesbotDetallePrograma(0, CTX, lectores({
      detalle: async () => { consulto = true; return detalleCrudo(); },
    }));
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.error.traza?.motivo, "invalido");
    assert.equal(consulto, false, "no se consultó con un id inválido");
  });

  test("2d. el gate exige ambos flags en el fuente (defensa en profundidad)", () => {
    const src = readFileSync("lib/salesbot/programas.ts", "utf8");
    assert.match(src, /publicado\s*!==\s*true/);
    assert.match(src, /activo\s*!==\s*true/);
  });

  test("2e. el guard de runtime impide devolver ok si el DTO trae columna interna", async () => {
    // La lista blanca es la regla, pero si alguien agrega una columna a la
    // proyeccion y olvida excluirla, el servicio tiene que detenerse en runtime:
    // no basta con que otro test diga que hoy el DTO sale limpio.
    const limpio = proyectarDetalle(detalleCrudo());

    // Dos formas de colarse: columna interna arriba y columna anidada.
    const sucios: Array<[string, Record<string, unknown>]> = [
      ["neto", { ...limpio, neto: 999_000 }],
      ["notas", { ...limpio, ciudades: [{ ...limpio.ciudades[0], notas: "PVP real 950.000" }] }],
    ];

    for (const [columna, dtoSucio] of sucios) {
      const r = await salesbotDetallePrograma(1, CTX, lectores({
        proyeccion: () => dtoSucio as never,
      }));

      assert.equal(r.ok, false, `devolvio ok con la columna interna "${columna}"`);
      if (r.ok) continue;

      assert.equal(r.error.codigo, "CONSULTA_FALLIDA");
      assert.equal(r.error.escalable, true, "una fuga de datos interna escala a un humano");

      // El mensaje de usuario no puede dar el nombre de la columna.
      assert.equal(r.error.mensaje, MENSAJE_ERROR.CONSULTA_FALLIDA.mensaje);
      assert.ok(!r.error.mensaje.includes(columna), `el mensaje filtro "${columna}"`);

      // Pero si queda en `traza`, que es solo para log local.
      assert.ok(
        (r.error.traza?.motivo ?? "").includes(columna),
        `la traza no dejo rastro de "${columna}"`,
      );
      assert.equal(r.error.traza?.consulta, "contieneColumnaInterna");
    }
  });

  test("2f. el guard corre despues del gate, no antes", async () => {
    // Un programa no publicado con proyeccion sucia debe seguir reportando
    // "no publicado": un fallo de proyeccion no salta el gate.
    const r = await salesbotDetallePrograma(1, CTX, lectores({
      detalle: async () => detalleCrudo({ programa: programaCrudo({ publicado: false }) }),
      proyeccion: () => ({ ...proyectarDetalle(detalleCrudo()), neto: 1 }) as never,
    }));
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.error.traza?.motivo, "no_publicado");
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Prueba 3: lista blanca
// ───────────────────────────────────────────────────────────────────────────

describe("proyectarDetalle - lista blanca (prueba 3)", () => {
  test("3. ninguna columna interna sobrevive a la proyección", () => {
    const crudo = detalleCrudo();
    // Primero se verifica que el crudo SÍ tiene lo interno: si no, la prueba
    // no probaría nada.
    assert.ok(crudo.programa.notas, "el crudo trae notas");
    assert.ok(crudo.programa.regla_comisionable_pct_comision != null, "el crudo trae la comisión");
    assert.ok("neto" in crudo.categorias[0].precios[0], "el crudo trae neto");

    const det = proyectarDetalle(crudo);

    const filtrada = contieneColumnaInterna(det);
    assert.equal(filtrada, null, `columna interna filtrada: ${filtrada}`);
    for (const col of COLUMNAS_INTERNAS_PROHIBIDAS) {
      assert.ok(!(col in (det as Row)), `no debe existir ${col}`);
    }

    const texto = JSON.stringify(det);
    assert.ok(!texto.includes("margen negociado"), "el contenido de `notas` no aparece");
    assert.ok(!texto.includes('"0.25"'), "pct_mk no aparece");
    assert.ok(!/"neto"/.test(texto), "ningún neto aparece");
    assert.ok(!/"tarifa_/.test(texto) && !/"impuesto_s/.test(texto), "ni tarifa_* ni impuesto_*");
  });

  test("3b. el guard detecta columnas internas anidadas y no dispara falsos positivos", () => {
    assert.equal(contieneColumnaInterna({ a: { b: { neto: 1 } } }), "neto");
    assert.equal(contieneColumnaInterna({ x: [{ tarifa_doble: 1 }] }), "tarifa_doble");
    assert.equal(contieneColumnaInterna({ ok: { pvp: 1, notas: "x" } }), "notas");
    // Campos que PARECEN internos pero son legítimos.
    assert.equal(contieneColumnaInterna({
      pvp: 1, estado_precio: "A_SOLICITUD", ciudad: "Leticia",
    } as never), null);
    assert.equal(contieneColumnaInterna({ impuesto_pagar: 1, tarifa_promocional: 2 }), null);
  });

  test("3c. el precio del DTO no lleva el neto del proveedor", () => {
    const det = proyectarDetalle(detalleCrudo());
    const precio = det.categorias[0].precios[0];
    assert.ok(!("neto" in (precio as Row)));
    assert.equal(precio.pvp, 1_060_000, "el pvp sí viaja");
    assert.equal(precio.estado_precio, "CONFIRMADO");
  });

  test("3d. el DTO tampoco expone los flags del gate ya verificados", () => {
    const det = proyectarDetalle(detalleCrudo());
    assert.ok(!("activo" in (det as Row)));
    assert.ok(!("publicado" in (det as Row)));
    assert.ok(!("proveedor_id" in (det as Row)));
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Pruebas 4 y 5: precios
// ───────────────────────────────────────────────────────────────────────────

describe("precios - null no es 0, bajo solicitud es estado (pruebas 4 y 5)", () => {
  test("4. pvp null NO se convierte en 0", () => {
    assert.equal(estadoPrecio(true, null), "A_SOLICITUD");
    assert.equal(estadoPrecio(false, null), "NO_CONFIRMADO");
    assert.equal(estadoPrecio(false, 1_060_000), "CONFIRMADO");

    const det = proyectarDetalle(detalleCrudo());
    const bajo = det.categorias[0].precios[1];
    assert.equal(bajo.pvp, null);
    assert.notEqual(bajo.pvp, 0, "no se inventó un 0");
    assert.ok(JSON.stringify(det).includes('"pvp":null'), "el null viaja explícito");
  });

  test("5. precio bajo solicitud se representa como texto sin número", () => {
    const det = proyectarDetalle(detalleCrudo());
    const texto = representarPrecio(det.categorias[0].precios[1]);
    assert.match(texto, /a solicitud/i);
    assert.ok(!/\d/.test(texto), `no debe imprimir un número: ${texto}`);
    assert.ok(textoEsSeguro(texto), `texto no seguro: ${JSON.stringify(detectarFrasesProhibidas(texto))}`);
  });

  test("5b. NO_CONFIRMADO no se disfraza de precio", () => {
    const texto = representarPrecio({
      pvp: null, estado_precio: "NO_CONFIRMADO", moneda: "USD",
      bajo_solicitud: false, acomodacion: "triple",
    });
    assert.match(texto, /asesor/);
    assert.ok(!/\d/.test(texto), `no debe inventar cifra: ${texto}`);
  });

  test("5c. la marca de salida se hereda a cada precio de esa salida", () => {
    const crudo = detalleCrudo();
    crudo.salidas[0].bajo_solicitud = true;
    const det = proyectarDetalle(crudo);
    for (const p of det.salidas[0].precios) {
      assert.equal(p.estado_precio, "A_SOLICITUD", `${p.acomodacion} debe quedar bajo solicitud`);
    }
  });

  test("5d. precio confirmado usa la moneda del programa, nunca una asumida", () => {
    const det = proyectarDetalle(detalleCrudo());
    assert.equal(det.moneda, "USD");
    const texto = representarPrecio(det.salidas[0].precios[0]);
    assert.match(texto, /Doble/);
    assert.ok(/1[.\s]?190[.\s]?000|US\$|\$/.test(texto), `debe mostrar la cifra en USD: ${texto}`);
    assert.ok(!/COP/.test(texto), "no debe asumir COP");
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Prueba 6: disponibilidad
// ───────────────────────────────────────────────────────────────────────────

describe("disponibilidad - abstención deliberada (prueba 6)", () => {
  test("6. devuelve DISPONIBILIDAD_NO_CONSULTABLE y escala a asesor", () => {
    const r = salesbotConsultarDisponibilidad(CTX);
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.error.codigo, "DISPONIBILIDAD_NO_CONSULTABLE");
      assert.equal(r.error.escalable, true);
      assert.ok(/asesor/i.test(r.error.mensaje));
      assert.ok(textoEsSeguro(r.error.mensaje));
    }
  });

  test("6b. no consulta ninguna tabla: no toca el cliente", () => {
    let toco = 0;
    const sb = new Proxy({}, { get(_t, p) { void p; toco++; throw new Error("no debe leer"); } });
    const r = salesbotConsultarDisponibilidad({ sb, tenant: "minorista" });
    assert.equal(toco, 0);
    assert.equal(r.ok, false);
    assert.equal(r.tenant, "minorista", "el tenant viaja para trazabilidad");
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Pruebas 7 y 8: vacío vs fallo técnico
// ───────────────────────────────────────────────────────────────────────────

describe("buscar - vacío y fallo técnico NO se confunden (pruebas 7 y 8)", () => {
  test("7. filtro que deja todo vacío -> SIN_RESULTADOS, escalable false", async () => {
    const r = await salesbotBuscarProgramas({ destino: "Tierra del Fuego" }, CTX, lectores());
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.error.codigo, "SIN_RESULTADOS");
      assert.equal(r.error.escalable, false);
    }
  });

  test("7b. catálogo genuinamente vacío -> SIN_RESULTADOS", async () => {
    const r = await salesbotBuscarProgramas({}, CTX, lectores({
      resumen: async () => ({ programas: [], error: null }),
    }));
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.error.codigo, "SIN_RESULTADOS");
  });

  test("8. fallo técnico -> CONSULTA_FALLIDA, escalable true", async () => {
    const r = await salesbotBuscarProgramas({}, CTX, lectores({
      resumen: async () => ({ programas: [], error: "connection reset" }),
    }));
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.error.codigo, "CONSULTA_FALLIDA");
      assert.equal(r.error.escalable, true);
      assert.ok(!/no encontré/i.test(r.error.mensaje), "un catálogo caído no es un catálogo vacío");
      assert.equal(r.error.traza?.error, "connection reset", "el error crudo queda en traza");
    }
  });

  test("8b. una excepción del lector también es CONSULTA_FALLIDA", async () => {
    const r = await salesbotBuscarProgramas({}, CTX, lectores({
      resumen: async () => { throw new Error("boom"); },
    }));
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.error.codigo, "CONSULTA_FALLIDA");
  });

  test("8c. detalle con excepción es CONSULTA_FALLIDA, no PROGRAMA_NO_PUBLICADO", async () => {
    const r = await salesbotDetallePrograma(1, CTX, lectores({
      detalle: async () => { throw new Error("boom"); },
    }));
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.error.codigo, "CONSULTA_FALLIDA");
  });

  test("8d. éxito: un programa, con la moneda del dato", async () => {
    const r = await salesbotBuscarProgramas({}, CTX, lectores());
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.datos.programas.length, 1);
      assert.equal(r.datos.programas[0].moneda, "USD");
      assert.equal(r.datos.programas[0].desde_pvp, 1_060_000);
      assert.equal(r.tenant, "mayorista");
    }
  });

  test("8e. la búsqueda siempre pide solo publicados; no hay forma de pedir privados", async () => {
    let visto: boolean | null = null;
    await salesbotBuscarProgramas({}, CTX, lectores({
      resumen: async (_sb, soloPublicados) => { visto = soloPublicados; return { programas: [], error: null }; },
    }));
    assert.equal(visto, true, "debe pedir soloPublicados = true siempre");
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Prueba 9: el resumen no afirma lo que no consultó
// ───────────────────────────────────────────────────────────────────────────

describe("buscar - lo que el resumen NO consultó (prueba 9)", () => {
  test("9. declara vigencia/condiciones/pax/disponibilidad como no consultados", async () => {
    const r = await salesbotBuscarProgramas({}, CTX, lectores());
    assert.equal(r.ok, true);
    if (r.ok) {
      for (const k of ["vigencia", "condiciones", "min_max_pax", "disponibilidad"]) {
        assert.ok((r.datos.no_consultado as string[]).includes(k), `debe declarar ${k}`);
      }
      const p = r.datos.programas[0] as Row;
      assert.ok(!("vigencia_desde" in p), "el resumen no trae vigencia");
      assert.ok(!("texto_condiciones" in p), "el resumen no trae condiciones");
      assert.ok(!("min_pax" in p), "el resumen no trae pax");
    }
  });

  test("9b. el resumen no trae ninguna columna interna", async () => {
    const r = await salesbotBuscarProgramas({}, CTX, lectores());
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(contieneColumnaInterna(r.datos.programas), null);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Prueba 10: sin service_role
// ───────────────────────────────────────────────────────────────────────────

describe("capa de lectura - sin service_role (prueba 10)", () => {
  test("10. ningún archivo de lib/salesbot toca el cliente privilegiado", () => {
    for (const f of ["types.ts", "programas.ts", "respuestas.ts"]) {
      const src = readFileSync(`lib/salesbot/${f}`, "utf8");
      assert.ok(!/SUPABASE_SERVICE_ROLE_KEY/.test(src), `${f}: sin service role key`);
      assert.ok(!/createAdminClient/.test(src), `${f}: no crea cliente admin`);
      assert.ok(!/supabase\/admin/.test(src), `${f}: no importa lib/supabase/admin`);
    }
  });

  test("10b. el módulo no construye su propio cliente", () => {
    const src = readFileSync("lib/salesbot/programas.ts", "utf8");
    assert.ok(!/createClient\s*\(/.test(src), "recibe el cliente por contexto");
    assert.match(src, /ctx\.sb/);
  });

  test("10c. no se promete aislamiento por tenant en Programas", () => {
    assert.equal(salesbot_aislamiento_real(), false,
      "programas no tiene columna tenant; el aislamiento real empieza en CRM Leads");
  });

  test("10d. la capa es de solo lectura: no contiene operaciones de escritura", () => {
    for (const f of ["types.ts", "programas.ts", "respuestas.ts"]) {
      const src = readFileSync(`lib/salesbot/${f}`, "utf8");
      assert.ok(!/\.(insert|update|upsert|delete)\s*\(/.test(src), `${f}: sin escrituras`);
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Reglas de respuesta
// ───────────────────────────────────────────────────────────────────────────

describe("reglas de respuesta", () => {
  test("precio desde: null no produce número", () => {
    assert.match(representarPrecioDesde(null, "USD"), /confirmar/i);
    assert.match(representarPrecioDesde(1_060_000, "USD"), /desde/i);
    assert.ok(!/0\b/.test(representarPrecioDesde(null, "USD")));
  });

  test("fechas de salida: sin fecha_hasta no se inventa rango", () => {
    assert.equal(representarFechasSalida({ fecha_desde: "2026-01-10", fecha_hasta: null, noches: 4 }),
      "desde el 2026-01-10");
    assert.equal(representarFechasSalida({ fecha_desde: "2026-01-10", fecha_hasta: "2026-01-20", noches: 4 }),
      "del 2026-01-10 al 2026-01-20");
    assert.equal(representarFechasSalida({ fecha_desde: null, fecha_hasta: null, noches: null }),
      "fechas por confirmar");
  });

  test("datos faltantes: pide destino, fecha, pax, edades y alojamiento", () => {
    const faltan = datosFaltantesParaCotizar({});
    assert.ok(faltan.includes("destino"));
    assert.ok(faltan.includes("fecha de salida"));
    assert.ok(faltan.includes("número de pasajeros"));
    assert.ok(faltan.includes("tipo de alojamiento"));
    // Sin saber cuantos pasajeros hay, preguntar "edad de cada pasajero" no
    // tiene sentido: primero el conteo.
    assert.ok(!faltan.includes("edad del pasajero"));
    assert.ok(!faltan.includes("edad de cada pasajero"));

    // Con el conteo conocido, si falta la edad, se pide por pasajero.
    const conPax = datosFaltantesParaCotizar({ destino: "Leticia", fecha: "2026-01-10", pax: 2 });
    assert.ok(conPax.includes("edad de cada pasajero"), "con pax conocido se piden las edades");
    assert.deepEqual(datosFaltantesParaCotizar({
      destino: "Leticia", fecha: "2026-01-10", pax: 2, edades: [30, 28], acomodacion: "doble",
    }), []);
  });

  test("las edades solo se piden con pax válido", () => {
    const base = { destino: "Leticia", fecha: "2026-01-10" };

    // pax ausente o inválido: pide conteo y NO ages, aunque `edades` venga vacío.
    for (const pax of [undefined, null, 0, -1, Number.NaN]) {
      const f = datosFaltantesParaCotizar({ ...base, pax });
      assert.ok(f.includes("número de pasajeros"), `debía pedir pax para ${String(pax)}`);
      assert.ok(!f.includes("edad del pasajero"), `no debía pedir edad para ${String(pax)}`);
      assert.ok(!f.includes("edad de cada pasajero"), `no debía pedir edad para ${String(pax)}`);
    }

    // pax = 2, sin edades: "de cada pasajero".
    const dos = datosFaltantesParaCotizar({ ...base, pax: 2 });
    assert.ok(dos.includes("edad de cada pasajero"));
    assert.ok(!dos.includes("número de pasajeros"), "con pax válido no se vuelve a preguntar");
    assert.ok(!dos.includes("edad del pasajero"), "con pax=2 no se pide una sola edad");

    // pax = 1, sin edades: "del pasajero" (en singular).
    const uno = datosFaltantesParaCotizar({ ...base, pax: 1 });
    assert.ok(uno.includes("edad del pasajero"));
    assert.ok(!uno.includes("edad de cada pasajero"), "con pax=1 no se pide cada edad");

    // pax = 2 con una sola edad: sigue faltando la otra.
    assert.ok(datosFaltantesParaCotizar({ ...base, pax: 2, edades: [30] })
      .includes("edad de cada pasajero"));

    // pax = 1 con su edad: no falta nada de edad.
    assert.ok(!datosFaltantesParaCotizar({ ...base, pax: 1, edades: [30] })
      .includes("edad del pasajero"));
  });

  test("FALTAN_DATOS_USUARIO no escala: se puede seguir preguntando", () => {
    const r = errorDesdeCodigo("FALTAN_DATOS_USUARIO", CTX);
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.error.codigo, "FALTAN_DATOS_USUARIO");
      assert.equal(r.error.escalable, false);
    }
  });

  test("todos los códigos tienen mensaje", () => {
    for (const k of Object.keys(MENSAJE_ERROR)) {
      const entrada = (MENSAJE_ERROR as Record<string, { mensaje: string }>)[k];
      assert.ok(entrada && entrada.mensaje.length > 0, `${k} sin mensaje`);
    }
  });
});

describe("guard de frases - afirmaciones comerciales sin respaldo", () => {
  test("detecta afirmaciones de cupos, disponibilidad y reserva", () => {
    for (const mala of [
      "Hay cupos disponibles para enero.",
      "Tenemos disponibilidad esa semana.",
      "Quedan 3 lugares en el circuito.",
      "Está disponible en alojamiento doble.",
      "Precio confirmado para tu viaje.",
      "Te garantizo el precio.",
      "Lo reservo para ti.",
      "Hay disponibilidad para ese tour.",
    ]) {
      assert.ok(detectarFrasesProhibidas(mala).length > 0, `debía detectar: ${mala}`);
    }
  });

  test("permite PREGUNTAR por cupos y permite la negación", () => {
    for (const buena of [
      "¿Tienes cupos para enero?",
      "¿Cuál es la disponibilidad?",
      "No hay disponibilidad en tiempo real, un asesor te confirma.",
      "No tengo disponibilidad en tiempo real.",
      "Sin disponibilidad confirmada todavía.",
      "El precio está a solicitud.",
      "El precio hay que confirmarlo con un asesor.",
      "Ningún programa incluye propelina.",
    ]) {
      assert.deepEqual(detectarFrasesProhibidas(buena), [], `no debía detectar: ${buena}`);
    }
  });
});