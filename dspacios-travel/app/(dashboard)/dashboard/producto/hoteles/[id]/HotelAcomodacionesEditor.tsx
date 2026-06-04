"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ACOM_ROOMS, ACOM_ROOM_LABEL, defaultAcomConfig, type AcomConfig, type AcomRoom } from "@/lib/acomodaciones";
import { actualizarHotelAcomodaciones } from "../actions";

const lbl = "mb-1 block text-xs font-medium text-gray-600";

type Estado = Record<AcomRoom, AcomConfig>;

function estadoInicial(configs: AcomConfig[]): Estado {
  const out = {} as Estado;
  for (const a of ACOM_ROOMS) {
    out[a] = configs.find((c) => c.acomodacion === a) ?? defaultAcomConfig(a);
  }
  return out;
}

export function HotelAcomodacionesEditor({
  hotelId,
  paxMin,
  paxMax,
  configs,
}: {
  hotelId: number;
  paxMin: number | null;
  paxMax: number | null;
  configs: AcomConfig[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pMin, setPMin] = useState(paxMin == null ? "" : String(paxMin));
  const [pMax, setPMax] = useState(paxMax == null ? "" : String(paxMax));
  const [estado, setEstado] = useState<Estado>(() => estadoInicial(configs));
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState("");

  function set(a: AcomRoom, k: keyof AcomConfig, v: string) {
    setEstado((prev) => ({ ...prev, [a]: { ...prev[a], [k]: Number(v) || 0 } }));
  }

  function guardar() {
    setMsg("");
    start(async () => {
      const r = await actualizarHotelAcomodaciones(hotelId, {
        paxMin: pMin.trim() === "" ? null : Number(pMin) || 0,
        paxMax: pMax.trim() === "" ? null : Number(pMax) || 0,
        acomodaciones: ACOM_ROOMS.map((a) => estado[a]),
      });
      if (r.ok) { setMsg("Guardado."); router.refresh(); } else setMsg(r.error);
    });
  }

  const numCell = (a: AcomRoom, k: keyof AcomConfig) => (
    <Input
      type="number"
      min={0}
      value={String(estado[a][k] as number)}
      onChange={(e) => set(a, k, e.target.value)}
      className="h-8 px-2 py-1 text-sm"
    />
  );

  return (
    <section className="mb-6 rounded-xl border border-gray-200 bg-white">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between px-4 py-3 text-left">
        <span className="text-sm font-semibold text-gray-700">Acomodaciones (reservar por habitaciones)</span>
        <span className="text-gray-400">{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <div className="space-y-4 border-t border-gray-100 p-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div><label className={lbl}>Pax mín. del hotel</label><Input type="number" min={0} value={pMin} onChange={(e) => setPMin(e.target.value)} placeholder="—" /></div>
            <div><label className={lbl}>Pax máx. del hotel</label><Input type="number" min={0} value={pMax} onChange={(e) => setPMax(e.target.value)} placeholder="—" /></div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-500">
                  <th className="pb-2 pr-3 font-medium">Acomodación</th>
                  <th className="pb-2 px-2 font-medium" title="Pax que cubre la tarifa por persona de 1 habitación">Pax tarifa</th>
                  <th className="pb-2 px-2 font-medium">Pax máx.</th>
                  <th className="pb-2 px-2 font-medium">Adt mín.</th>
                  <th className="pb-2 px-2 font-medium">Adt máx.</th>
                  <th className="pb-2 px-2 font-medium">Niño mín.</th>
                  <th className="pb-2 px-2 font-medium">Niño máx.</th>
                  <th className="pb-2 px-2 font-medium">Inf. mín.</th>
                  <th className="pb-2 px-2 font-medium">Inf. máx.</th>
                </tr>
              </thead>
              <tbody>
                {ACOM_ROOMS.map((a) => (
                  <tr key={a} className="border-t border-gray-100">
                    <td className="py-2 pr-3 font-medium text-gray-700">{ACOM_ROOM_LABEL[a]}</td>
                    <td className="px-2">{numCell(a, "pax_tarifa")}</td>
                    <td className="px-2">{numCell(a, "pax_max")}</td>
                    <td className="px-2">{numCell(a, "adt_min")}</td>
                    <td className="px-2">{numCell(a, "adt_max")}</td>
                    <td className="px-2">{numCell(a, "chd_min")}</td>
                    <td className="px-2">{numCell(a, "chd_max")}</td>
                    <td className="px-2">{numCell(a, "inf_min")}</td>
                    <td className="px-2">{numCell(a, "inf_max")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-gray-400">
            <b>Pax tarifa</b>: pax que cubre la tarifa por persona de una habitación (1 hab Doble = tarifa doble × 2).
            Los mín./máx. de adultos, niños e infantes validan que los pasajeros cuadren con las habitaciones elegidas.
          </p>

          <div className="flex items-center gap-3">
            <Button onClick={guardar} disabled={pending} style={{ backgroundColor: "var(--brand-primary)" }}>
              {pending ? "Guardando…" : "Guardar acomodaciones"}
            </Button>
            {msg && <span className="text-sm text-gray-600">{msg}</span>}
          </div>
        </div>
      )}
    </section>
  );
}
