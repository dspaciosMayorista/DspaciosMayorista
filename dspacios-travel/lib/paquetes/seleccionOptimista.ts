// Cola de guardado OPTIMISTA de las selecciones del armado de paquetes (vuelos, hoteles, empaquetados, servicios): casillas individuales y «todos».
//
// Contrato:
//  · Al hacer clic la casilla y los contadores cambian EN ESE INSTANTE (la capa visual lee `efectivos`, que superpone lo pendiente a lo que trajo el servidor).
//  · Cada fila muestra «Guardando» mientras el servidor confirma (`estadoFila`).
//  · Las operaciones de un mismo tipo se envían EN ORDEN (una a la vez): el último clic es siempre el último en el servidor, así que una respuesta antigua
//    nunca puede deshacer un clic más reciente. Un clic repetido sobre la misma fila que aún no salió REEMPLAZA a la operación en cola (no se acumulan).
//  · Si una operación falla, la fila vuelve al ÚLTIMO valor confirmado (o al del servidor si nunca hubo uno) y queda su error, que se descarta a conciencia.
//    Si ya hay un clic más nuevo sobre esa fila, el fallo viejo no la toca: manda el nuevo.
//  · Un valor confirmado se conserva (la pantalla sigue mostrándolo sin recargar) hasta que un refresco del servidor INICIADO DESPUÉS de esa confirmación termina
//    (`reconciliar`): a partir de ahí manda el servidor. Un refresco iniciado antes no puede pisar un guardado más reciente.
// Sin React ni servidor: se prueba con promesas controladas (pruebas/seleccionOptimista.test.ts).

export type TipoSeleccion = "vuelo" | "hotel" | "empaquetado" | "servicio";
/** `null` = deseleccionado. Un objeto = seleccionado, con los campos de configuración que se cambiaron (se superponen a la fila del servidor). */
export type ValorSeleccion = Record<string, unknown> | null;
export type ResultadoOperacion =
  | { ok: true; omitidos?: { id: number; motivo: string }[] }
  | { ok: false; error: string };

export type Operacion = {
  tipo: TipoSeleccion;
  items: { id: number; valor: ValorSeleccion }[];
  ejecutar: () => Promise<ResultadoOperacion>;
  /** Una operación de una sola fila que aún no salió se reemplaza por el clic siguiente sobre la misma fila. */
  coalescible?: boolean;
  /** Texto del error si la operación es un lote y falla (se muestra sobre el listado, no solo en las filas). */
  esLote?: boolean;
};

export type EntradaSeleccion = {
  valor: ValorSeleccion;
  estado: "guardando" | "confirmado";
  /** Último valor CONFIRMADO por el servidor para esta fila durante esta sesión (undefined = ninguno: se revierte a lo que traiga el servidor). */
  base?: { v: ValorSeleccion };
  /** Contador de la última modificación (para `reconciliar`). */
  req: number;
};

export type InstantaneaSeleccion = {
  entradas: ReadonlyMap<string, EntradaSeleccion>;
  errores: ReadonlyMap<string, string>;
  erroresLote: ReadonlyMap<TipoSeleccion, string>;
  /** Filas con guardado en curso o en cola. */
  pendientes: number;
  /** Errores sin descartar (filas + lotes). */
  fallidos: number;
};

const clave = (tipo: TipoSeleccion, id: number) => `${tipo}:${id}`;
const MENSAJE_CAIDA = "No fue posible guardar el cambio. Revisa tu conexión e inténtalo de nuevo.";

export class ColaSeleccion {
  private entradas = new Map<string, EntradaSeleccion>();
  private errores = new Map<string, string>();
  private erroresLote = new Map<TipoSeleccion, string>();
  private colas = new Map<TipoSeleccion, Operacion[]>();
  private corriendo = new Set<TipoSeleccion>();
  private contador = 0;
  private foto: InstantaneaSeleccion;
  private oyentes = new Set<() => void>();
  private readonly alQuedarInactiva?: (huboCambios: boolean) => void;
  private huboCambios = false;

  constructor(opciones: { alQuedarInactiva?: (huboCambios: boolean) => void } = {}) {
    this.alQuedarInactiva = opciones.alQuedarInactiva;
    this.foto = this.armarFoto();
  }

  // ── Suscripción (useSyncExternalStore) ───────────────────────────────────────────────────────────────────────
  suscribir = (fn: () => void): (() => void) => { this.oyentes.add(fn); return () => { this.oyentes.delete(fn); }; };
  instantanea = (): InstantaneaSeleccion => this.foto;

  /** Contador de modificaciones: un refresco que arranca ahora refleja todo lo confirmado hasta este valor. */
  get req(): number { return this.contador; }
  get inactiva(): boolean { return this.pendientes() === 0; }

  private pendientes(): number {
    let n = 0;
    for (const e of this.entradas.values()) if (e.estado === "guardando") n++;
    return n;
  }
  private armarFoto(): InstantaneaSeleccion {
    return {
      entradas: new Map(this.entradas), errores: new Map(this.errores), erroresLote: new Map(this.erroresLote),
      pendientes: this.pendientes(), fallidos: this.errores.size + this.erroresLote.size,
    };
  }
  private cambiar() { this.foto = this.armarFoto(); for (const f of [...this.oyentes]) f(); }

  // ── Operaciones ─────────────────────────────────────────────────────────────────────────────────────────────
  solicitar(op: Operacion): void {
    const req = ++this.contador;
    for (const it of op.items) {
      const k = clave(op.tipo, it.id);
      const previa = this.entradas.get(k);
      // «base» = último valor confirmado: si la entrada previa estaba confirmada ese es su valor; si seguía guardando se conserva su base.
      const base = previa ? (previa.estado === "confirmado" ? { v: previa.valor } : previa.base) : undefined;
      this.entradas.set(k, { valor: it.valor, estado: "guardando", base, req });
      this.errores.delete(k);
    }
    if (op.esLote) this.erroresLote.delete(op.tipo);
    const cola = this.colas.get(op.tipo) ?? [];
    if (op.coalescible && op.items.length === 1) {
      const id = op.items[0].id;
      const i = cola.findIndex((q) => q.coalescible && q.items.length === 1 && q.items[0].id === id);
      if (i >= 0) cola.splice(i, 1); // el clic nuevo reemplaza al que aún no salió
    }
    cola.push(op);
    this.colas.set(op.tipo, cola);
    this.cambiar();
    if (!this.corriendo.has(op.tipo)) void this.procesar(op.tipo);
  }

  private hayMasNuevo(tipo: TipoSeleccion, id: number): boolean {
    return (this.colas.get(tipo) ?? []).some((q) => q.items.some((i) => i.id === id));
  }

  private async procesar(tipo: TipoSeleccion): Promise<void> {
    this.corriendo.add(tipo);
    const cola = this.colas.get(tipo) ?? [];
    while (cola.length) {
      const op = cola.shift() as Operacion;
      let r: ResultadoOperacion;
      try { r = await op.ejecutar(); } catch { r = { ok: false, error: MENSAJE_CAIDA }; }
      const omitidos = new Map((r.ok ? r.omitidos ?? [] : []).map((o) => [o.id, o.motivo]));
      for (const it of op.items) {
        const k = clave(tipo, it.id);
        const e = this.entradas.get(k);
        if (!e) continue;
        const nuevo = this.hayMasNuevo(tipo, it.id); // hay un clic posterior ya en cola: este resultado no decide el valor visible
        const fallo = !r.ok || omitidos.has(it.id);
        if (!fallo) {
          this.huboCambios = true;
          if (nuevo) this.entradas.set(k, { ...e, base: { v: it.valor } });
          else this.entradas.set(k, { ...e, estado: "confirmado", base: undefined });
        } else if (nuevo) {
          // el fallo viejo no toca la fila: manda el clic nuevo (si ese también falla, vuelve a la base ya conocida)
        } else {
          const motivo = !r.ok ? r.error : (omitidos.get(it.id) as string);
          if (e.base) this.entradas.set(k, { valor: e.base.v, estado: "confirmado", req: e.req });
          else this.entradas.delete(k);
          // Un lote que falla entero se explica UNA vez (erroresLote); solo lo omitido/individual lleva su error en la fila.
          if (!(op.esLote && !r.ok)) this.errores.set(k, motivo);
        }
      }
      if (!r.ok && op.esLote) this.erroresLote.set(tipo, r.error);
      this.cambiar();
    }
    this.corriendo.delete(tipo);
    if (this.inactiva) {
      const hubo = this.huboCambios;
      this.huboCambios = false;
      this.alQuedarInactiva?.(hubo);
    }
  }

  // ── Errores ─────────────────────────────────────────────────────────────────────────────────────────────────
  descartarError(tipo: TipoSeleccion, id: number): void {
    if (this.errores.delete(clave(tipo, id))) this.cambiar();
  }
  descartarErrorLote(tipo: TipoSeleccion): void {
    if (this.erroresLote.delete(tipo)) this.cambiar();
  }

  // ── Reconciliación con el servidor ──────────────────────────────────────────────────────────────────────────
  /** Un refresco iniciado cuando `req` valía `reqAlIniciar` terminó: lo CONFIRMADO hasta entonces ya viene en los datos del servidor. */
  reconciliar(reqAlIniciar: number): void {
    let cambio = false;
    for (const [k, e] of [...this.entradas]) {
      if (e.estado === "confirmado" && e.req <= reqAlIniciar) { this.entradas.delete(k); cambio = true; }
    }
    if (cambio) this.cambiar();
  }
}

// ── Lectura combinada servidor + pendiente ───────────────────────────────────────────────────────────────────────

/** Filas seleccionadas EFECTIVAS: las del servidor con lo pendiente/confirmado-local encima. `porDefecto` fabrica la fila de algo marcado que el servidor aún no tiene. */
export function efectivos<S extends Record<string, unknown>>(
  foto: InstantaneaSeleccion, tipo: TipoSeleccion, filasServidor: readonly S[], campoId: keyof S & string, porDefecto: (id: number) => S,
): Map<number, S> {
  const mapa = new Map<number, S>(filasServidor.map((f) => [f[campoId] as number, f]));
  const prefijo = `${tipo}:`;
  for (const [k, e] of foto.entradas) {
    if (!k.startsWith(prefijo)) continue;
    const id = Number(k.slice(prefijo.length));
    if (e.valor === null) mapa.delete(id);
    else mapa.set(id, { ...(mapa.get(id) ?? porDefecto(id)), ...e.valor });
  }
  return mapa;
}

export type EstadoFila = { guardando: boolean; error: string | null };
export function estadoFila(foto: InstantaneaSeleccion, tipo: TipoSeleccion, id: number): EstadoFila {
  const k = clave(tipo, id);
  return { guardando: foto.entradas.get(k)?.estado === "guardando", error: foto.errores.get(k) ?? null };
}

/** «Generar tarifario» solo se habilita sin guardados en curso ni errores sin atender. */
export function bloqueoGenerar(foto: InstantaneaSeleccion): string | null {
  if (foto.pendientes > 0) return `Guardando ${foto.pendientes} cambio${foto.pendientes === 1 ? "" : "s"}…`;
  if (foto.fallidos > 0) return "Hay cambios que no se guardaron: revisa los errores en Vuelos, Hoteles o Servicios.";
  return null;
}
