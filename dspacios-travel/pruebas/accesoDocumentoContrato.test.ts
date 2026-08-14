import { test } from "node:test";
import assert from "node:assert/strict";
import {
  accesoDocumentoContrato,
  type ContratoAcceso,
  type PerfilAcceso,
} from "../lib/auth/accesoDocumentoContrato.ts";

// ───────────────────────────────────────────────────────────────────────────
// Quién puede abrir por URL la cuenta de cobro, el estado de cuenta, el plan de
// cobro y el recibo de un contrato.
//
// Estas páginas se sirven con service-role, así que la RLS no participa: esta
// función ES la autorización. Por eso las pruebas están escritas casi todas en
// negativo — lo que importa no es que el dueño entre, sino que no entre nadie
// más.
// ───────────────────────────────────────────────────────────────────────────

const perfil = (p: Partial<PerfilAcceso>): PerfilAcceso => ({
  id: "u-1",
  rol: "operaciones",
  tenant: "mayorista",
  nombre: "Persona",
  aliadoId: null,
  ...p,
});

const contrato = (c: Partial<ContratoAcceso>): ContratoAcceso => ({
  tenant: "mayorista",
  b2bUsuarioId: null,
  aliadoId: null,
  nombreAliado: [],
  ...c,
});

// ── superadmin ────────────────────────────────────────────────────────────

test("superadmin entra a cualquier contrato, de cualquier agencia", () => {
  for (const t of ["mayorista", "minorista"]) {
    const r = accesoDocumentoContrato(
      perfil({ rol: "superadmin", tenant: "mayorista" }),
      contrato({ tenant: t })
    );
    assert.equal(r.permitido, true, t);
    assert.equal(r.esInterno, true);
    assert.equal(r.via, "superadmin");
  }
});

// ── Roles internos: su agencia sí, la otra no ─────────────────────────────

for (const rol of ["gerencia", "administracion", "operaciones"]) {
  test(`${rol} entra a un contrato de SU agencia`, () => {
    const r = accesoDocumentoContrato(
      perfil({ rol, tenant: "mayorista" }),
      contrato({ tenant: "mayorista" })
    );
    assert.equal(r.permitido, true);
    assert.equal(r.esInterno, true);
    assert.equal(r.via, "interno_mismo_tenant");
  });

  test(`${rol} NO entra a un contrato de la OTRA agencia`, () => {
    const r = accesoDocumentoContrato(
      perfil({ rol, tenant: "mayorista" }),
      contrato({ tenant: "minorista" })
    );
    assert.equal(r.permitido, false, `${rol} alcanzó la otra agencia`);
    assert.equal(r.via, "denegado");
  });
}

test("`venta` no entra por su rol ni siquiera en su propia agencia", () => {
  // Deliberado: no está en ROLES_CARTERA, igual que antes de este cambio.
  const r = accesoDocumentoContrato(
    perfil({ rol: "venta", tenant: "mayorista" }),
    contrato({ tenant: "mayorista" })
  );
  assert.equal(r.permitido, false);
});

test("un rol externo sin vínculo no entra", () => {
  for (const rol of ["agencia", "freelance", "cliente_final"]) {
    const r = accesoDocumentoContrato(perfil({ rol }), contrato({}));
    assert.equal(r.permitido, false, rol);
  }
});

test("sin sesión o sin perfil, no entra", () => {
  assert.equal(accesoDocumentoContrato(null, contrato({})).permitido, false);
  assert.equal(accesoDocumentoContrato(perfil({ rol: null }), contrato({})).permitido, false);
});

test("un interno sin tenant no entra por rol (no se asume 'mayorista')", () => {
  // `mi_tenant()` en SQL cae a 'mayorista' por defecto; aquí no se imita eso:
  // un perfil sin agencia no debe abrir la cartera de ninguna.
  const r = accesoDocumentoContrato(
    perfil({ rol: "administracion", tenant: null }),
    contrato({ tenant: "mayorista" })
  );
  assert.equal(r.permitido, false);
});

// ── Dueño B2B por id ──────────────────────────────────────────────────────

test("quien compró desde el portal entra por b2b_usuario_id", () => {
  const r = accesoDocumentoContrato(
    perfil({ id: "u-9", rol: "freelance", tenant: "mayorista" }),
    contrato({ tenant: "minorista", b2bUsuarioId: "u-9" })
  );
  assert.equal(r.permitido, true);
  assert.equal(r.esDueno, true);
  assert.equal(r.esInterno, false);
  assert.equal(r.via, "b2b_usuario_id");
});

test("otro usuario NO entra con el b2b_usuario_id de un tercero", () => {
  const r = accesoDocumentoContrato(
    perfil({ id: "u-8", rol: "freelance" }),
    contrato({ b2bUsuarioId: "u-9" })
  );
  assert.equal(r.permitido, false);
});

test("EL CASO REAL: operaciones de mayorista, enlazada por aliado_id a un contrato B2B de minorista", () => {
  const r = accesoDocumentoContrato(
    perfil({ rol: "operaciones", tenant: "mayorista", aliadoId: 7 }),
    contrato({ tenant: "minorista", aliadoId: 7 })
  );
  // Entra, pero COMO ALIADA. Su rol interno no le da nada en la otra agencia:
  // `esInterno` en false es lo que impide que el documento la trate como
  // personal de minorista.
  assert.equal(r.permitido, true);
  assert.equal(r.esDueno, true);
  assert.equal(r.esInterno, false, "no puede entrar como interna a la otra agencia");
  assert.equal(r.via, "aliado_id");
});

test("la misma persona, en un contrato de SU agencia y además siendo la aliada, sale con las dos marcas", () => {
  const r = accesoDocumentoContrato(
    perfil({ rol: "operaciones", tenant: "mayorista", aliadoId: 7 }),
    contrato({ tenant: "mayorista", aliadoId: 7 })
  );
  assert.equal(r.permitido, true);
  assert.equal(r.esDueno, true);
  assert.equal(r.esInterno, true);
});

test("un aliado_id que no coincide no abre nada", () => {
  const r = accesoDocumentoContrato(
    perfil({ rol: "freelance", tenant: "mayorista", aliadoId: 7 }),
    contrato({ tenant: "minorista", aliadoId: 8 })
  );
  assert.equal(r.permitido, false);
});

test("un usuario SIN aliado_id no entra a un contrato que sí lo tiene", () => {
  const r = accesoDocumentoContrato(
    perfil({ rol: "freelance", aliadoId: null }),
    contrato({ tenant: "minorista", aliadoId: 7 })
  );
  assert.equal(r.permitido, false);
});

test("dos nulls no se emparejan entre sí", () => {
  // Si `aliadoId` null en los dos lados contara como coincidencia, cualquier
  // usuario sin ficha entraría a cualquier contrato sin ficha.
  const r = accesoDocumentoContrato(
    perfil({ rol: "freelance", aliadoId: null }),
    contrato({ tenant: "minorista", aliadoId: null })
  );
  assert.equal(r.permitido, false);
});

// ── Respaldo legacy por nombre ────────────────────────────────────────────

test("LEGACY: sin ningún id, el nombre sí abre el documento", () => {
  const r = accesoDocumentoContrato(
    perfil({ rol: "freelance", nombre: "Ana Gómez" }),
    contrato({ b2bUsuarioId: null, aliadoId: null, nombreAliado: [null, "Ana Gómez"] })
  );
  assert.equal(r.permitido, true);
  assert.equal(r.esDueno, true);
  assert.equal(r.via, "nombre_legacy");
});

test("LEGACY: el nombre se compara sin distinguir mayúsculas ni espacios", () => {
  const r = accesoDocumentoContrato(
    perfil({ rol: "freelance", nombre: "  ana gómez " }),
    contrato({ nombreAliado: ["ANA GÓMEZ"] })
  );
  assert.equal(r.permitido, true);
  assert.equal(r.via, "nombre_legacy");
});

test("EL HOMÓNIMO: si el contrato tiene aliado_id, el nombre ya no cuenta", () => {
  const r = accesoDocumentoContrato(
    perfil({ rol: "freelance", nombre: "Ana Gómez", aliadoId: null }),
    contrato({ aliadoId: 7, nombreAliado: ["Ana Gómez"] })
  );
  assert.equal(r.permitido, false, "un homónimo sin enlace no puede entrar");
});

test("EL HOMÓNIMO: si el contrato tiene b2b_usuario_id, el nombre tampoco cuenta", () => {
  const r = accesoDocumentoContrato(
    perfil({ id: "u-8", rol: "freelance", nombre: "Ana Gómez" }),
    contrato({ b2bUsuarioId: "u-9", nombreAliado: ["Ana Gómez"] })
  );
  assert.equal(r.permitido, false);
});

test("LEGACY: un nombre vacío o nulo no empareja con nada", () => {
  for (const n of [null, "", "   "]) {
    const r = accesoDocumentoContrato(
      perfil({ rol: "freelance", nombre: n }),
      contrato({ nombreAliado: [null, n] })
    );
    assert.equal(r.permitido, false, JSON.stringify(n));
  }
});

// ── Control negativo: el comportamiento viejo ─────────────────────────────

test("CONTROL NEGATIVO: la regla anterior sí dejaba pasar entre agencias", () => {
  // Reimplementa lo que hacían las dos copias antes de unificarlas, para dejar
  // constancia de que el agujero era real y de qué lo tapaba.
  const ROLES_VIEJOS = ["superadmin", "administracion", "gerencia", "operaciones"];
  // El tenant no aparece en la firma justamente porque la regla vieja no lo
  // miraba: le bastaba el rol para dar acceso a las dos agencias.
  const viejo = (rol: string) => ROLES_VIEJOS.includes(rol);

  assert.equal(viejo("operaciones"), true, "la regla vieja daba acceso solo por el rol");
  assert.equal(
    accesoDocumentoContrato(
      perfil({ rol: "operaciones", tenant: "mayorista" }),
      contrato({ tenant: "minorista" })
    ).permitido,
    false
  );
});

test("CONTROL NEGATIVO: la regla anterior dejaba entrar a un homónimo aunque hubiera aliado_id", () => {
  const viejo = (nombreUsuario: string, nombresContrato: (string | null)[]) =>
    nombresContrato.includes(nombreUsuario);

  assert.equal(viejo("Ana Gómez", ["Ana Gómez"]), true);
  assert.equal(
    accesoDocumentoContrato(
      perfil({ rol: "freelance", nombre: "Ana Gómez" }),
      contrato({ aliadoId: 7, nombreAliado: ["Ana Gómez"] })
    ).permitido,
    false
  );
});
