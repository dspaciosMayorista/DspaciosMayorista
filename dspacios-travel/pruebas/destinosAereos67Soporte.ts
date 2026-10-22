// #67 — soporte de pruebas (NO es una prueba: no termina en .test.ts, así que
// `test:unit` no lo recoge). BD en memoria con la API de supabase-js que usan
// los consumidores reales de #67: select/filtros/embebidos declarados, escrituras
// (insert/upsert/update/delete) que SÍ modifican las tablas y quedan registradas,
// RPC configurables y errores de lectura/escritura inyectables por tabla.
//
// Nunca reimplementa la lógica de negocio que se prueba: solo responde como
// PostgREST. Cualquier operación no soportada lanza un error explícito.

export type Fila = Record<string, unknown>;
export type Tablas = Record<string, Fila[]>;
export type Join = { fk: string; tabla: string; muchos?: boolean };
export type Joins = Record<string, Record<string, Join>>;

export type Escritura = {
  tabla: string;
  op: "insert" | "upsert" | "update" | "delete";
  filas?: Fila[];
  valores?: Fila;
  filtros: string[];
};
export type LlamadaRpc = { nombre: string; args: Record<string, unknown> };

export type OpcionesBd = {
  joins?: Joins;
  /** tabla -> mensaje: toda LECTURA de esa tabla devuelve error. */
  errorLectura?: Record<string, string>;
  /** tabla -> mensaje: toda ESCRITURA en esa tabla devuelve error (sin modificar nada). */
  errorEscritura?: Record<string, string>;
  /** RPC simulados por nombre. Los no declarados responden { data: null, error: null }. */
  rpc?: Record<string, (args: Record<string, unknown>, bd: BdFalsa) => { data: unknown; error: { message: string } | null }>;
};

export type BdFalsa = {
  tablas: Tablas;
  escrituras: Escritura[];
  rpcs: LlamadaRpc[];
  lecturas: string[];
  cliente: unknown;
};

type Predicado = (f: Fila) => boolean;

export function crearBd(tablasIniciales: Tablas, opciones: OpcionesBd = {}): BdFalsa {
  const tablas: Tablas = {};
  for (const [t, filas] of Object.entries(tablasIniciales)) tablas[t] = filas.map((f) => ({ ...f }));
  const joins = opciones.joins ?? {};
  const bd: BdFalsa = { tablas, escrituras: [], rpcs: [], lecturas: [], cliente: null };

  function filasDe(tabla: string): Fila[] {
    const base = tablas[tabla];
    if (base === undefined) {
      throw new Error(`crearBd: la tabla "${tabla}" no está en el fixture — el consumidor la consultó y no hay datos preparados (evita disfrazar un fixture incompleto como "sin filas").`);
    }
    return base;
  }

  function embeber(tabla: string, fila: Fila, cols: string): Fila {
    const j = joins[tabla];
    if (!j) return { ...fila };
    const out: Fila = { ...fila };
    for (const [clave, def] of Object.entries(j)) {
      if (!cols.includes(`${clave}(`)) continue;
      if (clave in out && out[clave] != null) continue; // el fixture ya lo trae embebido
      const destino = filasDe(def.tabla);
      if (def.muchos) out[clave] = destino.filter((d) => d.id === fila[def.fk]);
      else out[clave] = destino.find((d) => d.id === fila[def.fk]) ?? null;
    }
    return out;
  }

  function from(tabla: string) {
    const filtros: Predicado[] = [];
    const etiquetas: string[] = [];
    let cols = "*";
    let modo: "select" | "insert" | "upsert" | "update" | "delete" = "select";
    let payload: Fila[] = [];
    let valores: Fila = {};
    let onConflict: string[] = [];
    let ignorarDuplicados = false;
    let orden: { col: string; asc: boolean }[] = [];
    let rango: [number, number] | null = null;
    let limite: number | null = null;
    let devolver = false;

    function ejecutar(): { data: Fila[]; error: { message: string } | null } {
      if (modo === "select") {
        bd.lecturas.push(tabla);
        const msg = opciones.errorLectura?.[tabla];
        if (msg) return { data: null as unknown as Fila[], error: { message: msg } };
      } else {
        const msg = opciones.errorEscritura?.[tabla];
        if (msg) return { data: null as unknown as Fila[], error: { message: msg } };
      }
      const base = filasDe(tabla);
      const coincide = (f: Fila) => filtros.every((p) => p(f));

      if (modo === "insert") {
        const nuevas = payload.map((p) => {
          const f: Fila = { ...p };
          if (f.id === undefined && base.length && typeof base[0].id === "number") {
            f.id = Math.max(0, ...base.map((b) => Number(b.id) || 0)) + 1;
          }
          return f;
        });
        base.push(...nuevas);
        bd.escrituras.push({ tabla, op: "insert", filas: nuevas.map((f) => ({ ...f })), filtros: [...etiquetas] });
        return { data: nuevas, error: null };
      }
      if (modo === "upsert") {
        const aplicadas: Fila[] = [];
        for (const p of payload) {
          const existente = base.find((b) => onConflict.length > 0 && onConflict.every((c) => b[c] === p[c]));
          if (existente) {
            if (!ignorarDuplicados) Object.assign(existente, p);
            aplicadas.push(existente);
          } else {
            base.push({ ...p });
            aplicadas.push(p);
          }
        }
        bd.escrituras.push({ tabla, op: "upsert", filas: payload.map((f) => ({ ...f })), filtros: [...etiquetas] });
        return { data: aplicadas, error: null };
      }
      if (modo === "update") {
        const afectadas = base.filter(coincide);
        for (const f of afectadas) Object.assign(f, valores);
        bd.escrituras.push({ tabla, op: "update", valores: { ...valores }, filtros: [...etiquetas] });
        return { data: afectadas.map((f) => ({ ...f })), error: null };
      }
      if (modo === "delete") {
        const borradas = base.filter(coincide);
        tablas[tabla] = base.filter((f) => !coincide(f));
        bd.escrituras.push({ tabla, op: "delete", filtros: [...etiquetas] });
        return { data: borradas, error: null };
      }
      let filas = base.filter(coincide).map((f) => embeber(tabla, f, cols));
      for (const o of [...orden].reverse()) {
        filas = [...filas].sort((a, b) => {
          const x = a[o.col] as number | string | null | undefined;
          const y = b[o.col] as number | string | null | undefined;
          if (x == null && y == null) return 0;
          if (x == null) return 1;
          if (y == null) return -1;
          return (x < y ? -1 : x > y ? 1 : 0) * (o.asc ? 1 : -1);
        });
      }
      if (rango) filas = filas.slice(rango[0], rango[1] + 1);
      if (limite != null) filas = filas.slice(0, limite);
      return { data: filas, error: null };
    }

    const b: Record<string, unknown> = {};
    const agregar = (etq: string, p: Predicado) => { etiquetas.push(etq); filtros.push(p); return b; };
    b.select = (c = "*") => { if (modo === "select") cols = c; else devolver = true; return b; };
    b.eq = (c: string, v: unknown) => agregar(`eq:${c}=${String(v)}`, (f) => f[c] === v);
    b.neq = (c: string, v: unknown) => agregar(`neq:${c}=${String(v)}`, (f) => f[c] !== v);
    b.in = (c: string, v: unknown[]) => agregar(`in:${c}=[${v.join(",")}]`, (f) => v.includes(f[c]));
    b.gte = (c: string, v: unknown) => agregar(`gte:${c}=${String(v)}`, (f) => f[c] != null && (f[c] as string) >= (v as string));
    b.lte = (c: string, v: unknown) => agregar(`lte:${c}=${String(v)}`, (f) => f[c] != null && (f[c] as string) <= (v as string));
    b.is = (c: string, v: unknown) => agregar(`is:${c}=${String(v)}`, (f) => (v === null ? f[c] == null : f[c] === v));
    b.or = () => b;   // filtros .or() de la UI (servicios): no relevantes para #67
    b.not = () => b;
    b.order = (c: string, o?: { ascending?: boolean }) => { orden.push({ col: c, asc: o?.ascending !== false }); return b; };
    b.range = (d: number, h: number) => { rango = [d, h]; return b; };
    b.limit = (n: number) => { limite = n; return b; };
    b.insert = (rows: Fila | Fila[]) => { modo = "insert"; payload = Array.isArray(rows) ? rows : [rows]; return b; };
    b.upsert = (rows: Fila | Fila[], o?: { onConflict?: string; ignoreDuplicates?: boolean }) => {
      modo = "upsert"; payload = Array.isArray(rows) ? rows : [rows];
      onConflict = (o?.onConflict ?? "").split(",").map((s) => s.trim()).filter(Boolean);
      ignorarDuplicados = !!o?.ignoreDuplicates;
      return b;
    };
    b.update = (v: Fila) => { modo = "update"; valores = v; return b; };
    b.delete = () => { modo = "delete"; return b; };
    b.maybeSingle = async () => {
      const r = ejecutar();
      if (r.error) return { data: null, error: r.error };
      if (r.data.length > 1) return { data: null, error: { message: `maybeSingle(): ${r.data.length} filas en "${tabla}"` } };
      return { data: r.data[0] ?? null, error: null };
    };
    b.single = async () => {
      const r = ejecutar();
      if (r.error) return { data: null, error: r.error };
      if (r.data.length !== 1) return { data: null, error: { message: "JSON object requested, multiple (or no) rows returned" } };
      return { data: r.data[0], error: null };
    };
    b.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => {
      void devolver;
      const r = ejecutar();
      return Promise.resolve(r.error ? { data: null, error: r.error } : { data: r.data, error: null }).then(res, rej);
    };
    return b;
  }

  async function rpc(nombre: string, args: Record<string, unknown>) {
    bd.rpcs.push({ nombre, args });
    const fn = opciones.rpc?.[nombre];
    if (!fn) return { data: null, error: null };
    return fn(args, bd);
  }

  bd.cliente = {
    from,
    rpc,
    auth: { getUser: async () => ({ data: { user: { id: "00000000-0000-0000-0000-000000000067", email: "t@t.co" } }, error: null }) },
  };
  return bd;
}

export function cuentaEscrituras(bd: BdFalsa, tabla?: string): number {
  return bd.escrituras.filter((e) => !tabla || e.tabla === tabla).length;
}

// ─── Fixture compartido: el caso real que motivó #67 ──────────────────────
// Juan Dolio con vuelos que llegan a Santo Domingo (SDQ) y Punta Cana (PUJ),
// mismo país; más los casos que deben rechazarse. Los IDs son los que autorizan
// (nunca un nombre ni un IATA).
export const D = {
  JUAN_DOLIO: 10,
  SANTO_DOMINGO: 20,
  PUNTA_CANA: 30,
  CARTAGENA: 40,
  SIN_PAIS: 50,
  INACTIVO: 60,
  ALIAS_RD: 70,
  SAMANA: 80, // mismo país, activo, pero NO seleccionado como alternativa
} as const;

export const PAQUETE_ID = 1;

export function destinosFixture(): Fila[] {
  return [
    { id: D.JUAN_DOLIO, nombre: "JUAN DOLIO", codigo_iata: null, pais: "República Dominicana", activo: true },
    // Mismo país escrito distinto (acento, mayúsculas y espacios): se normaliza.
    { id: D.SANTO_DOMINGO, nombre: "SANTO DOMINGO", codigo_iata: "SDQ", pais: "  republica   dominicana ", activo: true },
    { id: D.PUNTA_CANA, nombre: "PUNTA CANA", codigo_iata: "PUJ", pais: "REPÚBLICA DOMINICANA", activo: true },
    { id: D.CARTAGENA, nombre: "CARTAGENA", codigo_iata: "CTG", pais: "Colombia", activo: true },
    { id: D.SIN_PAIS, nombre: "SIN PAIS", codigo_iata: "XXX", pais: null, activo: true },
    { id: D.INACTIVO, nombre: "DESTINO INACTIVO", codigo_iata: "INA", pais: "República Dominicana", activo: false },
    // Alias ambiguo: "RD" NO se equipara a "República Dominicana" (sin heurística).
    { id: D.ALIAS_RD, nombre: "DESTINO ALIAS", codigo_iata: "ALI", pais: "RD", activo: true },
    { id: D.SAMANA, nombre: "SAMANA", codigo_iata: "AZS", pais: "República Dominicana", activo: true },
  ];
}

/** Fuente aérea (bloqueo o empaquetado) con su destino de llegada. */
export function fuente(id: number, destino_id: number | null, extra: Fila = {}): Fila {
  return {
    id, destino_id, record: `R${id}`, ruta: `BOG-D${destino_id ?? "x"}`, aerolinea: "AV",
    fecha_ida: "2026-12-10", fecha_regreso: "2026-12-14", tarifa_para_empaquetar: 1_130_000,
    tarifa_proveedor: 1_000_000, fee_infante: 0, activo: true, compra_inicio: null, compra_fin: null,
    ...extra,
  };
}

/** Bloqueos negociados: varios vuelos por destino. */
export function bloqueosFixture(): Fila[] {
  return [
    fuente(101, D.JUAN_DOLIO), fuente(102, D.JUAN_DOLIO),
    fuente(201, D.SANTO_DOMINGO), fuente(202, D.SANTO_DOMINGO), fuente(203, D.SANTO_DOMINGO),
    fuente(301, D.PUNTA_CANA), fuente(302, D.PUNTA_CANA),
    fuente(401, D.CARTAGENA),
    fuente(501, null),
    fuente(601, D.SIN_PAIS),
    fuente(701, D.INACTIVO),
    fuente(801, D.ALIAS_RD),
    fuente(901, D.SAMANA),
  ];
}

/** Vuelos por Sistema (Empaquetados): mismos casos con ids propios (1xxx). */
export function empaquetadosFixture(): Fila[] {
  return [
    fuente(1101, D.JUAN_DOLIO), fuente(1102, D.JUAN_DOLIO),
    fuente(1201, D.SANTO_DOMINGO), fuente(1202, D.SANTO_DOMINGO),
    fuente(1301, D.PUNTA_CANA), fuente(1302, D.PUNTA_CANA),
    fuente(1401, D.CARTAGENA),
    fuente(1501, null),
    fuente(1601, D.SIN_PAIS),
    fuente(1701, D.INACTIVO),
    fuente(1801, D.ALIAS_RD),
    fuente(1901, D.SAMANA),
  ];
}

export function paqueteFixture(extra: Fila = {}): Fila {
  return {
    id: PAQUETE_ID, nombre: "Juan Dolio 4D/3N", tipo: "bloqueo", noches: 3, activo: true,
    destino_id: D.JUAN_DOLIO, pct_mk: 0.2, impuesto_tipo: "fijo", impuesto_fijo: 100_000,
    fecha_viaje_inicio: "2026-12-01", fecha_viaje_fin: "2026-12-31",
    destinos_aereos_alternativos: false,
    ...extra,
  };
}

export const JOINS_ARMADO: Joins = {
  armado_paquetes: { destinos: { fk: "destino_id", tabla: "destinos" } },
  armado_vuelos: { bloqueos_vuelo: { fk: "bloqueo_id", tabla: "bloqueos_vuelo" } },
  armado_empaquetados: { empaquetados: { fk: "empaquetado_id", tabla: "empaquetados" } },
  armado_hoteles: { hoteles: { fk: "hotel_id", tabla: "hoteles" } },
};

/** Tablas base del caso Juan Dolio. `alternativas` son los destinos elegidos en el check. */
export function tablasBase(o: {
  alternativas?: number[]; check?: boolean; vuelosLigados?: number[]; empaquetadosLigados?: number[]; paquete?: Fila;
} = {}): Tablas {
  return {
    destinos: destinosFixture(),
    armado_paquetes: [paqueteFixture({ destinos_aereos_alternativos: !!o.check, ...(o.paquete ?? {}) })],
    armado_paquete_destinos_aereos: (o.alternativas ?? []).map((d) => ({ paquete_id: PAQUETE_ID, destino_id: d })),
    bloqueos_vuelo: bloqueosFixture(),
    empaquetados: empaquetadosFixture(),
    // 224: computarReserva valida la vigencia del Empaquetado por la VISTA sin costos (mismas filas que la tabla base).
    empaquetados_basica: empaquetadosFixture(),
    armado_vuelos: (o.vuelosLigados ?? []).map((b) => ({ paquete_id: PAQUETE_ID, bloqueo_id: b, aplica_mk: true, ta: 0 })),
    armado_empaquetados: (o.empaquetadosLigados ?? []).map((e) => ({ paquete_id: PAQUETE_ID, empaquetado_id: e, aplica_mk: true, ta: 0 })),
  };
}

// Vectores de normalización de país: los usa la prueba pura (TS) y la de paridad con la función SQL pais_comparable_67.
export const VECTORES_PAIS: [string | null, string | null][] = [
  ["Colombia", "colombia"],
  ["  colombia  ", "colombia"],
  ["COLOMBIA", "colombia"],
  ["República Dominicana", "republica dominicana"],
  ["REPÚBLICA DOMINICANA", "republica dominicana"],
  ["  republica   dominicana ", "republica dominicana"],
  ["República\tDominicana", "republica dominicana"],
  ["Perú", "peru"],
  ["MÉXICO", "mexico"],
  ["España", "espana"],
  ["Curaçao", "curacao"],
  ["", null],
  ["   ", null],
  [null, null],
  ["RD", "rd"], // alias: NO equivale a "república dominicana"
];
