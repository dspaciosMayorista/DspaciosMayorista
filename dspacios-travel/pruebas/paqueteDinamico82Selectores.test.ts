// #82 — selectores del montaje: ficha de hotel con búsqueda, códigos IATA del vuelo manual y destino del vuelo según Multidestino. No toca precios ni cálculo.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const leer = (p: string) => readFileSync(join(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");
const sinComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\s\/\/ .*$/gm, "");
const { resolverIata, buscarIata, erroresIataVuelo, seguirDestinoPrincipal, ajenosAlPrincipal, OPCIONES_IATA } = await import("../lib/paqueteDinamico/ruta.ts");
const { validarEntradaPaqueteTotal } = await import("../lib/paqueteDinamico/entrada.ts");

test("resolverIata: código de 3 letras (esté o no en el catálogo), «Ciudad (COD)» o ciudad exacta; nunca adivina", () => {
  assert.equal(resolverIata("ctg"), "CTG");
  assert.equal(resolverIata(" Cartagena (CTG) "), "CTG");
  assert.equal(resolverIata("Cartagena"), "CTG");
  assert.equal(resolverIata("bogotá"), "BOG");
  assert.equal(resolverIata("Santa Marta"), "SMR", "el código de 4 letras SMTA no cuenta como código válido");
  assert.equal(resolverIata("xyz"), "XYZ", "código válido que no está en el catálogo");
  for (const malo of ["", "  ", "ab", "abcd", "12a", "Cart", "C-G", "ñññ"]) assert.equal(resolverIata(malo), "", `«${malo}» no es un código`);
});

test("buscarIata: por código (prefijo) o por ciudad (sin tildes ni mayúsculas); vacío = todo el catálogo", () => {
  assert.equal(buscarIata("").length, OPCIONES_IATA.length);
  assert.ok(OPCIONES_IATA.every((o) => /^[A-Z]{3}$/.test(o.codigo)));
  assert.deepEqual(buscarIata("mbj").map((o) => o.codigo), ["MBJ"]);
  assert.deepEqual(buscarIata("montego").map((o) => o.codigo), ["MBJ"]);
  assert.ok(buscarIata("cart").some((o) => o.codigo === "CTG"));
  assert.ok(buscarIata("MEDELLIN").some((o) => o.codigo === "MDE"));
  assert.deepEqual(buscarIata("zzzz"), []);
  assert.equal(buscarIata("mbj")[0].etiqueta, "Montego Bay (MBJ)");
});

test("erroresIataVuelo: faltan, inválidos o iguales", () => {
  assert.deepEqual(erroresIataVuelo("bog", "ctg"), []);
  assert.match(erroresIataVuelo("", "ctg")[0], /origen/);
  assert.match(erroresIataVuelo("bog", "ct")[0], /destino/);
  assert.match(erroresIataVuelo("bog", "BOG")[0], /distintos/);
  assert.equal(erroresIataVuelo("", "").length, 2);
});

const hotelMan = { hotelId: null, nombre: "H", categoria: "", regimen: "", descripcion: "", fotoUrl: "", proveedor: "", estrellas: null, ubicacion: "", neto: {}, pvp: {}, pvpGeneral: null, capacidadNinos: 2, edadInfanteMax: 2, edadNinoMax: 10 };
const vuelo = (o: Record<string, unknown> = {}) => ({ empaquetadoId: null, destinoId: 1, aerolinea: "", ruta: "", origenIata: "BOG", destinoIata: "CTG", fechaIda: "", fechaRegreso: "", proveedor: "", neto: {}, pvp: {}, ...o });
const entrada = (o: Record<string, unknown> = {}) => ({
  nombre: "P", destinoId: 1, multidestino: false, destinosExtra: [], moneda: "COP", esquema: "neta_markup", pvpModo: null, pctMkPct: 20, usaVuelo: true, usaHotel: false, usaServicios: false, noches: 3,
  compraInicio: "", compraFin: "", viajeInicio: "", viajeFin: "", pvpGeneral: null, totalDeclarado: null, descripcion: "", incluye: "", noIncluye: "", vuelos: [vuelo()], hoteles: [hotelMan], servicios: [], ...o,
}) as Parameters<typeof validarEntradaPaqueteTotal>[0];
const destinos = [{ id: 1, pais: "Colombia" }, { id: 2, pais: "Colombia" }, { id: 3, pais: "Colombia" }];

test("el servidor valida los códigos del vuelo manual y los mensajes dicen cuál campo falla", () => {
  assert.deepEqual(validarEntradaPaqueteTotal(entrada(), destinos), []);
  assert.match(validarEntradaPaqueteTotal(entrada({ vuelos: [vuelo({ origenIata: "bo" })] }), destinos)[0], /origen como código IATA/);
  assert.match(validarEntradaPaqueteTotal(entrada({ vuelos: [vuelo({ destinoIata: "" })] }), destinos)[0], /destino como código IATA/);
  assert.match(validarEntradaPaqueteTotal(entrada({ vuelos: [vuelo({ origenIata: "ctg", destinoIata: "CTG" })] }), destinos)[0], /distintos/);
  assert.deepEqual(validarEntradaPaqueteTotal(entrada({ vuelos: [vuelo({ origenIata: " bog ", destinoIata: "xyz" })] }), destinos), [], "código válido fuera del catálogo y con espacios");
});

test("Multidestino desactivado: un vuelo de otro destino se RECHAZA (no se reasigna); sin destino o con el principal es válido", () => {
  const rechazo = validarEntradaPaqueteTotal(entrada({ vuelos: [vuelo({ destinoId: 2 })] }), destinos);
  assert.match(rechazo[0], /Multidestino está desactivado/);
  assert.deepEqual(validarEntradaPaqueteTotal(entrada({ vuelos: [vuelo({ destinoId: null })] }), destinos), []);
  assert.deepEqual(validarEntradaPaqueteTotal(entrada({ vuelos: [vuelo({ destinoId: 1 })] }), destinos), []);
});

test("Multidestino activo: solo el principal y los adicionales declarados", () => {
  const on = (v: Record<string, unknown>) => entrada({ multidestino: true, destinosExtra: [2], vuelos: [vuelo(v)] });
  assert.deepEqual(validarEntradaPaqueteTotal(on({ destinoId: 2 }), destinos), []);
  assert.deepEqual(validarEntradaPaqueteTotal(on({ destinoId: 1 }), destinos), []);
  assert.match(validarEntradaPaqueteTotal(on({ destinoId: 3 }), destinos)[0], /destino que no está en el paquete/);
});

test("seguirDestinoPrincipal y ajenosAlPrincipal: la asignación automática no cambia lo que el usuario dirigió a otro destino", () => {
  const vs = [
    { empaquetadoId: null, destinoId: 1 }, { empaquetadoId: null, destinoId: null }, { empaquetadoId: null, destinoId: 2 }, { empaquetadoId: 7, destinoId: 1 },
  ];
  assert.deepEqual(seguirDestinoPrincipal(vs, 1, 5).map((v) => v.destinoId), [5, 5, 2, 1], "manual→principal nuevo; adicional y vinculado se conservan");
  assert.deepEqual(ajenosAlPrincipal({ destinoId: 1, vuelos: vs, servicios: [{ destinoId: 3 }, { destinoId: null }, { destinoId: 1 }] }), { vuelos: 1, servicios: 1 });
  assert.deepEqual(ajenosAlPrincipal({ destinoId: 1, vuelos: [], servicios: [] }), { vuelos: 0, servicios: 0 });
});

test("cableado del formulario: ficha con buscador por nombre, IATA con selector y destino del vuelo solo con Multidestino", () => {
  const f = sinComentarios(["PaqueteTotalForm.tsx", "VueloFilaDin.tsx", "ServicioFilaDin.tsx", "HotelFilaDin.tsx"].map((x) => leer("app/(dashboard)/dashboard/paquetes/total/" + x)).join(" "));
  assert.match(f, /<ComboHotel hoteles=\{hotelesDest\.map/); assert.match(f, /max=\{500\}/);
  assert.doesNotMatch(f, /Usar ficha de hotel existente/); assert.match(f, /Hotel manual/);
  assert.match(f, /<ComboIata etiqueta="Origen IATA"/); assert.match(f, /<ComboIata etiqueta="Destino IATA"/);
  assert.doesNotMatch(f, /<Input aria-label="Origen IATA"|<Input aria-label="Destino IATA"/);
  assert.match(f, /\{ctx\.multidestino && \(\s*<div className="min-w-0"><label className=\{lbl\}>Destino del vuelo<\/label>/);
  assert.doesNotMatch(f, /<option value="">Destino del paquete<\/option>/, "no hay opción vacía: el destino es siempre explícito");
  assert.match(f, /destinoId: e\.multidestino \? \(x\?\.destino_id \?\? e\.destinoId\) : e\.destinoId/);
  assert.match(f, /alternarMultidestino\(x\.target\.checked\)/); assert.match(f, /seguirDestinoPrincipal\(x\.vuelos, x\.destinoId, nuevo, iataDeDestino\(destinos, nuevo\)\)/);
});

test("cableado del servidor: asigna el destino principal al vuelo sin destino y revalida los códigos", () => {
  const a = sinComentarios(leer("app/(dashboard)/dashboard/paquetes/total/actions.ts"));
  assert.equal((a.match(/destinoId: v\.destinoId \?\? e\.destinoId/g) ?? []).length, 2, "vinculado y manual");
  assert.match(a, /erroresIataVuelo\(v\.origenIata, destinoIata\)/);
  assert.match(a, /origenIata: normalizarIata\(v\.origenIata\), destinoIata: normalizarIata\(destinoIata\)/);
});

test("catálogo de montaje: todas las fichas activas por páginas y en lotes, y aviso si la base ofrece menos", () => {
  const c = sinComentarios(leer("app/(dashboard)/dashboard/paquetes/total/catalogos.ts"));
  assert.match(c, /leerPaginado</); assert.match(c, /\.range\(a, b\)/); assert.match(c, /enLotes\(/);
  assert.match(c, /select\("id", \{ count: "exact", head: true \}\)\.eq\("activo", true\)/);
  assert.match(c, /fichasActivas: activas\.count \?\? undefined/);
  const f = sinComentarios(["PaqueteTotalForm.tsx", "VueloFilaDin.tsx", "ServicioFilaDin.tsx", "HotelFilaDin.tsx"].map((x) => leer("app/(dashboard)/dashboard/paquetes/total/" + x)).join(" "));
  assert.match(f, /hoteles\.length < fichasActivas/); assert.match(f, /migración 280/);
  assert.doesNotMatch(c, /moneda\) ===|tarifa_hotel|hotel_temporadas/, "el listado no filtra por moneda ni mira tarifas");
});

test("iataDeDestino: toma el IATA válido del catálogo de destinos; sin dato o inválido devuelve \"\" (nunca inventa)", async () => {
  const { iataDeDestino } = await import("../lib/paqueteDinamico/ruta.ts");
  const ds = [{ id: 1, codigo_iata: "mbj" }, { id: 2, codigo_iata: null }, { id: 3, codigo_iata: "  " }, { id: 4, codigo_iata: "AB" }, { id: 5 }];
  assert.equal(iataDeDestino(ds, 1), "MBJ");
  for (const id of [2, 3, 4, 5, 99, null, undefined]) assert.equal(iataDeDestino(ds, id as number | null), "", `destino ${id}`);
});

test("seguirDestinoPrincipal con IATA: los manuales que seguían al principal toman también el aeropuerto del nuevo destino (o \"\" si no lo tiene)", () => {
  const vs = [{ empaquetadoId: null, destinoId: 1, destinoIata: "MBJ" }, { empaquetadoId: 7, destinoId: 1, destinoIata: "" }, { empaquetadoId: null, destinoId: 2, destinoIata: "KIN" }];
  assert.deepEqual(seguirDestinoPrincipal(vs, 1, 3, "CTG").map((v) => [v.destinoId, v.destinoIata]), [[3, "CTG"], [1, ""], [2, "KIN"]]);
  assert.deepEqual(seguirDestinoPrincipal(vs, 1, 4, "").map((v) => v.destinoIata), ["", "", "KIN"], "destino sin IATA: queda vacío, no se arrastra el anterior");
});

test("cableado: sin Multidestino no se pide «Destino IATA», se usa el del principal y se avisa si no lo tiene; el servidor lo relee del catálogo", () => {
  const f = sinComentarios(["PaqueteTotalForm.tsx", "VueloFilaDin.tsx", "ServicioFilaDin.tsx", "HotelFilaDin.tsx"].map((x) => leer("app/(dashboard)/dashboard/paquetes/total/" + x)).join(" "));
  assert.match(f, /\{ctx\.multidestino && \(\s*<div className="min-w-0"><label className=\{lbl\}>Destino \(IATA\)<\/label><ComboIata etiqueta="Destino IATA"/);
  assert.match(f, /derivarRutaManual\(v\.origenIata, ctx\.multidestino \? v\.destinoIata : ctx\.iataPrincipal, !!v\.fechaRegreso\)/);
  assert.match(f, /data-testid="destino-sin-iata"/); assert.match(f, /Producto → Destinos/);
  assert.match(f, /e\.multidestino \? e : \{ \.\.\.e, vuelos: e\.vuelos\.map\(\(v\) => \(v\.empaquetadoId == null \? \{ \.\.\.v, destinoIata: iataPrincipal \} : v\)\) \}/);
  const c = sinComentarios(leer("app/(dashboard)/dashboard/paquetes/total/catalogos.ts"));
  assert.match(c, /select\("id, nombre, pais, codigo_iata"\)/);
  const a = sinComentarios(leer("app/(dashboard)/dashboard/paquetes/total/actions.ts"));
  assert.match(a, /select\("id, nombre, pais, codigo_iata"\)\.in\("id", idsDest\)/);
  assert.match(a, /if \(!e\.multidestino\) \{\s*const p = destinos\.find/);
  assert.match(a, /Producto → Destinos/);
});
