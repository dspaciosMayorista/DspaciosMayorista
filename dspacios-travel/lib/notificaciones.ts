import { createAdminClient } from "@/lib/supabase/admin";
import { enviarEmail } from "@/lib/email/resend";

function fmtCOP(n: number): string {
  return "$ " + Math.round(n || 0).toLocaleString("es-CO");
}

type Fila = { c1: string; c2: string; c3: string };
type Seccion = { titulo: string; cols: [string, string, string]; filas: Fila[] };

// Recopila las fechas límite próximas (dentro de `dias`) para el digest.
async function recopilar(dias: number, flags: { cxp: boolean; cuotas: boolean; bloqueos: boolean }): Promise<Seccion[]> {
  const admin = createAdminClient();
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
  const limite = new Date(hoy); limite.setDate(limite.getDate() + Math.max(0, dias));
  const hoyISO = hoy.toISOString().slice(0, 10);
  const limISO = limite.toISOString().slice(0, 10);
  const secciones: Seccion[] = [];

  if (flags.cxp) {
    const { data } = await admin.from("cuentas_por_pagar")
      .select("numero_contrato, proveedor, servicio, valor_total, fecha_vencimiento")
      .not("fecha_vencimiento", "is", null).lte("fecha_vencimiento", limISO).order("fecha_vencimiento");
    const filas = (data ?? []).map((r) => ({
      c1: `${r.fecha_vencimiento}${r.fecha_vencimiento! < hoyISO ? " ⚠ vencida" : ""}`,
      c2: `${r.proveedor ?? "—"} · ${r.servicio ?? ""} (${r.numero_contrato})`,
      c3: fmtCOP(r.valor_total ?? 0),
    }));
    if (filas.length) secciones.push({ titulo: "Pagos a proveedores (CxP) por vencer", cols: ["Vence", "Proveedor / servicio", "Valor"], filas });
  }

  if (flags.cuotas) {
    const { data } = await admin.from("cuotas")
      .select("numero_contrato, tipo, fecha_limite, monto")
      .lte("fecha_limite", limISO).order("fecha_limite");
    const filas = (data ?? []).map((r) => ({
      c1: `${r.fecha_limite}${r.fecha_limite < hoyISO ? " ⚠ vencida" : ""}`,
      c2: `${r.tipo === "abono" ? "Abono" : r.tipo === "total" ? "Pago total" : "Cuota"} · ${r.numero_contrato}`,
      c3: fmtCOP(r.monto ?? 0),
    }));
    if (filas.length) secciones.push({ titulo: "Cobros a clientes por vencer", cols: ["Vence", "Concepto", "Monto"], filas });
  }

  if (flags.bloqueos) {
    const { data } = await admin.from("bloqueos_vuelo")
      .select("record, aerolinea, ruta, fecha_devolucion, fecha_emision")
      .or(`fecha_devolucion.lte.${limISO},fecha_emision.lte.${limISO}`);
    const filas = (data ?? [])
      .filter((b) => (b.fecha_devolucion && b.fecha_devolucion <= limISO) || (b.fecha_emision && b.fecha_emision <= limISO))
      .map((b) => ({
        c1: `${b.record ?? "—"} · ${b.aerolinea ?? ""}`,
        c2: b.ruta ?? "",
        c3: [b.fecha_devolucion ? `Devolución ${b.fecha_devolucion}` : "", b.fecha_emision ? `Emisión ${b.fecha_emision}` : ""].filter(Boolean).join(" · "),
      }));
    if (filas.length) secciones.push({ titulo: "Bloqueos: devolución / emisión", cols: ["Record", "Ruta", "Fechas"], filas });
  }

  return secciones;
}

function html(secciones: Seccion[], dias: number): string {
  const T = "#1D7C9A";
  const bloques = secciones.map((s) => `
    <h3 style="color:${T};font-size:15px;margin:18px 0 6px">${s.titulo}</h3>
    <table style="width:100%;border-collapse:collapse;font-size:13px">
      <tr style="background:#f3f4f6;text-align:left">
        ${s.cols.map((c) => `<th style="padding:6px 8px;color:#6b7280;font-weight:600">${c}</th>`).join("")}
      </tr>
      ${s.filas.map((f) => `<tr style="border-top:1px solid #eee">
        <td style="padding:6px 8px">${f.c1}</td><td style="padding:6px 8px">${f.c2}</td><td style="padding:6px 8px;text-align:right">${f.c3}</td>
      </tr>`).join("")}
    </table>`).join("");
  return `<div style="font-family:Arial,Helvetica,sans-serif;max-width:680px;margin:auto;color:#374151">
    <div style="background:${T};color:#fff;padding:16px 20px;border-radius:10px 10px 0 0">
      <div style="font-size:18px;font-weight:bold">D'spacios Travel</div>
      <div style="font-size:12px;opacity:.85">Alertas operativas · próximos ${dias} días</div>
    </div>
    <div style="border:1px solid #eee;border-top:none;padding:16px 20px;border-radius:0 0 10px 10px">
      ${secciones.length ? bloques : "<p>No hay fechas límite próximas. 🎉</p>"}
      <p style="color:#9ca3af;font-size:11px;margin-top:20px">Notificación automática del sistema D'spacios Travel.</p>
    </div>
  </div>`;
}

// Arma y envía el digest de alertas a los destinatarios configurados.
export async function enviarNotificaciones(opts?: { forzar?: boolean }): Promise<{ ok: boolean; enviado?: boolean; error?: string }> {
  const admin = createAdminClient();
  const { data: cfg } = await admin.from("config_notificaciones").select("*").eq("id", 1).maybeSingle();
  if (!cfg) return { ok: false, error: "Sin configuración de notificaciones." };
  if (!cfg.activo && !opts?.forzar) return { ok: true, enviado: false };
  const destinatarios = (cfg.destinatarios ?? "").split(",").map((e) => e.trim()).filter(Boolean);
  if (!destinatarios.length) return { ok: false, error: "No hay destinatarios configurados." };

  const secciones = await recopilar(cfg.dias_anticipacion ?? 5, {
    cxp: cfg.alerta_cxp, cuotas: cfg.alerta_cuotas, bloqueos: cfg.alerta_bloqueos,
  });
  if (!secciones.length && !opts?.forzar) return { ok: true, enviado: false };

  const r = await enviarEmail({
    from: cfg.remitente,
    to: destinatarios,
    subject: `D'spacios Travel · Alertas operativas (${new Date().toISOString().slice(0, 10)})`,
    html: html(secciones, cfg.dias_anticipacion ?? 5),
  });
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true, enviado: true };
}
