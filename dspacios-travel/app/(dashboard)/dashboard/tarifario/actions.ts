"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { REFERENCIAS_DESTINO, type UsoDestino } from "@/lib/producto/usoDestino";
import { puedeEscribir } from "@/lib/roles";

// ─── Destinos ──────────────────────────────────────────────────────
export async function crearDestino(nombre: string, codigoIata?: string, pais?: string) {
  const sb = await createClient();
  const limpio = nombre.trim().toUpperCase();
  if (!limpio) throw new Error("El nombre del destino es obligatorio.");

  // Evitar duplicados sin importar mayúsculas/minúsculas (ej. "Cartagena" vs "CARTAGENA").
  const { data: existentes } = await sb.from("destinos").select("nombre");
  const yaExiste = (existentes ?? []).some(
    (d) => d.nombre.trim().toLowerCase() === limpio.toLowerCase()
  );
  if (yaExiste) throw new Error(`Ya existe un destino "${limpio}".`);

  const { error } = await sb.from("destinos").insert({
    nombre: limpio,
    codigo_iata: codigoIata?.trim().toUpperCase() || null,
    pais: pais?.trim() || null,
  });
  if (error) throw new Error(error.message);
  revalidatePath("/dashboard/tarifario");
  revalidatePath("/dashboard/producto/destinos");
}

// Elimina un destino. Si `reasignarA` viene, primero MUEVE todo lo del destino
// (hoteles, servicios, paquetes, tarifario…) al destino de llegada y luego lo
// borra (fusión de duplicados, `fn_fusionar_destino`, migración 112 — sin
// cambios). Sin reasignar, solo borra si no está en uso (la FK lo impide: 23503).
//
// Nunca afirma un éxito que no ocurrió:
//   · permiso primero: mismo set que la policy de escritura de `destinos` y
//     que la propia `fn_fusionar_destino` (ESCRITURA.producto; ver
//     pruebas/usoDestino.test.ts). La base de datos sigue siendo la frontera
//     real; esto solo evita el "éxito" silencioso de un DELETE que la RLS
//     reduce a cero filas;
//   · el origen debe existir antes de operar (la RPC hace `return` sin error
//     si no existe, y eso no es un éxito);
//   · borrado directo: se exige que el DELETE haya borrado exactamente esa
//     fila (`.select("id")`); cero filas = error, nunca `{ ok: true }`;
//   · fusión: tras la RPC se confirma que el origen ya no existe.
export async function eliminarDestino(
  id: number,
  reasignarA?: number
): Promise<{ ok: true } | { ok: false; error: string }> {
  const esId = (v: unknown) => typeof v === "number" && Number.isInteger(v) && v > 0;
  if (!esId(id)) return { ok: false, error: "Destino inválido." };
  if (reasignarA !== undefined && !esId(reasignarA)) return { ok: false, error: "El destino de llegada no es válido." };
  if (reasignarA === id) return { ok: false, error: "Elige un destino distinto al que vas a eliminar." };

  const sb = await createClient();

  // 1) Permiso.
  let rol: string | null = null;
  try {
    const r = await sb.rpc("mi_rol");
    if (r.error) return { ok: false, error: "No se pudo verificar tu permiso para eliminar destinos. Intenta de nuevo." };
    rol = typeof r.data === "string" ? r.data : null;
  } catch {
    return { ok: false, error: "No se pudo verificar tu permiso para eliminar destinos. Intenta de nuevo." };
  }
  if (!puedeEscribir("producto", rol)) return { ok: false, error: "Tu rol no tiene permiso para eliminar destinos." };

  // 2) El origen existe (lectura pública de `destinos`).
  const existe = async (): Promise<boolean | null> => {
    const { data, error } = await sb.from("destinos").select("id").eq("id", id).maybeSingle();
    return error ? null : !!data;
  };
  const antes = await existe();
  if (antes === null) return { ok: false, error: "No se pudo comprobar el destino. Intenta de nuevo." };
  if (!antes) return { ok: false, error: "El destino ya no existe (pudo eliminarse en otra sesión). Recarga la página." };

  if (reasignarA !== undefined) {
    const { error } = await sb.rpc("fn_fusionar_destino", { p_origen: id, p_destino: reasignarA });
    if (error) return { ok: false, error: error.message };
    // 3) La fusión termina borrando el origen: confirmarlo antes de afirmar éxito.
    const despues = await existe();
    if (despues === null) return { ok: false, error: "La fusión terminó, pero no se pudo confirmar que el destino se eliminó. Recarga la página y revisa." };
    if (despues) return { ok: false, error: "La fusión no eliminó el destino. Recarga la página y revisa." };
    revalidatePath("/dashboard/tarifario");
    revalidatePath("/dashboard/producto/destinos");
    return { ok: true };
  }

  // Pista útil: cuántos hoteles lo usan (la causa más común de bloqueo).
  const { count: nHoteles } = await sb
    .from("hoteles")
    .select("id", { count: "exact", head: true })
    .eq("destino_id", id);

  const { data: borrados, error } = await sb.from("destinos").delete().eq("id", id).select("id");
  if (error) {
    // 23503 = llave foránea: el destino está en uso en otra tabla.
    if (error.code === "23503") {
      const hint = nHoteles ? ` por ${nHoteles} hotel(es)` : "";
      return {
        ok: false,
        error: `No se puede eliminar: el destino está en uso${hint}. Elige a qué destino mover su contenido y vuelve a intentar.`,
      };
    }
    return { ok: false, error: error.message };
  }
  // Cero filas sin error = la RLS no dejó borrar o el destino ya no estaba.
  if (!Array.isArray(borrados) || borrados.length !== 1) {
    return { ok: false, error: "No se eliminó el destino: no tienes permiso para borrarlo o ya no existe." };
  }
  revalidatePath("/dashboard/tarifario");
  revalidatePath("/dashboard/producto/destinos");
  return { ok: true };
}

// Solo LECTURA, para el modal de eliminación: cuántas filas de cada tabla con
// FK a destinos (REFERENCIAS_DESTINO) apuntan a este destino. Un `count` por
// tabla con `head: true` (encabezado Prefer: count=exact, sin traer filas y
// sin funciones de agregado), con el cliente de sesión — bajo RLS.
//
// `alcanceCompleto`: solo los roles que pueden borrar destinos (policy
// "destinos: escritura admin", el mismo set que ESCRITURA.producto) leen
// TODAS las filas de esas 10 tablas (sus policies solo miran el rol; ver
// pruebas/usoDestino.test.ts, que lo verifica contra las migraciones). Para
// cualquier otro rol (ej. control_vuelo, que entra a Producto pero no lee
// servicios_adicionales ni armado_paquetes) un 0 puede ser RLS, no ausencia:
// el modal no puede afirmar "sin contenido". Un rol que no se pudo resolver
// cuenta como alcance incompleto.
//
// No decide nada: el borrado y la fusión siguen siendo `eliminarDestino`/
// `fn_fusionar_destino`, y la base de datos tiene la última palabra (23503).
// Una tabla que no se pudo contar vuelve como `null`, nunca como 0.
export async function usoDestino(id: number): Promise<UsoDestino> {
  const sb = await createClient();
  const [rolRes, ...resultados] = await Promise.all([
    Promise.resolve(sb.rpc("mi_rol")).then(
      (r) => r,
      () => ({ data: null, error: new Error("mi_rol no disponible") })
    ),
    ...REFERENCIAS_DESTINO.map(async ({ tabla }) => {
      const { count, error } = await sb.from(tabla).select("*", { count: "exact", head: true }).eq("destino_id", id);
      if (error) console.error(`[usoDestino] destino=${id} tabla=${tabla} detalle=${error.message}`);
      return [tabla, error || count == null ? null : count] as const;
    }),
  ]);
  // Rol no resuelto = permiso "desconocido" (nunca se asume "si" ni "no").
  const permiso: UsoDestino["permiso"] = rolRes.error
    ? "desconocido"
    : puedeEscribir("producto", typeof rolRes.data === "string" ? rolRes.data : null) ? "si" : "no";
  return {
    conteos: Object.fromEntries(resultados) as UsoDestino["conteos"],
    alcanceCompleto: permiso === "si",
    permiso,
  };
}

// Lista curada de destinos turísticos famosos (nombre + IATA) para cargar de una.
// Colombia, República Dominicana y México. Se omiten los que ya existan.
const DESTINOS_SUGERIDOS: { nombre: string; iata: string; pais: string }[] = [
  // Colombia
  { nombre: "CARTAGENA", iata: "CTG", pais: "Colombia" },
  { nombre: "SAN ANDRÉS", iata: "ADZ", pais: "Colombia" },
  { nombre: "SANTA MARTA", iata: "SMR", pais: "Colombia" },
  { nombre: "BOGOTÁ", iata: "BOG", pais: "Colombia" },
  { nombre: "MEDELLÍN", iata: "MDE", pais: "Colombia" },
  { nombre: "CALI", iata: "CLO", pais: "Colombia" },
  { nombre: "BARRANQUILLA", iata: "BAQ", pais: "Colombia" },
  { nombre: "PEREIRA", iata: "PEI", pais: "Colombia" },
  { nombre: "ARMENIA", iata: "AXM", pais: "Colombia" },
  { nombre: "LETICIA", iata: "LET", pais: "Colombia" },
  { nombre: "RIOHACHA", iata: "RCH", pais: "Colombia" },
  // República Dominicana
  { nombre: "PUNTA CANA", iata: "PUJ", pais: "República Dominicana" },
  { nombre: "SANTO DOMINGO", iata: "SDQ", pais: "República Dominicana" },
  { nombre: "PUERTO PLATA", iata: "POP", pais: "República Dominicana" },
  { nombre: "LA ROMANA", iata: "LRM", pais: "República Dominicana" },
  { nombre: "SAMANÁ", iata: "AZS", pais: "República Dominicana" },
  { nombre: "SANTIAGO DE LOS CABALLEROS", iata: "STI", pais: "República Dominicana" },
  // México
  { nombre: "CANCÚN", iata: "CUN", pais: "México" },
  { nombre: "CIUDAD DE MÉXICO", iata: "MEX", pais: "México" },
  { nombre: "LOS CABOS", iata: "SJD", pais: "México" },
  { nombre: "PUERTO VALLARTA", iata: "PVR", pais: "México" },
  { nombre: "COZUMEL", iata: "CZM", pais: "México" },
  { nombre: "TULUM", iata: "TQO", pais: "México" },
  { nombre: "MÉRIDA", iata: "MID", pais: "México" },
  { nombre: "GUADALAJARA", iata: "GDL", pais: "México" },
  { nombre: "MAZATLÁN", iata: "MZT", pais: "México" },
  { nombre: "ACAPULCO", iata: "ACA", pais: "México" },
  { nombre: "OAXACA", iata: "OAX", pais: "México" },
];

export async function cargarDestinosSugeridos(): Promise<{ insertados: number; omitidos: number }> {
  const sb = await createClient();
  const { data: existentes } = await sb.from("destinos").select("nombre");
  const yaHay = new Set((existentes ?? []).map((d) => d.nombre.trim().toLowerCase()));

  const nuevos = DESTINOS_SUGERIDOS
    .filter((d) => !yaHay.has(d.nombre.toLowerCase()))
    .map((d) => ({ nombre: d.nombre, codigo_iata: d.iata, pais: d.pais }));

  if (nuevos.length) {
    const { error } = await sb.from("destinos").insert(nuevos);
    if (error) throw new Error(error.message);
  }
  revalidatePath("/dashboard/tarifario");
  revalidatePath("/dashboard/producto/destinos");
  return { insertados: nuevos.length, omitidos: DESTINOS_SUGERIDOS.length - nuevos.length };
}

// ─── Hoteles ───────────────────────────────────────────────────────
export async function crearHotel(destinoId: number, nombre: string, zona?: string, notas?: string) {
  const sb = await createClient();
  const { error } = await sb.from("hoteles").insert({
    destino_id: destinoId,
    nombre,
    zona: zona || null,
    notas: notas || null,
  });
  if (error) throw new Error(error.message);
  revalidatePath(`/dashboard/tarifario/${destinoId}`);
}

export async function eliminarHotel(id: number, destinoId: number) {
  const sb = await createClient();
  const { error } = await sb.from("hoteles").delete().eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath(`/dashboard/tarifario/${destinoId}`);
}

// ─── Temporadas ────────────────────────────────────────────────────
export async function crearTemporada(
  destinoId: number,
  nombre: "ALTA" | "MEDIA" | "BAJA",
  anio: number,
  fechas: { inicio: string; fin: string }[]
) {
  const sb = await createClient();
  const { data: temp, error } = await sb
    .from("temporadas")
    .insert({ destino_id: destinoId, nombre, anio })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  if (fechas.length > 0) {
    const { error: fe } = await sb.from("temporada_fechas").insert(
      fechas.map((f) => ({ temporada_id: temp.id, fecha_inicio: f.inicio, fecha_fin: f.fin }))
    );
    if (fe) throw new Error(fe.message);
  }
  revalidatePath(`/dashboard/tarifario/${destinoId}`);
}

export async function eliminarTemporada(id: number, destinoId: number) {
  const sb = await createClient();
  const { error } = await sb.from("temporadas").delete().eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath(`/dashboard/tarifario/${destinoId}`);
}

// ─── Tarifas (Módulo de Producto) ──────────────────────────────────
export type PrecioAcomodacion = {
  acomodacion: "sencilla" | "doble" | "triple" | "multiple" | "nino";
  precio: number;
};

export async function guardarTarifa(data: {
  hotelId: number;
  habitacionId?: number | null;
  planId: number;
  temporadaId: number;
  noches: number;
  comisionable: boolean;
  impuestoNoComisionable: number;
  costoBase?: number | null;
  pctMk?: number | null;
  notas?: string;
  precios: PrecioAcomodacion[];
  destinoId: number;
}) {
  const sb = await createClient();

  // Upsert tarifa principal
  const { data: tarifa, error } = await sb
    .from("tarifas")
    .upsert(
      {
        hotel_id: data.hotelId,
        habitacion_id: data.habitacionId ?? null,
        plan_id: data.planId,
        temporada_id: data.temporadaId,
        noches: data.noches,
        comisionable: data.comisionable,
        impuesto_no_comisionable: data.impuestoNoComisionable,
        costo_base: data.costoBase ?? null,
        pct_mk: data.pctMk ?? null,
        notas: data.notas ?? null,
        activo: true,
      },
      { onConflict: "hotel_id,plan_id,temporada_id,noches" }
    )
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  // Reemplazar precios
  await sb.from("tarifa_precios").delete().eq("tarifa_id", tarifa.id);
  if (data.precios.length > 0) {
    const { error: pe } = await sb.from("tarifa_precios").insert(
      data.precios.map((p) => ({ tarifa_id: tarifa.id, acomodacion: p.acomodacion, precio: p.precio }))
    );
    if (pe) throw new Error(pe.message);
  }
  revalidatePath(`/dashboard/tarifario/${data.destinoId}`);
}

export async function eliminarTarifa(id: number, destinoId: number) {
  const sb = await createClient();
  // tarifa_precios cae por FK on delete cascade; si no, lo limpiamos explícito
  await sb.from("tarifa_precios").delete().eq("tarifa_id", id);
  const { error } = await sb.from("tarifas").delete().eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath(`/dashboard/tarifario/${destinoId}`);
}

// ─── Inclusiones ──────────────────────────────────────────────────
export async function crearInclusion(
  destinoId: number,
  tipo: "incluye" | "no_incluye",
  texto: string
) {
  const sb = await createClient();
  const { error } = await sb.from("inclusiones").insert({ destino_id: destinoId, tipo, texto });
  if (error) throw new Error(error.message);
  revalidatePath(`/dashboard/tarifario/${destinoId}`);
}

export async function eliminarInclusion(id: number, destinoId: number) {
  const sb = await createClient();
  const { error } = await sb.from("inclusiones").delete().eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath(`/dashboard/tarifario/${destinoId}`);
}
