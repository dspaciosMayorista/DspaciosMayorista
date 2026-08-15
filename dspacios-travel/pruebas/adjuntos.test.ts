// Pruebas de regresión de `lib/adjuntos/operaciones.ts`.
//
//   npm run test:unit
//
// Lo que se comprueba no es el camino feliz —ese ya funcionaba— sino los
// estados intermedios que la versión anterior dejaba pasar en silencio:
//
//   · el archivo NO se borró pero la fila sí  → huérfano invisible con datos
//     personales dentro;
//   · el archivo SÍ se subió pero la fila no  → el mismo huérfano por el otro
//     extremo.
//
// Los dos casos más traicioneros son los que responden **sin error**:
//   · Storage devuelve 200 y una lista de lo que sí borró, donde el objeto
//     filtrado por la policy no aparece;
//   · PostgREST devuelve `error: null` en un DELETE que la RLS filtró y que no
//     tocó ninguna fila.
// En los dos, mirar solo `error` da por buena una operación que no ocurrió.

import test from "node:test";
import assert from "node:assert/strict";
import {
  eliminarArchivoYFila,
  subirYRegistrar,
  type RespuestaRemove,
  type FilaAdjunto,
} from "../lib/adjuntos/operaciones.ts";

const CONTRATO = "00-0451";
const PATH = `${CONTRATO}/cedula-1700000000000.pdf`;
const FILA: FilaAdjunto = { path: PATH, numero_contrato: CONTRATO };

/** Fábrica de un `remove()` falso, con registro de lo que se le pidió. */
function removeQue(resultado: RespuestaRemove | Error) {
  const llamadas: string[][] = [];
  const fn = async (paths: string[]): Promise<RespuestaRemove> => {
    llamadas.push(paths);
    if (resultado instanceof Error) throw resultado;
    return resultado;
  };
  return { fn, llamadas };
}

const borroTodo = (paths: string[]): RespuestaRemove => ({ data: paths.map((name) => ({ name })), error: null });
const filaVisible = async () => ({ data: FILA, error: null });
const borroUnaFila = async () => ({ data: [{ id: 7 }], error: null });
/** Por defecto el archivo SIGUE ahí: es el caso conservador. */
const archivoPresente = async () => ({ existe: true, error: null });
const archivoAusente = async () => ({ existe: false, error: null });
const err = (r: { ok: boolean } & Record<string, unknown>) => (r.ok === false ? String(r.error) : "");

// ── Origen de los datos: nada del cliente ────────────────────────────────────

test("usa la ruta que dice la BASE, no la que pudiera mandar el cliente", async () => {
  const rm = removeQue(borroTodo([PATH]));
  const r = await eliminarArchivoYFila(
    { buscarFila: filaVisible, eliminarArchivo: rm.fn, existeArchivo: archivoPresente, eliminarFila: borroUnaFila },
    { id: 7 }
  );
  assert.deepEqual(r, { ok: true, numeroContrato: CONTRATO });
  assert.deepEqual(rm.llamadas, [[PATH]], "debe borrar exactamente la ruta leída de la base");
});

test("si la fila no es visible (RLS), se para ANTES de tocar Storage", async () => {
  const rm = removeQue(borroTodo([PATH]));
  let intentoFila = false;
  const r = await eliminarArchivoYFila(
    {
      buscarFila: async () => ({ data: null, error: null }),
      eliminarArchivo: rm.fn,
      existeArchivo: archivoPresente,
      eliminarFila: async () => { intentoFila = true; return { data: [], error: null }; },
    },
    { id: 7 }
  );
  assert.equal(r.ok, false);
  assert.equal(rm.llamadas.length, 0, "no debe llamar a Storage");
  assert.equal(intentoFila, false);
  assert.match(err(r), /no existe o no tienes permiso/);
});

test("si la consulta de la fila da error, no toca nada", async () => {
  const rm = removeQue(borroTodo([PATH]));
  const r = await eliminarArchivoYFila(
    {
      buscarFila: async () => ({ data: null, error: { message: "JWT expired" } }),
      eliminarArchivo: rm.fn,
      existeArchivo: archivoPresente,
      eliminarFila: borroUnaFila,
    },
    { id: 7 }
  );
  assert.equal(r.ok, false);
  assert.equal(rm.llamadas.length, 0);
  assert.match(err(r), /JWT expired/);
});

test("si la consulta de la fila LANZA, no toca nada", async () => {
  const rm = removeQue(borroTodo([PATH]));
  const r = await eliminarArchivoYFila(
    {
      buscarFila: async () => { throw new Error("fetch failed"); },
      eliminarArchivo: rm.fn,
      existeArchivo: archivoPresente,
      eliminarFila: borroUnaFila,
    },
    { id: 7 }
  );
  assert.equal(r.ok, false);
  assert.equal(rm.llamadas.length, 0);
  assert.match(err(r), /fetch failed/);
});

// ── El archivo ───────────────────────────────────────────────────────────────

test("si Storage devuelve error, NO borra la fila (el archivo quedaría huérfano)", async () => {
  const rm = removeQue({ data: null, error: { message: "new row violates row-level security policy" } });
  let intentoFila = false;
  const r = await eliminarArchivoYFila(
    { buscarFila: filaVisible, eliminarArchivo: rm.fn, existeArchivo: archivoPresente, eliminarFila: async () => { intentoFila = true; return { data: [], error: null }; } },
    { id: 7 }
  );
  assert.equal(r.ok, false);
  assert.equal(intentoFila, false, "no debe tocar la fila si el archivo sigue ahí");
  assert.match(err(r), /row-level security/);
  assert.match(err(r), /NO se elimin/);
});

test("si Storage NO devuelve error pero tampoco borró el archivo, NO borra la fila", async () => {
  const rm = removeQue({ data: [], error: null });
  let intentoFila = false;
  const r = await eliminarArchivoYFila(
    { buscarFila: filaVisible, eliminarArchivo: rm.fn, existeArchivo: archivoPresente, eliminarFila: async () => { intentoFila = true; return { data: [], error: null }; } },
    { id: 7 }
  );
  assert.equal(r.ok, false);
  assert.equal(intentoFila, false);
  assert.match(err(r), /no elimin/i);
});

test("acepta que Storage devuelva solo el NOMBRE del objeto, no la ruta completa", async () => {
  // No está garantizado qué forma devuelve cada versión del cliente de Storage.
  // Ser estricto de más aquí bloquearía eliminaciones legítimas en producción,
  // que sería peor que el problema original.
  const rm = removeQue({ data: [{ name: "cedula-1700000000000.pdf" }], error: null });
  const r = await eliminarArchivoYFila(
    { buscarFila: filaVisible, eliminarArchivo: rm.fn, existeArchivo: archivoPresente, eliminarFila: borroUnaFila },
    { id: 7 }
  );
  assert.equal(r.ok, true);
});

test("si Storage borró OTRO archivo pero no el pedido, tampoco borra la fila", async () => {
  const rm = removeQue({ data: [{ name: "00-9999/otro.pdf" }], error: null });
  let intentoFila = false;
  const r = await eliminarArchivoYFila(
    { buscarFila: filaVisible, eliminarArchivo: rm.fn, existeArchivo: archivoPresente, eliminarFila: async () => { intentoFila = true; return { data: [], error: null }; } },
    { id: 7 }
  );
  assert.equal(r.ok, false);
  assert.equal(intentoFila, false);
});

test("si `remove` lanza una excepción, no borra la fila y explica el motivo", async () => {
  const rm = removeQue(new Error("fetch failed"));
  let intentoFila = false;
  const r = await eliminarArchivoYFila(
    { buscarFila: filaVisible, eliminarArchivo: rm.fn, existeArchivo: archivoPresente, eliminarFila: async () => { intentoFila = true; return { data: [], error: null }; } },
    { id: 7 }
  );
  assert.equal(r.ok, false);
  assert.equal(intentoFila, false);
  assert.match(err(r), /fetch failed/);
});

// ── La fila ──────────────────────────────────────────────────────────────────

test("si el DELETE devuelve error, lo dice: queda un registro colgado", async () => {
  const rm = removeQue(borroTodo([PATH]));
  const r = await eliminarArchivoYFila(
    { buscarFila: filaVisible, eliminarArchivo: rm.fn, existeArchivo: archivoPresente, eliminarFila: async () => ({ data: null, error: { message: "permission denied" } }) },
    { id: 7 }
  );
  assert.equal(r.ok, false);
  assert.match(err(r), /permission denied/);
  // El mensaje invita a reintentar, y ese reintento SÍ resuelve — lo comprueba
  // la prueba "el mensaje del DELETE fallido invita a reintentar…".
  assert.match(err(r), /Vuelve a intentar/);
});

test("si el DELETE responde error:null pero NO borró ninguna fila, no se reporta éxito", async () => {
  // PostgREST devuelve `error: null` aunque la RLS filtre la fila. Sin
  // `.select("id")` esto era indistinguible de un borrado correcto, y la
  // pantalla habría dicho que el adjunto se eliminó cuando la fila sigue ahí
  // apuntando a un archivo que ya no existe.
  const rm = removeQue(borroTodo([PATH]));
  const r = await eliminarArchivoYFila(
    { buscarFila: filaVisible, eliminarArchivo: rm.fn, existeArchivo: archivoPresente, eliminarFila: async () => ({ data: [], error: null }) },
    { id: 7 }
  );
  assert.equal(r.ok, false);
  assert.match(err(r), /ninguna fila afectada/);
});

test("si el DELETE reporta más de una fila, tampoco se da por bueno", async () => {
  const rm = removeQue(borroTodo([PATH]));
  const r = await eliminarArchivoYFila(
    { buscarFila: filaVisible, eliminarArchivo: rm.fn, existeArchivo: archivoPresente, eliminarFila: async () => ({ data: [{ id: 7 }, { id: 8 }], error: null }) },
    { id: 7 }
  );
  assert.equal(r.ok, false);
});

test("si el DELETE LANZA después de borrar el archivo, devuelve un resultado controlado", async () => {
  const rm = removeQue(borroTodo([PATH]));
  const r = await eliminarArchivoYFila(
    { buscarFila: filaVisible, eliminarArchivo: rm.fn, existeArchivo: archivoPresente, eliminarFila: async () => { throw new Error("connection reset"); } },
    { id: 7 }
  );
  assert.equal(r.ok, false);
  assert.match(err(r), /connection reset/);
  assert.match(err(r), /El archivo se elimin/, "debe decir que el archivo ya no está");
});

// ── Recuperación de la fila colgada ──────────────────────────────────────────
// Después de que el archivo se borre y el DELETE de la fila falle, el usuario
// vuelve a darle a "Eliminar". El segundo `remove()` no borra nada —el archivo
// ya no está—, así que sin distinguir POR QUÉ no borró, el reintento chocaría
// para siempre contra "el almacenamiento no eliminó el archivo" y la fila
// colgada no se podría quitar nunca desde la interfaz.

test("REINTENTO: si el archivo ya no existe, borra solo la fila colgada", async () => {
  const rm = removeQue({ data: [], error: null });   // no borra: ya no estaba
  let filaBorrada = false;
  const r = await eliminarArchivoYFila(
    {
      buscarFila: filaVisible,
      eliminarArchivo: rm.fn,
      existeArchivo: archivoAusente,
      eliminarFila: async () => { filaBorrada = true; return { data: [{ id: 7 }], error: null }; },
    },
    { id: 7 }
  );
  assert.deepEqual(r, { ok: true, numeroContrato: CONTRATO });
  assert.equal(filaBorrada, true, "la fila colgada se puede quitar");
});

test("pero si el archivo SIGUE ahí, no se toca la fila", async () => {
  const rm = removeQue({ data: [], error: null });
  let intentoFila = false;
  const r = await eliminarArchivoYFila(
    {
      buscarFila: filaVisible,
      eliminarArchivo: rm.fn,
      existeArchivo: archivoPresente,
      eliminarFila: async () => { intentoFila = true; return { data: [], error: null }; },
    },
    { id: 7 }
  );
  assert.equal(r.ok, false);
  assert.equal(intentoFila, false);
  assert.match(err(r), /sigue en el almacenamiento/);
});

test("si NO se puede comprobar si el archivo sigue ahí, se actúa en conservador", async () => {
  // Ante la duda no se borra la fila: dejar una fila colgada es molesto, dejar
  // un archivo huérfano con datos personales no se ve nunca.
  const rm = removeQue({ data: [], error: null });
  let intentoFila = false;
  const r = await eliminarArchivoYFila(
    {
      buscarFila: filaVisible,
      eliminarArchivo: rm.fn,
      existeArchivo: async () => ({ existe: null, error: { message: "Bucket not found" } }),
      eliminarFila: async () => { intentoFila = true; return { data: [], error: null }; },
    },
    { id: 7 }
  );
  assert.equal(r.ok, false);
  assert.equal(intentoFila, false);
  assert.match(err(r), /no se pudo comprobar/);
  assert.match(err(r), /Bucket not found/);
});

test("si la comprobación de existencia LANZA, también se actúa en conservador", async () => {
  const rm = removeQue({ data: [], error: null });
  let intentoFila = false;
  const r = await eliminarArchivoYFila(
    {
      buscarFila: filaVisible,
      eliminarArchivo: rm.fn,
      existeArchivo: async () => { throw new Error("timeout"); },
      eliminarFila: async () => { intentoFila = true; return { data: [], error: null }; },
    },
    { id: 7 }
  );
  assert.equal(r.ok, false);
  assert.equal(intentoFila, false);
  assert.match(err(r), /timeout/);
});

test("el mensaje del DELETE fallido invita a reintentar, y ese reintento AHORA funciona", async () => {
  // Antes decía "vuelve a intentarlo" y el reintento no podía funcionar: es la
  // clase de instrucción que hace perder el tiempo y termina en un huérfano
  // que nadie limpia.
  const rm = removeQue(borroTodo([PATH]));
  const primero = await eliminarArchivoYFila(
    { buscarFila: filaVisible, eliminarArchivo: rm.fn, existeArchivo: archivoPresente, eliminarFila: async () => ({ data: null, error: { message: "permission denied" } }) },
    { id: 7 }
  );
  assert.equal(primero.ok, false);
  assert.match(err(primero), /Vuelve a intentar/);

  // Segundo intento: el archivo ya no está.
  const rm2 = removeQue({ data: [], error: null });
  const segundo = await eliminarArchivoYFila(
    { buscarFila: filaVisible, eliminarArchivo: rm2.fn, existeArchivo: archivoAusente, eliminarFila: borroUnaFila },
    { id: 7 }
  );
  assert.deepEqual(segundo, { ok: true, numeroContrato: CONTRATO }, "el reintento tiene que resolver");
});

// ── subirYRegistrar ──────────────────────────────────────────────────────────

test("sube y registra cuando todo va bien, sin llamar a limpiar", async () => {
  const rm = removeQue(borroTodo([PATH]));
  const r = await subirYRegistrar(
    { subirArchivo: async () => ({ error: null }), registrarFila: async () => ({ ok: true }), eliminarArchivo: rm.fn },
    { path: PATH, archivo: "contenido" }
  );
  assert.deepEqual(r, { ok: true });
  assert.equal(rm.llamadas.length, 0, "no debe borrar nada si todo salió bien");
});

test("si falla la subida, no intenta registrar", async () => {
  let intentoRegistro = false;
  const r = await subirYRegistrar(
    {
      subirArchivo: async () => ({ error: { message: "Payload too large" } }),
      registrarFila: async () => { intentoRegistro = true; return { ok: true }; },
      eliminarArchivo: async () => ({ data: [], error: null }),
    },
    { path: PATH, archivo: "x" }
  );
  assert.equal(r.ok, false);
  assert.equal(intentoRegistro, false);
  assert.match(err(r), /Payload too large/);
});

test("si la subida LANZA, no intenta registrar pero SÍ intenta limpiar", async () => {
  // Que `upload()` lance no significa que el servidor no haya guardado el
  // objeto: la petición pudo completarse y perderse la respuesta. Es un
  // resultado INDETERMINADO, y no limpiar deja el mismo huérfano que todo
  // esto intenta evitar.
  const rm = removeQue(borroTodo([PATH]));
  let intentoRegistro = false;
  const r = await subirYRegistrar(
    {
      subirArchivo: async () => { throw new Error("network down"); },
      registrarFila: async () => { intentoRegistro = true; return { ok: true }; },
      eliminarArchivo: rm.fn,
    },
    { path: PATH, archivo: "x" }
  );
  assert.equal(r.ok, false);
  assert.equal(intentoRegistro, false, "no hay nada que registrar");
  assert.deepEqual(rm.llamadas, [[PATH]], "mejor esfuerzo: intenta borrar por si quedó subido");
  assert.match(err(r), /network down/);
  assert.doesNotMatch(err(r), /AVISO/, "la limpieza confirmó: no hay huérfano del que avisar");
});

test("si la subida LANZA y la limpieza devuelve lista vacía, AVISA del posible huérfano", async () => {
  const rm = removeQue({ data: [], error: null });
  const r = await subirYRegistrar(
    {
      subirArchivo: async () => { throw new Error("network down"); },
      registrarFila: async () => ({ ok: true }),
      eliminarArchivo: rm.fn,
    },
    { path: PATH, archivo: "x" }
  );
  assert.equal(r.ok, false);
  assert.match(err(r), /network down/);
  assert.match(err(r), /AVISO/);
  assert.match(err(r), new RegExp(PATH.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("si la subida LANZA y la limpieza también falla, AVISA del posible huérfano", async () => {
  const rm = removeQue(new Error("no route to host"));
  const r = await subirYRegistrar(
    {
      subirArchivo: async () => { throw new Error("network down"); },
      registrarFila: async () => ({ ok: true }),
      eliminarArchivo: rm.fn,
    },
    { path: PATH, archivo: "x" }
  );
  assert.equal(r.ok, false);
  assert.match(err(r), /network down/);
  assert.match(err(r), /AVISO/);
  assert.match(err(r), /no route to host/);
});

test("si falla el registro, DESHACE la subida y no menciona ningún huérfano", async () => {
  const rm = removeQue(borroTodo([PATH]));
  const r = await subirYRegistrar(
    {
      subirArchivo: async () => ({ error: null }),
      registrarFila: async () => ({ ok: false, error: "no tienes permiso sobre este contrato" }),
      eliminarArchivo: rm.fn,
    },
    { path: PATH, archivo: "x" }
  );
  assert.equal(r.ok, false);
  assert.deepEqual(rm.llamadas, [[PATH]], "debe deshacer la subida");
  assert.equal(err(r), "no tienes permiso sobre este contrato");
  assert.doesNotMatch(err(r), /AVISO/, "no hay huérfano que avisar");
});

test("si el registro LANZA después de una subida buena, TAMBIÉN deshace la subida", async () => {
  // Una Server Action puede lanzar (red caída, error de Next) además de
  // devolver {ok:false}. Si solo se mirara el retorno, la excepción se llevaría
  // por delante el deshacer y dejaría el huérfano.
  const rm = removeQue(borroTodo([PATH]));
  const r = await subirYRegistrar(
    {
      subirArchivo: async () => ({ error: null }),
      registrarFila: async () => { throw new Error("Failed to fetch"); },
      eliminarArchivo: rm.fn,
    },
    { path: PATH, archivo: "x" }
  );
  assert.equal(r.ok, false);
  assert.deepEqual(rm.llamadas, [[PATH]], "la excepción no puede saltarse el deshacer");
  assert.match(err(r), /Failed to fetch/);
  assert.doesNotMatch(err(r), /AVISO/, "se deshizo bien: no hay huérfano");
});

test("si el registro LANZA y el deshacer también falla, AVISA del huérfano", async () => {
  const rm = removeQue({ data: [], error: null });
  const r = await subirYRegistrar(
    {
      subirArchivo: async () => ({ error: null }),
      registrarFila: async () => { throw new Error("Failed to fetch"); },
      eliminarArchivo: rm.fn,
    },
    { path: PATH, archivo: "x" }
  );
  assert.equal(r.ok, false);
  assert.match(err(r), /AVISO/);
  assert.match(err(r), /Failed to fetch/);
});

test("si falla el registro Y falla el deshacer, AVISA del archivo huérfano con su ruta", async () => {
  const rm = removeQue({ data: null, error: { message: "row-level security" } });
  const r = await subirYRegistrar(
    {
      subirArchivo: async () => ({ error: null }),
      registrarFila: async () => ({ ok: false, error: "fallo el registro" }),
      eliminarArchivo: rm.fn,
    },
    { path: PATH, archivo: "x" }
  );
  assert.equal(r.ok, false);
  assert.match(err(r), /AVISO/);
  assert.match(err(r), new RegExp(PATH.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), "debe decir QUÉ archivo quedó colgado");
  assert.match(err(r), /administrador/);
});

test("si el deshacer responde sin error pero no borró nada, también AVISA", async () => {
  const rm = removeQue({ data: [], error: null });
  const r = await subirYRegistrar(
    {
      subirArchivo: async () => ({ error: null }),
      registrarFila: async () => ({ ok: false, error: "fallo el registro" }),
      eliminarArchivo: rm.fn,
    },
    { path: PATH, archivo: "x" }
  );
  assert.equal(r.ok, false);
  assert.match(err(r), /AVISO/);
});

test("si el deshacer lanza excepción, también AVISA en vez de tragársela", async () => {
  const rm = removeQue(new Error("network down"));
  const r = await subirYRegistrar(
    {
      subirArchivo: async () => ({ error: null }),
      registrarFila: async () => ({ ok: false, error: "fallo el registro" }),
      eliminarArchivo: rm.fn,
    },
    { path: PATH, archivo: "x" }
  );
  assert.equal(r.ok, false);
  assert.match(err(r), /AVISO/);
  assert.match(err(r), /network down/);
});

// ── Control negativo ─────────────────────────────────────────────────────────
// Una prueba de regresión solo sirve si HABRÍA FALLADO con el código anterior.
// Aquí se reimplementa el comportamiento viejo —literal— y se comprueba que
// produce justo el estado que ahora se impide. Si alguien "simplifica" las
// operaciones y vuelve a ese comportamiento, estas pruebas lo delatan.

test("CONTROL NEGATIVO: el código viejo borraba la fila aunque el archivo siguiera ahí", async () => {
  async function eliminarComoAntes(
    deps: { eliminarArchivo(p: string[]): Promise<RespuestaRemove>; eliminarFila(): Promise<{ error: { message: string } | null }> },
    path: string
  ) {
    await deps.eliminarArchivo([path]);          // <-- resultado ignorado
    const { error } = await deps.eliminarFila();
    return error ? { ok: false as const } : { ok: true as const };
  }

  const rm = removeQue({ data: null, error: { message: "row-level security" } });
  let filaBorrada = false;
  const viejo = await eliminarComoAntes(
    { eliminarArchivo: rm.fn, eliminarFila: async () => { filaBorrada = true; return { error: null }; } },
    PATH
  );
  assert.deepEqual(viejo, { ok: true }, "el viejo reportaba éxito");
  assert.equal(filaBorrada, true, "y borraba la fila: ahí nacía el huérfano");

  const rm2 = removeQue({ data: null, error: { message: "row-level security" } });
  let filaBorrada2 = false;
  const nuevo = await eliminarArchivoYFila(
    { buscarFila: filaVisible, eliminarArchivo: rm2.fn, existeArchivo: archivoPresente, eliminarFila: async () => { filaBorrada2 = true; return { data: [], error: null }; } },
    { id: 7 }
  );
  assert.equal(nuevo.ok, false);
  assert.equal(filaBorrada2, false);
});

test("CONTROL NEGATIVO: un DELETE a ciegas no distingue borrado de filtrado por RLS", async () => {
  // Sin `.select("id")`, PostgREST devuelve `{error: null}` en los dos casos.
  const respuestaDePostgrest = { error: null };
  assert.equal(respuestaDePostgrest.error, null, "el viejo solo veía esto y lo daba por bueno");

  // Con select, la lista vacía delata que no se tocó nada.
  const rm = removeQue(borroTodo([PATH]));
  const r = await eliminarArchivoYFila(
    { buscarFila: filaVisible, eliminarArchivo: rm.fn, existeArchivo: archivoPresente, eliminarFila: async () => ({ data: [], error: null }) },
    { id: 7 }
  );
  assert.equal(r.ok, false);
});
