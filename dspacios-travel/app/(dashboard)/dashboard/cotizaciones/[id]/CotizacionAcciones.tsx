"use client";

import { DateInput } from "@/components/ui/DateInput";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { calcularEdad } from "@/lib/utils";
import { MENSAJE_TRM_PROVISIONAL_REQUERIDA_63, trmValida90 } from "@/lib/reservar/monedaPublicacion90";
import { totalCobroConvertido, validarEleccionCobro } from "@/lib/finanzas/cobro";
import { formatMoneda } from "@/lib/utils";
import { convertirCotizacion, descartarCotizacion } from "../../reservar/actions";
import { type PasajeroReserva } from "@/lib/reservar/computo";
import { OpcionesTipoDoc } from "@/components/personas/OpcionesTipoDoc";
import { documentoPasajeroDesdeCliente } from "@/lib/personas/tiposDocumento";
import { BuscarPasajeroDocumento } from "@/components/pasajeros/BuscarPasajeroDocumento";

type ClientePrefill = { nombres: string; apellidos: string; tipoDoc: string; numeroDoc: string };


export function CotizacionAcciones({
  id, pax, infantes, tienePasajeros, cliente, esSuperadmin, asesores, miNombre, miRolVenta, pideTrmProvisional = false,
  permiteMonedaCobro = false, monedaOferta = "COP", totalOferta = 0,
}: {
  id: number; pax: number; infantes: number; tienePasajeros: boolean; cliente: ClientePrefill; esSuperadmin: boolean;
  asesores: { nombre: string; email: string | null }[];
  miNombre: string; miRolVenta: boolean;
  /** Oferta en USD sin TRM: al convertir a contrato se captura la TRM provisional (pesos por dólar). */
  pideTrmProvisional?: boolean;
  /** 235 (#90 F): oferta con conversión por TRM y usuario interno: puede elegir en qué moneda se COBRA el contrato. */
  permiteMonedaCobro?: boolean;
  /** Moneda e importe de la OFERTA (que no cambian); el total convertido que se muestra es solo una vista previa: la base lo calcula y congela. */
  monedaOferta?: string;
  totalOferta?: number;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");
  const [confirmarDescarte, setConfirmarDescarte] = useState(false);
  const [capturando, setCapturando] = useState(false);
  const [trmProv, setTrmProv] = useState("");
  // Solo aplica a una oferta USD sin TRM: ahí la tasa es OBLIGATORIA (campo vacío = no se convierte) y debe ser un número positivo.
  const trmProvisional = (): { ok: true; valor: number | null } | { ok: false; error: string } => {
    if (!pideTrmProvisional) return { ok: true, valor: null };
    if (trmProv.trim() === "") return { ok: false, error: MENSAJE_TRM_PROVISIONAL_REQUERIDA_63 };
    // Mismo criterio que el servidor y la base (finita, > 0 con 4 decimales y < 1e11): lo inválido no llega a numerar nada.
    const n = trmValida90(trmProv.replace(",", "."));
    return n != null && Math.round(n * 10000) > 0 ? { ok: true, valor: n } : { ok: false, error: "La TRM provisional debe ser un número positivo (pesos por dólar)." };
  };
  // 235: moneda de COBRO, OBLIGATORIA y expresa (sin valor por defecto): hay que elegir COP o USD antes de generar el contrato, también cuando es la
  // misma de la oferta (entonces no hay conversión). Si se elige la otra, la TRM de cobro es OBLIGATORIA y se ingresa aquí (no se reutiliza la de
  // publicación ni la de referencia); el total convertido se calcula y congela UNA vez al contratar.
  const [monedaCobro, setMonedaCobro] = useState("");
  const [trmCobro, setTrmCobro] = useState("");
  const cobroDistinto = permiteMonedaCobro && monedaCobro !== "" && monedaCobro !== monedaOferta;
  const trmCobroNum = trmCobro.trim() === "" ? null : trmValida90(trmCobro.replace(",", "."));
  const vistaPreviaCobro = cobroDistinto ? totalCobroConvertido(totalOferta, monedaOferta, monedaCobro, trmCobroNum) : null;
  const eleccionCobro = (): { ok: true; monedaCobro: string | null; trmCobro: number | null } | { ok: false; error: string } => {
    if (!permiteMonedaCobro) return { ok: true, monedaCobro: null, trmCobro: null };
    const r = validarEleccionCobro({ monedaOferta, monedaCobro: monedaCobro || null, trmCobro: cobroDistinto ? trmCobro : null, esInterno: true });
    return r.ok ? { ok: true, monedaCobro: r.monedaCobro, trmCobro: r.trmCobro } : r;
  };
  // Si quien gestiona es asesor de ventas, se autollena con su usuario.
  const [asesorSel, setAsesorSel] = useState(miRolVenta ? miNombre : "");
  const asesorBloqueado = miRolVenta && !esSuperadmin; // solo superadmin lo cambia

  const total = Math.max(1, pax || 1);
  const [paxRows, setPaxRows] = useState<PasajeroReserva[]>(() =>
    Array.from({ length: total }, (_, i) => ({
      nombres: i === 0 ? cliente.nombres : "",
      apellidos: i === 0 ? cliente.apellidos : "",
      ...(i === 0 ? documentoPasajeroDesdeCliente(cliente.tipoDoc || "CC", cliente.numeroDoc) : { tipoDoc: "CC", numeroDoc: "" }),
      fechaNacimiento: "",
      nacionalidad: "Colombiana",
      esInfante: i >= total - Math.max(0, infantes),
    }))
  );

  const setRow = (i: number, k: keyof PasajeroReserva, v: string) =>
    setPaxRows((rows) => rows.map((r, n) => (n === i ? { ...r, [k]: v } : r)));

  function convertirDirecto() {
    const t = trmProvisional();
    if (!t.ok) { setErr(t.error); return; }
    const cb = eleccionCobro();
    if (!cb.ok) { setErr(cb.error); return; }
    setErr("");
    start(async () => {
      const r = await convertirCotizacion(id, undefined, undefined, undefined, t.valor, cb.monedaCobro, cb.trmCobro);
      if (r.ok) {
        if (r.advertencias?.length) window.alert(`Contrato creado, pero con avisos:\n\n${r.advertencias.join("\n")}`);
        router.push(`/dashboard/contratos/${r.numero}`);
      } else setErr(r.error);
    });
  }

  function generarConPasajeros() {
    const falta = paxRows.findIndex((p) => !p.nombres.trim() || !p.apellidos.trim());
    if (falta >= 0) { setErr(`Pasajero ${falta + 1}: nombres y apellidos son obligatorios.`); return; }
    // Menores de edad no pueden tener CC (solo RC o TI).
    const menorConCC = paxRows.findIndex((p) => {
      const edad = calcularEdad(p.fechaNacimiento, null);
      return edad != null && edad < 18 && p.tipoDoc === "CC";
    });
    if (menorConCC >= 0) { setErr(`Pasajero ${menorConCC + 1}: un menor de edad no puede tener CC; usa RC o TI.`); return; }
    // No puede haber dos pasajeros con el mismo tipo + número de documento.
    const vistos = new Set<string>();
    for (let i = 0; i < paxRows.length; i++) {
      const p = paxRows[i];
      if (!p.numeroDoc.trim()) continue;
      const k = `${p.tipoDoc}-${p.numeroDoc.trim()}`;
      if (vistos.has(k)) { setErr(`Pasajero ${i + 1}: documento repetido (${p.tipoDoc} ${p.numeroDoc}).`); return; }
      vistos.add(k);
    }
    if (!asesorSel && !esSuperadmin) { setErr("Elige el asesor interno que gestiona esta reserva."); return; }
    const t = trmProvisional();
    if (!t.ok) { setErr(t.error); return; }
    const cb = eleccionCobro();
    if (!cb.ok) { setErr(cb.error); return; }
    setErr("");
    start(async () => {
      const r = await convertirCotizacion(id, paxRows, false, asesorSel, t.valor, cb.monedaCobro, cb.trmCobro);
      if (r.ok) {
        if (r.advertencias?.length) window.alert(`Contrato creado, pero con avisos:\n\n${r.advertencias.join("\n")}`);
        router.push(`/dashboard/contratos/${r.numero}`);
      } else setErr(r.error);
    });
  }

  function generarSinPasajeros() {
    const t = trmProvisional();
    if (!t.ok) { setErr(t.error); return; }
    const cb = eleccionCobro();
    if (!cb.ok) { setErr(cb.error); return; }
    setErr("");
    start(async () => {
      const r = await convertirCotizacion(id, [], true, undefined, t.valor, cb.monedaCobro, cb.trmCobro);
      if (r.ok) router.push(`/dashboard/contratos/${r.numero}`);
      else setErr(r.error);
    });
  }

  function descartar() {
    setErr("");
    start(async () => {
      const r = await descartarCotizacion(id);
      if (r.ok) router.refresh();
      else setErr(r.error ?? "No se pudo descartar.");
    });
  }

  return (
    <div className="space-y-3">
      {pideTrmProvisional && (
        <div className="max-w-xs rounded-lg border border-gray-200 p-3" data-testid="trm-provisional">
          <label className="text-[11px] text-gray-500" htmlFor="trm-provisional-input">TRM provisional del contrato (COP por USD) *</label>
          <Input id="trm-provisional-input" aria-label="TRM provisional" type="number" min={0} step="0.01" inputMode="decimal" placeholder="Obligatoria, ej. 4000" required
            value={trmProv} onChange={(e) => setTrmProv(e.target.value)} />
          <p className="mt-1 text-[10px] text-gray-400">
            Esta oferta está en USD y no tiene TRM: debes ingresar la tasa. Se congela al contratar y es con la que se registran en pesos las
            cuentas por pagar y los asientos; no cambia después.
          </p>
        </div>
      )}
      {permiteMonedaCobro && (
        <div className="max-w-sm rounded-lg border border-gray-200 p-3" data-testid="moneda-cobro">
          <label className="text-[11px] text-gray-500" htmlFor="moneda-cobro-select">Moneda de cobro del contrato *</label>
          <select id="moneda-cobro-select" aria-label="Moneda de cobro" className="mt-1 block w-full rounded-md border border-gray-200 bg-white px-2 py-1.5 text-sm"
            required value={monedaCobro} onChange={(e) => setMonedaCobro(e.target.value)}>
            <option value="" disabled>Elige la moneda de cobro…</option>
            {(["COP", "USD"] as const).map((m) => (
              <option key={m} value={m}>{m === monedaOferta ? `${m} (la de la oferta, sin conversión)` : `${m} (convertir al contratar)`}</option>
            ))}
          </select>
          {cobroDistinto && (
            <div className="mt-2">
              <label className="text-[11px] text-gray-500" htmlFor="trm-cobro-input">TRM de cobro (COP por USD) *</label>
              <Input id="trm-cobro-input" aria-label="TRM de cobro" type="number" min={0} step="0.01" inputMode="decimal" placeholder="Obligatoria, ej. 4000" required
                value={trmCobro} onChange={(e) => setTrmCobro(e.target.value)} />
              {vistaPreviaCobro != null && (
                <p className="mt-1 text-xs text-gray-600" data-testid="vista-previa-cobro">
                  Se cobrará {formatMoneda(vistaPreviaCobro, monedaCobro)} (oferta: {formatMoneda(totalOferta, monedaOferta)}). Vista previa: el sistema calcula y congela el total al contratar.
                </p>
              )}
            </div>
          )}
          <p className="mt-1 text-[10px] text-gray-400">
            La oferta conserva su moneda e importes; solo el total a cobrar se convierte, una vez, con la TRM que ingreses aquí. Abonos y saldo se llevan en la moneda de cobro y no cambian después.
          </p>
        </div>
      )}
      <div className="flex flex-wrap gap-3">
        <Button
          onClick={() => (tienePasajeros ? convertirDirecto() : setCapturando((v) => !v))}
          disabled={pending}
          style={{ backgroundColor: "var(--brand-success)" }}
        >
          {pending ? "Procesando…" : "Confirmar → generar contrato"}
        </Button>
        {!confirmarDescarte ? (
          <Button onClick={() => setConfirmarDescarte(true)} disabled={pending} variant="outline">Descartar</Button>
        ) : (
          <div className="flex items-center gap-2 text-sm">
            <span className="text-gray-500">¿Seguro?</span>
            <Button onClick={descartar} disabled={pending} variant="outline" className="text-red-600">Sí, descartar</Button>
            <button type="button" className="text-xs text-gray-400 hover:text-gray-600" onClick={() => setConfirmarDescarte(false)}>Cancelar</button>
          </div>
        )}
      </div>

      {/* Captura de pasajeros (cuando la cotización no los trae, ej. tarifario B2C) */}
      {!tienePasajeros && capturando && (
        <div className="space-y-3 rounded-xl border border-gray-200 p-4">
          <p className="text-sm font-medium text-gray-700">Datos de los pasajeros ({total})</p>
          <p className="text-xs text-gray-400">Ya tienes al titular; completa el resto. Sin pasajeros no pasa a contrato.</p>
          <div className="max-w-xs">
            <label className="text-[11px] text-gray-500">Asesor interno que gestiona{esSuperadmin ? " (opcional)" : " *"}</label>
            <select value={asesorSel} onChange={(e) => setAsesorSel(e.target.value)} disabled={asesorBloqueado}
              className="w-full rounded-lg border border-gray-300 bg-white px-2 py-2 text-sm disabled:bg-gray-100 disabled:text-gray-500">
              <option value="">{esSuperadmin ? "— Sin asesor —" : "— Elegir asesor —"}</option>
              {asesores.map((a) => <option key={a.email ?? a.nombre} value={a.nombre}>{a.nombre}</option>)}
              {asesorSel && !asesores.some((a) => a.nombre === asesorSel) && <option value={asesorSel}>{asesorSel}</option>}
            </select>
            {asesorBloqueado && <p className="mt-0.5 text-[10px] text-gray-400">Te asigna automáticamente; solo un superadmin puede cambiarlo.</p>}
          </div>
          {paxRows.map((p, i) => (
            <div key={i} className="flex flex-wrap items-end gap-2">
              <div className="w-32"><label className="text-[11px] text-gray-500">Nombres</label><Input value={p.nombres} onChange={(e) => setRow(i, "nombres", e.target.value)} /></div>
              <div className="w-32"><label className="text-[11px] text-gray-500">Apellidos</label><Input value={p.apellidos} onChange={(e) => setRow(i, "apellidos", e.target.value)} /></div>
              <div className="w-24">
                <label className="text-[11px] text-gray-500">Tipo doc</label>
                <select value={p.tipoDoc} onChange={(e) => setRow(i, "tipoDoc", e.target.value)} className="w-full rounded-lg border border-gray-300 bg-white px-2 py-2 text-sm">
                  <OpcionesTipoDoc pasajero />
                </select>
              </div>
              <div className="w-28">
                <label className="text-[11px] text-gray-500">N° doc</label>
                <div className="flex items-center gap-1">
                  <Input value={p.numeroDoc} onChange={(e) => setRow(i, "numeroDoc", e.target.value)} />
                  <BuscarPasajeroDocumento
                    tipoId={p.tipoDoc}
                    identificacion={p.numeroDoc}
                    onAplicar={(datos) => {
                      if (datos.fechaNacimiento) setRow(i, "fechaNacimiento", datos.fechaNacimiento);
                      if (datos.nacionalidad) setRow(i, "nacionalidad", datos.nacionalidad);
                      // nombres/apellidos SOLO si la fila encontrada ya los
                      // trae estructurados (migración 187) — nunca se parte
                      // `nombreHistorico` por heurística.
                      if (datos.nombres) setRow(i, "nombres", datos.nombres);
                      if (datos.apellidos) setRow(i, "apellidos", datos.apellidos);
                    }}
                  />
                </div>
              </div>
              <div className="w-44"><label className="text-[11px] text-gray-500">Nacimiento</label><DateInput aria-label="Nacimiento" type="date" className="w-full" value={p.fechaNacimiento} onValueChange={(dateValue) => setRow(i, "fechaNacimiento", dateValue)} /></div>
              <div className="w-32"><label className="text-[11px] text-gray-500">Nacionalidad</label><Input value={p.nacionalidad} onChange={(e) => setRow(i, "nacionalidad", e.target.value)} /></div>
            </div>
          ))}
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={generarConPasajeros} disabled={pending} style={{ backgroundColor: "var(--brand-primary)" }}>
              {pending ? "Generando…" : "Generar contrato"}
            </Button>
            {esSuperadmin && (
              <button type="button" onClick={generarSinPasajeros} disabled={pending} className="text-xs text-gray-400 hover:text-gray-700 underline">
                Generar sin pasajeros (superadmin)
              </button>
            )}
          </div>
        </div>
      )}

      {err && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{err}</p>}
      <p className="text-xs text-gray-400">
        Al confirmar se genera el número de contrato, se descuentan las sillas y se crean las cuentas por pagar.
      </p>
    </div>
  );
}
