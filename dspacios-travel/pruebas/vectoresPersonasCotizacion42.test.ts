// #42 (migración 219) — vectores por flujo del módulo PURO lib/personas/cotizacion.ts.
//
// Qué se prueba: cómo se arma `p_participantes` desde lo que cada acción PERSISTIÓ (Reservar,
// manual, carrito, comparativas e hijas), las reglas del contrato C1/C2 (fila identificada, documento
// crudo, nunca un "CC" supuesto, anónimo = provisional, ref estable asignado en servidor), el aviso
// calculado de la ficha (C7) y los mensajes seguros. La base vuelve a validar todo (runner 219).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  asignarRefsPasajeros, esCotizacionAnonima, esRellenoCliente, filaPasajeroIdentificada, participantesDesdeCotizacion,
  personasPendientes, titularDesdeCliente, pasajeroDesdeFila, titularParaFachada, validarClaveEnvio,
  validarVersionEsperada, versionTitular, tipoDocCheckout, codigoErrorPersonas, mensajePersonas, participanteIdentificado,
  type FilaCotizacionPersonas,
} from "../lib/personas/cotizacion.ts";
import { TIPOS_DOC_PERSONA } from "../lib/personas/identidad.ts";
import { CAMPOS_PASAJERO, CAMPOS_TITULAR } from "../lib/personas/fuentes.ts";
import { payloadGuardarPasajeros } from "../lib/reservar/pasajerosEdicion.ts";

const REF1 = "11111111-1111-4111-8111-111111111111";
const REF2 = "22222222-2222-4222-8222-222222222222";
function contador() { let n = 0; return () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`; }

const CLIENTE = { nombres: " Ana ", apellidos: "Gómez", tipoDoc: "CC", numeroDoc: "1.020.304.050", telefono: "300", email: "a@x.test" };

describe("asignarRefsPasajeros (C2: ref en servidor ANTES del insert)", () => {
  test("solo las filas identificadas reciben ref; las vacías (solo cantidad) no", () => {
    const filas = [
      { nombres: "Ana", apellidos: "", numeroDoc: "" },
      { nombres: "  ", apellidos: "", numeroDoc: "" },
      { nombres: "", apellidos: "", numeroDoc: "123" },
    ];
    const r = asignarRefsPasajeros(filas, contador());
    assert.equal(r[0].ref, "00000000-0000-4000-8000-000000000001");
    assert.equal("ref" in r[1], false);
    assert.equal(r[2].ref, "00000000-0000-4000-8000-000000000002");
  });
  test("un ref que mande el navegador se descarta: el cliente no elige la identidad del puesto", () => {
    const r = asignarRefsPasajeros([{ nombres: "Ana", ref: REF1 }, { nombres: "", ref: REF2 }], contador());
    assert.notEqual(r[0].ref, REF1);
    assert.equal("ref" in r[1], false, "una fila vacía tampoco conserva un ref ajeno");
  });
  test("no cambia el orden ni los demás datos", () => {
    const filas = [{ nombres: "Ana", tipoDoc: "TI", fechaNacimiento: "2015-01-01", esInfante: false }];
    const [f] = asignarRefsPasajeros(filas, contador());
    assert.deepEqual({ ...f, ref: undefined }, { ...filas[0], ref: undefined });
  });
  test("solo espacios ASCII cuentan como vacío (misma regla que btrim(' ') en SQL)", () => {
    assert.equal(filaPasajeroIdentificada({ nombres: "   " }), false);
    assert.equal(filaPasajeroIdentificada({ nombres: " " }), true);
  });
});

describe("titular desde payload.cliente (C1: documento crudo)", () => {
  test("tipo y número tal cual; observaciones con espacios ASCII recortados; nacimiento -> fecha_nacimiento", () => {
    const t = titularDesdeCliente({ ...CLIENTE, nacimiento: "1990-01-01" }, { anonima: false });
    assert.deepEqual(t, {
      rol: "titular", tipo_doc: "CC", numero_doc: "1.020.304.050",
      observaciones: [
        { campo: "nombres", valor: "Ana" }, { campo: "apellidos", valor: "Gómez" }, { campo: "telefono", valor: "300" },
        { campo: "email", valor: "a@x.test" }, { campo: "fecha_nacimiento", valor: "1990-01-01" },
      ],
    });
  });
  test("tipo vacío = ausente; NUNCA se rellena con CC", () => {
    assert.equal(titularDesdeCliente({ ...CLIENTE, tipoDoc: "" }, { anonima: false })?.tipo_doc, null);
    assert.equal(titularDesdeCliente({ nombres: "Ana" }, { anonima: false })?.tipo_doc, null);
  });
  test("anónima (checkout sin sesión): el tipo no se registra aunque el payload diga CC (D-6)", () => {
    assert.equal(titularDesdeCliente(CLIENTE, { anonima: true })?.tipo_doc, null);
    assert.equal(titularDesdeCliente(CLIENTE, { anonima: true })?.numero_doc, "1.020.304.050");
  });
  test("sin nombre ni documento no hay persona; el relleno 'Cliente' del motor tampoco", () => {
    assert.equal(titularDesdeCliente({ telefono: "300" }, { anonima: false }), null);
    assert.equal(titularDesdeCliente({ nombres: "Cliente", apellidos: "", numeroDoc: "" }, { anonima: false }), null);
    assert.equal(esRellenoCliente({ nombres: "Cliente", apellidos: "", numeroDoc: "" }), true);
    assert.equal(esRellenoCliente({ nombres: "Cliente", apellidos: "Real", numeroDoc: "" }), false);
    assert.notEqual(titularDesdeCliente({ nombres: "Cliente", apellidos: "", numeroDoc: "99" }, { anonima: false }), null);
  });
  test("los campos del titular son exactamente los del catálogo de su puesto", () => {
    const t = titularDesdeCliente({ ...CLIENTE, nacimiento: "1990-01-01", nacionalidad: "CO" }, { anonima: false });
    for (const o of t?.observaciones ?? []) assert.ok((CAMPOS_TITULAR as readonly string[]).includes(o.campo), o.campo);
  });
});

describe("pasajeros desde payload.pasajeros (solo Reservar en V1)", () => {
  test("con ref válido: puesto con orden y campos del pasajero", () => {
    const p = pasajeroDesdeFila({ ref: REF1, nombres: "Beto", apellidos: "Ruiz", tipoDoc: "TI", numeroDoc: "123", fechaNacimiento: "2015-02-02", nacionalidad: "Colombia", esInfante: false }, 3, { anonima: false });
    assert.deepEqual(p, {
      rol: "pasajero", ref: REF1, orden: 3, tipo_doc: "TI", numero_doc: "123",
      observaciones: [{ campo: "nombres", valor: "Beto" }, { campo: "apellidos", valor: "Ruiz" },
                      { campo: "fecha_nacimiento", valor: "2015-02-02" }, { campo: "nacionalidad", valor: "Colombia" }],
    });
    for (const o of p?.observaciones ?? []) assert.ok((CAMPOS_PASAJERO as readonly string[]).includes(o.campo));
  });
  test("sin ref, con ref inválido o vacía: no hay puesto (nunca por índice)", () => {
    assert.equal(pasajeroDesdeFila({ nombres: "Beto" }, 0, { anonima: false }), null);
    assert.equal(pasajeroDesdeFila({ ref: "1", nombres: "Beto" }, 0, { anonima: false }), null);
    assert.equal(pasajeroDesdeFila({ ref: REF1, nombres: " " }, 0, { anonima: false }), null);
  });
});

const fila = (p: Partial<FilaCotizacionPersonas>): FilaCotizacionPersonas =>
  ({ id: 1, tenant: "mayorista", tipo: "tarifario", payload: {}, creado_por_id: null, propietario_id: null, aliado_id: null, ...p });

describe("participantesDesdeCotizacion — un vector por flujo", () => {
  test("Reservar: titular + pasajeros con ref (las filas vacías y sin ref no cuentan)", () => {
    const pasajeros = asignarRefsPasajeros([{ nombres: "Ana", numeroDoc: "1" }, { nombres: "", numeroDoc: "" }, { nombres: "Beto" }], contador());
    const r = participantesDesdeCotizacion(fila({ creado_por_id: "u1", payload: { cliente: CLIENTE, pasajeros } }));
    assert.deepEqual(r.map((p) => `${p.rol}:${p.orden ?? "-"}`), ["titular:-", "pasajero:0", "pasajero:2"]);
  });
  test("manual / dinámica: SOLO el titular (las cantidades de pax/niños nunca crean personas)", () => {
    const r = participantesDesdeCotizacion(fila({ tipo: "manual", creado_por_id: "u1",
      payload: { cliente: { ...CLIENTE, nacimiento: "1990-01-01" }, pax: 4, ninos: 2, pasajeros: [] } }));
    assert.deepEqual(r.map((p) => p.rol), ["titular"]);
  });
  test("carrito anónimo: titular provisional aunque el payload traiga tipo", () => {
    const r = participantesDesdeCotizacion(fila({ tipo: "carrito", payload: { cliente: { ...CLIENTE, tipoDoc: "CE" } } }));
    assert.equal(r.length, 1);
    assert.equal(r[0].tipo_doc, null);
  });
  test("carrito con sesión (sellado): el tipo elegido en el checkout se registra tal cual", () => {
    const r = participantesDesdeCotizacion(fila({ tipo: "carrito", creado_por_id: "u-b2b", payload: { cliente: { ...CLIENTE, tipoDoc: "CE" } } }));
    assert.equal(r[0].tipo_doc, "CE");
  });
  test("madre comparativa del carrito anónima e hija pública sin tipo: provisionales", () => {
    assert.equal(participantesDesdeCotizacion(fila({ tipo: "comparativa_carrito", payload: { comparativa: true, cliente: CLIENTE } }))[0].tipo_doc, null);
    const hija = fila({ tipo: "carrito", payload: { items: [], cliente: { nombres: "Visitante", apellidos: "X", numeroDoc: "55", telefono: "1", email: "" } } });
    assert.deepEqual(participantesDesdeCotizacion(hija).map((p) => [p.rol, p.tipo_doc, p.numero_doc]), [["titular", null, "55"]]);
  });
  test("madre comparativa manual o con aliado: no es anónima; conserva el tipo", () => {
    assert.equal(participantesDesdeCotizacion(fila({ tipo: "comparativa_manual", creado_por_id: "u1", payload: { cliente: CLIENTE } }))[0].tipo_doc, "CC");
    assert.equal(participantesDesdeCotizacion(fila({ tipo: "comparativa_carrito", aliado_id: 7, payload: { cliente: CLIENTE } }))[0].tipo_doc, "CC");
  });
  test("payload ausente o sin cliente: ningún puesto", () => {
    assert.deepEqual(participantesDesdeCotizacion(fila({ payload: null })), []);
  });
});

describe("cotización anónima: misma regla que p214_priv.cotizacion_anonima", () => {
  const casos: [Partial<FilaCotizacionPersonas>, boolean][] = [
    [{ tipo: "carrito" }, true],
    [{ tipo: "comparativa_carrito" }, true],
    [{ tipo: "carrito", tenant: "minorista" }, false],
    [{ tipo: "tarifario" }, false],
    [{ tipo: "manual" }, false],
    [{ tipo: "carrito", creado_por_id: "u" }, false],
    [{ tipo: "carrito", propietario_id: "u" }, false],
    [{ tipo: "carrito", aliado_id: 3 }, false],
  ];
  for (const [f, esperado] of casos) {
    test(JSON.stringify(f), () => assert.equal(esCotizacionAnonima(fila(f)), esperado));
  }
});

describe("aviso persistente de la ficha (C7): calculado", () => {
  const parts = participantesDesdeCotizacion(fila({ creado_por_id: "u", payload: { cliente: CLIENTE, pasajeros: [{ ref: REF1, nombres: "A" }, { ref: REF2, nombres: "B" }] } }));
  test("sin puestos: titular y dos pasajeros pendientes", () => assert.equal(personasPendientes(parts, []), 3));
  test("titular activo y un pasajero registrado: queda uno", () => {
    assert.equal(personasPendientes(parts, [{ id: "x", rol: "titular", activo: true }, { id: REF1, rol: "pasajero", activo: true }]), 1);
  });
  test("un titular retirado no cuenta como registrado", () => {
    assert.equal(personasPendientes(parts, [{ id: "x", rol: "titular", activo: false }, { id: REF1, rol: "pasajero", activo: true }, { id: REF2, rol: "pasajero", activo: true }]), 1);
  });
  test("versión del titular para el CAS (0 = aún no hay puesto)", () => {
    assert.equal(versionTitular([]), 0);
    assert.equal(versionTitular([{ id: "x", rol: "titular", activo: true, version: 3 }]), 3);
  });
});

describe("editor del titular", () => {
  test("p_titular: tipo vacío = null (nunca 'CC'); solo espacios ASCII recortados", () => {
    const t = titularParaFachada({ nombres: " Ana ", apellidos: "", tipoDoc: "", numeroDoc: " 123 ", nacimiento: "", telefono: "", email: "" });
    assert.deepEqual(t, { nombres: "Ana", apellidos: null, tipo_doc: null, numero_doc: "123", fecha_nacimiento: null, telefono: null, email: null });
  });
  test("clave por envío: UUID; versión: entero >= 0", () => {
    assert.equal(validarClaveEnvio(REF1), REF1);
    assert.equal(validarClaveEnvio("abc"), null);
    assert.equal(validarVersionEsperada(0), 0);
    assert.equal(validarVersionEsperada(-1), null);
    assert.equal(validarVersionEsperada(1.5), null);
  });
});

describe("checkout: tipo documental (D-6)", () => {
  test("ausente o vacío = sin tipo; del catálogo = tal cual; otro = error claro", () => {
    assert.deepEqual(tipoDocCheckout({ cliente: {} }, TIPOS_DOC_PERSONA), { ok: true, tipo: null });
    assert.deepEqual(tipoDocCheckout({ cliente: { tipoDoc: "" } }, TIPOS_DOC_PERSONA), { ok: true, tipo: null });
    assert.deepEqual(tipoDocCheckout({ cliente: { tipoDoc: "PAS" } }, TIPOS_DOC_PERSONA), { ok: true, tipo: "PAS" });
    assert.equal(tipoDocCheckout({ cliente: { tipoDoc: "cc" } }, TIPOS_DOC_PERSONA).ok, false);
    assert.equal(tipoDocCheckout({ cliente: { tipoDoc: 1 } }, TIPOS_DOC_PERSONA).ok, false);
    assert.deepEqual(tipoDocCheckout(null, TIPOS_DOC_PERSONA), { ok: true, tipo: null });
  });
});

describe("errores: nunca el texto crudo de Postgres (C7)", () => {
  test("los códigos propios se traducen; lo desconocido cae al mensaje por defecto", () => {
    assert.equal(codigoErrorPersonas("version_obsoleta"), "version_obsoleta");
    assert.match(mensajePersonas("version_obsoleta"), /recarga/);
    assert.match(mensajePersonas("cotizacion_no_abierta"), /ya no está abierta/);
    assert.match(mensajePersonas("original_demasiado_largo"), /64/);
    const crudo = 'duplicate key value violates unique constraint "uq_cotizacion_participantes_titular_activo"';
    assert.equal(mensajePersonas(codigoErrorPersonas(crudo)), "No se pudo guardar el titular. Inténtalo de nuevo.");
    assert.equal(mensajePersonas(null, "x"), "x");
  });
  test("identificación TS = SQL: documento o nombres/apellidos no vacíos", () => {
    assert.equal(participanteIdentificado({ numero_doc: "  ", observaciones: [{ campo: "telefono", valor: "1" }] }), false);
    assert.equal(participanteIdentificado({ numero_doc: null, observaciones: [{ campo: "apellidos", valor: "X" }] }), true);
  });
});

describe("conversiones: el ref no viaja al contrato", () => {
  test("payloadGuardarPasajeros arma claves explícitas (un ref extra no llega a la RPC del contrato)", () => {
    const filas = [{ nombre: "Ana", tipoId: "CC", identificacion: "1", fechaNacimiento: "1990-01-01", esInfante: false, responsableIndex: null, ref: REF1 }];
    const [p] = payloadGuardarPasajeros(filas as unknown as Parameters<typeof payloadGuardarPasajeros>[0]);
    assert.equal("ref" in p, false);
  });
});
