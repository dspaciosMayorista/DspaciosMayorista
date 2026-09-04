"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { crearPaquete, actualizarPaquete, type PaqueteConfig } from "./actions";
import { ComboDestino } from "@/components/ComboDestino";

type Opt = { id: number; nombre: string; codigo_iata?: string | null };

type Tipo = "bloqueo" | "porcion_terrestre" | "servicios" | "dinamico";
type Initial = Partial<{
  nombre: string;
  tipo: Tipo;
  noches: number;
  activo: boolean;
  destinoId: number | null;
  fechaCompraInicio: string;
  fechaCompraFin: string;
  fechaViajeInicio: string;
  fechaViajeFin: string;
  pctMk: number;          // porcentaje (20 = 20 %)
  impuestoTipo: "tiquete" | "fijo";
  impuestoFijo: number;
  notas: string;
  condicionPagoTipo: string;
  condicionPagoPctInicial: number | null;
  condicionPagoDiasSaldo: number | null;
  restriccionComercial: string;
}>;

const lbl = "mb-1 block text-xs font-medium text-gray-600";
const sel = "w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm";

export function ConfigForm({
  destinos,
  id,
  initial,
}: {
  destinos: Opt[];
  id?: number;
  initial?: Initial;
}) {
  const router = useRouter();
  const [nombre, setNombre] = useState(initial?.nombre ?? "");
  const [tipo, setTipo] = useState<Tipo>(initial?.tipo ?? "bloqueo");
  const [noches, setNoches] = useState(initial?.noches != null ? String(initial.noches) : "3");
  const [activo, setActivo] = useState(initial?.activo ?? true);
  const [destinoId, setDestinoId] = useState<number | "">(initial?.destinoId ?? "");
  const [compraIni, setCompraIni] = useState(initial?.fechaCompraInicio ?? "");
  const [compraFin, setCompraFin] = useState(initial?.fechaCompraFin ?? "");
  const [viajeIni, setViajeIni] = useState(initial?.fechaViajeInicio ?? "");
  const [viajeFin, setViajeFin] = useState(initial?.fechaViajeFin ?? "");
  const [pctMk, setPctMk] = useState(initial?.pctMk != null ? String(initial.pctMk) : "");
  const [impTipo, setImpTipo] = useState<"tiquete" | "fijo">(initial?.impuestoTipo ?? "tiquete");
  const [impFijo, setImpFijo] = useState(initial?.impuestoFijo != null ? String(initial.impuestoFijo) : "");
  const [notas, setNotas] = useState(initial?.notas ?? "");
  // Condición de pago (migración 164) — inicializar SIEMPRE con lo guardado.
  const [condicionPagoTipo, setCondicionPagoTipo] = useState(initial?.condicionPagoTipo ?? "normal");
  const [condicionPagoPct, setCondicionPagoPct] = useState(
    initial?.condicionPagoPctInicial != null ? String(Math.round(initial.condicionPagoPctInicial * 100)) : ""
  );
  const [condicionPagoDias, setCondicionPagoDias] = useState(
    initial?.condicionPagoDiasSaldo != null ? String(initial.condicionPagoDiasSaldo) : ""
  );
  const [restriccionComercial, setRestriccionComercial] = useState(initial?.restriccionComercial ?? "normal");
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");

  function guardar() {
    if (!nombre.trim()) {
      setErr("El nombre es obligatorio.");
      return;
    }
    setErr("");
    const cfg: PaqueteConfig = {
      nombre,
      tipo,
      noches: Number(noches) || 3,
      destinoId: destinoId === "" ? null : Number(destinoId),
      fechaCompraInicio: compraIni,
      fechaCompraFin: compraFin,
      fechaViajeInicio: viajeIni,
      fechaViajeFin: viajeFin,
      pctMk: Number(pctMk) || 0,
      impuestoTipo: impTipo,
      impuestoFijo: Number(impFijo) || 0,
      activo,
      notas,
      condicionPagoTipo,
      condicionPagoPctInicial: condicionPagoPct === "" ? null : Number(condicionPagoPct),
      condicionPagoDiasSaldo: condicionPagoDias === "" ? null : Number(condicionPagoDias),
      restriccionComercial,
    };
    start(async () => {
      const r = id ? await actualizarPaquete(id, cfg) : await crearPaquete(cfg);
      if (r.ok) {
        router.push(`/dashboard/paquetes/${r.id ?? id}`);
        router.refresh();
      } else setErr(r.error);
    });
  }

  return (
    <div className="space-y-5 rounded-xl border border-gray-200 bg-white p-5">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="md:col-span-2">
          <label className={lbl}>Nombre del paquete *</label>
          <Input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Cartagena 4D/3N — Bloqueo junio" />
        </div>

        <div className="md:col-span-2">
          <label className={lbl}>Tipo de paquete *</label>
          <select value={tipo} onChange={(e) => setTipo(e.target.value as Tipo)} className={sel}>
            <option value="bloqueo">Bloqueo (vuelo + hotel)</option>
            <option value="porcion_terrestre">Porción terrestre (solo hotel)</option>
            <option value="dinamico">Dinámico (hotel + vuelo por sistema, sin record)</option>
            <option value="servicios">Servicios (solo servicios)</option>
          </select>
          <p className="mt-1 text-[11px] text-gray-400">Define qué adicionas y en qué módulo del tarifario aparece.</p>
        </div>

        {(tipo === "porcion_terrestre" || tipo === "dinamico") && (
          <div>
            <label className={lbl}>Noches por defecto</label>
            <Input type="number" min={1} value={noches} onChange={(e) => setNoches(e.target.value)} placeholder="3" />
            <p className="mt-1 text-[11px] text-gray-400">
              {tipo === "dinamico" ? "Referencia; cada salida liquida el hotel por sus propias noches (ida→regreso)." : "Se liquida desde la fecha de inicio del viaje."}
            </p>
          </div>
        )}

        <div>
          <label className={lbl}>Destino</label>
          <ComboDestino destinos={destinos} value={destinoId} onChange={setDestinoId} />
          <p className="mt-1 text-[11px] text-gray-400">Escribe el nombre o el IATA y elígelo. Filtra los vuelos, hoteles y servicios disponibles.</p>
        </div>

        <div className="flex items-end gap-2">
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={activo} onChange={(e) => setActivo(e.target.checked)} />
            Activo (visible en el tarifario)
          </label>
        </div>

        <div>
          <label className={lbl}>Vigencia de compra — desde</label>
          <Input type="date" value={compraIni} onChange={(e) => setCompraIni(e.target.value)} />
        </div>
        <div>
          <label className={lbl}>Vigencia de compra — hasta</label>
          <Input type="date" value={compraFin} onChange={(e) => setCompraFin(e.target.value)} />
        </div>

        <div>
          <label className={lbl}>Rango de viaje — desde</label>
          <Input type="date" value={viajeIni} onChange={(e) => setViajeIni(e.target.value)} />
        </div>
        <div>
          <label className={lbl}>Rango de viaje — hasta</label>
          <Input type="date" value={viajeFin} onChange={(e) => setViajeFin(e.target.value)} />
        </div>

        <div>
          <label className={lbl}>% MK (margen)</label>
          <Input type="number" min={0} max={99} value={pctMk} onChange={(e) => setPctMk(e.target.value)} placeholder="20" />
          <p className="mt-1 text-[11px] text-gray-400">PVP = costo / (1 − %mk). Aplica a hotel y servicios.</p>
        </div>

        <div>
          <label className={lbl}>Impuesto (Base No Comisionable)</label>
          <select value={impTipo} onChange={(e) => setImpTipo(e.target.value as "tiquete" | "fijo")} className={sel}>
            <option value="tiquete">Valor neto del tiquete</option>
            <option value="fijo">Valor fijo</option>
          </select>
        </div>

        {impTipo === "fijo" && (
          <div>
            <label className={lbl}>Valor fijo del impuesto</label>
            <Input type="number" min={0} value={impFijo} onChange={(e) => setImpFijo(e.target.value)} placeholder="599000" />
          </div>
        )}

        <div className="md:col-span-2 rounded-lg border border-gray-100 bg-gray-50 p-3">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">Condición de pago</p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div>
              <label className={lbl}>Condición</label>
              <select value={condicionPagoTipo} onChange={(e) => setCondicionPagoTipo(e.target.value)} className={sel}>
                <option value="normal">Normal</option>
                <option value="pago_total">Requiere pago total</option>
                <option value="anticipo_saldo">Anticipo y saldo</option>
              </select>
            </div>
            {condicionPagoTipo === "anticipo_saldo" && (
              <>
                <div>
                  <label className={lbl}>Anticipo inicial (%)</label>
                  <Input type="number" min={1} max={99} value={condicionPagoPct} onChange={(e) => setCondicionPagoPct(e.target.value)} placeholder="50" />
                </div>
                <div>
                  <label className={lbl}>Días antes del viaje para el saldo</label>
                  <Input type="number" min={0} value={condicionPagoDias} onChange={(e) => setCondicionPagoDias(e.target.value)} placeholder="30" />
                </div>
              </>
            )}
            <div>
              <label className={lbl}>Restricción comercial</label>
              <select value={restriccionComercial} onChange={(e) => setRestriccionComercial(e.target.value)} className={sel}>
                <option value="normal">Sin restricción</option>
                <option value="promocional_no_reembolsable_no_endosable">Promocional — no reembolsable / no endosable</option>
              </select>
            </div>
          </div>
          {restriccionComercial !== "normal" && (
            <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
              Este paquete queda marcado <b>No reembolsable</b> y <b>No endosable</b>.
            </p>
          )}
        </div>

        <div className="md:col-span-2">
          <label className={lbl}>Notas (opcional)</label>
          <textarea value={notas} onChange={(e) => setNotas(e.target.value)} className={sel} rows={2} />
        </div>
      </div>

      {err && <p className="text-sm text-red-600">{err}</p>}

      <div className="flex justify-end">
        <Button onClick={guardar} disabled={pending} style={{ backgroundColor: "var(--brand-primary)" }}>
          {pending ? "Guardando…" : id ? "Guardar cambios" : "Crear y continuar →"}
        </Button>
      </div>
    </div>
  );
}
