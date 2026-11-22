"use client";

import { DateInput } from "@/components/ui/DateInput";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { calcularEdad } from "@/lib/utils";
import { esInfantePorEdad } from "@/lib/reservar/pasajeros";
import { estadoFilaConversion, resumenFilaConversion } from "@/lib/reservar/resumenPasajeroConversion";
import { EDAD_ADULTO_RESPONSABLE, recalcularVinculosPorEdad } from "@/lib/reservar/pasajerosFilas";
import { MENSAJE_TRM_PROVISIONAL_REQUERIDA_63, trmValida90 } from "@/lib/reservar/monedaPublicacion90";
import { totalCobroConvertido, validarEleccionCobro } from "@/lib/finanzas/cobro";
import { formatMoneda } from "@/lib/utils";
import { validarTrmCosto } from "@/lib/finanzas/costoTrmCarrito";
import { convertirCotizacion, descartarCotizacion } from "../../reservar/actions";
import { type PasajeroReserva } from "@/lib/reservar/computo";
import { OpcionesTipoDoc } from "@/components/personas/OpcionesTipoDoc";
import { documentoPasajeroDesdeCliente } from "@/lib/personas/tiposDocumento";
import { BuscarPasajeroDocumento } from "@/components/pasajeros/BuscarPasajeroDocumento";
import { documentoPasajeroAdmitido } from "@/lib/personas/tiposDocumento";
import type { PasajeroAliado } from "@/lib/portal/preparacionContrato";

type ClientePrefill = { nombres: string; apellidos: string; tipoDoc: string; numeroDoc: string };


export function CotizacionAcciones({
  id, pax, infantes, tienePasajeros, cliente, esSuperadmin, asesores, miNombre, miRolVenta, pideTrmProvisional = false, pideTrmCosto = false,
  permiteMonedaCobro = false, monedaOferta = "COP", totalOferta = 0, pasajerosAliado = [], fechaReferencia = null,
}: {
  /** Fecha de salida: contra ella se decide quién es infante y quién es adulto elegible como responsable (la misma que usa el servidor y la base). */
  fechaReferencia?: string | null;
  /** O-3: pasajeros adicionales que el ALIADO escribió en su cotización (después del titular). Solo llegan si la cotización aún no trae pasajeros; precargan las filas 2…n sin retipear y lo que no escribió queda vacío. */
  pasajerosAliado?: PasajeroAliado[];
  id: number; pax: number; infantes: number; tienePasajeros: boolean; cliente: ClientePrefill; esSuperadmin: boolean;
  asesores: { nombre: string; email: string | null }[];
  miNombre: string; miRolVenta: boolean;
  /** Oferta en USD sin TRM: al convertir a contrato se captura la TRM provisional (pesos por dólar). */
  pideTrmProvisional?: boolean;
  /** Contrato en USD (hotel a solicitud o tarifado): los proveedores se deben en dólares y la TRM de COSTOS (pesos por dólar) es obligatoria; la ingresa quien convierte. */
  pideTrmCosto?: boolean;
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
  const [trmCostoTxt, setTrmCostoTxt] = useState("");
  // TRM de COSTOS: distinta de la de cobro. Obligatoria y positiva cuando el contrato está en USD (el servidor la exige igual y, sin ella, no numera nada).
  const trmCostoValor = (): { ok: true; valor: number | null } | { ok: false; error: string } => {
    if (!pideTrmCosto) return { ok: true, valor: null };
    const v = validarTrmCosto(trmCostoTxt);
    return v.ok ? { ok: true, valor: v.trm } : v;
  };
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

  const total = Math.max(1, pax || 1, 1 + pasajerosAliado.length);
  const [paxRows, setPaxRows] = useState<PasajeroReserva[]>(() =>
    Array.from({ length: total }, (_, i) => ({
      nombres: i === 0 ? cliente.nombres : pasajerosAliado[i - 1]?.nombres ?? "",
      apellidos: i === 0 ? cliente.apellidos : pasajerosAliado[i - 1]?.apellidos ?? "",
      ...(i === 0 ? documentoPasajeroDesdeCliente(cliente.tipoDoc || "CC", cliente.numeroDoc) : { tipoDoc: pasajerosAliado[i - 1]?.tipoDoc || "CC", numeroDoc: pasajerosAliado[i - 1]?.numeroDoc ?? "" }),
      fechaNacimiento: i === 0 ? "" : pasajerosAliado[i - 1]?.fechaNacimiento ?? "",
      nacionalidad: (i > 0 && pasajerosAliado[i - 1]?.nacionalidad) || "Colombiana",
      esInfante: i >= total - Math.max(0, infantes),
    }))
  );

  // Filas COMPACTAS (resumen + «Editar»). Aquí el número de filas lo fija la cotización (no hay agregar/quitar: el universo es exactamente `pax`), así que solo se compacta/abre.
  // Nacen compactas las filas sin nada que bloquee la generación; las incompletas o inválidas, abiertas. Nunca se compacta sola mientras se escribe: solo con «Listo».
  const contextoFila = (r: PasajeroReserva) => ({ edad: calcularEdad(r.fechaNacimiento, fechaReferencia), esInfante: esInfantePorEdad(r.fechaNacimiento, fechaReferencia) });
  // Los problemas se miden como los mide el envío: el menor con CC contra la edad de HOY (igual que `generarConPasajeros`).
  const problemasDe = (r: PasajeroReserva) => estadoFilaConversion(r, { edad: calcularEdad(r.fechaNacimiento, null), esInfante: contextoFila(r).esInfante }).problemas;
  const [compactas, setCompactas] = useState<boolean[]>(() => paxRows.map((r) => problemasDe(r).length === 0));

  // Un cambio de fecha de nacimiento puede sacar a un pasajero de la categoría infante o dejar de calificar a su responsable: se corrige el vínculo (misma función que Reservar y el carrito).
  const setRow = (i: number, k: keyof PasajeroReserva, v: string) =>
    setPaxRows((rows) => {
      const next = rows.map((r, n) => (n === i ? { ...r, [k]: v } : r));
      return k === "fechaNacimiento" ? recalcularVinculosPorEdad(next, fechaReferencia) : next;
    });
  // Adulto responsable de un infante: lo ELIGE el personal (nunca se infiere); null = sin vincular, y la base lo rechaza.
  const setResponsable = (i: number, responsableIndex: number | null) =>
    setPaxRows((rows) => rows.map((r, n) => (n === i ? { ...r, responsableIndex } : r)));

  function convertirDirecto() {
    const t = trmProvisional();
    if (!t.ok) { setErr(t.error); return; }
    const cb = eleccionCobro();
    if (!cb.ok) { setErr(cb.error); return; }
    const tc = trmCostoValor();
    if (!tc.ok) { setErr(tc.error); return; }
    setErr("");
    start(async () => {
      const r = await convertirCotizacion(id, undefined, undefined, undefined, t.valor, cb.monedaCobro, cb.trmCobro, tc.valor);
      if (r.ok) {
        if (r.advertencias?.length) window.alert(`Contrato creado, pero con avisos:\n\n${r.advertencias.join("\n")}`);
        router.push(`/dashboard/contratos/${r.numero}`);
      } else setErr(r.error);
    });
  }

  function generarConPasajeros() {
    // Lo que bloquea nunca queda escondido: se abren las filas con problemas antes de cualquier mensaje.
    setCompactas((c) => c.map((v, i) => (v && paxRows[i] && problemasDe(paxRows[i]).length > 0 ? false : v)));
    const falta = paxRows.findIndex((p) => !p.nombres.trim() || !p.apellidos.trim());
    if (falta >= 0) { setErr(`Pasajero ${falta + 1}: nombres y apellidos son obligatorios.`); return; }
    // O-3: la MISMA regla de documento que la función atómica de pasajeros (solo dígitos salvo Pasaporte), comprobada antes de enviar.
    const malDoc = paxRows.findIndex((p) => !documentoPasajeroAdmitido(p.tipoDoc, p.numeroDoc));
    if (malDoc >= 0) { setErr(`Pasajero ${malDoc + 1}: el documento debe ser solo números (excepto Pasaporte).`); return; }
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
      if (vistos.has(k)) { setCompactas((c) => c.map((v, j) => (j === i ? false : v))); setErr(`Pasajero ${i + 1}: documento repetido (${p.tipoDoc} ${p.numeroDoc}).`); return; }
      vistos.add(k);
    }
    if (!asesorSel && !esSuperadmin) { setErr("Elige el asesor interno que gestiona esta reserva."); return; }
    const t = trmProvisional();
    if (!t.ok) { setErr(t.error); return; }
    const cb = eleccionCobro();
    if (!cb.ok) { setErr(cb.error); return; }
    const tc = trmCostoValor();
    if (!tc.ok) { setErr(tc.error); return; }
    setErr("");
    start(async () => {
      const r = await convertirCotizacion(id, paxRows, false, asesorSel, t.valor, cb.monedaCobro, cb.trmCobro, tc.valor);
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
    const tc = trmCostoValor();
    if (!tc.ok) { setErr(tc.error); return; }
    setErr("");
    start(async () => {
      const r = await convertirCotizacion(id, [], true, undefined, t.valor, cb.monedaCobro, cb.trmCobro, tc.valor);
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
      {pideTrmCosto && (
        <div className="max-w-xs rounded-lg border border-gray-200 p-3" data-testid="trm-costo">
          <label className="text-[11px] text-gray-500" htmlFor="trm-costo-input">TRM de costos (COP por USD) *</label>
          <Input id="trm-costo-input" aria-label="TRM de costos" type="number" min={0} step="0.01" inputMode="decimal" placeholder="Obligatoria, ej. 4000" required
            value={trmCostoTxt} onChange={(e) => setTrmCostoTxt(e.target.value)} />
          <p className="mt-1 text-[10px] text-gray-400">
            Este contrato está en USD y sus proveedores se deben en dólares: ingresa la tasa con la que se congela el equivalente en pesos de cada cuenta por pagar. Es distinta de la TRM de cobro; no cambia después.
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
        <div className="space-y-3 rounded-xl border border-gray-200 p-4" data-testid="captura-pasajeros">
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
          {paxRows.map((p, i) => {
            // Edad REAL por fecha de nacimiento contra la fecha de salida: es el criterio con el que el servidor y la base deciden si es infante y exigen su adulto responsable.
            const edadReal = calcularEdad(p.fechaNacimiento, fechaReferencia);
            const esInfanteReal = esInfantePorEdad(p.fechaNacimiento, fechaReferencia);
            const est = estadoFilaConversion(p, { edad: calcularEdad(p.fechaNacimiento, null), esInfante: esInfanteReal });
            if (compactas[i] && est.problemas.length === 0) {
              const resp = p.responsableIndex != null ? paxRows[p.responsableIndex] : null;
              const res = resumenFilaConversion(p, { edad: edadReal, esInfante: esInfanteReal }, resp ? `${resp.nombres} ${resp.apellidos}`.trim() || `Pasajero ${p.responsableIndex! + 1}` : null);
              return (
                <div key={i} className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 rounded-lg bg-gray-50 px-2 py-1.5" data-testid="pasajero-resumen">
                  <p className="min-w-0 text-xs">
                    <span className="font-semibold text-gray-600">Pasajero {i + 1}</span> <span className="text-gray-800">{res.titulo}</span>
                    {res.detalle && <span className="text-gray-500"> · {res.detalle}</span>}
                    {est.faltan.length > 0 && <span className="ml-1 text-amber-700" data-testid="pasajero-faltan">Faltan: {est.faltan.join(", ")}</span>}
                  </p>
                  <button type="button" onClick={() => setCompactas((c) => c.map((v, j) => (j === i ? false : v)))} aria-label={`Editar pasajero ${i + 1}`} data-testid="editar-pasajero" className="shrink-0 text-[11px] font-medium text-[#1D7C9A] hover:underline">Editar</button>
                </div>
              );
            }
            return (
            <div key={i} className="space-y-2" data-testid="pasajero-fila">
            <div className="flex flex-wrap items-end gap-2">
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
              {est.problemas.length === 0 && (
                <button type="button" onClick={() => setCompactas((c) => c.map((v, j) => (j === i ? true : v)))} data-testid="compactar-pasajero" className="pb-2 text-[11px] font-medium text-[#1D7C9A] hover:underline">Listo</button>
              )}
              <span className="pb-2 text-[11px] text-gray-400" data-testid="edad-pasajero">{edadReal == null ? "—" : `${esInfanteReal ? "Infante" : edadReal < 12 ? "Niño" : "Adulto"} · ${edadReal}a`}</span>
            </div>
            {esInfanteReal && (
              <div className="max-w-sm" data-testid="responsable-infante">
                <label className="text-[11px] text-gray-500" htmlFor={`responsable-${i}`}>Adulto responsable *</label>
                <select id={`responsable-${i}`} value={p.responsableIndex ?? ""} onChange={(e) => setResponsable(i, e.target.value === "" ? null : Number(e.target.value))}
                  className="w-full rounded-lg border border-gray-300 bg-white px-2 py-2 text-sm">
                  <option value="">Sin vincular (se rechazará al generar)</option>
                  {paxRows.map((otro, j) => {
                    const edadOtro = calcularEdad(otro.fechaNacimiento, fechaReferencia);
                    if (j === i || edadOtro == null || edadOtro < EDAD_ADULTO_RESPONSABLE) return null;
                    return <option key={j} value={j}>{`${otro.nombres} ${otro.apellidos}`.trim() || `Pasajero ${j + 1}`}</option>;
                  })}
                </select>
                <p className="mt-1 text-xs text-gray-400">Todo infante debe quedar vinculado a un adulto (18+ años) que viaje en el mismo contrato; para que un pasajero aparezca aquí debe tener su fecha de nacimiento.</p>
              </div>
            )}
            </div>
            );
          })}
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
