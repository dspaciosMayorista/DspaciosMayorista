import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { origenDeCotizacion } from "../lib/portal/origenCotizacion.ts";
import { universoDeViajeros, puedeAgregarFila, topeAdicionales, topeDeFilas, notaUniverso } from "../lib/reservar/universoViajeros.ts";
import { resumenPasajeroAliado, pasajeroAliadoVacio } from "../lib/portal/preparacionContrato.ts";

const leer = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const ALIADA = "camila@aliado.test";

describe("Corrección 1 · origen real de la cotización (no NETO/PVP ni plan congelado)", () => {
  test("la creó el aliado en NETO (plan congelado, origen aliado_directo) ⇒ directa", () => {
    assert.equal(origenDeCotizacion({ creado_por: ALIADA, tiene_plan: true, origen_plan: "aliado_directo", rol_plan: "freelance" }, ALIADA), "directa");
  });
  test("la creó el aliado en comisión (mismo sello) ⇒ directa", () => {
    assert.equal(origenDeCotizacion({ creado_por: ALIADA, tiene_plan: true, origen_plan: "aliado_directo", rol_plan: "agencia" }, ALIADA), "directa");
  });
  test("la armó el personal para el aliado (origen asistida) ⇒ asistida, aunque el aliado figure como autor por coincidencia de correo", () => {
    assert.equal(origenDeCotizacion({ creado_por: "administracion@dspacios.test", tiene_plan: true, origen_plan: "asistida", rol_plan: "administracion" }, ALIADA), "asistida");
    assert.equal(origenDeCotizacion({ creado_por: ALIADA, tiene_plan: true, origen_plan: "asistida", rol_plan: "administracion" }, ALIADA), "asistida", "el sello del servidor manda sobre el autor");
  });
  test("plan de formato anterior (sin origen): lo selló el personal ⇒ asistida; si quien lo selló fue un rol de aliado ⇒ directa; sin rol ⇒ asistida", () => {
    assert.equal(origenDeCotizacion({ creado_por: null, tiene_plan: true, rol_plan: "administracion" }, ALIADA), "asistida");
    assert.equal(origenDeCotizacion({ creado_por: ALIADA, tiene_plan: true, rol_plan: "freelance" }, ALIADA), "directa");
    assert.equal(origenDeCotizacion({ creado_por: ALIADA, tiene_plan: true }, ALIADA), "asistida", "conservador: lo único que existía antes del campo era la asistencia");
  });
  test("valor desconocido en origen ⇒ asistida (nunca se infiere «directa» de un dato que el servidor no escribió)", () => {
    assert.equal(origenDeCotizacion({ creado_por: ALIADA, tiene_plan: true, origen_plan: "otra-cosa" }, ALIADA), "asistida");
  });
  test("sin plan: es del aliado solo si la creó su sesión; de otra persona no es suya por esta vía", () => {
    assert.equal(origenDeCotizacion({ creado_por: ALIADA.toUpperCase(), tiene_plan: false }, ALIADA), "directa");
    assert.equal(origenDeCotizacion({ creado_por: "otro@x.test", tiene_plan: false }, ALIADA), null);
    assert.equal(origenDeCotizacion({ creado_por: ALIADA, tiene_plan: false }, null), null);
  });

  test("el clasificador del portal usa la función pura y deduplica por id (una sola lista)", () => {
    const src = leer("lib/portal/b2bPortalServidor.ts");
    assert.match(src, /origenDeCotizacion\(/);
    assert.match(src, /porId\.has\(c\.id\)/);
    assert.doesNotMatch(src, /el plan congelado manda sobre el autor/, "la regla anterior (plan ⇒ siempre asistida) ya no existe");
    assert.doesNotMatch(src, /idsAsistidas/);
  });
  test("el sello «origen» lo escribe el servidor a partir de la sesión (no del navegador)", () => {
    const src = leer("app/tarifario/checkout/actions.ts");
    assert.match(src, /origenB2B = "aliado_directo"; captura = "aliado_directo"/);
    assert.match(src, /let origenB2B: OrigenPlanB2B \| undefined = b2bAsistido \? "asistida" : undefined/);
  });
});

describe("Corrección 3 · universo declarado de viajeros y «Agregar pasajero»", () => {
  test("cotización ordinaria / una sola unidad ⇒ universo exacto = pax", () => {
    assert.deepEqual(universoDeViajeros(3), { tipo: "exacto", n: 3 });
    assert.deepEqual(universoDeViajeros(2, [{ pax: 2 }]), { tipo: "exacto", n: 2 });
    assert.deepEqual(universoDeViajeros(2, [{ pax: 2 }, { pax: 2, vinculada: true }]), { tipo: "exacto", n: 2 }, "un tour vinculado a un hotel viaja con ese hotel");
  });
  test("dos unidades independientes ⇒ ambiguo: ni máximo ni suma como «universo»; la suma es solo cota de seguridad", () => {
    const u = universoDeViajeros(2, [{ pax: 2 }, { pax: 2 }]);
    assert.deepEqual(u, { tipo: "ambiguo", minimo: 2, tope: 4, unidades: 2 });
    assert.equal(topeAdicionales(u), 3);
    assert.equal(puedeAgregarFila(u, 2), true, "con 2 filas todavía cabe (el máximo habría dicho que no)");
    assert.equal(puedeAgregarFila(u, 4), false);
  });
  test("exacto: se oculta al llegar al universo y reaparece al bajar", () => {
    const u = universoDeViajeros(3);
    assert.equal(puedeAgregarFila(u, 2), true);
    assert.equal(puedeAgregarFila(u, 3), false);
    assert.equal(puedeAgregarFila(u, 2), true);
    assert.equal(topeDeFilas(u), 3); assert.equal(topeAdicionales(u), 2);
  });
  test("valores raros no rompen: pax nulo/0/NaN ⇒ al menos el titular", () => {
    assert.deepEqual(universoDeViajeros(null), { tipo: "exacto", n: 1 });
    assert.deepEqual(universoDeViajeros(0, [{ pax: Number.NaN }]), { tipo: "exacto", n: 1 });
    assert.equal(puedeAgregarFila(universoDeViajeros(1), 1), false);
  });
  test("la nota explica por qué no hay botón (exacto y cota) y avisa la ambigüedad mientras se puede agregar", () => {
    assert.match(notaUniverso(universoDeViajeros(2), 2) ?? "", /Ya están todos los viajeros/);
    const amb = universoDeViajeros(2, [{ pax: 2 }, { pax: 2 }]);
    assert.match(notaUniverso(amb, 4) ?? "", /cota máxima/);
    assert.match(notaUniverso(amb, 2) ?? "", /2 servicios independientes/);
    assert.equal(notaUniverso(universoDeViajeros(3), 1), null);
  });
  test("la migración 326 aplica la misma regla que la función pura (unidades independientes, hotelRef, cota = suma)", () => {
    const sql = leer("supabase/migrations/20260601000326_pasajeros_aliado_tope_universo.sql");
    assert.match(sql, /coalesce\(nullif\(t ->> 'hotelRef', ''\), ''\) = ''/);
    assert.match(sql, /case when v_unidades >= 2 then greatest\(v_suma, coalesce\(c\.pax, 1\)\) else greatest\(coalesce\(c\.pax, 1\), v_maximo\) end\) - 1/);
    assert.match(sql, /revoke all on function public\.cotizacion_pasajeros_aliado_guardar\(bigint, uuid, jsonb\) from public, anon, authenticated;/);
    assert.doesNotMatch(sql, /^\s*(create|alter|drop) table/im, "la 326 no toca tablas");
  });
  test("el servidor del portal calcula el universo con las unidades del carrito y lo manda al panel", () => {
    const src = leer("lib/portal/preparacionContratoServidor.ts");
    assert.match(src, /universoDeViajeros\(c\.pax, unidades\)/);
    assert.match(src, /vinculada: typeof t\?\.hotelRef === "string"/);
  });
});

describe("Corrección 2 · resumen compacto del pasajero del aliado", () => {
  test("completo: título, detalle y sin faltantes; incompleto: lista exactamente lo que falta", () => {
    const ok = resumenPasajeroAliado({ ...pasajeroAliadoVacio(), nombres: "Marco ", apellidos: "Vega", tipoDoc: "CE", numeroDoc: "7654321", fechaNacimiento: "1987-02-02" });
    assert.deepEqual(ok, { titulo: "Marco Vega", detalle: "CE 7654321 · nac. 1987-02-02", faltan: [] });
    assert.deepEqual(resumenPasajeroAliado({ ...pasajeroAliadoVacio(), nombres: "Luz", apellidos: "R" }).faltan, ["documento", "nacimiento"]);
    assert.deepEqual(resumenPasajeroAliado(pasajeroAliadoVacio()).faltan, ["nombre y apellido", "documento", "nacimiento"]);
  });
});

describe("Corrección 2 · los mensajes nombran al pasajero con el MISMO número que rotula la pantalla", () => {
  test("el panel del aliado rotula desde «Pasajero 2» (el titular es el 1): el mensaje usa ese número; por defecto sigue contando desde 1", async () => {
    const { errorPasajerosAliado } = await import("../lib/portal/preparacionContrato.ts");
    const v = { ...pasajeroAliadoVacio(), nombres: "Ana", apellidos: "Gómez" };
    assert.match(errorPasajerosAliado([{ ...v, apellidos: "" }], "2026-11-21", 2) ?? "", /^Pasajero 2:/);
    assert.match(errorPasajerosAliado([v, { ...v, nombres: "" }], "2026-11-21", 2) ?? "", /^Pasajero 3:/);
    assert.match(errorPasajerosAliado([{ ...v, apellidos: "" }], "2026-11-21") ?? "", /^Pasajero 1:/);
    assert.match(leer("components/portal/PanelPreparacionContrato.tsx"), /errorPasajerosAliado\(lista, hoy, 2\)/);
    assert.match(leer("app/portal/b2b/cotizaciones/preparacion-actions.ts"), /errorPasajerosAliado\(lista, hoyBogota\(\), 2\)/);
  });
});

describe("R326-1 · capacidad OFRECIDA = capacidad que se puede GUARDAR (límite técnico de 30), sin confundirla con el universo", () => {
  test("dos servicios independientes de 16: el universo llega a 31 adicionales, pero la captura ofrece 30 (frontera y una más)", async () => {
    const m = await import("../lib/reservar/universoViajeros.ts");
    const u = m.universoDeViajeros(16, [{ pax: 16 }, { pax: 16 }]);
    assert.equal(m.topeAdicionales(u), 31, "el universo (cota) sigue siendo 31");
    assert.equal(m.capacidadCaptura(u), 30);
    assert.equal(m.superaLimiteCaptura(u), true);
    assert.equal(m.puedeAgregarCaptura(u, 30), true, "29 adicionales: aún cabe uno");
    assert.equal(m.puedeAgregarCaptura(u, 31), false, "30 adicionales: frontera, se ocultó");
    assert.equal(m.puedeAgregarCaptura(u, 32), false, "31: nunca se ofrece");
    assert.equal(m.puedeAgregarFila(u, 31), true, "la pantalla del PERSONAL no usa el límite técnico: puede completar la fila 32 (cota del universo)");
  });
  test("universo exacto: 31 viajeros = 30 adicionales caben sin límite técnico; 32 lo superan; 40 también", async () => {
    const m = await import("../lib/reservar/universoViajeros.ts");
    assert.equal(m.superaLimiteCaptura(m.universoDeViajeros(31)), false);
    assert.equal(m.capacidadCaptura(m.universoDeViajeros(31)), 30);
    assert.equal(m.superaLimiteCaptura(m.universoDeViajeros(32)), true);
    assert.equal(m.capacidadCaptura(m.universoDeViajeros(40)), 30);
    assert.equal(m.capacidadCaptura(m.universoDeViajeros(5)), 4, "por debajo del límite nada cambia");
  });
  test("los textos: antes de escribir se dice el límite y que el resto lo completa el personal; EN el límite no se afirma que estén todos", async () => {
    const m = await import("../lib/reservar/universoViajeros.ts");
    const amb = m.universoDeViajeros(16, [{ pax: 16 }, { pax: 16 }]);
    const antes = m.notaCaptura(amb, 1) ?? "";
    assert.match(antes, /2 servicios independientes/); assert.match(antes, /hasta 30 pasajeros adicionales/); assert.match(antes, /personal de D'spacios completa el resto/);
    const enLimite = m.notaCaptura(amb, 31) ?? "";
    assert.match(enLimite, /Llegaste al máximo de 30 pasajeros adicionales/); assert.match(enLimite, /NO significa que ya estén todos los viajeros/);
    assert.doesNotMatch(enLimite, /Ya están todos/);
    const exacto = m.notaCaptura(m.universoDeViajeros(40), 31) ?? "";
    assert.match(exacto, /es para 40 viajeros/); assert.match(exacto, /NO significa que ya estén todos/);
    // Sin límite técnico por medio, el texto es el de siempre (el universo completo SÍ puede decir que están todos).
    assert.match(m.notaCaptura(m.universoDeViajeros(3), 3) ?? "", /Ya están todos los viajeros/);
  });
  test("panel, acción, función de la base y CHECK de la tabla comparten el mismo 30 (sin literal suelto ni CHECK subido)", () => {
    const accion = leer("app/portal/b2b/cotizaciones/preparacion-actions.ts");
    assert.match(accion, /pasajeros\.length > LIMITE_CAPTURA_ADICIONALES\) return \{ ok: false, error: mensajeLimiteCaptura\(\) \}/);
    assert.doesNotMatch(accion, /pasajeros\.length > 30/);
    const panel = leer("components/portal/PanelPreparacionContrato.tsx");
    assert.match(panel, /capacidadCaptura\(universo\)/); assert.match(panel, /puedeAgregarCaptura\(universo, filas\.length \+ 1\)/); assert.match(panel, /notaCaptura\(universo, filas\.length \+ 1\)/);
    assert.doesNotMatch(panel, /topeAdicionales|puedeAgregarFila|notaUniverso/, "el panel del aliado ya no usa la cota del universo directamente");
    const sql = leer("supabase/migrations/20260601000326_pasajeros_aliado_tope_universo.sql");
    assert.match(sql, /v_limite constant integer := 30/); assert.match(sql, /jsonb_array_length\(p_pasajeros\) > v_limite/);
    const m325 = leer("supabase/migrations/20260601000325_evidencia_y_pasajeros_aliado_cotizacion.sql");
    assert.match(m325, /jsonb_array_length\(pasajeros\) between 1 and 30/, "el CHECK de la tabla sigue en 30 (no se tocó)");
  });
  test("el mensaje de la acción y el de la base dicen lo mismo", async () => {
    const { mensajeLimiteCaptura } = await import("../lib/portal/preparacionContrato.ts");
    assert.equal(mensajeLimiteCaptura(), "Aquí se pueden dejar hasta 30 pasajeros adicionales; el personal de D'spacios completa el resto al convertir la cotización.");
    const sql = leer("supabase/migrations/20260601000326_pasajeros_aliado_tope_universo.sql");
    assert.match(sql, /F4721: Aquí se pueden dejar hasta % pasajeros adicionales; el personal de D''spacios completa el resto al convertir la cotización\./);
  });
});
