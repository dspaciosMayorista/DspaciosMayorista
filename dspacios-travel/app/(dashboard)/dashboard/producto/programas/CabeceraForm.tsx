"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { CabeceraInput } from "./actions";

type Result = { ok: true; id?: number } | { ok: false; error: string };

const lbl = "mb-1 block text-xs font-medium text-gray-600";
const sel = "w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm";

export function CabeceraForm({
  initial,
  proveedores,
  onSubmit,
  submitLabel,
  redirectOnCreate = false,
}: {
  initial?: Partial<CabeceraInput>;
  proveedores: { id: number; nombre: string }[];
  onSubmit: (input: CabeceraInput) => Promise<Result>;
  submitLabel: string;
  redirectOnCreate?: boolean;
}) {
  const router = useRouter();
  const [f, setF] = useState<CabeceraInput>({
    nombre: initial?.nombre ?? "",
    proveedorId: initial?.proveedorId ?? null,
    subtitulo: initial?.subtitulo ?? "",
    dias: initial?.dias ?? null,
    noches: initial?.noches ?? null,
    moneda: initial?.moneda ?? "USD",
    salidas: initial?.salidas ?? "",
    vigenciaDesde: initial?.vigenciaDesde ?? "",
    vigenciaHasta: initial?.vigenciaHasta ?? "",
    minPax: initial?.minPax ?? 2,
    maxPax: initial?.maxPax ?? 19,
    pctMk: initial?.pctMk ?? 0,
    pctFeeTarjeta: initial?.pctFeeTarjeta ?? 0,
    ninoEdadMax: initial?.ninoEdadMax ?? null,
    ninoValorServicios: initial?.ninoValorServicios ?? null,
    textoCondiciones: initial?.textoCondiciones ?? "",
    textoCancelacion: initial?.textoCancelacion ?? "",
    textoPagos: initial?.textoPagos ?? "",
    notas: initial?.notas ?? "",
  });
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState(false);
  const [pending, startTransition] = useTransition();

  const set = <K extends keyof CabeceraInput>(k: K, v: CabeceraInput[K]) => setF((p) => ({ ...p, [k]: v }));
  const numOrNull = (v: string) => (v === "" ? null : Number(v));

  function handle(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setOkMsg(false);
    if (!f.nombre.trim()) {
      setError("El nombre es obligatorio.");
      return;
    }
    startTransition(async () => {
      const res = await onSubmit(f);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      if (redirectOnCreate && res.id) {
        router.push(`/dashboard/producto/programas/${res.id}`);
        return;
      }
      setOkMsg(true);
    });
  }

  // El markup y el fee se guardan como fracción (0.20). En la UI se muestra en %.
  return (
    <form onSubmit={handle} className="space-y-4">
      <div>
        <label className={lbl}>Nombre del programa *</label>
        <Input value={f.nombre} onChange={(e) => set("nombre", e.target.value)} placeholder="LO MEJOR DE BRASIL 2025" />
      </div>
      <div>
        <label className={lbl}>Subtítulo / ruta</label>
        <Input
          value={f.subtitulo}
          onChange={(e) => set("subtitulo", e.target.value)}
          placeholder="Río de Janeiro – Foz do Iguazú – Manaus – Salvador"
        />
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div>
          <label className={lbl}>Días</label>
          <Input type="number" value={f.dias ?? ""} onChange={(e) => set("dias", numOrNull(e.target.value))} />
        </div>
        <div>
          <label className={lbl}>Noches</label>
          <Input type="number" value={f.noches ?? ""} onChange={(e) => set("noches", numOrNull(e.target.value))} />
        </div>
        <div>
          <label className={lbl}>Moneda</label>
          <select value={f.moneda} onChange={(e) => set("moneda", e.target.value)} className={sel}>
            <option value="USD">USD</option>
            <option value="COP">COP</option>
          </select>
        </div>
        <div>
          <label className={lbl}>Salidas</label>
          <Input value={f.salidas} onChange={(e) => set("salidas", e.target.value)} placeholder="Diarias" />
        </div>
      </div>

      <div>
        <label className={lbl}>Proveedor</label>
        <select
          value={f.proveedorId ?? ""}
          onChange={(e) => set("proveedorId", e.target.value === "" ? null : Number(e.target.value))}
          className={sel}
        >
          <option value="">— (sin asignar)</option>
          {proveedores.map((p) => (
            <option key={p.id} value={p.id}>
              {p.nombre}
            </option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div>
          <label className={lbl}>Vigencia desde</label>
          <Input type="date" value={f.vigenciaDesde} onChange={(e) => set("vigenciaDesde", e.target.value)} />
        </div>
        <div>
          <label className={lbl}>Vigencia hasta</label>
          <Input type="date" value={f.vigenciaHasta} onChange={(e) => set("vigenciaHasta", e.target.value)} />
        </div>
        <div>
          <label className={lbl}>Mín. pax</label>
          <Input type="number" value={f.minPax ?? ""} onChange={(e) => set("minPax", numOrNull(e.target.value))} />
        </div>
        <div>
          <label className={lbl}>Máx. pax</label>
          <Input type="number" value={f.maxPax ?? ""} onChange={(e) => set("maxPax", numOrNull(e.target.value))} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div>
          <label className={lbl}>Markup %</label>
          <Input
            type="number"
            step="0.1"
            value={f.pctMk ? f.pctMk * 100 : ""}
            onChange={(e) => set("pctMk", e.target.value === "" ? 0 : Number(e.target.value) / 100)}
            placeholder="20"
          />
        </div>
        <div>
          <label className={lbl}>Fee tarjeta %</label>
          <Input
            type="number"
            step="0.1"
            value={f.pctFeeTarjeta ? f.pctFeeTarjeta * 100 : ""}
            onChange={(e) => set("pctFeeTarjeta", e.target.value === "" ? 0 : Number(e.target.value) / 100)}
            placeholder="5"
          />
        </div>
        <div>
          <label className={lbl}>Niño: edad máx.</label>
          <Input type="number" value={f.ninoEdadMax ?? ""} onChange={(e) => set("ninoEdadMax", numOrNull(e.target.value))} placeholder="2" />
        </div>
        <div>
          <label className={lbl}>Niño: valor servicios</label>
          <Input type="number" value={f.ninoValorServicios ?? ""} onChange={(e) => set("ninoValorServicios", numOrNull(e.target.value))} placeholder="719" />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div>
          <label className={lbl}>Condiciones generales</label>
          <textarea value={f.textoCondiciones} onChange={(e) => set("textoCondiciones", e.target.value)} rows={4} className={sel} />
        </div>
        <div>
          <label className={lbl}>Política de cancelación</label>
          <textarea value={f.textoCancelacion} onChange={(e) => set("textoCancelacion", e.target.value)} rows={4} className={sel} />
        </div>
        <div>
          <label className={lbl}>Política de pagos</label>
          <textarea value={f.textoPagos} onChange={(e) => set("textoPagos", e.target.value)} rows={4} className={sel} />
        </div>
      </div>
      <div>
        <label className={lbl}>Notas internas</label>
        <textarea value={f.notas} onChange={(e) => set("notas", e.target.value)} rows={2} className={sel} />
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {okMsg && <p className="text-sm text-green-600">Guardado ✓</p>}
      <Button type="submit" disabled={pending} style={{ backgroundColor: "var(--brand-primary)" }}>
        {pending ? "Guardando…" : submitLabel}
      </Button>
    </form>
  );
}
