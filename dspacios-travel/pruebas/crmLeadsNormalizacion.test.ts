import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  avisoCoincidenciasLead,
  normalizarDocumentoLead,
  normalizarEmailLead,
  normalizarTelefonoLead,
  normalizarTipoDocLead,
  textoDocumentoLead,
  validarDocumentoLead,
  validarEntradaLead,
} from "../lib/crm/leads.ts";

describe("CRM leads: normalizacion", () => {
  test("telefono colombiano de 10 digitos se guarda con prefijo 57", () => {
    assert.equal(normalizarTelefonoLead("300 123 4567"), "573001234567");
  });

  test("telefono con +57 conserva el mismo valor normalizado", () => {
    assert.equal(normalizarTelefonoLead("+57 300 123 4567"), "573001234567");
  });

  test("email se compara con trim y lower", () => {
    assert.equal(normalizarEmailLead("  ANA@DSPACIOS.COM  "), "ana@dspacios.com");
  });

  test("documento elimina signos y compara en minusculas", () => {
    assert.equal(normalizarDocumentoLead(" NIT 900.123-4 "), "nit9001234");
  });

  test("valores vacios normalizan a null", () => {
    assert.equal(normalizarTelefonoLead(" -- "), null);
    assert.equal(normalizarEmailLead(" "), null);
    assert.equal(normalizarDocumentoLead("."), null);
  });
});

// Identidad documental = tipo + numero. El numero solo nunca identifica a la
// persona, y sin tipo explicito no se asume CC. Mismos mensajes que la RPC.
describe("CRM leads: identidad documental (tipo + numero)", () => {
  test("el tipo se normaliza al codigo del catalogo sin traducir sinonimos", () => {
    assert.equal(normalizarTipoDocLead(" c.c. "), "CC");
    assert.equal(normalizarTipoDocLead("C.C"), "CC");
    assert.equal(normalizarTipoDocLead("p.a.s."), "PAS");
    assert.equal(normalizarTipoDocLead("pas"), "PAS");
    assert.equal(normalizarTipoDocLead("  "), null);
    assert.equal(normalizarTipoDocLead("cedula"), "CEDULA", "no se traduce a CC: luego se rechaza");
  });

  test("un tipo mal formado NO se limpia hasta parecer valido: queda fuera del catalogo", () => {
    // Antes, quitar todo lo que no fuera letra convertia "CC2" en "CC".
    for (const malo of ["CC2", "C-C", "C C", "..CC", "C..C", ".", "CC/", "cédula", "\tCC"]) {
      const tipo = normalizarTipoDocLead(malo);
      assert.ok(tipo === null || !["CC", "CE", "TI", "RC", "PAS", "PPT", "NIT"].includes(tipo), `${JSON.stringify(malo)} -> ${tipo}`);
      assert.deepEqual(validarDocumentoLead(malo, "445566"), { ok: false, error: "Tipo de documento invalido." }, malo);
    }
  });

  test("numero sin tipo se rechaza: no se asume CC", () => {
    assert.deepEqual(validarDocumentoLead("", "1.020.304"), {
      ok: false,
      error: "Indica el tipo de documento: el numero solo no identifica a la persona.",
    });
  });

  test("tipo sin numero, tipo fuera del catalogo y numero sin digitos se rechazan", () => {
    assert.deepEqual(validarDocumentoLead("CC", " "), { ok: false, error: "Escribe el numero de documento o quita el tipo." });
    assert.deepEqual(validarDocumentoLead("XX", "123"), { ok: false, error: "Tipo de documento invalido." });
    assert.deepEqual(validarDocumentoLead("cedula", "123"), { ok: false, error: "Tipo de documento invalido." });
    assert.deepEqual(validarDocumentoLead("CC", ".-."), { ok: false, error: "El numero de documento debe tener letras o digitos." });
  });

  test("sin tipo ni numero el lead es valido (todavia sin documento)", () => {
    assert.deepEqual(validarDocumentoLead("", ""), { ok: true, tipoDoc: null, documento: null });
    assert.deepEqual(validarDocumentoLead(undefined, undefined), { ok: true, tipoDoc: null, documento: null });
  });

  test("pareja valida: tipo normalizado y numero tal cual (la base lo normaliza)", () => {
    assert.deepEqual(validarDocumentoLead(" ti ", " 1.020.304 "), { ok: true, tipoDoc: "TI", documento: "1.020.304" });
  });

  test("mismo numero con distinto tipo son identidades distintas", () => {
    const cc = validarDocumentoLead("CC", "1020304");
    const ti = validarDocumentoLead("TI", "1020304");
    assert.ok(cc.ok && ti.ok);
    if (cc.ok && ti.ok) {
      assert.equal(normalizarDocumentoLead(cc.documento), normalizarDocumentoLead(ti.documento));
      assert.notEqual(cc.tipoDoc, ti.tipoDoc);
    }
  });

  test("el documento se muestra con su tipo", () => {
    assert.equal(textoDocumentoLead("CC", "1020304"), "CC 1020304");
    assert.equal(textoDocumentoLead(null, null), null);
    assert.equal(textoDocumentoLead("CC", "  "), null);
  });
});

describe("CRM leads: coincidencias que no bloquean", () => {
  test("sin coincidencias no hay aviso", () => {
    assert.equal(avisoCoincidenciasLead([]), null);
    assert.equal(avisoCoincidenciasLead(null), null);
  });

  test("el aviso nombra cada lead y por que dato coincide, y aclara que no fusiona", () => {
    const aviso = avisoCoincidenciasLead([
      { id: 7, por: ["telefono", "email"] },
      { id: 9, por: ["numero_documento"] },
    ]);
    assert.equal(
      aviso,
      "Comparte datos con #7 (teléfono, correo); #9 (número de documento con otro tipo). Revisa si es la misma persona; no se fusionó nada.",
    );
  });
});

// Entrada de las Server Actions: un Server Action se puede invocar con
// cualquier payload desde el navegador.
describe("CRM leads: validacion de la entrada de las Server Actions", () => {
  const base = { nombre: " Ana ", canal: "whatsapp" };
  // Las reglas comunes se prueban en modo ALTA; lo propio de la edicion, abajo.
  const crear = (x: unknown) => validarEntradaLead(x, "crear");

  test("alta: completa las claves omitidas como vacias (un lead nuevo no tiene datos que borrar)", () => {
    const r = crear(base);
    assert.ok(r.ok);
    if (r.ok) {
      assert.deepEqual(r.datos, {
        nombre: "Ana", canal: "whatsapp", telefono: "", email: "", tipoDoc: "", documento: "",
        interes: "", origenDetalle: "", notas: "", responsableId: "", proximaAccionAt: "",
      });
    }
  });

  test("rechaza lo que no es un objeto", () => {
    for (const malo of [null, undefined, "x", 5, [], [base]]) {
      assert.deepEqual(crear(malo), { ok: false, error: "Datos del lead invalidos." }, String(malo));
    }
  });

  test("rechaza claves desconocidas (p. ej. intentar colar tenant o responsable_id)", () => {
    assert.deepEqual(crear({ ...base, tenant: "minorista", responsable_id: "x" }), {
      ok: false, error: "Campos no admitidos: responsable_id, tenant.",
    });
  });

  test("rechaza valores que no son texto", () => {
    assert.deepEqual(crear({ ...base, notas: 5 }), { ok: false, error: "El campo notas debe ser texto." });
    assert.deepEqual(crear({ ...base, documento: { v: "1" } }), { ok: false, error: "El campo documento debe ser texto." });
    assert.deepEqual(crear({ nombre: ["Ana"], canal: "otro" }), { ok: false, error: "El campo nombre debe ser texto." });
  });

  test("nombre, canal, documento, responsable y fecha se validan", () => {
    assert.equal(crear({ ...base, nombre: "  " }).ok, false);
    assert.deepEqual(crear({ ...base, canal: "tiktok" }), { ok: false, error: "Canal invalido." });
    assert.deepEqual(crear({ ...base, tipoDoc: "CC2", documento: "1" }), { ok: false, error: "Tipo de documento invalido." });
    assert.deepEqual(crear({ ...base, documento: "1" }), {
      ok: false, error: "Indica el tipo de documento: el numero solo no identifica a la persona.",
    });
    assert.deepEqual(crear({ ...base, responsableId: "no-es-uuid" }), { ok: false, error: "Responsable invalido." });
    assert.deepEqual(crear({ ...base, proximaAccionAt: "mañana" }), { ok: false, error: "Fecha de proxima accion invalida." });
  });

  test("valores validos pasan tal cual (la base normaliza)", () => {
    const r = crear({
      ...base, tipoDoc: "c.c.", documento: "1.020.304",
      responsableId: " 00000000-0000-0000-0000-00000000c206 ", proximaAccionAt: "2026-12-01T09:00", notas: null,
    });
    assert.ok(r.ok);
    if (r.ok) {
      assert.equal(r.datos.tipoDoc, "c.c.");
      assert.equal(r.datos.responsableId, "00000000-0000-0000-0000-00000000c206");
      assert.equal(r.datos.proximaAccionAt, "2026-12-01T09:00");
      assert.equal(r.datos.notas, "");
    }
  });
});

describe("CRM leads: la edicion exige el formulario completo tambien en la Server Action", () => {
  const completo = {
    nombre: "Ana", canal: "whatsapp", telefono: "3001112233", email: "ana@local.test",
    tipoDoc: "CC", documento: "1020304", interes: "Cartagena", origenDetalle: "Historia",
    notas: "Llamar", responsableId: "00000000-0000-0000-0000-00000000c206", proximaAccionAt: "",
  };
  const editar = (x: unknown) => validarEntradaLead(x, "editar");

  test("una edicion con solo nombre y canal se rechaza: no se rellena con vacios", () => {
    assert.deepEqual(editar({ nombre: "Ana", canal: "whatsapp" }), {
      ok: false,
      error: "Faltan campos del formulario del lead: telefono, email, tipoDoc, documento, interes, origenDetalle, notas, responsableId, proximaAccionAt. No se modifico nada.",
    });
  });

  test("falta UNA clave (o viene como undefined): rechazado, nombrando cual", () => {
    for (const campo of ["telefono", "documento", "proximaAccionAt"] as const) {
      const sinClave: Record<string, unknown> = { ...completo };
      delete sinClave[campo];
      assert.deepEqual(editar(sinClave), {
        ok: false, error: `Faltan campos del formulario del lead: ${campo}. No se modifico nada.`,
      }, campo);
      assert.deepEqual(editar({ ...completo, [campo]: undefined }), {
        ok: false, error: `Faltan campos del formulario del lead: ${campo}. No se modifico nada.`,
      }, `${campo} undefined`);
    }
  });

  test("el formulario completo se acepta tal cual", () => {
    const r = editar(completo);
    assert.ok(r.ok);
    if (r.ok) assert.deepEqual(r.datos, completo);
  });

  test("un campo PRESENTE y vacio ('' o null) si limpia el dato", () => {
    const r = editar({ ...completo, telefono: "", email: null, tipoDoc: "", documento: null, notas: "" });
    assert.ok(r.ok);
    if (r.ok) {
      assert.equal(r.datos.telefono, "");
      assert.equal(r.datos.email, "");
      assert.equal(r.datos.tipoDoc, "");
      assert.equal(r.datos.documento, "");
      assert.equal(r.datos.notas, "");
      assert.equal(r.datos.interes, "Cartagena", "lo no tocado se conserva");
    }
  });

  test("las reglas comunes siguen aplicando: clave desconocida, no texto, documento, responsable", () => {
    assert.deepEqual(editar({ ...completo, tenant: "minorista" }), { ok: false, error: "Campos no admitidos: tenant." });
    assert.deepEqual(editar({ ...completo, notas: 5 }), { ok: false, error: "El campo notas debe ser texto." });
    assert.deepEqual(editar({ ...completo, tipoDoc: "CC2" }), { ok: false, error: "Tipo de documento invalido." });
    assert.deepEqual(editar({ ...completo, tipoDoc: "" }), {
      ok: false, error: "Indica el tipo de documento: el numero solo no identifica a la persona.",
    });
    assert.deepEqual(editar({ ...completo, responsableId: "x" }), { ok: false, error: "Responsable invalido." });
    assert.deepEqual(editar(null), { ok: false, error: "Datos del lead invalidos." });
  });
});

