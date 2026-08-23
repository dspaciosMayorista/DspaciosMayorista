import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const leer = (rel: string) => readFileSync(join(raiz, rel), "utf8");

// ───────────────────────────────────────────────────────────────────────────
// Editor operativo de vuelos del contrato (migración 157) — filas de origen
// "Contrato" en /dashboard/vuelos?vista=empaquetados. Cubre lo que las
// pruebas SQL reales (supabase/scripts/test_editor_vuelos_contrato.sql) no
// pueden: el wiring de UI (columnas separadas Record/Contrato, botón
// Completar/Editar vuelo, paso de props server→cliente) y patrones de código
// que las pruebas SQL no ejercitan directamente (validación en el server
// action, roles expuestos en el cliente).
//
// ⚠️ Estas pruebas de string/wiring por sí solas NO son suficientes (mismo
// criterio ya establecido en pruebas/empaquetados.test.ts) — se complementan
// con test_editor_vuelos_contrato.sql (SQL real: RLS/RPC/atomicidad/
// privilegios) y con la matriz completa de seguridad ahí.
// ───────────────────────────────────────────────────────────────────────────

describe("lib/roles.ts — ROLES_EDITOR_VUELOS_CONTRATO", () => {
  const src = leer("lib/roles.ts");

  test("incluye exactamente superadmin/gerencia/administracion/operaciones/control_vuelo — nunca venta", () => {
    assert.match(
      src,
      /export const ROLES_EDITOR_VUELOS_CONTRATO: readonly Rol\[\] = \["superadmin", "gerencia", "administracion", "operaciones", "control_vuelo"\];/
    );
  });

  test("refleja exactamente el rol/tenant de acceso_editar_vuelos_contrato()/acceso_ventas_vuelo_sistema() en la migración 157/156 (misma lista de roles, sin duplicarla)", () => {
    const mig157 = leer("supabase/migrations/20260601000157_editor_vuelos_contrato.sql");
    assert.match(mig157, /acceso_ventas_vuelo_sistema\(v\.tenant\)/, "acceso_editar_vuelos_contrato() debe reutilizar acceso_ventas_vuelo_sistema(), nunca duplicar la lista de roles en SQL");
  });
});

describe("EmpaquetadosTabla.tsx — Record/Contrato separados + columna Acciones", () => {
  const src = leer("app/(dashboard)/dashboard/vuelos/EmpaquetadosTabla.tsx");

  test("hay columnas de encabezado Record y Contrato separadas (ya no 'Record / Contrato' combinado)", () => {
    assert.match(src, /<th className="px-3 py-2">Record<\/th>/);
    assert.match(src, /<th className="px-3 py-2">Contrato<\/th>/);
    assert.doesNotMatch(src, /<th className="px-3 py-2">Record \/ Contrato<\/th>/, "el <th> combinado viejo no debe seguir existiendo (el texto puede mencionarse en comentarios explicando el cambio, eso está bien)");
  });

  test("hay una columna de encabezado Acciones", () => {
    assert.match(src, /<th className="px-3 py-2">Acciones<\/th>/);
  });

  test("acepta un prop puedeEditarVuelo (decidido en servidor, distinto de puedeVerContrato)", () => {
    assert.match(src, /puedeEditarVuelo:\s*boolean/);
  });

  test("origen contrato sin datos estructurados -> 'Completar vuelo'; con datos -> pencil 'Editar vuelo'", () => {
    assert.match(src, /tieneVueloEstructurado/);
    assert.match(src, /Completar vuelo/);
    assert.match(src, /title="Editar vuelo"/);
    // tieneVueloEstructurado se basa en ruta/vuelo_ida/vuelo_regreso — nunca
    // solo en record (un PNR anotado a mano sin cargar el itinerario no
    // cuenta como "ya completo").
    const fn = src.match(/function tieneVueloEstructurado[\s\S]*?\n}/)?.[0] ?? "";
    assert.match(fn, /f\.ruta/);
    assert.match(fn, /f\.vuelo_ida/);
    assert.match(fn, /f\.vuelo_regreso/);
    assert.doesNotMatch(fn, /f\.record/, "record NO debe ser parte del criterio de 'ya completo'");
  });

  test("el link de Acciones apunta a /dashboard/vuelos/contrato/[numeroContrato]", () => {
    assert.match(src, /\/dashboard\/vuelos\/contrato\/\$\{f\.numeroContrato\}/);
  });

  test("Acciones nunca se ofrece para origen 'promocion' ni cuando !puedeEditarVuelo (guion, nunca un link muerto)", () => {
    const cell = src.match(/<td className="px-3 py-2">\s*\{f\.origen !== "contrato" \|\| !puedeEditarVuelo[\s\S]*?<\/td>\s*<\/tr>/)?.[0] ?? "";
    assert.match(cell, /f\.origen !== "contrato" \|\| !puedeEditarVuelo/);
  });

  test("la columna Record de origen contrato es texto plano ('Sin PNR' si no hay) — nunca cae al número de contrato", () => {
    // Antes: record ?? numeroContrato. Ahora: record ?? "Sin PNR", en su propia celda.
    assert.match(src, /f\.record \?\? "Sin PNR"/);
  });

  test("la columna Contrato respeta puedeVerContrato (link solo si tiene acceso, texto plano si no)", () => {
    assert.match(src, /!puedeVerContrato/);
    assert.match(src, /Tu rol no tiene acceso a la ficha del contrato/);
  });
});

describe("vuelos/page.tsx y historico/page.tsx — estado_emision/estado_pago REALES, ya no hardcodeados a null", () => {
  const paginaActiva = leer("app/(dashboard)/dashboard/vuelos/page.tsx");
  const paginaHistorico = leer("app/(dashboard)/dashboard/vuelos/historico/page.tsx");

  for (const [nombre, src] of [["page.tsx", paginaActiva], ["historico/page.tsx", paginaHistorico]] as const) {
    test(`${nombre}: el mapeo de dinamicos ya NO fija estado_emision/estado_pago a null a mano`, () => {
      assert.doesNotMatch(src, /estado_emision:\s*null,\s*estado_pago:\s*null/, `${nombre} sigue con el hardcodeo viejo`);
    });

    test(`${nombre}: pasa d.estado_emision/d.estado_pago reales desde la vista`, () => {
      assert.match(src, /estado_emision:\s*d\.estado_emision/);
      assert.match(src, /estado_pago:\s*d\.estado_pago/);
    });

    test(`${nombre}: importa y calcula puedeEditarVuelo con ROLES_EDITOR_VUELOS_CONTRATO`, () => {
      assert.match(src, /ROLES_EDITOR_VUELOS_CONTRATO/);
      assert.match(src, /puedeEditarVuelo\s*=\s*!!rol\s*&&\s*ROLES_EDITOR_VUELOS_CONTRATO\.includes\(rol\)/);
    });

    test(`${nombre}: propaga puedeEditarVuelo a <EmpaquetadosTabla>`, () => {
      assert.match(src, /<EmpaquetadosTabla[\s\S]{0,200}puedeEditarVuelo=\{puedeEditarVuelo\}/);
    });
  }
});

describe("contrato-vuelos-actions.ts — server actions del editor", () => {
  const src = leer("app/(dashboard)/dashboard/vuelos/contrato-vuelos-actions.ts");

  test("es un archivo 'use server' — nunca usa el cliente service-role", () => {
    assert.match(src, /^"use server";/);
    assert.doesNotMatch(src, /createAdminClient|service_role/i, "el editor operativo NUNCA debe autorizar con service-role — el servidor Postgres decide vía RPC con el usuario real");
  });

  test("guardarTramosContrato llama al RPC guardar_tramos_contrato con p_numero_contrato/p_tramos", () => {
    assert.match(src, /sb\.rpc\("guardar_tramos_contrato",\s*\{/);
    assert.match(src, /p_numero_contrato:\s*numeroContrato/);
    assert.match(src, /p_tramos:/);
  });

  test("actualizarEstadoEmisionContrato llama al RPC actualizar_estado_emision_contrato", () => {
    assert.match(src, /sb\.rpc\("actualizar_estado_emision_contrato",\s*\{/);
  });

  test("guardarTramosContrato exige al menos un tramo ANTES de llamar al servidor (defensa temprana; el RPC es la autoridad real)", () => {
    assert.match(src, /Debe haber al menos un tramo/);
  });

  test("errores del RPC se propagan como { ok: false, error }, nunca se tragan en silencio", () => {
    const matches = src.match(/if \(error\) return \{ ok: false, error: error\.message \};/g) ?? [];
    assert.ok(matches.length >= 2, "ambas funciones (tramos y estado de emisión) deben propagar el error del RPC");
  });

  // ── Revisión adicional del PR #270, punto 4: guardarTramosContrato debe
  // devolver los tramos YA guardados (con id real) — TramosEditor.tsx los
  // necesita para sincronizar su estado local sin depender solo de
  // router.refresh(). ──
  test("guardarTramosContrato devuelve { ok: true, tramos } con los datos del RPC, nunca solo { ok: true }", () => {
    assert.match(src, /return \{ ok: true, tramos: \(data \?\? \[\]\) as TramoGuardado\[\] \};/);
  });

  test("TramoGuardado/ResultTramos existen y guardarTramosContrato declara devolver Promise<ResultTramos>", () => {
    assert.match(src, /export type TramoGuardado = \{/);
    assert.match(src, /type ResultTramos = \{ ok: true; tramos: TramoGuardado\[\] \} \| \{ ok: false; error: string \};/);
    assert.match(src, /export async function guardarTramosContrato\([^)]*\): Promise<ResultTramos>/);
  });

  // ── Revisión adicional del PR #270, punto 3: validarTramos() debe ser un
  // espejo LIVIANO de la validación real en Postgres — nunca la autoridad,
  // pero tampoco vacío como antes. ──
  describe("validarTramos() — espejo de la validación real en Postgres (solo UX)", () => {
    test("límite de tramos por contrato (20), igual que el RPC", () => {
      assert.match(src, /MAX_TRAMOS = 20/);
      assert.match(src, /tramos\.length > MAX_TRAMOS/);
    });

    test("valida id duplicado dentro del mismo payload", () => {
      assert.match(src, /idsVistos\.has\(t\.id\)/);
    });

    test("valida IATA de exactamente 3 letras y origen/destino juntos o ninguno", () => {
      assert.match(src, /RE_IATA = \/\^\[A-Z\]\{3\}\$\//);
      assert.match(src, /Boolean\(origen\) !== Boolean\(destino\)/);
    });

    test("valida formato de hora (HH:MM) y de fecha (YYYY-MM-DD)", () => {
      assert.match(src, /RE_HORA = \/\^\(\[01\]\[0-9\]\|2\[0-3\]\):\[0-5\]\[0-9\]\$\//);
      assert.match(src, /RE_FECHA = \/\^\\d\{4\}-\\d\{2\}-\\d\{2\}\$\//);
    });

    test("rechaza un tramo completamente vacío", () => {
      assert.match(src, /completamente vacío/);
    });
  });
});

describe("TramosEditor.tsx — editor de tramos, reemplazo atómico con ids preservados", () => {
  const src = leer("app/(dashboard)/dashboard/vuelos/contrato/[numero]/TramosEditor.tsx");

  test("cada tramo lleva su propio id (null si es nuevo) para que el RPC pueda conservarlo — el tipo TramoInput viene de contrato-vuelos-actions.ts", () => {
    const actions = leer("app/(dashboard)/dashboard/vuelos/contrato-vuelos-actions.ts");
    assert.match(actions, /id:\s*number\s*\|\s*null;/);
    assert.match(src, /import \{ guardarTramosContrato, type TramoInput \} from "\.\.\/\.\.\/contrato-vuelos-actions";/);
    assert.match(src, /id:\s*t\.id/, "deDB() debe conservar el id real de la fila leída de la base");
    assert.match(src, /id:\s*null,.*aerolinea:\s*""/, "TRAMO_VACIO (tramo nuevo) debe nacer con id null");
  });

  test("'+ Agregar regreso' invierte origen/destino y hereda aerolinea/record — mismo patrón que NuevoContratoForm", () => {
    const fn = src.match(/function agregarRegreso[\s\S]*?\n  \}/)?.[0] ?? "";
    assert.match(fn, /origenCodigo:\s*v\.destinoCodigo/);
    assert.match(fn, /destinoCodigo:\s*v\.origenCodigo/);
    assert.match(fn, /direccion:\s*"regreso"/);
  });

  test("exige al menos un tramo antes de guardar (no se puede vaciar el itinerario desde la UI)", () => {
    assert.match(src, /if \(!tramos\.length\)/);
  });

  test("usa ciudadIata para autocompletar la ciudad desde el código IATA (reutiliza lib/iata.ts, no reinventa el catálogo)", () => {
    assert.match(src, /import \{ ciudadIata \} from "@\/lib\/iata";/);
  });

  // ── Revisión adicional del PR #270, punto 4: tras guardar, el estado
  // local de React debe sincronizarse con los tramos YA guardados (id
  // reales) — nunca depender solo de router.refresh(), que no toca el
  // useState de este Client Component. Sin esto, un tramo nuevo (id:null al
  // enviarlo) seguía viéndose como id:null en memoria y el SIGUIENTE
  // guardado lo borraba y reinsertaba con un id DISTINTO en vez de
  // conservarlo. ──
  describe("guardar() sincroniza el estado local con los ids reales devueltos (fix del punto 4)", () => {
    const fn = src.match(/function guardar\(\) \{[\s\S]*?\n  \}/)?.[0] ?? "";

    test("en éxito, llama setTramos(...) con r.tramos (nunca confía solo en router.refresh())", () => {
      assert.match(fn, /setTramos\(r\.tramos\.length \? r\.tramos\.map\(deDB\) : \[TRAMO_VACIO\]\)/);
      assert.match(fn, /router\.refresh\(\);/, "router.refresh() se conserva para el resto de la página (historial), pero ya no es la única fuente de verdad del estado local");
    });

    test("en éxito usa deDB() para mapear los tramos devueltos — mismo mapper que la carga inicial, ninguno duplicado", () => {
      // 1 definición de deDB + 2 usos como mapper (.map(deDB)): carga inicial
      // (useState) y sincronización tras guardar (fix del punto 4).
      const usosMapDeDB = (src.match(/\.map\(deDB\)/g) ?? []).length;
      assert.equal(usosMapDeDB, 2, "deDB debe usarse como mapper tanto en la carga inicial (useState) como al sincronizar tras guardar — nunca un mapper distinto/duplicado");
    });

    test("en error, NUNCA toca setTramos ni router.refresh() — el estado local no cambia si el guardado falló", () => {
      assert.match(fn, /\} else \{\s*setOk\(false\); setMsg\(r\.error\);\s*\}/);
    });
  });
});

describe("ControlEmisionForm.tsx — estado de emisión del contrato completo (1:1, no por tramo)", () => {
  const src = leer("app/(dashboard)/dashboard/vuelos/contrato/[numero]/ControlEmisionForm.tsx");

  test("reutiliza ESTADOS_EMISION/POR_CONFIRMAR de lib/vuelos/control — no reinventa el dominio", () => {
    assert.match(src, /from "@\/lib\/vuelos\/control"/);
    assert.match(src, /ESTADOS_EMISION/);
    assert.match(src, /POR_CONFIRMAR/);
  });

  test("'Por confirmar' (NULL) es una opción real del select, nunca forzada a 'pendiente'", () => {
    assert.match(src, /<option value="">\{POR_CONFIRMAR\}<\/option>/);
  });

  test("llama a actualizarEstadoEmisionContrato con el numeroContrato del contrato completo (no un id de tramo)", () => {
    assert.match(src, /actualizarEstadoEmisionContrato\(numeroContrato,/);
  });

  // ── Revisión adicional del PR #270, punto 5: éxito y error deben verse
  // DISTINTOS (verde/rojo, no el mismo gris para ambos), nunca comportarse
  // como éxito si el RPC falló, el botón debe deshabilitarse mientras
  // guarda, y la nota se conserva si falla / se limpia solo si tuvo éxito. ──
  describe("feedback visual de éxito/error (fix del punto 5)", () => {
    test("mensaje de éxito y de error usan colores DISTINTOS (verde vs rojo) — nunca el mismo gris", () => {
      assert.match(src, /const \[ok, setOk\] = useState\(false\);/);
      assert.match(src, /\{msg && <span className=\{`text-sm \$\{ok \? "text-green-700" : "text-red-600"\}`\}>\{msg\}<\/span>\}/);
      assert.doesNotMatch(src, /text-gray-600.*\{msg\}/, "ya no debe quedar el span gris genérico que no distinguía éxito de error");
    });

    test("guardar(): éxito marca ok=true, error marca ok=false — nunca al revés", () => {
      const fn = src.match(/function guardar\(\) \{[\s\S]*?\n  \}/)?.[0] ?? "";
      assert.match(fn, /if \(r\.ok\) \{ setOk\(true\); setMsg\("Guardado\."\); setNota\(""\); router\.refresh\(\); \} else \{ setOk\(false\); setMsg\(r\.error\); \}/);
    });

    test("la nota SOLO se limpia en la rama de éxito — en error, setNota nunca se llama", () => {
      const fn = src.match(/function guardar\(\) \{[\s\S]*?\n  \}/)?.[0] ?? "";
      const ramaError = fn.match(/\} else \{[\s\S]*?\}$/)?.[0] ?? "";
      assert.doesNotMatch(ramaError, /setNota/, "si el guardado falla, la nota que el usuario escribió no debe borrarse");
    });

    test("el botón se deshabilita mientras la operación está en curso (pending)", () => {
      assert.match(src, /<Button onClick=\{guardar\} disabled=\{pending\}/);
    });
  });
});

describe("editor page — nunca expone cliente/pasajeros/precios/costos", () => {
  const src = leer("app/(dashboard)/dashboard/vuelos/contrato/[numero]/page.tsx");

  test("no consulta contrato_pasajeros, contrato_items ni ninguna columna financiera de ventas", () => {
    assert.doesNotMatch(src, /contrato_pasajeros/);
    assert.doesNotMatch(src, /contrato_items/);
    assert.doesNotMatch(src, /precio_venta|costo_hotel|costo_aereo|comision/i);
  });

  test("consulta ventas_vuelo_sistema (resumen) y contrato_vuelos_editor (todos los tramos) — nunca la tabla base ventas/contrato_vuelos directo", () => {
    assert.match(src, /from\("ventas_vuelo_sistema"\)/);
    assert.match(src, /from\("contrato_vuelos_editor"\)/);
    assert.doesNotMatch(src, /from\("ventas"\)/);
  });

  test("gate de rol con ROLES_EDITOR_VUELOS_CONTRATO antes de renderizar cualquier dato", () => {
    assert.match(src, /ROLES_EDITOR_VUELOS_CONTRATO\.includes\(rol\)/);
  });

  test("un error de consulta (RLS/red) se distingue explícitamente de 'contrato no encontrado' — nunca el mismo mensaje", () => {
    assert.match(src, /errResumen \|\| errTramos/);
    assert.match(src, /No se pudo cargar el vuelo de este contrato/);
    assert.match(src, /no encontrado, sin vuelo por sistema/);
  });
});
