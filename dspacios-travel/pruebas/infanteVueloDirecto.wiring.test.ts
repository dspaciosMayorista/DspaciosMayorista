// Cableado de la gestión de infantes DIRECTAMENTE desde Vuelos (migración
// 168, RPC estrecho `guardar_infante_vuelo`). El servidor SQL es la ÚNICA
// autoridad (relee fecha_ida, resuelve contrato/responsable, autoriza
// control_vuelo de forma estrecha) — estas pruebas verifican que el cliente
// NUNCA intenta autorizar nada por su cuenta: solo manda bloqueo_id +
// silla_responsable_id (nunca numero_contrato/responsable_id sueltos) y dos
// superficies (vuelos/[id] y vuelos/pasajeros) exponen el mismo formulario
// bajo el mismo candado (documento presente en la silla del adulto).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function leer(ruta: string): string {
  return readFileSync(new URL(`../${ruta}`, import.meta.url), "utf8");
}

const RUTA_ACTIONS = "app/(dashboard)/dashboard/vuelos/actions.ts";
const RUTA_FORM = "components/vuelos/InfanteVueloForm.tsx";
const RUTA_BLOQUEO = "app/(dashboard)/dashboard/vuelos/[id]/page.tsx";
const RUTA_PASAJEROS_PAGE = "app/(dashboard)/dashboard/vuelos/pasajeros/page.tsx";
const RUTA_PASAJEROS_BUSCADOR = "app/(dashboard)/dashboard/vuelos/pasajeros/PasajerosBuscador.tsx";

describe("actions.ts — guardarInfanteVuelo: el cliente nunca autoriza, solo manda bloqueoId + sillaResponsableId", () => {
  const src = leer(RUTA_ACTIONS);

  test("exporta guardarInfanteVuelo con la firma (bloqueoId, sillaResponsableId, infanteId, input) — nunca numeroContrato/responsableId directos", () => {
    assert.match(
      src,
      /export async function guardarInfanteVuelo\(\s*bloqueoId: number,\s*sillaResponsableId: number,\s*infanteId: number \| null,\s*input: InfanteVueloInput\s*\)/,
      "la firma debe recibir la silla concreta del responsable, nunca un numero_contrato o responsable_id sueltos"
    );
    assert.doesNotMatch(
      src,
      /guardarInfanteVuelo[\s\S]{0,300}numeroContrato:/,
      "guardarInfanteVuelo no debe aceptar/mandar un numeroContrato — eso lo resuelve el RPC en el server"
    );
  });

  test("valida la forma con validarInfanteVueloInput ANTES de llamar al RPC (adelanta mensajes, nunca sustituye la autoridad del server)", () => {
    const inicio = src.indexOf("export async function guardarInfanteVuelo");
    const bloque = src.slice(inicio, inicio + 900);
    const idxValidar = bloque.indexOf("validarInfanteVueloInput(input)");
    const idxRpc = bloque.indexOf('.rpc("guardar_infante_vuelo"');
    assert.ok(idxValidar > -1 && idxRpc > -1 && idxValidar < idxRpc, "debe validar el input ANTES de invocar el RPC");
  });

  test("llama al RPC guardar_infante_vuelo con p_bloqueo_id/p_silla_responsable_id/p_infante_id — nunca p_numero_contrato ni p_responsable_id", () => {
    const inicio = src.indexOf('.rpc("guardar_infante_vuelo"');
    assert.ok(inicio > -1, "no llama al RPC guardar_infante_vuelo");
    const bloque = src.slice(inicio, inicio + 500);
    assert.match(bloque, /p_bloqueo_id:\s*bloqueoId/);
    assert.match(bloque, /p_silla_responsable_id:\s*sillaResponsableId/);
    assert.match(bloque, /p_infante_id:\s*infanteId/);
    assert.doesNotMatch(bloque, /p_numero_contrato|p_responsable_id/, "el cliente nunca debe mandar numero_contrato/responsable_id — eso lo resuelve el server");
  });

  test("revalida ambas superficies (vuelos/[id] y vuelos/pasajeros) tras guardar", () => {
    const inicio = src.indexOf('.rpc("guardar_infante_vuelo"');
    const bloque = src.slice(inicio, inicio + 500);
    assert.match(bloque, /revalidatePath\(`\/dashboard\/vuelos\/\$\{bloqueoId\}`\)/);
    assert.match(bloque, /revalidatePath\("\/dashboard\/vuelos\/pasajeros"\)/);
  });

  test("propaga el error del RPC sin inventar uno propio (fail-closed: el mensaje real del server llega al asesor)", () => {
    const inicio = src.indexOf('.rpc("guardar_infante_vuelo"');
    const bloque = src.slice(inicio, inicio + 700);
    assert.match(bloque, /if \(error\) return \{ ok: false, error: error\.message \};/);
  });
});

describe("InfanteVueloForm.tsx — el formulario nunca decide negocio, solo junta bloqueoId+sillaResponsableId+datos", () => {
  const src = leer(RUTA_FORM);

  test("reutiliza esInfantePorEdad/validarInfanteVueloInput de lib/vuelos/infanteVuelo (nunca reimplementa el umbral)", () => {
    assert.match(
      src,
      /import \{ esInfantePorEdad, validarInfanteVueloInput, type InfanteVueloInput \} from "@\/lib\/vuelos\/infanteVuelo";/
    );
  });

  test("la clasificación en vivo usa fechaIdaBloqueo (la fecha REAL del vuelo) — nunca una fecha de contrato ni 'hoy' fijo", () => {
    const inicio = src.indexOf("const aviso = useMemo");
    assert.ok(inicio > -1, "no calcula el aviso de clasificación en vivo");
    const bloque = src.slice(inicio, inicio + 500);
    assert.match(bloque, /esInfantePorEdad\(form\.fechaNacimiento, fechaIdaBloqueo\)/);
  });

  test("bloquea guardar si la validación de forma falla o si el aviso de edad está activo (nunca manda un guardado que el server rechazaría de todas formas)", () => {
    const inicio = src.indexOf("function guardar()");
    const bloque = src.slice(inicio, inicio + 500);
    assert.match(bloque, /validarInfanteVueloInput\(form\)/);
    assert.match(bloque, /if \(aviso\)/);
  });

  test("llama a guardarInfanteVuelo con (bloqueoId, sillaResponsableId, infanteId-o-null, form) — modo editar manda el id existente, modo crear manda null", () => {
    const inicio = src.indexOf("const r = await guardarInfanteVuelo");
    assert.ok(inicio > -1);
    const linea = src.slice(inicio, inicio + 200);
    assert.match(linea, /guardarInfanteVuelo\(bloqueoId, sillaResponsableId, modo === "editar" && inicial \? inicial\.id : null, form\)/);
  });
});

describe("vuelos/[id]/page.tsx — alta de infante gateada a que la silla del adulto tenga documento propio", () => {
  const src = leer(RUTA_BLOQUEO);

  test("importa InfanteVueloForm", () => {
    assert.match(src, /import \{ InfanteVueloForm \} from "@\/components\/vuelos\/InfanteVueloForm";/);
  });

  test("el trigger de alta exige tipo_doc+numero_doc de la silla (misma silla que ancla la autorización en el RPC) y bloquea sillas en 'cambio'", () => {
    const inicioUso = src.indexOf("<InfanteVueloForm");
    assert.ok(inicioUso > -1, "no usa <InfanteVueloForm en el JSX (solo lo importa)");
    const contexto = src.slice(Math.max(0, inicioUso - 400), inicioUso + 50);
    assert.match(contexto, /s\.estado !== "cambio" && s\.tipo_doc && s\.numero_doc/);
  });

  test("el trigger de alta manda bloqueoId + la silla CONCRETA del adulto (s.id) — nunca un numeroContrato", () => {
    const inicio = src.indexOf('modo="crear"');
    const bloque = src.slice(Math.max(0, inicio - 300), inicio + 50);
    assert.match(bloque, /sillaResponsableId=\{s\.id\}/);
    assert.match(bloque, /fechaIdaBloqueo=\{b\.fecha_ida\}/);
  });

  test("el trigger de edición del infante subordinado usa la MISMA silla del responsable (s.id) y el id numérico real del infante (inf.id)", () => {
    const inicio = src.indexOf('modo="editar"');
    assert.ok(inicio > -1, "no renderiza el formulario en modo editar sobre el renglón subordinado");
    const bloque = src.slice(Math.max(0, inicio - 300), inicio + 500);
    assert.match(bloque, /sillaResponsableId=\{s\.id\}/);
    assert.match(bloque, /id: inf\.id/);
    assert.match(bloque, /nombreCompleto: inf\.nombre/);
  });
});

describe("vuelos/pasajeros — misma gestión disponible en el buscador global (ambas superficies, mismo candado)", () => {
  test("page.tsx expone el id NUMÉRICO real del infante (infanteId) — la clave de fila sintética 'infante-N' no sirve para el RPC", () => {
    const src = leer(RUTA_PASAJEROS_PAGE);
    const inicio = src.indexOf("filasInfantes.push");
    const bloque = src.slice(inicio, inicio + 300);
    assert.match(bloque, /infanteId:\s*inf\.id/);
  });

  test("PasajerosBuscador.tsx importa InfanteVueloForm y lo gatea a silla+bloqueo+documento presentes", () => {
    const src = leer(RUTA_PASAJEROS_BUSCADOR);
    assert.match(src, /import \{ InfanteVueloForm \} from "@\/components\/vuelos\/InfanteVueloForm";/);
    const inicioAlta = src.indexOf('modo="crear"');
    assert.ok(inicioAlta > -1);
    const bloqueAlta = src.slice(Math.max(0, inicioAlta - 300), inicioAlta + 50);
    assert.match(bloqueAlta, /p\.sillaId != null && p\.bloqueoId != null && p\.tipoDoc && p\.numeroDoc/);
  });

  test("PasajerosBuscador.tsx en modo editar usa la silla del PADRE (p.sillaId/p.bloqueoId), no un id inventado", () => {
    const src = leer(RUTA_PASAJEROS_BUSCADOR);
    const inicio = src.indexOf('modo="editar"');
    assert.ok(inicio > -1);
    const bloque = src.slice(Math.max(0, inicio - 300), inicio + 600);
    assert.match(bloque, /sillaResponsableId=\{p\.sillaId\}/);
    assert.match(bloque, /id: inf\.infanteId/);
  });
});
