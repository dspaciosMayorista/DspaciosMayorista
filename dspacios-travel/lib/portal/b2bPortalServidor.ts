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
import { origenDeCotizacion } from "@/lib/portal/origenCotizacion";
import { leerTodoConConteo, PAGINA_FILAS, type PaginaConConteo } from "@/lib/auth/fichaComisionManual";
import { comisionesDelPortal, type ComisionPortal } from "@/lib/finanzas/comisionPortal";
import { cobroDeVenta } from "@/lib/finanzas/cobro";
import { contratosPagadosCompletos } from "@/lib/voucher/pagoCompleto";
import { cargarValorContratos } from "@/lib/portal/valorContrato";
import type { SolicitudContrato } from "@/lib/portal/solicitudContrato";
import { clasificarComparativas, ordenarContratosDesc, type AbonoPortal, type MetaComparativa, type VentaPortal, type VoucherPortal } from "@/lib/portal/b2bPortal";

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

const COLUMNAS_VENTA = `${COLUMNAS_DECISION}, contrato_uid, cliente, destino, precio_venta, moneda, moneda_cobro, trm_cobro, total_cobro, estado, modo_compra, comision_b2b, comision_estado, tipo_asesor, share_token`;

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
  /** Contratos con voucher preparado que NO se enlazan porque no están 100 % pagados (o no se pudo verificar: falla cerrado). */
  vouchersRetenidos: ReadonlySet<string>;
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
  ventas.splice(0, ventas.length, ...ordenarContratosDesc(ventas)); // #96: todas las pestañas heredan el orden
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
  let vouchersRetenidos: ReadonlySet<string> = new Set();
  if (opts.vouchers && nums.length) {
    const r = await leerPorLotes<Fila>(nums, (lote, d, h) =>
      admin.from("vouchers").select("id, numero_contrato, tipo, share_token", { count: "exact" })
        .in("numero_contrato", lote).not("contenido", "is", null).order("id", { ascending: true }).range(d, h) as unknown as PromiseLike<PaginaConConteo<Fila>>);
    // `contenido` no se descarga (pesa); el filtro de arriba ya garantiza que existe.
    vouchers = (r.filas as unknown as VoucherPortal[]).map((v) => ({ ...v, contenido: true }));
    vouchersCompletos = r.completa;
    // #53 (307): el aliado solo recibe el enlace de un voucher cuando el contrato está 100 % pagado (criterio único de la base, moneda de cobro y tolerancia incluidas).
    // Si no se puede verificar el pago NO se enlaza nada y se avisa que la lista puede estar incompleta (falla cerrado).
    const conVoucher = [...new Set(vouchers.map((v) => v.numero_contrato))];
    const pagados = await contratosPagadosCompletos(conVoucher);
    if (pagados === null) {
      vouchersRetenidos = new Set(conVoucher);
      vouchers = [];
      vouchersCompletos = false;
    } else {
      vouchersRetenidos = new Set(conVoucher.filter((n) => !pagados.has(n)));
      vouchers = vouchers.filter((v) => pagados.has(v.numero_contrato));
    }
  }

  return {
    ventas, participacionCompleta: part.completa, legacyNoVerificado: propios.legacyNoVerificado, historicoIncompleto: propios.incompleto,
    comisiones, abonos, abonosCompletos, vouchers, vouchersCompletos, vouchersRetenidos, crudas,
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
// Procedencia que el servidor selló al crear la cotización (solo se lee para clasificar; no sale de este módulo).
const COLUMNAS_PROCEDENCIA = "creado_por, plan_origen:payload->b2bAsistido->>origen, plan_rol:payload->b2bAsistido->asistido_por->>rol, plan_aliado:payload->b2bAsistido->>aliado_id";
type FilaConProcedencia = CotizacionFila & { creado_por: string | null; plan_origen: string | null; plan_rol: string | null; plan_aliado: string | null };

/** Lectura COMPLETA o nada: pagina avanzando por lo recibido y falla cerrado ante cualquier anomalía (ver `leerTodoConConteo`). */
async function leerTodasCotizaciones(pagina: (desde: number, hasta: number) => PromiseLike<PaginaConConteo<CotizacionFila>>) {
  const r = await leerTodoConConteo<CotizacionFila>(pagina, PAGINA_FILAS, (f) => typeof f?.id === "number");
  return r.completa ? { filas: r.filas, error: false } : { filas: [] as CotizacionFila[], error: true };
}

/**
 * Cada cotización se clasifica UNA sola vez por su ORIGEN REAL (ver `origenDeCotizacion`): «directa» si la generó el propio aliado —con o sin plan B2B congelado, en NETO o en
 * comisión— y «asistida» si el plan lo selló personal de D'spacios. La procedencia es la que el servidor escribió en `payload.b2bAsistido` (`origen`, `asistido_por`); el autor
 * (`creado_por`) solo decide las cotizaciones sin plan. Antes, TODA cotización con plan para este aliado iba a «Asistidas» aunque la hubiera creado él.
 */
export async function cargarCotizacionesPortal(ctx: Ok) {
  const admin = createAdminClient();
  // Asistidas: las que personal interno armó para ESTE aliado. El beneficiario es el `aliado_id` congelado en el plan
  // (autoritativo); `cotizaciones.aliado_id` no se usa (lo reserva la RPC de comparativas). Sin filtro de tenant: el aliado
  // ve lo suyo en Mayorista y en Minorista; la pertenencia es la ficha congelada, no la agencia.
  const asistidasQ = ctx.aliadoId != null
    ? await leerTodasCotizaciones((d, h) =>
        admin.from("cotizaciones")
          .select(`${COLUMNAS_COT}, ${COLUMNAS_PROCEDENCIA}, b2b_modo:payload->b2bAsistido->>modo_compra, b2b_total:payload->b2bAsistido->>total_exigible`, { count: "exact" })
          .eq("payload->b2bAsistido->>aliado_id", String(ctx.aliadoId))
          .order("id", { ascending: false }).range(d, h) as unknown as PromiseLike<PaginaConConteo<CotizacionFila>>)
    : { filas: [] as CotizacionFila[], error: false };
  // Directas: las que el aliado generó (se guardan con el correo de su sesión —identidad única de Auth—; nunca por nombre).
  // Tampoco filtran por tenant: un correo no pertenece a dos agencias y lo suyo en Minorista también es suyo.
  const directasQ = ctx.email
    ? await leerTodasCotizaciones((d, h) =>
        admin.from("cotizaciones").select(`${COLUMNAS_COT}, ${COLUMNAS_PROCEDENCIA}, b2b_modo:payload->b2bAsistido->>modo_compra, b2b_total:payload->b2bAsistido->>total_exigible`, { count: "exact" })
          .eq("creado_por", ctx.email as string)
          .order("id", { ascending: false }).range(d, h) as unknown as PromiseLike<PaginaConConteo<CotizacionFila>>)
    : { filas: [] as CotizacionFila[], error: false };

  const vivas = (filas: CotizacionFila[]) => filas.filter((c) => c.estado !== "descartada" && c.modo !== "comparativa");
  // Unión por id (una cotización puede venir de las dos consultas) y UNA sola clasificación por su origen real. Lo que no es de este aliado por ninguna vía se descarta.
  // Las que trae la consulta por plan (`payload.b2bAsistido.aliado_id` = esta ficha) llevan plan congelado POR CONSTRUCCIÓN; las de la consulta por autor, solo si el plan lo dice.
  const porId = new Map<number, FilaConProcedencia & { delPlan?: boolean }>();
  for (const c of asistidasQ.filas as FilaConProcedencia[]) if (!porId.has(c.id)) porId.set(c.id, { ...c, delPlan: true });
  for (const c of directasQ.filas as FilaConProcedencia[]) if (!porId.has(c.id)) porId.set(c.id, c);
  const directas: CotizacionFila[] = [], asistidas: CotizacionFila[] = [];
  for (const c of vivas([...porId.values()]) as (FilaConProcedencia & { delPlan?: boolean })[]) {
    const { creado_por, plan_origen, plan_rol, plan_aliado, delPlan, ...fila } = c;
    const tienePlan = delPlan === true || plan_aliado != null || plan_origen != null || plan_rol != null || c.b2b_modo != null;
    const origen = origenDeCotizacion({ creado_por, tiene_plan: tienePlan, origen_plan: plan_origen, rol_plan: plan_rol }, ctx.email);
    if (origen === "directa") directas.push(fila); else if (origen === "asistida") asistidas.push(fila);
  }
  const masNuevaPrimero = (x: CotizacionFila, y: CotizacionFila) => y.id - x.id;
  directas.sort(masNuevaPrimero); asistidas.sort(masNuevaPrimero);
  return { directas, asistidas, error: directasQ.error || asistidasQ.error };
}

/** #84 (ADL-039): valor VIGENTE de los contratos de las cotizaciones convertidas que el aliado ya ve (ver `valorContrato.ts`); solo se llama desde la lista de cotizaciones. */
export async function cargarValorContratosPortal(ctx: Ok, cotizaciones: Pick<CotizacionFila, "estado" | "numero_contrato">[]) {
  return cargarValorContratos(createAdminClient(), ctx, cotizaciones.filter((c) => c.estado === "convertida").map((c) => c.numero_contrato));
}

/**
 * #78: solicitudes de contrato ABIERTAS del propio aliado (por sesión, nunca de otro). Lectura completa o nada (pagina avanzando por lo recibido); si falla, `error`
 * y mapa vacío: la pantalla lo dice en vez de mostrar «sin solicitudes». Una consulta por carga de la pestaña, acotada a las filas del aliado.
 */
export async function cargarSolicitudesContratoPortal(ctx: Ok): Promise<{ porCotizacion: Record<number, SolicitudContrato>; error: boolean }> {
  // La tabla es nueva (323) y aún no está en types/database.ts.
  const admin = createAdminClient() as unknown as { from: (t: string) => { select: (c: string, o: { count: "exact" }) => { eq: (a: string, b: string) => { eq: (a: string, b: string) => { order: (c: string, o: { ascending: boolean }) => { range: (d: number, h: number) => unknown } } } } } };
  const r = await leerTodoConConteo<SolicitudContrato & { id: number }>(
    (d, h) => admin.from("cotizacion_solicitudes_contrato").select("id, cotizacion_id, notificados, creado_en", { count: "exact" })
      .eq("solicitante_id", ctx.userId).eq("estado", "solicitada").order("id", { ascending: true }).range(d, h) as unknown as PromiseLike<PaginaConConteo<SolicitudContrato & { id: number }>>,
    PAGINA_FILAS, (f) => typeof f?.id === "number" && typeof f?.cotizacion_id === "number");
  if (!r.completa) return { porCotizacion: {}, error: true };
  return { porCotizacion: Object.fromEntries(r.filas.map((f) => [f.cotizacion_id, { cotizacion_id: f.cotizacion_id, notificados: f.notificados, creado_en: f.creado_en }])), error: false };
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
