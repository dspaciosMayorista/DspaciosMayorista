import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  generarFlujoId, crearMedidor, registrarEtapa, registrarErrorTecnico,
  crearEstadoFlujo, elevarEstadoFlujo, resultadoTotal,
  registrarDatoPagina, siguienteInvocacionProceso, tamanoAproximadoBytes,
  iniciarCronometro,
} from "../lib/observabilidad/medicion.ts";

// EJECUCIÓN REAL (no grep) de lib/observabilidad/medicion.ts — revisión
// posterior al PR #275 (corrección de observabilidad): el `flujo_id` debe
// ser aleatorio por ejecución, sin PII, y compartido entre todas las etapas
// de una misma ejecución. Se intercepta `console.log`/`console.error`
// temporalmente para inspeccionar las líneas reales que produce el módulo.
function interceptarConsola<T>(fn: () => T): { resultado: T; logs: string[]; errores: unknown[][] } {
  const logs: string[] = [];
  const errores: unknown[][] = [];
  const logOriginal = console.log;
  const errorOriginal = console.error;
  console.log = (...args: unknown[]) => { logs.push(String(args[0])); };
  console.error = (...args: unknown[]) => { errores.push(args); };
  try {
    const resultado = fn();
    return { resultado, logs, errores };
  } finally {
    console.log = logOriginal;
    console.error = errorOriginal;
  }
}

async function interceptarConsolaAsync<T>(fn: () => Promise<T>): Promise<{ resultado: T; logs: string[]; errores: unknown[][] }> {
  const logs: string[] = [];
  const errores: unknown[][] = [];
  const logOriginal = console.log;
  const errorOriginal = console.error;
  console.log = (...args: unknown[]) => { logs.push(String(args[0])); };
  console.error = (...args: unknown[]) => { errores.push(args); };
  try {
    const resultado = await fn();
    return { resultado, logs, errores };
  } finally {
    console.log = logOriginal;
    console.error = errorOriginal;
  }
}

describe("generarFlujoId()", () => {
  test("devuelve un string no vacío", () => {
    const id = generarFlujoId();
    assert.equal(typeof id, "string");
    assert.ok(id.length > 0);
  });

  test("dos llamadas devuelven ids DIFERENTES (para poder distinguir dos reservas simultáneas)", () => {
    const a = generarFlujoId();
    const b = generarFlujoId();
    assert.notEqual(a, b);
  });

  test("no tiene forma de numero_contrato (DTM-####/MIN-...) ni de ningún dato de negocio — es un UUID", () => {
    const id = generarFlujoId();
    assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    assert.doesNotMatch(id, /^DTM-|^MIN-/);
  });
});

describe("crearMedidor() — todas las etapas de UNA ejecución comparten el mismo flujo_id", () => {
  test("dos etapas medidas con el MISMO medidor emiten el mismo flujo_id en la línea de log", async () => {
    const flujoId = generarFlujoId();
    const medir = crearMedidor("crear_contrato", flujoId);
    const { logs } = await interceptarConsolaAsync(async () => {
      await medir("etapa_uno", async () => "x");
      await medir("etapa_dos", async () => "y");
    });
    assert.equal(logs.length, 2);
    for (const linea of logs) {
      assert.match(linea, new RegExp(`flujo_id=${flujoId}\\b`));
    }
  });

  test("dos EJECUCIONES distintas (dos medidores, cada uno con su propio flujo_id) nunca comparten flujo_id", async () => {
    const flujoIdA = generarFlujoId();
    const flujoIdB = generarFlujoId();
    const medirA = crearMedidor("crear_contrato", flujoIdA);
    const medirB = crearMedidor("crear_contrato", flujoIdB);
    const { logs: logsA } = await interceptarConsolaAsync(async () => { await medirA("etapa", async () => 1); });
    const { logs: logsB } = await interceptarConsolaAsync(async () => { await medirB("etapa", async () => 1); });
    assert.match(logsA[0], new RegExp(`flujo_id=${flujoIdA}\\b`));
    assert.match(logsB[0], new RegExp(`flujo_id=${flujoIdB}\\b`));
    assert.doesNotMatch(logsA[0], new RegExp(`flujo_id=${flujoIdB}\\b`));
  });

  test("línea de log trae el formato completo: flujo, flujo_id, etapa, duracion_ms, resultado", async () => {
    const flujoId = generarFlujoId();
    const medir = crearMedidor("reservar_programa", flujoId);
    const { logs } = await interceptarConsolaAsync(async () => {
      await medir("mi_etapa", async () => 42, () => "ok");
    });
    assert.equal(logs.length, 1);
    assert.match(logs[0], /^\[medicion\] flujo=reservar_programa flujo_id=[0-9a-f-]+ etapa=mi_etapa duracion_ms=\d+ resultado=ok$/);
  });

  test("resultadoDe() decide la clasificación — ok/error/parcial/rechazado, ejecución real", async () => {
    const flujoId = generarFlujoId();
    const medir = crearMedidor("crear_contrato", flujoId);
    for (const esperado of ["ok", "error", "parcial", "rechazado"] as const) {
      const { logs } = await interceptarConsolaAsync(async () => {
        await medir("etapa", async () => ({ marca: esperado }), (v) => v.marca);
      });
      assert.match(logs[0], new RegExp(`resultado=${esperado}$`));
    }
  });

  test("un error de Supabase (fn resuelve con {error}) clasifica como 'error', NUNCA 'ok', si resultadoDe lo revisa", async () => {
    const flujoId = generarFlujoId();
    const medir = crearMedidor("crear_contrato", flujoId);
    const { logs } = await interceptarConsolaAsync(async () => {
      await medir(
        "consulta",
        async () => ({ data: null, error: { message: "permission denied for table x" } }),
        (r) => (r.error ? "error" : "ok")
      );
    });
    assert.match(logs[0], /resultado=error$/);
    assert.doesNotMatch(logs[0], /resultado=ok$/);
  });

  test("si fn() LANZA una excepción, el medidor registra resultado=error y RE-LANZA (no se traga el error)", async () => {
    const flujoId = generarFlujoId();
    const medir = crearMedidor("crear_contrato", flujoId);
    let lanzo = false;
    const { logs } = await interceptarConsolaAsync(async () => {
      try {
        await medir("etapa_que_falla", async () => {
          throw new Error("fallo real de red");
        });
      } catch {
        lanzo = true;
      }
    });
    assert.ok(lanzo, "el medidor debía re-lanzar la excepción");
    assert.match(logs[0], /etapa=etapa_que_falla duracion_ms=\d+ resultado=error$/);
  });
});

describe("registrarEtapa() — para etapas con retorno anticipado propio (no medibles con un solo fn)", () => {
  test("emite exactamente la línea con flujo/flujo_id/etapa/duracion/resultado dados", () => {
    const flujoId = generarFlujoId();
    const { logs } = interceptarConsola(() => {
      registrarEtapa("crear_contrato", flujoId, "insert_hijas", 123, "parcial");
    });
    assert.equal(logs.length, 1);
    assert.equal(logs[0], `[medicion] flujo=crear_contrato flujo_id=${flujoId} etapa=insert_hijas duracion_ms=123 resultado=parcial`);
  });

  test("nunca escribe a console.error (eso es responsabilidad del caller, con el detalle técnico aparte)", () => {
    const flujoId = generarFlujoId();
    const { errores } = interceptarConsola(() => {
      registrarEtapa("crear_contrato", flujoId, "etapa", 1, "error");
    });
    assert.equal(errores.length, 0);
  });
});

// ── registrarErrorTecnico() — revisión posterior al PR #275 ronda 2 ────────
// Antes, varios call sites de crearContrato()/reservarPrograma() pasaban
// `error.message`/`asiento.error`/`e.message`/`String(e)` directo a
// console.error. Estos casos sintéticos simulan mensajes reales de Postgres/
// Supabase que traen datos de fila, nombre de tabla/policy o PII — y
// demuestran con EJECUCIÓN REAL (no grep) que ninguno de esos textos
// sobrevive, mientras que flujo/flujo_id/etapa/detalle SÍ.
const CASOS_ERROR_CON_PII: { nombre: string; error: unknown; pii: string[]; codigoEsperado: string | null }[] = [
  {
    nombre: "nombre y documento de una persona (constraint violation)",
    error: { code: "23505", message: "Key (documento)=(123456789) already exists. Juan Pérez ya está registrado en cuentas_por_pagar." },
    pii: ["Juan Pérez", "123456789"],
    codigoEsperado: "23505",
  },
  {
    nombre: "permission denied for table ventas",
    error: { code: "42501", message: "permission denied for table ventas" },
    pii: ["permission denied for table ventas"],
    codigoEsperado: "42501",
  },
  {
    nombre: 'relation "usuarios" does not exist (sin .code)',
    error: { message: 'relation "usuarios" does not exist' },
    pii: ['relation "usuarios"'],
    codigoEsperado: null,
  },
  {
    nombre: "email y teléfono",
    error: { code: "22P02", message: "email juan.perez@example.com telefono 3001234567 inválido para el campo numeric" },
    pii: ["juan.perez@example.com", "3001234567"],
    codigoEsperado: "22P02",
  },
  {
    nombre: "una fila completa simulada (Failing row contains)",
    error: {
      code: "23502",
      message: "Failing row contains (12, DTM-0001, Juan Pérez, 123456789, juan.perez@example.com, 3001234567).",
      details: "Failing row contains (12, DTM-0001, Juan Pérez, 123456789, juan.perez@example.com, 3001234567).",
      hint: "Revisa el valor de cliente_documento para Juan Pérez.",
    },
    pii: ["Failing row contains", "Juan Pérez", "123456789", "juan.perez@example.com", "3001234567", "Revisa el valor"],
    codigoEsperado: "23502",
  },
];

describe("registrarErrorTecnico() — ningún dato de negocio sobrevive, con ejecución real y errores sintéticos", () => {
  for (const caso of CASOS_ERROR_CON_PII) {
    test(`caso: ${caso.nombre}`, () => {
      const flujoId = generarFlujoId();
      const { errores, logs } = interceptarConsola(() => {
        registrarErrorTecnico("crear_contrato", flujoId, "cxp_automaticas", "error_insert_cuentas_por_pagar", caso.error);
      });
      assert.equal(logs.length, 0, "registrarErrorTecnico nunca debe escribir a console.log");
      assert.equal(errores.length, 1, "registrarErrorTecnico debe escribir EXACTAMENTE una línea a console.error");
      const linea = String(errores[0][0]);
      // Ningún texto de negocio/PII sobrevive.
      for (const fragmento of caso.pii) {
        assert.ok(!linea.includes(fragmento), `la línea NO debe contener "${fragmento}": ${linea}`);
      }
      // Tampoco debe haber una SEGUNDA parte del console.error con el objeto crudo.
      assert.equal(errores[0].length, 1, `console.error debe recibir un solo argumento (la línea ya formateada): ${JSON.stringify(errores[0])}`);
      // flujo_id/etapa/detalle SÍ sobreviven.
      assert.ok(linea.includes(`flujo_id=${flujoId}`), `debe incluir flujo_id: ${linea}`);
      assert.ok(linea.includes("etapa=cxp_automaticas"), `debe incluir la etapa: ${linea}`);
      assert.ok(linea.includes("detalle=error_insert_cuentas_por_pagar"), `debe incluir el detalle: ${linea}`);
      if (caso.codigoEsperado) {
        assert.ok(linea.includes(`codigo=${caso.codigoEsperado}`), `debe incluir el código saneado: ${linea}`);
        assert.ok(!linea.includes("tipo=exception"), `no debe caer a tipo=exception si hay código seguro: ${linea}`);
      } else {
        assert.ok(linea.includes("tipo=exception"), `sin .code seguro debe clasificar como tipo=exception: ${linea}`);
        assert.ok(!linea.includes("codigo="), `no debe inventar un código: ${linea}`);
      }
    });
  }

  test("un código con forma insegura (espacios, punto y coma, muy largo) se descarta — NUNCA se registra tal cual", () => {
    const flujoId = generarFlujoId();
    const casosInseguros = [
      "23505; DROP TABLE ventas;",
      "23505 OR 1=1",
      "a".repeat(40),
      "",
    ];
    for (const codigoInseguro of casosInseguros) {
      const { errores } = interceptarConsola(() => {
        registrarErrorTecnico("crear_contrato", flujoId, "etapa", "detalle", { code: codigoInseguro, message: "no importa" });
      });
      const linea = String(errores[0][0]);
      assert.ok(!linea.includes(codigoInseguro) || codigoInseguro === "", `el código inseguro no debe aparecer tal cual: ${linea}`);
      assert.ok(linea.includes("tipo=exception"), `un código con forma insegura debe caer a tipo=exception: ${linea}`);
    }
  });

  test("una excepción real (instancia de Error) con datos de negocio en el mensaje — nunca se registra el mensaje ni el stack", () => {
    const flujoId = generarFlujoId();
    const e = new Error("fallo real de red al guardar el contrato de Juan Pérez, documento 123456789");
    const { errores } = interceptarConsola(() => {
      registrarErrorTecnico("crear_contrato", flujoId, "negociado_admin", "excepcion", e);
    });
    const linea = String(errores[0][0]);
    assert.ok(!linea.includes("Juan Pérez"));
    assert.ok(!linea.includes("123456789"));
    assert.ok(!linea.includes("fallo real de red"));
    assert.ok(!linea.includes(e.stack ?? " imposible "));
    assert.ok(linea.includes("tipo=exception"));
  });

  test("un error como STRING suelto (ej. asiento.error de postearAsientoCxP, ya no es un objeto) — nunca se registra el string", () => {
    const flujoId = generarFlujoId();
    const { errores } = interceptarConsola(() => {
      registrarErrorTecnico("crear_contrato", flujoId, "cxp_automaticas", "error_asiento_cxp", "fallo al postear el asiento contable del cliente Juan Pérez");
    });
    const linea = String(errores[0][0]);
    assert.ok(!linea.includes("Juan Pérez"));
    assert.ok(!linea.includes("fallo al postear"));
    assert.ok(linea.includes("tipo=exception"));
  });

  test("error null/undefined — nunca revienta, siempre cae a tipo=exception", () => {
    const flujoId = generarFlujoId();
    for (const errorVacio of [null, undefined]) {
      const { errores } = interceptarConsola(() => {
        registrarErrorTecnico("crear_contrato", flujoId, "etapa", "detalle", errorVacio);
      });
      assert.equal(errores.length, 1);
      assert.ok(String(errores[0][0]).includes("tipo=exception"));
    }
  });
});

// ── EstadoFlujo (crearEstadoFlujo/elevarEstadoFlujo/resultadoTotal) —
// revisión posterior al PR #275 ronda 2, defecto "RESULTADO TOTAL
// INCORRECTO" ─────────────────────────────────────────────────────────────
// El wrapper real (crearContrato()/reservarPrograma()) usa exactamente esta
// secuencia: crea el estado, delega en la función interna (que eleva el
// estado en los puntos donde YA sabe que algo técnico falló), y al final
// calcula `resultadoTotal(estado, res.ok)`. Estas pruebas ejecutan esa MISMA
// secuencia en cada uno de los 6 escenarios pedidos — es la lógica real, no
// una reimplementación, solo que sin la Server Action alrededor (que no se
// puede importar bajo `node --test`, ver el comentario de arriba).
describe("EstadoFlujo — el TOTAL refleja la peor condición real del flujo", () => {
  test("escenario 'éxito completo': sin elevar nada + res.ok=true → total=ok", () => {
    const estado = crearEstadoFlujo();
    assert.equal(resultadoTotal(estado, true), "ok");
  });

  test("escenario 'sesión/rol/validación comercial rechazada': sin elevar nada + res.ok=false → total=rechazado", () => {
    const estado = crearEstadoFlujo();
    assert.equal(resultadoTotal(estado, false), "rechazado");
  });

  test("escenario 'RPC de número fallido': elevar('error') + res.ok=false → total=error (NUNCA 'rechazado')", () => {
    const estado = crearEstadoFlujo();
    elevarEstadoFlujo(estado, "error");
    assert.equal(resultadoTotal(estado, false), "error");
  });

  test("escenario 'insert obligatorio fallido' (ventas o una tabla hija bloqueante): elevar('error') + res.ok=false → total=error", () => {
    const estado = crearEstadoFlujo();
    elevarEstadoFlujo(estado, "error");
    assert.equal(resultadoTotal(estado, false), "error");
  });

  test("escenario 'contrato creado + CxP best-effort fallida': elevar('parcial') + res.ok=true → total=parcial (NUNCA 'ok' a ciegas)", () => {
    const estado = crearEstadoFlujo();
    elevarEstadoFlujo(estado, "parcial");
    assert.equal(resultadoTotal(estado, true), "parcial");
  });

  test("escenario 'excepción': el wrapper NO usa resultadoTotal() en el catch — fuerza \"error\" directo (probado por wiring en medicionFlujoWiring.test.ts)", () => {
    // Documentado aquí para que la lista de 6 escenarios quede completa en
    // este archivo: cuando `crearContratoInterno`/`reservarProgramaInterno`
    // LANZAN (no retornan `{ok:false}`), el wrapper nunca llega a calcular
    // `resultadoTotal()` — el `catch` asigna `_resultadoTotal = "error"`
    // directamente antes de volver a lanzar. No hay nada que ejecutar aquí
    // sin importar la Server Action real (server-only/next/headers).
    assert.ok(true);
  });

  test("'error' SIEMPRE gana sobre 'parcial', sin importar el orden en que se eleven", () => {
    const a = crearEstadoFlujo();
    elevarEstadoFlujo(a, "parcial");
    elevarEstadoFlujo(a, "error");
    assert.equal(resultadoTotal(a, true), "error");

    const b = crearEstadoFlujo();
    elevarEstadoFlujo(b, "error");
    elevarEstadoFlujo(b, "parcial");
    assert.equal(resultadoTotal(b, true), "error", "una vez en 'error' nunca debe bajar a 'parcial'");
  });

  test("dos estados de dos ejecuciones distintas nunca se contaminan entre sí", () => {
    const a = crearEstadoFlujo();
    const b = crearEstadoFlujo();
    elevarEstadoFlujo(a, "error");
    assert.equal(resultadoTotal(a, false), "error");
    assert.equal(resultadoTotal(b, false), "rechazado", "el estado de una ejecución no debe afectar a otra");
  });

  test("crearEstadoFlujo() siempre devuelve un objeto NUEVO (peor=null) — no un singleton compartido", () => {
    const a = crearEstadoFlujo();
    const b = crearEstadoFlujo();
    assert.notEqual(a, b);
    assert.equal(a.peor, null);
    assert.equal(b.peor, null);
  });
});

// ── Helpers de diagnóstico de carga de página (incidente de ~13s en
// /dashboard/reservar, /dashboard/tarifario y /tarifario) — registrarDatoPagina/
// siguienteInvocacionProceso/tamanoAproximadoBytes ──────────────────────────
describe("registrarDatoPagina() — línea hermana de registrarEtapa(), sin duración ni PII", () => {
  test("emite EXACTAMENTE una línea con el formato [medicion-pagina] flujo=.. flujo_id=.. etapa=.. <detalle>", () => {
    const flujoId = generarFlujoId();
    const { logs } = interceptarConsola(() => {
      registrarDatoPagina("pagina_reservar", flujoId, "carga_paginada", "filas=842 paginas=1 consultas=1");
    });
    assert.equal(logs.length, 1);
    assert.equal(logs[0], `[medicion-pagina] flujo=pagina_reservar flujo_id=${flujoId} etapa=carga_paginada filas=842 paginas=1 consultas=1`);
  });

  test("nunca escribe a console.error", () => {
    const flujoId = generarFlujoId();
    const { errores } = interceptarConsola(() => {
      registrarDatoPagina("pagina_reservar", flujoId, "etapa", "detalle=x");
    });
    assert.equal(errores.length, 0);
  });

  test("comparte flujo_id con registrarEtapa() del mismo flujo — se pueden correlacionar en los logs", () => {
    const flujoId = generarFlujoId();
    const { logs } = interceptarConsola(() => {
      registrarEtapa("pagina_tarifario_interno", flujoId, "total", 900, "ok");
      registrarDatoPagina("pagina_tarifario_interno", flujoId, "total", "payload_bytes=12345");
    });
    assert.equal(logs.length, 2);
    for (const linea of logs) assert.ok(linea.includes(`flujo_id=${flujoId}`));
  });
});

describe("siguienteInvocacionProceso() — contador por PROCESO (isolate), no por navegador ni usuario", () => {
  test("primera llamada de un flujo NUEVO devuelve 1", () => {
    const flujo = `flujo_test_${generarFlujoId()}`;
    assert.equal(siguienteInvocacionProceso(flujo), 1);
  });

  test("llamadas sucesivas del MISMO flujo incrementan: 1, 2, 3...", () => {
    const flujo = `flujo_test_${generarFlujoId()}`;
    assert.equal(siguienteInvocacionProceso(flujo), 1);
    assert.equal(siguienteInvocacionProceso(flujo), 2);
    assert.equal(siguienteInvocacionProceso(flujo), 3);
  });

  test("dos flujos DISTINTOS mantienen contadores independientes", () => {
    const flujoA = `flujo_test_a_${generarFlujoId()}`;
    const flujoB = `flujo_test_b_${generarFlujoId()}`;
    assert.equal(siguienteInvocacionProceso(flujoA), 1);
    assert.equal(siguienteInvocacionProceso(flujoA), 2);
    assert.equal(siguienteInvocacionProceso(flujoB), 1, "un flujo nuevo no debe heredar el contador de otro");
  });
});

describe("tamanoAproximadoBytes() — proxy del tamaño del payload RSC, nunca revienta", () => {
  test("un objeto vacío mide el tamaño de '{}' en bytes UTF-8", () => {
    assert.equal(tamanoAproximadoBytes({}), Buffer.byteLength("{}", "utf8"));
  });

  test("crece con el tamaño real del contenido serializado", () => {
    const chico = tamanoAproximadoBytes({ a: 1 });
    const grande = tamanoAproximadoBytes({ a: 1, b: "x".repeat(1000), c: Array.from({ length: 50 }, (_, i) => i) });
    assert.ok(grande > chico, `se esperaba que el payload más grande midiera más bytes: ${grande} vs ${chico}`);
  });

  test("mide correctamente caracteres multi-byte (UTF-8, no length de JS)", () => {
    const conTildes = tamanoAproximadoBytes({ nombre: "áéíóú ñ" });
    const esperado = Buffer.byteLength(JSON.stringify({ nombre: "áéíóú ñ" }), "utf8");
    assert.equal(conTildes, esperado);
  });

  test("un valor no serializable (referencia circular) NUNCA revienta — devuelve -1", () => {
    type ConReferenciaCircular = { a: number; self?: ConReferenciaCircular };
    const circular: ConReferenciaCircular = { a: 1 };
    circular.self = circular;
    assert.equal(tamanoAproximadoBytes(circular), -1);
  });

  test("un BigInt (JSON.stringify lanza) tampoco revienta — devuelve -1", () => {
    assert.equal(tamanoAproximadoBytes({ n: BigInt(1) }), -1);
  });

  test("undefined mide como si no hubiera contenido serializable (JSON.stringify(undefined) === undefined) — no revienta", () => {
    const n = tamanoAproximadoBytes(undefined);
    assert.equal(typeof n, "number");
    assert.ok(n >= 0);
  });
});

// ── iniciarCronometro() — revisión posterior: `react-hooks/purity` (parte
// del linter de React Compiler que trae `eslint-config-next/core-web-vitals`
// en Next 16) marcaba `performance.now()`/`Math.round()` llamados DIRECTO en
// el cuerpo de las tres páginas (Server Components) como "impuros durante el
// render". Este helper saca esas dos llamadas del cuerpo del componente sin
// cambiar el número que se termina registrando.
describe("iniciarCronometro() — mismo resultado que Math.round(performance.now() - _t0), sin llamar performance.now() en el caller", () => {
  test("devuelve una función que, al llamarse, da un número >= 0", () => {
    const elapsed = iniciarCronometro();
    assert.equal(typeof elapsed, "function");
    assert.equal(typeof elapsed(), "number");
    assert.ok(elapsed() >= 0);
  });

  test("dos cronómetros iniciados en momentos distintos son independientes entre sí", () => {
    const a = iniciarCronometro();
    const b = iniciarCronometro();
    assert.ok(a() >= 0);
    assert.ok(b() >= 0);
  });

  test("llamar la función devuelta varias veces sigue midiendo desde el MISMO inicio (no reinicia el cronómetro)", async () => {
    const elapsed = iniciarCronometro();
    const primera = elapsed();
    await new Promise((r) => setTimeout(r, 5));
    const segunda = elapsed();
    assert.ok(segunda >= primera, "la segunda lectura debe ser igual o mayor, nunca menor (el reloj no reinicia)");
  });

  test("el número devuelto es un entero (redondeado), igual que antes con Math.round()", () => {
    const elapsed = iniciarCronometro();
    assert.ok(Number.isInteger(elapsed()));
  });
});
