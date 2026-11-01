import Link from "next/link";
import { ArrowRight, ClipboardList, Compass, CreditCard, FileText, Plane, Users, Wallet } from "lucide-react";
import { PortalShell, Aviso } from "@/components/portal/PortalShell";
import { PortalGate } from "@/components/portal/PortalGate";
import { AvisoHistoricoIncompleto } from "@/components/portal/AvisoHistoricoIncompleto";
import { PlanesRecomendados } from "@/components/portal/PlanesRecomendados";
import { GloboModulos } from "@/components/portal/GloboModulos";
import { GraficaSemana } from "@/components/portal/GraficaSemana";
import { actividadSemana } from "@/components/portal/actividadSemana";
import s from "@/components/portal/vidrio.module.css";
import { formatMoneda } from "@/lib/utils";
import { numeroVisible } from "@/lib/tenant";
import { hoyBogota } from "@/lib/cotizacion/vigencia";
import {
  resolverContextoPortal, categoriaDelPortal, cargarConjuntoPortal, cargarCotizacionesPortal, cargarComparativasPortal,
  linkPagoPortal, monedaOfertaDe,
} from "@/lib/portal/b2bPortalServidor";
import { carteraDe, comparativaComoCotizacion, origenVenta, resumenInicio, salidasVigentes, type VentaPortal } from "@/lib/portal/b2bPortal";

export const dynamic = "force-dynamic";

const FILTROS = [
  { id: "todos", label: "Todos" },
  { id: "directas", label: "Directas" },
  { id: "asistidas", label: "Asistidas" },
  { id: "saldo", label: "Con saldo" },
] as const;
type Filtro = (typeof FILTROS)[number]["id"];
const FILAS_VISIBLES = 7;

function Monedas({ por }: { por: Record<string, number> }) {
  const e = Object.entries(por).filter(([, v]) => v > 0);
  if (e.length === 0) return <>—</>;
  return <>{e.map(([m, v], i) => <span key={m} className="block">{i > 0 ? "+ " : ""}{formatMoneda(v, m)}</span>)}</>;
}

function tonoEstado(estado: string | null | undefined) {
  const e = (estado ?? "").toLowerCase();
  if (/confirm|activ|pagad/.test(e)) return s.tonoOk;
  if (/pend|cotiz/.test(e)) return s.tonoPend;
  if (/anul|cancel|vencid/.test(e)) return s.tonoMal;
  return s.tonoInfo;
}
const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
const diaMes = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const porNumeroDesc = (a: VentaPortal, b: VentaPortal) => b.numero_contrato.localeCompare(a.numero_contrato, "es", { numeric: true });

export default async function PortalB2BInicio({ searchParams }: { searchParams?: Promise<{ contratos?: string }> } = {}) {
  const ctx = await resolverContextoPortal();
  if (ctx.estado !== "ok") return <PortalGate ctx={ctx} />;
  const sp = (await searchParams) ?? {};
  const filtro: Filtro = FILTROS.some((f) => f.id === sp.contratos) ? (sp.contratos as Filtro) : "todos";

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

  // Contratos recientes: solo el conjunto autorizado; la participación por comisión no expone cliente ni abre cartera/documentos.
  const conSaldo = new Set(cartera.filter((f) => f.saldo > 0).map((f) => f.numero_contrato));
  const destinoVenta = (v: VentaPortal) => `/portal/b2b/ventas?vista=${origenVenta(v, ctx.userId) === "directa" ? "directas" : "asistidas"}`;
  const visibles = conjunto.ventas
    .filter((v) => {
      if (filtro === "directas") return origenVenta(v, ctx.userId) === "directa";
      if (filtro === "asistidas") return origenVenta(v, ctx.userId) === "asistida";
      if (filtro === "saldo") return v.relacion === "propio" && conSaldo.has(v.numero_contrato);
      return true;
    })
    .sort(porNumeroDesc);
  const filas = visibles.slice(0, FILAS_VISIBLES);

  const salidas = salidasVigentes(conjunto.ventas);
  const proximas = salidas.filter((v) => (v.fecha_salida as string) >= hoy).sort((a, b) => String(a.fecha_salida).localeCompare(String(b.fecha_salida))).slice(0, 3);
  const semana = actividadSemana({ hoy, salidas: salidas.map((v) => v.fecha_salida), pagos: conjunto.abonos.map((a) => a.fecha_abono) });

  const rolEt = ctx.rol === "agencia" ? "Agencia" : "Freelance";

  return (
    <PortalShell
      nombre={ctx.nombre} rol={ctx.rol} detalle={`${rolEt} · ${cat.label}`} activa="inicio" mostrarAgentes={ctx.esTitularAgencia} linkPago={linkPago}
      cta={<Link href="/tarifario" className={s.cta}><Compass aria-hidden size={18} /> Explora el tarifario y cotiza</Link>}
    >
      <div className={s.titulo}>
        <h1 className={s.h1}>Panel del aliado</h1>
        <span className={s.nota}>{cat.label} · Comisión {Math.round(pct * 1000) / 10}% sobre la base comisionable</span>
      </div>

      {conjunto.historicoIncompleto && <AvisoHistoricoIncompleto />}
      {dato && <Aviso>{dato}</Aviso>}
      {(cots.error || comparativas.error) && <Aviso>No pudimos cargar todas tus cotizaciones o comparativas; el conteo de vigentes puede estar incompleto. Intenta más tarde.</Aviso>}
      {(conjunto.legacyNoVerificado || !conjunto.participacionCompleta) && (
        <Aviso>No pudimos verificar parte de tu histórico, así que por seguridad no se muestra ahora. Intenta más tarde o comunícate con tu asesor.</Aviso>
      )}

      <div className={s.fila3}>
        <section aria-labelledby="contratos-t" className={`${s.panel} ${s.colIzq}`}>
          <h2 id="contratos-t" className={s.h2}>Contratos recientes</h2>
          <nav aria-label="Filtrar contratos">
            <ul className={s.segmentado}>
              {FILTROS.map((f) => (
                <li key={f.id}>
                  <Link href={f.id === "todos" ? "/portal/b2b" : `/portal/b2b?contratos=${f.id}`} aria-current={f.id === filtro ? "page" : undefined} className={`${s.segmento} ${f.id === filtro ? s.segmentoActivo : ""}`}>
                    {f.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
          {filas.length === 0 ? (
            <p className={s.vacio0}>{filtro === "todos" ? "Aún no tienes contratos. Cuando generes o recibas uno, aparecerá aquí." : "No hay contratos con este filtro."}</p>
          ) : (
            <div className={s.tabla0}>
              <ul className={s.lista}>
                <li aria-hidden="true" className={s.listaCab}><span>Contrato</span><span>Cliente</span><span>Destino</span><span>Estado</span></li>
                {filas.map((v) => {
                  const part = v.relacion === "participacion";
                  return (
                    <li key={v.numero_contrato}>
                      <Link href={destinoVenta(v)} className={s.listaFila} aria-label={`Contrato ${numeroVisible(v.numero_contrato)}, ver en Mis ventas`}>
                        <span className={s.numero}>{numeroVisible(v.numero_contrato)}</span>
                        <span className={s.celdaDoble}>
                          <span className={s.celdaTitulo}>{part ? "Participación por comisión" : (v.cliente ?? "—")}</span>
                          <span className={s.celdaSub}>{part ? "Solo comisión" : (v.fecha_salida ? `Salida ${diaMes(v.fecha_salida)}` : "Sin fecha de salida")}</span>
                        </span>
                        <span className={s.celdaFuerte}>{v.destino ?? "—"}</span>
                        <span className={`${s.pildora} ${tonoEstado(v.estado)}`}>{v.estado ? cap(v.estado) : "—"}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
          <Link href="/portal/b2b/ventas" className={s.verTodo}>Ver todas mis ventas <ArrowRight aria-hidden size={14} /></Link>
        </section>

        <div className={s.colCentro}>
          <GloboModulos />
          <section aria-labelledby="salidas-t" className={`${s.panel} ${s.panelAncho}`}>
            <h2 id="salidas-t" className={s.h2}>Próximas salidas</h2>
            {proximas.length === 0 ? (
              <p className={s.vacio0}>No tienes salidas próximas en tus contratos.</p>
            ) : (
              <ul className={s.ul0}>
                {proximas.map((v, i) => (
                  <li key={v.numero_contrato}>
                    <Link href={destinoVenta(v)} className={s.itemVidrio}>
                      <span aria-hidden="true" className={`${s.itemIcono} ${[s.gradAzul, s.gradVerde, s.gradNaranja][i % 3]}`}><Plane size={18} /></span>
                      <span className={s.itemTexto}>
                        <span className={s.itemTitulo}>{v.destino ?? "Destino por definir"}</span>
                        <span className={s.itemDetalle}>{numeroVisible(v.numero_contrato)}{v.cliente ? ` · ${v.cliente}` : ""}</span>
                      </span>
                      <span className={s.itemFecha}>{diaMes(String(v.fecha_salida))}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <div className={s.colDer}>
          <section aria-labelledby="pan-t" className={s.panel} style={{ gap: 16 }}>
            <h2 id="pan-t" className={s.h2}>Panorama de hoy</h2>
            <ul className={s.indicadores}>
              <li><Link href="/portal/b2b/cotizaciones" className={s.indicador}><div className={s.indEt}>Cotizaciones vigentes</div><div className={`${s.indVal} ${s.cVerde}`}>{r.cotizacionesVigentes}</div><div className={s.indNota}>{cotizacionesTotal} en total</div></Link></li>
              <li><Link href="/portal/b2b/ventas" className={s.indicador}><div className={s.indEt}>Mis ventas</div><div className={`${s.indVal} ${s.cAzul}`}>{r.ventasPropias}</div><div className={s.indNota}>{r.ventasParticipacion > 0 ? `${r.ventasParticipacion} más con tu comisión` : "Contratos propios"}</div></Link></li>
              <li><Link href="/portal/b2b/cartera" className={s.indicador}><div className={s.indEt}>Saldo por cobrar</div><div className={`${s.indVal} ${s.indValM} ${s.cAmbar}`}><Monedas por={r.saldoPorMoneda} /></div><div className={s.indNota}>Por moneda de cobro</div></Link></li>
              <li><Link href="/portal/b2b/ventas" className={s.indicador}><div className={s.indEt}>Comisión por cobrar</div><div className={`${s.indVal} ${s.indValM} ${s.cRojo}`}><Monedas por={r.comisionPorCobrarPorMoneda} /></div><div className={s.indNota}>Según tus comisiones registradas</div></Link></li>
            </ul>
            <div className={s.seguimiento}>
              <div className={s.subEt}>Seguimiento</div>
              <Link href="/portal/b2b/cartera" className={s.segFila}><span>Contratos con saldo</span><b>{r.contratosConSaldo}</b></Link>
              <Link href="/portal/b2b/ventas" className={s.segFila}><span>Salidas en los próximos 30 días</span><b>{r.salidasProximas}</b></Link>
            </div>
          </section>
          <PlanesRecomendados />
        </div>
      </div>

      <div className={s.filaInferior}>
        <GraficaSemana dias={semana.dias} total={semana.total} />
        <section aria-labelledby="her-t" className={`${s.panel} ${s.herramientas}`}>
          <h2 id="her-t" className={s.h2} style={{ marginBottom: 4 }}>Herramientas rápidas</h2>
          <Link href="/portal/b2b/cotizaciones?vista=asistidas" className={s.herr}><ClipboardList aria-hidden size={18} style={{ color: "#B85A10" }} />Cotizaciones armadas para ti</Link>
          <Link href="/portal/b2b/cartera?vista=pagos" className={s.herr}><Wallet aria-hidden size={18} style={{ color: "#0B7F73" }} />Pagos y recibos</Link>
          <Link href="/portal/b2b/documentos" className={s.herr}><FileText aria-hidden size={18} style={{ color: "#6D4BE0" }} />Contratos y estados de cuenta</Link>
          {ctx.esTitularAgencia && <Link href="/portal/b2b/agentes" className={s.herr}><Users aria-hidden size={18} style={{ color: "#1D4E9E" }} />Agentes de la agencia</Link>}
          {linkPago && <a href={linkPago} target="_blank" rel="noopener noreferrer" className={s.herr}><CreditCard aria-hidden size={18} style={{ color: "#1D4E9E" }} />Pagar en línea</a>}
        </section>
      </div>
    </PortalShell>
  );
}
