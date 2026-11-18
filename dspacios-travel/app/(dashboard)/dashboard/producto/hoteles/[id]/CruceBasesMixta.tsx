"use client";
// #125 — Calculadora Mixta: una promoción % que cruza varias temporadas base ya no se queda en un aviso. Se muestra su plan por noche (base ganadora, %, tarifa con
// promoción) y, con una confirmación explícita, se pasa al modo «seguir la base ganadora cada noche» (el mismo de «Reglas por grupo»). Nunca escribe filas de
// tarifa: el precio de cada noche lo calcula el motor compartido sobre la base que gana esa noche. Una promoción que ya está en ese modo solo lo informa.
import { useMemo, useState, useTransition } from "react";
import { GitMerge } from "lucide-react";
import { Button } from "@/components/ui/button";
import { planPromoPorNoche, vigenciasConGrupos } from "@/lib/calc/promoCalculadora";
import type { TemporadaRango } from "@/lib/calc/paquetes";
import type { TarifaGenerada } from "@/lib/calc/calculadoras";
import { guardarReglasPromocion } from "../actions";
import { PlanPromoPorNoche } from "./PlanPromoPorNoche";

export type PromoCruce = { nombre: string; /** true = ya sigue la base ganadora */ activa: boolean };

export const TEXTO_SIGUE_ACTIVA = "Se calcula por noche sobre la base ganadora";

function UnaPromo({ promo, hotelId, vigencias, regimen, filas, moneda }: {
  promo: PromoCruce; hotelId: number; vigencias: TemporadaRango[]; regimen: string; filas: TarifaGenerada[]; moneda?: string | null;
}) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState("");
  const [categoria, setCategoria] = useState("");
  const v = vigencias.find((x) => x.nombre.trim() === promo.nombre && (x.tipo ?? "tarifa") === "descuento_pct");
  const pct = Number(v?.descuento_valor);
  const hayGrupos = vigenciasConGrupos(vigencias).size > 0;
  const bases = useMemo(() => new Set(vigencias.filter((x) => (x.tipo ?? "tarifa") === "tarifa").map((x) => x.nombre.trim())), [vigencias]);
  const categorias = useMemo(
    () => [...new Set(filas.filter((f) => bases.has(f.temporada) && f.neto_doble > 0).map((f) => f.tipo_habitacion))],
    [filas, bases],
  );
  const cat = categorias.includes(categoria) ? categoria : categorias[0] ?? "";
  const plan = useMemo(() => {
    if (!v || !(pct > 0 && pct < 100)) return null;
    const celda = (b: string, col: "neto_doble" | "neto_nino") => filas.find((f) => f.temporada === b && f.tipo_habitacion === cat)?.[col] ?? null;
    return planPromoPorNoche({
      promo: promo.nombre, vigencias, regimen, pct, ninoGratis: v.nino_gratis === true,
      ...(hayGrupos || !cat ? {} : { valorBase: (b: string) => celda(b, "neto_doble"), valorNinoBase: (b: string) => celda(b, "neto_nino") }),
    });
  }, [v, pct, vigencias, regimen, promo.nombre, filas, cat, hayGrupos]);

  function activar() {
    if (!v?.id) { setMsg("No se encontró la vigencia de la promoción; recarga la página."); return; }
    if (!confirm(
      `Calcular «${promo.nombre}» (−${pct}%) por noche sobre la base ganadora:\n\n` +
      "· Cada noche toma la temporada base que la gana; no se escribe ninguna fila de tarifa para esta promoción.\n" +
      "· Aplica todos los días de las fechas de la promoción. Adultos, Niño 1 y Niño 2 reciben el porcentaje; el infante conserva su tarifa base.\n" +
      "· Si dos bases empatan en prioridad una misma noche, o a la base le falta tarifa, esa noche no se vende.\n\n" +
      "Puedes cambiarlo o quitarlo después en «Reglas por grupo».",
    )) return;
    setMsg("");
    start(async () => {
      const sin = { activo: false, edadMin: null, edadMax: null };
      const r = await guardarReglasPromocion({
        hotelId, promocionId: v.id as number, baseId: null,
        reglas: [{ grupo_id: null, valor: pct, dias: null }],
        previas: { base: null, reglas: [], sigueBase: false, ninoGratis: sin },
        sigueBase: true, ninoGratis: sin,
      });
      if (!r.ok) { setMsg(r.error); return; }
      setMsg(`✓ «${promo.nombre}» ahora se calcula por noche sobre la base ganadora.`);
      // Sin router.refresh(): la Server Action ya hace revalidatePath y su respuesta trae la página nueva (medido: un viaje RSC de más, #125).
    });
  }

  return (
    <li className="space-y-2 rounded-lg border border-gray-200 bg-white p-3" data-cruce-promo={promo.nombre} data-activa={promo.activa || undefined}>
      <p className="text-xs font-medium text-gray-700">
        «{promo.nombre}»{Number.isFinite(pct) && pct > 0 ? ` · −${pct}%` : ""}
        {promo.activa
          ? <span className="ml-2 font-normal text-[var(--brand-success)]">{TEXTO_SIGUE_ACTIVA}.</span>
          : <span className="ml-2 font-normal text-amber-700">Cruza varias temporadas base: no se puede materializar en una sola fila de tarifa.</span>}
      </p>
      {categorias.length > 1 && (
        <label className="block text-xs text-gray-600">Categoría de la vista previa
          <select value={cat} onChange={(e) => setCategoria(e.target.value)} className="ml-1 rounded-md border border-gray-200 px-2 py-1 text-xs">
            {categorias.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
      )}
      {plan
        ? <PlanPromoPorNoche plan={plan} moneda={moneda} conPrecios={!hayGrupos && !!cat}
            titulo={`Vista previa por noche${cat ? ` · ${cat}` : ""} · ${regimen} (habitación doble, por persona)`} />
        : <p className="text-xs text-amber-700">La promoción necesita un porcentaje mayor que 0 y menor que 100 para mostrar su vista previa.</p>}
      {!promo.activa && (
        <Button type="button" variant="outline" onClick={activar} disabled={pending || !plan}>
          {pending ? "…" : "Calcular por noche sobre la base ganadora"}
        </Button>
      )}
      {msg && <p className={`text-xs ${msg.startsWith("✓") ? "text-[var(--brand-success)]" : "text-red-600"}`} role="status">{msg}</p>}
    </li>
  );
}

/** Sección SIEMPRE visible de las calculadoras Dubai y Mixta: explica el camino para una promoción que cruza varias bases sucesivas (una sola promoción, sin un par
 * por base) y, cuando existe una, muestra su vista previa fechada por base. Anclada en `#cruce-bases` para enlazarla desde la guía del dueño. */
export function SeccionCruceBases({ tipo, promos, ...resto }: {
  tipo: "dubai" | "mixta"; promos: PromoCruce[]; hotelId: number; vigencias: TemporadaRango[]; regimen: string; filas: TarifaGenerada[]; moneda?: string | null;
}) {
  return (
    <section id="cruce-bases" className="space-y-2 rounded-lg border border-[var(--brand-accent)]/40 p-3" data-seccion-cruce-bases={tipo}>
      <h4 className="flex items-center gap-2 text-sm font-semibold text-[var(--brand-primary)]">
        <GitMerge className="h-4 w-4" aria-hidden /> Una promoción sobre varias bases sucesivas
      </h4>
      <p className="text-xs text-gray-600">
        Si una promoción cubre noches de dos o más temporadas base (por ejemplo BASE A y luego BASE B), créala <b>una sola vez</b>: no hace falta una promoción por base.
        Cada noche toma la base que la gana y su porcentaje; no se guarda ninguna fila de tarifa para la promoción.
        {tipo === "dubai" && " En Dubai el porcentaje se aplica a la tarifa completa del régimen de cada base (ya incluye su suplemento de régimen); el infante conserva la tarifa de su base."}
      </p>
      {promos.length > 0 ? (
        <CruceBasesMixta promos={promos} {...resto} />
      ) : (
        <ol className="list-decimal space-y-0.5 pl-5 text-xs text-gray-500" data-cruce-vacio>
          <li>En «Temporadas, promociones y calculadora» crea las bases (BASE A, BASE B…) con sus fechas y esta calculadora con sus precios.</li>
          <li>Crea la promoción una vez: tipo descuento %, el porcentaje, fechas que abarquen ambas bases y prioridad mayor que la de las bases.</li>
          <li>Vuelve aquí: aparecerá su vista previa por noche (qué base gana cada tramo y la tarifa resultante) con el botón «Calcular por noche sobre la base ganadora».</li>
        </ol>
      )}
    </section>
  );
}

export function CruceBasesMixta({ promos, ...resto }: {
  promos: PromoCruce[]; hotelId: number; vigencias: TemporadaRango[]; regimen: string; filas: TarifaGenerada[]; moneda?: string | null;
}) {
  if (!promos.length) return null;
  return (
    <ul className="space-y-2" data-cruce-bases>
      {promos.map((p) => <UnaPromo key={p.nombre} promo={p} {...resto} />)}
    </ul>
  );
}
