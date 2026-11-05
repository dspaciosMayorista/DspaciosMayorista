// #82 — feedback de Preview (migración 276): multidestino explícito y del mismo país, ruta de vuelo derivada, proveedor de la ficha del servicio
// y venta que continúa al checkout habitual. Reglas puras + cableado de código (la base se prueba en supabase/scripts/test_276_*.sql).
import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const leer = (p: string) => readFileSync(join(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");
const sinComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("1. Multidestino explícito y del mismo país", async () => {
  const { validarMultidestino, paisComparable } = await import("../lib/paqueteDinamico/ruta.ts");
  const destinos = [{ id: 1, pais: "Colombia" }, { id: 2, pais: " COLOMBIA " }, { id: 3, pais: "México" }, { id: 4, pais: null }];

  test("el país se compara como la base (sin tildes, mayúsculas ni espacios de más)", () => {
    assert.equal(paisComparable("  Colombia "), paisComparable("COLOMBIA"));
    assert.equal(paisComparable("México"), paisComparable("MEXICO"));
    assert.equal(paisComparable("   "), null);
    assert.equal(paisComparable(null), null);
  });
  test("sin activar multidestino no se admiten destinos adicionales", () => {
    assert.equal(validarMultidestino({ multidestino: false, destinoId: 1, destinosExtra: [2], destinos }).length, 1);
    assert.deepEqual(validarMultidestino({ multidestino: false, destinoId: 1, destinosExtra: [], destinos }), []);
  });
  test("activado: solo destinos del mismo país que el principal", () => {
    assert.deepEqual(validarMultidestino({ multidestino: true, destinoId: 1, destinosExtra: [2], destinos }), []);
    assert.match(validarMultidestino({ multidestino: true, destinoId: 1, destinosExtra: [2, 3], destinos })[0], /mismo país/);
  });
  test("activado: principal sin país, principal repetido y principal ausente se rechazan", () => {
    assert.match(validarMultidestino({ multidestino: true, destinoId: 4, destinosExtra: [1], destinos })[0], /no tiene país/);
    assert.match(validarMultidestino({ multidestino: true, destinoId: 1, destinosExtra: [1], destinos })[0], /repetirse/);
    assert.match(validarMultidestino({ multidestino: true, destinoId: null, destinosExtra: [1], destinos })[0], /destino principal/);
  });
  test("la validación de forma del formulario aplica las mismas reglas", async () => {
    const { validarEntradaPaqueteTotal } = await import("../lib/paqueteDinamico/entrada.ts");
    const e = {
      nombre: "P", destinoId: 1, multidestino: false, destinosExtra: [3], moneda: "COP" as const, esquema: "solo_pvp" as const, pvpModo: "por_componente" as const, pctMkPct: 0,
      usaVuelo: false, usaHotel: true, usaServicios: false, noches: 3, compraInicio: "", compraFin: "", viajeInicio: "", viajeFin: "", pvpGeneral: null, totalDeclarado: null,
      descripcion: "", incluye: "", noIncluye: "", vuelos: [], hoteles: [], servicios: [],
    };
    assert.ok(validarEntradaPaqueteTotal(e, destinos).some((m) => /multidestino/i.test(m)));
    assert.ok(validarEntradaPaqueteTotal({ ...e, multidestino: true }, destinos).some((m) => /mismo país/.test(m)));
    assert.ok(!validarEntradaPaqueteTotal({ ...e, multidestino: true, destinosExtra: [2] }, destinos).some((m) => /país|multidestino/i.test(m)));
  });
  test("el montaje oculta y vacía los adicionales sin multidestino, y ofrece solo los del mismo país", () => {
    const f = sinComentarios(["PaqueteTotalForm.tsx", "VueloFilaDin.tsx", "ServicioFilaDin.tsx", "HotelFilaDin.tsx"].map((x) => leer("app/(dashboard)/dashboard/paquetes/total/" + x)).join(" "));
    assert.match(f, /Multidestino/);
    assert.match(f, /multidestino: false, destinosExtra: \[\]/);
    assert.match(f, /\{e\.multidestino \? \(/);
    assert.match(f, /paisComparable\(d\.pais\) === paisPrincipal/);
  });
});

describe("2. La ruta del vuelo no es texto libre", async () => {
  const { derivarRutaManual, normalizarIata } = await import("../lib/paqueteDinamico/ruta.ts");
  test("ruta manual derivada de origen y destino (ida y vuelta o solo ida)", () => {
    assert.equal(derivarRutaManual("bog ", "ctg", true), "BOG - CTG - BOG");
    assert.equal(derivarRutaManual("BOG", "CTG", false), "BOG - CTG");
  });
  test("se rechaza IATA inválido, vacío o origen = destino", () => {
    assert.equal(derivarRutaManual("BOGOTA", "CTG", true), null);
    assert.equal(derivarRutaManual("", "CTG", true), null);
    assert.equal(derivarRutaManual("CTG", "ctg", true), null);
    assert.equal(normalizarIata("b1g"), "");
  });
  test("un vuelo manual sin origen/destino no pasa la validación de forma; uno vinculado no los necesita", async () => {
    const { validarEntradaPaqueteTotal } = await import("../lib/paqueteDinamico/entrada.ts");
    const base = {
      nombre: "P", destinoId: 1, multidestino: false, destinosExtra: [], moneda: "COP" as const, esquema: "solo_pvp" as const, pvpModo: "por_componente" as const, pctMkPct: 0,
      usaVuelo: true, usaHotel: false, usaServicios: false, noches: 3, compraInicio: "", compraFin: "", viajeInicio: "", viajeFin: "", pvpGeneral: null, totalDeclarado: null,
      descripcion: "", incluye: "", noIncluye: "", hoteles: [], servicios: [],
    };
    const v = { empaquetadoId: null, destinoId: null, aerolinea: "", ruta: "TEXTO LIBRE", origenIata: "", destinoIata: "", fechaIda: "", fechaRegreso: "", proveedor: "", neto: {}, pvp: {} };
    assert.ok(validarEntradaPaqueteTotal({ ...base, vuelos: [v] }).some((m) => /IATA/.test(m)));
    assert.ok(!validarEntradaPaqueteTotal({ ...base, vuelos: [{ ...v, origenIata: "BOG", destinoIata: "CTG" }] }).some((m) => /IATA/.test(m)));
    assert.ok(!validarEntradaPaqueteTotal({ ...base, vuelos: [{ ...v, empaquetadoId: 5, ruta: "MDE - CTG - MDE" }] }).some((m) => /IATA/.test(m)));
  });
  test("el formulario ya no tiene un campo de ruta editable; el servidor recalcula la ruta de cada vuelo", () => {
    const f = sinComentarios(["PaqueteTotalForm.tsx", "VueloFilaDin.tsx", "ServicioFilaDin.tsx", "HotelFilaDin.tsx"].map((x) => leer("app/(dashboard)/dashboard/paquetes/total/" + x)).join(" "));
    assert.doesNotMatch(f, /upd\("vuelos", i, \{ ruta:/);
    assert.match(f, /aria-label="Ruta" readOnly/);
    const a = sinComentarios(leer("app/(dashboard)/dashboard/paquetes/total/actions.ts"));
    assert.match(a, /derivarRutaManual\(v\.origenIata, destinoIata/);
    assert.match(a, /from\("empaquetados"\)\.select\("id, ruta, origen, destino_id"\)/);
  });
});

describe("3. Servicios vinculados: proveedor de la ficha", async () => {
  const { serviciosSinProveedor, mensajeSinProveedor } = await import("../lib/paqueteDinamico/ruta.ts");
  test("solo los vinculados sin proveedor en su ficha bloquean; el manual lleva su propio proveedor", () => {
    const s = [{ servicioId: 1, nombre: "Tour A", proveedorId: 9 }, { servicioId: 2, nombre: "Tour B", proveedorId: null }, { servicioId: null, nombre: "Manual", proveedorId: null }];
    assert.deepEqual(serviciosSinProveedor(s), ["Tour B"]);
    assert.match(mensajeSinProveedor(["Tour B"]), /Tour B.*no tiene proveedor.*Producto > Servicios/);
  });
  test("el servidor toma proveedor y moneda de servicios_adicionales, avisa al guardar y bloquea al publicar", () => {
    const a = sinComentarios(leer("app/(dashboard)/dashboard/paquetes/total/actions.ts"));
    assert.match(a, /from\("servicios_adicionales"\)\.select\("id, moneda, proveedor_id, destino_id"\)/);
    assert.match(a, /proveedorId: f\.proveedor_id, proveedor: f\.proveedor \?\? ""/);
    assert.match(a, /comp\.avisos/);
    assert.match(a, /No se puede publicar: \$\{mensajeSinProveedor\(faltan\)\}/);
  });
  test("el formulario muestra el proveedor de la ficha de solo lectura y qué falta", () => {
    const f = sinComentarios(["PaqueteTotalForm.tsx", "VueloFilaDin.tsx", "ServicioFilaDin.tsx", "HotelFilaDin.tsx"].map((x) => leer("app/(dashboard)/dashboard/paquetes/total/" + x)).join(" "));
    assert.match(f, /aria-label="Proveedor de la ficha" readOnly/);
    assert.match(f, /s\.proveedorId == null && .*mensajeSinProveedor\(\[s\.nombre\]\)/);
  });
  test("moneda: los servicios deben coincidir con la moneda del paquete; la moneda de la ficha del hotel NO oculta ni rechaza el hotel", () => {
    const f = sinComentarios(["PaqueteTotalForm.tsx", "VueloFilaDin.tsx", "ServicioFilaDin.tsx", "HotelFilaDin.tsx"].map((x) => leer("app/(dashboard)/dashboard/paquetes/total/" + x)).join(" "));
    assert.doesNotMatch(f, /\(h\.moneda \?\? "COP"\) === e\.moneda/);
    assert.match(f, /s\.moneda === e\.moneda/);
    const a = sinComentarios(leer("app/(dashboard)/dashboard/paquetes/total/actions.ts"));
    assert.doesNotMatch(a, /El hotel «.*» está en/);
    assert.doesNotMatch(a, /from\("hoteles"\)\.select\("id, moneda"\)/);
  });
});

describe("4. Venta: la tarjeta elige y el checkout habitual captura al cliente", () => {
  test("la tarjeta no tiene formulario de identidad ni crea la cotización", () => {
    const ui = sinComentarios(leer("app/tarifario/PorDinamicos.tsx"));
    for (const campo of ["nombres", "apellidos", "numeroDoc", "tipoDoc", "telefono", "email", "nacimiento"]) assert.doesNotMatch(ui, new RegExp(campo), `la tarjeta no debe pedir ${campo}`);
    assert.doesNotMatch(ui, /crearCotizacionDin|din-actions|contactoVisitanteValido/);
    assert.match(ui, /router\.push\(`\/tarifario\/checkout\/dinamico\?/);
  });
  test("el checkout dinámico reutiliza BuscarTitular (búsqueda por documento) en sesión interna y resuelve el canal en el servidor", () => {
    const c = sinComentarios(leer("app/tarifario/checkout/dinamico/CheckoutDinamico.tsx"));
    assert.match(c, /import \{ BuscarTitular \} from "@\/components\/personas\/BuscarTitular"/);
    assert.match(c, /<BuscarTitular numero=\{c\.numeroDoc\}/);
    assert.match(c, /interno \? \(/);
    assert.doesNotMatch(c, /crear\(\{[^}]*canal/); // el navegador no manda el canal
    const p = sinComentarios(leer("app/tarifario/checkout/dinamico/page.tsx"));
    assert.match(p, /resolverCanalDin\(sesion\)/);
    assert.match(p, /cargarDinamicosPublicados\(\)/);
    assert.match(p, /evaluarSeleccionDin\(\{ paqueteId: p\.id/);
  });
  test("la acción sigue resolviendo el canal por la sesión y ya no recibe canal del navegador", () => {
    const a = sinComentarios(leer("app/(dashboard)/dashboard/cotizaciones/din-actions.ts"));
    assert.match(a, /resolverCanalDin\(sesion \? \{ rol: sesion\.rol, activo: true \} : "anonimo"\)/);
    assert.doesNotMatch(a, /input\.canal/);
  });
});

describe("5. La migración 276 es nueva y no toca la 274/275", () => {
  const m = leer("supabase/migrations/20260601000276_paquete_dinamico_multidestino_ruta_proveedor.sql");
  test("define las reglas en la base (escrituras directas incluidas)", () => {
    for (const t of ["trg_din_paquete_reglas", "trg_din_vuelo_reglas", "trg_din_servicio_reglas", "trg_din_hotel_moneda", "trg_din_publicar"]) assert.match(m, new RegExp(t));
    for (const c of ["DIN_82_MULTIDESTINO", "DIN_82_PAIS", "DIN_82_RUTA", "DIN_82_PROVEEDOR", "DIN_82_MONEDA"]) assert.match(m, new RegExp(c));
    assert.match(m, /pais_comparable_67/);
  });
  test("preflight y postcheck son UNA consulta cada uno", () => {
    for (const f of ["preflight", "postcheck"]) {
      const s = sinComentarios(leer(`supabase/scripts/${f}_276_paquete_dinamico_multidestino_ruta_proveedor.sql`)).replace(/'[^']*'/g, "''");
      assert.equal((s.match(/;/g) ?? []).length, 1, `${f}: una sola sentencia`);
      assert.match(s, /veredicto/);
    }
  });
});
