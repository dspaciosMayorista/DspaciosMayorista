"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toleranciaCentavos, type ConteosViajeros } from "@/lib/reservar/solicitudHotel";
import { asignarNetaSolicitud } from "../../reservar/actions";

const num = (v: string) => Number(v.trim().replace(/\s/g, "").replace(/,/g, ""));
const dinero = (n: number) => n.toLocaleString("es-CO", { maximumFractionDigits: 2 });

/**
 * #120: el operador carga la neta TOTAL del hotel (toda la estadía y todas las habitaciones). Sin niños, el hotel se carga a los adultos (sin elección). Con niños elige
 * «Cargar hotel a los adultos» o «Distribuir» (neta por adulto y por niño para toda la estadía, que debe sumar la neta total). Los infantes siempre van con neta hotelera $0.
 * Los conteos salen de la solicitud guardada (servidor); el servidor vuelve a validar todo.
 */
export function NetaSolicitudForm({ cotizacionId, moneda, conteos, errorOcupacion }: { cotizacionId: number; moneda: string; conteos: ConteosViajeros | null; errorOcupacion?: string | null }) {
  const router = useRouter();
  const [pendiente, start] = useTransition();
  const [neta, setNeta] = useState("");
  const [modo, setModo] = useState<"adultos" | "distribuir">("adultos");
  const [netaAdulto, setNetaAdulto] = useState("");
  const [netaNino, setNetaNino] = useState("");
  const [error, setError] = useState<string | null>(null);

  if (!conteos) {
    return <p role="alert" className="text-sm text-red-700" data-testid="neta-sin-conteos">{errorOcupacion ?? "No se pudo contar a los viajeros de la solicitud."} Corrige la configuración del hotel (acomodaciones) o descarta la solicitud antes de valorarla.</p>;
  }
  const { adultos, ninos, infantes } = conteos;
  const total = num(neta);
  const suma = adultos * num(netaAdulto || "0") + ninos * num(netaNino || "0");
  const diferencia = suma - total;
  const cuadra = Number.isFinite(total) && total > 0 && Math.abs(diferencia) <= toleranciaCentavos(adultos + ninos);
  const puedeEnviar = Number.isFinite(total) && total > 0 && (modo === "adultos" || (num(netaAdulto) > 0 && num(netaNino) > 0 && cuadra));

  function enviar() {
    setError(null);
    start(async () => {
      const r = await asignarNetaSolicitud(cotizacionId, modo === "adultos" || ninos === 0 ? { netaTotal: neta } : { netaTotal: neta, modo: "distribuir", netaAdulto, netaNino, netaInfante: 0 });
      if (r.ok) router.refresh(); else setError(r.error);
    });
  }

  return (
    <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); enviar(); }} data-testid="neta-solicitud-form">
      <p className="text-sm text-gray-700" data-testid="neta-conteos">Viajeros de la solicitud: <strong>{adultos}</strong> adulto(s) · <strong>{ninos}</strong> niño(s) · <strong>{infantes}</strong> infante(s).</p>
      <div>
        <label className="block text-sm font-medium text-gray-700" htmlFor="neta-hotel">Neta TOTAL del hotel ({moneda}) — toda la estadía y todas las habitaciones</label>
        <Input id="neta-hotel" inputMode="decimal" value={neta} onChange={(e) => setNeta(e.target.value)} placeholder="0" className="mt-1 max-w-[220px]" />
      </div>

      {ninos === 0 ? (
        <p className="text-xs text-gray-600" data-testid="neta-sin-ninos">Sin niños: el hotel se carga a los adultos{infantes > 0 ? "; los infantes llevan neta hotelera $0" : ""}.</p>
      ) : (
        <fieldset className="space-y-2 rounded-lg border border-gray-200 p-3" data-testid="neta-reparto">
          <legend className="px-1 text-sm font-medium text-gray-700">¿Cómo se carga el hotel?</legend>
          <label className="flex items-center gap-2 text-sm"><input type="radio" name="modo" checked={modo === "adultos"} onChange={() => setModo("adultos")} /> Cargar hotel a los adultos <span className="text-xs text-gray-500">(niños e infantes: neta hotelera $0)</span></label>
          <label className="flex items-center gap-2 text-sm"><input type="radio" name="modo" checked={modo === "distribuir"} onChange={() => setModo("distribuir")} /> Distribuir <span className="text-xs text-gray-500">(neta por adulto y por niño; infantes $0)</span></label>
          {modo === "distribuir" && (
            <div className="grid grid-cols-1 gap-2 pt-1 sm:grid-cols-2">
              <div><label className="block text-xs text-gray-600" htmlFor="neta-adulto">Neta por ADULTO (toda la estadía) × {adultos}</label><Input id="neta-adulto" inputMode="decimal" value={netaAdulto} onChange={(e) => setNetaAdulto(e.target.value)} placeholder="0" /></div>
              <div><label className="block text-xs text-gray-600" htmlFor="neta-nino">Neta por NIÑO (toda la estadía) × {ninos}</label><Input id="neta-nino" inputMode="decimal" value={netaNino} onChange={(e) => setNetaNino(e.target.value)} placeholder="0" /></div>
              <p className="text-xs text-gray-600 sm:col-span-2">Infantes ({infantes}): neta hotelera <strong>$0</strong> (fija).</p>
              <p className="text-xs text-gray-600 sm:col-span-2" data-testid="neta-total-igual">El total vendido es el mismo que con «Cargar hotel a los adultos»: repartir cambia los importes por viajero, no el total. Si por el redondeo por persona queda un residuo, va en una línea «Ajuste de redondeo del reparto del hotel» (no cambia el costo ni la CxP).</p>
              <p className={`text-sm sm:col-span-2 ${cuadra ? "text-green-700" : "text-amber-700"}`} role="status" data-testid="neta-cuadre">
                {adultos} × {dinero(num(netaAdulto || "0"))} + {ninos} × {dinero(num(netaNino || "0"))} = {dinero(suma)} · neta total {dinero(Number.isFinite(total) ? total : 0)} ·{" "}
                {cuadra ? "cuadra" : total > 0 ? `${diferencia > 0 ? "sobran" : "faltan"} ${dinero(Math.abs(diferencia))}` : "indica la neta total"}
              </p>
            </div>
          )}
        </fieldset>
      )}

      <Button type="submit" disabled={pendiente || !puedeEnviar}>{pendiente ? "Calculando…" : "Cargar neta y valorar"}</Button>
      <p className="text-xs text-gray-500">Se aplica el markup del paquete y se calcula el total completo (vuelo, servicios y demás componentes). Al guardar, el precio y la distribución quedan congelados.</p>
      {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
    </form>
  );
}
