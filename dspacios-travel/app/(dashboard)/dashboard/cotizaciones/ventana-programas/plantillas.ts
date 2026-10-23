// ===========================================================================
// Ventana de Programas - motor de plantillas (Fase B, SIN IA).
//
// Modulo PURO. Sin "use server" (eso vive en `consultas.ts`), sin "use client",
// sin Next, sin Supabase, sin red. Recibe datos ya consultados y devuelve
// texto. Eso lo hace testeable sin base de datos y es la razon de que el
// SERVIDOR sea quien redacta: si el texto se compusiera en el navegador, el
// guard se podria saltar con una extension.
//
// La regla que gobierna todo el archivo: aqui no se AFIRMA nada que no venga
// consultationado. Si un dato no existe, el texto lo dice; no lo rellena.
//
// Vocabulario prohibido por decision propia (ademas del guard de Fase A):
//   - "disponibles"     -> se dice "opciones encontradas" o "programas publicados"
//   - "precio confirmado" -> se dice "valor de referencia"
//   - "hay cupos" / "quedan N" -> no hay fuente; el texto se abstiene
// ===========================================================================

import {
  datosFaltantesParaCotizar,
  detectarFrasesProhibidas,
  formatearMoneda,
  representarFechasSalida,
  salesbotConsultarDisponibilidad,
  textoEsSeguro,
  type DatosViajero,
} from "@/lib/salesbot/respuestas";
import type { SalesbotPrecioResultado } from "@/lib/salesbot/types";

import type {
  BorradorVentana,
  ConsultaVentanaInput,
  FuenteBorrador,
} from "./tiposVista.ts";
import { exigeDatosDeViaje } from "./tiposVista.ts";

// ─── Helpers de precio ─────────────────────────────────────────────────────

/**
 * Un PVP es un precio SOLO si es un numero positivo real.
 *
 * `pvp === 0` NO es un precio: es el centinela que usa `pvpPrograma` cuando no
 * pudo calcular. Si se dejara pasar, el texto diria "$0" y el cliente lo
 * entenderia como "es gratis". Por eso el filtro es `> 0`, no `!= null`.
 */
function precioMostrable(pvp: number | null): pvp is number {
  return typeof pvp === "number" && Number.isFinite(pvp) && pvp > 0;
}

/** El rotulo de un precio. NUNCA produce un numero cuando no hay precio. */
function rotuloPrecio(p: SalesbotPrecioResultado): string {
  const etiqueta = p.acomodacion ? ` ${p.acomodacion}` : "";

  if (p.estado_precio === "A_SOLICITUD") return `a solicitud${etiqueta}`;
  if (p.estado_precio === "NO_CONFIRMADO") return `precio a confirmar${etiqueta}`;
  if (precioMostrable(p.pvp)) return `${formatearMoneda(p.pvp, p.moneda)}${etiqueta}`;
  // pvp no numerico o <= 0 con estado CONFIRMADO: no se inventa nada.
  return `precio a confirmar${etiqueta}`;
}

function listaPrecios(tabla: SalesbotPrecioResultado[], limite = 6): string[] {
  return tabla.slice(0, limite).map((p) => `   - ${rotuloPrecio(p)}`);
}

// ─── Datos del viaje ───────────────────────────────────────────────────────

function aDatosViajero(input: ConsultaVentanaInput): DatosViajero {
  return {
    destino: input.destino ?? input.texto ?? null,
    fecha: input.fechaSalida ?? null,
    pax: input.pax ?? null,
    edades: input.edades ?? null,
    acomodacion: input.acomodacion ?? null,
  };
}

/**
 * Cierre por defecto de todo texto generado. Un PVP es una REFERENCIA, no una
 * cotizacion; y la confirmacion comercial siempre es de una persona.
 *
 * "Te lo confirmo" es una promesa del ASESOR, no del bot, y por eso puede
 * decirla: quien lo escribe es la persona que lo va a cumplir.
 */
const CIERRE_ASESOR =
  "Estos valores son de referencia. Te los confirmo con el asesor responsable antes de reservar.";

function conCierre(texto: string): string {
  return `${texto}\n\n${CIERRE_ASESOR}`;
}

// ─── Plantillas por tipo ───────────────────────────────────────────────────

function redactarProgramas(
  fuente: FuenteBorrador & { clase: "busqueda" },
  datos: DatosViajero,
): { texto: string; avisos: string[]; requiereEscalamiento: boolean } {
  const encontrados = fuente.datos.programas;
  const plural = encontrados.length === 1 ? "" : "s";
  // `aDatosViajero` ya metió `texto` dentro de `destino` cuando no hay combo.
  const donde = datos.destino?.trim();

  // "opciones encontradas" / "programas publicados", nunca "disponibles".
  const encabezado = donde
    ? `Encontre ${encontrados.length} programa${plural} publicado${plural} para ${donde}:`
    : `Encontre ${encontrados.length} programa${plural} publicado${plural}:`;

  const lineas = encontrados.slice(0, 6).map((p) => {
    const dur = p.noches ? `${p.noches} noche${p.noches === 1 ? "" : "s"}` : null;
    const ciudades = (p.ciudades ?? []).slice(0, 3).join(", ");
    return `   - ${p.nombre}${dur ? ` / ${dur}` : ""}${ciudades ? ` / ${ciudades}` : ""}`;
  });

  // El "desde" solo si el catalogo lo trae. Si `desde_pvp` es null (o 0), no se
  // escribe ninguna cifra: no existe precio minimo publicable.
  const conPrecio = encontrados.filter((p) => precioMostrable(p.desde_pvp));
  const primero = conPrecio[0];
  const bloquePrecio = primero && precioMostrable(primero.desde_pvp)
    ? `Valores desde ${formatearMoneda(primero.desde_pvp, primero.moneda)}.`
    : "";

  const cuerpo = [encabezado, ...lineas, bloquePrecio].filter(Boolean).join("\n");

  const avisos = [
    ...fuente.datos.no_consultado.map((n) => `No consulte: ${n}.`),
    ...(encontrados.length > 6 ? [`Mostrando 6 de ${encontrados.length}.`] : []),
    ...(conPrecio.length ? [] : ["El catalogo no trae precio minimo publicable."]),
  ];

  return { texto: conCierre(cuerpo), avisos, requiereEscalamiento: false };
}

function redactarPrecio(
  fuente: FuenteBorrador & { clase: "detalle" },
  datos: DatosViajero,
): { texto: string; avisos: string[]; requiereEscalamiento: boolean } {
  const d = fuente.datos;
  const avisos: string[] = [];
  const lineas: string[] = [`Programa: ${d.nombre}.`];

  // El precio vive en dos sitios y ninguno se recalcula: la categoria (por
  // acomodacion) y la salida (por fecha).
  //
  // El filtro por acomodacion se aplica a LAS DOS tablas, no solo a las
  // categorias. Pedir "cuadruple" y que la tabla de salidas responda con el
  // precio de "doble" es la forma mas facil de mandar un precio que no aplica.
  const pedido = (datos.acomodacion ?? "").trim();
  const filtrar = (tabla: SalesbotPrecioResultado[]) =>
    pedido ? tabla.filter((p) => p.acomodacion === pedido) : tabla;

  const todasCategorias = d.categorias.flatMap((c) => c.precios);
  const preciosCategoria = filtrar(todasCategorias);

  if (preciosCategoria.length) {
    lineas.push(`Valores de referencia${pedido ? ` para ${pedido}` : ""}:`);
    lineas.push(...listaPrecios(preciosCategoria));
  } else if (todasCategorias.length) {
    avisos.push(`Ningun precio de categoria corresponde a la acomodacion pedida (${pedido}).`);
  } else {
    avisos.push("Este programa no tiene precios de categoria cargados.");
  }

  let salidasConPrecio = 0;
  const bloqueSalidas: string[] = [];
  for (const s of d.salidas.slice(0, 5)) {
    const ps = filtrar(s.precios);
    if (!ps.length) continue;
    salidasConPrecio += 1;
    const cuando = representarFechasSalida(s);
    const conNumero = ps.filter((p) => precioMostrable(p.pvp)).slice(0, 3);
    const txt = conNumero.length ? conNumero.map((p) => rotuloPrecio(p)).join(", ") : "precio a confirmar";
    bloqueSalidas.push(`   - ${s.etiqueta ?? "Salida"} (${cuando}): ${txt}`);
  }

  if (bloqueSalidas.length) {
    lineas.push("Valores por salida:");
    lineas.push(...bloqueSalidas);
  } else if (d.salidas.length) {
    avisos.push(`Ninguna salida tiene precio para la acomodacion pedida (${pedido || "sin filtrar"}).`);
  } else {
    avisos.push("Este programa no tiene salidas cargadas.");
  }

  // "a solicitud" NO es un error: es el estado honesto de un precio que hay que
  // confirmar, y por eso escala a una persona.
  const todos = [...preciosCategoria, ...d.salidas.flatMap((s) => filtrar(s.precios))];
  const haySolicitud = todos.some((p) => p.estado_precio === "A_SOLICITUD");
  const haySinPrecio = todos.length === 0;

  if (haySinPrecio) avisos.push("No hay ningun precio para lo pedido: el texto no afirma ninguna cifra.");
  if (haySolicitud) avisos.push("Parte de los valores estan a solicitud.");
  if (preciosCategoria.length && salidasConPrecio === 0) {
    avisos.push("Sin precios por salida: no se puede afirmar un valor para una fecha concreta.");
  }

  return {
    texto: conCierre(lineas.join("\n")),
    avisos,
    requiereEscalamiento: haySolicitud || haySinPrecio,
  };
}

function redactarCondiciones(
  fuente: FuenteBorrador & { clase: "detalle" },
): { texto: string; avisos: string[]; requiereEscalamiento: boolean } {
  const d = fuente.datos;
  const partes: string[] = [`Programa: ${d.nombre}.`];
  const avisos: string[] = [];

  // Solo texto que existe. Un `null` no se rellena con una condicion inventada:
  // se avisa al asesor de que el catalogo no la tiene.
  const bloque = (titulo: string, valor: string | null) => {
    if (!valor?.trim()) {
      avisos.push(`El catalogo no tiene "${titulo.toLowerCase()}" para este programa.`);
      return;
    }
    partes.push(`${titulo}:\n${valor.trim()}`);
  };

  bloque("Condiciones", d.texto_condiciones);
  bloque("Cancelacion", d.texto_cancelacion);
  bloque("Pagos", d.texto_pagos);

  if (d.min_pax != null || d.max_pax != null) {
    partes.push(`Pasajeros: de ${d.min_pax ?? "?"} a ${d.max_pax ?? "?"}.`);
  }
  if (d.edad_nino_min != null || d.edad_nino_max != null) {
    partes.push(`Edad de nino: de ${d.edad_nino_min ?? "?"} a ${d.edad_nino_max ?? "?"} anos.`);
  }
  if (d.edad_infante_max != null) {
    partes.push(`Edad de infante: hasta ${d.edad_infante_max} anos.`);
  }

  if (d.vigencia_desde || d.vigencia_hasta) {
    partes.push(`Vigencia: del ${d.vigencia_desde ?? "?"} al ${d.vigencia_hasta ?? "?"}.`);
    // La vigencia es el dato que mas se desactualiza.
    avisos.push("La vigencia hay que confirmarla al reservar.");
  } else {
    avisos.push("No consulte la vigencia de este programa.");
  }

  return { texto: conCierre(partes.join("\n\n")), avisos, requiereEscalamiento: false };
}

function redactarFechas(
  fuente: FuenteBorrador & { clase: "detalle" },
): { texto: string; avisos: string[]; requiereEscalamiento: boolean } {
  const d = fuente.datos;

  if (!d.salidas.length) {
    return {
      texto: conCierre(`El programa ${d.nombre} no tiene fechas de salida cargadas en el catalogo.`),
      avisos: ["Sin salidas: no se puede afirmar ninguna fecha."],
      requiereEscalamiento: false,
    };
  }

  const lineas = [`Fechas de salida del programa ${d.nombre}:`];
  for (const s of d.salidas.slice(0, 8)) {
    lineas.push(`   - ${s.etiqueta ?? "Salida"} (${representarFechasSalida(s)})`);
  }

  // Aviso explicito: las fechas son fechas, no cupos. Es la confusion que este
  // tipo de consulta mas va a generar, asi que se dice en el texto.
  return {
    texto: conCierre(lineas.join("\n")),
    avisos: ["Estas son las salidas registradas en el catalogo; no son disponibilidad confirmada."],
    requiereEscalamiento: false,
  };
}

/** Sin fuente de cupos, la unica redaccion posible es la abstension. */
function redactarDisponibilidad(): { texto: string; avisos: string[]; requiereEscalamiento: boolean } {
  const e = salesbotConsultarDisponibilidad({ sb: null, tenant: null });
  return {
    texto: `${e.error.mensaje}\n\n${CIERRE_ASESOR}`,
    avisos: ["No existe fuente de cupos en el catalogo. Respuesta obligatoria por abstension."],
    requiereEscalamiento: true,
  };
}

function redactarOtro(): { texto: string; avisos: string[]; requiereEscalamiento: boolean } {
  return {
    texto:
      "No consulte ese dato, asi que no te lo puedo confirmar con certeza. " +
      `Te lo revisa y te lo confirma el asesor.\n\n${CIERRE_ASESOR}`,
    avisos: ["Consulta 'otro': derivacion sin dato consultado."],
    requiereEscalamiento: true,
  };
}

// ─── Motor ─────────────────────────────────────────────────────────────────

function redactar(
  input: ConsultaVentanaInput,
  fuente: FuenteBorrador | undefined,
): { texto: string; avisos: string[]; requiereEscalamiento: boolean } {
  const datos = aDatosViajero(input);

  // La disponibilidad no consulta nada: entra antes que todo y no depende de
  // que haya programa, fecha ni pax.
  if (input.tipoConsulta === "disponibilidad") return redactarDisponibilidad();
  if (input.tipoConsulta === "otro") return redactarOtro();

  if (!fuente || fuente.clase === "error") {
    const err = fuente && fuente.clase === "error" ? fuente : null;
    return {
      texto: `${err?.mensaje ?? "No pude consultar la informacion en este momento."}\n\n${CIERRE_ASESOR}`,
      avisos: [err ? `Error de consulta: ${err.codigo}.` : "Consulta sin datos."],
      requiereEscalamiento: err?.escalable ?? true,
    };
  }

  // Las consultas de precio y fechas NO se redactan con datos incompletos: se
  // pide lo que falta. Es el "explica que dato falta" del criterio de aceptacion.
  if (exigeDatosDeViaje(input.tipoConsulta)) {
    const faltan = datosFaltantesParaCotizar(datos);
    if (faltan.length) {
      return {
        texto:
          `Para darte ${input.tipoConsulta === "precio" ? "un valor de precio" : "las fechas de salida"} ` +
          `necesito: ${faltan.join(", ")}.`,
        avisos: [`Faltan datos: ${faltan.join(", ")}.`],
        requiereEscalamiento: false,
      };
    }
  }

  if (input.tipoConsulta === "programas") {
    return fuente.clase === "busqueda"
      ? redactarProgramas(fuente, datos)
      : redactarOtro();
  }

  // precio | condiciones | fechas: todas necesitan el detalle.
  if (fuente.clase !== "detalle") return redactarOtro();

  if (input.tipoConsulta === "precio") return redactarPrecio(fuente, datos);
  if (input.tipoConsulta === "condiciones") return redactarCondiciones(fuente);
  return redactarFechas(fuente);
}

/**
 * Redacta y pasa el guard. Si el texto no es seguro NO se devuelve el texto:
 * se devuelve cadena vacia. Es la forma de que el navegador no tenga nada que
 * mostrar aunque alguien modifique el DOM o el estado en React DevTools.
 *
 * Que se bloquee es un bug de plantilla o un dato del catalogo con una frase
 * comercial; por eso `frasesBloqueadas` viaja al asesor: sin ella solo se
 * veria un error sin causa.
 */
export function generarBorrador(
  input: ConsultaVentanaInput,
  fuente?: FuenteBorrador,
): BorradorVentana {
  const r = redactar(input, fuente);

  if (textoEsSeguro(r.texto)) {
    return {
      texto: r.texto,
      seguro: true,
      frasesBloqueadas: [],
      avisos: r.avisos,
      requiereEscalamiento: r.requiereEscalamiento,
    };
  }

  return {
    texto: "",
    seguro: false,
    frasesBloqueadas: detectarFrasesProhibidas(r.texto),
    avisos: [
      ...r.avisos,
      "El texto generado fue bloqueado por el guard de frases. No se muestra ni se puede copiar.",
    ],
    requiereEscalamiento: true,
  };
}