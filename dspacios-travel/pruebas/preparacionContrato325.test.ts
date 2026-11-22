import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { documentoPasajeroAdmitido, errorDocumentoTitular } from "../lib/personas/tiposDocumento.ts";
import { errorPasajerosAliado, maxPasajerosAdicionales, mensajeErrorPasajeros, pasajeroAliadoVacio, sinFilasVacias, type PasajeroAliado } from "../lib/portal/preparacionContrato.ts";
import { puedeListarAsesores } from "../lib/cotizacion/asesoresConversion.ts";

const leer = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const p = (o: Partial<PasajeroAliado>): PasajeroAliado => ({ ...pasajeroAliadoVacio(), nombres: "Ana", apellidos: "Gómez", ...o });

describe("O-3 · documento: entrada y conversión usan la misma regla", () => {
  test("pasajero: solo dígitos salvo Pasaporte, ≤ 30, tipo del catálogo de pasajeros", () => {
    assert.equal(documentoPasajeroAdmitido("CE", "1234567"), true);
    assert.equal(documentoPasajeroAdmitido("CE", "E1234567"), false); // el caso del dueño: letras bajo CE
    assert.equal(documentoPasajeroAdmitido("PAS", "AB123456"), true);
    assert.equal(documentoPasajeroAdmitido("PAS", "AB-123"), false);
    assert.equal(documentoPasajeroAdmitido("PPT", "123"), false); // PPT no es tipo de pasajero (167)
    assert.equal(documentoPasajeroAdmitido("CC", "1".repeat(31)), false);
    assert.equal(documentoPasajeroAdmitido("CC", ""), true); // vacío = aún sin número
  });
  test("titular: CC/CE/TI/RC/NIT solo dígitos; PAS y PPT admiten letras; letras sin tipo piden el tipo", () => {
    assert.equal(errorDocumentoTitular("CE", "E1234567") !== null, true);
    assert.equal(errorDocumentoTitular("CE", "1234567"), null);
    assert.equal(errorDocumentoTitular("PAS", "AB123456"), null);
    assert.equal(errorDocumentoTitular("PPT", "A123"), null);
    assert.match(errorDocumentoTitular("", "A123") ?? "", /Elige el tipo de documento/);
    assert.equal(errorDocumentoTitular("", "123456"), null); // sin tipo y solo dígitos: no se bloquea (D-6: no se inventa «CC»)
    assert.equal(errorDocumentoTitular("CC", ""), null);
  });
  test("cualquier documento que acepta el titular y que la conversión recibe como pasajero 1 pasa la regla del pasajero (o queda por capturar)", () => {
    for (const [t, n] of [["CC", "10203"], ["CE", "99887"], ["TI", "1"], ["RC", "22"], ["PAS", "XY99"]] as const) {
      assert.equal(errorDocumentoTitular(t, n), null);
      assert.equal(documentoPasajeroAdmitido(t, n), true, `${t} ${n}`);
    }
  });
});

describe("O-3 · pasajeros adicionales del aliado", () => {
  const hoy = "2026-11-21";
  test("nombres y apellidos obligatorios; el resto opcional", () => {
    assert.equal(errorPasajerosAliado([p({})], hoy), null);
    assert.match(errorPasajerosAliado([p({ apellidos: "" })], hoy) ?? "", /Pasajero 1: nombres y apellidos/);
    assert.match(errorPasajerosAliado([p({}), p({ nombres: " " })], hoy) ?? "", /Pasajero 2/);
  });
  test("número sin tipo, tipo inválido, letras bajo CC y fecha futura se rechazan", () => {
    assert.match(errorPasajerosAliado([p({ numeroDoc: "123" })], hoy) ?? "", /elige el tipo/);
    assert.match(errorPasajerosAliado([p({ tipoDoc: "NIT", numeroDoc: "123" })], hoy) ?? "", /tipo de documento inválido/);
    assert.match(errorPasajerosAliado([p({ tipoDoc: "CC", numeroDoc: "A12" })], hoy) ?? "", /solo números/);
    assert.match(errorPasajerosAliado([p({ fechaNacimiento: "2030-01-01" })], hoy) ?? "", /fecha de nacimiento/);
    assert.equal(errorPasajerosAliado([p({ tipoDoc: "PAS", numeroDoc: "AB12", fechaNacimiento: "1990-05-05" })], hoy), null);
  });
  test("las filas totalmente vacías se descartan; una fila a medias NO", () => {
    assert.equal(sinFilasVacias([pasajeroAliadoVacio(), p({}), pasajeroAliadoVacio()]).length, 1);
    assert.equal(sinFilasVacias([p({ nombres: "", apellidos: "", numeroDoc: "12" })]).length, 1);
    assert.match(errorPasajerosAliado(sinFilasVacias([p({ nombres: "", apellidos: "", numeroDoc: "12", tipoDoc: "CC" })]), hoy) ?? "", /nombres y apellidos/);
  });
  test("cupo: viajeros cotizados menos el titular", () => {
    assert.equal(maxPasajerosAdicionales(1), 0);
    assert.equal(maxPasajerosAdicionales(2), 1);
    assert.equal(maxPasajerosAdicionales(4), 3);
    assert.equal(maxPasajerosAdicionales(null), 0);
  });
  test("mensajes de la base", () => {
    assert.equal(mensajeErrorPasajeros("F4720", "F4720: pasajero 1: tipo de documento inválido."), "pasajero 1: tipo de documento inválido.");
    assert.match(mensajeErrorPasajeros("F4703", ""), /ya es un contrato/);
    assert.match(mensajeErrorPasajeros("XX", ""), /No pudimos guardar/);
  });
});

describe("O-3 · selector de asesor para administración/gerencia/operaciones", () => {
  const u = (rol: string, tenant = "mayorista", activo = true) => ({ rol, activo, tenant });
  test("solo roles que convierten sin ser asesor, activos y de la MISMA agencia", () => {
    for (const r of ["administracion", "gerencia", "operaciones"]) assert.equal(puedeListarAsesores(u(r), "mayorista"), true, r);
    for (const r of ["venta", "superadmin", "agencia", "freelance", "cliente_final", "control_vuelo"]) assert.equal(puedeListarAsesores(u(r), "mayorista"), false, r);
    assert.equal(puedeListarAsesores(u("administracion", "minorista"), "mayorista"), false); // otra agencia
    assert.equal(puedeListarAsesores(u("administracion", "mayorista", false), "mayorista"), false); // inactivo
    assert.equal(puedeListarAsesores(null, "mayorista"), false);
    assert.equal(puedeListarAsesores(u("administracion"), null), false);
  });
  test("la lectura de la lista está acotada: solo nombre y correo de venta activos de la agencia", () => {
    const f = leer("lib/cotizacion/asesoresConversion.ts");
    assert.match(f, /\.select\("nombre, email"\)\.eq\("rol", "venta"\)\.eq\("activo", true\)\.eq\("tenant", tenant\)/);
    assert.doesNotMatch(f, /select\("\*"\)/);
  });
});

describe("O-3 · cableado", () => {
  test("el checkout valida el documento del titular con la regla de la conversión (solicitud y comparativa) y en pantalla", () => {
    const a = leer("app/tarifario/checkout/actions.ts");
    assert.equal((a.match(/errorDocumentoTitular\(tipoDoc\.tipo \?\? ""/g) ?? []).length, 2);
    assert.match(leer("app/tarifario/checkout/page.tsx"), /errorDocumentoTitular\(c\.tipoDoc, c\.numeroDoc\)/);
  });
  test("la conversión precarga los pasajeros del aliado y comprueba el documento antes de enviar", () => {
    const c = leer("app/(dashboard)/dashboard/cotizaciones/[id]/ConvertirCarritoBtn.tsx");
    assert.match(c, /pasajerosAliado\[i - 1\]/);
    assert.match(c, /documentoPasajeroAdmitido\(p\.tipoDoc, p\.numeroDoc\)/);
    const pg = leer("app/(dashboard)/dashboard/cotizaciones/[id]/page.tsx");
    assert.match(pg, /pasajerosAliado=\{pasAliadoFila\?\.pasajeros \?\? \[\]\}/);
    assert.match(pg, /puedeListarAsesores\(perfil \?\? null, c\.tenant \?\? null\)/);
  });
  test("las acciones del aliado salen de la sesión (nunca un id de aliado del navegador) y la evidencia no toca pagos", () => {
    const a = leer("app/portal/b2b/cotizaciones/preparacion-actions.ts");
    assert.match(a, /resolverContextoPortal\(\)/);
    const sinComentarios = a.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
    assert.doesNotMatch(sinComentarios, /abonos|cotizacion_pagos_previos|registrar_abono/);
    assert.match(a, /p_actor: ctx\.userId/);
  });
  test("la migración 325 no escribe pagos ni abonos y deja el bucket sin policies", () => {
    const m = leer("supabase/migrations/20260601000325_evidencia_y_pasajeros_aliado_cotizacion.sql");
    assert.doesNotMatch(m.replace(/--.*$/gm, ""), /insert into public\.(abonos|cotizacion_pagos_previos)|update public\.(abonos|ventas)/);
    assert.doesNotMatch(m, /create policy[^;]*storage\.objects/);
    assert.match(m, /f4710|F4710/);
  });
});

describe("R325-1 · el traspaso de pasajeros del aliado llega a toda vía de conversión donde se ofrece la captura", () => {
  test("regla de captura: solo carrito y tarifario SIN pasajeros previos; dinámica/manual y las que ya traen pasajeros se dicen antes de guardar", async () => {
    const { capturaPasajerosAliado, MOTIVO_SIN_CAPTURA, MOTIVO_YA_TRAE_PASAJEROS } = await import("../lib/portal/preparacionContrato.ts");
    assert.deepEqual(capturaPasajerosAliado("carrito", 0), { ok: true });
    assert.deepEqual(capturaPasajerosAliado("tarifario", 0), { ok: true });
    assert.deepEqual(capturaPasajerosAliado("manual", 0), { ok: false, motivo: MOTIVO_SIN_CAPTURA });
    assert.deepEqual(capturaPasajerosAliado("comparativa_manual", 0), { ok: false, motivo: MOTIVO_SIN_CAPTURA });
    assert.deepEqual(capturaPasajerosAliado(null, 0), { ok: false, motivo: MOTIVO_SIN_CAPTURA });
    assert.deepEqual(capturaPasajerosAliado("tarifario", 2), { ok: false, motivo: MOTIVO_YA_TRAE_PASAJEROS });
    assert.deepEqual(capturaPasajerosAliado("carrito", 1), { ok: false, motivo: MOTIVO_YA_TRAE_PASAJEROS });
  });
  test("la base aplica la misma regla (F4722/F4723) y los mensajes de esos códigos llegan al aliado", async () => {
    const m = leer("supabase/migrations/20260601000325_evidencia_y_pasajeros_aliado_cotizacion.sql");
    assert.match(m, /c\.tipo not in \('carrito', 'tarifario'\)/);
    assert.match(m, /F4722/); assert.match(m, /F4723/);
    const { mensajeErrorPasajeros } = await import("../lib/portal/preparacionContrato.ts");
    assert.equal(mensajeErrorPasajeros("F4722", "F4722: esta cotización se convierte con el titular."), "esta cotización se convierte con el titular.");
    assert.equal(mensajeErrorPasajeros("F4723", "F4723: ya trae sus pasajeros."), "ya trae sus pasajeros.");
  });
  test("la página carga la lista para el carrito Y para el tarifario, y CotizacionAcciones la precarga solo si la cotización no trae pasajeros", () => {
    const pg = leer("app/(dashboard)/dashboard/cotizaciones/[id]/page.tsx");
    assert.match(pg, /\(esCarrito \|\| c\.tipo === "tarifario"\)/);
    assert.match(pg, /pasajerosAliado=\{tienePasajeros \? \[\] : \(pasAliadoFila\?\.pasajeros \?\? \[\]\)\}/);
    const ca = leer("app/(dashboard)/dashboard/cotizaciones/[id]/CotizacionAcciones.tsx");
    assert.match(ca, /pasajerosAliado\[i - 1\]\?\.nombres/);
    assert.match(ca, /pasajerosAliado\[i - 1\]\?\.fechaNacimiento/);
    assert.match(ca, /Math\.max\(1, pax \|\| 1, 1 \+ pasajerosAliado\.length\)/);
    assert.match(ca, /documentoPasajeroAdmitido\(p\.tipoDoc, p\.numeroDoc\)/);
  });
  test("R325-3: la página pasa la fecha de salida y CotizacionAcciones ofrece el responsable del infante con las funciones compartidas, sin elegirlo por nadie", () => {
    const pg = leer("app/(dashboard)/dashboard/cotizaciones/[id]/page.tsx");
    assert.match(pg, /fechaReferencia=\{c\.fecha_salida \?\? /);
    const ca = leer("app/(dashboard)/dashboard/cotizaciones/[id]/CotizacionAcciones.tsx");
    assert.match(ca, /esInfantePorEdad\(p\.fechaNacimiento, fechaReferencia\)/);
    assert.match(ca, /recalcularVinculosPorEdad\(next, fechaReferencia\)/);
    assert.match(ca, /Adulto responsable \*/);
    assert.match(ca, /EDAD_ADULTO_RESPONSABLE/);
    assert.doesNotMatch(ca, /responsableIndex: \d|responsableIndex = \d/, "ningún responsable se fija por defecto");
  });
  test("el cargador decide la captura con el tipo y los pasajeros previos de cada cotización (la pantalla no deduce nada)", () => {
    const f = leer("lib/portal/preparacionContratoServidor.ts");
    assert.match(f, /select\("id, tipo, pax, pasajeros_previos:payload->pasajeros, items:payload->items, tours:payload->tours"\)/);
    assert.match(f, /capturaPasajerosAliado\(c\.tipo/);
  });
});

describe("R325-3 · el vínculo infante ↔ responsable se prevalida ANTES de gastar un consecutivo (conversión ordinaria)", () => {
  const SALIDA = "2026-12-04";
  const fila = (nombres: string, fechaNacimiento: string, responsableIndex: number | null = null) => ({ nombres, apellidos: "X", tipoDoc: "CC", numeroDoc: "1", fechaNacimiento, nacionalidad: "", esInfante: false, responsableIndex });
  const universo = (n: number) => Array.from({ length: n }, (_, i) => i + 1);
  test("la función compartida: infante sin responsable, con un adulto elegido, con un menor de edad como responsable y consigo mismo", async () => {
    const { prevalidarResponsablesDeGrupo, mensajePrevalidacionGrupo } = await import("../lib/reservar/carritoAsignaciones.ts");
    const adulto = fila("Ana", "1985-03-04"), nino = fila("Tomas", "2018-01-01");
    const sin = prevalidarResponsablesDeGrupo([adulto, nino, fila("Bebe", "2025-06-01")], universo(3), SALIDA);
    assert.equal(sin.ok, false);
    if (!sin.ok) { assert.equal(sin.motivo, "infante_sin_responsable"); assert.match(mensajePrevalidacionGrupo(sin), /infante en la posición 3 debe tener un adulto responsable.*No se creó ningún contrato/); }
    assert.equal(prevalidarResponsablesDeGrupo([adulto, nino, fila("Bebe", "2025-06-01", 0)], universo(3), SALIDA).ok, true, "con la adulta elegida pasa");
    assert.equal(prevalidarResponsablesDeGrupo([adulto, nino, fila("Bebe", "2025-06-01", 1)], universo(3), SALIDA).ok, false, "un menor de 8 no puede ser responsable");
    assert.equal(prevalidarResponsablesDeGrupo([adulto, nino, fila("Bebe", "2025-06-01", 2)], universo(3), SALIDA).ok, false, "nadie es su propio responsable");
    assert.equal(prevalidarResponsablesDeGrupo([adulto, nino], universo(2), SALIDA).ok, true, "sin infantes no se exige nada");
  });
  test("el orden en la reserva: la prevalidación va ANTES de pedir el consecutivo y con la misma fecha con la que se clasifica después (meta.fecha_ida)", () => {
    const a = leer("app/(dashboard)/dashboard/reservar/actions.ts");
    const ini = a.indexOf("async function reservarDesdeTarifarioInterno");
    const prev = a.indexOf("prevalidarResponsablesDeGrupo(input.pasajeros, input.pasajeros.map((_, i) => i + 1), meta.fecha_ida)", ini);
    const num = a.indexOf("await siguienteNumeroContrato(tenant)", ini);
    assert.ok(ini > 0 && prev > ini && num > prev, "la prevalidación debe preceder a siguienteNumeroContrato");
    assert.match(a, /input\.pasajeros\.length && meta\.fecha_ida/, "solo cuando la base también clasificaría a alguien como infante (misma condición que esInfanteReal)");
    assert.match(a, /esInfantePorEdad\(p\.fechaNacimiento, meta\.fecha_ida\)/);
  });
});
