import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { calcularComisionFila, elegirFilaCobro, esComisionDescontada, evidenciaSinFicha, filasCobrables, type EvidenciaSinFicha, type FilaComisionB2B } from "@/lib/finanzas/comisionB2B";
import { accesoDocumentoContrato } from "@/lib/auth/accesoDocumentoContrato";
import { verificarFichasComisionManual, consultarFichasSupabase, fichaDeContrato } from "@/lib/auth/fichaComisionManual";
import {
  resolverFichaAliado,
  explicarFicha,
  resolverAliadoIdContrato,
  listarTodosLosCandidatos,
  type CandidatoAliado,
  type FichaAliado,
} from "@/lib/finanzas/fichaAliado";

// Detalle de cómo se llegó al valor a cobrar. La vía 2 (aliados_b2b) trae el
// desglose completo (calcComisionB2B); la vía 1 (ventas.comision_b2b, flujo
// tarifario B2B de mayorista) solo guarda el total ya calculado, sin
// desglose granular — se muestra un % "efectivo" (comisión/PVP) en vez del
// % contratado real.
export type DetalleComision = {
  pvp: number;
  baseComisionable: number | null;
  pctComision: number;
  esPctEfectivo: boolean;
  comisionBase: number | null;
  recobroAliado: number | null;
  aplicaRetencion: boolean | null;
  pctRetencion: number | null;
  retencion: number | null;
  totalPagar: number;
};

export type AliadoCatalogo = {
  nombre: string;
  tipo_documento: string | null;
  nit: string | null;
  direccion: string | null;
  telefono: string | null;
  email: string | null;
  banco: string | null;
  tipo_cuenta: string | null;
  numero_cuenta: string | null;
};

export type ComisionResuelta = {
  tipo: "comision";
  numeroContrato: string;
  cliente: string | null;
  destino: string | null;
  fechaSalida: string | null;
  moneda: string;
  tenant: string;
  aliado: string;
  aliadoInfo: AliadoCatalogo | null;
  tipoAsesorEfectivo: string | null;
  detalle: DetalleComision;
  esInterno: boolean;
  esDueno: boolean;
  // Solo vía 2 (aliados_b2b) — necesario para leer comision_b2b_pagos. La
  // vía 1 (flujo tarifario B2B de mayorista) no tiene log de abonos: el
  // estado de cuenta de abonos no aplica ahí (queda null).
  aliadoB2bId: number | null;
};



/**
 * Un contrato con VARIAS comisiones cobrables para quien pregunta: la cuenta
 * de cobro no elige en silencio la más reciente, pide escoger (`?id=`).
 */
export type ComisionesParaElegir = {
  tipo: "elegir";
  numeroContrato: string;
  moneda: string;
  opciones: { id: number; aliado: string | null; totalPagar: number }[];
};

type FilaResolver = FilaComisionB2B & { aliado: string | null; tipo_aliado: string | null };

/**
 * Resuelve una comisión B2B por número de contrato, con control de acceso:
 * la ve un rol interno o el aliado dueño de la comisión. Comparte la lógica
 * entre la cuenta de cobro y el estado de cuenta de abonos.
 *
 * #38: el importe sale SIEMPRE de la fila de `aliados_b2b` (la misma lectura
 * que Comisiones y Rentabilidad) cuando el contrato tiene una cobrable; el
 * `ventas.comision_b2b` del flujo tarifario solo se usa si no hay ninguna. Una
 * comisión descontada en el precio (modo neta) no se cobra: no hay documento.
 * Con varias cobrables y sin `comisionId`, devuelve la lista para elegir.
 */
export async function resolverComisionB2B(
  numero: string,
  comisionId?: number | null,
): Promise<ComisionResuelta | ComisionesParaElegir | null> {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return null;
  const { data: perfil } = await sb
    .from("usuarios")
    .select("nombre, rol, tenant, activo, aliado_id, acceso_legacy_nombre")
    .eq("id", user.id)
    .maybeSingle();

  const admin = createAdminClient();
  const { data: v } = await admin
    .from("ventas")
    .select("numero_contrato, cliente, destino, fecha_salida, precio_venta, moneda, modo_compra, comision_b2b, comision_estado, b2b_usuario_id, aliado_id, agencia_nombre, freelance_nombre, tipo_asesor, tenant")
    .eq("numero_contrato", numero)
    .maybeSingle();
  if (!v) return null;

  // Vía 1: flujo tarifario/reservar B2B (solo mayorista) — la comisión ya
  // queda en `ventas.comision_b2b`. Vía 2: comisión registrada en
  // `aliados_b2b` (manual, pestaña, o la que crea reservar) — único camino en
  // minorista. TODAS las filas del contrato, no solo la más reciente.
  const esVentasB2B = v.modo_compra === "comisionable" && !!v.comision_b2b;
  const { data: filasRaw } = await admin
    .from("aliados_b2b")
    .select("id, numero_contrato, aliado, nit, tipo_aliado, aliado_id, precio_venta, base_comision, base_explicita, comision_valor, pct_comision, recobro_total, pct_recobro_aliado, aplica_retencion, pct_retencion, estado, descontada_en_precio")
    .eq("numero_contrato", numero)
    .order("id", { ascending: true });
  const filas = (filasRaw ?? []) as FilaResolver[];
  // La decisión de ACCESO al contrato no cambia: la vía 2 usa, como siempre,
  // el aliado_id de la fila más reciente. Qué fila(s) se cobran se decide
  // después, por aliado (filasCobrables).
  const masReciente = filas.length > 0 ? filas[filas.length - 1] : null;
  if (!esVentasB2B && !masReciente) return null;

  const aliadoIdContrato = resolverAliadoIdContrato({
    esVentasB2B,
    aliadoIdVentas: (v.aliado_id as number | null) ?? null,
    aliadoIdComisionManual: esVentasB2B ? null : (masReciente?.aliado_id ?? null),
  });

  // La autorización de esta página NO la hace la RLS: se lee con service-role.
  // La decide `accesoDocumentoContrato`, compartida con el estado de cuenta.
  //
  // El id del aliado sale de donde esté: `ventas.aliado_id` en el flujo
  // tarifario B2B, o `aliados_b2b.aliado_id` en las comisiones cargadas a mano
  // (migración 133) — que es el único camino en minorista. Si ninguno de los
  // dos está puesto, queda null y solo entonces se mira el nombre.

  // ¿ALGUNA comisión manual del contrato tiene ficha? No solo la más reciente
  // (`aliadoB2B`): una fila vieja con `aliado_id` también es un vínculo por id.
  // Mismo verificador fail-closed que el portal: si falla, null = no se abre
  // por nombre.
  const fichas = await verificarFichasComisionManual([numero], consultarFichasSupabase(admin));

  const acceso = accesoDocumentoContrato(
    perfil
      ? {
          id: user.id,
          rol: perfil.rol as string | null,
          tenant: perfil.tenant as string | null,
          nombre: perfil.nombre as string | null,
          activo: (perfil.activo as boolean | null) ?? null,
          aliadoId: (perfil.aliado_id as number | null) ?? null,
          accesoLegacyNombre: (perfil.acceso_legacy_nombre as boolean | null) ?? null,
        }
      : null,
    {
      tenant: (v.tenant as string | null) ?? null,
      b2bUsuarioId: (v.b2b_usuario_id as string | null) ?? null,
      aliadoId: aliadoIdContrato,
      comisionManualConFicha: fichaDeContrato(fichas, numero),
      // SOLO los nombres de `ventas`, igual que el portal y el estado de
      // cuenta (migración 193). `aliados_b2b.aliado` es texto libre: se sigue
      // usando para MOSTRAR el nombre en la cuenta de cobro, nunca para
      // decidir quién la abre.
      nombreAliado: [v.agencia_nombre as string | null, v.freelance_nombre as string | null],
    }
  );
  if (!acceso.permitido) return null;
  const esInterno = acceso.esInterno;
  const esDueno = acceso.esDueno;

  // ── Qué comisión se cobra ───────────────────────────────────────────────
  // Abrir el contrato no da derecho a TODAS sus filas: una fila sin ficha
  // (aliado_id null) puede ser de otro beneficiario, y el texto libre del
  // beneficiario no lo desmiente (un homónimo escribe igual). Un aliado solo
  // cobra una fila sin ficha con el documento de SU ficha, o —solo si abrió el
  // contrato por el respaldo legacy por nombre— a su nombre (#38,
  // `filasCobrables` / `evidenciaSinFicha`; la misma regla que el portal).
  const aliadoIdPerfil = (perfil?.aliado_id as number | null) ?? null;
  let evidencia: EvidenciaSinFicha = { documento: null, nombreLegacy: null };
  if (!esInterno) {
    let documentoFicha: string | null = null;
    if (aliadoIdPerfil != null) {
      // Si la lectura falla, sin documento: falla cerrado.
      const { data: ficha, error: eFicha } = await admin.from("aliados").select("nit").eq("id", aliadoIdPerfil).maybeSingle();
      if (!eFicha) documentoFicha = (ficha as { nit: string | null } | null)?.nit ?? null;
    }
    evidencia = evidenciaSinFicha({ via: acceso.via, documentoFicha, nombreUsuario: (perfil?.nombre as string | null) ?? null });
  }
  const cobrables = filasCobrables(filas, v.comision_estado as string | null, {
    esInterno,
    aliadoId: aliadoIdPerfil,
    ...evidencia,
  });
  let fila: FilaResolver | null = null;
  if (cobrables.length > 0 || comisionId != null) {
    const eleccion = elegirFilaCobro(cobrables, comisionId);
    if (eleccion.tipo === "ninguna") return null;
    if (eleccion.tipo === "elegir") {
      return {
        tipo: "elegir",
        numeroContrato: v.numero_contrato,
        moneda: v.moneda ?? "COP",
        opciones: eleccion.filas.map((f) => ({ id: f.id, aliado: f.aliado, totalPagar: calcularComisionFila(f).totalPagar })),
      };
    }
    fila = eleccion.fila;
  } else if (!esVentasB2B || filas.some((f) => !esComisionDescontada(f, v.comision_estado as string | null))) {
    // Solo hay comisiones descontadas en el precio (modo neta) o de otro
    // aliado: nada que cobrar. Con filas vivas en aliados_b2b, ninguna suya,
    // tampoco se cae a `ventas.comision_b2b`: la fila es la fuente y ese
    // importe pudo corregirse después (#38; misma regla que el portal,
    // `comisionVisibleAliado`).
    return null;
  }

  const pvpVenta = v.precio_venta ?? 0;
  let detalle: DetalleComision;
  if (fila) {
    const c = calcularComisionFila(fila);
    detalle = {
      pvp: Number(fila.precio_venta) || 0,
      baseComisionable: c.baseUsada,
      pctComision: Number(fila.pct_comision) || 0,
      // Con "Ingresar por valor" el % guardado es solo informativo (redondeado).
      esPctEfectivo: fila.comision_valor != null,
      comisionBase: c.comisionBase,
      recobroAliado: c.recobroAliado,
      aplicaRetencion: fila.aplica_retencion,
      pctRetencion: fila.pct_retencion,
      retencion: c.retencion,
      totalPagar: c.totalPagar,
    };
  } else {
    detalle = {
      pvp: pvpVenta,
      baseComisionable: null,
      pctComision: pvpVenta > 0 ? Number(v.comision_b2b) / pvpVenta : 0,
      esPctEfectivo: true,
      comisionBase: null,
      recobroAliado: null,
      aplicaRetencion: null,
      pctRetencion: null,
      retencion: null,
      totalPagar: Number(v.comision_b2b),
    };
  }
  const nombreVentas = (v.freelance_nombre as string | null) || (v.agencia_nombre as string | null);
  const tipoAsesorEfectivo = fila
    ? (fila.tipo_aliado ?? (esVentasB2B ? (v.tipo_asesor as string | null) : null))
    : (v.tipo_asesor as string | null);
  const aliadoNombre = fila ? (fila.aliado || (esVentasB2B ? nombreVentas : null)) : nombreVentas;
  // Ficha bancaria: la de la comisión que se cobra (su aliado_id), con el
  // mismo resolvedor de siempre.
  const aliadoIdFicha = resolverAliadoIdContrato({
    esVentasB2B: esVentasB2B && !fila,
    aliadoIdVentas: (v.aliado_id as number | null) ?? null,
    aliadoIdComisionManual: fila?.aliado_id ?? null,
  });

  const aliado = aliadoNombre || perfil?.nombre || "";

  // ── Datos del aliado (documento, dirección, CUENTA BANCARIA) ────────────
  // Con `aliado_id` se lee por id, en los DOS flujos: el tarifario
  // (`ventas.aliado_id`) también lo tiene y antes no se usaba, solo el de
  // comisión manual. Sin id se cae al camino legacy, que exige coincidencia
  // exacta y una sola ficha — nunca `ilike` ni `limit(1)`, porque `%` y `_` son
  // comodines y un `limit(1)` sin orden elige un homónimo cualquiera. Esto sale
  // impreso en una cuenta de cobro: equivocarse es pagarle a otra persona.
  const COLS_ALIADO =
    "id, nombre, tipo_documento, nit, direccion, telefono, email, banco, tipo_cuenta, numero_cuenta";

  // Dos fases, SIN atajos: primero se cuenta (solo id+nombre, sin datos
  // bancarios) y solo si hay EXACTAMENTE una coincidencia normalizada se pide
  // su ficha completa. Una consulta puntual por nombre exacto puede devolver
  // una sola fila y aun así existir otra que solo difiera en mayúsculas o
  // espacios — por eso `listarIdsYNombres` siempre trae el catálogo entero,
  // nunca un resultado parcial que "ya encontró una" sin comprobar si hay más.
  const deps = {
    // Paginado por CURSOR (id ascendente), no por offset: PostgREST puede
    // limitar la cantidad máxima de filas por respuesta (Settings → API →
    // Max rows) por DEBAJO del tamaño de página pedido, y un `.range()`
    // fijo se daría por terminado en la primera página "incompleta" aunque
    // queden miles de filas más. Pidiendo siempre `id > cursor` no importa
    // cuánto decida devolver el servidor: solo una página VACÍA significa
    // que ya no hay más. Un error en cualquier página hace fallar toda la
    // resolución (no se confunde con "catálogo vacío").
    listarIdsYNombres: (): Promise<CandidatoAliado[]> =>
      listarTodosLosCandidatos({
        leerPagina: async (cursor, tamanoPagina) => {
          let q = admin.from("aliados").select("id, nombre").order("id", { ascending: true }).limit(tamanoPagina);
          if (cursor != null) q = q.gt("id", cursor);
          const { data, error } = await q;
          return { datos: (data as CandidatoAliado[] | null) ?? [], error };
        },
      }),
    buscarFichaPorId: async (id: number): Promise<FichaAliado | null> => {
      const { data } = await admin.from("aliados").select(COLS_ALIADO).eq("id", id).maybeSingle();
      return (data as FichaAliado | null) ?? null;
    },
  };

  const eleccionFicha = await resolverFichaAliado(deps, { aliadoIdContrato: aliadoIdFicha, nombre: aliadoNombre });
  const aliadoInfo: AliadoCatalogo | null = eleccionFicha.ficha;

  // Evidencia para el servidor cuando NO se pudo resolver. No se expone al
  // cliente ni se sustituye por una ficha "parecida".
  const aviso = explicarFicha(eleccionFicha, aliadoNombre);
  if (aviso) console.warn(`[cuenta de cobro ${v.numero_contrato}] ${aviso}`);

  return {
    tipo: "comision",
    numeroContrato: v.numero_contrato,
    cliente: v.cliente,
    destino: v.destino,
    fechaSalida: v.fecha_salida,
    moneda: v.moneda ?? "COP",
    tenant: v.tenant ?? "mayorista",
    aliado,
    aliadoInfo,
    tipoAsesorEfectivo,
    detalle,
    esInterno,
    esDueno,
    aliadoB2bId: fila?.id ?? null,
  };
}
