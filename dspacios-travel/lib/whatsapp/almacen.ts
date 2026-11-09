import "server-only";

// Almacén del canal WhatsApp sobre Supabase con service-role (las tablas de la migración 269 no tienen policies: solo el servidor las
// toca). Guarda el ESTADO del flujo (datos de la consulta ya saneados), nunca el texto que escribió el cliente.
// Toda operación LANZA si la base falla: el turno lo trata como «reintentar», nunca como «ya atendido».
// Las operaciones de concurrencia (turno, avance de sesión, reclamo de avisos) son UNA sola sentencia condicional cada una:
// la base decide el ganador; nunca se lee para luego escribir.
import { createAdminClient } from "@/lib/supabase/admin";
import { estadoInicial, sanearEstado } from "@/lib/salesbot/conversacion/contrato";
import { cedeAlPrevio, decidirReclamo, type Almacen, type AvisoPendiente, type Registro, type Resultado, type SesionWA } from "@/lib/whatsapp/turno";

// Las tablas son de la migración 269 y aún no están en types/database.ts.
type Tabla = { from(t: string): any }; // eslint-disable-line @typescript-eslint/no-explicit-any
const db = () => createAdminClient() as unknown as Tabla;
const COLS = "mensaje_id, wa_id, estado, intentos, lease_hasta, primer_recibo, resultado, enviados";
const EPOCA = new Date(0).toISOString();
/** Valor entre comillas para un filtro `or=` de PostgREST. */
const citar = (v: string) => `"${v.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
const falla = (etapa: string, error: { code?: string } | null) => new Error(`${etapa}:${error?.code ?? "?"}`);

/** El jsonb viene de nuestra propia base, pero se revalida: algo ilegible se trata como «sin calcular» y se recalcula. */
function leerResultado(v: unknown): Resultado | null {
  if (!v || typeof v !== "object") return null;
  const o = v as { sesion?: { estado?: unknown; traspasoHasta?: unknown; actualizada?: unknown } | null; mensajes?: unknown; traspaso?: Resultado["traspaso"] };
  if (!Array.isArray(o.mensajes)) return null;
  const s = o.sesion;
  const sesion: SesionWA | null = s && typeof s.actualizada === "string" ? { estado: sanearEstado(s.estado), traspasoHasta: typeof s.traspasoHasta === "string" ? s.traspasoHasta : null, actualizada: s.actualizada } : null;
  const t = o.traspaso;
  const traspaso = t && typeof t.waId === "string" ? { waId: t.waId, nombrePerfil: typeof t.nombrePerfil === "string" ? t.nombrePerfil : null, resumen: t.resumen && typeof t.resumen === "object" ? t.resumen : {} } : null;
  return { sesion, mensajes: o.mensajes as Resultado["mensajes"], traspaso };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const aRegistro = (f: any): Registro => ({ id: f.mensaje_id, waId: f.wa_id, intentos: f.intentos, primerRecibo: f.primer_recibo, resultado: leerResultado(f.resultado), enviados: f.enviados });

export function almacenSupabase(): Almacen {
  return {
    async reclamar(id, waId, ts, ahora, leaseMs) {
      const lease = new Date(ahora.getTime() + leaseMs).toISOString();
      const ins = await db().from("salesbot_wa_mensajes").insert({ mensaje_id: id, wa_id: waId, ts, lease_hasta: lease, primer_recibo: ahora.toISOString() }).select(COLS).maybeSingle();
      if (!ins.error) return { tipo: "listo", registro: aRegistro(ins.data) };
      if (ins.error.code !== "23505") throw falla("reclamar", ins.error);
      const { data: fila, error } = await db().from("salesbot_wa_mensajes").select(COLS).eq("mensaje_id", id).maybeSingle();
      if (error || !fila) throw falla("reclamar_leer", error);
      const decision = decidirReclamo({ estado: fila.estado, leaseHasta: fila.lease_hasta }, ahora);
      if (decision !== "retomar") return { tipo: decision };
      // Compare-and-swap sobre el lease que vimos: si otro lo retomó antes, aquí no se actualiza nada y se cede.
      const upd = await db()
        .from("salesbot_wa_mensajes")
        .update({ lease_hasta: lease, intentos: fila.intentos + 1, actualizado: ahora.toISOString() })
        .eq("mensaje_id", id)
        .eq("estado", "procesando")
        .eq("lease_hasta", fila.lease_hasta)
        .select(COLS)
        .maybeSingle();
      if (upd.error) throw falla("reclamar_retomar", upd.error);
      return upd.data ? { tipo: "listo", registro: aRegistro(upd.data) } : { tipo: "ocupado" };
    },
    async devolver(id, intentos) {
      const { error } = await db().from("salesbot_wa_mensajes").update({ lease_hasta: EPOCA, intentos }).eq("mensaje_id", id).eq("estado", "procesando");
      if (error) throw falla("devolver", error);
    },
    async tomarTurno(waId, id, ts, ahora, leaseMs, ventanaMs) {
      // Compuerta de orden: un mensaje anterior del mismo cliente todavía en curso pasa primero.
      const { data: previos, error: ePrev } = await db()
        .from("salesbot_wa_mensajes")
        .select("mensaje_id, ts, primer_recibo")
        .eq("wa_id", waId)
        .eq("estado", "procesando")
        .neq("mensaje_id", id)
        .gt("primer_recibo", new Date(ahora.getTime() - ventanaMs).toISOString());
      if (ePrev) throw falla("turno_previos", ePrev);
      const { data: yo, error: eYo } = await db().from("salesbot_wa_mensajes").select("primer_recibo").eq("mensaje_id", id).maybeSingle();
      if (eYo || !yo) throw falla("turno_propio", eYo);
      const mio = { id, ts, primerRecibo: yo.primer_recibo };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if ((previos ?? []).some((p: any) => cedeAlPrevio({ id: p.mensaje_id, ts: p.ts, primerRecibo: p.primer_recibo }, mio, ahora, ventanaMs))) return "turno_previo";

      const lease = new Date(ahora.getTime() + leaseMs).toISOString();
      // Cliente nuevo: fila de reserva (sin sesión vigente) ya con el turno tomado. Gana una sola inserción.
      const ins = await db().from("salesbot_wa_sesiones").insert({ wa_id: waId, estado: estadoInicial(), actualizada: EPOCA, lock_por: id, lock_hasta: lease }).select("wa_id").maybeSingle();
      if (!ins.error) return "ok";
      if (ins.error.code !== "23505") throw falla("turno_crear", ins.error);
      // Cliente existente: una sentencia —libre, vencido o ya mío— decide el ganador.
      const upd = await db()
        .from("salesbot_wa_sesiones")
        .update({ lock_por: id, lock_hasta: lease })
        .eq("wa_id", waId)
        // El id viene de Meta (firmado) pero se cita igual: una coma o un paréntesis en él no puede cambiar el filtro.
        .or(`lock_hasta.is.null,lock_hasta.lte.${ahora.toISOString()},lock_por.eq.${citar(id)}`)
        .select("wa_id")
        .maybeSingle();
      if (upd.error) throw falla("turno_tomar", upd.error);
      return upd.data ? "ok" : "ocupado";
    },
    async soltarTurno(waId, id) {
      const { error } = await db().from("salesbot_wa_sesiones").update({ lock_por: null, lock_hasta: null }).eq("wa_id", waId).eq("lock_por", id);
      if (error) throw falla("turno_soltar", error);
    },
    async avanzarSesion(waId, id, ts, s) {
      // UNA sentencia: sigo siendo el dueño del turno Y mi mensaje no es más viejo que el último aplicado.
      const upd = await db()
        .from("salesbot_wa_sesiones")
        .update({ estado: s.estado, traspaso_hasta: s.traspasoHasta, actualizada: s.actualizada, ultimo_ts: ts, ultimo_mensaje: id })
        .eq("wa_id", waId)
        .eq("lock_por", id)
        .lte("ultimo_ts", ts)
        .select("wa_id")
        .maybeSingle();
      if (upd.error) throw falla("avanzar_sesion", upd.error);
      if (upd.data) return "ok";
      // No escribió: se distingue por qué (solo clasificación de un fallo ya atómico).
      const { data, error } = await db().from("salesbot_wa_sesiones").select("lock_por, ultimo_ts").eq("wa_id", waId).maybeSingle();
      if (error) throw falla("avanzar_clasificar", error);
      return data && data.lock_por === id && data.ultimo_ts > ts ? "obsoleta" : "perdido";
    },
    async guardarResultado(id, r) {
      const { error } = await db().from("salesbot_wa_mensajes").update({ resultado: r, actualizado: new Date().toISOString() }).eq("mensaje_id", id);
      if (error) throw falla("guardar_resultado", error);
    },
    async registrarEnvio(id, enviados) {
      const { error } = await db().from("salesbot_wa_mensajes").update({ enviados, actualizado: new Date().toISOString() }).eq("mensaje_id", id);
      if (error) throw falla("registrar_envio", error);
    },
    async cerrar(id, estado) {
      const { error } = await db().from("salesbot_wa_mensajes").update({ estado, actualizado: new Date().toISOString() }).eq("mensaje_id", id);
      if (error) throw falla("cerrar", error);
    },
    async leerSesion(waId): Promise<SesionWA | null> {
      const { data, error } = await db().from("salesbot_wa_sesiones").select("estado, traspaso_hasta, actualizada").eq("wa_id", waId).maybeSingle();
      if (error) throw falla("leer_sesion", error);
      return data ? { estado: sanearEstado(data.estado), traspasoHasta: data.traspaso_hasta, actualizada: data.actualizada } : null;
    },
    async guardarTraspaso(t, mensajeId) {
      const ins = await db().from("salesbot_wa_traspasos").insert({ mensaje_id: mensajeId, wa_id: t.waId, nombre_perfil: t.nombrePerfil, resumen: t.resumen }).select("id, avisado_en").maybeSingle();
      if (!ins.error) return { id: ins.data.id, avisado: !!ins.data.avisado_en };
      if (ins.error.code !== "23505") throw falla("guardar_traspaso", ins.error);
      // Reintento del mismo mensaje: la solicitud ya existe, no se duplica.
      const { data, error } = await db().from("salesbot_wa_traspasos").select("id, avisado_en").eq("mensaje_id", mensajeId).maybeSingle();
      if (error || !data) throw falla("guardar_traspaso_leer", error);
      return { id: data.id, avisado: !!data.avisado_en };
    },
    async liberar(id) {
      const { error } = await db().from("salesbot_wa_mensajes").update({ lease_hasta: EPOCA }).eq("mensaje_id", id).eq("estado", "procesando");
      if (error) throw falla("liberar", error);
    },
    async marcarAvisado(id, ahora) {
      const { error } = await db().from("salesbot_wa_traspasos").update({ avisado_en: ahora.toISOString() }).eq("id", id);
      if (error) throw falla("marcar_avisado", error);
    },
    async reclamarAvisosPendientes(ahora, limite, leaseMs, gracias) {
      const { data, error } = await db()
        .from("salesbot_wa_traspasos")
        .select("id, mensaje_id, wa_id, nombre_perfil, resumen, aviso_intentos, aviso_proximo")
        .is("avisado_en", null)
        .lte("creado", gracias.toISOString())
        .or(`aviso_proximo.is.null,aviso_proximo.lte.${ahora.toISOString()}`)
        .order("creado", { ascending: true })
        .limit(limite);
      if (error) throw falla("avisos_listar", error);
      const ganados: AvisoPendiente[] = [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const f of (data ?? []) as any[]) {
        // Compare-and-set por fila sobre el `aviso_proximo` que vimos: de dos corridas simultáneas, una sola gana cada traspaso.
        let q = db()
          .from("salesbot_wa_traspasos")
          .update({ aviso_proximo: new Date(ahora.getTime() + leaseMs).toISOString(), aviso_intentos: f.aviso_intentos + 1 })
          .eq("id", f.id)
          .is("avisado_en", null);
        q = f.aviso_proximo === null ? q.is("aviso_proximo", null) : q.eq("aviso_proximo", f.aviso_proximo);
        const { data: ok, error: e2 } = await q.select("id").maybeSingle();
        if (e2) throw falla("avisos_reclamar", e2);
        if (ok) ganados.push({ id: f.id, waId: f.wa_id, nombrePerfil: f.nombre_perfil, resumen: f.resumen ?? {}, intentos: f.aviso_intentos + 1 });
      }
      return ganados;
    },
    async registrarFalloAviso(id, proximo) {
      const { error } = await db().from("salesbot_wa_traspasos").update({ aviso_proximo: proximo.toISOString() }).eq("id", id).is("avisado_en", null);
      if (error) throw falla("avisos_fallo", error);
    },
  };
}
