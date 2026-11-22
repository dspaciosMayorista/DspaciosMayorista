// Supabase en memoria para «Mis clientes» (#76/#77): select con conteo exacto, eq/in/is, rutas JSON (`payload->a->>b`), order, range, insert, update.
// Hace cumplir lo que la base hace cumplir: UNIQUE (aliado_id, clave) → 23505, y registra cada llamada para medir fan-out.
export type Fila = Record<string, any>;

export function crearBaseFalsa(tablas: Record<string, Fila[]>, opts: { maxFilas?: number; fallar?: (tabla: string) => boolean } = {}) {
  const llamadas: { tabla: string; op: string }[] = [];
  let seq = 1000;
  const valor = (f: Fila, col: string): unknown => {
    if (!col.includes("->")) return f[col];
    const [raiz, ...ruta] = col.split(/->>?|->/);
    let v: any = f[raiz];
    for (const k of ruta) v = v == null ? undefined : v[k];
    return v;
  };
  const from = (tabla: string) => {
    const filtros: ((f: Fila) => boolean)[] = [];
    let op = "select", conteo = false, orden: string | null = null, rango: [number, number] | null = null, parche: Fila | null = null, nuevo: Fila | null = null, unica = false;
    const ejecutar = (): { data: any; error: any; count?: number | null } => {
      llamadas.push({ tabla, op });
      if (opts.fallar?.(tabla)) return { data: null, error: { message: "falla simulada" }, count: null };
      const fs = tablas[tabla] ?? (tablas[tabla] = []);
      if (op === "insert" && nuevo) {
        if (tabla === "aliado_clientes" && fs.some((x) => x.aliado_id === nuevo!.aliado_id && x.clave === nuevo!.clave)) return { data: null, error: { code: "23505", message: "duplicate key" } };
        const fila = { id: ++seq, ...nuevo }; fs.push(fila);
        return { data: unica ? { id: fila.id } : [{ id: fila.id }], error: null };
      }
      let sel = fs.filter((f) => filtros.every((x) => x(f)));
      if (op === "update" && parche) {
        if (tabla === "aliado_clientes" && parche.clave) {
          for (const f of sel) if (fs.some((x) => x !== f && x.aliado_id === f.aliado_id && x.clave === parche!.clave)) return { data: null, error: { code: "23505", message: "duplicate key" } };
        }
        for (const f of sel) Object.assign(f, parche);
        return { data: sel.map((f) => ({ id: f.id })), error: null };
      }
      if (orden) sel = [...sel].sort((a, b) => (a[orden!] > b[orden!] ? 1 : a[orden!] < b[orden!] ? -1 : 0));
      const total = sel.length;
      if (rango) sel = sel.slice(rango[0], rango[1] + 1);
      if (opts.maxFilas) sel = sel.slice(0, opts.maxFilas);
      return { data: sel, error: null, count: conteo ? total : null };
    };
    const b: any = {
      select: (_c?: string, o?: { count?: string }) => { if (op === "select" || op === "insert" || op === "update") { if (o?.count) conteo = true; } return b; },
      insert: (f: Fila) => { op = "insert"; nuevo = f; return b; },
      update: (f: Fila) => { op = "update"; parche = f; return b; },
      single: () => { unica = true; return Promise.resolve(ejecutar()); },
      eq: (c: string, v: unknown) => { filtros.push((f) => valor(f, c) === v || (valor(f, c) != null && String(valor(f, c)) === String(v) && typeof v === "string")); return b; },
      in: (c: string, vs: unknown[]) => { filtros.push((f) => vs.includes(valor(f, c))); return b; },
      not: (c: string, _o: string, v: unknown) => { filtros.push((f) => valor(f, c) !== v); return b; },
      order: (c: string) => { orden = c; return b; },
      range: (d: number, h: number) => { rango = [d, h]; return b; },
      limit: () => b,
      then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve(ejecutar()).then(ok, ko),
    };
    return b;
  };
  return { from, tablas, llamadas };
}
