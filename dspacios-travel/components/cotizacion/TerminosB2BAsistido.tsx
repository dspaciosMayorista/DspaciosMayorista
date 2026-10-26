import { BadgePercent } from "lucide-react";
import { formatMoneda } from "@/lib/utils";
import { ETIQUETA_MODO_B2B, ETIQUETA_ORIGEN_PCT, type PlanB2BCotizacion } from "@/lib/cotizacion/asistidaB2B";

/** Lo que muestra el panel: el plan congelado completo, o (vista previa) solo los términos que el servidor liquida antes de generar. */
export type TerminosVisibles = Pick<PlanB2BCotizacion, "aliado_nombre" | "tipo_asesor" | "modo_compra" | "moneda" | "pvp" | "impuesto" | "base" | "pct" | "pct_origen" | "comision" | "total_exigible"> & { asistido_por?: PlanB2BCotizacion["asistido_por"] };

// #102 — Términos de una venta B2B ASISTIDA, CONGELADOS en la cotización. Es una vista INTERNA (personal autorizado): muestra
// comisión y base, así que NO se usa en ningún documento que vea el comprador (esos usan solo el total exigible en NETO).
// Sin hooks ni acciones: sirve igual en el resultado del checkout y en la ficha de la cotización.
const ROL_ETIQUETA: Record<string, string> = {
  superadmin: "Superadmin", gerencia: "Gerencia", administracion: "Administración", operaciones: "Operaciones", venta: "Venta",
};

function Fila({ etiqueta, valor, destacado = false, testid }: { etiqueta: string; valor: string; destacado?: boolean; testid?: string }) {
  return (
    <div className={`flex items-baseline justify-between gap-3 py-1 text-sm ${destacado ? "border-t border-gray-200 pt-2 font-semibold text-gray-900" : "text-gray-600"}`}>
      <dt>{etiqueta}</dt>
      <dd className="text-right tabular-nums" data-testid={testid}>{valor}</dd>
    </div>
  );
}

export function TerminosB2BAsistido({ plan, previa = false }: { plan: TerminosVisibles; previa?: boolean }) {
  const m = (n: number) => formatMoneda(n, plan.moneda);
  const neta = plan.modo_compra === "neta";
  const pctTexto = `${(plan.pct * 100).toLocaleString("es-CO", { maximumFractionDigits: 2 })} %`;
  return (
    <section className="rounded-xl border border-sky-200 bg-sky-50/60 p-4" data-testid={previa ? "terminos-b2b-previa" : "terminos-b2b-asistido"} aria-label="Venta B2B asistida">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-800">
        <BadgePercent className="h-4 w-4" aria-hidden style={{ color: "var(--brand-primary)" }} />
        Venta B2B asistida
      </h3>
      <p className="mt-1 text-xs text-gray-500">
        {previa
          ? "Vista previa calculada por el servidor con el mismo cálculo de la cotización. Al generar se vuelve a validar y se congelan los términos vigentes en ese momento."
          : "Términos congelados al cotizar. Si el precio, el impuesto, el aliado o su porcentaje cambian antes de contratar, la conversión se rechaza y hay que generar una cotización nueva."}
        {" "}Solo uso interno: el documento del comprador no muestra la comisión.
      </p>
      <dl className="mt-3">
        <Fila etiqueta="Aliado" valor={`${plan.aliado_nombre} · ${plan.tipo_asesor === "agencia" ? "Agencia" : "Freelance"}`} testid="b2b-aliado" />
        <Fila etiqueta="Modalidad" valor={ETIQUETA_MODO_B2B[plan.modo_compra]} testid="b2b-modalidad" />
        <Fila etiqueta="PVP" valor={m(plan.pvp)} testid="b2b-pvp" />
        <Fila etiqueta="Impuesto no comisionable" valor={m(plan.impuesto)} testid="b2b-impuesto" />
        <Fila etiqueta="Base comisionable" valor={m(plan.base)} testid="b2b-base" />
        <Fila etiqueta={ETIQUETA_ORIGEN_PCT[plan.pct_origen]} valor={pctTexto} testid="b2b-pct" />
        <Fila
          etiqueta={neta ? "Comisión (descontada del precio)" : "Comisión (pendiente de liquidar)"}
          valor={neta ? `−${m(plan.comision)}` : m(plan.comision)}
          testid="b2b-comision"
        />
        <Fila etiqueta={neta ? "Total exigible (NETO)" : "Total exigible (PVP)"} valor={m(plan.total_exigible)} destacado testid="b2b-total-exigible" />
      </dl>
      {plan.asistido_por && (
        <p className="mt-2 text-[11px] text-gray-400">
          Asistida por {plan.asistido_por.email ?? "personal interno"} ({ROL_ETIQUETA[plan.asistido_por.rol] ?? plan.asistido_por.rol}); el beneficiario es el aliado.
        </p>
      )}
    </section>
  );
}
