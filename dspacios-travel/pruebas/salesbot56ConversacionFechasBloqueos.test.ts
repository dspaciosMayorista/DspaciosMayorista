import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { avanzar, type ServiciosConversacion } from "../lib/salesbot/conversacion/flujo.ts";
import { estadoInicial, type EstadoConversacion, type RespuestaConversacion } from "../lib/salesbot/conversacion/contrato.ts";
import { crearSello } from "../lib/salesbot/contrato.ts";
import { buscarEnOfertas, validarCriteriosBloqueos } from "../lib/salesbot/paquetes/bloqueo.ts";
import type { OfertaBloqueo } from "../lib/salesbot/paquetes/contrato.ts";

// #56 — Preview de WhatsApp: (1) Bloqueos no lista con solo el destino: pregunta cuándo viaja y cuántas
// personas, usa el filtro de fechas de buscarBloqueos y deja avanzar por las demás opciones; (2) Porción
// terrestre no entra en ciclo al confirmar fechas sin año. La búsqueda de Bloqueos usa el MISMO motor
// (validarCriteriosBloqueos + buscarEnOfertas) que el panel y el canal de WhatsApp.

const HOY = "2026-10-20";
const HOTELES = ["Hotel Arena", "Hotel Brisa", "Hotel Corales", "Hotel Duna", "Hotel Estrella", "Hotel Faro"];
const FECHAS = ["2026-11-14", "2026-12-05", "2026-12-19", "2027-01-09", "2027-03-10"];

// 6 hoteles × 5 salidas = 30 combinaciones; el hotel Faro solo tiene 1 silla libre.
const OFERTAS: OfertaBloqueo[] = FECHAS.flatMap((f, i) =>
  HOTELES.map((h, j) => ({
    clave: `5-b${i}-${j}`,
    paquete_id: 5,
    paquete_nombre: "Cartagena",
    origen_vuelo: "bloqueo" as const,
    bloqueo_id: i,
    empaquetado_id: null,
    fecha_ida: f,
    fecha_regreso: `${f.slice(0, 8)}${String(Number(f.slice(8)) + 3).padStart(2, "0")}`,
    noches: 3,
    destino: "CARTAGENA",
    hotel_id: j,
    hotel_nombre: h,
    moneda: "COP",
    combos: [{ categoria: "Estándar", regimen: "PAE", pvp_por_persona: { doble: 900_000 + j * 10_000 } }],
    desde_pvp_por_persona: 900_000 + j * 10_000,
    sillas_libres: j === 5 ? 1 : 4,
    disponibilidad_vuelo: "sillas_libres" as const,
  })) as unknown as OfertaBloqueo[]
);

let ofertasActivas: OfertaBloqueo[] = OFERTAS;

type Llamada = { op: string; arg: unknown };
const llamadas: Llamada[] = [];
const ok = <T>(datos: T, fuente = "buscarBloqueos") => ({ ok: true as const, datos, sello: crearSello(fuente as never) });

function sv(): ServiciosConversacion {
  const reg = (op: string, arg: unknown) => llamadas.push({ op, arg });
  const no = (op: string) => async () => {
    throw new Error(`no debía llamarse: ${op}`);
  };
  return {
    buscarProgramas: no("buscarProgramas") as never,
    detallePrograma: no("detallePrograma") as never,
    buscarBloqueos: async (e) => {
      reg("buscarBloqueos", e);
      const v = validarCriteriosBloqueos(e);
      if (!v.ok) return { ok: false as const, codigo: "parametros_invalidos" as const, motivo: "Revisa los campos marcados.", sello: crearSello("buscarBloqueos") };
      const res = buscarEnOfertas(ofertasActivas, v.criterios);
      if (!res.total_encontradas) return { ok: false as const, codigo: "sin_resultados" as const, motivo: "No hay bloqueos publicados que cumplan esos criterios.", sello: crearSello("buscarBloqueos") };
      return ok(res);
    },
    ofertaBloqueo: async (c) => (reg("ofertaBloqueo", c), ofertasActivas.find((o) => o.clave === c) ?? null),
    cotizarBloqueo: (async (e: Record<string, string | undefined>) => {
      reg("cotizarBloqueo", e);
      const o = ofertasActivas.find((x) => x.clave === e.oferta)!;
      // Misma regla del motor real: la composición sale de habitaciones y edades; los menores de 2 años no ocupan silla.
      const PAX = { sencilla: 1, doble: 2, triple: 3 } as const;
      const lineas = Object.entries(PAX).flatMap(([a, p]) => (Number(e[`hab_${a}`]) ? [{ acomodacion: a, habitaciones: Number(e[`hab_${a}`]), pax: Number(e[`hab_${a}`]) * p, pvp_por_persona: 900_000 }] : []));
      const edades = (e.edadesMenores ?? "").split(",").map((x) => x.trim()).filter(Boolean).map(Number);
      const infantes = edades.filter((x) => x < 2).length;
      const ninos = edades.length - infantes;
      const adultos = lineas.reduce((n, l) => n + l.pax, 0);
      const conSilla = adultos + ninos;
      return ok({
        paquete_nombre: "Cartagena", hotel_nombre: o.hotel_nombre, categoria: "Estándar", regimen: "PAE", moneda: "COP",
        fecha_ida: o.fecha_ida, fecha_regreso: o.fecha_regreso, lineas,
        menores: { nino: ninos, nino2: 0, infante: infantes }, pvp_menores_por_persona: { nino: 500_000, nino2: null, infante: null },
        total_pax: conSilla + infantes, total_orientativo: 1_000_000, condiciones_tarifa: [], nota_nino: null,
        sillas_libres: o.sillas_libres, alcanzan_sillas: (o.sillas_libres ?? 0) >= conSilla, disponibilidad_vuelo: "sillas_libres",
      });
    }) as never,
    destinosPorcion: async () => ["CARTAGENA", "SAN ANDRÉS"],
    buscarPorcion: async (e) => {
      reg("buscarPorcion", e);
      return ok({ resultados: [], total_encontrados: 0, truncado: false, sugerencias_fecha: [] }, "buscarPorcion");
    },
    cotizarPorcion: no("cotizarPorcion") as never,
    listarAgencias: no("listarAgencias") as never,
    porcentajeAgencia: no("porcentajeAgencia") as never,
  };
}

beforeEach(() => {
  llamadas.length = 0;
  ofertasActivas = OFERTAS;
});

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
const etiquetas = (r: RespuestaConversacion) => r.mensajes.flatMap((m) => (m.opciones ?? []).map((o) => o.etiqueta));
const busquedas = () => llamadas.filter((l) => l.op === "buscarBloqueos").map((l) => l.arg as Record<string, string | undefined>);
const claves = (r: RespuestaConversacion) => valores(r).filter((v) => v.startsWith("sel:blo:"));

describe("Bloqueos: no lista con solo el destino", () => {
  test("tras el destino pregunta cuándo viaja; sin buscar", async () => {
    const { ultima } = await charla([{ op: "producto:bloqueo" }, "Cartagena"]);
    assert.equal(ultima.estado.pendiente, "fechas");
    assert.match(textos(ultima), /Cuándo quieres viajar/);
    assert.ok(valores(ultima).includes("fechas:*"), "ofrece «Cualquier fecha»");
    assert.equal(busquedas().length, 0);
  });

  test("después de la fecha pregunta cuántas personas; sin buscar", async () => {
    const { ultima } = await charla([{ op: "producto:bloqueo" }, "Cartagena", "diciembre de 2026"]);
    assert.equal(ultima.estado.pendiente, "adultos");
    assert.match(textos(ultima), /adultos viajan/);
    assert.equal(busquedas().length, 0);
  });

  test("un mes se traduce a fechaDesde/fechaHasta de buscarBloqueos y filtra las salidas", async () => {
    const { ultima } = await charla([{ op: "producto:bloqueo" }, "Cartagena", "diciembre de 2026", "2"]);
    const b = busquedas();
    assert.equal(b.length, 1);
    assert.equal(b[0].fechaDesde, "2026-12-01");
    assert.equal(b[0].fechaHasta, "2026-12-31");
    assert.equal(b[0].sillasMin, "2");
    // 2 salidas de diciembre × 6 hoteles = 12; Faro (1 silla) no alcanza para 2 personas → 10.
    assert.match(textos(ultima), /Encontré 10 opciones de hotel y salida/);
    const lineas = ultima.mensajes[0].lineas!.join(" ");
    assert.doesNotMatch(lineas, /Hotel Faro/);
    assert.doesNotMatch(lineas, /noviembre|enero|marzo/i);
  });

  test("un rango aproximado también usa la ventana de fechas", async () => {
    await charla([{ op: "producto:bloqueo" }, "Cartagena", "del 1 al 31 de enero de 2027", "2"]);
    assert.equal(busquedas()[0].fechaDesde, "2027-01-01");
    assert.equal(busquedas()[0].fechaHasta, "2027-01-31");
  });

  test("un mes sin año pide confirmar el año; no adivina", async () => {
    const { ultima } = await charla([{ op: "producto:bloqueo" }, "Cartagena", "marzo"]);
    assert.deepEqual(valores(ultima).filter((v) => v.startsWith("fechas:")), ["fechas:2027-03-01,2027-03-31"]);
    const dic = await charla([{ op: "producto:bloqueo" }, "Cartagena", "diciembre"]);
    assert.deepEqual(valores(dic.ultima).filter((v) => v.startsWith("fechas:")), ["fechas:2026-12-01,2026-12-31", "fechas:2027-12-01,2027-12-31"]);
  });

  test("un mes que ya pasó se rechaza", async () => {
    const { ultima } = await charla([{ op: "producto:bloqueo" }, "Cartagena", "septiembre de 2026"]);
    assert.match(textos(ultima), /ya pasó/);
    assert.equal(ultima.estado.pendiente, "fechas");
  });

  test("«cualquier fecha» no filtra por fecha", async () => {
    await charla([{ op: "producto:bloqueo" }, "Cartagena", { op: "fechas:*" }, "2"]);
    const b = busquedas()[0];
    assert.equal(b.fechaDesde, undefined);
    assert.equal(b.fechaHasta, undefined);
  });

  test("«cualquier fecha» escrita a mano equivale a la opción", async () => {
    const { respuestas } = await charla([{ op: "producto:bloqueo" }, "Cartagena", "cualquier fecha"]);
    assert.equal(respuestas[2].estado.cualquierFecha, true);
    assert.equal(respuestas[2].estado.pendiente, "adultos");
  });
});

describe("Bloqueos: el total son «opciones de hotel y salida» y se puede seguir avanzando", () => {
  test("cualquier fecha: 30 opciones, 6 por página, sin quedar atrapado en las primeras", async () => {
    const { respuestas } = await charla([{ op: "producto:bloqueo" }, "Cartagena", { op: "fechas:*" }, "1"]);
    const p1 = respuestas[3];
    assert.match(textos(p1), /Encontré 30 opciones de hotel y salida en cualquier fecha/);
    assert.doesNotMatch(textos(p1), /salida\(s\)/);
    assert.match(textos(p1), /de la 1 a la 6/);
    assert.equal(claves(p1).length, 6);
    assert.ok(valores(p1).includes("pagina:6"), "ofrece ver más opciones");
    assert.ok(!valores(p1).some((v) => v === "pagina:0"), "en la primera página no hay «anteriores»");
    assert.match(textos(p1), /desde .* por persona/);
    assert.match(textos(p1), /referencia/);
  });

  test("las páginas siguientes no repiten opciones y cubren todo el catálogo", async () => {
    const { respuestas } = await charla([{ op: "producto:bloqueo" }, "Cartagena", { op: "fechas:*" }, "1", { op: "pagina:6" }, { op: "pagina:12" }, { op: "pagina:18" }, { op: "pagina:24" }]);
    const vistas = respuestas.slice(3).flatMap(claves);
    assert.equal(vistas.length, 30);
    assert.equal(new Set(vistas).size, 30, "ninguna repetida");
    const ultima = respuestas[7];
    assert.match(textos(ultima), /de la 25 a la 30/);
    assert.ok(!valores(ultima).includes("pagina:30"), "en la última no hay «más»");
    assert.ok(valores(ultima).includes("pagina:18"), "se puede volver");
    assert.deepEqual(busquedas().map((b) => b.omitir), ["0", "6", "12", "18", "24"]);
  });

  test("las opciones de navegación caben en una lista de WhatsApp antes de las de corrección", async () => {
    const { ultima } = await charla([{ op: "producto:bloqueo" }, "Cartagena", { op: "fechas:*" }, "1"]);
    const v = valores(ultima);
    assert.ok(v.indexOf("pagina:6") < 10 && v.indexOf("pagina:6") > v.findIndex((x) => x.startsWith("sel:blo:")));
    assert.ok(v.indexOf("pagina:6") < v.indexOf("corregir:destino"));
  });

  test("elegir de una página posterior revalida y sigue al combo", async () => {
    const { respuestas } = await charla([{ op: "producto:bloqueo" }, "Cartagena", { op: "fechas:*" }, "1", { op: "pagina:6" }]);
    const clave = claves(respuestas[4])[0];
    const r = await avanzar(respuestas[4].estado, { tipo: "opcion", valor: clave }, sv(), HOY);
    assert.equal(r.estado.pendiente, "combo");
    assert.equal(r.estado.seleccion, clave.slice("sel:".length));
  });

  test("cambiar las fechas vuelve a la primera página", async () => {
    const { respuestas } = await charla([{ op: "producto:bloqueo" }, "Cartagena", { op: "fechas:*" }, "1", { op: "pagina:12" }, "cambiar fechas", "enero de 2027"]);
    assert.equal(respuestas[6].estado.omitir, 0);
    assert.equal(busquedas().at(-1)?.omitir, "0");
  });

  test("un desplazamiento manipulado fuera de rango se rechaza y uno vencido vuelve a la primera página", async () => {
    const r = await avanzar({ ...estadoInicial(), producto: "bloqueo", destino: "cartagena", cualquierFecha: true, adultos: 1, pendiente: "seleccion" }, { tipo: "opcion", valor: "pagina:9999999" }, sv(), HOY);
    assert.equal(r.ok, false);
    const vencido = await avanzar({ ...estadoInicial(), producto: "bloqueo", destino: "cartagena", cualquierFecha: true, adultos: 1, pendiente: "seleccion" }, { tipo: "opcion", valor: "pagina:600" }, sv(), HOY);
    assert.equal(vencido.estado.omitir, 0);
    assert.equal(claves(vencido).length, 6);
  });

  test("más personas que sillas: se excluyen las salidas que no alcanzan", async () => {
    const { ultima } = await charla([{ op: "producto:bloqueo" }, "Cartagena", { op: "fechas:*" }, "5"]);
    assert.match(textos(ultima), /No hay bloqueos publicados/);
  });
});

describe("Bloqueos: se piden adultos y las sillas se juzgan con la composición real", () => {
  // Una sola salida con EXACTAMENTE 3 sillas libres: 2 adultos + 1 niño de 5 años; el infante no ocupa silla.
  const una = () => {
    ofertasActivas = [{ ...OFERTAS[0], clave: "5-solo", sillas_libres: 3 } as OfertaBloqueo];
  };
  const hastaCombo = ["Cartagena", { op: "fechas:*" }, "2"] as const;
  const cotizar = (menores: string, hab = "habitaciones:doble=1") => charla([{ op: "producto:bloqueo" }, ...hastaCombo, { op: "sel:blo:5-solo" }, { op: "combo:Estándar|PAE" }, { op: hab }, menores]);

  test("la pregunta es por adultos (no «personas en total») y el estado guarda adultos", async () => {
    una();
    const { respuestas } = await charla([{ op: "producto:bloqueo" }, "Cartagena", { op: "fechas:*" }]);
    const q = textos(respuestas[2]);
    assert.match(q, /Cuántos adultos viajan/);
    assert.doesNotMatch(q, /personas viajan|en total/);
  });
  test("adultos + niño + infante: la salida con exactamente las sillas necesarias aparece y alcanza", async () => {
    una();
    const { respuestas } = await cotizar("5 y 1");
    const lista = respuestas[3];
    assert.equal(busquedas()[0].sillasMin, "2", "filtra solo por adultos, nunca por el total con infantes");
    assert.deepEqual(claves(lista), ["sel:blo:5-solo"], "la salida con 3 sillas no se oculta");
    assert.doesNotMatch(textos(lista), /para \d+ persona/);
    const fin = textos(respuestas[7]);
    assert.doesNotMatch(fin, /No alcanzan/);
    assert.match(fin, /1 infante/);
    assert.equal(respuestas[7].estado.adultos, 2);
  });
  test("si la composición necesita una silla más que las libres, avisa al cotizar", async () => {
    una();
    const { respuestas } = await cotizar("5 y 7");
    assert.match(textos(respuestas[7]), /No alcanzan/);
    assert.equal(respuestas[7].mensajes.at(-1)!.aviso, true);
  });
  test("3 adultos → 1 doble: no hay precio ni «Cotización ORIENTATIVA», se pide corregir y se conserva lo elegido; al corregir cotiza", async () => {
    una();
    const { respuestas } = await charla([{ op: "producto:bloqueo" }, "Cartagena", { op: "fechas:*" }, "3", { op: "sel:blo:5-solo" }, { op: "combo:Estándar|PAE" }, { op: "habitaciones:doble=1" }, { op: "menores:no" }, { op: "habitaciones:triple=1" }]);
    const bloqueada = respuestas[7];
    const t = textos(bloqueada);
    assert.match(t, /Indicaste 3 adulto\(s\), pero las habitaciones elegidas tienen 2 plaza\(s\) tarifaria\(s\)/);
    assert.doesNotMatch(t, /ORIENTATIVA|\$ ?\d/, "sin precio");
    assert.equal(bloqueada.mensajes.some((m) => m.aviso), true);
    assert.equal(bloqueada.estado.pendiente, "habitaciones");
    assert.equal(bloqueada.estado.habitaciones, null);
    assert.equal(bloqueada.estado.adultos, 3, "conserva lo declarado");
    assert.equal(bloqueada.estado.seleccion, "blo:5-solo", "conserva el hotel/salida");
    assert.equal(bloqueada.estado.combo, "Estándar|PAE");
    assert.equal(bloqueada.estado.cualquierFecha, true);
    assert.equal(bloqueada.estado.destino, respuestas[6].estado.destino);
    assert.ok(valores(bloqueada).includes("habitaciones:triple=1"), "ofrece corregir las habitaciones");
    assert.equal(llamadas.filter((l) => l.op === "buscarBloqueos").length, 1, "no vuelve a buscar");
    const fin = textos(respuestas[8]);
    assert.match(fin, /Cotización ORIENTATIVA/);
    assert.doesNotMatch(fin, /Indicaste/);
    assert.equal(respuestas[8].estado.adultos, 3);
  });
  test("1 adulto + niño en sencilla: las plazas alcanzan a los adultos y cotiza (el bot no valida capacidad por habitación: cotiza sin pasajeros)", async () => {
    una();
    const { respuestas } = await charla([{ op: "producto:bloqueo" }, "Cartagena", { op: "fechas:*" }, "1", { op: "sel:blo:5-solo" }, { op: "combo:Estándar|PAE" }, { op: "habitaciones:sencilla=1" }, "5"]);
    const fin = textos(respuestas[7]);
    assert.match(fin, /Cotización ORIENTATIVA/);
    assert.doesNotMatch(fin, /Indicaste|No alcanzan/);
    assert.equal(respuestas[7].estado.adultos, 1);
  });
  test("1 adulto + 1 infante en doble: la doble tarifa 2 plazas pero el estado sigue con 1 adulto", async () => {
    una();
    const { respuestas } = await charla([{ op: "producto:bloqueo" }, "Cartagena", { op: "fechas:*" }, "1", { op: "sel:blo:5-solo" }, { op: "combo:Estándar|PAE" }, { op: "habitaciones:doble=1" }, "1"]);
    assert.equal(respuestas[7].estado.adultos, 1);
    assert.match(textos(respuestas[7]), /1 infante/);
    assert.doesNotMatch(textos(respuestas[7]), /Indicaste/, "las plazas superan a los adultos: no es contradicción");
  });
  test("1 adulto en doble, sin infante: sin aviso", async () => {
    una();
    const { respuestas } = await charla([{ op: "producto:bloqueo" }, "Cartagena", { op: "fechas:*" }, "1", { op: "sel:blo:5-solo" }, { op: "combo:Estándar|PAE" }, { op: "habitaciones:doble=1" }, { op: "menores:no" }]);
    assert.doesNotMatch(textos(respuestas[7]), /Indicaste/);
    assert.equal(respuestas[7].estado.adultos, 1);
  });
  test("cambiar de hotel tras cotizar busca con los adultos reales y conserva la salida de exactamente 1 silla", async () => {
    ofertasActivas = [
      { ...OFERTAS[0], clave: "5-grande", sillas_libres: 4 } as OfertaBloqueo,
      { ...OFERTAS[0], clave: "5-una", hotel_nombre: "Otro hotel", sillas_libres: 1 } as OfertaBloqueo,
    ];
    const { respuestas } = await charla([{ op: "producto:bloqueo" }, "Cartagena", { op: "fechas:*" }, "1", { op: "sel:blo:5-grande" }, { op: "combo:Estándar|PAE" }, { op: "habitaciones:doble=1" }, "1", { op: "corregir:seleccion" }]);
    const ultima = respuestas[respuestas.length - 1];
    assert.equal(ultima.estado.adultos, 1);
    assert.equal(busquedas().at(-1)!.sillasMin, "1", "no hereda las 2 plazas de la doble");
    assert.ok(claves(ultima).includes("sel:blo:5-una"), "la salida con 1 silla sigue visible");
  });
  test("si la composición coincide no hay aviso", async () => {
    una();
    const { respuestas } = await cotizar("5 y 1");
    assert.doesNotMatch(textos(respuestas[7]), /Indicaste/);
  });
});

describe("el motor compartido de búsqueda (panel y WhatsApp)", () => {
  test("omitir y sillasMin se validan y paginan sin cambiar el total", () => {
    const v = validarCriteriosBloqueos({ destino: "cartagena", omitir: "6", sillasMin: "2", limite: "6" });
    assert.ok(v.ok);
    const r = buscarEnOfertas(OFERTAS, v.criterios);
    assert.equal(r.ofertas.length, 6);
    assert.equal(r.total_encontradas, 25, "30 menos las 5 de Faro (1 silla)");
    assert.equal(r.truncado, true);
    assert.equal(buscarEnOfertas(OFERTAS, { destino: "cartagena", omitir: 24, limite: 6 }).truncado, false);
    for (const malo of [{ omitir: "-1" }, { omitir: "x" }, { sillasMin: "0" }, { sillasMin: "99" }]) assert.equal(validarCriteriosBloqueos(malo).ok, false);
  });
  test("sin omitir ni sillasMin el comportamiento de siempre se mantiene", () => {
    const r = buscarEnOfertas(OFERTAS, { destino: "cartagena" });
    assert.equal(r.total_encontradas, 30);
    assert.equal(r.ofertas.length, 10);
  });
});

describe("Porción terrestre: fechas sin año no entran en ciclo", () => {
  const A_FECHAS = [{ op: "producto:porcion" }, "Cartagena", "9 al 12 de diciembre"];

  test("la confirmación ofrece el RANGO completo de cada año, no una sola fecha", async () => {
    const { ultima } = await charla(A_FECHAS);
    assert.deepEqual(valores(ultima).filter((v) => v.startsWith("fechas:")), ["fechas:2026-12-09,2026-12-12", "fechas:2027-12-09,2027-12-12"]);
    assert.deepEqual(etiquetas(ultima).filter((e) => /diciembre/.test(e)), ["9 al 12 de diciembre de 2026", "9 al 12 de diciembre de 2027"]);
  });

  test("elegir el rango conserva ida y regreso y avanza a adultos sin repetir fechas", async () => {
    const { ultima } = await charla([...A_FECHAS, { op: "fechas:2026-12-09,2026-12-12" }]);
    assert.equal(ultima.estado.fechaIda, "2026-12-09");
    assert.equal(ultima.estado.fechaRegreso, "2026-12-12");
    assert.equal(ultima.estado.pendiente, "adultos");
    assert.match(textos(ultima), /adultos/);
    assert.doesNotMatch(textos(ultima), /Fechas de ida y regreso/);
  });

  test("el camino exacto reportado: la opción «9 de diciembre de 2026» ya no existe sola", async () => {
    const { ultima } = await charla(A_FECHAS);
    assert.ok(!valores(ultima).includes("fechas:2026-12-09"));
    assert.ok(!etiquetas(ultima).includes("9 de diciembre de 2026"));
  });

  test("una sola fecha exacta se conserva como ida y se pregunta el regreso", async () => {
    const { respuestas } = await charla([{ op: "producto:porcion" }, "Cartagena", "9 de diciembre de 2026"]);
    const r = respuestas[2];
    assert.equal(r.estado.fechaIda, "2026-12-09");
    assert.equal(r.estado.fechaRegreso, null);
    assert.equal(r.estado.pendiente, "fechas");
    assert.match(textos(r), /regreso/);
  });

  test("el regreso dado después completa el rango y avanza a adultos", async () => {
    const { ultima } = await charla([{ op: "producto:porcion" }, "Cartagena", "9 de diciembre de 2026", "12 de diciembre de 2026"]);
    assert.equal(ultima.estado.fechaIda, "2026-12-09");
    assert.equal(ultima.estado.fechaRegreso, "2026-12-12");
    assert.equal(ultima.estado.pendiente, "adultos");
  });

  test("una sola fecha sin año: confirma la ida y luego el regreso, sin perder ninguna", async () => {
    const { respuestas } = await charla([{ op: "producto:porcion" }, "Cartagena", "9 de diciembre", { op: "fechas:2026-12-09" }]);
    assert.deepEqual(valores(respuestas[2]).filter((v) => v.startsWith("fechas:")), ["fechas:2026-12-09", "fechas:2027-12-09"]);
    assert.equal(respuestas[3].estado.fechaIda, "2026-12-09");
    assert.equal(respuestas[3].estado.fechaRegreso, null);
    assert.match(textos(respuestas[3]), /fecha de regreso/);
    const reg = await avanzar(respuestas[3].estado, { tipo: "texto", texto: "12 de diciembre" }, sv(), HOY);
    assert.deepEqual(valores(reg).filter((v) => v.startsWith("fechas:")), ["fechas:2026-12-09,2026-12-12"]);
    const fin = await avanzar(reg.estado, { tipo: "opcion", valor: "fechas:2026-12-09,2026-12-12" }, sv(), HOY);
    assert.equal(fin.estado.pendiente, "adultos");
  });

  test("un rango que cruza el año ofrece solo el que existe", async () => {
    const { ultima } = await charla([{ op: "producto:porcion" }, "Cartagena", "del 28 de diciembre al 3 de enero"]);
    assert.deepEqual(valores(ultima).filter((v) => v.startsWith("fechas:")), ["fechas:2026-12-28,2027-01-03", "fechas:2027-12-28,2028-01-03"].slice(0, 1));
  });

  test("valida pasado, orden y fechas reales", async () => {
    const pasado = await charla([{ op: "producto:porcion" }, "Cartagena", "del 5 al 8 de octubre de 2026"]);
    assert.match(textos(pasado.ultima), /ya pasó/);
    const falsa = await charla([{ op: "producto:porcion" }, "Cartagena", "del 30 al 31 de febrero de 2027"]);
    assert.match(textos(falsa.ultima), /no existe/);
    const mismo = await charla([{ op: "producto:porcion" }, "Cartagena", "9 al 9 de diciembre de 2026"]);
    assert.match(textos(mismo.ultima), /mismo día/);
    const orden = await charla([{ op: "producto:porcion" }, "Cartagena", "9 de diciembre de 2026", "5 de diciembre de 2026"]);
    assert.match(textos(orden.ultima), /posterior a la ida/);
    assert.equal(orden.ultima.estado.fechaIda, "2026-12-09");
    assert.equal(orden.ultima.estado.fechaRegreso, null);
    const opcionPasada = await avanzar(estadoInicial(), { tipo: "opcion", valor: "fechas:2025-01-01,2025-01-03" }, sv(), HOY);
    assert.match(textos(opcionPasada), /ya pasó/);
  });

  test("con ida y regreso confirmados busca con las dos fechas", async () => {
    await charla([...A_FECHAS, { op: "fechas:2026-12-09,2026-12-12" }, "2", "1 doble", "sin menores"]);
    const b = llamadas.find((l) => l.op === "buscarPorcion")?.arg as Record<string, string>;
    assert.equal(b.fechaIda, "2026-12-09");
    assert.equal(b.fechaRegreso, "2026-12-12");
  });
});
