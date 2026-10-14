// Lógica REAL de eliminación de hoteles (lib/hoteles/eliminarHotel.ts) contra
// una base simulada en memoria que reproduce las FK reales hacia `hoteles`:
//   - tarifario_resultado.hotel_id SIN ON DELETE (migración 018): el DELETE
//     falla con 23503 "tarifario_resultado_hotel_id_fkey" (caso real hotel 99);
//   - armado_hoteles.hotel_id ON DELETE RESTRICT (migración 209; antes
//     CASCADE y quitaba el hotel del paquete en silencio): el
//     DELETE falla con 23503 y no cambia nada. El comportamiento real de la
//     base (incluida la carrera) se prueba en PostgreSQL, no aquí.
// Lo que se exige: con vínculos no se ejecuta ningún DELETE y se devuelven los
// paquetes afectados; sin vínculos se borra y solo se informa éxito si el
// DELETE devolvió la fila; ningún texto técnico de la base llega al usuario.
import { test } from "node:test";
import assert from "node:assert/strict";
import { eliminarHotelSeguro, mensajeHotelEnUso } from "../lib/hoteles/eliminarHotel.ts";

type Err = { message: string; code?: string; details?: string } | null;
type Db = {
  hoteles: Array<{ id: number; nombre: string }>;
  armado_hoteles: Array<{ id: number; paquete_id: number; hotel_id: number }>;
  tarifario_resultado: Array<{ id: number; paquete_id: number; hotel_id: number }>;
  armado_paquetes: Array<{ id: number; nombre: string }>;
};
type Opts = {
  maxFilas?: number;              // límite de filas por respuesta del proyecto
  errorLectura?: Partial<Record<"hoteles" | "armado_hoteles" | "tarifario_resultado", Err>>;
  vinculoTrasRevision?: boolean;  // carrera: otro usuario lo vincula a un paquete justo antes del DELETE
  rlsBloqueaDelete?: boolean;     // la policy filtra la fila: DELETE de 0 filas
  errorDelete?: Err;              // error forzado del DELETE
};

const FK_ARMADO: Err = {
  code: "23503",
  message: 'update or delete on table "hoteles" violates foreign key constraint "armado_hoteles_hotel_id_fkey" on table "armado_hoteles"',
  details: 'Key (id)=(99) is still referenced from table "armado_hoteles".',
};
const FK_TARIFARIO: Err = {
  code: "23503",
  message: 'update or delete on table "hoteles" violates foreign key constraint "tarifario_resultado_hotel_id_fkey" on table "tarifario_resultado"',
  details: 'Key (id)=(99) is still referenced from table "tarifario_resultado".',
};

const MENSAJE_PAQUETES =
  'No se puede eliminar "Hotel Caribe": está vinculado a uno o más paquetes (en su armado o en tarifarios generados). Quítalo de esos paquetes, regenera sus tarifarios y vuelve a intentarlo. No se borró nada.';

function base(parcial: Partial<Db> = {}): Db {
  return {
    hoteles: [{ id: 99, nombre: "Hotel Caribe" }],
    armado_hoteles: [],
    tarifario_resultado: [],
    armado_paquetes: [{ id: 7, nombre: "San Andrés Octubre" }, { id: 12, nombre: "Cartagena Puente" }],
    ...parcial,
  };
}

function clienteFalso(db: Db, o: Opts = {}) {
  const ops: string[] = [];
  const sb = {
    from(tabla: keyof Db) {
      return {
        select(cols: string) {
          const filtro: { eq?: [string, unknown]; in?: number[] } = {};
          const q = {
            eq(col: string, v: unknown) { filtro.eq = [col, v]; return q; },
            in(_col: string, ids: number[]) {
              filtro.in = ids;
              ops.push(`leer ${tabla}`);
              const filas = db[tabla].filter((f) => ids.includes(f.id));
              return Promise.resolve({ data: filas, error: null });
            },
            order() { return q; },
            async maybeSingle() {
              ops.push(`leer ${tabla}`);
              const e = o.errorLectura?.[tabla as "hoteles"];
              if (e) return { data: null, error: e };
              const [col, v] = filtro.eq!;
              return { data: (db[tabla] as Array<Record<string, unknown>>).find((f) => f[col] === v) ?? null, error: null };
            },
            async range(desde: number, hasta: number) {
              assert.equal(cols, "paquete_id");
              ops.push(`leer ${tabla} ${desde}`);
              const e = o.errorLectura?.[tabla as "armado_hoteles"];
              if (e) return { data: null, error: e };
              const [col, v] = filtro.eq!;
              const todas = (db[tabla] as Array<Record<string, unknown>>).filter((f) => f[col] === v);
              const pedidas = hasta - desde + 1;
              return { data: todas.slice(desde, desde + Math.min(pedidas, o.maxFilas ?? pedidas)), error: null };
            },
          };
          return q;
        },
        delete() {
          assert.equal(tabla, "hoteles");
          return { eq: (_c: string, id: number) => ({ async select(cols: string) {
            assert.equal(cols, "id");
            ops.push("DELETE hoteles");
            if (o.errorDelete) return { data: null, error: o.errorDelete };
            if (o.vinculoTrasRevision) db.armado_hoteles.push({ id: 999, paquete_id: 7, hotel_id: id });
            if (db.armado_hoteles.some((f) => f.hotel_id === id)) return { data: null, error: FK_ARMADO };
            if (db.tarifario_resultado.some((f) => f.hotel_id === id)) return { data: null, error: FK_TARIFARIO };
            if (o.rlsBloqueaDelete || !db.hoteles.some((h) => h.id === id)) return { data: [], error: null };
            db.hoteles = db.hoteles.filter((h) => h.id !== id);
            return { data: [{ id }], error: null };
          } }) };
        },
      };
    },
  };
  return { sb: sb as never, ops };
}

// ── Rechazo: hotel vinculado ────────────────────────────────────────────────

test("caso real hotel 99: está en el tarifario generado de un paquete → no ejecuta DELETE y nombra el paquete", async () => {
  const db = base({ tarifario_resultado: [{ id: 1, paquete_id: 7, hotel_id: 99 }, { id: 2, paquete_id: 7, hotel_id: 99 }] });
  const { sb, ops } = clienteFalso(db);
  const r = await eliminarHotelSeguro(sb, 99);
  assert.deepEqual(r, {
    ok: false,
    error: 'No se puede eliminar "Hotel Caribe": está vinculado a 1 paquete. Quítalo de ese paquete y regenera su tarifario; después vuelve a intentarlo. No se borró nada.',
    paquetes: [{ id: 7, nombre: "San Andrés Octubre", enArmado: false, enTarifario: true }],
  });
  assert.ok(!ops.includes("DELETE hoteles"));
  assert.equal(db.hoteles.length, 1);
});

test("solo en el armado (sin tarifario aún): NO borra — antes el CASCADE lo quitaba del paquete en silencio", async () => {
  const db = base({ armado_hoteles: [{ id: 1, paquete_id: 12, hotel_id: 99 }] });
  const { sb, ops } = clienteFalso(db);
  const r = await eliminarHotelSeguro(sb, 99);
  assert.equal(r.ok, false);
  assert.deepEqual(!r.ok && r.paquetes, [{ id: 12, nombre: "Cartagena Puente", enArmado: true, enTarifario: false }]);
  assert.ok(!ops.includes("DELETE hoteles"));
  assert.deepEqual(db.armado_hoteles, [{ id: 1, paquete_id: 12, hotel_id: 99 }], "el vínculo del paquete sigue intacto");
});

test("varios paquetes (armado y/o tarifario): lista única, ordenada, con dónde aparece en cada uno", async () => {
  const db = base({
    armado_hoteles: [{ id: 1, paquete_id: 12, hotel_id: 99 }, { id: 2, paquete_id: 7, hotel_id: 99 }],
    tarifario_resultado: [{ id: 1, paquete_id: 7, hotel_id: 99 }, { id: 2, paquete_id: 30, hotel_id: 99 }],
  });
  const { sb } = clienteFalso(db);
  const r = await eliminarHotelSeguro(sb, 99);
  assert.equal(r.ok, false);
  assert.match(!r.ok ? r.error : "", /vinculado a 3 paquetes\. Quítalo de cada paquete/);
  assert.deepEqual(!r.ok && r.paquetes, [
    { id: 7, nombre: "San Andrés Octubre", enArmado: true, enTarifario: true },
    { id: 12, nombre: "Cartagena Puente", enArmado: true, enTarifario: false },
    { id: 30, nombre: "Paquete #30", enArmado: false, enTarifario: true },
  ]);
});

test("tarifario con más filas que el límite del proyecto: pagina y encuentra el paquete de la última página", async () => {
  const filas = Array.from({ length: 2300 }, (_, i) => ({ id: i + 1, paquete_id: i < 2299 ? 7 : 12, hotel_id: 99 }));
  const { sb, ops } = clienteFalso(base({ tarifario_resultado: filas }), { maxFilas: 500 });
  const r = await eliminarHotelSeguro(sb, 99);
  assert.deepEqual(!r.ok && r.paquetes?.map((p) => p.id), [7, 12]);
  assert.ok(ops.includes("leer tarifario_resultado 2000"), "avanza por las filas recibidas (500), no por las pedidas");
  assert.ok(!ops.includes("DELETE hoteles"));
});

test("si la revisión de vínculos falla, no borra (un 0 supuesto dejaría pasar un hotel que está en un paquete)", async () => {
  for (const tabla of ["armado_hoteles", "tarifario_resultado"] as const) {
    const { sb, ops } = clienteFalso(base(), { errorLectura: { [tabla]: { message: "timeout" } } });
    const r = await eliminarHotelSeguro(sb, 99);
    assert.deepEqual(r, { ok: false, error: "No se pudo verificar si el hotel está en paquetes. No se borró nada; intenta de nuevo." });
    assert.ok(!ops.includes("DELETE hoteles"), tabla);
  }
});

test("23503 de tarifario_resultado en el DELETE (vínculo aparecido tras la revisión): mensaje comprensible, no el técnico", async () => {
  const { sb } = clienteFalso(base(), { errorDelete: FK_TARIFARIO });
  const r = await eliminarHotelSeguro(sb, 99);
  assert.deepEqual(r, {
    ok: false,
    error: MENSAJE_PAQUETES,
  });
});

test("CARRERA: lo vinculan a un paquete tras la revisión → la base (RESTRICT) lo rechaza y el mensaje es comprensible", async () => {
  const db = base();
  const { sb } = clienteFalso(db, { vinculoTrasRevision: true });
  const r = await eliminarHotelSeguro(sb, 99);
  assert.deepEqual(r, { ok: false, error: MENSAJE_PAQUETES });
  assert.equal(db.hoteles.length, 1, "el hotel sigue");
  assert.equal(db.armado_hoteles.length, 1, "el vínculo con el paquete sigue");
});

test("ningún texto técnico de la base llega al usuario (tablas, restricciones, detalle, códigos)", async () => {
  const sensibles = [/fkey/, /foreign key/i, /violates/, /Key \(id\)/, /tarifario_resultado/, /armado_hoteles/, /hoteles"/, /57014/, /timeout/i, /JWT/, /\(tarifas\)/];
  const casos: Array<[string, Opts]> = [
    ["fk tarifario", { errorDelete: FK_TARIFARIO }],
    ["fk armado", { errorDelete: FK_ARMADO }],
    ["fk otra tabla", { errorDelete: { code: "23503", message: 'update or delete on table "hoteles" violates foreign key constraint "tarifas_hotel_id_fkey" on table "tarifas"', details: 'Key (id)=(99) is still referenced from table "tarifas".' } }],
    ["timeout", { errorDelete: { message: "canceling statement due to statement timeout", code: "57014" } }],
    ["error al leer el hotel", { errorLectura: { hoteles: { message: "JWT expired" } } }],
    ["error al revisar vínculos", { errorLectura: { armado_hoteles: { message: "timeout" } } }],
  ];
  const consola = console.error; console.error = () => {};
  try {
    for (const [caso, o] of casos) {
      const { sb } = clienteFalso(base(), o);
      const r = await eliminarHotelSeguro(sb, 99);
      assert.equal(r.ok, false, caso);
      for (const re of sensibles) assert.doesNotMatch(!r.ok ? r.error : "", re, `${caso}: ${re}`);
    }
  } finally { console.error = consola; }
});

test("el detalle técnico del DELETE va al registro del servidor, no a la pantalla", async () => {
  const registro: string[] = [];
  const consola = console.error; console.error = (m: string) => { registro.push(m); };
  try {
    const { sb } = clienteFalso(base(), { errorDelete: { message: "canceling statement due to statement timeout", code: "57014" } });
    await eliminarHotelSeguro(sb, 99);
  } finally { console.error = consola; }
  assert.deepEqual(registro, ["eliminarHotel: hotel 99: 57014: canceling statement due to statement timeout"]);
});

test("23503 de otra tabla (p. ej. las antiguas `tarifas` de la 004): mensaje genérico, sin nombrar tabla ni inventar paquetes", () => {
  assert.equal(
    mensajeHotelEnUso("Hotel Caribe", {
      message: 'update or delete on table "hoteles" violates foreign key constraint "tarifas_hotel_id_fkey" on table "tarifas"',
      details: 'Key (id)=(99) is still referenced from table "tarifas".',
    }),
    'No se puede eliminar "Hotel Caribe": otros registros todavía lo usan. No se borró nada.',
  );
});

test("DELETE de cero filas (RLS o ya no estaba) → error, nunca { ok: true }", async () => {
  const { sb } = clienteFalso(base(), { rlsBloqueaDelete: true });
  assert.deepEqual(await eliminarHotelSeguro(sb, 99), {
    ok: false, error: 'No se eliminó "Hotel Caribe": no tienes permiso para borrarlo o ya no existe.',
  });
});

test("otro error del DELETE: mensaje comprensible, sin el detalle técnico", async () => {
  const { sb } = clienteFalso(base(), { errorDelete: { message: "canceling statement due to statement timeout", code: "57014" } });
  const consola = console.error; console.error = () => {};
  try {
    assert.deepEqual(await eliminarHotelSeguro(sb, 99), {
      ok: false, error: 'No se pudo eliminar "Hotel Caribe". Intenta de nuevo; si persiste, avisa a soporte.',
    });
  } finally { console.error = consola; }
});

test("hotel inexistente o error al leerlo: error sin DELETE; id inválido: sin tocar Supabase", async () => {
  const a = clienteFalso(base({ hoteles: [] }));
  assert.deepEqual(await eliminarHotelSeguro(a.sb, 99), { ok: false, error: "El hotel ya no existe (pudo eliminarse en otra sesión). Recarga la página." });
  assert.ok(!a.ops.includes("DELETE hoteles"));

  const b = clienteFalso(base(), { errorLectura: { hoteles: { message: "JWT expired" } } });
  assert.deepEqual(await eliminarHotelSeguro(b.sb, 99), { ok: false, error: "No se pudo comprobar el hotel. Intenta de nuevo." });
  assert.deepEqual(b.ops, ["leer hoteles"]);

  for (const id of [0, -3, 1.5, Number.NaN]) {
    const c = clienteFalso(base());
    assert.deepEqual(await eliminarHotelSeguro(c.sb, id), { ok: false, error: "Hotel inválido." });
    assert.deepEqual(c.ops, []);
  }
});

// ── Éxito: sin referencias ──────────────────────────────────────────────────

test("sin referencias (ya desvinculado y regenerado): borra exactamente ese hotel", async () => {
  const db = base({
    hoteles: [{ id: 99, nombre: "Hotel Caribe" }, { id: 100, nombre: "Otro" }],
    armado_hoteles: [{ id: 1, paquete_id: 7, hotel_id: 100 }],
    tarifario_resultado: [{ id: 1, paquete_id: 7, hotel_id: 100 }],
  });
  const { sb, ops } = clienteFalso(db);
  assert.deepEqual(await eliminarHotelSeguro(sb, 99), { ok: true });
  assert.ok(ops.includes("DELETE hoteles"));
  assert.deepEqual(db.hoteles, [{ id: 100, nombre: "Otro" }]);
  assert.equal(db.armado_hoteles.length, 1, "los vínculos de otros hoteles no se tocan");
});
