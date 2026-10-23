// Supabase/PostgREST EN MEMORIA para pruebas de autorización que corren con
// service-role (portal B2B, documentos por URL). Implementa solo lo que usan
// esos caminos — select (con `count: "exact"`), eq, in, is, not(is null), gt,
// order, limit, range, maybeSingle, single — más dos cosas que un fake ingenuo
// no tiene y que aquí son el punto:
//   · `maxFilas`: el límite de filas por respuesta del proyecto (Settings →
//     API → Max rows). Recorta cualquier respuesta, pida lo que pida.
//   · `fallar`: inyección de fallos por tabla y página (error, sin conteo,
//     página vacía, conteo cambiante, fila ajena, excepción).
// Sin sintaxis exclusiva de TypeScript que no se pueda borrar (corre también
// con --experimental-strip-types).

export type Fila = Record<string, unknown>;
export type Fallo = "error" | "sin_conteo" | "vacia" | "conteo_cambia" | "fila_ajena" | "lanzar";
export type ContextoFallo = { tabla: string; desde: number | null; conteo: boolean; llamada: number };
export type OpcionesMemoria = {
  maxFilas?: number;
  fallar?: (c: ContextoFallo) => Fallo | null;
};

// ILIKE de Postgres: `%` = cualquier cadena, `_` = un carácter, `\` escapa el
// siguiente; PostgREST además acepta `*` como `%`. Sin distinguir mayúsculas.
export function likeARegex(patron: string): RegExp {
  let re = "";
  for (let i = 0; i < patron.length; i++) {
    const ch = patron[i];
    if (ch === "\\" && i + 1 < patron.length) { re += patron[++i].replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); continue; }
    if (ch === "%" || ch === "*") { re += "[\\s\\S]*"; continue; }
    if (ch === "_") { re += "[\\s\\S]"; continue; }
    re += ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`, "i");
}

export function supabaseEnMemoria(
  tablas: Record<string, Fila[]>,
  opts: OpcionesMemoria = {},
  sesionId: string | null = null
) {
  const llamadas: Record<string, number> = {};
  const from = (tabla: string) => {
    const filtros: ((f: Fila) => boolean)[] = [];
    let conteo = false;
    let orden: { col: string; asc: boolean } | null = null;
    let limite: number | null = null;
    let rango: [number, number] | null = null;

    const resolver = () => {
      llamadas[tabla] = (llamadas[tabla] ?? 0) + 1;
      const fallo = opts.fallar?.({ tabla, desde: rango ? rango[0] : null, conteo, llamada: llamadas[tabla] }) ?? null;
      if (fallo === "lanzar") throw new Error("fallo de red simulado");
      if (fallo === "error") return { data: null, error: { message: "error simulado" }, count: null };

      let filas = (tablas[tabla] ?? []).filter((f) => filtros.every((p) => p(f)));
      if (orden) {
        const { col, asc } = orden;
        filas = [...filas].sort((a, b) => {
          const x = a[col] as number | string, y = b[col] as number | string;
          return (x < y ? -1 : x > y ? 1 : 0) * (asc ? 1 : -1);
        });
      }
      const total = filas.length;
      if (rango) filas = filas.slice(rango[0], rango[1] + 1);
      if (limite != null) filas = filas.slice(0, limite);
      if (opts.maxFilas != null) filas = filas.slice(0, opts.maxFilas);

      let count: number | null = conteo ? total : null;
      if (fallo === "sin_conteo") count = null;
      if (fallo === "vacia") filas = [];
      if (fallo === "conteo_cambia" && count != null) count += 1;
      if (fallo === "fila_ajena") filas = [...filas, { numero_contrato: "AJENO-999", id: -1 }];
      return { data: filas, error: null, count };
    };

    const api = {
      select: (_c?: string, o?: { count?: string }) => { conteo = o?.count === "exact"; return api; },
      eq: (c: string, v: unknown) => { filtros.push((f) => f[c] === v); return api; },
      ilike: (c: string, patron: string) => {
        const re = likeARegex(patron);
        filtros.push((f) => typeof f[c] === "string" && re.test(f[c] as string));
        return api;
      },
      in: (c: string, vs: unknown[]) => { const s = new Set(vs); filtros.push((f) => s.has(f[c])); return api; },
      is: (c: string, v: unknown) => { filtros.push((f) => (f[c] ?? null) === v); return api; },
      not: (c: string, op: string, v: unknown) => {
        if (op !== "is") throw new Error(`not(${op}) no soportado`);
        filtros.push((f) => (f[c] ?? null) !== v);
        return api;
      },
      gt: (c: string, v: number) => { filtros.push((f) => Number(f[c]) > v); return api; },
      order: (c: string, o?: { ascending?: boolean }) => { orden = { col: c, asc: o?.ascending !== false }; return api; },
      limit: (n: number) => { limite = n; return api; },
      range: (a: number, b: number) => { rango = [a, b]; return api; },
      maybeSingle: async () => {
        const r = resolver();
        return { data: r.data?.[0] ?? null, error: r.error };
      },
      single: async () => {
        const r = resolver();
        return { data: r.data?.[0] ?? null, error: r.error ?? (r.data?.[0] ? null : { message: "no rows" }) };
      },
      then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => {
        try { return Promise.resolve(resolver()).then(ok, ko); } catch (e) { return Promise.reject(e).then(ok, ko); }
      },
    };
    return api;
  };
  return {
    from,
    llamadas,
    auth: { getUser: async () => ({ data: { user: sesionId ? { id: sesionId, email: `${sesionId}@t` } : null } }) },
  };
}
