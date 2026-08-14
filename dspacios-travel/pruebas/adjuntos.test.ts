// Pruebas de regresión de `lib/adjuntos/operaciones.ts`.
//
//   node --test --experimental-strip-types pruebas/
//   (o: npm run test:unit)
//
// Lo que se comprueba no es el camino feliz —ese ya funcionaba— sino los dos
// estados intermedios que la versión anterior dejaba pasar en silencio:
//
//   · el archivo NO se borró pero la fila sí  → huérfano invisible con datos
//     personales dentro;
//   · el archivo SÍ se subió pero la fila no  → el mismo huérfano por el otro
//     extremo.
//
// El caso más traicionero es el tercero: Storage responde SIN error y aun así
// no borró nada, porque una policy filtró el objeto. Mirar solo `error` daba
// por buena una eliminación que no ocurrió.

import test from "node:test";
import assert from "node:assert/strict";
import { eliminarArchivoYFila, subirYRegistrar, type RespuestaRemove } from "../lib/adjuntos/operaciones.ts";

const PATH = "00-0451/cedula-1700000000000.pdf";

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

// ── eliminarArchivoYFila ─────────────────────────────────────────────────────

test("elimina el archivo y después la fila cuando todo va bien", async () => {
  const rm = removeQue(borroTodo([PATH]));
  let filaBorrada: number | null = null;
  const r = await eliminarArchivoYFila(
    { eliminarArchivo: rm.fn, eliminarFila: async (id) => { filaBorrada = id; return { error: null }; } },
    { id: 7, path: PATH }
  );
  assert.deepEqual(r, { ok: true });
  assert.deepEqual(rm.llamadas, [[PATH]]);
  assert.equal(filaBorrada, 7);
});

test("si Storage devuelve error, NO borra la fila (el archivo quedaría huérfano)", async () => {
  const rm = removeQue({ data: null, error: { message: "new row violates row-level security policy" } });
  let intentoFila = false;
  const r = await eliminarArchivoYFila(
    { eliminarArchivo: rm.fn, eliminarFila: async () => { intentoFila = true; return { error: null }; } },
    { id: 7, path: PATH }
  );
  assert.equal(r.ok, false);
  assert.equal(intentoFila, false, "no debe tocar la fila si el archivo sigue ahí");
  assert.match(r.ok === false ? r.error : "", /row-level security/);
  assert.match(r.ok === false ? r.error : "", /NO se elimin/);
});

test("si Storage NO devuelve error pero tampoco borró el archivo, NO borra la fila", async () => {
  // Este es el caso que la versión anterior no podía detectar ni mirando
  // `error`: la API responde 200 con la lista de lo que sí borró, y el path
  // filtrado por la policy simplemente no aparece.
  const rm = removeQue({ data: [], error: null });
  let intentoFila = false;
  const r = await eliminarArchivoYFila(
    { eliminarArchivo: rm.fn, eliminarFila: async () => { intentoFila = true; return { error: null }; } },
    { id: 7, path: PATH }
  );
  assert.equal(r.ok, false);
  assert.equal(intentoFila, false);
  assert.match(r.ok === false ? r.error : "", /no elimin/i);
});

test("acepta que Storage devuelva solo el NOMBRE del objeto, no la ruta completa", async () => {
  // No está garantizado qué forma devuelve cada versión del cliente de Storage.
  // Ser estricto de más aquí bloquearía eliminaciones legítimas en producción,
  // que sería peor que el problema original.
  const rm = removeQue({ data: [{ name: "cedula-1700000000000.pdf" }], error: null });
  let filaBorrada = false;
  const r = await eliminarArchivoYFila(
    { eliminarArchivo: rm.fn, eliminarFila: async () => { filaBorrada = true; return { error: null }; } },
    { id: 7, path: PATH }
  );
  assert.deepEqual(r, { ok: true });
  assert.equal(filaBorrada, true);
});

test("si Storage borró OTRO archivo pero no el pedido, tampoco borra la fila", async () => {
  const rm = removeQue({ data: [{ name: "00-9999/otro.pdf" }], error: null });
  let intentoFila = false;
  const r = await eliminarArchivoYFila(
    { eliminarArchivo: rm.fn, eliminarFila: async () => { intentoFila = true; return { error: null }; } },
    { id: 7, path: PATH }
  );
  assert.equal(r.ok, false);
  assert.equal(intentoFila, false);
});

test("si `remove` lanza una excepción, no borra la fila y explica el motivo", async () => {
  const rm = removeQue(new Error("fetch failed"));
  let intentoFila = false;
  const r = await eliminarArchivoYFila(
    { eliminarArchivo: rm.fn, eliminarFila: async () => { intentoFila = true; return { error: null }; } },
    { id: 7, path: PATH }
  );
  assert.equal(r.ok, false);
  assert.equal(intentoFila, false);
  assert.match(r.ok === false ? r.error : "", /fetch failed/);
});

test("si el archivo se borró y la fila no, lo dice: queda un registro colgado", async () => {
  const rm = removeQue(borroTodo([PATH]));
  const r = await eliminarArchivoYFila(
    { eliminarArchivo: rm.fn, eliminarFila: async () => ({ error: { message: "permission denied" } }) },
    { id: 7, path: PATH }
  );
  assert.equal(r.ok, false);
  assert.match(r.ok === false ? r.error : "", /permission denied/);
  assert.match(r.ok === false ? r.error : "", /seguir. listado|Vuelve a intentarlo/);
});

// ── subirYRegistrar ──────────────────────────────────────────────────────────

test("sube y registra cuando todo va bien, sin llamar a limpiar", async () => {
  const rm = removeQue(borroTodo([PATH]));
  const r = await subirYRegistrar(
    {
      subirArchivo: async () => ({ error: null }),
      registrarFila: async () => ({ ok: true }),
      eliminarArchivo: rm.fn,
    },
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
  assert.match(r.ok === false ? r.error : "", /Payload too large/);
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
  assert.equal(r.ok === false ? r.error : "", "no tienes permiso sobre este contrato");
  assert.doesNotMatch(r.ok === false ? r.error : "", /AVISO/, "no hay huérfano que avisar");
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
  const msg = r.ok === false ? r.error : "";
  assert.match(msg, /AVISO/);
  assert.match(msg, new RegExp(PATH.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), "debe decir QUÉ archivo quedó colgado");
  assert.match(msg, /administrador/);
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
  assert.match(r.ok === false ? r.error : "", /AVISO/);
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
  const msg = r.ok === false ? r.error : "";
  assert.match(msg, /AVISO/);
  assert.match(msg, /network down/);
});

// ── Control negativo ─────────────────────────────────────────────────────────
// Una prueba de regresión solo sirve si HABRÍA FALLADO con el código anterior.
// Aquí se reimplementa el comportamiento viejo —literal— y se comprueba que
// produce justo el estado que ahora se impide. Si alguien "simplifica" las
// operaciones y vuelve a ese comportamiento, estas dos pruebas lo delatan.

/** Cómo estaba `eliminarAdjunto` antes: tiraba el resultado de `remove()`. */
async function eliminarComoAntes(
  deps: { eliminarArchivo(p: string[]): Promise<RespuestaRemove>; eliminarFila(id: number): Promise<{ error: { message: string } | null }> },
  args: { id: number; path: string }
) {
  await deps.eliminarArchivo([args.path]);      // <-- resultado ignorado
  const { error } = await deps.eliminarFila(args.id);
  if (error) return { ok: false as const, error: error.message };
  return { ok: true as const };
}

test("CONTROL NEGATIVO: el código viejo borraba la fila aunque el archivo siguiera ahí", async () => {
  const rm = removeQue({ data: null, error: { message: "row-level security" } });
  let filaBorrada = false;
  const r = await eliminarComoAntes(
    { eliminarArchivo: rm.fn, eliminarFila: async () => { filaBorrada = true; return { error: null }; } },
    { id: 7, path: PATH }
  );
  // El viejo decía "ok" y dejaba el archivo huérfano: fila borrada, archivo en
  // el bucket, nada que lo referencie.
  assert.deepEqual(r, { ok: true }, "el viejo reportaba éxito");
  assert.equal(filaBorrada, true, "y borraba la fila: ahí nacía el huérfano");

  // La versión nueva, con las mismas entradas, se niega.
  const rm2 = removeQue({ data: null, error: { message: "row-level security" } });
  let filaBorrada2 = false;
  const r2 = await eliminarArchivoYFila(
    { eliminarArchivo: rm2.fn, eliminarFila: async () => { filaBorrada2 = true; return { error: null }; } },
    { id: 7, path: PATH }
  );
  assert.equal(r2.ok, false);
  assert.equal(filaBorrada2, false);
});

test("CONTROL NEGATIVO: el código viejo dejaba el archivo subido si fallaba el registro", async () => {
  // Cómo estaba en AdjuntosContrato.tsx: subir, registrar, y si el registro
  // fallaba se lanzaba el error... con el archivo ya arriba y sin limpiar.
  const subidos: string[] = [];
  const borrados: string[] = [];
  async function subirComoAntes(path: string) {
    subidos.push(path);                       // upload OK
    return { ok: false as const, error: "fallo el registro" };  // y nadie limpia
  }
  const viejo = await subirComoAntes(PATH);
  assert.equal(viejo.ok, false);
  assert.deepEqual(subidos, [PATH]);
  assert.deepEqual(borrados, [], "el viejo no borraba nada: huérfano");

  // La versión nueva deshace la subida.
  const rm = removeQue(borroTodo([PATH]));
  const nuevo = await subirYRegistrar(
    {
      subirArchivo: async () => ({ error: null }),
      registrarFila: async () => ({ ok: false, error: "fallo el registro" }),
      eliminarArchivo: rm.fn,
    },
    { path: PATH, archivo: "x" }
  );
  assert.equal(nuevo.ok, false);
  assert.deepEqual(rm.llamadas, [[PATH]], "la nueva sí deshace");
});
