/**
 * #98 — Cuenta de cobro: versión congelada (snapshot), hash, clave y reglas puras de quién puede firmar. Sin acceso a datos.
 *
 * Una «versión» = TODO lo que el documento imprime (importes, %, retención, concepto, identidad y datos bancarios del aliado, emisor). Si cualquiera cambia, el hash
 * cambia: hay versión nueva y requiere aceptación nueva. La fecha de elaboración NO entra al hash (si no, cada día sería una versión distinta).
 * La aceptación es ELECTRÓNICA (imagen de firma + evento registrado); nunca se presenta como firma digital certificada.
 */
import { createHash } from "node:crypto";
import type { ComisionResuelta, DetalleComision } from "@/lib/finanzas/comisionResolver";

export const TAM_MAX_FIRMA = 512 * 1024;

export type SnapshotCuenta = {
  v: 1;
  clave: string;
  numeroContrato: string;
  concepto: string;
  fechaSalida: string | null;
  moneda: string;
  /** Día de la vista sin firmar; en una versión aceptada, el día de la aceptación (congelado). NO entra al hash. */
  elaboracion: string;
  aliado: {
    id: number | null;
    nombre: string;
    tipoDocumento: string | null;
    nit: string | null;
    direccion: string | null;
    telefono: string | null;
    email: string | null;
    titularCuenta: string | null;
    banco: string | null;
    tipoCuenta: string | null;
    numeroCuenta: string | null;
  };
  compania: { nombre: string; nit: string | null; direccion: string | null };
  detalle: DetalleComision;
};

/** Qué comisión se firma: la fila de `aliados_b2b` o, sin fila (flujo tarifario), la vida del contrato (`contrato_uid`, estable aunque el número se reutilice). */
export function claveCuenta(r: Pick<ComisionResuelta, "aliadoB2bId" | "contratoUid">): string | null {
  if (r.aliadoB2bId != null) return `ab:${r.aliadoB2bId}`;
  return r.contratoUid ? `cu:${r.contratoUid}` : null;
}

export function construirSnapshot(
  r: ComisionResuelta,
  compania: { nombre: string; nit: string | null; direccion: string | null },
  elaboracion: string,
): SnapshotCuenta {
  // Sin clave (sin fila en aliados_b2b ni contrato_uid) el documento se dibuja igual, pero con clave vacía: no se puede aceptar (`puedeFirmar` → sin_clave).
  const a = r.aliadoInfo;
  return {
    v: 1,
    clave: claveCuenta(r) ?? "",
    numeroContrato: r.numeroContrato,
    concepto: `Comisión por venta — Contrato ${r.numeroContrato} — Cliente ${r.cliente}${r.destino ? ` — Destino ${r.destino}` : ""}`,
    fechaSalida: r.fechaSalida,
    moneda: r.moneda,
    elaboracion,
    aliado: {
      id: a?.id ?? null,
      nombre: r.aliado,
      tipoDocumento: a?.tipo_documento ?? null,
      nit: a?.nit ?? null,
      direccion: a?.direccion ?? null,
      telefono: a?.telefono ?? null,
      email: a?.email ?? null,
      titularCuenta: a?.nombre ?? null,
      banco: a?.banco ?? null,
      tipoCuenta: a?.tipo_cuenta ?? null,
      numeroCuenta: a?.numero_cuenta ?? null,
    },
    compania,
    detalle: { ...r.detalle },
  };
}

// JSON canónico: llaves ordenadas, sin `undefined`. El mismo contenido da siempre el mismo hash.
function canonico(x: unknown): string {
  if (x === null || typeof x !== "object") return JSON.stringify(x === undefined ? null : x);
  if (Array.isArray(x)) return `[${x.map(canonico).join(",")}]`;
  const o = x as Record<string, unknown>;
  return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonico(o[k])}`).join(",")}}`;
}

export function hashSnapshot(s: SnapshotCuenta): string {
  const { elaboracion: _omitida, ...contenido } = s;
  return createHash("sha256").update(canonico(contenido)).digest("hex");
}

export type MotivoNoFirma = "interno" | "no_dueno" | "agencia" | "no_freelance" | "sin_ficha" | "ficha_distinta" | "ficha_compartida" | "sin_clave" | "sin_aliado";

/**
 * ¿Quién ACEPTA? Solo el aliado freelance dueño del documento (la agencia factura electrónicamente; el personal interno nunca acepta en nombre del aliado).
 * `ctx` sale de `cargarContextoEdicion` (sesión → usuarios → ficha): misma regla que la edición del perfil (titular activo, ficha no compartida).
 */
export function puedeFirmar(
  r: Pick<ComisionResuelta, "esInterno" | "esDueno" | "tipoAsesorEfectivo" | "aliadoInfo" | "aliadoB2bId" | "contratoUid">,
  ctx: { valido: boolean; tipo: "agencia" | "freelance" | null; puedeFicha: boolean; motivoFicha: string | null; aliadoId: number | null } | null,
): { ok: true; aliadoId: number } | { ok: false; motivo: MotivoNoFirma } {
  if (r.esInterno) return { ok: false, motivo: "interno" };
  if (!r.esDueno) return { ok: false, motivo: "no_dueno" };
  if (r.tipoAsesorEfectivo === "agencia") return { ok: false, motivo: "agencia" };
  if (!claveCuenta(r)) return { ok: false, motivo: "sin_clave" };
  const idFicha = r.aliadoInfo?.id ?? null;
  if (idFicha == null) return { ok: false, motivo: "sin_aliado" };
  if (!ctx || !ctx.valido || ctx.tipo !== "freelance") return { ok: false, motivo: "no_freelance" };
  if (ctx.aliadoId == null) return { ok: false, motivo: "sin_ficha" };
  if (ctx.aliadoId !== idFicha) return { ok: false, motivo: "ficha_distinta" };
  if (!ctx.puedeFicha) return { ok: false, motivo: "ficha_compartida" };
  return { ok: true, aliadoId: idFicha };
}

export const MENSAJE_NO_FIRMA: Record<MotivoNoFirma, string> = {
  interno: "El personal de la agencia no acepta en nombre del aliado.",
  no_dueno: "Solo el aliado dueño de esta cuenta de cobro puede aceptarla.",
  agencia: "Las agencias facturan electrónicamente; no aceptan cuentas de cobro.",
  no_freelance: "Solo un aliado freelance puede aceptar una cuenta de cobro.",
  sin_ficha: "Tu cuenta aún no está enlazada a una ficha de aliado. Contacta a tu asesor.",
  ficha_distinta: "Esta cuenta de cobro no corresponde a tu ficha de aliado.",
  ficha_compartida: "Tu ficha la comparte otra cuenta. Contacta a tu asesor para firmar.",
  sin_clave: "No se pudo identificar la comisión de esta cuenta de cobro.",
  sin_aliado: "No se pudo identificar la ficha del aliado de esta cuenta de cobro.",
};

// ── Imagen de firma ─────────────────────────────────────────────────────
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPG = [0xff, 0xd8, 0xff];
const empieza = (b: Uint8Array, firma: number[]) => b.length >= firma.length && firma.every((x, i) => b[i] === x);

/** El tipo se decide por los PRIMEROS BYTES, no por el nombre ni por el tipo que declara el navegador. SVG/GIF/PDF se rechazan. */
export function validarImagenFirma(bytes: Uint8Array, mimeDeclarado: string | null | undefined): { ok: true; mime: "image/png" | "image/jpeg"; extension: "png" | "jpg" } | { ok: false; error: string } {
  if (!bytes || bytes.length === 0) return { ok: false, error: "Elige una imagen de tu firma." };
  if (bytes.length > TAM_MAX_FIRMA) return { ok: false, error: "La imagen no puede superar 512 KB." };
  const mime = empieza(bytes, PNG) ? "image/png" : empieza(bytes, JPG) ? "image/jpeg" : null;
  if (!mime) return { ok: false, error: "Solo se aceptan imágenes PNG o JPG." };
  if (mimeDeclarado && mimeDeclarado !== mime) return { ok: false, error: "El archivo no coincide con su tipo de imagen. Usa un PNG o JPG real." };
  return { ok: true, mime, extension: mime === "image/png" ? "png" : "jpg" };
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Qué versión aceptada se dibuja: la pedida por `?v=` si existe; si no, la que tiene EXACTAMENTE el contenido vigente (aunque no sea la última: volver a un
 * contenido ya aceptado lo reconoce, no crea otra versión); si no hay ninguna, null = la vigente se muestra SIN aceptar.
 */
export function elegirVersion<T extends { version: number; snapshot_hash: string }>(filas: T[], hashVivo: string, v: string | null | undefined): T | null {
  const pedida = v && /^\d+$/.test(v) ? filas.find((f) => f.version === Number(v)) ?? null : null;
  return pedida ?? filas.find((f) => f.snapshot_hash === hashVivo) ?? null;
}
