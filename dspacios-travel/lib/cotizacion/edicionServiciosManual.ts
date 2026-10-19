// ─────────────────────────────────────────────────────────────────────────
// Edición de servicios / niños y recobro de una cotización dinámica — #39 fase 1.
//
// Reglas PURAS (sin I/O) que comparten la ficha (qué editor mostrar) y las
// acciones de servidor (mensaje claro ANTES de llamar a la base). La frontera
// real es la base: `p39_priv.bloquear_para_editar` (migración 216) vuelve a
// comprobar TODO con la fila bloqueada, en este mismo orden.
//
// Elegible (C1): manual simple (no madre ni hija de la 211), abierta, sin
// contrato, sin congelar, sin ningún pago previo (aunque esté anulado), vigente
// y con la edición habilitada (frontera de la 217 activa y sin suspensión).
// Autor (C2): `venta` solo edita lo que creó (`creado_por_id`); las manuales
// antiguas sin autor quedan para los roles de contrato completo. La vigencia se
// renueva como hoy, aparte (decisión A del dueño): renovar no habilita editar.
// ─────────────────────────────────────────────────────────────────────────
import type { FilaServicioManual } from "./liquidacionManual.ts";

export const ROLES_EDICION_COMPLETA = ["superadmin", "gerencia", "administracion", "operaciones"] as const;

export type CodigoEdicion39 =
  | "NO_AUTORIZADO" | "SUSPENDIDA" | "NO_ELEGIBLE" | "CONGELADA" | "CON_PAGOS"
  | "VENCIDA" | "AUTOR" | "MOTIVO" | "REVISION" | "SERVICIOS" | "INCOHERENTE";

/** Lo que la ficha sabe de la cotización. */
export type CotizacionEditable = {
  tipo: string | null;
  modo: string | null;
  estado: string | null;
  numero_contrato: string | null;
  cotizacion_origen_id: number | null;
  condicion_pago_congelada_en: string | null;
  vigencia_hasta: string | null;
  creado_por_id: string | null;
};

export type ActorEdicion = { id: string | null; rol: string | null; activo: boolean };

export type Elegibilidad = { ok: true } | { ok: false; codigo: CodigoEdicion39; mensaje: string };

const MENSAJES: Record<CodigoEdicion39, string> = {
  NO_AUTORIZADO: "No tienes permiso para editar esta cotización.",
  SUSPENDIDA: "La edición de cotizaciones no está habilitada en este momento.",
  NO_ELEGIBLE: "Solo se editan cotizaciones dinámicas simples y abiertas (no comparativas, opciones elegidas ni convertidas).",
  CONGELADA: "La cotización ya tiene condiciones congeladas por un pago.",
  CON_PAGOS: "La cotización tuvo pagos previos (aunque estén anulados); no se edita.",
  VENCIDA: "La cotización está vencida: renueva su vigencia antes de editarla.",
  AUTOR: "Solo puedes editar las cotizaciones que tú creaste.",
  MOTIVO: "Indica el motivo del cambio.",
  REVISION: "La cotización cambió mientras la editabas: recarga la página y vuelve a intentarlo.",
  SERVICIOS: "La cotización debe tener al menos un servicio válido.",
  INCOHERENTE: "Los valores no cuadran con los servicios de la cotización: recarga la página.",
};

function no(codigo: CodigoEdicion39): Elegibilidad {
  return { ok: false, codigo, mensaje: MENSAJES[codigo] };
}

/**
 * ¿Se puede editar? Mismo orden que la base (sin la revisión, que se compara al
 * guardar). `tienePagos` = hay alguna fila de pago previo en cualquier estado; si
 * el rol no puede leer los pagos, basta con el congelado (el primer pago siempre
 * congela) — la base lo vuelve a comprobar.
 */
export function elegibilidadEdicion(
  c: CotizacionEditable,
  ctx: { actor: ActorEdicion; habilitada: boolean; hoy: string; tienePagos: boolean },
): Elegibilidad {
  const rol = ctx.actor.rol ?? "";
  if (!ctx.actor.activo || !ctx.actor.id || !(ROLES_EDICION_COMPLETA as readonly string[]).concat("venta").includes(rol)) {
    return no("NO_AUTORIZADO");
  }
  if (!ctx.habilitada) return no("SUSPENDIDA");
  if (c.tipo !== "manual" || (c.modo ?? "simple") !== "simple" || c.cotizacion_origen_id != null) return no("NO_ELEGIBLE");
  if (c.estado !== "abierta" || c.numero_contrato) return no("NO_ELEGIBLE");
  if (c.condicion_pago_congelada_en) return no("CONGELADA");
  if (ctx.tienePagos) return no("CON_PAGOS");
  if (!c.vigencia_hasta || c.vigencia_hasta < ctx.hoy) return no("VENCIDA");
  if (rol === "venta" && (!c.creado_por_id || c.creado_por_id !== ctx.actor.id)) return no("AUTOR");
  return { ok: true };
}

/** Motivo obligatorio (C3): recortado, 1..500 caracteres. */
export function validarMotivo(motivo: unknown): { ok: true; motivo: string } | { ok: false; error: string } {
  const m = typeof motivo === "string" ? motivo.trim() : "";
  if (!m) return { ok: false, error: MENSAJES.MOTIVO };
  if (m.length > 500) return { ok: false, error: "El motivo no puede pasar de 500 caracteres." };
  return { ok: true, motivo: m };
}

/** Revisión esperada: entero positivo que la ficha leyó. */
export function validarRevision(rev: unknown): number | null {
  const n = Number(rev);
  return Number.isInteger(n) && n >= 1 ? n : null;
}

// ── Diff de servicios (para la vista previa del editor y el historial) ────
export type ServicioComparable = Pick<FilaServicioManual,
  "tipo_servicio" | "plataforma" | "nombre_servicio" | "proveedor" | "costo_neto" | "modo" | "pct_markup" | "ta" | "valor">;

export type DiffServicios = {
  agregados: ServicioComparable[];
  quitados: ServicioComparable[];
  modificados: { antes: ServicioComparable; despues: ServicioComparable; campos: string[] }[];
  sinCambios: number;
};

const CAMPOS: (keyof ServicioComparable)[] = ["tipo_servicio", "plataforma", "nombre_servicio", "proveedor", "costo_neto", "modo", "pct_markup", "ta", "valor"];

function igual(a: unknown, b: unknown): boolean {
  if (typeof a === "number" || typeof b === "number") return Math.abs((Number(a) || 0) - (Number(b) || 0)) < 1e-9;
  return (a ?? null) === (b ?? null);
}

/**
 * Compara por POSICIÓN (el orden de la lista es el del documento): la fila i
 * de antes contra la fila i de después; lo que sobra a un lado es quitado o
 * agregado. Es una vista para personas, no una identidad estable.
 */
export function diffServicios(antes: ServicioComparable[], despues: ServicioComparable[]): DiffServicios {
  const out: DiffServicios = { agregados: [], quitados: [], modificados: [], sinCambios: 0 };
  const n = Math.max(antes.length, despues.length);
  for (let i = 0; i < n; i++) {
    const a = antes[i];
    const d = despues[i];
    if (a && !d) out.quitados.push(a);
    else if (!a && d) out.agregados.push(d);
    else if (a && d) {
      const campos = CAMPOS.filter((k) => !igual(a[k], d[k]));
      if (campos.length) out.modificados.push({ antes: a, despues: d, campos });
      else out.sinCambios++;
    }
  }
  return out;
}

export function hayCambios(d: DiffServicios): boolean {
  return d.agregados.length + d.quitados.length + d.modificados.length > 0;
}

/** Entrada del historial con la misma forma que guarda la base (`antes`/`despues`). */
export function entradaHistorialServicios(args: {
  precioAntes: number | null; precioDespues: number;
  serviciosAntes: ServicioComparable[]; serviciosDespues: ServicioComparable[];
}): { antes: { precio_venta: number | null; servicios: ServicioComparable[] }; despues: { precio_venta: number; servicios: ServicioComparable[] } } {
  return {
    antes: { precio_venta: args.precioAntes, servicios: args.serviciosAntes },
    despues: { precio_venta: args.precioDespues, servicios: args.serviciosDespues },
  };
}

// ── Errores de la base → mensaje para el navegador ─────────────────────────
const PREFIJOS = ["EDICION_39_", "PAGO_39_", "FRONTERA_39"];

/** Código `EDICION_39_<X>` de un error de la base, si lo trae. */
export function codigoEdicion39(raw: string | null | undefined): CodigoEdicion39 | null {
  const m = String(raw ?? "").match(/EDICION_39_([A-Z_]+):/);
  if (!m) return null;
  return (m[1] in MENSAJES ? m[1] : null) as CodigoEdicion39 | null;
}

/**
 * Mensaje seguro: los errores propios (#39) pasan con su texto en español; los
 * crudos de PostgreSQL se enmascaran.
 */
export function mensajeEdicion39(raw: string | null | undefined, porDefecto = "No se pudo guardar el cambio. Inténtalo de nuevo."): string {
  const s = String(raw ?? "").trim();
  if (!s) return porDefecto;
  const codigo = codigoEdicion39(s);
  if (codigo) return MENSAJES[codigo];
  for (const p of PREFIJOS) {
    const i = s.indexOf(p);
    if (i >= 0) {
      const tras = s.slice(i).replace(/^[A-Z0-9_]+:\s*/, "");
      if (p === "FRONTERA_39") return "Ese cambio solo se hace con la operación autorizada de la cotización.";
      return tras || porDefecto;
    }
  }
  if (/(duplicate key|violates|constraint "|relation "|pg_|sqlstate|permission denied|new row)/i.test(s)) return porDefecto;
  return s;
}
