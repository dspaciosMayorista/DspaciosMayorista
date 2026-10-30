// #40 E2 — lógica pura, acción de servidor (identidad número+tipo, tenant, permisos) y cableado de superficies.
import { test, describe, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import nodeModule from "node:module";
import { TIPOS_DOC_PERSONA } from "../lib/personas/identidad.ts";
import { ETIQUETA_TIPO_DOC, TIPOS_DOC_PASAJERO, documentoClienteAdmitido, documentoPasajeroDesdeCliente, tipoDocumentoCliente } from "../lib/personas/tiposDocumento.ts";
import { candidatoDeRespuesta, planAplicacion, nombreUnido } from "../lib/personas/titularBusqueda.ts";

const leer = (r: string) => readFileSync(new URL(r, import.meta.url), "utf8");

describe("lógica pura", () => {
  const resp = (tipo: string, variantes: unknown[] = [], extra = {}) => ({
    persona: { id: "p", tenant: "mayorista", tipo_doc: tipo, numero_norm: "123456" }, observaciones: [], total: 1, has_more: false, divergencia: false, variantes, ...extra,
  });
  test("candidato toma el valor más frecuente y mapea fecha_nacimiento", () => {
    const c = candidatoDeRespuesta(resp("CC", [
      { campo: "nombres", n_valores: 2, divergencia: true, valores: [{ valor: "Ana", n_capturas: 3 }, { valor: "Anna", n_capturas: 1 }], valores_omitidos: 0 },
      { campo: "fecha_nacimiento", n_valores: 1, divergencia: false, valores: [{ valor: "1990-01-02", n_capturas: 1 }], valores_omitidos: 0 },
    ]) as never);
    assert.equal(c?.datos.nombres, "Ana");
    assert.equal(c?.datos.nacimiento, "1990-01-02");
  });
  test("persona null, error o vacío ⇒ sin candidato", () => {
    assert.equal(candidatoDeRespuesta({ persona: null } as never), null);
    assert.equal(candidatoDeRespuesta(resp("CC", [], { error: "formato_no_admitido" }) as never), null);
    assert.equal(candidatoDeRespuesta(null), null);
  });
  test("plan: vacíos se llenan, escritos distintos son conflicto, iguales (sin mayúsculas) no", () => {
    const p = planAplicacion({ nombres: "Luis", apellidos: "pérez", telefono: "" }, { nombres: "Ana", apellidos: "Pérez", telefono: "300", email: "a@b.co" });
    assert.deepEqual(p.llenar, { telefono: "300", email: "a@b.co" });
    assert.deepEqual(p.conflictos, [{ campo: "nombres", actual: "Luis", nuevo: "Ana" }]);
  });
  test("plan respeta los campos que el formulario tiene", () => {
    assert.deepEqual(planAplicacion({}, { nombres: "A", nacimiento: "1990-01-01" }, ["nombres"]).llenar, { nombres: "A" });
  });
  test("nombreUnido junta nombres y apellidos", () => {
    assert.deepEqual(nombreUnido({ nombres: "Ana", apellidos: "Pérez", telefono: "1" }), { nombres: "Ana Pérez", telefono: "1" });
  });
});

describe("acción buscarTitularPorNumero", () => {
  const { registerHooks } = nodeModule as unknown as { registerHooks: (h: { resolve: (s: string, c: unknown, n: (s: string, c: unknown) => unknown) => unknown }) => void };
  registerHooks({ resolve(s, c, n) { return s === "server-only" ? { url: "data:text/javascript,export{}", shortCircuit: true } : n(s, c); } });
  type Llamada = { fn: string; args: Record<string, unknown> };
  const llamadas: Llamada[] = [];
  let usuario: { id: string } | null = { id: "u1" };
  let rol = "venta";
  let respuestas: Record<string, unknown> = {};
  let rpcFalla = false;
  let fallaSoloTipo: string | null = null;
  const sb = {
    auth: { getUser: async () => ({ data: { user: usuario } }) },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { rol } }) }) }) }),
    rpc: async (fn: string, args: Record<string, unknown>) => {
      llamadas.push({ fn, args });
      if (fallaSoloTipo === args.p_tipo_doc) return { data: null, error: { message: "boom" } };
      if (rpcFalla) return { data: null, error: { message: "boom" } };
      return { data: respuestas[String(args.p_tipo_doc)] ?? { persona: null }, error: null };
    },
  };
  mock.module("@/lib/supabase/server", { namedExports: { createClient: async () => sb } });
  mock.module("@/lib/tenant.server", { namedExports: { getTenant: async () => "minorista" } });
  const persona = (tipo: string) => ({ persona: { id: tipo, tenant: "mayorista", tipo_doc: tipo, numero_norm: "123456" }, observaciones: [], total: 1, has_more: false, divergencia: false, variantes: [] });
  const cargar = () => import("../lib/personas/buscarTitular.ts");
  const reset = () => { llamadas.length = 0; usuario = { id: "u1" }; rol = "venta"; respuestas = {}; rpcFalla = false; fallaSoloTipo = null; };

  test("número compartido entre tipos devuelve un candidato por tipo y consulta con la sesión", async () => {
    reset(); respuestas = { CC: persona("CC"), CE: persona("CE") };
    const { buscarTitularPorNumero } = await cargar();
    const r = await buscarTitularPorNumero(" 123456 ");
    assert.ok(r.ok && r.candidatos.map((c) => c.tipoDoc).sort().join() === "CC,CE");
    assert.equal(llamadas.length, 7);
    assert.ok(llamadas.every((l) => l.fn === "buscar_personas_documento" && l.args.p_numero === "123456"));
  });
  test("venta no manda tenant; gerencia manda el tenant activo", async () => {
    reset(); const { buscarTitularPorNumero } = await cargar();
    await buscarTitularPorNumero("123456");
    assert.equal(llamadas[0].args.p_tenant, null);
    reset(); rol = "gerencia"; await buscarTitularPorNumero("123456");
    assert.equal(llamadas[0].args.p_tenant, "minorista");
  });
  test("sin coincidencias, sin sesión, error de la base y número vacío", async () => {
    reset(); const { buscarTitularPorNumero } = await cargar();
    assert.deepEqual(await buscarTitularPorNumero("123456"), { ok: true, candidatos: [] });
    usuario = null; assert.equal((await buscarTitularPorNumero("123456")).ok, false);
    reset(); rpcFalla = true; assert.equal((await buscarTitularPorNumero("123456")).ok, false);
    reset(); assert.deepEqual(await buscarTitularPorNumero("  "), { ok: true, candidatos: [] }); assert.equal(llamadas.length, 0);
  });
  test("falla de UN solo tipo = búsqueda incompleta: no se devuelven candidatos parciales ni «sin coincidencias»", async () => {
    reset(); respuestas = { CC: persona("CC") }; fallaSoloTipo = "CE";
    const { buscarTitularPorNumero } = await cargar();
    const r = await buscarTitularPorNumero("123456");
    assert.equal(r.ok, false);
    assert.match(r.ok ? "" : r.error, /incompleta/);
  });
  test("RPC vacía por permiso (p.ej. rol B2B) es indistinguible de no existir", async () => {
    reset(); rol = "agencia"; const { buscarTitularPorNumero } = await cargar();
    assert.deepEqual(await buscarTitularPorNumero("123456"), { ok: true, candidatos: [] });
  });
});

describe("tipos de documento", () => {
  test("PAS se muestra como Pasaporte y todos los tipos del catálogo tienen etiqueta", () => {
    assert.equal(ETIQUETA_TIPO_DOC.PAS, "Pasaporte");
    for (const t of TIPOS_DOC_PERSONA) assert.ok(ETIQUETA_TIPO_DOC[t]);
  });
  test("tipoDocumentoCliente acepta los 7 tipos, vacío = sin tipo, sin número = sin tipo, fuera de catálogo = error", () => {
    for (const t of TIPOS_DOC_PERSONA) assert.deepEqual(tipoDocumentoCliente(t, "123456"), { ok: true, tipo: t });
    assert.deepEqual(tipoDocumentoCliente("", "123"), { ok: true, tipo: null });
    assert.deepEqual(tipoDocumentoCliente("CE", "  "), { ok: true, tipo: null });
    assert.equal(tipoDocumentoCliente("PASAPORTE", "1").ok, false);
  });
  test("documentoClienteAdmitido: PAS y PPT admiten letras; CC, CE, TI, RC y NIT solo dígitos", () => {
    for (const t of ["PAS", "PPT"]) assert.equal(documentoClienteAdmitido(t, "AB123"), true);
    for (const t of ["CC", "CE", "TI", "RC", "NIT"]) { assert.equal(documentoClienteAdmitido(t, "AB123"), false); assert.equal(documentoClienteAdmitido(t, "123"), true); }
  });
});

describe("pasajeros: solo lo que la reserva admite", () => {
  test("el selector de pasajero no ofrece PPT ni NIT; al copiar un cliente PPT/NIT el documento queda por capturar", () => {
    assert.deepEqual([...TIPOS_DOC_PASAJERO], ["CC", "CE", "TI", "RC", "PAS"]);
    assert.deepEqual(documentoPasajeroDesdeCliente("PAS", "AB1"), { tipoDoc: "PAS", numeroDoc: "AB1" });
    assert.deepEqual(documentoPasajeroDesdeCliente("PPT", "AB1"), { tipoDoc: "CC", numeroDoc: "" });
    assert.deepEqual(documentoPasajeroDesdeCliente("NIT", "9001"), { tipoDoc: "CC", numeroDoc: "" });
  });
  test("los 4 selects de pasajero usan la lista de pasajero y las copias pasan por documentoPasajeroDesdeCliente", () => {
    const D = "../app/(dashboard)/dashboard/";
    for (const f of ["reservar/nuevo/ReservaForm.tsx", "reservar/programa/[id]/ProgramaReservaForm.tsx", "cotizaciones/[id]/CotizacionAcciones.tsx", "cotizaciones/[id]/ConvertirCarritoBtn.tsx"]) assert.ok(leer(D + f).includes("<OpcionesTipoDoc pasajero />"), f);
    // PR #409: las dos reservas copian a UN solo pasajero por `aplicarCopiaTitular`, que a su vez usa documentoPasajeroDesdeCliente.
    for (const f of ["reservar/nuevo/ReservaForm.tsx", "reservar/programa/[id]/ProgramaReservaForm.tsx"]) assert.ok(leer(D + f).includes("aplicarCopiaTitular("), f);
    assert.ok(leer("../lib/personas/copiaTitular.ts").includes("documentoPasajeroDesdeCliente("), "copiaTitular.ts");
    assert.ok(leer(D + "cotizaciones/[id]/CotizacionAcciones.tsx").includes("documentoPasajeroDesdeCliente("), "CotizacionAcciones.tsx");
  });
});

describe("cableado", () => {
  const D = "../app/(dashboard)/dashboard/";
  const internas = [D + "cotizaciones/nueva/CotizacionManualForm.tsx", D + "cotizaciones/[id]/TitularEditor.tsx", D + "contratos/NuevoContratoForm.tsx", D + "contratos/[numero]/EditarVentaForm.tsx", D + "reservar/nuevo/ReservaForm.tsx", D + "reservar/programa/[id]/ProgramaReservaForm.tsx"];
  test("las seis superficies internas usan BuscarTitular", () => {
    for (const f of internas) assert.match(leer(f), /<BuscarTitular/, f);
  });
  test("checkout solo para personal interno (no B2C público ni aliado)", () => {
    const src = leer("../app/tarifario/checkout/page.tsx");
    const interna = src.indexOf("{asist?.puede === true && !esB2B ? (");
    const publica = src.indexOf(") : (", interna);
    assert.ok(interna > 0 && publica > interna, "rama interna / pública");
    assert.equal((src.match(/<BuscarTitular/g) ?? []).length, 1, "una sola búsqueda en el checkout");
    assert.ok(src.indexOf("<BuscarTitular") > interna && src.indexOf("<BuscarTitular") < publica, "la búsqueda vive solo en la rama interna; el B2C público y el aliado conservan su formulario");
  });
  test("edición de contrato NETO no busca (cliente = aliado)", () => {
    assert.match(leer(D + "contratos/[numero]/EditarVentaForm.tsx"), /!modalidadNeto && \(\s*<BuscarTitular/);
  });
  test("todos los selects de tipo de documento del cliente usan el catálogo completo (sin PASAPORTE como valor)", () => {
    for (const f of [...internas, D + "cotizaciones/[id]/CotizacionAcciones.tsx", D + "cotizaciones/[id]/ConvertirCarritoBtn.tsx"]) {
      const src = leer(f);
      assert.ok(!src.includes("<option>PASAPORTE</option>"), f);
      assert.ok(src.includes("<OpcionesTipoDoc"), f);
    }
    assert.match(leer(D + "contratos/NuevoContratoForm.tsx"), /clienteTipoDocumento: tipoDoc/);
    assert.match(leer(D + "contratos/NuevoContratoForm.tsx"), /setTipoDoc\(d\.tipoDoc\)/);
    assert.match(leer(D + "contratos/[numero]/EditarVentaForm.tsx"), /clienteTipoDocumento: d\.tipoDoc/);
  });
  test("no usa crm_contactos ni la tabla personas directamente", () => {
    for (const f of ["../lib/personas/buscarTitular.ts", "../components/personas/BuscarTitular.tsx", "../lib/personas/titularBusqueda.ts"]) assert.doesNotMatch(leer(f), /from\("(crm_contactos|personas)"\)/);
  });
});
