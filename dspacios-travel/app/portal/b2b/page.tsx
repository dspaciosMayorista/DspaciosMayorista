import Link from "next/link";
import { ArrowRight, Compass } from "lucide-react";
import { PortalShell } from "@/components/portal/PortalShell";
import { PortalGate } from "@/components/portal/PortalGate";
import { AvisoHistoricoIncompleto } from "@/components/portal/AvisoHistoricoIncompleto";
import { PlanesRecomendados } from "@/components/portal/PlanesRecomendados";
import { formatMoneda } from "@/lib/utils";
import { hoyBogota } from "@/lib/cotizacion/vigencia";
import {
  resolverContextoPortal, categoriaDelPortal, cargarConjuntoPortal, cargarCotizacionesPortal, cargarComparativasPortal,
  linkPagoPortal, monedaOfertaDe,
} from "@/lib/portal/b2bPortalServidor";
import { carteraDe, comparativaComoCotizacion, resumenInicio } from "@/lib/portal/b2bPortal";

export const dynamic = "force-dynamic";

function Monedas({ por }: { por: Record<string, number> }) {
  const e = Object.entries(por).filter(([, v]) => v > 0);
  if (e.length === 0) return <>—</>;
  return <>{e.map(([m, v], i) => <span key={m} className="block">{i > 0 ? "+ " : ""}{formatMoneda(v, m)}</span>)}</>;
}

export default async function PortalB2BInicio() {
  const ctx = await resolverContextoPortal();
  if (ctx.estado !== "ok") return <PortalGate ctx={ctx} />;

  // Inicio y pestañas leen el MISMO conjunto autorizado: un indicador nunca cuenta lo que su pestaña no muestra.
  const [{ cat, pct }, conjunto, cots, comparativas, linkPago] = await Promise.all([
    categoriaDelPortal(ctx),
    cargarConjuntoPortal(ctx, { abonos: true }),
    cargarCotizacionesPortal(ctx),
    cargarComparativasPortal(ctx),
    linkPagoPortal(),
  ]);
  const hoy = hoyBogota();
  const cartera = carteraDe(conjunto.ventas, conjunto.abonos);
  const comisiones: { moneda: string; monto: number }[] = [];
  for (const [n, vis] of conjunto.comisiones) {
    if (vis && (vis.fuente === "filas" || vis.fuente === "ventas") && vis.cobrable && (vis.importe ?? 0) > 0) {
      comisiones.push({ moneda: monedaOfertaDe(conjunto.crudas.get(n)), monto: vis.importe as number });
    }
  }
  const r = resumenInicio({
    ventas: conjunto.ventas, cartera, comisiones, hoy,
    // Mismo conjunto y misma regla de estado que la pestaña Cotizaciones (cotizaciones + comparativas, directas y asistidas).
    cotizaciones: [...cots.directas, ...cots.asistidas, ...comparativas.directas.map(comparativaComoCotizacion), ...comparativas.asistidas.map(comparativaComoCotizacion)],
  });
  const cotizacionesTotal = cots.directas.length + cots.asistidas.length + comparativas.directas.length + comparativas.asistidas.length;
  const dato = conjunto.abonosCompletos ? null : "No pudimos leer todos tus pagos; los saldos pueden estar incompletos. Intenta más tarde.";

  const tarjetas: { href: string; titulo: string; valor: React.ReactNode; nota: string }[] = [
    { href: "/portal/b2b/cotizaciones", titulo: "Cotizaciones vigentes", valor: r.cotizacionesVigentes, nota: `${cotizacionesTotal} en total` },
    { href: "/portal/b2b/ventas", titulo: "Mis ventas", valor: r.ventasPropias, nota: r.ventasParticipacion > 0 ? `${r.ventasParticipacion} más con tu comisión` : "Contratos propios" },
    { href: "/portal/b2b/cartera", titulo: "Contratos con saldo", valor: r.contratosConSaldo, nota: "Por cobrar al cliente" },
    { href: "/portal/b2b/cartera", titulo: "Saldo por cobrar", valor: <Monedas por={r.saldoPorMoneda} />, nota: "Por moneda de cobro" },
    { href: "/portal/b2b/ventas", titulo: "Comisión por cobrar", valor: <Monedas por={r.comisionPorCobrarPorMoneda} />, nota: "Según tus comisiones registradas" },
    { href: "/portal/b2b/ventas", titulo: "Salidas próximas", valor: r.salidasProximas, nota: "En los próximos 30 días" },
  ];

  return (
    <PortalShell nombre={ctx.nombre} activa="inicio" mostrarAgentes={ctx.esTitularAgencia} linkPago={linkPago}>
      <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-gray-600">
        <span
          className="rounded-full px-3 py-1 text-xs font-semibold"
          style={cat.nivel === "senior"
            ? { backgroundColor: "rgba(174,244,74,0.25)", color: "#5a7d12" }
            : { backgroundColor: "rgba(29,124,154,0.12)", color: "var(--brand-primary)" }}
        >
          {cat.label}
        </span>
        <span>Comisión <b>{Math.round(pct * 1000) / 10}%</b> sobre la base comisionable</span>
      </div>

      <section aria-labelledby="cta-tarifario" className="mb-5 flex flex-col items-start justify-between gap-4 rounded-xl p-5 text-white sm:flex-row sm:items-center sm:p-6 bg-brand-gradient">
        <div>
          <h1 id="cta-tarifario" className="text-xl font-semibold">Explora el tarifario y cotiza</h1>
          <p className="mt-1 text-sm text-white/90">Encuentra hoteles, programas y servicios con tu tarifa, arma la propuesta para tu cliente y reserva.</p>
        </div>
        <Link href="/tarifario" className="inline-flex shrink-0 items-center gap-2 rounded-lg bg-white px-5 py-2.5 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2" style={{ color: "var(--brand-primary)" }}>
          <Compass aria-hidden className="h-4 w-4" /> Ir al tarifario <ArrowRight aria-hidden className="h-4 w-4" />
        </Link>
      </section>

      {conjunto.historicoIncompleto && <AvisoHistoricoIncompleto />}
      {dato && <p role="status" className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">{dato}</p>}
      {(cots.error || comparativas.error) && <p role="status" className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">No pudimos cargar todas tus cotizaciones o comparativas; el conteo de vigentes puede estar incompleto. Intenta más tarde.</p>}
      {(conjunto.legacyNoVerificado || !conjunto.participacionCompleta) && (
        <p role="status" className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          No pudimos verificar parte de tu histórico, así que por seguridad no se muestra ahora. Intenta más tarde o comunícate con tu asesor.
        </p>
      )}

      <ul className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-3">
        {tarjetas.map((t) => (
          <li key={t.titulo}>
            <Link href={t.href} className="block h-full rounded-xl border border-gray-200 bg-white p-4 hover:border-gray-300 focus-visible:outline-2 focus-visible:outline-offset-2">
              <p className="text-xs font-medium uppercase tracking-wide text-gray-400">{t.titulo}</p>
              <p className="mt-1 text-xl font-semibold tabular-nums text-gray-900 sm:text-2xl">{t.valor}</p>
              <p className="mt-1 text-xs text-gray-500">{t.nota}</p>
            </Link>
          </li>
        ))}
      </ul>

      <PlanesRecomendados />
    </PortalShell>
  );
}
