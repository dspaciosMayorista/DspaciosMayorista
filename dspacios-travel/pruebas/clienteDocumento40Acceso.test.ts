// #40 V1 — búsqueda explícita del CLIENTE por documento (cotización dinámica simple, canal interno).
//
// Qué se ejecuta de verdad aquí: la Server Action REAL `buscarClienteDocumento`
// (app/(dashboard)/dashboard/cotizaciones/nueva/buscar-cliente-actions.ts) contra un cliente de SESIÓN
// simulado (auth.getUser + usuarios + rpc). Se verifica quién puede llamar a la RPC, con qué tenant,
// qué documento se acepta y qué sale hacia el navegador.
//
// Qué NO se ejecuta aquí: la RPC `buscar_personas_documento` en Postgres (no hay Docker en este equipo).
// Su comportamiento por rol/tenant/fuente lo ejecutan test_214_personas_identidad.sql y
// test_219_personas_cotizaciones.sql (sondas V1-V6) en GitHub Actions. Lo que sí se comprueba en este
// archivo, ESTÁTICAMENTE contra el texto de las migraciones, es que la definición de la RPC siga
// diciendo lo que esta acción supone (roles, tenant explícito, grants, unicidad por tenant+tipo+número).
import { test, describe, mock, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ROLES_CONSULTA_PERSONAS, ROLES_AMBOS_TENANTS } from "../lib/personas/fuentes.ts";

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://dummy.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "dummy-anon";

// ── Sesión simulada ──────────────────────────────────────────────────────────
type Perfil = { rol?: string | null; activo?: boolean | null; tenant?: string | null } | null;
type Escenario = {
  user: { id: string } | null;
  perfil: Perfil;
  errorPerfil: { message: string } | null;
  cookieTenant: string | undefined;
  rpcRespuesta: { data: unknown; error: { message: string } | null };
  rpcLanza: Error | null;
  createClientLanza: Error | null;
  rpcs: { nombre: string; args: Record<string, unknown> }[];
  consultasUsuarios: { columnas: string; filtros: [string, unknown][] }[];
  clientes: number;
};
const e: Escenario = {
  user: null, perfil: null, errorPerfil: null, cookieTenant: undefined,
  rpcRespuesta: { data: null, error: null }, rpcLanza: null, createClientLanza: null,
  rpcs: [], consultasUsuarios: [], clientes: 0,
};

function clienteSesion() {
  e.clientes++;
  return {
    auth: { getUser: async () => ({ data: { user: e.user }, error: null }) },
    from(tabla: string) {
      assert.equal(tabla, "usuarios", `la acción solo debe leer "usuarios" con la sesión, pidió "${tabla}"`);
      const consulta = { columnas: "", filtros: [] as [string, unknown][] };
      e.consultasUsuarios.push(consulta);
      const b = {
        select(columnas: string) { consulta.columnas = columnas; return b; },
        eq(col: string, val: unknown) { consulta.filtros.push([col, val]); return b; },
        maybeSingle: async () => ({ data: e.perfil, error: e.errorPerfil }),
      };
      return b;
    },
    rpc: async (nombre: string, args: Record<string, unknown>) => {
      e.rpcs.push({ nombre, args });
      if (e.rpcLanza) throw e.rpcLanza;
      return e.rpcRespuesta;
    },
  };
}

mock.module("@/lib/supabase/server", {
  namedExports: {
    createClient: async () => {
      if (e.createClientLanza) throw e.createClientLanza;
      return clienteSesion();
    },
  },
});
mock.module("next/headers", {
  namedExports: {
    cookies: async () => ({ get: (n: string) => (n === "tenant" && e.cookieTenant !== undefined ? { value: e.cookieTenant } : undefined) }),
  },
});

const { buscarClienteDocumento } = await import("../app/(dashboard)/dashboard/cotizaciones/nueva/buscar-cliente-actions.ts");

// ── Fixtures de la respuesta de la RPC (forma real, 214/219) ─────────────────
const PERSONA_ID = "9b2f1c3e-0000-4000-8000-00000000aaaa";
let seqCaptura = 0;
function obs(campo: string, valor: string, fuente = "captura_interna", extra: Record<string, unknown> = {}) {
  seqCaptura++;
  return {
    campo, valor, captura_id: `c0a7e000-0000-4000-8000-${String(seqCaptura).padStart(12, "0")}`, fuente,
    capturado_en: "2026-10-01T15:00:00+00:00", contrato_numero: null, actor_rol: "administracion",
    cotizacion_id: null, rol: null, activo: null, ...extra,
  };
}
function variante(campo: string, valores: [string, number][], omitidos = 0) {
  return {
    campo, n_valores: valores.length + omitidos, divergencia: valores.length + omitidos > 1,
    valores: valores.map(([valor, n]) => ({ valor, n_capturas: n })), valores_omitidos: omitidos,
  };
}
function respuesta(o: { observaciones: unknown[]; variantes: unknown[]; has_more?: boolean; total?: number; tenant?: string }) {
  return {
    persona: { id: PERSONA_ID, tenant: o.tenant ?? "mayorista", tipo_doc: "CC", numero_norm: "1020304050" },
    observaciones: o.observaciones, total: o.total ?? o.observaciones.length, has_more: o.has_more ?? false,
    divergencia: (o.variantes as { divergencia: boolean }[]).some((v) => v.divergencia), variantes: o.variantes,
  };
}
const VACIO = { persona: null, observaciones: [], total: 0, has_more: false, divergencia: false, variantes: [] };
const DOC = { tipoDoc: "CC", numeroDoc: "1.020.304.050" };

// ── Captura de salidas (ningún dato personal debe llegar a consola) ──────────
const salidas: string[] = [];
const consolaOriginal = { log: console.log, info: console.info, warn: console.warn, error: console.error, debug: console.debug };
beforeEach(() => {
  e.user = { id: "u-1" };
  e.perfil = { rol: "administracion", activo: true, tenant: "mayorista" };
  e.errorPerfil = null; e.cookieTenant = undefined;
  e.rpcRespuesta = { data: VACIO, error: null }; e.rpcLanza = null; e.createClientLanza = null;
  e.rpcs.length = 0; e.consultasUsuarios.length = 0; e.clientes = 0;
  salidas.length = 0;
  for (const k of Object.keys(consolaOriginal) as (keyof typeof consolaOriginal)[]) {
    console[k] = (...a: unknown[]) => { salidas.push(a.map(String).join(" ")); };
  }
});
afterEach(() => { Object.assign(console, consolaOriginal); });

const noAutorizado = (r: unknown) => assert.deepEqual(r, { ok: false, codigo: "no_autorizado", error: "No tienes permiso para buscar clientes por documento." });

describe("#40 acción — quién puede consultar (falla cerrado, sin tocar la RPC)", () => {
  test("anónimo (sin sesión): no autorizado y la RPC no se llama", async () => {
    e.user = null;
    noAutorizado(await buscarClienteDocumento(DOC));
    assert.equal(e.rpcs.length, 0);
  });

  test("sin fila en usuarios, o error al leerla: no autorizado", async () => {
    e.perfil = null;
    noAutorizado(await buscarClienteDocumento(DOC));
    e.perfil = { rol: "administracion", activo: true, tenant: "mayorista" };
    e.errorPerfil = { message: "boom" };
    noAutorizado(await buscarClienteDocumento(DOC));
    assert.equal(e.rpcs.length, 0);
  });

  for (const activo of [false, null, undefined] as const) {
    test(`usuario inactivo (activo=${String(activo)}), incluso superadmin: no autorizado`, async () => {
      e.perfil = { rol: "superadmin", activo, tenant: "mayorista" };
      noAutorizado(await buscarClienteDocumento(DOC));
      assert.equal(e.rpcs.length, 0);
    });
  }

  for (const rol of ["control_vuelo", "agencia", "freelance", "cliente_final", "publico", "", "Administracion", null] as const) {
    test(`rol ${JSON.stringify(rol)}: no autorizado`, async () => {
      e.perfil = { rol, activo: true, tenant: "mayorista" };
      noAutorizado(await buscarClienteDocumento(DOC));
      assert.equal(e.rpcs.length, 0);
    });
  }

  for (const tenant of [null, undefined, "", "otra"] as const) {
    test(`interno no superadmin con tenant ${JSON.stringify(tenant)}: no autorizado (no se rellena con mayorista)`, async () => {
      e.perfil = { rol: "venta", activo: true, tenant };
      noAutorizado(await buscarClienteDocumento(DOC));
      assert.equal(e.rpcs.length, 0);
    });
  }

  for (const rol of ROLES_CONSULTA_PERSONAS) {
    test(`${rol} activo: consulta con el cliente de sesión y su tenant explícito`, async () => {
      e.perfil = { rol, activo: true, tenant: "minorista" };
      e.cookieTenant = undefined;
      const r = await buscarClienteDocumento(DOC);
      assert.deepEqual(r, { ok: true, estado: "sin_registro" });
      assert.equal(e.rpcs.length, 1);
      assert.equal(e.rpcs[0].nombre, "buscar_personas_documento");
      // Para superadmin sin cookie válida rige el orden de TENANTS (mayorista); el resto, el suyo.
      assert.equal(e.rpcs[0].args.p_tenant, rol === "superadmin" ? "mayorista" : "minorista");
      assert.equal(e.rpcs[0].args.p_limite, 50);
      assert.equal(e.rpcs[0].args.p_offset, 0);
    });
  }

  test("el perfil se lee por el id de la SESIÓN (nunca por algo que mande el navegador)", async () => {
    e.user = { id: "u-sesion" };
    await buscarClienteDocumento({ ...DOC, id: "u-otro", rol: "superadmin" } as never);
    assert.deepEqual(e.consultasUsuarios[0].filtros, [["id", "u-sesion"]]);
    assert.match(e.consultasUsuarios[0].columnas, /rol/);
    assert.match(e.consultasUsuarios[0].columnas, /activo/);
    assert.match(e.consultasUsuarios[0].columnas, /tenant/);
  });
});

describe("#40 acción — tenant: solo el del servidor; cruzado y falsificado se ignoran", () => {
  test("venta de mayorista con cookie de minorista: consulta mayorista", async () => {
    e.perfil = { rol: "venta", activo: true, tenant: "mayorista" };
    e.cookieTenant = "minorista";
    await buscarClienteDocumento(DOC);
    assert.equal(e.rpcs[0].args.p_tenant, "mayorista");
  });

  test("gerencia de minorista con cookie de mayorista: consulta SU agencia (no alterna)", async () => {
    e.perfil = { rol: "gerencia", activo: true, tenant: "minorista" };
    e.cookieTenant = "mayorista";
    await buscarClienteDocumento(DOC);
    assert.equal(e.rpcs[0].args.p_tenant, "minorista");
  });

  test("superadmin: la agencia activa (cookie) viaja explícita; cookie inválida cae a mayorista", async () => {
    e.perfil = { rol: "superadmin", activo: true, tenant: "mayorista" };
    e.cookieTenant = "minorista";
    await buscarClienteDocumento(DOC);
    e.cookieTenant = "basura";
    await buscarClienteDocumento(DOC);
    assert.deepEqual(e.rpcs.map((c) => c.args.p_tenant), ["minorista", "mayorista"]);
  });

  test("un tenant mandado dentro de la entrada no tiene efecto", async () => {
    e.perfil = { rol: "venta", activo: true, tenant: "mayorista" };
    await buscarClienteDocumento({ ...DOC, tenant: "minorista", p_tenant: "minorista" } as never);
    assert.equal(e.rpcs[0].args.p_tenant, "mayorista");
  });

  test("p_tenant nunca es null (gerencia y superadmin lo exigen explícito en la RPC)", async () => {
    for (const rol of ["superadmin", "gerencia", "administracion", "operaciones", "venta"]) {
      e.perfil = { rol, activo: true, tenant: "mayorista" };
      await buscarClienteDocumento(DOC);
    }
    assert.ok(e.rpcs.length === 5 && e.rpcs.every((c) => c.args.p_tenant === "mayorista" || c.args.p_tenant === "minorista"));
  });
});

describe("#40 acción — documento completo antes de consultar", () => {
  const MSG = "Escribe un tipo y un número de documento completos y válidos. Para NIT, solo la base, sin dígito de verificación.";
  const invalidos: [string, unknown, unknown][] = [
    ["número vacío", "CC", ""],
    ["número en blanco", "CC", "   "],
    ["tipo vacío", "", "1020304050"],
    ["tipo fuera del catálogo", "CC2", "1020304050"],
    ["tipo con puntos", "C.C.", "1020304050"],
    ["número con guion", "CC", "1234-5"],
    ["número demasiado corto", "CC", "12"],
    ["NIT con dígito de verificación", "NIT", "900123456-7"],
    ["CC con letras", "CC", "12AB34"],
    ["más de 64 caracteres", "CC", "1".repeat(65)],
    ["carácter NUL", "CC", "1234\u0000"],
    ["número no string", "CC", 1020304050],
    ["tipo null", null, "1020304050"],
    ["número undefined", "CC", undefined],
  ];
  for (const [nombre, tipoDoc, numeroDoc] of invalidos) {
    test(`${nombre}: formato, sin consultar`, async () => {
      const r = await buscarClienteDocumento({ tipoDoc, numeroDoc } as never);
      assert.deepEqual(r, { ok: false, codigo: "formato", error: MSG });
      assert.equal(e.rpcs.length, 0);
    });
  }

  test("entrada que no es un objeto: formato, sin consultar", async () => {
    for (const x of [null, undefined, "CC", 7, []]) {
      assert.deepEqual(await buscarClienteDocumento(x as never), { ok: false, codigo: "formato", error: MSG });
    }
    assert.equal(e.rpcs.length, 0);
  });

  test("un no autorizado recibe el mismo rechazo aunque el documento sea inválido (no revela nada del formato)", async () => {
    e.perfil = { rol: "agencia", activo: true, tenant: "mayorista" };
    noAutorizado(await buscarClienteDocumento({ tipoDoc: "", numeroDoc: "" }));
  });

  test("documentos válidos viajan TAL COMO se escribieron (la RPC normaliza con la misma gramática)", async () => {
    for (const [tipoDoc, numeroDoc] of [["cc", "1.234.567"], [" CC ", " 1020304050 "], ["PAS", "ab 12.34"], ["NIT", "900123456"]]) {
      await buscarClienteDocumento({ tipoDoc, numeroDoc });
    }
    assert.deepEqual(e.rpcs.map((c) => [c.args.p_tipo_doc, c.args.p_numero]),
      [["cc", "1.234.567"], [" CC ", " 1020304050 "], ["PAS", "ab 12.34"], ["NIT", "900123456"]]);
  });

  test("mismo número con distinto tipo son consultas distintas (la clave incluye el tipo)", async () => {
    await buscarClienteDocumento({ tipoDoc: "CC", numeroDoc: "1020304050" });
    await buscarClienteDocumento({ tipoDoc: "CE", numeroDoc: "1020304050" });
    assert.deepEqual(e.rpcs.map((c) => c.args.p_tipo_doc), ["CC", "CE"]);
    assert.ok(e.rpcs.every((c) => c.args.p_numero === "1020304050"));
  });
});

describe("#40 acción — errores y fugas", () => {
  const GENERICO = "No se pudo consultar el documento. Intenta de nuevo o continúa llenando los datos a mano.";

  test("error de la RPC: mensaje genérico, sin el texto de la base ni el documento", async () => {
    e.rpcRespuesta = { data: null, error: { message: 'permission denied for table personas (documento 1020304050) 42501' } };
    const r = await buscarClienteDocumento(DOC);
    assert.deepEqual(r, { ok: false, codigo: "consulta", error: GENERICO });
    assert.ok(!JSON.stringify(r).includes("personas") && !JSON.stringify(r).includes("1020304050"));
  });

  test("la RPC (o la red) lanza: genérico y sin reenviar el error", async () => {
    e.rpcLanza = new Error("fetch failed: 1020304050 https://dummy.supabase.co/rest/v1/rpc/buscar_personas_documento");
    const r = await buscarClienteDocumento(DOC);
    assert.deepEqual(r, { ok: false, codigo: "consulta", error: GENERICO });
  });

  test("falla crear el cliente de sesión: genérico", async () => {
    e.createClientLanza = new Error("cookies() fuera de request");
    assert.deepEqual(await buscarClienteDocumento(DOC), { ok: false, codigo: "consulta", error: GENERICO });
  });

  test("respuesta mal formada de la RPC: genérico, sin lanzar", async () => {
    for (const data of [null, "x", 5, [], { persona: { id: "p" }, total: 2 }, { persona: { id: "p" }, total: 2, observaciones: [], variantes: "no" }]) {
      e.rpcRespuesta = { data, error: null };
      assert.deepEqual(await buscarClienteDocumento(DOC), { ok: false, codigo: "consulta", error: GENERICO }, JSON.stringify(data));
    }
  });

  test("formato_no_admitido de la RPC se traduce a formato", async () => {
    e.rpcRespuesta = { data: { ...VACIO, error: "formato_no_admitido" }, error: null };
    const r = await buscarClienteDocumento(DOC);
    assert.equal(r.ok, false);
    assert.equal((r as { codigo: string }).codigo, "formato");
  });

  test("ninguna rama escribe en consola (el documento y los datos no se registran)", async () => {
    e.rpcRespuesta = { data: respuesta({ observaciones: [obs("nombres", "Ana")], variantes: [variante("nombres", [["Ana", 1]])] }), error: null };
    await buscarClienteDocumento(DOC);
    e.rpcRespuesta = { data: null, error: { message: "boom 1020304050" } };
    await buscarClienteDocumento(DOC);
    e.rpcLanza = new Error("x 1020304050");
    await buscarClienteDocumento(DOC);
    e.perfil = { rol: "agencia", activo: true, tenant: "mayorista" };
    await buscarClienteDocumento(DOC);
    assert.deepEqual(salidas, []);
  });
});

describe("#40 acción — proyección hacia el navegador", () => {
  test("RPC vacía (no existe, sin permiso o nada autorizado): sin_registro", async () => {
    e.rpcRespuesta = { data: VACIO, error: null };
    assert.deepEqual(await buscarClienteDocumento(DOC), { ok: true, estado: "sin_registro" });
  });

  test("persona con total 0: sin_registro", async () => {
    e.rpcRespuesta = { data: { ...VACIO, persona: { id: PERSONA_ID } }, error: null };
    assert.deepEqual(await buscarClienteDocumento(DOC), { ok: true, estado: "sin_registro" });
  });

  test("una observación por campo: cinco campos aplicables, sin identificadores internos", async () => {
    const o = [
      obs("nombres", "Ana María"), obs("apellidos", "Pérez"), obs("telefono", "3001112233"),
      obs("email", "ana@correo.test"), obs("fecha_nacimiento", "1990-05-17"),
      obs("nacionalidad", "Colombia"), obs("nit_dv", "7"),
    ];
    e.rpcRespuesta = {
      data: respuesta({
        observaciones: o,
        variantes: [
          variante("nombres", [["Ana María", 1]]), variante("apellidos", [["Pérez", 1]]), variante("telefono", [["3001112233", 1]]),
          variante("email", [["ana@correo.test", 1]]), variante("fecha_nacimiento", [["1990-05-17", 1]]),
          variante("nacionalidad", [["Colombia", 1]]), variante("nit_dv", [["7", 1]]),
        ],
      }),
      error: null,
    };
    const r = await buscarClienteDocumento(DOC);
    assert.equal(r.ok, true);
    assert.equal((r as { estado: string }).estado, "encontrado");
    const campos = (r as { campos: { campo: string; valores: { valor: string }[] }[] }).campos;
    assert.deepEqual(campos.map((c) => c.campo), ["nombres", "apellidos", "telefono", "email", "fecha_nacimiento"]);
    assert.deepEqual(campos.map((c) => c.valores[0].valor), ["Ana María", "Pérez", "3001112233", "ana@correo.test", "1990-05-17"]);
    assert.equal((r as { incompleto: boolean }).incompleto, false);
    const texto = JSON.stringify(r);
    for (const prohibido of [PERSONA_ID, "c0a7e000", "captura_id", "actor_rol", "persona", "Colombia", "nit_dv", "numero_norm"]) {
      assert.ok(!texto.includes(prohibido), `no debe salir "${prohibido}"`);
    }
  });

  test("varias observaciones del mismo valor desde fuentes distintas: procedencia sin duplicados, la más reciente primero, máx. 3", async () => {
    const o = [
      obs("nombres", "Ana", "captura_interna", { capturado_en: "2026-01-10T10:00:00+00:00" }),
      obs("nombres", "Ana", "cotizacion", { capturado_en: "2026-10-05T10:00:00+00:00", cotizacion_id: 812 }),
      obs("nombres", "Ana", "cotizacion", { capturado_en: "2026-10-07T10:00:00+00:00", cotizacion_id: 812 }),
      obs("nombres", "Ana", "contrato_pasajero", { capturado_en: "2026-06-01T10:00:00+00:00", contrato_numero: "00-0451" }),
      obs("nombres", "Ana", "cotizacion", { capturado_en: "2026-03-01T10:00:00+00:00", cotizacion_id: 700 }),
    ];
    e.rpcRespuesta = { data: respuesta({ observaciones: o, variantes: [variante("nombres", [["Ana", 5]])] }), error: null };
    const r = await buscarClienteDocumento(DOC) as { campos: { valores: { nCapturas: number; procedencia: Record<string, unknown>[] }[] }[] };
    const v = r.campos[0].valores[0];
    assert.equal(v.nCapturas, 5);
    assert.equal(v.procedencia.length, 3, "se acota a 3");
    assert.deepEqual(v.procedencia.map((p) => [p.fuente, p.cotizacionId, p.contratoNumero]), [
      ["cotizacion", 812, null], ["contrato_pasajero", null, "00-0451"], ["cotizacion", 700, null],
    ]);
    assert.equal(v.procedencia[0].capturadoEn, "2026-10-07T10:00:00+00:00", "dentro de una misma procedencia queda la fecha más reciente");
  });

  test("divergencia: cada valor llega por separado y marcado; nada se fusiona", async () => {
    const o = [obs("nombres", "Ana"), obs("nombres", "Anna", "cotizacion", { cotizacion_id: 9 })];
    e.rpcRespuesta = { data: respuesta({ observaciones: o, variantes: [variante("nombres", [["Ana", 2], ["Anna", 1]])] }), error: null };
    const r = await buscarClienteDocumento(DOC) as { incompleto: boolean; campos: { campo: string; divergencia: boolean; valores: { valor: string; nCapturas: number }[] }[] };
    assert.equal(r.incompleto, false);
    assert.equal(r.campos.length, 1);
    assert.equal(r.campos[0].divergencia, true);
    assert.deepEqual(r.campos[0].valores.map((v) => [v.valor, v.nCapturas]), [["Ana", 2], ["Anna", 1]]);
  });

  test("truncamiento has_more: lectura incompleta", async () => {
    e.rpcRespuesta = { data: respuesta({ observaciones: [obs("nombres", "Ana")], variantes: [variante("nombres", [["Ana", 1]])], has_more: true, total: 80 }), error: null };
    const r = await buscarClienteDocumento(DOC) as { incompleto: boolean };
    assert.equal(r.incompleto, true);
    // La acción pidió la página máxima: 50 observaciones desde 0.
    assert.equal(e.rpcs[0].args.p_limite, 50);
  });

  test("valores_omitidos en un campo del formulario: lectura incompleta y se informa cuántos", async () => {
    e.rpcRespuesta = { data: respuesta({ observaciones: [obs("telefono", "300")], variantes: [variante("telefono", [["300", 1]], 4)] }), error: null };
    const r = await buscarClienteDocumento(DOC) as { incompleto: boolean; campos: { omitidos: number }[] };
    assert.equal(r.incompleto, true);
    assert.equal(r.campos[0].omitidos, 4);
  });

  test("solo campos que el formulario no recibe (nacionalidad, nit_dv): encontrado pero sin campos aplicables", async () => {
    e.rpcRespuesta = { data: respuesta({ observaciones: [obs("nacionalidad", "Perú")], variantes: [variante("nacionalidad", [["Perú", 1]])] }), error: null };
    assert.deepEqual(await buscarClienteDocumento(DOC), { ok: true, estado: "encontrado", incompleto: false, campos: [] });
  });

  test("fuentes de la 219 y visibilidad N2 se respetan tal cual: lo que la RPC no entrega a venta no aparece", async () => {
    // Para un `venta` la RPC entrega cotizacion_id solo de cotizaciones propias (V2.1) y null en el resto;
    // la acción no inventa ni completa nada.
    e.perfil = { rol: "venta", activo: true, tenant: "mayorista" };
    const o = [
      obs("nombres", "Ana", "cotizacion", { cotizacion_id: 55, actor_rol: null }),
      obs("apellidos", "Pérez", "cotizacion", { cotizacion_id: null, actor_rol: null }),
    ];
    e.rpcRespuesta = { data: respuesta({ observaciones: o, variantes: [variante("nombres", [["Ana", 1]]), variante("apellidos", [["Pérez", 1]])] }), error: null };
    const r = await buscarClienteDocumento(DOC) as { campos: { campo: string; valores: { procedencia: { cotizacionId: number | null; fuente: string }[] }[] }[] };
    assert.deepEqual(r.campos.map((c) => c.valores[0].procedencia[0].cotizacionId), [55, null]);
    assert.ok(r.campos.every((c) => c.valores[0].procedencia[0].fuente === "cotizacion"));
    assert.ok(!JSON.stringify(r).includes("actor"));
  });
});

// ── Cableado estático ─────────────────────────────────────────────────────────
const raiz = new URL("../", import.meta.url);
const leer = (ruta: string) => readFileSync(new URL(ruta, raiz), "utf8").replace(/\r\n/g, "\n");
const sinComentariosSql = (s: string) => s.split("\n").map((l) => l.replace(/--.*$/, "")).join("\n");
const sinComentariosTs = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((l) => l.replace(/(^|\s)\/\/.*$/, "$1")).join("\n");

describe("#40 acción — cableado de la acción y del formulario", () => {
  const rutaAccion = "app/(dashboard)/dashboard/cotizaciones/nueva/buscar-cliente-actions.ts";
  const rutaForm = "app/(dashboard)/dashboard/cotizaciones/nueva/CotizacionManualForm.tsx";
  const accion = sinComentariosTs(leer(rutaAccion));
  const form = sinComentariosTs(leer(rutaForm));

  test("la acción usa SOLO el cliente de sesión: ni service_role ni cliente admin", () => {
    assert.ok(!/supabase\/admin|createAdminClient|SERVICE_ROLE|service_role/i.test(accion));
    assert.match(accion, /from "@\/lib\/supabase\/server"/);
  });

  test("es un archivo 'use server' que solo exporta funciones async (y tipos)", () => {
    assert.match(leer(rutaAccion), /^"use server";/);
    const exportados = [...accion.matchAll(/^export (?!type\b)(async function|function|const|let|var|class|default)\b/gm)].map((m) => m[1]);
    assert.deepEqual(exportados, ["async function"]);
  });

  test("el tenant sale del perfil + cookie con la regla compartida, y los roles de la misma lista que la RPC", () => {
    assert.match(accion, /resolverTenantActivo\(/);
    assert.match(accion, /ROLES_CONSULTA_PERSONAS/);
    assert.match(accion, /perfil\.activo !== true/);
  });

  test("llama a la RPC solo por el envoltorio tipado de la 214/219, no con un rpc() propio", () => {
    assert.match(accion, /buscarPersonasDocumento\(sb,/);
    assert.ok(!/\.rpc\(/.test(accion));
  });

  test("el formulario no toca la base: solo la acción", () => {
    assert.match(form, /buscarClienteDocumento\(\{/);
    assert.ok(!/\.rpc\(|createClient|supabase/i.test(form.replace(/"@\/lib\/tenant"/g, "")));
  });

  test("el botón solo existe en cotización simple + canal interno", () => {
    assert.match(form, /const puedeBuscarCliente = !comparativa && tipoAsesor === "interno";/);
    assert.equal((form.match(/puedeBuscarCliente &&/g) ?? []).length, 3);
  });

  test("documento, canal y modo invalidan la consulta en el mismo evento", () => {
    for (const trozo of [
      /onChange=\{\(e\) => \{ invalidarBusqueda\(\); setCli\(\{ \.\.\.cli, tipoDoc:/,
      /onChange=\{\(e\) => \{ invalidarBusqueda\(\); setCli\(\{ \.\.\.cli, numeroDoc:/,
      /onClick=\{\(\) => \{ invalidarBusqueda\(\); setTipoAsesor\(t\); \}\}/,
      /onClick=\{\(\) => \{ invalidarBusqueda\(\); setComparativa\(/,
    ]) assert.match(form, trozo);
    assert.match(form, /return \(\) => \{ seq\.current \+= 1; \};/);
  });

  test("sin emojis en los archivos nuevos (convención: solo íconos lucide)", () => {
    const emoji = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}]/u;
    assert.ok(!emoji.test(leer(rutaAccion)));
    assert.ok(!emoji.test(leer(rutaForm)));
  });
});

describe("#40 RPC — lo que la acción supone, verificado contra el texto de las migraciones (NO ejecuta Postgres)", () => {
  const m219 = sinComentariosSql(leer("supabase/migrations/20260601000219_personas_cotizaciones.sql"));
  const m214 = sinComentariosSql(leer("supabase/migrations/20260601000214_personas_identidad.sql"));
  const ini = m219.indexOf("create or replace function public.buscar_personas_documento(");
  const fin = m219.indexOf("$$;", m219.indexOf("as $$", ini)) + 3;
  const rpc = m219.slice(ini, fin);

  test("la RPC vigente es la de la 219 y existe una sola definición en ella", () => {
    assert.ok(ini > 0 && fin > ini);
    assert.equal((m219.match(/create or replace function public\.buscar_personas_documento\(/g) ?? []).length, 1);
  });

  test("roles de consulta: exactamente los de ROLES_CONSULTA_PERSONAS (sin control_vuelo ni B2B) y solo usuarios activos", () => {
    const lista = rpc.match(/v_rol not in \(([^)]*)\)/);
    assert.ok(lista);
    assert.deepEqual(lista[1].split(",").map((s) => s.trim().replace(/^'|'$/g, "")), [...ROLES_CONSULTA_PERSONAS]);
    assert.match(rpc, /u\.id = v_uid and u\.activo is true/);
    assert.match(rpc, /if v_uid is null then\s+return c_vacio;/);
    for (const fuera of ["control_vuelo", "agencia", "freelance", "cliente_final"]) assert.ok(!rpc.includes(`'${fuera}'`), fuera);
  });

  test("superadmin/gerencia exigen p_tenant explícito; el resto solo el suyo", () => {
    assert.deepEqual([...ROLES_AMBOS_TENANTS], ["superadmin", "gerencia"]);
    assert.match(rpc, /if v_rol in \('superadmin', 'gerencia'\) then\s+if p_tenant is null or p_tenant not in \('mayorista', 'minorista'\) then\s+return c_vacio;\s+end if;\s+v_t_aut := p_tenant;/);
    assert.match(rpc, /if p_tenant is not null and p_tenant <> v_tenant_usuario then\s+return c_vacio;\s+end if;\s+v_t_aut := v_tenant_usuario;/);
  });

  test("candidata única por tenant autorizado + tipo + número normalizado; cada captura pasa por el filtro único", () => {
    assert.match(rpc, /where p\.tenant = v_t_aut and p\.estado_doc = 'documentada'\s+and p\.tipo_doc = v_norm\.tipo_doc and p\.numero_norm = v_norm\.numero_norm/);
    assert.match(rpc, /p214_priv\.captura_visible\(c\.id, c\.tenant, c\.fuente, c\.nivel, c\.contrato_numero, c\.cotizacion_id,\s+v_t_aut, v_rol, v_uid\)/);
    assert.match(m214, /create unique index (if not exists )?uq_personas_clave_documentada\s+on public\.personas \(tenant, tipo_doc, numero_norm\)\s+where estado_doc = 'documentada'/);
  });

  test("N2 (D-3): venta ve lo comercial de todo el tenant y lo restringido solo en cotizaciones propias; B2B nunca llega aquí", () => {
    const ini2 = m219.indexOf("create or replace function p214_priv.captura_visible(");
    const visible = m219.slice(ini2, m219.indexOf("$$;", m219.indexOf("as $$", ini2)));
    assert.match(visible, /when p_rol = 'venta' then p_nivel = 'comercial' or q\.creado_por_id = p_actor/);
    assert.match(visible, /when 'contrato_pasajero' then p_rol in \('superadmin', 'gerencia', 'administracion', 'operaciones', 'venta'\)/);
    assert.match(visible, /else false\s+end, false\)/);
    assert.match(rpc, /\(c\.fuente = 'cotizacion' and \(v_rol <> 'venta' or pq\.creado_por_id = v_uid\)\) as cotizacion_visible/);
    assert.match(rpc, /'actor_rol', case when v_rol = 'venta' then null else pg\.actor_rol end/);
  });

  test("paginación y variantes acotadas: el límite máximo de la RPC es el que pide la acción", () => {
    assert.match(rpc, /p_limite < 1 or p_limite > 50/);
    assert.match(rpc, /m\.rn <= 10/);
    assert.match(rpc, /greatest\(pc\.n_valores - 10, 0\)/);
  });

  test("grants: ejecutable solo por authenticated; anon y service_role revocados", () => {
    const firma = "public\\.buscar_personas_documento\\(text, text, text, integer, integer\\)";
    const revoke = m219.match(new RegExp(`revoke all on function ${firma}\\s+from ([^;]+);`));
    const grant = [...m219.matchAll(new RegExp(`grant execute on function ${firma} to ([^;]+);`, "g"))].map((x) => x[1].trim());
    assert.ok(revoke, "falta el REVOKE");
    for (const rol of ["public", "anon", "authenticated", "service_role"]) assert.match(revoke[1], new RegExp(`\\b${rol}\\b`));
    assert.deepEqual(grant, ["authenticated"]);
    assert.match(m219, /alter function public\.buscar_personas_documento\(text, text, text, integer, integer\) owner to current_user;/);
    assert.match(rpc, /security definer\s+set search_path = pg_catalog, pg_temp/);
  });

  test("las sondas SQL que ejecutan lo anterior existen en los scripts (corren en Actions, no aquí)", () => {
    const s219 = leer("supabase/scripts/test_219_personas_cotizaciones.sql");
    for (const sonda of ["'V2 venta (D-3=N2)", "'V3 B2B: la consulta global 214 sigue cerrada", "'V4 control_vuelo e inactivo", "'V5 gerencia sin p_tenant", "'V6 administración con p_tenant falsificado"]) {
      assert.ok(s219.includes(sonda), sonda);
    }
    const s214 = leer("supabase/scripts/test_214_personas_identidad.sql");
    for (const sonda of ["'A8 anon no ejecuta la consulta: 42501'", "'V3f venta minorista homónimo"]) assert.ok(s214.includes(sonda), sonda);
  });
});
