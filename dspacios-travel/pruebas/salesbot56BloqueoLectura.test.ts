import { test, describe, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import nodeModule from "node:module";

// #56 multiproducto — capa de LECTURA de paquetes (lib/salesbot/paquetes/
// lectura.ts), con los motores y la sesión simulados para controlar qué
// devuelven:
//   · acceso: los 5 roles aprobados, solo Mayorista; control_vuelo, externos,
//     inactivos y Minorista no — y sin autorización no se toca el catálogo;
//   · vigencia: solo se cotiza una oferta o un hotel VISIBLE del cargador del
//     tarifario (que ya filtra vigencia y salidas pasadas); si no, el motor no
//     se llama;
//   · el motor recibe la sesión del usuario (nunca un cliente administrador)
//     y la misma entrada que arma el bot;
//   · saneamiento: un error técnico del motor nunca sale crudo; los netos que
//     trae el motor no salen;
//   · H-PQ1: el total se retiene si la sesión no lee el paquete y hay cargo
//     por grupo.

type ResolveHook = (specifier: string, context: unknown, nextResolve: (specifier: string, context: unknown) => unknown) => unknown;
const { registerHooks } = nodeModule as unknown as { registerHooks: (hooks: { resolve: ResolveHook }) => void };
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") return { url: `data:text/javascript,${encodeURIComponent("export {}")}`, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

process.env.SUPABASE_SERVICE_ROLE_KEY = "valor-de-prueba";

// ── Estado simulado ──────────────────────────────────────────────────────
type Fila = Record<string, unknown>;
let usuario: { id: string } | null = { id: "u1" };
let perfil: { rol: string; activo: boolean } | null = { rol: "venta", activo: true };
let errorPerfil: { message: string } | null = null;
let tenant = "mayorista";
/** Respuestas sucesivas a la lectura de `armado_paquetes.pct_mk` con la sesión; vacía = fila legible con 0,2. */
let lecturasMarkup: { data: unknown; error: unknown }[] = [];
let columnasMarkup: string[] = [];
let cargaOk = true;
let llamadasCarga = 0;
const llamadas: { motor: string; sesion: unknown; entrada: unknown }[] = [];

const filaBloqueo = (f: Fila = {}): Fila => ({
  modulo: "bloqueo",
  bloqueo_label: "BOG-ADZ",
  bloqueo_id: 10,
  empaquetado_id: null,
  paquete_id: 5,
  hotel_id: 7,
  fecha_ida: "2027-03-10",
  fecha_regreso: "2027-03-13",
  noches: 3,
  destino_nombre: "SAN ANDRÉS",
  paquete_nombre: "San Andrés marzo",
  hotel_nombre: "Hotel Caribe",
  categoria: "Estándar",
  regimen: "PAE",
  acomodacion: "doble",
  precio_pvp: 1_000_000,
  moneda: "COP",
  ...f,
});
// Caso del gate: `bloqueos_vuelo.origen` NULL y `ruta` = "PNR-BOG" → el cargador real (datos.ts:199-201)
// entrega origenPorBloqueo = { 10: "PNR" } y la etiqueta trae el mismo texto. Nada de eso debe salir.
const ORIGENES_CONTAMINADOS = { 10: "PNR" };
const FILAS = [filaBloqueo({ bloqueo_label: "PNR-BOG" }), filaBloqueo({ modulo: "porcion_terrestre", bloqueo_id: null, paquete_id: 50, hotel_id: 217, destino_nombre: "SAN ANDRÉS" })];

const SESION = {
  auth: { getUser: async () => ({ data: { user: usuario }, error: null }) },
  from(tabla: string) {
    const b = {
      select: (cols: string) => {
        if (tabla === "armado_paquetes") columnasMarkup.push(cols);
        return b;
      },
      eq: () => b,
      maybeSingle: async () => {
        if (tabla === "usuarios") return { data: perfil, error: errorPerfil };
        if (tabla === "armado_paquetes") return lecturasMarkup.shift() ?? { data: { pct_mk: 0.2 }, error: null };
        throw new Error(`la lectura no debe consultar "${tabla}" con la sesión`);
      },
    };
    return b;
  },
};

const DATOS_MOTOR = {
  origen: { tipo: "bloqueo", id: 10 },
  meta: { hotel_nombre: "Hotel Caribe", destino_nombre: "SAN ANDRÉS", fecha_ida: "2027-03-10", fecha_regreso: "2027-03-13" },
  pvpPorAcom: { doble: 1_000_000 },
  netoPorAcom: { doble: 777_111 },
  precioVenta: 2_000_000,
  paxConSilla: 2,
  totalPax: 2,
  numNinos: 0,
  numNinos2: 0,
  numInfantes: 0,
  distribucionMenores: null,
  edadesMenoresUsadas: [],
  lineasHab: [{ acom: "doble", habitaciones: 1, pax: 2, pvp: 1_000_000 }],
  serviciosItems: [],
  serviciosIncluidos: [{ servicioId: 9, nombre: "Traslado", categoria: "traslado", incluido: true, costoNeto: 55_444, proveedorId: 66 }],
  impuestoTotal: 123_456,
  monedaReserva: "COP",
  notaNino: null,
  cargoMascota: null,
  notaMascota: null,
  condicionesTarifa: [],
};
let respuestaComputo: unknown = { ok: true, data: DATOS_MOTOR };
let respuestaBuscar: unknown = { ok: true, resultados: [] };
let respuestaPorFechas: unknown = { ok: true, combos: [], noches: 3, moneda: "COP", condicion: null, serviciosGrupoPendientes: [] };

mock.module("@/lib/supabase/server", { namedExports: { createClient: async () => SESION } });
mock.module("@/lib/tenant.server", { namedExports: { getTenant: async () => tenant } });
mock.module("@/lib/tarifario/datos", {
  namedExports: {
    cargarDatosTarifario: async () => {
      llamadasCarga++;
      if (!cargaOk) return { ok: false, error: "No se pudo cargar el tarifario." };
      return { ok: true, datos: { filasVisibles: FILAS, cuposPorBloqueo: { 10: 3 }, origenPorBloqueo: ORIGENES_CONTAMINADOS } };
    },
  },
});
mock.module("@/lib/reservar/computo", {
  namedExports: {
    computarReserva: async (sesion: unknown, entrada: unknown) => {
      llamadas.push({ motor: "computarReserva", sesion, entrada });
      return respuestaComputo;
    },
  },
});
mock.module("@/lib/reservar/cotizar", {
  namedExports: {
    buscarHoteles: async (entrada: unknown) => {
      llamadas.push({ motor: "buscarHoteles", sesion: null, entrada });
      return respuestaBuscar;
    },
    cotizarPorFechas: async (entrada: unknown) => {
      llamadas.push({ motor: "cotizarPorFechas", sesion: null, entrada });
      return respuestaPorFechas;
    },
  },
});
const errores: string[] = [];
mock.module("@/lib/observabilidad/medicion", {
  namedExports: {
    generarFlujoId: () => "flujo-prueba",
    registrarErrorTecnico: (_f: string, _id: string, etapa: string, codigo: string) => errores.push(`${etapa}:${codigo}`),
  },
});

const L = await import("../lib/salesbot/paquetes/lectura.ts");
const { entradaComputoBloqueo, ofertasBloqueo } = await import("../lib/salesbot/paquetes/bloqueo.ts");
const { entradaBuscarHoteles, entradaComputoPorcion } = await import("../lib/salesbot/paquetes/porcion.ts");
const { clavesProhibidasEn } = await import("../lib/salesbot/contrato.ts");
const { interpretarPctMk } = await import("../lib/salesbot/paquetes/contrato.ts");

beforeEach(() => {
  usuario = { id: "u1" };
  perfil = { rol: "venta", activo: true };
  errorPerfil = null;
  tenant = "mayorista";
  lecturasMarkup = [];
  columnasMarkup = [];
  cargaOk = true;
  llamadasCarga = 0;
  llamadas.length = 0;
  errores.length = 0;
  respuestaComputo = { ok: true, data: DATOS_MOTOR };
  respuestaBuscar = { ok: true, resultados: [] };
  respuestaPorFechas = { ok: true, combos: [], noches: 3, moneda: "COP", condicion: null, serviciosGrupoPendientes: [] };
  process.env.SUPABASE_SERVICE_ROLE_KEY = "valor-de-prueba";
});

async function ctx() {
  const p = await L.prepararConsultaPaquetes();
  assert.ok(p.ok, p.ok ? "" : p.motivo);
  return p.ok ? p.ctx : (null as never);
}

describe("acceso", () => {
  for (const rol of ["superadmin", "gerencia", "administracion", "operaciones", "venta"]) {
    test(`${rol} en Mayorista: autorizado`, async () => {
      perfil = { rol, activo: true };
      const p = await L.prepararConsultaPaquetes();
      assert.equal(p.ok, true);
      assert.equal(llamadasCarga, 1);
    });
  }

  const negado = async (motivo: string) => {
    const p = await L.prepararConsultaPaquetes();
    assert.deepEqual(p, { ok: false, codigo: "no_autorizado", motivo });
    assert.equal(llamadasCarga, 0, "sin autorización no se carga el catálogo");
  };

  for (const rol of ["control_vuelo", "agencia", "freelance", "cliente_final", "publico"]) {
    test(`${rol}: no autorizado y sin tocar el catálogo`, async () => {
      perfil = { rol, activo: true };
      await negado(L.MENSAJE_NO_AUTORIZADO_PAQUETES.rol_no_permitido);
    });
  }
  test("sin sesión", async () => {
    usuario = null;
    await negado(L.MENSAJE_NO_AUTORIZADO_PAQUETES.sin_sesion);
  });
  test("usuario inactivo, aunque su rol sea superadmin", async () => {
    perfil = { rol: "superadmin", activo: false };
    await negado(L.MENSAJE_NO_AUTORIZADO_PAQUETES.usuario_inactivo);
  });
  test("sin perfil", async () => {
    perfil = null;
    const p = await L.prepararConsultaPaquetes();
    assert.equal(p.ok, false);
    assert.equal(llamadasCarga, 0);
  });
  test("agencia activa Minorista", async () => {
    tenant = "minorista";
    await negado(L.MENSAJE_NO_AUTORIZADO_PAQUETES.agencia_no_permitida);
  });
  test("error leyendo el perfil: error técnico, nunca el mensaje crudo", async () => {
    errorPerfil = { message: "permission denied for table usuarios" };
    const p = await L.prepararConsultaPaquetes();
    assert.equal(p.ok, false);
    if (!p.ok) {
      assert.equal(p.codigo, "error_tecnico");
      assert.doesNotMatch(p.motivo, /permission|usuarios/);
    }
    assert.equal(llamadasCarga, 0);
  });
  test("sin la variable de service-role (vigencia y cupos no verificables): falla cerrado", async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    const p = await L.prepararConsultaPaquetes();
    assert.equal(p.ok, false);
    if (!p.ok) assert.equal(p.codigo, "error_tecnico");
    assert.equal(llamadasCarga, 0);
  });
  test("el cargador del tarifario falla: error técnico", async () => {
    cargaOk = false;
    const p = await L.prepararConsultaPaquetes();
    assert.equal(p.ok, false);
    if (!p.ok) assert.equal(p.codigo, "error_tecnico");
  });
  test("los mensajes no hablan solo de programas", () => {
    for (const m of Object.values(L.MENSAJE_NO_AUTORIZADO_PAQUETES)) assert.doesNotMatch(m, /programas/i);
  });
});

describe("cotizarBloqueo", () => {
  const ENTRADA = { oferta: "5-b10-7", combo: "Estándar|PAE", hab_doble: "1" };

  test("oferta no visible (vencida, despublicada o fabricada): no_encontrado y el motor no se llama", async () => {
    const r = await L.cotizarBloqueo(await ctx(), { ...ENTRADA, oferta: "5-b99-7" });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.codigo, "no_encontrado");
    assert.equal(llamadas.length, 0);
  });

  test("combo no publicado para esa oferta: no_encontrado", async () => {
    const r = await L.cotizarBloqueo(await ctx(), { ...ENTRADA, combo: "Estándar|FULL" });
    assert.equal(r.ok, false);
    assert.equal(llamadas.length, 0);
  });

  test("el motor recibe la SESIÓN del usuario y la misma entrada que arma el bot", async () => {
    await L.cotizarBloqueo(await ctx(), ENTRADA);
    assert.equal(llamadas.length, 1);
    assert.equal(llamadas[0].sesion, SESION);
    const [oferta] = ofertasBloqueo(FILAS as never, { 10: 3 });
    assert.deepEqual(llamadas[0].entrada, entradaComputoBloqueo(oferta, { clave: "5-b10-7", categoria: "Estándar", regimen: "PAE", composicion: { habitaciones: { doble: 1 }, edadesMenores: [] } }));
  });

  test("respuesta: total del motor, sillas del cargador, sello de 15 minutos, sin netos", async () => {
    const r = await L.cotizarBloqueo(await ctx(), ENTRADA);
    assert.ok(r.ok);
    if (!r.ok) return;
    assert.equal(r.datos.total_orientativo, 2_000_000);
    assert.equal(r.datos.sillas_libres, 3);
    assert.equal(r.datos.alcanzan_sillas, true);
    assert.equal(Date.parse(r.sello.valido_hasta) - Date.parse(r.sello.consultado_en), 15 * 60 * 1000);
    assert.equal(r.sello.fuente, "cotizarBloqueo");
    assert.deepEqual(clavesProhibidasEn(r), []);
    for (const v of ["777111", "55444", "123456"]) assert.equal(JSON.stringify(r).includes(v), false, v);
  });

  test("error técnico del motor: mensaje genérico, nunca el crudo; queda registrado", async () => {
    respuestaComputo = { ok: false, error: 'No se pudo consultar el hotel: relation "hoteles" does not exist' };
    const r = await L.cotizarBloqueo(await ctx(), ENTRADA);
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.codigo, "error_tecnico");
    assert.doesNotMatch(JSON.stringify(r), /relation|hoteles|No se pudo consultar/);
    assert.ok(errores.includes("cotizar_bloqueo:computarReserva_rechazo"));
  });

  const CON_CARGO_GRUPO = { ok: true, data: { ...DATOS_MOTOR, precioVenta: 2_100_000 } };
  const sinTotal = async () => {
    const r = await L.cotizarBloqueo(await ctx(), ENTRADA);
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.codigo, "no_cotizable");
  };

  test("H-PQ1: la sesión no lee la fila del paquete y hay cargo por grupo → sin total", async () => {
    lecturasMarkup = [{ data: null, error: null }, { data: null, error: null }];
    respuestaComputo = CON_CARGO_GRUPO;
    await sinTotal();
  });

  test("P2 del Auditor: la fila se ve pero leer pct_mk FALLA (antes o después) → sin total", async () => {
    respuestaComputo = CON_CARGO_GRUPO;
    lecturasMarkup = [{ data: null, error: { message: "permission denied for column pct_mk" } }, { data: { pct_mk: 0.2 }, error: null }];
    await sinTotal();
    lecturasMarkup = [{ data: { pct_mk: 0.2 }, error: null }, { data: null, error: { message: "timeout" } }];
    await sinTotal();
    assert.ok(errores.includes("markup_sesion:error_lectura_pct_mk"));
  });

  test("el % cambia entre la lectura previa y la posterior → sin total", async () => {
    respuestaComputo = CON_CARGO_GRUPO;
    lecturasMarkup = [{ data: { pct_mk: 0.2 }, error: null }, { data: { pct_mk: 0.25 }, error: null }];
    await sinTotal();
  });

  test("se lee la MISMA columna que el motor (pct_mk), antes y después, y su valor nunca sale", async () => {
    respuestaComputo = CON_CARGO_GRUPO;
    const r = await L.cotizarBloqueo(await ctx(), ENTRADA);
    assert.ok(r.ok);
    assert.deepEqual(columnasMarkup, ["pct_mk", "pct_mk"]);
    assert.equal(JSON.stringify(r).includes("0.2"), false);
    if (r.ok) assert.equal(r.datos.total_orientativo, 2_100_000);
  });

  // Valores que NO son un % interpretable: nunca se convierten en 0.
  const INVALIDOS: unknown[] = ["abc", "", " ", "0,2", "-0.1", Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -0.1, 1, 1.5, true, {}, [], undefined];

  test("interpretarPctMk: NULL vale 0; número finito en [0, 1) o texto numérico exacto; todo lo demás no confiable", () => {
    assert.deepEqual(interpretarPctMk(null), { ok: true, pct: 0 });
    assert.deepEqual(interpretarPctMk(0), { ok: true, pct: 0 });
    assert.deepEqual(interpretarPctMk(0.2), { ok: true, pct: 0.2 });
    assert.deepEqual(interpretarPctMk("0.2"), { ok: true, pct: 0.2 });
    assert.deepEqual(interpretarPctMk(0.999), { ok: true, pct: 0.999 });
    for (const v of INVALIDOS) assert.deepEqual(interpretarPctMk(v), { ok: false }, String(v));
  });

  test("pct_mk inválido en la lectura PREVIA o en la POSTERIOR → sin total (nunca un total con markup 0 inventado)", async () => {
    respuestaComputo = CON_CARGO_GRUPO;
    for (const v of INVALIDOS) {
      lecturasMarkup = [{ data: { pct_mk: v }, error: null }, { data: { pct_mk: 0.2 }, error: null }];
      await sinTotal();
      lecturasMarkup = [{ data: { pct_mk: 0.2 }, error: null }, { data: { pct_mk: v }, error: null }];
      await sinTotal();
    }
  });

  test("fila sin la columna pct_mk → sin total", async () => {
    respuestaComputo = CON_CARGO_GRUPO;
    lecturasMarkup = [{ data: {}, error: null }, { data: {}, error: null }];
    await sinTotal();
  });

  test("pct_mk como texto numérico, igual antes y después → total presentado", async () => {
    respuestaComputo = CON_CARGO_GRUPO;
    lecturasMarkup = [{ data: { pct_mk: "0.2" }, error: null }, { data: { pct_mk: "0.2" }, error: null }];
    const r = await L.cotizarBloqueo(await ctx(), ENTRADA);
    assert.equal(r.ok, true);
  });

  test("porción: las mismas reglas de markup retienen el total con cargo por grupo", async () => {
    respuestaComputo = CON_CARGO_GRUPO;
    lecturasMarkup = [{ data: { pct_mk: "abc" }, error: null }, { data: { pct_mk: 0.2 }, error: null }];
    const r = await L.cotizarPorcion(await ctx(), { paquete: "50", hotel: "217", fechaIda: "2027-03-10", fechaRegreso: "2027-03-13", combo: "Estándar|PAE", hab_doble: "1" });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.codigo, "no_cotizable");
  });

  test("pct_mk nulo en la fila: el motor usa 0 y el bot también (configuración real, confiable)", async () => {
    respuestaComputo = CON_CARGO_GRUPO;
    lecturasMarkup = [{ data: { pct_mk: null }, error: null }, { data: { pct_mk: null }, error: null }];
    const r = await L.cotizarBloqueo(await ctx(), ENTRADA);
    assert.equal(r.ok, true);
  });

  test("sin cargo aparte el total no depende del %: se presenta aunque la sesión no lea la fila, y no hay lectura posterior", async () => {
    lecturasMarkup = [{ data: null, error: null }];
    const r = await L.cotizarBloqueo(await ctx(), ENTRADA);
    assert.equal(r.ok, true);
    assert.deepEqual(columnasMarkup, ["pct_mk"]);
  });
});

describe("buscarBloqueos", () => {
  test("ruta contaminada (origen ausente, ruta PNR-BOG): ni la búsqueda, ni la oferta, ni la cotización publican PNR", async () => {
    const c = await ctx();
    const b = L.buscarBloqueos(c, { destino: "san andres" });
    const o = L.ofertaBloqueoPorClave(c, "5-b10-7");
    const q = await L.cotizarBloqueo(c, { oferta: "5-b10-7", combo: "Estándar|PAE", hab_doble: "1" });
    assert.ok(b.ok && o && q.ok);
    for (const salida of [b, o, q]) {
      const json = JSON.stringify(salida);
      assert.equal(json.includes("PNR"), false, json.slice(0, 200));
      assert.doesNotMatch(json, /"(ruta|origen|origen_iata|bloqueo_label)"/);
    }
  });

  test("solo lee las filas ya visibles; no llama motores; sin record", async () => {
    const r = L.buscarBloqueos(await ctx(), { destino: "san andres" });
    assert.ok(r.ok);
    if (!r.ok) return;
    assert.equal(r.datos.ofertas.length, 1);
    assert.equal(llamadas.length, 0);
    assert.deepEqual(clavesProhibidasEn(r), []);
  });
  test("sin coincidencias: sin_resultados", async () => {
    const r = L.buscarBloqueos(await ctx(), { destino: "cartagena" });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.codigo, "sin_resultados");
  });
});

describe("buscarPorcion", () => {
  const ENTRADA = { destino: "SAN ANDRÉS", fechaIda: "2027-03-10", fechaRegreso: "2027-03-13", adultos: "2", hab_doble: "1" };

  test("destino no publicado: parámetros inválidos y el motor no se llama", async () => {
    const r = await L.buscarPorcion(await ctx(), { ...ENTRADA, destino: "CARTAGENA" });
    assert.equal(r.ok, false);
    if (!r.ok) assert.deepEqual(r.campos, ["destino"]);
    assert.equal(llamadas.length, 0);
  });

  test("el motor recibe exactamente la entrada de Vista Booking", async () => {
    await L.buscarPorcion(await ctx(), ENTRADA);
    assert.equal(llamadas[0].motor, "buscarHoteles");
    assert.deepEqual(llamadas[0].entrada, entradaBuscarHoteles({ destino: "SAN ANDRÉS", fechaIda: "2027-03-10", fechaRegreso: "2027-03-13", adultos: 2, composicion: { habitaciones: { doble: 1 }, edadesMenores: [] } }));
  });

  test("fallo transitorio del motor: error técnico, sin el texto del motor", async () => {
    respuestaBuscar = { ok: false, error: "Búsqueda no disponible en este momento. Intenta nuevamente." };
    const r = await L.buscarPorcion(await ctx(), ENTRADA);
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.codigo, "error_tecnico");
  });

  test("resultado: total del motor como total_orientativo y sin campos extra", async () => {
    respuestaBuscar = {
      ok: true,
      resultados: [
        {
          hotelId: 217, hotelNombre: "Hotel Isla", destino: "SAN ANDRÉS", paqueteId: 50, paqueteNombre: "Porción", categoria: "Estándar", regimen: "PAE",
          total: 1_800_000, noches: 3, fechaIda: "2027-03-10", fechaRegreso: "2027-03-13", moneda: "COP", habitaciones: { doble: 1 },
          menores: { nino: 0, nino2: 0, infante: 0 }, edadesMenores: [], pax: 2,
          combos: [{ categoria: "Estándar", regimen: "PAE", total: 1_800_000, pax: 2, menores: { nino: 0, nino2: 0, infante: 0 }, netos: { doble: 1 } }],
          costoNeto: 999_999,
        },
      ],
    };
    const r = await L.buscarPorcion(await ctx(), ENTRADA);
    assert.ok(r.ok);
    if (!r.ok) return;
    assert.equal(r.datos.resultados[0].combos[0].total_orientativo, 1_800_000);
    assert.equal(JSON.stringify(r).includes("999999"), false);
    assert.deepEqual(clavesProhibidasEn(r), []);
  });
});

describe("cotizarPorcion", () => {
  const ENTRADA = { paquete: "50", hotel: "217", fechaIda: "2027-03-10", fechaRegreso: "2027-03-13" };

  test("hotel no publicado en porción: no_encontrado y ningún motor se llama", async () => {
    const r = await L.cotizarPorcion(await ctx(), { ...ENTRADA, hotel: "999" });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.codigo, "no_encontrado");
    assert.equal(llamadas.length, 0);
  });

  test("sin combo: solo precio por persona (cotizarPorFechas), sin computarReserva", async () => {
    await L.cotizarPorcion(await ctx(), ENTRADA);
    assert.deepEqual(llamadas.map((l) => l.motor), ["cotizarPorFechas"]);
    assert.deepEqual(llamadas[0].entrada, { paqueteId: 50, hotelId: 217, fechaIda: "2027-03-10", fechaRegreso: "2027-03-13" });
  });

  test("con combo y composición: computarReserva con la sesión y la entrada del bot", async () => {
    await L.cotizarPorcion(await ctx(), { ...ENTRADA, combo: "Estándar|PAE", hab_doble: "1", edadesMenores: "5" });
    const c = llamadas.find((l) => l.motor === "computarReserva");
    assert.ok(c);
    assert.equal(c!.sesion, SESION);
    assert.deepEqual(c!.entrada, entradaComputoPorcion({ paqueteId: 50, hotelId: 217, fechaIda: "2027-03-10", fechaRegreso: "2027-03-13", categoria: "Estándar", regimen: "PAE", composicion: { habitaciones: { doble: 1 }, edadesMenores: [5] } }));
  });

  test("sin tarifa para esas fechas: no_cotizable con las sugerencias públicas", async () => {
    respuestaPorFechas = { ok: false, error: "Para las fechas elegidas no encontramos una tarifa.", sugerencias: [{ fechaIda: "2027-03-11", fechaRegreso: "2027-03-14", noches: 3, etiqueta: "11 mar" }] };
    const r = await L.cotizarPorcion(await ctx(), ENTRADA);
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.codigo, "no_cotizable");
    assert.ok("sugerencias_fecha" in r);
    if ("sugerencias_fecha" in r) assert.deepEqual(r.sugerencias_fecha, [{ fecha_ida: "2027-03-11", fecha_regreso: "2027-03-14", noches: 3, etiqueta: "11 mar" }]);
  });

  test("fallo técnico de cotizarPorFechas: error técnico, sin sugerencias ni texto del motor", async () => {
    respuestaPorFechas = { ok: false, error: "No pudimos cotizar este hotel en este momento. Intenta nuevamente.", sugerencias: [] };
    const r = await L.cotizarPorcion(await ctx(), ENTRADA);
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.codigo, "error_tecnico");
      assert.equal("sugerencias_fecha" in r, false);
    }
  });
});
