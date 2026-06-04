"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatMoneda } from "@/lib/utils";
import { reservarPrograma } from "../../actions";

export type CategoriaReserva = {
  id: number;
  nombre: string;
  precios: { acomodacion: string; pvp: number | null; bajoSolicitud: boolean }[];
};

const ACOM_LABEL: Record<string, string> = { sencilla: "Sencilla", doble: "Doble", triple: "Triple", cuadruple: "Cuádruple", nino: "Niño" };
const lbl = "mb-1 block text-xs font-medium text-gray-600";
const sel = "w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm";

type Pasajero = { nombres: string; apellidos: string; tipoDoc: string; numeroDoc: string; fechaNacimiento: string; nacionalidad: string };
const pasajeroVacio = (): Pasajero => ({ nombres: "", apellidos: "", tipoDoc: "CC", numeroDoc: "", fechaNacimiento: "", nacionalidad: "Colombiana" });

export function ProgramaReservaForm({
  programaId,
  moneda,
  dias,
  vigenciaDesde,
  vigenciaHasta,
  categorias,
  asesores,
}: {
  programaId: number;
  moneda: string;
  dias: number | null;
  vigenciaDesde: string | null;
  vigenciaHasta: string | null;
  categorias: CategoriaReserva[];
  asesores: { nombre: string; email: string }[];
}) {
  const router = useRouter();
  const [categoriaId, setCategoriaId] = useState<number>(categorias[0]?.id ?? 0);
  const cat = categorias.find((c) => c.id === categoriaId) ?? categorias[0];

  // Acomodaciones (excepto niño) con precio disponible
  const acomsAdulto = cat.precios.filter((p) => p.acomodacion !== "nino" && p.pvp != null && !p.bajoSolicitud);
  const precioNino = cat.precios.find((p) => p.acomodacion === "nino" && p.pvp != null && !p.bajoSolicitud)?.pvp ?? null;

  const [pax, setPax] = useState<Record<string, number>>({});
  const [ninos, setNinos] = useState(0);
  const [fechaIda, setFechaIda] = useState("");

  const [cliente, setCliente] = useState({ nombres: "", apellidos: "", tipoDoc: "CC", numeroDoc: "", telefono: "", email: "" });
  const [tipoAsesor, setTipoAsesor] = useState<"interno" | "agencia" | "freelance">("interno");
  const [asesorInterno, setAsesorInterno] = useState(asesores[0]?.email ?? "");
  const [agenciaNombre, setAgenciaNombre] = useState("");
  const [agenciaAsesor, setAgenciaAsesor] = useState("");
  const [freelanceNombre, setFreelanceNombre] = useState("");
  const [plazo, setPlazo] = useState("");

  const totalPax = useMemo(
    () => Object.values(pax).reduce((s, n) => s + (Number(n) || 0), 0) + (Number(ninos) || 0),
    [pax, ninos]
  );

  const total = useMemo(() => {
    let t = 0;
    for (const a of acomsAdulto) t += (a.pvp ?? 0) * (Number(pax[a.acomodacion]) || 0);
    if (precioNino != null) t += precioNino * (Number(ninos) || 0);
    return t;
  }, [acomsAdulto, pax, ninos, precioNino]);

  // Pasajeros: tantos como pax total
  const [pasajeros, setPasajeros] = useState<Pasajero[]>([]);
  const sincronizarPasajeros = (n: number) => {
    setPasajeros((prev) => {
      const arr = [...prev];
      while (arr.length < n) arr.push(pasajeroVacio());
      arr.length = n;
      return arr;
    });
  };
  // Mantener el número de pasajeros sincronizado al cambiar pax.
  if (pasajeros.length !== totalPax) sincronizarPasajeros(totalPax);

  const updPax = (acom: string, v: string) => setPax((p) => ({ ...p, [acom]: Number(v) || 0 }));
  const updPasajero = (i: number, k: keyof Pasajero, v: string) =>
    setPasajeros((p) => p.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  const copiarCliente = (i: number) =>
    setPasajeros((p) => p.map((x, j) => (j === i ? { ...x, nombres: cliente.nombres, apellidos: cliente.apellidos, tipoDoc: cliente.tipoDoc, numeroDoc: cliente.numeroDoc } : x)));

  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!fechaIda) return setError("Elige la fecha de salida.");
    if (totalPax <= 0) return setError("Indica cuántos pasajeros van en cada acomodación.");
    if (!`${cliente.nombres}${cliente.apellidos}`.trim()) return setError("El nombre del cliente es obligatorio.");
    startTransition(async () => {
      const res = await reservarPrograma({
        programaId,
        categoriaId,
        fechaIda,
        paxPorAcom: pax,
        ninos: Number(ninos) || 0,
        cliente,
        tipoAsesor,
        asesorInterno,
        agenciaNombre,
        agenciaAsesor,
        freelanceNombre,
        plazo,
        pasajeros: pasajeros.map((p) => ({
          nombres: p.nombres,
          apellidos: p.apellidos,
          tipoDoc: p.tipoDoc,
          numeroDoc: p.numeroDoc,
          fechaNacimiento: p.fechaNacimiento,
          nacionalidad: p.nacionalidad,
          esInfante: false,
        })),
      });
      if (!res.ok) return setError(res.error);
      router.push(`/dashboard/contratos/${encodeURIComponent(res.numero)}`);
    });
  }

  return (
    <form onSubmit={submit} className="space-y-6">
      {/* Categoría + fecha */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className={lbl}>Categoría (hoteles)</label>
          <select value={categoriaId} onChange={(e) => setCategoriaId(Number(e.target.value))} className={sel}>
            {categorias.map((c) => (
              <option key={c.id} value={c.id}>{c.nombre}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={lbl}>Fecha de salida</label>
          <Input type="date" value={fechaIda} min={vigenciaDesde ?? undefined} max={vigenciaHasta ?? undefined} onChange={(e) => setFechaIda(e.target.value)} />
          {dias ? <p className="mt-1 text-xs text-gray-400">Regreso estimado a {dias} días de la salida.</p> : null}
        </div>
      </div>

      {/* Pax por acomodación */}
      <div>
        <label className={lbl}>Pasajeros por acomodación (precio por persona)</label>
        <div className="flex flex-wrap gap-3">
          {acomsAdulto.map((a) => (
            <div key={a.acomodacion} className="w-36 rounded-lg border border-gray-200 bg-white p-2">
              <div className="text-xs text-gray-500">{ACOM_LABEL[a.acomodacion] ?? a.acomodacion}</div>
              <div className="mb-1 text-xs font-medium" style={{ color: "var(--brand-primary)" }}>{formatMoneda(a.pvp ?? 0, moneda)}</div>
              <Input type="number" min={0} value={pax[a.acomodacion] ?? ""} onChange={(e) => updPax(a.acomodacion, e.target.value)} placeholder="0" />
            </div>
          ))}
          {precioNino != null && (
            <div className="w-36 rounded-lg border border-gray-200 bg-white p-2">
              <div className="text-xs text-gray-500">Niños</div>
              <div className="mb-1 text-xs font-medium" style={{ color: "var(--brand-primary)" }}>{formatMoneda(precioNino, moneda)}</div>
              <Input type="number" min={0} value={ninos || ""} onChange={(e) => setNinos(Number(e.target.value) || 0)} placeholder="0" />
            </div>
          )}
        </div>
        {acomsAdulto.length === 0 && (
          <p className="mt-2 text-sm text-amber-700">Esta categoría no tiene precios publicados (revisa “a solicitud”).</p>
        )}
      </div>

      {/* Total */}
      <div className="flex items-center justify-between rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
        <span className="text-sm text-gray-600">{totalPax} pasajero(s)</span>
        <span className="text-lg font-semibold" style={{ color: "var(--brand-primary)" }}>{formatMoneda(total, moneda)}</span>
      </div>

      {/* Cliente */}
      <fieldset className="rounded-xl border border-gray-200 p-4">
        <legend className="px-1 text-sm font-semibold text-gray-700">Cliente</legend>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div><label className={lbl}>Nombres</label><Input value={cliente.nombres} onChange={(e) => setCliente({ ...cliente, nombres: e.target.value })} /></div>
          <div><label className={lbl}>Apellidos</label><Input value={cliente.apellidos} onChange={(e) => setCliente({ ...cliente, apellidos: e.target.value })} /></div>
          <div><label className={lbl}>Tipo doc.</label>
            <select value={cliente.tipoDoc} onChange={(e) => setCliente({ ...cliente, tipoDoc: e.target.value })} className={sel}>
              <option>CC</option><option>CE</option><option>PASAPORTE</option><option>TI</option>
            </select>
          </div>
          <div><label className={lbl}>Documento</label><Input value={cliente.numeroDoc} onChange={(e) => setCliente({ ...cliente, numeroDoc: e.target.value })} /></div>
          <div><label className={lbl}>Teléfono</label><Input value={cliente.telefono} onChange={(e) => setCliente({ ...cliente, telefono: e.target.value })} /></div>
          <div><label className={lbl}>Email</label><Input value={cliente.email} onChange={(e) => setCliente({ ...cliente, email: e.target.value })} /></div>
        </div>
      </fieldset>

      {/* Pasajeros */}
      {pasajeros.length > 0 && (
        <fieldset className="rounded-xl border border-gray-200 p-4">
          <legend className="px-1 text-sm font-semibold text-gray-700">Pasajeros ({pasajeros.length})</legend>
          <div className="space-y-3">
            {pasajeros.map((p, i) => (
              <div key={i} className="rounded-lg border border-gray-100 bg-gray-50 p-3">
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-xs font-medium text-gray-500">Pasajero {i + 1}</span>
                  <button type="button" onClick={() => copiarCliente(i)} className="text-xs text-[#1D7C9A] hover:underline">Copiar del cliente</button>
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  <Input value={p.nombres} onChange={(e) => updPasajero(i, "nombres", e.target.value)} placeholder="Nombres" />
                  <Input value={p.apellidos} onChange={(e) => updPasajero(i, "apellidos", e.target.value)} placeholder="Apellidos" />
                  <select value={p.tipoDoc} onChange={(e) => updPasajero(i, "tipoDoc", e.target.value)} className={sel}>
                    <option>CC</option><option>CE</option><option>PASAPORTE</option><option>TI</option>
                  </select>
                  <Input value={p.numeroDoc} onChange={(e) => updPasajero(i, "numeroDoc", e.target.value)} placeholder="Documento" />
                  <Input type="date" value={p.fechaNacimiento} onChange={(e) => updPasajero(i, "fechaNacimiento", e.target.value)} />
                  <Input value={p.nacionalidad} onChange={(e) => updPasajero(i, "nacionalidad", e.target.value)} placeholder="Nacionalidad" />
                </div>
              </div>
            ))}
          </div>
        </fieldset>
      )}

      {/* Tipo de venta */}
      <fieldset className="rounded-xl border border-gray-200 p-4">
        <legend className="px-1 text-sm font-semibold text-gray-700">Tipo de venta</legend>
        <div className="mb-3 flex flex-wrap gap-3 text-sm">
          {(["interno", "agencia", "freelance"] as const).map((t) => (
            <label key={t} className="flex items-center gap-1">
              <input type="radio" checked={tipoAsesor === t} onChange={() => setTipoAsesor(t)} /> {t === "interno" ? "Interno (B2C)" : t === "agencia" ? "Agencia (B2B)" : "Freelance (B2B)"}
            </label>
          ))}
        </div>
        {tipoAsesor === "interno" && (
          <div>
            <label className={lbl}>Asesor</label>
            <select value={asesorInterno} onChange={(e) => setAsesorInterno(e.target.value)} className={sel}>
              {asesores.map((a) => <option key={a.email} value={a.email}>{a.nombre}</option>)}
            </select>
          </div>
        )}
        {tipoAsesor === "agencia" && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div><label className={lbl}>Agencia</label><Input value={agenciaNombre} onChange={(e) => setAgenciaNombre(e.target.value)} /></div>
            <div><label className={lbl}>Asesor de la agencia</label><Input value={agenciaAsesor} onChange={(e) => setAgenciaAsesor(e.target.value)} /></div>
          </div>
        )}
        {tipoAsesor === "freelance" && (
          <div><label className={lbl}>Freelance</label><Input value={freelanceNombre} onChange={(e) => setFreelanceNombre(e.target.value)} /></div>
        )}
        <div className="mt-3">
          <label className={lbl}>Plazo de pago (opcional)</label>
          <Input type="date" value={plazo} onChange={(e) => setPlazo(e.target.value)} className="w-48" />
        </div>
      </fieldset>

      {error && <p className="text-sm text-red-600">{error}</p>}
      <Button type="submit" disabled={pending} style={{ backgroundColor: "var(--brand-primary)" }}>
        {pending ? "Generando…" : "Generar reserva"}
      </Button>
    </form>
  );
}
