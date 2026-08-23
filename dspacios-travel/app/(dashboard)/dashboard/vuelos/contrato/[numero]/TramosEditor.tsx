"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ciudadIata } from "@/lib/iata";
import { guardarTramosContrato, type TramoInput } from "../../contrato-vuelos-actions";

const lbl = "mb-1 block text-[11px] font-medium text-gray-500";
const selCls = "w-full rounded-lg border border-gray-300 bg-white px-2 py-2 text-sm";

type TramoDB = {
  id: number;
  aerolinea: string | null;
  record: string | null;
  direccion: string | null;
  origen_codigo: string | null;
  origen_ciudad: string | null;
  destino_codigo: string | null;
  destino_ciudad: string | null;
  numero_vuelo: string | null;
  fecha_salida: string | null;
  hora_salida: string | null;
  hora_llegada: string | null;
  servicios: string | null;
};

function deDB(t: TramoDB): TramoInput {
  return {
    id: t.id,
    aerolinea: t.aerolinea ?? "",
    record: t.record ?? "",
    direccion: (t.direccion as TramoInput["direccion"]) ?? "",
    origenCodigo: t.origen_codigo ?? "",
    origenCiudad: t.origen_ciudad ?? "",
    destinoCodigo: t.destino_codigo ?? "",
    destinoCiudad: t.destino_ciudad ?? "",
    numeroVuelo: t.numero_vuelo ?? "",
    fecha: t.fecha_salida ?? "",
    horaSalida: t.hora_salida ?? "",
    horaLlegada: t.hora_llegada ?? "",
    servicios: t.servicios ?? "",
  };
}

const TRAMO_VACIO: TramoInput = {
  id: null, aerolinea: "", record: "", direccion: "", origenCodigo: "", origenCiudad: "",
  destinoCodigo: "", destinoCiudad: "", numeroVuelo: "", fecha: "", horaSalida: "", horaLlegada: "", servicios: "",
};

// Editor de TODOS los tramos de contrato_vuelos de un contrato (migración
// 157) — reemplazo atómico vía `guardar_tramos_contrato()`, conserva `id`
// cuando ya existía. Mismo shape de tarjeta que la sección "Vuelos" de
// ContenidoContratoEditor (superadmin-only, ficha financiera completa) pero
// en una pantalla standalone accesible también para `control_vuelo`.
export function TramosEditor({ numeroContrato, tramosIniciales }: { numeroContrato: string; tramosIniciales: TramoDB[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState("");
  const [ok, setOk] = useState(false);
  const [tramos, setTramos] = useState<TramoInput[]>(
    tramosIniciales.length ? tramosIniciales.map(deDB) : [TRAMO_VACIO]
  );

  function set(i: number, patch: Partial<TramoInput>) {
    setTramos((a) => a.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  }

  function setOrigen(i: number, codigo: string) {
    const c = codigo.toUpperCase();
    set(i, { origenCodigo: c, origenCiudad: ciudadIata(c) ?? tramos[i].origenCiudad });
  }
  function setDestino(i: number, codigo: string) {
    const c = codigo.toUpperCase();
    set(i, { destinoCodigo: c, destinoCiudad: ciudadIata(c) ?? tramos[i].destinoCiudad });
  }

  function agregarTramo() {
    setTramos((a) => [...a, { ...TRAMO_VACIO }]);
  }

  function agregarRegreso(i: number) {
    const v = tramos[i];
    setTramos((a) => [
      ...a,
      {
        ...TRAMO_VACIO,
        aerolinea: v.aerolinea, record: v.record, direccion: "regreso",
        origenCodigo: v.destinoCodigo, origenCiudad: v.destinoCiudad,
        destinoCodigo: v.origenCodigo, destinoCiudad: v.origenCiudad,
      },
    ]);
  }

  function quitar(i: number) {
    setTramos((a) => a.filter((_, j) => j !== i));
  }

  function guardar() {
    setMsg(""); setOk(false);
    if (!tramos.length) { setMsg("Debe haber al menos un tramo."); return; }
    start(async () => {
      const r = await guardarTramosContrato(numeroContrato, tramos);
      if (r.ok) {
        // Sincroniza el estado local con los tramos YA guardados (id reales
        // incluidos) — nunca basta con router.refresh(): eso re-renderiza el
        // Server Component, pero NO toca el useState de este cliente. Sin
        // esto, un tramo recién creado (id:null al enviarlo) seguía viéndose
        // como id:null en memoria, así que el siguiente guardado lo borraba
        // y lo reinsertaba con un id DISTINTO en vez de conservarlo.
        setTramos(r.tramos.length ? r.tramos.map(deDB) : [TRAMO_VACIO]);
        setOk(true); setMsg("Vuelo guardado."); router.refresh();
      } else {
        setOk(false); setMsg(r.error);
      }
    });
  }

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4">
      <p className="mb-1 text-sm font-semibold text-gray-700">Vuelo del contrato</p>
      <p className="mb-3 text-xs text-gray-500">
        Cada tarjeta es UN tramo. Un viaje redondo son dos (ida y regreso); un contrato con más de dos ciudades
        puede tener más — no se limita a ida/regreso.
      </p>

      <div className="space-y-3">
        {tramos.map((v, i) => (
          <div key={v.id ?? `nuevo-${i}`} className="grid grid-cols-2 gap-2 rounded-lg bg-gray-50 p-3 md:grid-cols-4">
            <div><label className={lbl}>Aerolínea</label><Input value={v.aerolinea} onChange={(e) => set(i, { aerolinea: e.target.value })} maxLength={80} /></div>
            <div><label className={lbl}>Record (PNR)</label><Input value={v.record} onChange={(e) => set(i, { record: e.target.value })} maxLength={20} /></div>
            <div>
              <label className={lbl}>Tramo</label>
              <select className={selCls} value={v.direccion} onChange={(e) => set(i, { direccion: e.target.value as TramoInput["direccion"] })}>
                <option value="">Suelto (multi-ciudad)</option>
                <option value="ida">Ida</option>
                <option value="regreso">Regreso</option>
              </select>
            </div>
            <div><label className={lbl}>N.° de vuelo</label><Input value={v.numeroVuelo} onChange={(e) => set(i, { numeroVuelo: e.target.value })} maxLength={15} /></div>
            <div><label className={lbl}>Origen (IATA)</label><Input value={v.origenCodigo} onChange={(e) => setOrigen(i, e.target.value)} maxLength={3} /></div>
            <div><label className={lbl}>Destino (IATA)</label><Input value={v.destinoCodigo} onChange={(e) => setDestino(i, e.target.value)} maxLength={3} /></div>
            <div><label className={lbl}>Fecha</label><Input type="date" value={v.fecha} onChange={(e) => set(i, { fecha: e.target.value })} /></div>
            <div><label className={lbl}>Hora salida</label><Input value={v.horaSalida} onChange={(e) => set(i, { horaSalida: e.target.value })} maxLength={5} /></div>
            <div><label className={lbl}>Hora llegada</label><Input value={v.horaLlegada} onChange={(e) => set(i, { horaLlegada: e.target.value })} maxLength={5} /></div>
            <div className="md:col-span-2"><label className={lbl}>Equipaje / servicios</label><Input value={v.servicios} onChange={(e) => set(i, { servicios: e.target.value })} maxLength={500} /></div>
            <div className="flex items-end gap-3">
              {v.direccion === "ida" && (
                <button type="button" className="pb-2 text-xs font-medium text-[#1D7C9A] hover:underline" onClick={() => agregarRegreso(i)}>
                  + Agregar regreso
                </button>
              )}
              <button type="button" className="pb-2 text-xs text-gray-400 hover:text-red-500" onClick={() => quitar(i)}>Quitar</button>
            </div>
          </div>
        ))}
      </div>

      <button type="button" className="mt-3 text-xs font-medium text-[#1D7C9A] hover:underline" onClick={agregarTramo}>
        + Agregar tramo
      </button>

      <div className="mt-4 flex items-center gap-3">
        <Button onClick={guardar} disabled={pending} style={{ backgroundColor: "var(--brand-primary)" }}>
          {pending ? "Guardando…" : "Guardar vuelo"}
        </Button>
        {msg && <span className={`text-sm ${ok ? "text-green-700" : "text-red-600"}`}>{msg}</span>}
      </div>
    </section>
  );
}
