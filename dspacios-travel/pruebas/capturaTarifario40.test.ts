// #40 · E1 — el contacto CRM auxiliar del checkout del tarifario.
//
// Parte A: el helper (`lib/crm/contactoTarifario.ts`). Parte B: la acción REAL `crearSolicitudReserva`
// (app/tarifario/checkout/actions.ts) con el motor de precios simulado y un cliente de servicio
// simulado que registra cada llamada: se prueba que el tipo elegido se conserva (nunca "CC" supuesto),
// que una colisión 23505 no sobrescribe ni bloquea, que otros errores solo dejan el código en el log y
// que la solicitud sigue su flujo. Datos sintéticos.
import { test, describe, mock, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  datosContactoTarifario, codigoErrorContacto, logContactoTarifario, type ClienteContactoTarifario,
} from "../lib/crm/contactoTarifario.ts";

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://dummy.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "dummy-anon";
process.env.SUPABASE_SERVICE_ROLE_KEY = "dummy-service";

const CLIENTE: ClienteContactoTarifario = { nombres: "Ana", apellidos: "Prueba", numeroDoc: "1000000001", email: "ana@example.test", telefono: "3000000000" };

// ── Parte A · helper (decisiones puras) ──────────────────────────────────────
describe("datosContactoTarifario", () => {
  test("CE elegido: se conserva CE", () => {
    assert.equal(datosContactoTarifario(CLIENTE, "CE")!.tipo_doc, "CE");
  });
  test("todos los tipos del catálogo se conservan tal cual", () => {
    for (const t of ["CC", "CE", "TI", "RC", "PAS", "PPT", "NIT"]) assert.equal(datosContactoTarifario(CLIENTE, t)!.tipo_doc, t);
  });
  test("tipo ausente (null): NULL, nunca CC", () => {
    const f = datosContactoTarifario(CLIENTE, null)!;
    assert.equal(f.tipo_doc, null);
    assert.equal(f.documento, "1000000001");
  });
  test("tipo fuera del catálogo: NULL (no se inventa ni se copia)", () => {
    for (const t of ["", "XX", "cc", "C.C.", "CC2", " CC"]) assert.equal(datosContactoTarifario(CLIENTE, t)!.tipo_doc, null, JSON.stringify(t));
  });
  test("sin documento no hay tipo, aunque venga uno", () => {
    const f = datosContactoTarifario({ ...CLIENTE, numeroDoc: "   " }, "CE")!;
    assert.equal(f.documento, null);
    assert.equal(f.tipo_doc, null);
  });
  test("recorte de espacios en los bordes; el nombre conserva su espaciado interior (como antes)", () => {
    const f = datosContactoTarifario({ nombres: "  Ana ", apellidos: " Prueba  ", numeroDoc: " 123 ", email: " a@b.co ", telefono: " 300 " }, "CC")!;
    assert.deepEqual(f, { nombre: "Ana   Prueba", tipo_doc: "CC", documento: "123", email: "a@b.co", telefono: "300" });
  });
  test("email o teléfono vacíos: NULL", () => {
    const f = datosContactoTarifario({ ...CLIENTE, email: "  ", telefono: "" }, "CE")!;
    assert.equal(f.email, null);
    assert.equal(f.telefono, null);
  });
  test("sin nombre: no hay contacto", () => {
    assert.equal(datosContactoTarifario({ ...CLIENTE, nombres: " ", apellidos: "" }, "CE"), null);
  });
  test("caracteres especiales se guardan literales (la consulta es parametrizada)", () => {
    const f = datosContactoTarifario({ ...CLIENTE, numeroDoc: "9*9,1)'", email: "a+b@c.co,x", nombres: "O'Brien", apellidos: "Ñandú \"X\"" }, "PAS")!;
    assert.equal(f.documento, "9*9,1)'");
    assert.equal(f.email, "a+b@c.co,x");
    assert.equal(f.nombre, "O'Brien Ñandú \"X\"");
  });
});

describe("codigoErrorContacto", () => {
  test("sin error: nada que registrar", () => {
    assert.equal(codigoErrorContacto(null), null);
    assert.equal(codigoErrorContacto(undefined), null);
  });
  test("colisión 23505: el contacto ya existía; no es un fallo y no se registra", () => {
    assert.equal(codigoErrorContacto({ code: "23505", message: 'duplicate key value violates unique constraint "uq_crm_documento" Key (documento)=(1000000001)' } as never), null);
  });
  test("otro error: solo el código, sin el mensaje (que puede repetir documento, email o teléfono)", () => {
    const c = codigoErrorContacto({ code: "42501", message: "permission denied for 1000000001 ana@example.test" } as never);
    assert.equal(c, "42501");
    assert.ok(!String(c).includes("ana@example.test") && !String(c).includes("1000000001"));
  });
  test("código raro o ausente: «desconocido»", () => {
    for (const code of [undefined, null, "", 42, "con espacios y mucho texto largo largo", "a@b.co"]) {
      assert.equal(codigoErrorContacto({ code }), "desconocido", JSON.stringify(code));
    }
  });
});

describe("logContactoTarifario", () => {
  test("solo etapa y código", () => {
    assert.equal(logContactoTarifario("42501"), "[crm40] etapa=contacto_tarifario codigo=42501");
  });
  test("un valor con forma de dato personal no pasa al log", () => {
    assert.equal(logContactoTarifario("ana@example.test"), "[crm40] etapa=contacto_tarifario codigo=desconocido");
    assert.equal(logContactoTarifario("duplicate key (documento)=(1000000001)"), "[crm40] etapa=contacto_tarifario codigo=desconocido");
  });
});

// ── Parte B · acción real del checkout ───────────────────────────────────────
type Fila = Record<string, unknown>;
const eventos: string[] = [];                       // orden de las llamadas relevantes del cliente de servicio
const insertsContacto: Fila[] = [];                 // filas enviadas a crm_contactos
const otrasEscrituras: string[] = [];               // update/upsert/delete sobre cualquier tabla
let resultadoContacto: () => unknown = () => ({ data: null, error: null });
let adminLanzaTrasCotizacion = false;
let cotizacionInsertada = false;

function admin() {
  return {
    from(tabla: string) {
      const b: Record<string, unknown> = {};
      Object.assign(b, {
        select: () => b, eq: () => b, in: () => b, order: () => b, limit: () => b,
        maybeSingle: async () => { eventos.push(`leer:${tabla}`); return { data: null, error: null }; },
        single: async () => ({ data: { id: 77, codigo: "COT-77", share_token: "tok" }, error: null }),
        update: () => { otrasEscrituras.push(`update:${tabla}`); return b; },
        upsert: () => { otrasEscrituras.push(`upsert:${tabla}`); return b; },
        delete: () => { otrasEscrituras.push(`delete:${tabla}`); return b; },
        insert: (fila: Fila) => {
          if (tabla === "crm_contactos") {
            eventos.push("insert:crm_contactos");
            insertsContacto.push(fila);
            return Promise.resolve().then(() => resultadoContacto());
          }
          if (tabla === "cotizaciones") { eventos.push("insert:cotizaciones"); cotizacionInsertada = true; }
          return b;
        },
        then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(ok, ko),
      });
      return b;
    },
    rpc: async () => ({ data: { nuevos: 1, reintentos: 0, omitidos: 0 }, error: null }),
  };
}
// Sesión pública (sin usuario): lecturas encadenables que no devuelven filas.
const sesion = {
  from: () => {
    const b: Record<string, unknown> = {};
    Object.assign(b, {
      select: () => b, eq: () => b, in: () => b, order: () => b, limit: () => b, or: () => b,
      maybeSingle: async () => ({ data: null, error: null }),
      single: async () => ({ data: null, error: null }),
      then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(ok, ko),
    });
    return b;
  },
  auth: { getUser: async () => ({ data: { user: null }, error: null }) },
};

mock.module("@/lib/reservar/computo", {
  namedExports: {
    computarReserva: async () => ({
      ok: true,
      data: {
        meta: { hotel_nombre: "OZ HOTEL CARTAGENA", destino_nombre: "CARTAGENA", fecha_ida: "2030-03-01", fecha_regreso: "2030-03-04" },
        precioVenta: 600_000, monedaReserva: "COP",
        lineasHab: [{ acom: "doble", habitaciones: 1, pax: 2, pvp: 300_000 }], pvpPorAcom: { doble: 300_000 },
        numNinos: 0, numNinos2: 0, numInfantes: 0, totalPax: 2, edadesMenoresUsadas: [],
        serviciosIncluidos: [], distribucionMenores: [], condicionesTarifa: null,
      },
    }),
  },
});
mock.module("@/lib/reservar/computoReservaBernalo", { namedExports: { computarReservaBernalo: async () => { throw new Error("no se usa en esta prueba"); } } });
mock.module("@/lib/reservar/cotizar", { namedExports: { liquidarServicioPuntual: async () => ({ ok: false, tipo: "no_disponible", mensaje: "no se usa" }) } });
mock.module("@/lib/supabase/server", { namedExports: { createClient: async () => sesion } });
mock.module("@/lib/supabase/admin", {
  namedExports: {
    createAdminClient: () => {
      if (adminLanzaTrasCotizacion && cotizacionInsertada) throw new Error("Falta SUPABASE_SERVICE_ROLE_KEY dummy.supabase.co");
      return admin();
    },
  },
});
mock.module("next/headers", { namedExports: { headers: async () => new Map([["host", "localhost"]]) } });

const { crearSolicitudReserva } = await import("../app/tarifario/checkout/actions.ts");

const hotelOz = {
  itemId: "hOZ", modulo: "porcion_terrestre", paqueteId: 34, hotelId: 1, bloqueoId: null, hotelNombre: "OZ HOTEL CARTAGENA", destino: "CARTAGENA",
  categoria: "Estandar", regimen: "Desayuno", fechaIda: "2030-03-01", fechaRegreso: "2030-03-04", noches: 3,
  habitaciones: { doble: 1 }, ninos: 0, ninos2: 0, infantes: 0, pax: 2, precio: 1, edadesMenores: [], cantidadMenores: 0,
};
const clienteCot = { nombres: "Ana", apellidos: "Prueba", numeroDoc: "1000000001", telefono: "3000000000", email: "ana@example.test" };
type Respuesta = Record<string, unknown> & { ok: boolean; error?: string };
const solicitar = (cliente: Record<string, unknown>) => crearSolicitudReserva({ items: [hotelOz], tours: [], cliente }) as Promise<Respuesta>;

const logs: string[] = [];
const consolaError = console.error;
beforeEach(() => {
  eventos.length = 0; insertsContacto.length = 0; otrasEscrituras.length = 0; logs.length = 0;
  resultadoContacto = () => ({ data: null, error: null });
  adminLanzaTrasCotizacion = false; cotizacionInsertada = false;
  console.error = (...a: unknown[]) => { logs.push(a.map(String).join(" ")); };
});
afterEach(() => { console.error = consolaError; });

describe("crearSolicitudReserva (real) — contacto CRM auxiliar", () => {
  test("CE elegido: el contacto se guarda con tipo CE y documento literal; la solicitud sigue", async () => {
    const r = await solicitar({ ...clienteCot, tipoDoc: "CE" });
    assert.equal(r.ok, true, JSON.stringify(r).slice(0, 200));
    assert.equal(insertsContacto.length, 1);
    assert.equal(insertsContacto[0].tipo_doc, "CE");
    assert.equal(insertsContacto[0].documento, "1000000001");
    assert.equal(insertsContacto[0].tenant, "mayorista");
    assert.equal(insertsContacto[0].categoria, "cliente_final");
    assert.equal(insertsContacto[0].origen, "Cotización tarifario (B2C)");
    assert.equal(insertsContacto[0].nombre, "Ana Prueba");
    assert.equal(insertsContacto[0].email, "ana@example.test");
    assert.equal(insertsContacto[0].telefono, "3000000000");
    assert.deepEqual(logs, []);
  });

  test("tipo ausente: NULL, nunca CC (ni con tipoDoc vacío)", async () => {
    for (const cliente of [clienteCot, { ...clienteCot, tipoDoc: "" }]) {
      insertsContacto.length = 0;
      const r = await solicitar(cliente);
      assert.equal(r.ok, true);
      assert.equal(insertsContacto.length, 1);
      assert.equal(insertsContacto[0].tipo_doc, null);
      assert.equal(insertsContacto[0].documento, "1000000001");
    }
  });

  test("tipo fuera del catálogo: la solicitud se rechaza como antes, sin cotización ni contacto", async () => {
    const r = await solicitar({ ...clienteCot, tipoDoc: "XX" });
    assert.equal(r.ok, false);
    assert.equal(r.error, "Elige un tipo de documento válido.");
    assert.equal(insertsContacto.length, 0);
    assert.ok(!eventos.includes("insert:cotizaciones"));
  });

  test("caracteres especiales en documento y email: viajan literales al contacto", async () => {
    const r = await solicitar({ ...clienteCot, numeroDoc: "9*9,1)'", email: "a+b@c.co,x", tipoDoc: "PAS" });
    assert.equal(r.ok, true);
    assert.equal(insertsContacto[0].documento, "9*9,1)'");
    assert.equal(insertsContacto[0].email, "a+b@c.co,x");
    assert.equal(insertsContacto[0].tipo_doc, "PAS");
  });

  test("colisión 23505: la solicitud OK, un solo insert, nada se sobrescribe y no se registra ningún error", async () => {
    resultadoContacto = () => ({ data: null, error: { code: "23505", message: "duplicate key (documento)=(1000000001) ana@example.test" } });
    const r = await solicitar({ ...clienteCot, tipoDoc: "CE" });
    assert.equal(r.ok, true);
    assert.equal(insertsContacto.length, 1);
    assert.deepEqual(otrasEscrituras, []);
    assert.deepEqual(logs, []);
  });

  test("error de inserción: la solicitud OK y el log lleva SOLO el código", async () => {
    resultadoContacto = () => ({ data: null, error: { code: "42501", message: "permission denied for table crm_contactos 1000000001 ana@example.test Ana Prueba" } });
    const r = await solicitar({ ...clienteCot, tipoDoc: "CE" });
    assert.equal(r.ok, true);
    const mios = logs.filter((l) => l.startsWith("[crm40]"));
    assert.deepEqual(mios, ["[crm40] etapa=contacto_tarifario codigo=42501"]);
    for (const l of logs) assert.ok(!/ana@example|1000000001|Ana Prueba|permission denied|3000000000/.test(l), `PII en el log: ${l}`);
    // La respuesta lleva los datos que el propio cliente escribió (enlaces de WhatsApp/correo, como antes);
    // lo que no puede aparecer es nada del error de la base ni del contacto auxiliar.
    assert.ok(!/permission denied|crm_contactos|42501|\[crm40\]/.test(JSON.stringify(r)), "nada del error del contacto en la respuesta al navegador");
  });

  test("el insert lanza una excepción: la solicitud OK y log con «excepcion»", async () => {
    resultadoContacto = () => { throw new Error("fetch failed ana@example.test"); };
    const r = await solicitar({ ...clienteCot, tipoDoc: "CE" });
    assert.equal(r.ok, true);
    assert.deepEqual(logs.filter((l) => l.startsWith("[crm40]")), ["[crm40] etapa=contacto_tarifario codigo=excepcion"]);
    assert.ok(logs.every((l) => !/ana@example/.test(l)));
  });

  test("el cliente de servicio no se puede crear (falta configuración): la solicitud OK y log sin datos", async () => {
    adminLanzaTrasCotizacion = true;
    const r = await solicitar({ ...clienteCot, tipoDoc: "CE" });
    assert.equal(r.ok, true);
    assert.equal(insertsContacto.length, 0);
    assert.deepEqual(logs.filter((l) => l.startsWith("[crm40]")), ["[crm40] etapa=contacto_tarifario codigo=excepcion"]);
    assert.ok(logs.every((l) => !/dummy|ana@example|1000000001/.test(l)));
  });

  test("el flujo se conserva: cotización → contacto → lectura de destinatarios, y respuesta con enlace", async () => {
    const r = await solicitar({ ...clienteCot, tipoDoc: "CE" });
    assert.equal(r.ok, true);
    const iCot = eventos.indexOf("insert:cotizaciones");
    const iContacto = eventos.indexOf("insert:crm_contactos");
    const iConfig = eventos.indexOf("leer:config_solicitudes");
    assert.ok(iCot >= 0 && iContacto > iCot && iConfig > iContacto, `orden inesperado: ${eventos.join(" > ")}`);
    assert.equal(typeof r.url === "string" || typeof r.mensaje === "string", true);
  });

  test("un fallo del contacto no cambia el resultado frente al caso sin fallo", async () => {
    const ok = await solicitar({ ...clienteCot, tipoDoc: "CE" });
    resultadoContacto = () => ({ data: null, error: { code: "XX000", message: "boom" } });
    const conFallo = await solicitar({ ...clienteCot, tipoDoc: "CE" });
    assert.deepEqual(conFallo, ok);
  });
});

describe("cableado del bloque en actions.ts", () => {
  const leer = (r: string) => readFileSync(new URL(r, import.meta.url), "utf8").replace(/\r\n/g, "\n");
  const src = leer("../app/tarifario/checkout/actions.ts");
  const fnIni = src.indexOf("export async function crearSolicitudReserva(");
  const sig = src.indexOf("\nexport async function ", fnIni + 10);
  const cuerpo = src.slice(fnIni, sig < 0 ? undefined : sig);
  const ini = cuerpo.indexOf("// Agrega el cliente a la base de contactos del CRM");
  const fin = cuerpo.indexOf("// Destinatarios configurados");
  // Sin comentarios: el aviso «nunca "CC"» del propio comentario no cuenta como código.
  const bloque = cuerpo.slice(ini, fin).split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");

  test("el bloque existe y delimita bien", () => {
    assert.ok(ini > 0 && fin > ini);
  });
  test("el bloque no contiene \"CC\" ni escribe sobre contactos existentes", () => {
    assert.ok(!/"CC"/.test(bloque));
    assert.ok(!/\.(update|upsert|delete)\(/.test(bloque));
  });
  test("usa el tipo elegido (tipoDoc.tipo), revisa el {error} y no deja el catch vacío", () => {
    assert.match(bloque, /datosContactoTarifario\(input\.cliente, tipoDoc\.tipo\)/);
    assert.match(bloque, /const \{ error \} = await admin\.from\("crm_contactos"\)\.insert\(\{/);
    assert.match(bloque, /codigoErrorContacto\(error\)/);
    assert.match(bloque, /console\.error\(logContactoTarifario\(/);
    assert.ok(!/catch \{ \/\*/.test(bloque), "sin catch silencioso");
  });
  test("el insert conserva su forma en línea con la agencia fija (lo exigen también crmContactosAcceso.wiring y checkoutBernaloWiring)", () => {
    assert.match(bloque, /tenant: "mayorista",/);
    const i = cuerpo.indexOf("if (!cot.ok) return cot;");
    assert.ok(i > 0 && i < cuerpo.indexOf("crm_contactos"), "el contacto va DESPUÉS de comprobar la cotización");
  });
  test("es el único insert en crm_contactos del archivo", () => {
    assert.equal((src.match(/from\("crm_contactos"\)/g) ?? []).length, 1);
  });
});
