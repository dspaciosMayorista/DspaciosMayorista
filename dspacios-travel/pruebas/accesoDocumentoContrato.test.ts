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
  activo: true,
  aliadoId: null,
  accesoLegacyNombre: false,
  ...p,
});

const contrato = (c: Partial<ContratoAcceso>): ContratoAcceso => ({
  tenant: "mayorista",
  b2bUsuarioId: null,
  aliadoId: null,
  comisionManualConFicha: false,
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

// ── Usuario DESACTIVADO: fuera por todas las vías ─────────────────────────
//
// `usuarios.activo` no lo comprueba nadie más en este camino. La RLS no
// participa (se lee con service-role), `mi_rol()` tampoco (no se llama), y
// `proxy.ts` solo rebota la navegación — el JWT de una cuenta desactivada sigue
// siendo válido hasta que expira, así que estas URLs seguirían respondiendo.
// Por eso hay una prueba por CADA vía de entrada, no una sola.

test("INACTIVO: un superadmin desactivado no entra", () => {
  const r = accesoDocumentoContrato(
    perfil({ rol: "superadmin", activo: false }),
    contrato({ tenant: "mayorista" })
  );
  assert.equal(r.permitido, false);
  assert.equal(r.via, "denegado");
});

test("INACTIVO: un interno desactivado no entra a su propia agencia", () => {
  for (const rol of ["gerencia", "administracion", "operaciones"]) {
    const r = accesoDocumentoContrato(
      perfil({ rol, tenant: "mayorista", activo: false }),
      contrato({ tenant: "mayorista" })
    );
    assert.equal(r.permitido, false, rol);
  }
});

test("INACTIVO: el que compró desde el portal no entra si lo desactivan", () => {
  const r = accesoDocumentoContrato(
    perfil({ id: "u-9", rol: "freelance", activo: false }),
    contrato({ b2bUsuarioId: "u-9" })
  );
  assert.equal(r.permitido, false);
});

test("INACTIVO: el aliado enlazado por aliado_id no entra si lo desactivan", () => {
  const r = accesoDocumentoContrato(
    perfil({ rol: "operaciones", tenant: "mayorista", aliadoId: 7, activo: false }),
    contrato({ tenant: "minorista", aliadoId: 7 })
  );
  assert.equal(r.permitido, false);
});

test("INACTIVO: el respaldo legacy por nombre tampoco lo deja entrar", () => {
  const r = accesoDocumentoContrato(
    perfil({ rol: "freelance", nombre: "Ana Gómez", activo: false, accesoLegacyNombre: true }),
    contrato({ nombreAliado: ["Ana Gómez"] })
  );
  assert.equal(r.permitido, false);
});

test("INACTIVO: `activo` en null tampoco es un sí", () => {
  // Un perfil sin valor en la columna no puede tratarse como habilitado: sería
  // exactamente el fallo que esto viene a cerrar, con otro disfraz.
  for (const rol of ["superadmin", "administracion", "freelance"]) {
    const r = accesoDocumentoContrato(
      perfil({ rol, activo: null }),
      contrato({ tenant: "mayorista" })
    );
    assert.equal(r.permitido, false, rol);
  }
});

test("CONTROL NEGATIVO: la regla anterior no miraba `activo` en absoluto", () => {
  const ROLES_VIEJOS = ["superadmin", "administracion", "gerencia", "operaciones"];
  const viejo = (rol: string) => ROLES_VIEJOS.includes(rol);

  assert.equal(viejo("administracion"), true, "la regla vieja dejaba entrar a un desactivado");
  assert.equal(
    accesoDocumentoContrato(
      perfil({ rol: "administracion", tenant: "mayorista", activo: false }),
      contrato({ tenant: "mayorista" })
    ).permitido,
    false
  );
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

test("LEGACY: sin ningún id y con la bandera concedida, el nombre sí abre el documento", () => {
  const r = accesoDocumentoContrato(
    perfil({ rol: "freelance", nombre: "Ana Gómez", accesoLegacyNombre: true }),
    contrato({ b2bUsuarioId: null, aliadoId: null, nombreAliado: [null, "Ana Gómez"] })
  );
  assert.equal(r.permitido, true);
  assert.equal(r.esDueno, true);
  assert.equal(r.via, "nombre_legacy");
});

test("LEGACY: el nombre se compara sin distinguir mayúsculas ni espacios", () => {
  const r = accesoDocumentoContrato(
    perfil({ rol: "freelance", nombre: "  ana gómez ", accesoLegacyNombre: true }),
    contrato({ nombreAliado: ["ANA GÓMEZ"] })
  );
  assert.equal(r.permitido, true);
  assert.equal(r.via, "nombre_legacy");
});

test("EL HOMÓNIMO: si el contrato tiene aliado_id, el nombre ya no cuenta", () => {
  const r = accesoDocumentoContrato(
    perfil({ rol: "freelance", nombre: "Ana Gómez", aliadoId: null, accesoLegacyNombre: true }),
    contrato({ aliadoId: 7, nombreAliado: ["Ana Gómez"] })
  );
  assert.equal(r.permitido, false, "un homónimo sin enlace no puede entrar (ni con la bandera)");
});

test("EL HOMÓNIMO: si el contrato tiene b2b_usuario_id, el nombre tampoco cuenta", () => {
  const r = accesoDocumentoContrato(
    perfil({ id: "u-8", rol: "freelance", nombre: "Ana Gómez", accesoLegacyNombre: true }),
    contrato({ b2bUsuarioId: "u-9", nombreAliado: ["Ana Gómez"] })
  );
  assert.equal(r.permitido, false);
});

test("LEGACY: un nombre vacío o nulo no empareja con nada", () => {
  for (const n of [null, "", "   "]) {
    const r = accesoDocumentoContrato(
      perfil({ rol: "freelance", nombre: n, accesoLegacyNombre: true }),
      contrato({ nombreAliado: [null, n] })
    );
    assert.equal(r.permitido, false, JSON.stringify(n));
  }
});

// ── Migración 193: "aprobar sin enlazar" = sin histórico ──────────────────

test("193 · HOMÓNIMO NUEVO: sin la bandera, el mismo nombre NO abre un contrato sin ids", () => {
  // Cuenta recién aprobada "sin enlazar" que se registró con el nombre de un
  // aliado antiguo. Antes de la 193 esto entraba por `nombre_legacy`.
  for (const rol of ["agencia", "freelance"]) {
    for (const bandera of [false, null]) {
      const r = accesoDocumentoContrato(
        perfil({ rol, nombre: "Viajes Antiguos", aliadoId: null, accesoLegacyNombre: bandera }),
        contrato({ b2bUsuarioId: null, aliadoId: null, nombreAliado: ["Viajes Antiguos", null] })
      );
      assert.equal(r.permitido, false, `${rol} con bandera ${String(bandera)}`);
    }
  }
});

test("193 · CON ENLACE APROBADO: la misma cuenta entra por aliado_id a los contratos de su ficha", () => {
  const r = accesoDocumentoContrato(
    perfil({ rol: "agencia", nombre: "Viajes Antiguos", aliadoId: 7 }),
    contrato({ aliadoId: 7, nombreAliado: ["Viajes Antiguos"] })
  );
  assert.equal(r.permitido, true);
  assert.equal(r.via, "aliado_id");
  // …pero el enlace a SU ficha no le abre un contrato sin ids por el nombre.
  assert.equal(
    accesoDocumentoContrato(
      perfil({ rol: "agencia", nombre: "Viajes Antiguos", aliadoId: 7 }),
      contrato({ aliadoId: null, nombreAliado: ["Viajes Antiguos"] })
    ).permitido,
    false
  );
});

test("193 · la bandera solo sirve a roles externos: un interno de OTRA agencia no entra por nombre", () => {
  for (const rol of ["gerencia", "administracion", "operaciones", "venta", "cliente_final"]) {
    const r = accesoDocumentoContrato(
      perfil({ rol, tenant: "mayorista", nombre: "Ana Gómez", accesoLegacyNombre: true }),
      contrato({ tenant: "minorista", nombreAliado: ["Ana Gómez"] })
    );
    assert.equal(r.permitido, false, rol);
  }
});

test("193 · CONTROL NEGATIVO: la regla anterior abría por nombre a cualquier cuenta sin ficha", () => {
  const viejo = (p: PerfilAcceso, c: ContratoAcceso) =>
    c.b2bUsuarioId == null && c.aliadoId == null &&
    c.nombreAliado.some((n) => (n ?? "").trim().toLowerCase() === (p.nombre ?? "").trim().toLowerCase() && !!n?.trim());
  const p = perfil({ rol: "agencia", nombre: "Viajes Antiguos" });
  const c = contrato({ nombreAliado: ["Viajes Antiguos"] });
  assert.equal(viejo(p, c), true, "la regla vieja dejaba entrar al homónimo");
  assert.equal(accesoDocumentoContrato(p, c).permitido, false);
});

// ── Fail-closed de la ficha en comisión manual (aliados_b2b) ───────────────

test("FICHA EN COMISIÓN MANUAL: con ficha (true) o SIN VERIFICAR (null), el nombre no abre nada", () => {
  for (const ficha of [true, null]) {
    const r = accesoDocumentoContrato(
      perfil({ rol: "agencia", nombre: "Viajes Antiguos", accesoLegacyNombre: true }),
      contrato({ comisionManualConFicha: ficha, nombreAliado: ["Viajes Antiguos"] })
    );
    assert.equal(r.permitido, false, `comisionManualConFicha=${String(ficha)}`);
  }
  // Solo un "no hay" VERIFICADO deja mirar el nombre.
  assert.equal(
    accesoDocumentoContrato(
      perfil({ rol: "agencia", nombre: "Viajes Antiguos", accesoLegacyNombre: true }),
      contrato({ comisionManualConFicha: false, nombreAliado: ["Viajes Antiguos"] })
    ).via,
    "nombre_legacy"
  );
});

test("FICHA SIN VERIFICAR no bloquea los vínculos por id ni el rol interno", () => {
  assert.equal(
    accesoDocumentoContrato(perfil({ rol: "agencia", aliadoId: 7 }), contrato({ aliadoId: 7, comisionManualConFicha: null })).via,
    "aliado_id"
  );
  assert.equal(
    accesoDocumentoContrato(perfil({ id: "u-5", rol: "freelance" }), contrato({ b2bUsuarioId: "u-5", comisionManualConFicha: null })).via,
    "b2b_usuario_id"
  );
  assert.equal(
    accesoDocumentoContrato(perfil({ rol: "operaciones" }), contrato({ comisionManualConFicha: null })).via,
    "interno_mismo_tenant"
  );
});

// ── Respaldo por nombre: tenant EXPLÍCITO e igual ──────────────────────────

test("TENANT: el nombre NO cruza Mayorista → Minorista ni Minorista → Mayorista", () => {
  for (const [tUsuario, tContrato] of [["mayorista", "minorista"], ["minorista", "mayorista"]]) {
    for (const rol of ["agencia", "freelance"]) {
      const r = accesoDocumentoContrato(
        perfil({ rol, tenant: tUsuario, nombre: "Viajes Antiguos", accesoLegacyNombre: true }),
        contrato({ tenant: tContrato, nombreAliado: ["Viajes Antiguos"] })
      );
      assert.equal(r.permitido, false, `${rol} ${tUsuario} → contrato ${tContrato}`);
    }
  }
});

test("TENANT: nulo en el usuario, en el contrato o en ambos no es 'igual'", () => {
  for (const [tUsuario, tContrato] of [[null, "mayorista"], ["mayorista", null], [null, null], ["", ""]]) {
    const r = accesoDocumentoContrato(
      perfil({ rol: "agencia", tenant: tUsuario, nombre: "Viajes Antiguos", accesoLegacyNombre: true }),
      contrato({ tenant: tContrato, nombreAliado: ["Viajes Antiguos"] })
    );
    assert.equal(r.permitido, false, `${String(tUsuario)} / ${String(tContrato)}`);
  }
});

test("TENANT: mismo tenant explícito sí, en las dos agencias", () => {
  for (const t of ["mayorista", "minorista"]) {
    const r = accesoDocumentoContrato(
      perfil({ rol: "freelance", tenant: t, nombre: "Viajes Antiguos", accesoLegacyNombre: true }),
      contrato({ tenant: t, nombreAliado: [null, "Viajes Antiguos"] })
    );
    assert.equal(r.via, "nombre_legacy", t);
  }
});

test("TENANT: los vínculos por id y superadmin siguen cruzando agencias como antes", () => {
  assert.equal(
    accesoDocumentoContrato(perfil({ rol: "agencia", tenant: "mayorista", aliadoId: 7 }), contrato({ tenant: "minorista", aliadoId: 7 })).via,
    "aliado_id"
  );
  assert.equal(
    accesoDocumentoContrato(perfil({ id: "u-9", rol: "agencia", tenant: "mayorista" }), contrato({ tenant: "minorista", b2bUsuarioId: "u-9" })).via,
    "b2b_usuario_id"
  );
  assert.equal(
    accesoDocumentoContrato(perfil({ rol: "superadmin", tenant: "mayorista" }), contrato({ tenant: "minorista" })).via,
    "superadmin"
  );
  // …y el id cruza aunque el usuario no tenga tenant.
  assert.equal(
    accesoDocumentoContrato(perfil({ rol: "agencia", tenant: null, aliadoId: 7 }), contrato({ tenant: "minorista", aliadoId: 7 })).via,
    "aliado_id"
  );
});

test("CONTROL NEGATIVO (193): pasar el nombre de la comisión manual habría abierto la cuenta de cobro", () => {
  // Así llamaba antes `comisionResolver` (ventas + aliados_b2b.aliado). Con
  // ventas sin nombre y la comisión con el del aliado, el nombre abría.
  const p = perfil({ rol: "agencia", nombre: "Viajes Antiguos", accesoLegacyNombre: true });
  assert.equal(accesoDocumentoContrato(p, contrato({ nombreAliado: [null, null, "Viajes Antiguos"] })).permitido, true);
  // Hoy los cargadores pasan SOLO los de ventas (ver documentosContrato.wiring).
  assert.equal(accesoDocumentoContrato(p, contrato({ nombreAliado: [null, null] })).permitido, false);
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
