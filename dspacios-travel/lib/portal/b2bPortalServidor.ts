/**
 * CARGA AUTORIZADA DEL PORTAL B2B (#65)
 *
 * Único punto de lectura de las pestañas y del inicio: todas salen del MISMO
 * conjunto de registros autorizados, así que un indicador nunca cuenta algo que
 * su pestaña no muestre (ni al revés).
 *
 * Lecturas con service-role: la autorización la deciden, sin comparar nombres
 * salvo el respaldo legacy ya existente:
 *   · propiedad    → `contratosDelPortalB2B` (misma regla que los documentos por URL)
 *   · participación → `contratosPorParticipacion` (comisión por `aliado_id`; NO da propiedad)
 *   · cotizaciones → correo de la sesión (directas) y `aliado_id` congelado en el plan (asistidas)
 */
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { comisionDefault, categoriaAliado } from "@/lib/b2b";
import { contratosDelPortalB2B, consultasPortalSupabase, COLUMNAS_DECISION } from "@/lib/auth/contratosPortalB2B";
import { contratosPorParticipacion } from "@/lib/auth/participacionComisionB2B";
import { leerTodoConConteo, PAGINA_FILAS, type PaginaConConteo } from "@/lib/auth/fichaComisionManual";
import { comisionesDelPortal, type ComisionPortal } from "@/lib/finanzas/comisionPortal";
import { cobroDeVenta } from "@/lib/finanzas/cobro";
import { clasificarComparativas, type AbonoPortal, type MetaComparativa, type VentaPortal, type VoucherPortal } from "@/lib/portal/b2bPortal";

type Admin = ReturnType<typeof createAdminClient>;
type Fila = Record<string, unknown>;

export type ContextoPortal =
  | { estado: "visitante" | "pendiente"; nombre: string | null }
  /** Sesión que no es de aliado B2B. `perfil` null = hay sesión pero no existe fila en `usuarios`. Solo informativo: no concede nada. */
  | { estado: "interno"; nombre: string | null; perfil: { rol: string | null; activo: boolean | null } | null }
  | {
      estado: "ok";
      userId: string;
      email: string | null;
      nombre: string;
      rol: "agencia" | "freelance";
      tenant: string | null;
      aliadoId: number | null;
      accesoLegacyNombre: boolean | null;
      agenciaId: string | null;
      pctPerfil: number | null;
      esTitularAgencia: boolean;
    };

export async function resolverContextoPortal(): Promise<ContextoPortal> {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return { estado: "visitante", nombre: null };
  const { data: perfil } = await sb
    .from("usuarios")
    .select("nombre, rol, activo, agencia_id, pct_comision, aliado_id, tenant, acceso_legacy_nombre")
    .eq("id", user.id)
    .maybeSingle();
  const nombre = (perfil?.nombre ?? null) as string | null;
  const rol = perfil?.rol ?? null;
  if (rol !== "agencia" && rol !== "freelance") {
    return { estado: "interno", nombre, perfil: perfil ? { rol: (rol as string | null), activo: (perfil.activo as boolean | null) ?? null } : null };
  }
  // Solo `true` entra: una cuenta sin valor tampoco es una cuenta aprobada.
  if (perfil?.activo !== true) return { estado: "pendiente", nombre };
  return {
    estado: "ok",
    userId: user.id,
    email: user.email ?? null,
    nombre: (nombre ?? "").trim(),
    rol,
    tenant: (perfil?.tenant as string | null) ?? null,
    aliadoId: (perfil?.aliado_id as number | null) ?? null,
    accesoLegacyNombre: (perfil?.acceso_legacy_nombre as boolean | null) ?? null,
    agenciaId: (perfil?.agencia_id as string | null) ?? null,
    pctPerfil: (perfil?.pct_comision as number | null) ?? null,
    esTitularAgencia: rol === "agencia" && !perfil?.agencia_id,
  };
}

type Ok = Extract<ContextoPortal, { estado: "ok" }>;

/** Categoría y % de comisión (compactos en el inicio). */
export async function categoriaDelPortal(ctx: Ok) {
  const sb = await createClient();
  const admin = createAdminClient();
  let pct = ctx.pctPerfil;
  if (ctx.agenciaId) {
    const { data: ag } = await admin.from("usuarios").select("pct_comision").eq("id", ctx.agenciaId).maybeSingle();
    pct = (ag?.pct_comision as number | null) ?? null;
  }
  const def = await comisionDefault(sb, ctx.rol);
  const efectivo = pct ?? def;
  return { cat: categoriaAliado(ctx.rol, efectivo, def), pct: efectivo };
}

const COLUMNAS_VENTA = `${COLUMNAS_DECISION}, cliente, destino, precio_venta, moneda, moneda_cobro, trm_cobro, total_cobro, estado, modo_compra, comision_b2b, comision_estado, tipo_asesor, share_token`;

async function leerPorLotes<T extends Fila>(
  nums: string[],
  leer: (lote: string[], desde: number, hasta: number) => PromiseLike<PaginaConConteo<T>>,
): Promise<{ filas: T[]; completa: boolean }> {
  const filas: T[] = [];
  for (let i = 0; i < nums.length; i += 100) {
    const lote = nums.slice(i, i + 100);
    const pedidos = new Set(lote);
    const r = await leerTodoConConteo<T>((d, h) => leer(lote, d, h), PAGINA_FILAS, (f) => pedidos.has(String(f?.numero_contrato)));
    if (!r.completa) return { filas: [], completa: false };
    filas.push(...r.filas);
  }
  return { filas, completa: true };
}

export type ConjuntoPortal = {
  ventas: VentaPortal[];
  /** Lectura completa de la participación por comisión (false = no se muestra y se avisa). */
  participacionCompleta: boolean;
  legacyNoVerificado: boolean;
  /** Las lecturas de contratos por id (usuario / ficha) no se pudieron completar: el histórico mostrado puede estar incompleto. */
  historicoIncompleto: boolean;
  comisiones: Map<string, ComisionPortal | null>;
  abonos: AbonoPortal[];
  abonosCompletos: boolean;
  vouchers: VoucherPortal[];
  vouchersCompletos: boolean;
  /** Filas crudas (monedas de oferta para la comisión). */
  crudas: Map<string, Fila>;
};

export async function cargarConjuntoPortal(ctx: Ok, opts: { abonos?: boolean; vouchers?: boolean } = {}): Promise<ConjuntoPortal> {
  const admin: Admin = createAdminClient();

  const propios = await contratosDelPortalB2B(
    {
      id: ctx.userId, rol: ctx.rol, tenant: ctx.tenant, activo: true,
      nombre: ctx.nombre || null, aliadoId: ctx.aliadoId, accesoLegacyNombre: ctx.accesoLegacyNombre,
    },
    consultasPortalSupabase(admin, COLUMNAS_VENTA)
  );
  const numsPropios = new Set(propios.contratos.map((c) => c.numero_contrato));
  const part = await contratosPorParticipacion(admin, ctx.aliadoId, COLUMNAS_VENTA, numsPropios);

  const crudas = new Map<string, Fila>();
  const ventas: VentaPortal[] = [];
  for (const c of propios.contratos) { crudas.set(c.numero_contrato, c); ventas.push({ ...(c as unknown as VentaPortal), relacion: "propio" }); }
  for (const c of part.filas) { crudas.set(c.numero_contrato, c); ventas.push({ ...(c as unknown as VentaPortal), relacion: "participacion" }); }

  // Comisión: la misma lectura que la cuenta de cobro. A quien solo participa se
  // le acepta únicamente lo que sale de SUS filas de `aliados_b2b` — jamás los
  // importes de `ventas`, que son del contrato (y pueden ser de otro aliado).
  const via = new Map<string, string>(propios.via);
  for (const c of part.filas) via.set(c.numero_contrato, "aliado_id");
  const comisionesTodas = await comisionesDelPortal(
    admin,
    [...propios.contratos, ...part.filas] as unknown as Parameters<typeof comisionesDelPortal>[1],
    via,
    { aliadoId: ctx.aliadoId, nombre: ctx.nombre || null },
  );
  const comisiones = new Map<string, ComisionPortal | null>();
  for (const [n, vis] of comisionesTodas) {
    comisiones.set(n, numsPropios.has(n) || vis?.fuente === "filas" ? vis : null);
  }

  const nums = [...numsPropios];
  let abonos: AbonoPortal[] = [];
  let abonosCompletos = true;
  if (opts.abonos && nums.length) {
    const r = await leerPorLotes<Fila>(nums, (lote, d, h) =>
      admin.from("abonos").select("id, numero_contrato, fecha_abono, valor_abono, forma_pago", { count: "exact" })
        .in("numero_contrato", lote).order("id", { ascending: true }).range(d, h) as unknown as PromiseLike<PaginaConConteo<Fila>>);
    abonos = r.filas as unknown as AbonoPortal[];
    abonosCompletos = r.completa;
  }
  let vouchers: VoucherPortal[] = [];
  let vouchersCompletos = true;
  if (opts.vouchers && nums.length) {
    const r = await leerPorLotes<Fila>(nums, (lote, d, h) =>
      admin.from("vouchers").select("id, numero_contrato, tipo, share_token", { count: "exact" })
        .in("numero_contrato", lote).not("contenido", "is", null).order("id", { ascending: true }).range(d, h) as unknown as PromiseLike<PaginaConConteo<Fila>>);
    // `contenido` no se descarga (pesa); el filtro de arriba ya garantiza que existe.
    vouchers = (r.filas as unknown as VoucherPortal[]).map((v) => ({ ...v, contenido: true }));
    vouchersCompletos = r.completa;
  }

  return {
    ventas, participacionCompleta: part.completa, legacyNoVerificado: propios.legacyNoVerificado, historicoIncompleto: propios.incompleto,
    comisiones, abonos, abonosCompletos, vouchers, vouchersCompletos, crudas,
  };
}

/** Moneda de la oferta de un contrato (la comisión se expresa en ella). */
export function monedaOfertaDe(fila: Fila | undefined): string {
  return fila ? cobroDeVenta(fila as never).monedaOferta : "COP";
}

export type CotizacionFila = {
  id: number; codigo: string | null; modo: string | null; cliente: string | null; destino: string | null; hotel: string | null;
  pax: number | null; precio_venta: number | string | null; moneda: string | null; fecha_salida: string | null;
  vigencia_hasta: string | null; estado: string; share_token: string | null; numero_contrato: string | null; created_at: string | null;
  b2b_modo?: string | null; b2b_total?: string | null;
};

const COLUMNAS_COT = "id, codigo, modo, cliente, destino, hotel, pax, precio_venta, moneda, fecha_salida, vigencia_hasta, estado, share_token, numero_contrato, created_at";

/** Lectura COMPLETA o nada: pagina avanzando por lo recibido y falla cerrado ante cualquier anomalía (ver `leerTodoConConteo`). */
async function leerTodasCotizaciones(pagina: (desde: number, hasta: number) => PromiseLike<PaginaConConteo<CotizacionFila>>) {
  const r = await leerTodoConConteo<CotizacionFila>(pagina, PAGINA_FILAS, (f) => typeof f?.id === "number");
  return r.completa ? { filas: r.filas, error: false } : { filas: [] as CotizacionFila[], error: true };
}

/**
 * Cada cotización se clasifica UNA sola vez. Si lleva un plan B2B asistido para este aliado es «asistida», aunque el
 * propio aliado figure en `creado_por` (mismo correo): el plan congelado manda sobre el autor.
 */
export async function cargarCotizacionesPortal(ctx: Ok) {
  const admin = createAdminClient();
  // Asistidas: las que personal interno armó para ESTE aliado. El beneficiario es el `aliado_id` congelado en el plan
  // (autoritativo); `cotizaciones.aliado_id` no se usa (lo reserva la RPC de comparativas). Sin filtro de tenant: el aliado
  // ve lo suyo en Mayorista y en Minorista; la pertenencia es la ficha congelada, no la agencia.
  const asistidasQ = ctx.aliadoId != null
    ? await leerTodasCotizaciones((d, h) =>
        admin.from("cotizaciones")
          .select(`${COLUMNAS_COT}, b2b_modo:payload->b2bAsistido->>modo_compra, b2b_total:payload->b2bAsistido->>total_exigible`, { count: "exact" })
          .eq("payload->b2bAsistido->>aliado_id", String(ctx.aliadoId))
          .order("id", { ascending: false }).range(d, h) as unknown as PromiseLike<PaginaConConteo<CotizacionFila>>)
    : { filas: [] as CotizacionFila[], error: false };
  // Directas: las que el aliado generó (se guardan con el correo de su sesión —identidad única de Auth—; nunca por nombre).
  // Tampoco filtran por tenant: un correo no pertenece a dos agencias y lo suyo en Minorista también es suyo.
  const directasQ = ctx.email
    ? await leerTodasCotizaciones((d, h) =>
        admin.from("cotizaciones").select(COLUMNAS_COT, { count: "exact" })
          .eq("creado_por", ctx.email as string)
          .order("id", { ascending: false }).range(d, h) as unknown as PromiseLike<PaginaConConteo<CotizacionFila>>)
    : { filas: [] as CotizacionFila[], error: false };

  const vivas = (filas: CotizacionFila[]) => filas.filter((c) => c.estado !== "descartada" && c.modo !== "comparativa");
  const asistidas = vivas(asistidasQ.filas);
  const idsAsistidas = new Set(asistidas.map((c) => c.id));
  const directas = vivas(directasQ.filas).filter((c) => !idsAsistidas.has(c.id));
  return { directas, asistidas, error: directasQ.error || asistidasQ.error };
}

export type ComparativaPortal = {
  id: number; codigo: string; share_token: string; estado: string; destino: string | null; fecha_salida: string | null;
  moneda: string | null; vigencia_hasta: string | null;
  opciones: Array<{ opcion: string; acomodacion: string; etiqueta: string; total: number; moneda: string }>;
  hija: { codigo: string; estado: string; numero_contrato: string | null } | null;
};

/**
 * Qué comparativas ve la SESIÓN lo decide la BASE (RPC 211, `auth.uid()`): sin service-role ni parámetro de usuario.
 * La RPC mezcla las que creó el aliado y las asignadas a su ficha, y no dice cuáles son cuáles; eso se verifica por IDs
 * (`propietario_id` = usuario, `aliado_id` = ficha) sobre los mismos IDs que la RPC autorizó — nunca por nombre.
 * Cualquier fallo (RPC, paginación, verificación) devuelve `error: true` y NINGUNA comparativa: la pantalla avisa
 * en vez de decir «no tienes comparativas».
 */
export async function cargarComparativasPortal(ctx: Ok): Promise<{ directas: ComparativaPortal[]; asistidas: ComparativaPortal[]; error: boolean }> {
  const falla = { directas: [] as ComparativaPortal[], asistidas: [] as ComparativaPortal[], error: true };
  try {
    const sb = await createClient();
    const vis = await leerTodoConConteo<ComparativaPortal>(
      (d, h) => sb.rpc("comparativas_b2b_visibles", undefined, { count: "exact" }).order("id", { ascending: true }).range(d, h) as unknown as PromiseLike<PaginaConConteo<ComparativaPortal>>,
      PAGINA_FILAS,
      (f) => typeof f?.id === "number"
    );
    if (!vis.completa) return falla;
    if (vis.filas.length === 0) return { directas: [], asistidas: [], error: false };

    const admin = createAdminClient();
    const meta = new Map<number, MetaComparativa>();
    for (let i = 0; i < vis.filas.length; i += 100) {
      const ids = vis.filas.slice(i, i + 100).map((c) => c.id);
      const pedidos = new Set(ids);
      const r = await leerTodoConConteo<{ id: number; propietario_id: string | null; aliado_id: number | null }>(
        (d, h) => admin.from("cotizaciones").select("id, propietario_id, aliado_id", { count: "exact" }).in("id", ids).order("id", { ascending: true }).range(d, h) as unknown as PromiseLike<PaginaConConteo<{ id: number; propietario_id: string | null; aliado_id: number | null }>>,
        PAGINA_FILAS,
        (f) => pedidos.has(f?.id)
      );
      if (!r.completa) return falla;
      for (const f of r.filas) meta.set(f.id, { propietario_id: f.propietario_id ?? null, aliado_id: f.aliado_id ?? null });
    }
    const { directas, asistidas, sinVerificar } = clasificarComparativas(vis.filas, meta, ctx.userId, ctx.aliadoId);
    return { directas, asistidas, error: sinVerificar > 0 };
  } catch {
    return falla;
  }
}

export async function linkPagoPortal(): Promise<string | null> {
  const sb = await createClient();
  const { data } = await sb.from("config_sitio").select("link_pago").eq("id", 1).maybeSingle();
  return (data?.link_pago as string | null) ?? null;
}
