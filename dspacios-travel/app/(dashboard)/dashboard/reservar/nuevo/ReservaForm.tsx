"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatCOP } from "@/lib/utils";
import { reservarDesdeTarifario, type PasajeroReserva } from "../actions";

export type Meta = {
  paqueteId: number;
  hotelId: number;
  bloqueoId: number | null;
  modulo: "bloqueo" | "porcion_terrestre";
  hotelNombre: string;
  destino: string;
  fechaIda: string | null;
  fechaRegreso: string | null;
  noches: number | null;
  bloqueoLabel: string | null;
};
export type Combo = { categoria: string; regimen: string; precios: Record<string, number> };

const ACOMS: [string, string][] = [
  ["sencilla", "Sencilla"], ["doble", "Doble"], ["triple", "Triple"],
  ["multiple", "Múltiple"], ["nino", "Niño 1"], ["nino2", "Niño 2"],
];
const lbl = "mb-1 block text-xs font-medium text-gray-600";
const inp = "w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm";

export function ReservaForm({ meta, combos }: { meta: Meta; combos: Combo[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");

  const categorias = useMemo(() => [...new Set(combos.map((c) => c.categoria))], [combos]);
  const [cat, setCat] = useState(categorias[0] ?? "");
  const regimenes = useMemo(() => combos.filter((c) => c.categoria === cat).map((c) => c.regimen), [combos, cat]);
  const [regState, setRegState] = useState("");
  const reg = regimenes.includes(regState) ? regState : (regimenes[0] ?? "");

  const combo = combos.find((c) => c.categoria === cat && c.regimen === reg);
  const precios = combo?.precios ?? {};

  const [cant, setCant] = useState<Record<string, string>>({});
  const [infantes, setInfantes] = useState("0");

  const paxConSilla = ACOMS.reduce((s, [k]) => (precios[k] != null ? s + (Number(cant[k]) || 0) : s), 0);
  const numInfantes = Number(infantes) || 0;
  const totalPax = paxConSilla + numInfantes;
  const totalPrecio = ACOMS.reduce((s, [k]) => (precios[k] != null ? s + (Number(cant[k]) || 0) * precios[k]! : s), 0);

  // Cliente
  const [cli, setCli] = useState({ nombre: "", tipoDoc: "CC", numeroDoc: "", telefono: "", email: "" });

  // Tipo de venta
  const [tipoAsesor, setTipoAsesor] = useState<"interno" | "agencia" | "freelance">("interno");
  const [asesorInterno, setAsesorInterno] = useState("");
  const [agenciaNombre, setAgenciaNombre] = useState("");
  const [agenciaAsesor, setAgenciaAsesor] = useState("");
  const [freelanceNombre, setFreelanceNombre] = useState("");
  const [plazo, setPlazo] = useState("");

  // Pasajeros: la cantidad de filas se deriva del total; los datos se guardan
  // en `pax` (se extiende según se editen).
  const emptyPax = (): PasajeroReserva => ({ nombre: "", tipoDoc: "CC", numeroDoc: "", fechaNacimiento: "", nacionalidad: "Colombiana", esInfante: false });
  const [pax, setPax] = useState<PasajeroReserva[]>([]);
  const paxRows = Array.from({ length: totalPax }, (_, i) => pax[i] ?? emptyPax());

  function setPaxField(i: number, k: keyof PasajeroReserva, v: string) {
    setPax((prev) => {
      const next = [...prev];
      while (next.length <= i) next.push(emptyPax());
      next[i] = { ...next[i], [k]: v };
      return next;
    });
  }
  function copiarCliente(i: number) {
    setPax((prev) => {
      const next = [...prev];
      while (next.length <= i) next.push(emptyPax());
      next[i] = { ...next[i], nombre: cli.nombre, tipoDoc: cli.tipoDoc, numeroDoc: cli.numeroDoc };
      return next;
    });
  }

  function guardar() {
    if (!cli.nombre.trim()) { setErr("El nombre del cliente es obligatorio."); return; }
    if (paxConSilla <= 0) { setErr("Indica al menos un pasajero por acomodación."); return; }
    setErr("");
    const cantidades: Record<string, number> = {};
    for (const [k] of ACOMS) if (precios[k] != null && Number(cant[k]) > 0) cantidades[k] = Number(cant[k]);
    const pasajeros = paxRows.map((p, idx) => ({ ...p, esInfante: idx >= paxConSilla }));
    start(async () => {
      const r = await reservarDesdeTarifario({
        paqueteId: meta.paqueteId, bloqueoId: meta.bloqueoId, modulo: meta.modulo, hotelId: meta.hotelId,
        categoria: cat, regimen: reg, cantidades, infantes: numInfantes,
        cliente: cli, tipoAsesor, asesorInterno, agenciaNombre, agenciaAsesor, freelanceNombre, plazo, pasajeros,
      });
      if (r.ok) router.push(`/dashboard/contratos/${r.numero}`);
      else setErr(r.error);
    });
  }

  return (
    <div className="space-y-5">
      {/* Acomodación */}
      <section className="rounded-xl border border-gray-200 bg-white p-5">
        <p className="mb-3 text-sm font-semibold" style={{ color: "var(--brand-primary)" }}>Acomodación y cantidades</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className={lbl}>Categoría</label>
            <select value={cat} onChange={(e) => setCat(e.target.value)} className={inp}>
              {categorias.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className={lbl}>Régimen</label>
            <select value={reg} onChange={(e) => setRegState(e.target.value)} className={inp}>
              {regimenes.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {ACOMS.filter(([k]) => precios[k] != null).map(([k, label]) => (
            <div key={k}>
              <label className={lbl}>{label} · {formatCOP(precios[k]!)}</label>
              <Input type="number" min={0} value={cant[k] ?? ""} onChange={(e) => setCant({ ...cant, [k]: e.target.value })} placeholder="0" />
            </div>
          ))}
          <div>
            <label className={lbl}>Infantes (sin silla, $0)</label>
            <Input type="number" min={0} value={infantes} onChange={(e) => setInfantes(e.target.value)} />
          </div>
        </div>
        <p className="mt-3 text-sm text-gray-600">
          {totalPax} pasajero(s) · Total <b style={{ color: "var(--brand-primary)" }}>{formatCOP(totalPrecio)}</b>
        </p>
      </section>

      {/* Cliente */}
      <section className="rounded-xl border border-gray-200 bg-white p-5">
        <p className="mb-3 text-sm font-semibold" style={{ color: "var(--brand-primary)" }}>Cliente</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2"><label className={lbl}>Nombre *</label><Input value={cli.nombre} onChange={(e) => setCli({ ...cli, nombre: e.target.value })} /></div>
          <div>
            <label className={lbl}>Tipo doc</label>
            <select value={cli.tipoDoc} onChange={(e) => setCli({ ...cli, tipoDoc: e.target.value })} className={inp}>
              <option value="CC">CC</option><option value="CE">CE</option><option value="PAS">Pasaporte</option><option value="TI">TI</option>
            </select>
          </div>
          <div><label className={lbl}>Número doc</label><Input value={cli.numeroDoc} onChange={(e) => setCli({ ...cli, numeroDoc: e.target.value })} /></div>
          <div><label className={lbl}>Teléfono</label><Input value={cli.telefono} onChange={(e) => setCli({ ...cli, telefono: e.target.value })} /></div>
          <div><label className={lbl}>Email</label><Input type="email" value={cli.email} onChange={(e) => setCli({ ...cli, email: e.target.value })} /></div>
        </div>
      </section>

      {/* Tipo de venta */}
      <section className="rounded-xl border border-gray-200 bg-white p-5">
        <p className="mb-3 text-sm font-semibold" style={{ color: "var(--brand-primary)" }}>Tipo de venta</p>
        <div className="flex flex-wrap gap-4 text-sm">
          {([["interno", "Asesor interno (B2C)"], ["agencia", "Agencia (B2B)"], ["freelance", "Freelance (B2B)"]] as const).map(([v, label]) => (
            <label key={v} className="flex items-center gap-1">
              <input type="radio" checked={tipoAsesor === v} onChange={() => setTipoAsesor(v)} /> {label}
            </label>
          ))}
        </div>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {tipoAsesor === "interno" && (
            <div><label className={lbl}>Asesor interno</label><Input value={asesorInterno} onChange={(e) => setAsesorInterno(e.target.value)} /></div>
          )}
          {tipoAsesor === "agencia" && (
            <>
              <div><label className={lbl}>Nombre de la agencia</label><Input value={agenciaNombre} onChange={(e) => setAgenciaNombre(e.target.value)} /></div>
              <div><label className={lbl}>Asesor de la agencia</label><Input value={agenciaAsesor} onChange={(e) => setAgenciaAsesor(e.target.value)} /></div>
            </>
          )}
          {tipoAsesor === "freelance" && (
            <div><label className={lbl}>Nombre del freelance</label><Input value={freelanceNombre} onChange={(e) => setFreelanceNombre(e.target.value)} /></div>
          )}
          <div><label className={lbl}>Plazo para confirmar</label><Input type="date" value={plazo} onChange={(e) => setPlazo(e.target.value)} /></div>
        </div>
      </section>

      {/* Pasajeros */}
      <section className="rounded-xl border border-gray-200 bg-white p-5">
        <p className="mb-3 text-sm font-semibold" style={{ color: "var(--brand-primary)" }}>Pasajeros ({totalPax})</p>
        {!totalPax ? (
          <p className="text-sm text-gray-400">Indica cantidades arriba para capturar pasajeros.</p>
        ) : (
          <div className="space-y-3">
            {paxRows.map((p, i) => {
              const esInfante = i >= paxConSilla;
              return (
                <div key={i} className="rounded-lg border border-gray-100 p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-xs font-medium text-gray-500">
                      Pasajero {i + 1}{esInfante ? " · Infante" : ""}
                    </span>
                    {i === 0 && (
                      <button type="button" onClick={() => copiarCliente(0)} className="text-xs" style={{ color: "var(--brand-accent)" }}>
                        Copiar datos del cliente
                      </button>
                    )}
                  </div>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                    <div className="sm:col-span-2"><label className={lbl}>Nombre</label><Input value={p.nombre} onChange={(e) => setPaxField(i, "nombre", e.target.value)} /></div>
                    <div>
                      <label className={lbl}>Tipo doc</label>
                      <select value={p.tipoDoc} onChange={(e) => setPaxField(i, "tipoDoc", e.target.value)} className={inp}>
                        <option value="CC">CC</option><option value="CE">CE</option><option value="PAS">Pasaporte</option><option value="TI">TI</option><option value="RC">RC</option>
                      </select>
                    </div>
                    <div><label className={lbl}>Número doc</label><Input value={p.numeroDoc} onChange={(e) => setPaxField(i, "numeroDoc", e.target.value)} /></div>
                    <div><label className={lbl}>Fecha nacimiento</label><Input type="date" value={p.fechaNacimiento} onChange={(e) => setPaxField(i, "fechaNacimiento", e.target.value)} /></div>
                    <div><label className={lbl}>Nacionalidad</label><Input value={p.nacionalidad} onChange={(e) => setPaxField(i, "nacionalidad", e.target.value)} /></div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {err && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{err}</p>}
      <div className="flex justify-end">
        <Button onClick={guardar} disabled={pending} style={{ backgroundColor: "var(--brand-primary)" }}>
          {pending ? "Generando…" : "Generar contrato (pendiente)"}
        </Button>
      </div>
    </div>
  );
}
