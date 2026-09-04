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
    edadNinoMin: initial?.edadNinoMin ?? 2,
    edadNinoMax: initial?.edadNinoMax ?? 11,
    edadInfanteMax: initial?.edadInfanteMax ?? 1,
    textoCondiciones: initial?.textoCondiciones ?? "",
    textoCancelacion: initial?.textoCancelacion ?? "",
    textoPagos: initial?.textoPagos ?? "",
    notas: initial?.notas ?? "",
    highlights: initial?.highlights ?? "",
    desdePrecio: initial?.desdePrecio ?? null,
    tipoTransporte: initial?.tipoTransporte ?? "ninguno",
    portadaUrl: initial?.portadaUrl ?? "",
    asistenciaMedicaDia: initial?.asistenciaMedicaDia ?? null,
    modoPrecio: initial?.modoPrecio ?? "categoria",
    videoUrl: initial?.videoUrl ?? "",
    // Condición de pago (migración 164) — inicializar SIEMPRE con lo guardado,
    // nunca con un default que lo sobrescriba silenciosamente.
    condicionPagoTipo: (initial?.condicionPagoTipo as string | undefined) ?? "normal",
    condicionPagoPctInicial: initial?.condicionPagoPctInicial ?? "",
    condicionPagoDiasSaldo: initial?.condicionPagoDiasSaldo ?? "",
    restriccionComercial: (initial?.restriccionComercial as string | undefined) ?? "normal",
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

      {/* Modo de precio */}
      <div>
        <label className={lbl}>Estructura de precio</label>
        <select value={f.modoPrecio} onChange={(e) => set("modoPrecio", e.target.value)} className={sel}>
          <option value="categoria">Por categoría de hotel (matriz categoría × acomodación)</option>
          <option value="salida">Por salida (fecha × precio, noches variables)</option>
        </select>
        <p className="mt-1 text-xs text-gray-400">
          {f.modoPrecio === "salida"
            ? "Para circuitos donde el precio cambia por fecha de salida y las noches varían (tipo Cibeles). Cárgalas en la pestaña “Salidas y precios”."
            : "Para circuitos con niveles de hotel y precio por acomodación. Cárgalos en “Hoteles y precios”."}
        </p>
      </div>

      {/* Vitrina pública */}
      <div className="rounded-lg border border-gray-100 bg-gray-50 p-3">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">Vitrina pública</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div>
            <label className={lbl}>Precio “Desde” ({f.moneda})</label>
            <Input
              type="number"
              value={f.desdePrecio ?? ""}
              onChange={(e) => set("desdePrecio", numOrNull(e.target.value))}
              placeholder="Opcional · si está, manda sobre el mínimo de la matriz"
            />
          </div>
          <div>
            <label className={lbl}>Traslado origen → destino</label>
            <select
              value={f.tipoTransporte}
              onChange={(e) => set("tipoTransporte", e.target.value as CabeceraInput["tipoTransporte"])}
              className={sel}
            >
              <option value="ninguno">Porción terrestre (sin traslado, solo servicios en destino)</option>
              <option value="aereo">Con aéreo</option>
              <option value="terrestre">Salida terrestre (bus)</option>
            </select>
          </div>
          <div>
            <label className={lbl}>Imagen de portada (URL)</label>
            <Input value={f.portadaUrl} onChange={(e) => set("portadaUrl", e.target.value)} placeholder="https://…" />
          </div>
          <div className="sm:col-span-3">
            <label className={lbl}>Video de fondo (URL de YouTube)</label>
            <Input value={f.videoUrl} onChange={(e) => set("videoUrl", e.target.value)} placeholder="https://youtu.be/… (opcional, se usa de fondo en la ficha del programa)" />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div>
          <label className={lbl}>Markup proveedor %</label>
          <Input
            type="number"
            step="0.1"
            value={f.pctMk ? f.pctMk * 100 : ""}
            onChange={(e) => set("pctMk", e.target.value === "" ? 0 : Number(e.target.value) / 100)}
            placeholder="25"
          />
        </div>
        <div>
          <label className={lbl}>Fee bancario %</label>
          <Input
            type="number"
            step="0.1"
            value={f.pctFeeTarjeta ? f.pctFeeTarjeta * 100 : ""}
            onChange={(e) => set("pctFeeTarjeta", e.target.value === "" ? 0 : Number(e.target.value) / 100)}
            placeholder="3"
          />
        </div>
        <div>
          <label className={lbl}>Asistencia médica / día ({f.moneda})</label>
          <Input
            type="number"
            value={f.asistenciaMedicaDia ?? ""}
            onChange={(e) => set("asistenciaMedicaDia", numOrNull(e.target.value))}
            placeholder="0"
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

      {/* Edades (según el proveedor del programa) — alimentan la validación al reservar */}
      <div className="rounded-lg border border-gray-100 bg-gray-50 p-3">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">Edades (según el proveedor)</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <div>
            <label className={lbl}>Edad niño desde</label>
            <Input type="number" value={f.edadNinoMin ?? ""} onChange={(e) => set("edadNinoMin", numOrNull(e.target.value))} placeholder="2" />
          </div>
          <div>
            <label className={lbl}>Edad niño hasta</label>
            <Input type="number" value={f.edadNinoMax ?? ""} onChange={(e) => set("edadNinoMax", numOrNull(e.target.value))} placeholder="11" />
          </div>
          <div>
            <label className={lbl}>Edad infante hasta</label>
            <Input type="number" value={f.edadInfanteMax ?? ""} onChange={(e) => set("edadInfanteMax", numOrNull(e.target.value))} placeholder="1" />
          </div>
        </div>
        <p className="mt-1 text-xs text-gray-400">Define qué cuenta como niño / infante en este programa. Se usa para validar pasajeros al reservar.</p>
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
      {/* Condición de pago (migración 164) */}
      <div className="rounded-lg border border-gray-100 bg-gray-50 p-3">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">Condición de pago</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div>
            <label className={lbl}>Condición</label>
            <select
              value={String(f.condicionPagoTipo ?? "normal")}
              onChange={(e) => set("condicionPagoTipo", e.target.value)}
              className={sel}
            >
              <option value="normal">Normal</option>
              <option value="pago_total">Requiere pago total</option>
              <option value="anticipo_saldo">Anticipo y saldo</option>
            </select>
          </div>
          {f.condicionPagoTipo === "anticipo_saldo" && (
            <>
              <div>
                <label className={lbl}>Anticipo inicial (%)</label>
                <Input
                  type="number" min={1} max={99}
                  value={f.condicionPagoPctInicial == null ? "" : String(f.condicionPagoPctInicial)}
                  onChange={(e) => set("condicionPagoPctInicial", e.target.value)}
                  placeholder="50"
                />
              </div>
              <div>
                <label className={lbl}>Días antes del viaje para el saldo</label>
                <Input
                  type="number" min={0}
                  value={f.condicionPagoDiasSaldo == null ? "" : String(f.condicionPagoDiasSaldo)}
                  onChange={(e) => set("condicionPagoDiasSaldo", e.target.value)}
                  placeholder="30"
                />
              </div>
            </>
          )}
          <div>
            <label className={lbl}>Restricción comercial</label>
            <select
              value={String(f.restriccionComercial ?? "normal")}
              onChange={(e) => set("restriccionComercial", e.target.value)}
              className={sel}
            >
              <option value="normal">Sin restricción</option>
              <option value="promocional_no_reembolsable_no_endosable">Promocional — no reembolsable / no endosable</option>
            </select>
          </div>
        </div>
        {f.restriccionComercial !== "normal" && (
          <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
            Esta tarifa promocional queda marcada <b>No reembolsable</b> y <b>No endosable</b>.
          </p>
        )}
      </div>

      <div>
        <label className={lbl}>Highlights del programa <span className="font-normal text-gray-400">(uno por línea — salen como chips en la portada)</span></label>
        <textarea
          value={f.highlights}
          onChange={(e) => set("highlights", e.target.value)}
          rows={3}
          className={sel}
          placeholder={"Canal de Panamá\nComunidad Emberá\nPortobelo\nAgua Clara\nCasco Antiguo\nBiomuseo"}
        />
      </div>
      <div>
        <label className={lbl}>Observaciones internas <span className="font-normal text-gray-400">(NO salen en el PDF — tarifa neta, proveedor, markup, seguro/fee, política real del proveedor…)</span></label>
        <textarea value={f.notas} onChange={(e) => set("notas", e.target.value)} rows={3} className={sel} />
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {okMsg && <p className="text-sm text-green-600">Guardado ✓</p>}
      <Button type="submit" disabled={pending} style={{ backgroundColor: "var(--brand-primary)" }}>
        {pending ? "Guardando…" : submitLabel}
      </Button>
    </form>
  );
}
