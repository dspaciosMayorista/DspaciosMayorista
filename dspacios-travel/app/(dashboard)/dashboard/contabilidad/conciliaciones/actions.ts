"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { getTenant } from "@/lib/tenant.server";
import { parseExtracto } from "@/lib/contabilidad/extracto";
import { postearAsiento, CUENTA } from "@/lib/contabilidad/asientos";

type Result = { ok: true; n?: number; aviso?: string } | { ok: false; error: string };

// Importa el extracto pegado del Excel (texto crudo).
export async function importarExtracto(texto: string, anio?: number, cuenta?: string): Promise<Result> {
  const sb = await createClient();
  const { lineas } = parseExtracto(texto, anio);
  if (!lineas.length) return { ok: false, error: "No se detectaron movimientos. Pega las filas del extracto (fecha, descripción, valor)." };
  const tenant = await getTenant();
  const filas = lineas.map((l) => ({
    fecha: l.fecha, descripcion: l.descripcion || null, valor: l.valor, saldo: l.saldo,
    periodo: l.periodo, cuenta: cuenta?.trim() || null, tenant,
  }));

  // Inserta en lotes y CUENTA lo que realmente quedó guardado (con
  // `.select("id")`) en vez de confiar en que "sin error" significa "se
  // guardaron todas" — antes el mensaje de éxito solo repetía cuántas líneas
  // se habían parseado, sin confirmar cuántas realmente llegaron a la base.
  const LOTE = 100;
  let insertadas = 0;
  let primerError: string | null = null;
  for (let i = 0; i < filas.length; i += LOTE) {
    const lote = filas.slice(i, i + LOTE);
    const { data, error } = await sb.from("conciliacion_extracto").insert(lote).select("id");
    if (error) { primerError = primerError ?? error.message; continue; }
    insertadas += data?.length ?? 0;
  }
  revalidatePath("/dashboard/contabilidad/conciliaciones");
  if (insertadas === 0) return { ok: false, error: primerError ?? "No se pudo importar ninguna línea." };
  if (insertadas < filas.length) {
    return {
      ok: true, n: insertadas,
      aviso: `Se detectaron ${filas.length} líneas válidas pero solo se guardaron ${insertadas}${primerError ? ` (error: ${primerError})` : ""}. Vuelve a pegar el resto o intenta de nuevo.`,
    };
  }
  return { ok: true, n: insertadas };
}

export async function eliminarLineaExtracto(id: number): Promise<Result> {
  const sb = await createClient();
  const { error } = await sb.from("conciliacion_extracto").delete().eq("id", id).is("conciliacion_id", null);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/dashboard/contabilidad/conciliaciones");
  return { ok: true };
}

// Borra en bloque (ej. un lote importado por error). Solo líneas no cruzadas.
export async function eliminarLineasExtracto(ids: number[]): Promise<Result> {
  if (!ids.length) return { ok: false, error: "Nada para borrar." };
  const sb = await createClient();
  const { error } = await sb.from("conciliacion_extracto").delete().in("id", ids).is("conciliacion_id", null);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/dashboard/contabilidad/conciliaciones");
  return { ok: true };
}

// Cruce MANUAL: N líneas de extracto contra M ítems del sistema. Las sumas
// (en valor absoluto) deben coincidir.
export async function cruzar(input: {
  extractoIds: number[];
  sistema: { ref: string; descripcion: string; fecha: string | null; valor: number; numeroContrato?: string | null }[];
  nota?: string;
  // El usuario confirma que la diferencia entre extracto y sistema NO es un
  // error: quedó (o salió) en efectivo, en caja, y nunca pasa por el banco
  // (ej. un abono en efectivo del que solo parte se consignó). En ese caso se
  // permite cruzar aunque las sumas no coincidan, siempre que quede la nota
  // explicando cuánto y por qué — el ítem del sistema se marca como conciliado
  // por su valor COMPLETO (no vuelve a aparecer pendiente).
  diferenciaCaja?: boolean;
}): Promise<Result> {
  const sb = await createClient();
  if (!input.extractoIds.length || !input.sistema.length) return { ok: false, error: "Selecciona al menos una línea de cada lado." };

  const { data: lineas } = await sb.from("conciliacion_extracto").select("id, valor, fecha, conciliacion_id").in("id", input.extractoIds);
  if (!lineas || lineas.length !== input.extractoIds.length) return { ok: false, error: "Alguna línea del extracto ya no existe." };
  if (lineas.some((l) => l.conciliacion_id != null)) return { ok: false, error: "Alguna línea ya está conciliada." };

  const totalExtracto = lineas.reduce((a, l) => a + Math.abs(Number(l.valor) || 0), 0);
  const totalSistema = input.sistema.reduce((a, s) => a + Math.abs(Number(s.valor) || 0), 0);
  if (Math.abs(totalExtracto - totalSistema) > 1) {
    if (!input.diferenciaCaja) {
      return { ok: false, error: `Las sumas no coinciden: extracto ${totalExtracto.toLocaleString("es-CO")} vs sistema ${totalSistema.toLocaleString("es-CO")}.` };
    }
    if (!input.nota?.trim()) {
      return { ok: false, error: "Si la diferencia queda en efectivo (caja), escribe una nota explicando cuánto y por qué." };
    }
  }

  // Fecha representativa del pago (la más antigua de las líneas cruzadas del
  // extracto) — se usa para auto-registrar el pago real de los "saldo-cxp:N".
  const fechaPago = lineas.map((l) => l.fecha as string).sort()[0] ?? new Date().toISOString().slice(0, 10);

  // "saldo-cxp:N" = saldo pendiente de proveedor SUGERIDO (pago hecho pero
  // nunca registrado en el sistema). Al cruzarlo, se registra el pago REAL
  // sobre la cuenta (mismo motor de dashboard/pagos) y el ref que queda en
  // conciliacion_sistema pasa a ser el del pago real ("pago:N:n") — así no
  // vuelve a aparecer por separado como pendiente de conciliar.
  let aviso: string | undefined;
  const sistemaFinal: typeof input.sistema = [];
  for (const s of input.sistema) {
    const m = /^saldo-cxp:(\d+)$/.exec(s.ref);
    if (!m) { sistemaFinal.push(s); continue; }
    const cuentaId = Number(m[1]);
    const { data: c } = await sb.from("cuentas_por_pagar").select("moneda, abono1, abono2, abono3").eq("id", cuentaId).maybeSingle();
    if (!c) { sistemaFinal.push(s); continue; }
    if ((c.moneda ?? "COP") === "USD") {
      aviso = "Alguna cuenta en USD no se pudo auto-registrar como pago (falta la TRM) — regístrala manual en Pagos a proveedores.";
      sistemaFinal.push(s);
      continue;
    }
    const libre = (v: number | null) => v == null || v === 0;
    let n: 1 | 2 | 3 | null = null;
    let upd: {
      abono1?: number; fecha_abono1?: string; trm1?: number;
      abono2?: number; fecha_abono2?: string; trm2?: number;
      abono3?: number; fecha_abono3?: string; trm3?: number;
    } = {};
    if (libre(c.abono1)) { n = 1; upd = { abono1: Math.abs(s.valor), fecha_abono1: fechaPago, trm1: 1 }; }
    else if (libre(c.abono2)) { n = 2; upd = { abono2: Math.abs(s.valor), fecha_abono2: fechaPago, trm2: 1 }; }
    else if (libre(c.abono3)) { n = 3; upd = { abono3: Math.abs(s.valor), fecha_abono3: fechaPago, trm3: 1 }; }
    if (!n) {
      aviso = "Alguna cuenta ya tenía 3 pagos registrados — no se pudo auto-registrar, hazlo manual en Pagos a proveedores.";
      sistemaFinal.push(s);
      continue;
    }
    const { error: eUpd } = await sb.from("cuentas_por_pagar").update(upd).eq("id", cuentaId);
    if (eUpd) { aviso = `No se pudo registrar el pago automático: ${eUpd.message}`; sistemaFinal.push(s); continue; }
    sistemaFinal.push({ ...s, ref: `pago:${cuentaId}:${n}`, fecha: fechaPago });
  }

  const tenant = await getTenant();
  const { data: conc, error: e1 } = await sb.from("conciliacion").insert({ nota: input.nota?.trim() || null, total: totalExtracto, tenant }).select("id").single();
  if (e1 || !conc) return { ok: false, error: e1?.message ?? "No se pudo crear el cruce." };

  const { error: e2 } = await sb.from("conciliacion_extracto").update({ conciliacion_id: conc.id }).in("id", input.extractoIds);
  if (e2) return { ok: false, error: e2.message };

  const { error: e3 } = await sb.from("conciliacion_sistema").insert(
    sistemaFinal.map((s) => ({
      conciliacion_id: conc.id, ref: s.ref, descripcion: s.descripcion || null, fecha: s.fecha, valor: s.valor,
      numero_contrato: s.numeroContrato || null,
    }))
  );
  if (e3) return { ok: false, error: e3.message };

  // Diferencia justificada en efectivo/caja: el abono/pago YA se pre-asentó
  // (Debe/Haber Caja o Bancos según su forma de pago) al registrarse — así que
  // conciliar NO vuelve a tocar Clientes/Anticipos/Proveedores. Solo
  // RECLASIFICA entre Caja y Bancos, corrigiendo cuál de las dos cuentas
  // realmente tenía el dinero: el pre-asiento asumió Bancos por defecto (salvo
  // forma de pago "efectivo"); si el banco confirma menos de lo esperado, esa
  // diferencia en realidad estaba (o se pagó) en Caja.
  if (input.diferenciaCaja && Math.abs(totalExtracto - totalSistema) > 1) {
    const esCartera = sistemaFinal.every((s) => s.valor >= 0);
    const dif = totalSistema - totalExtracto; // > 0 = el sistema registra más de lo que confirma el banco
    const avisarPosting = (msg: string) => { aviso = aviso ? `${aviso} También: ${msg}` : msg; };
    if (dif > 0) {
      const referencia = [...new Set(sistemaFinal.map((s) => s.numeroContrato).filter(Boolean))].join(", ") || undefined;
      const lineas = esCartera
        ? [ // cartera: se asumió que llegaba al banco, pero quedó (parte) en caja
            { cuentaCodigo: CUENTA.CAJA, tercero: referencia, descripcion: "Efectivo en caja (no consignado)", debe: dif, haber: 0 },
            { cuentaCodigo: CUENTA.BANCOS_COP, tercero: referencia, descripcion: "Reclasificación — no se consignó", debe: 0, haber: dif },
          ]
        : [ // proveedores: se pagó (parte) en efectivo en vez de salir del banco
            { cuentaCodigo: CUENTA.BANCOS_COP, tercero: referencia, descripcion: "Reclasificación — pagado en efectivo", debe: dif, haber: 0 },
            { cuentaCodigo: CUENTA.CAJA, tercero: referencia, descripcion: "Efectivo pagado (no salió del banco)", debe: 0, haber: dif },
          ];
      const asiento = await postearAsiento({
        fecha: fechaPago,
        descripcion: `Reclasificación Caja/Bancos — conciliación bancaria${input.nota ? `: ${input.nota.trim()}` : ""}`,
        origen: "conciliacion",
        referencia: `conciliacion:${conc.id}`,
        lineas,
      });
      if (!asiento.ok) avisarPosting(`el cruce quedó registrado, pero no se pudo generar el asiento contable automático: ${asiento.error}`);
    } else {
      avisarPosting("el cruce quedó registrado; el banco confirma más de lo que registra el sistema — revisa/registra ese ajuste manual en el Libro diario.");
    }
  }

  revalidatePath("/dashboard/contabilidad/conciliaciones");
  revalidatePath("/dashboard/contabilidad/libro-diario");
  revalidatePath("/dashboard/contabilidad/libro-auxiliar");
  revalidatePath("/dashboard/pagos");
  return { ok: true, aviso };
}

export async function deshacerCruce(conciliacionId: number): Promise<Result> {
  const sb = await createClient();
  await sb.from("conciliacion_extracto").update({ conciliacion_id: null }).eq("conciliacion_id", conciliacionId);
  // Si el cruce generó un asiento automático (diferencia en caja), lo borra
  // también — si no, quedaría un asiento contable huérfano de un cruce deshecho.
  await sb.from("asientos_contables").delete().eq("origen", "conciliacion").eq("referencia", `conciliacion:${conciliacionId}`);
  const { error } = await sb.from("conciliacion").delete().eq("id", conciliacionId); // cascade borra conciliacion_sistema
  if (error) return { ok: false, error: error.message };
  revalidatePath("/dashboard/contabilidad/conciliaciones");
  revalidatePath("/dashboard/contabilidad/libro-diario");
  revalidatePath("/dashboard/contabilidad/libro-auxiliar");
  return { ok: true };
}
