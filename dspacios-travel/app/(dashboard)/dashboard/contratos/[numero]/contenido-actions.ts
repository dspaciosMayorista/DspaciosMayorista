"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

// ─────────────────────────────────────────────────────────────────────────
// Edición del CONTENIDO de un contrato — SOLO SUPERADMIN
//
// Los contratos que entraron por el importador de histórico (minorista) solo
// traen la cabecera (`ventas`), los abonos y las cuentas por pagar: no tienen
// ítems de valores, ni hoteles, ni vuelos, ni servicios, porque la hoja de
// cálculo no los traía. Hasta ahora no había ninguna forma de completarlos, así
// que esos contratos no podían generar un documento decente ni corregirse.
//
// Esto permite armar/corregir esas cuatro tablas a mano. Es deliberadamente
// exclusivo de superadmin: reescribe el contenido de un contrato ya cerrado,
// que es justo lo que el resto de roles NO debería poder hacer.
//
// ⚠️ NO toca `ventas.precio_venta`. El total del documento sale de la suma de
// los ítems, pero el precio de venta alimenta cartera, rentabilidad y
// comisiones — moverlo en silencio al editar ítems desalinearía la plata ya
// registrada. La UI muestra ambos y avisa si no cuadran; sincronizarlos es una
// decisión explícita (`sincronizarPrecioVenta`).
// ─────────────────────────────────────────────────────────────────────────

type Result = { ok: true } | { ok: false; error: string };

async function soloSuperadmin(): Promise<{ ok: true; sb: Awaited<ReturnType<typeof createClient>> } | { ok: false; error: string }> {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return { ok: false, error: "Sesión no válida." };
  const { data: perfil } = await sb.from("usuarios").select("rol, activo").eq("id", user.id).maybeSingle();
  if (!perfil?.activo) return { ok: false, error: "Tu cuenta está desactivada." };
  if (perfil.rol !== "superadmin") return { ok: false, error: "Solo un superadmin puede editar el contenido de un contrato." };
  return { ok: true, sb };
}

const oNull = (s: string | null | undefined) => (s && s.trim() !== "" ? s.trim() : null);
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : 0; };

// Reemplaza el contenido de una tabla hija SIN arriesgar los datos actuales:
// primero inserta lo nuevo y solo si eso sale bien borra lo viejo. Si el insert
// falla, las filas originales siguen ahí (en el peor caso quedan duplicadas, y
// eso se ve y se corrige; perderlas no se podría deshacer).
async function reemplazarFilas(
  sb: Awaited<ReturnType<typeof createClient>>,
  tabla: "contrato_items" | "contrato_hoteles" | "contrato_vuelos" | "contrato_servicios",
  numero: string,
  filas: Record<string, unknown>[]
): Promise<Result> {
  const { data: previas, error: le } = await sb.from(tabla).select("id").eq("numero_contrato", numero);
  if (le) return { ok: false, error: le.message };
  const idsViejos = (previas ?? []).map((r) => r.id as number);

  if (filas.length) {
    // El nombre de la tabla es dinámico, así que el cliente tipado no puede
    // estrechar la forma de la fila a una sola tabla. La forma sí queda
    // garantizada en cada `guardar*` de abajo, que arma las columnas
    // explícitamente a partir de un tipo propio.
    const { error: ie } = await sb.from(tabla).insert(filas as never);
    if (ie) return { ok: false, error: ie.message };
  }
  if (idsViejos.length) {
    const { error: de } = await sb.from(tabla).delete().in("id", idsViejos);
    if (de) return { ok: false, error: `Se guardaron las filas nuevas pero no se pudieron borrar las anteriores: ${de.message}` };
  }
  return { ok: true };
}

// ── Ítems de valores (lo que ve el cliente en el documento) ───────────────
export type ItemContenido = {
  descripcion: string; adultos: number; ninos: number; tarifaAdulto: number; tarifaNino: number;
};

export async function guardarItemsContrato(numero: string, items: ItemContenido[]): Promise<Result> {
  const guard = await soloSuperadmin();
  if (!guard.ok) return guard;
  const filas = items
    .filter((it) => it.descripcion.trim())
    .map((it, i) => ({
      numero_contrato: numero,
      descripcion: it.descripcion.trim(),
      adultos: Math.trunc(num(it.adultos)),
      ninos: Math.trunc(num(it.ninos)),
      tarifa_adulto: num(it.tarifaAdulto),
      tarifa_nino: num(it.tarifaNino),
      orden: i,
    }));
  const r = await reemplazarFilas(guard.sb, "contrato_items", numero, filas);
  if (!r.ok) return r;
  revalidatePath(`/dashboard/contratos/${numero}`);
  return { ok: true };
}

// ── Hoteles ───────────────────────────────────────────────────────────────
export type HotelContenido = {
  nombre: string; categoria: string; proveedor: string; ciudad: string;
  alimentacion: string; acomodacion: string; detalleAcomodacion: string;
  fechaIngreso: string; fechaSalida: string;
};

export async function guardarHotelesContrato(numero: string, hoteles: HotelContenido[]): Promise<Result> {
  const guard = await soloSuperadmin();
  if (!guard.ok) return guard;
  const filas = hoteles
    .filter((h) => h.nombre.trim())
    .map((h, i) => ({
      numero_contrato: numero,
      nombre: h.nombre.trim(),
      categoria: oNull(h.categoria),
      proveedor: oNull(h.proveedor),
      ciudad: oNull(h.ciudad),
      alimentacion: oNull(h.alimentacion),
      acomodacion: oNull(h.acomodacion),
      detalle_acomodacion: oNull(h.detalleAcomodacion),
      fecha_ingreso: oNull(h.fechaIngreso),
      fecha_salida: oNull(h.fechaSalida),
      orden: i,
    }));
  const r = await reemplazarFilas(guard.sb, "contrato_hoteles", numero, filas);
  if (!r.ok) return r;
  revalidatePath(`/dashboard/contratos/${numero}`);
  return { ok: true };
}

// ── Vuelos (1 fila = 1 tramo, migración 135) ──────────────────────────────
export type VueloContenido = {
  aerolinea: string; record: string; direccion: string;
  origenCodigo: string; destinoCodigo: string; numeroVuelo: string;
  fecha: string; horaSalida: string; horaLlegada: string; servicios: string;
};

export async function guardarVuelosContrato(numero: string, vuelos: VueloContenido[]): Promise<Result> {
  const guard = await soloSuperadmin();
  if (!guard.ok) return guard;
  const filas = vuelos
    .filter((v) => v.aerolinea.trim() || v.numeroVuelo.trim())
    .map((v, i) => ({
      numero_contrato: numero,
      aerolinea: oNull(v.aerolinea),
      record: oNull(v.record),
      direccion: oNull(v.direccion),
      origen_codigo: oNull(v.origenCodigo),
      destino_codigo: oNull(v.destinoCodigo),
      numero_vuelo: oNull(v.numeroVuelo),
      fecha_salida: oNull(v.fecha),
      hora_salida: oNull(v.horaSalida),
      hora_llegada: oNull(v.horaLlegada),
      servicios: oNull(v.servicios),
      orden: i,
    }));
  const r = await reemplazarFilas(guard.sb, "contrato_vuelos", numero, filas);
  if (!r.ok) return r;
  revalidatePath(`/dashboard/contratos/${numero}`);
  return { ok: true };
}

// ── Servicios (asistencia, traslados, tours…) ─────────────────────────────
export type ServicioContenido = {
  tipo: string; descripcion: string; proveedor: string; costo: number;
};

export async function guardarServiciosContrato(numero: string, servicios: ServicioContenido[]): Promise<Result> {
  const guard = await soloSuperadmin();
  if (!guard.ok) return guard;
  const filas = servicios
    .filter((s) => s.descripcion.trim())
    .map((s, i) => ({
      numero_contrato: numero,
      tipo: s.tipo || "otro",
      descripcion: s.descripcion.trim(),
      proveedor: oNull(s.proveedor),
      costo: num(s.costo),
      orden: i,
    }));
  const r = await reemplazarFilas(guard.sb, "contrato_servicios", numero, filas);
  if (!r.ok) return r;
  revalidatePath(`/dashboard/contratos/${numero}`);
  return { ok: true };
}

// ── Sincronizar el precio de venta con la suma de los ítems ───────────────
// Acción SEPARADA y explícita: mover `precio_venta` cambia saldo de cartera,
// rentabilidad y base de comisiones, así que nunca debe pasar como efecto
// secundario de editar los ítems.
export async function sincronizarPrecioVenta(numero: string): Promise<Result> {
  const guard = await soloSuperadmin();
  if (!guard.ok) return guard;
  const { data: items, error } = await guard.sb
    .from("contrato_items")
    .select("adultos, ninos, tarifa_adulto, tarifa_nino")
    .eq("numero_contrato", numero);
  if (error) return { ok: false, error: error.message };
  const total = (items ?? []).reduce(
    (s, it) => s + (it.adultos ?? 0) * (it.tarifa_adulto ?? 0) + (it.ninos ?? 0) * (it.tarifa_nino ?? 0),
    0
  );
  const { error: ue } = await guard.sb
    .from("ventas")
    .update({ precio_venta: total, updated_at: new Date().toISOString() })
    .eq("numero_contrato", numero);
  if (ue) return { ok: false, error: ue.message };
  revalidatePath(`/dashboard/contratos/${numero}`);
  return { ok: true };
}
