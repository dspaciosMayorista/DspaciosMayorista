// Pruebas focales de los cuatro bloqueos de auditoría de #82. Las reglas puras se ejecutan; el cableado se lee del código fuente
// (mismo patrón que las pruebas *.wiring.test.ts del repo) para fijar QUÉ camino toma cada acción.
import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const raiz = process.cwd();
const leer = (p: string) => readFileSync(join(raiz, p), "utf8").replace(/\r\n/g, "\n");
const sinComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("3. Reglas de publicación, vigencias, noches y vuelo (espejo de la base)", async () => {
  const { validarSolicitudDin, resolverCanalDin, contactoVisitanteValido } = await import("../lib/paqueteDinamico/solicitud.ts");
  const paq = { activo: true, publicado: true, noches: 3, usa_hotel: true, usa_vuelo: true, compra_inicio: "2026-11-01", compra_fin: "2026-12-31", viaje_inicio: "2027-01-01", viaje_fin: "2027-03-31" };
  const base = { paquete: paq, hoy: "2026-11-03", ida: "2027-01-10", regreso: "2027-01-13", hotelPerteneceAlPaquete: true, vueloEncontrado: { fecha_ida: "2027-01-10", fecha_regreso: "2027-01-13" }, hotelElegido: true, vueloElegido: true };

  test("solicitud válida", () => assert.deepEqual(validarSolicitudDin(base), { ok: true }));
  test("inactivo o sin publicar", () => {
    for (const p of [{ ...paq, activo: false }, { ...paq, publicado: false }]) {
      const r = validarSolicitudDin({ ...base, paquete: p });
      assert.ok(!r.ok && r.codigo === "NO_PUBLICADO");
    }
  });
  test("vigencia de compra: antes de abrir y después de cerrar", () => {
    for (const hoy of ["2026-10-31", "2027-01-01"]) {
      const r = validarSolicitudDin({ ...base, hoy });
      assert.ok(!r.ok && r.codigo === "COMPRA", hoy);
    }
  });
  test("noches, pasado y ventana de viaje", () => {
    for (const [ida, regreso] of [["2027-01-10", "2027-01-15"], ["2026-11-02", "2026-11-05"], ["2026-12-20", "2026-12-23"], ["2027-03-30", "2027-04-02"], ["2027-13-40", "2027-01-13"]]) {
      const r = validarSolicitudDin({ ...base, ida, regreso });
      assert.ok(!r.ok && r.codigo === "FECHAS", `${ida}→${regreso}`);
    }
  });
  test("fechas del vuelo distintas a las pedidas, vuelo ajeno y hotel ajeno", () => {
    let r = validarSolicitudDin({ ...base, vueloEncontrado: { fecha_ida: "2027-01-11", fecha_regreso: "2027-01-14" } });
    assert.ok(!r.ok && r.codigo === "VUELO");
    r = validarSolicitudDin({ ...base, vueloEncontrado: null });
    assert.ok(!r.ok && r.codigo === "VUELO");
    r = validarSolicitudDin({ ...base, hotelPerteneceAlPaquete: false });
    assert.ok(!r.ok && r.codigo === "HOTEL");
  });
  test("un vuelo manual sin fechas no bloquea las fechas pedidas", () => {
    assert.deepEqual(validarSolicitudDin({ ...base, vueloEncontrado: { fecha_ida: null, fecha_regreso: null } }), { ok: true });
  });

  test("canal: lo decide la sesión, nunca el navegador", () => {
    assert.deepEqual(resolverCanalDin("anonimo"), { ok: true, canal: "publico" });
    assert.deepEqual(resolverCanalDin(null), { ok: true, canal: "publico" });
    for (const rol of ["superadmin", "gerencia", "administracion", "operaciones", "venta"]) assert.deepEqual(resolverCanalDin({ rol, activo: true }), { ok: true, canal: "interno" });
    for (const rol of ["agencia", "freelance"]) assert.deepEqual(resolverCanalDin({ rol, activo: true }), { ok: true, canal: "b2b" });
    for (const s of [{ rol: "venta", activo: false }, { rol: null, activo: true }, { rol: "cliente_final", activo: true }, { rol: "control_vuelo", activo: true }]) assert.equal(resolverCanalDin(s).ok, false);
  });
  test("contacto del visitante", () => {
    const c = { nombres: "Ana", apellidos: "P", email: "ana@x.co", telefono: "" };
    assert.ok(contactoVisitanteValido(c));
    assert.ok(contactoVisitanteValido({ ...c, email: "", telefono: "300 123 4567" }));
    assert.ok(!contactoVisitanteValido({ ...c, email: "no-es-correo", telefono: "123" }));
    assert.ok(!contactoVisitanteValido({ ...c, nombres: "  " }));
  });
});

describe("2. Cotizar desde la pestaña pública: canales sin identidad interna ficticia", () => {
  const src = sinComentarios(leer("app/(dashboard)/dashboard/cotizaciones/din-actions.ts"));
  test("el canal se resuelve en el servidor y el visitante usa la RPC externa", () => {
    assert.match(src, /resolverCanalDin\(/);
    assert.match(src, /rpc\("crear_cotizacion_din_externa"/);
    assert.match(src, /p_canal:\s*canal/);
  });
  test("el visitante ya no recibe «Ingresa con tu usuario…»", () => {
    assert.doesNotMatch(src, /Ingresa con tu usuario para cotizar/);
  });
  test("ningún canal externo usa un id de usuario inventado: el actor B2B es el de la sesión y el visitante es null", () => {
    assert.match(src, /p_actor:\s*canal === "b2b" \? \(perfil\?\.id \?\? null\) : null/);
  });
  test("las reglas se validan en servidor con la fila viva (validarSolicitudDin) además de la base", () => {
    assert.match(src, /validarSolicitudDin\(/);
    assert.match(src, /\.from\("paquete_din" as never\)/);
  });
  test("al navegador solo vuelve id/enlace, nunca netas ni proveedores", () => {
    const retornos = [...src.matchAll(/return \{ ok: true, id: [^}]*\}/g)].map((m) => m[0]).join("\n");
    assert.doesNotMatch(retornos, /neto|proveedor|costo/i);
  });
  test("el checkout dinámico lleva a dashboard/portal solo cuando el servidor lo indica; el visitante recibe el enlace público", () => {
    const ui = leer("app/tarifario/checkout/dinamico/CheckoutDinamico.tsx");
    assert.match(ui, /destino === "dashboard"/);
    assert.match(ui, /enlace/);
    assert.doesNotMatch(ui, /\bneto\b|proveedor/);
    assert.doesNotMatch(leer("app/tarifario/PorDinamicos.tsx"), /\bneto\b|proveedor/);
  });
});

describe("1. Aislamiento por agencia en las acciones del paquete", () => {
  const src = sinComentarios(leer("app/(dashboard)/dashboard/paquetes/total/actions.ts"));
  test("el tenant sale de la sesión validada (contextoCotizacion), no del perfil crudo", () => {
    assert.match(src, /contextoCotizacion\(\)/);
  });
  test("publicar y eliminar verifican la agencia del paquete antes de actuar", () => {
    assert.match(src, /autorizaTenant\(/);
  });
});

describe("4. Hoteles vinculables y guardado atómico", () => {
  const cat = sinComentarios(leer("app/(dashboard)/dashboard/paquetes/total/catalogos.ts"));
  const act = sinComentarios(leer("app/(dashboard)/dashboard/paquetes/total/actions.ts"));
  test("el selector sale de la función de la base (fichas activas; el tarifario de la ficha no la excluye)", () => {
    assert.match(cat, /rpc\("hoteles_vinculables_din"/);
    assert.doesNotMatch(cat, /from\("hoteles"\)/);
  });
  test("guardar valida cada ficha con la base (no confía en el selector)", () => {
    assert.match(act, /rpc\("hotel_vinculable_din"/);
  });
  test("guardar es UNA llamada atómica: sin borrar/insertar hijos desde TypeScript", () => {
    assert.match(act, /rpc\("guardar_paquete_din"/);
    assert.doesNotMatch(act, /from\(t\)\.delete\(\)/);
    assert.doesNotMatch(act, /paquete_din_vuelos"\)\.delete|\.delete\(\)\.eq\("paquete_id"/);
    assert.doesNotMatch(act, /previos/);
  });
  test("validaciones de forma: el vuelo con fechas debe durar las noches del paquete", async () => {
    const { validarEntradaPaqueteTotal } = await import("../lib/paqueteDinamico/entrada.ts");
    const e = {
      nombre: "P", destinoId: 1, multidestino: false, destinosExtra: [], moneda: "COP" as const, esquema: "solo_pvp" as const, pvpModo: "por_componente" as const, pctMkPct: 0,
      usaVuelo: true, usaHotel: false, usaServicios: false, noches: 3, compraInicio: "", compraFin: "", viajeInicio: "", viajeFin: "", pvpGeneral: null, totalDeclarado: null,
      descripcion: "", incluye: "", noIncluye: "", hoteles: [], servicios: [],
      vuelos: [{ empaquetadoId: null, destinoId: null, aerolinea: "", ruta: "", origenIata: "BOG", destinoIata: "CTG", fechaIda: "2027-01-10", fechaRegreso: "2027-01-15", proveedor: "", neto: {}, pvp: {} }],
    };
    assert.ok(validarEntradaPaqueteTotal(e).some((m) => /noches/i.test(m)));
    e.vuelos[0].fechaRegreso = "2027-01-13";
    assert.ok(!validarEntradaPaqueteTotal(e).some((m) => /noches/i.test(m)));
  });
  test("el conteo de uso del destino usa la función para las tablas con RLS por agencia", () => {
    const t = sinComentarios(leer("app/(dashboard)/dashboard/tarifario/actions.ts"));
    assert.match(t, /rpc\("uso_destino_din"/);
  });
});
