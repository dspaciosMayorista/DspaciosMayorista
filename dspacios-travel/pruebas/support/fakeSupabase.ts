// Cliente Supabase FALSO, genérico, para pruebas de EJECUCIÓN REAL de
// orquestadores (computarReserva, etc.) — nunca reimplementa la lógica de
// negocio del orquestador: solo responde a `.from(tabla).select(...).eq()/
// .in()/.maybeSingle()` filtrando un dataset en memoria que el test provee,
// igual que PostgREST filtraría filas reales. Soporta un subconjunto
// deliberadamente pequeño de la API real (lo que de verdad usan los
// orquestadores probados en pruebas/reservaOrquestadorE2E.test.ts): select
// con joins embebidos declarados explícitamente (`joins`), eq/in
// encadenables, maybeSingle, y await directo (thenable) para el caso
// "arreglo de filas". No es un mock de PostgREST completo — cualquier
// operación no soportada lanza un error explícito en vez de fallar en
// silencio con un resultado vacío que disfrazaría un fixture incompleto
// como "no hay datos".

export type FilaFalsa = Record<string, unknown>;
export type TablasFalsas = Record<string, FilaFalsa[]>;
// joins[tabla][tablaEmbebida] = nombre de la columna FK en `tabla` que
// referencia el `id` de `tablaEmbebida`. Ej.: joins.armado_hoteles.hoteles = "hotel_id".
export type JoinsFalsos = Record<string, Record<string, string>>;

type Filtro = { col: string; op: "eq" | "in"; val: unknown };

function coincideFiltro(row: FilaFalsa, f: Filtro): boolean {
  if (f.op === "eq") return row[f.col] === f.val;
  return Array.isArray(f.val) && (f.val as unknown[]).includes(row[f.col]);
}

function conJoins(row: FilaFalsa, selectStr: string, joinsTabla: Record<string, string> | undefined): FilaFalsa {
  if (!joinsTabla) return row;
  const out: FilaFalsa = { ...row };
  for (const tablaEmbebida of Object.keys(joinsTabla)) {
    if (!selectStr.includes(`${tablaEmbebida}(`)) continue;
    // El valor real se inyecta en `ejecutar()` — acá solo se garantiza la
    // clave presente si el select la pide (evita `undefined` silencioso).
    if (!(tablaEmbebida in out)) out[tablaEmbebida] = null;
  }
  return out;
}

export type ClienteFalso = {
  from(tabla: string): QueryBuilderFalso;
  auth: { getUser(): Promise<{ data: { user: { id: string } | null }; error: null }> };
};

export type QueryBuilderFalso = {
  select(cols: string): QueryBuilderFalso;
  eq(col: string, val: unknown): QueryBuilderFalso;
  in(col: string, vals: unknown[]): QueryBuilderFalso;
  order(): QueryBuilderFalso;
  maybeSingle(): Promise<{ data: FilaFalsa | null; error: { message: string } | null }>;
  // Thenable: `await builder` sin `.maybeSingle()` se comporta como
  // `{data: FilaFalsa[], error: null}` (el patrón de select que devuelve
  // varias filas).
  then<TResult1 = { data: FilaFalsa[]; error: null }, TResult2 = never>(
    onfulfilled?: ((value: { data: FilaFalsa[]; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): Promise<TResult1 | TResult2>;
};

/**
 * Crea un cliente Supabase falso respaldado por `tablas` (dataset en
 * memoria) — `usuarioAutenticado` alimenta `.auth.getUser()` (null = sin
 * sesión, mismo comportamiento que `getContextoB2B` espera para el camino
 * "no B2B"). `joins` declara embebidos tipo `hoteles(nombre, moneda)`
 * explícitamente por tabla — nunca se infiere una convención de nombres
 * genérica, para no adivinar mal una relación real.
 */
export function crearClienteFalso(
  tablas: TablasFalsas,
  opciones: { joins?: JoinsFalsos; usuarioAutenticado?: { id: string } | null } = {}
): ClienteFalso {
  const joins = opciones.joins ?? {};
  function from(tabla: string): QueryBuilderFalso {
    const filtros: Filtro[] = [];
    let selectStr = "*";
    function ejecutar(): FilaFalsa[] {
      const base = tablas[tabla];
      if (base === undefined) {
        throw new Error(`crearClienteFalso: la tabla "${tabla}" no está en el fixture — el orquestador la consultó y no hay dataset preparado para ella (evita disfrazar un fixture incompleto como "sin filas").`);
      }
      const filtradas = base.filter((r) => filtros.every((f) => coincideFiltro(r, f)));
      const joinsTabla = joins[tabla];
      if (!joinsTabla) return filtradas.map((r) => ({ ...r }));
      return filtradas.map((r) => {
        const out = conJoins(r, selectStr, joinsTabla);
        for (const [tablaEmbebida, fk] of Object.entries(joinsTabla)) {
          if (!selectStr.includes(`${tablaEmbebida}(`)) continue;
          const fkVal = r[fk];
          const destino = tablas[tablaEmbebida];
          if (destino === undefined) {
            throw new Error(`crearClienteFalso: join declarado hacia "${tablaEmbebida}" pero esa tabla no está en el fixture.`);
          }
          out[tablaEmbebida] = destino.find((t) => t.id === fkVal) ?? null;
        }
        return out;
      });
    }
    const builder: QueryBuilderFalso = {
      select(cols: string) { selectStr = cols; return builder; },
      eq(col: string, val: unknown) { filtros.push({ col, op: "eq", val }); return builder; },
      in(col: string, vals: unknown[]) { filtros.push({ col, op: "in", val: vals }); return builder; },
      order() { return builder; },
      async maybeSingle() {
        const filas = ejecutar();
        if (filas.length > 1) return { data: null, error: { message: `maybeSingle(): ${filas.length} filas coincidieron en "${tabla}", se esperaba 0 o 1.` } };
        return { data: filas[0] ?? null, error: null };
      },
      then(onfulfilled, onrejected) {
        return Promise.resolve({ data: ejecutar(), error: null as null }).then(onfulfilled, onrejected);
      },
    };
    return builder;
  }
  return {
    from,
    auth: {
      async getUser() {
        return { data: { user: opciones.usuarioAutenticado ?? null }, error: null };
      },
    },
  };
}
