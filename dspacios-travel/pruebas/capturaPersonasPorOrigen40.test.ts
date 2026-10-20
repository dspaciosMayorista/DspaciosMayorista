// #40 · E1 — qué titulares y pasajeros se registran REALMENTE en el registro de personas (219), por origen
// de la cotización. Ejecuta las funciones reales que reconstruyen los puestos desde lo que cada origen
// persiste (`participantesDesdeCotizacion`), y vigila por inventario estático que ningún origen nuevo
// cree cotizaciones sin decidir qué personas registra. Es una prueba de la FUENTE de cada origen: lo que
// SQL acepta después (gramática 214, tenant, estado) lo cubren las pruebas de la 219 en CI.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  asignarRefsPasajeros, esCotizacionAnonima, participantesDesdeCotizacion, type FilaCotizacionPersonas,
} from "../lib/personas/cotizacion.ts";
import { construirCotizacionManual, type CotizacionManualInput } from "../lib/cotizacion/liquidacionManual.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const refs = (() => { let n = 0; return () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`; })();

const CLIENTE = { nombres: "Ana", apellidos: "Prueba", tipoDoc: "CE", numeroDoc: "1.000.001", telefono: "3000000000", email: "ana@example.test", nacimiento: "1990-05-17" };

function manual(cliente: Partial<typeof CLIENTE> & Record<string, unknown>, extra: Partial<CotizacionManualInput> = {}): FilaCotizacionPersonas {
  const r = construirCotizacionManual({
    cliente: { ...CLIENTE, ...cliente } as CotizacionManualInput["cliente"],
    destino: "CARTAGENA", fechaIda: "2030-03-01", fechaRegreso: "2030-03-04", pax: 3, ninos: 2, tarifaNino: 100_000, moneda: "COP",
    tipoAsesor: "interno", asesorInterno: "Asesor Uno", agenciaNombre: "", freelanceNombre: "", plazo: "", vigenciaHasta: "2030-02-20", observaciones: "",
    servicios: [{ tipo: "hotel", plataforma: "", nombre: "Hotel", proveedor: "P", costoNeto: 100_000, modo: "mk", pctMarkup: 20, ta: 0 }],
    ...extra,
  }, { vigencia: "2030-02-20" });
  assert.ok(r.ok, "el constructor real debe aceptar el caso");
  return { id: 1, tenant: "mayorista", tipo: "manual", payload: r.cabecera.payload, creado_por_id: "u-interno" };
}

const carrito = (cliente: Record<string, unknown>, creadoPorId: string | null): FilaCotizacionPersonas => ({
  // Misma forma que persiste `crearCotizacionCarrito`: { items, tours, serviciosIncluidos, cliente }.
  id: 2, tenant: "mayorista", tipo: "carrito", payload: { items: [{ pax: 4 }], tours: [], serviciosIncluidos: [], cliente }, creado_por_id: creadoPorId,
});

const campos = (p: { observaciones: { campo: string }[] }) => p.observaciones.map((o) => o.campo);

describe("manual (cotización dinámica, interno)", () => {
  test("registra SOLO al titular, con el tipo tal como se eligió y todos sus datos", () => {
    const p = participantesDesdeCotizacion(manual({}));
    assert.equal(p.length, 1);
    assert.equal(p[0].rol, "titular");
    assert.equal(p[0].tipo_doc, "CE");
    assert.equal(p[0].numero_doc, "1.000.001");
    assert.deepEqual(campos(p[0]), ["nombres", "apellidos", "telefono", "email", "fecha_nacimiento"]);
  });
  test("adultos y niños son cantidades: no crean pasajeros (pax 3, niños 2)", () => {
    const f = manual({});
    assert.equal((f.payload as { pax: number }).pax, 3);
    assert.equal((f.payload as { ninos: number }).ninos, 2);
    assert.equal(participantesDesdeCotizacion(f).filter((x) => x.rol === "pasajero").length, 0);
  });
  test("tipo vacío: queda sin tipo (nunca CC)", () => {
    assert.equal(participantesDesdeCotizacion(manual({ tipoDoc: "" }))[0].tipo_doc, null);
  });
  test("sin documento pero con nombre: igual es una persona identificada", () => {
    const p = participantesDesdeCotizacion(manual({ numeroDoc: "", tipoDoc: "" }));
    assert.equal(p.length, 1);
    assert.equal(p[0].numero_doc, null);
  });
  test("no es anónima aunque sea del tenant mayorista", () => {
    assert.equal(esCotizacionAnonima({ tenant: "mayorista", tipo: "manual", creado_por_id: "u" }), false);
  });
});

describe("carrito del tarifario", () => {
  test("anónimo (sin creador): el titular se registra SIN tipo aunque el cliente eligió uno", () => {
    const f = carrito({ ...CLIENTE, tipoDoc: "CE" }, null);
    assert.equal(esCotizacionAnonima(f), true);
    const p = participantesDesdeCotizacion(f);
    assert.equal(p.length, 1);
    assert.equal(p[0].tipo_doc, null);
    assert.equal(p[0].numero_doc, "1.000.001");
  });
  test("con sesión (creador sellado): conserva el tipo elegido", () => {
    const p = participantesDesdeCotizacion(carrito({ ...CLIENTE, tipoDoc: "CE" }, "u-b2b"));
    assert.equal(p[0].tipo_doc, "CE");
  });
  test("con sesión y sin tipo: queda sin tipo, nunca CC", () => {
    assert.equal(participantesDesdeCotizacion(carrito({ ...CLIENTE, tipoDoc: "" }, "u-b2b"))[0].tipo_doc, null);
    assert.equal(participantesDesdeCotizacion(carrito({ nombres: "Ana", apellidos: "P", numeroDoc: "123", telefono: "3", email: "" }, "u-b2b"))[0].tipo_doc, null);
  });
  test("el carrito no trae pasajeros: la cantidad de viajeros (pax 4) no crea personas", () => {
    assert.equal(participantesDesdeCotizacion(carrito(CLIENTE, "u")).filter((x) => x.rol === "pasajero").length, 0);
  });
});

describe("Reservar (tarifario interno/B2B): titular y pasajeros identificados", () => {
  const filas = [
    { nombres: "Luis", apellidos: "Uno", tipoDoc: "CC", numeroDoc: "111", fechaNacimiento: "1980-01-01", nacionalidad: "Colombiana" },
    { nombres: "", apellidos: "", tipoDoc: "CC", numeroDoc: "", fechaNacimiento: "", nacionalidad: "Colombiana" },        // fila vacía
    { nombres: "", apellidos: "", tipoDoc: "CC", numeroDoc: "222", fechaNacimiento: "", nacionalidad: "Colombiana" },     // solo documento
    { nombres: "Eva", apellidos: "", tipoDoc: "PAS", numeroDoc: "", fechaNacimiento: "", nacionalidad: "Peruana", ref: "ref-falso-del-navegador" },
  ];
  const conRefs = asignarRefsPasajeros(filas, refs);
  const fila: FilaCotizacionPersonas = { id: 3, tenant: "mayorista", tipo: "tarifario", payload: { cliente: CLIENTE, pasajeros: conRefs }, creado_por_id: "u-int" };

  test("el servidor asigna el ref de cada fila identificada y descarta el que mande el navegador", () => {
    assert.ok(conRefs[0].ref && UUID.test(conRefs[0].ref));
    assert.ok(conRefs[3].ref && UUID.test(conRefs[3].ref) && conRefs[3].ref !== "ref-falso-del-navegador");
    assert.equal(conRefs[1].ref, undefined, "la fila vacía no recibe ref");
  });
  test("registra el titular y los pasajeros con nombre o documento; la fila vacía no crea puesto", () => {
    const p = participantesDesdeCotizacion(fila);
    assert.deepEqual(p.map((x) => x.rol), ["titular", "pasajero", "pasajero", "pasajero"]);
    assert.deepEqual(p.filter((x) => x.rol === "pasajero").map((x) => x.orden), [0, 2, 3], "conserva la posición de la fila");
    assert.ok(p.filter((x) => x.rol === "pasajero").every((x) => x.ref && UUID.test(x.ref)));
  });
  test("el pasajero conserva su tipo tal cual y solo los campos de pasajero", () => {
    const p = participantesDesdeCotizacion(fila).filter((x) => x.rol === "pasajero");
    assert.equal(p[2].tipo_doc, "PAS");
    assert.deepEqual(campos(p[0]), ["nombres", "apellidos", "fecha_nacimiento", "nacionalidad"]);
    assert.deepEqual(campos(p[2]), ["nombres", "nacionalidad"], "solo lo que la fila trae");
  });
  test("una fila con ref pero sin ref válido (no pasó por el servidor) no crea puesto", () => {
    const sinServidor: FilaCotizacionPersonas = { ...fila, payload: { cliente: CLIENTE, pasajeros: filas } };
    assert.deepEqual(participantesDesdeCotizacion(sinServidor).map((x) => x.rol), ["titular"]);
  });
});

describe("casos sin personas", () => {
  test("titular de relleno del motor (\"Cliente\" sin documento): no es una persona", () => {
    const f: FilaCotizacionPersonas = { id: 4, tenant: "mayorista", tipo: "comparativa_carrito", payload: { cliente: { nombres: "Cliente", apellidos: "", numeroDoc: "" } }, creado_por_id: "u" };
    assert.deepEqual(participantesDesdeCotizacion(f), []);
  });
  test("sin cliente, con cliente vacío o payload inválido: nada", () => {
    for (const payload of [{}, { cliente: {} }, { cliente: { nombres: " ", apellidos: "", numeroDoc: "" } }, null, "texto", []]) {
      assert.deepEqual(participantesDesdeCotizacion({ id: 5, tenant: "mayorista", tipo: "manual", payload, creado_por_id: "u" }), []);
    }
  });
});

// ── Inventario estático: cada origen que crea cotizaciones decide qué personas registra ──
const raiz = fileURLToPath(new URL("../", import.meta.url));
function archivos(dir: string): string[] {
  const out: string[] = [];
  for (const n of readdirSync(dir)) {
    if (n === "node_modules" || n === ".next" || n.startsWith(".")) continue;
    const p = join(dir, n);
    if (statSync(p).isDirectory()) out.push(...archivos(p));
    else if (/\.(ts|tsx)$/.test(n)) out.push(p);
  }
  return out;
}
const rel = (p: string) => p.slice(raiz.length).replace(/\\/g, "/");
const leer = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const todos = [...archivos(join(raiz, "app")), ...archivos(join(raiz, "lib"))];

describe("inventario de orígenes de cotización", () => {
  const CREADORES = /\.from\("cotizaciones"\)\s*\.insert\(|\.rpc\("crear_cotizacion_(manual|comparativa)"/g;
  const ALTAS = /altaPersonasCotizacion\(/g;
  const cuenta = (re: RegExp, s: string) => (s.match(re) ?? []).length;

  test("los únicos archivos que crean cotizaciones son los esperados, con su número de creadores", () => {
    const encontrados: Record<string, number> = {};
    for (const p of todos) {
      const n = cuenta(CREADORES, leer(p).split("\n").filter((l) => !/^\s*(\/\/|\*)/.test(l)).join("\n"));
      if (n > 0) encontrados[rel(p)] = n;
    }
    assert.deepEqual(encontrados, {
      "app/(dashboard)/dashboard/cotizaciones/manual-actions.ts": 2,   // manual + comparativa manual
      "app/(dashboard)/dashboard/reservar/actions.ts": 1,              // Reservar (tarifario)
      "app/tarifario/checkout/actions.ts": 2,                          // carrito + comparativa del carrito
    }, "apareció (o desapareció) un origen de cotizaciones: decide qué personas registra y actualiza este inventario");
  });

  test("cada archivo creador llama a la alta de personas al menos tantas veces como crea cotizaciones", () => {
    const inventario: [string, number][] = [
      ["app/(dashboard)/dashboard/cotizaciones/manual-actions.ts", 2],
      ["app/(dashboard)/dashboard/reservar/actions.ts", 1],
      ["app/tarifario/checkout/actions.ts", 2],
    ];
    for (const [archivo, creadores] of inventario) {
      const altas = cuenta(ALTAS, leer(join(raiz, archivo)));
      assert.ok(altas >= creadores, `${archivo}: ${altas} altas para ${creadores} creadores`);
    }
  });

  test("puntos de alta de personas por archivo (alta, hijas y reintento): sin cambios inadvertidos", () => {
    const encontrados: Record<string, number> = {};
    for (const p of todos) {
      if (rel(p) === "lib/personas/consulta.ts") continue; // definición
      const n = cuenta(ALTAS, leer(p));
      if (n > 0) encontrados[rel(p)] = n;
    }
    assert.deepEqual(encontrados, {
      "app/(dashboard)/dashboard/cotizaciones/[id]/page.tsx": 1,       // «Reintentar»
      "app/(dashboard)/dashboard/cotizaciones/manual-actions.ts": 3,   // manual, comparativa, hija
      "app/(dashboard)/dashboard/reservar/actions.ts": 1,
      "app/tarifario/checkout/actions.ts": 3,                          // carrito, comparativa, hija
    });
  });

  test("ningún origen reconstruye pasajeros desde cantidades: solo Reservar escribe payload.pasajeros con ref", () => {
    const conRefs = todos.filter((p) => /asignarRefsPasajeros\(/.test(leer(p)) && rel(p) !== "lib/personas/cotizacion.ts").map(rel);
    assert.deepEqual(conRefs, ["app/(dashboard)/dashboard/reservar/actions.ts"]);
  });
});
