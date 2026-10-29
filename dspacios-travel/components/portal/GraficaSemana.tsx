import type { DiaActividad } from "./actividadSemana";
import s from "./vidrio.module.css";

const X = [40, 120, 200, 280, 360, 440, 520];
const BASE = 140;
const ALTO = 100;

/** Curva suave entre puntos (control en el punto medio horizontal, como la maqueta). */
function curva(p: [number, number][]) {
  return p.reduce((d, [x, y], i) => {
    if (i === 0) return `M${x} ${y}`;
    const [px, py] = p[i - 1];
    const m = (px + x) / 2;
    return `${d} C${m} ${py} ${m} ${y} ${x} ${y}`;
  }, "");
}

export function GraficaSemana({ dias, total }: { dias: DiaActividad[]; total: number }) {
  const max = Math.max(1, ...dias.flatMap((d) => [d.salidas, d.pagos]));
  const pts: [number, number][] = dias.map((d, i) => [X[i], BASE - (d.pagos / max) * ALTO]);
  const resumen = total === 0
    ? "Sin movimientos esta semana."
    : dias.map((d) => `${d.etiqueta}: ${d.salidas} salidas, ${d.pagos} pagos`).join("; ");
  return (
    <section aria-labelledby="sem-t" className={`${s.panel} ${s.grafica}`}>
      <div className={s.cabPanel}>
        <h2 id="sem-t" className={s.h2}>Actividad de la semana</h2>
        <div className={s.leyenda}>
          <span className={s.leyItem}><span aria-hidden="true" className={s.leyLinea} />Pagos registrados</span>
          <span className={s.leyItem}><span aria-hidden="true" className={s.leyBarra} />Salidas</span>
        </div>
      </div>
      <svg viewBox="0 0 560 170" className={s.svgGrafica} role="img" aria-label={`Salidas y pagos registrados por día de la semana. ${resumen}`}>
        <defs>
          <linearGradient id="g-area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#1D7C9A" stopOpacity="0.28" />
            <stop offset="100%" stopColor="#1D7C9A" stopOpacity="0" />
          </linearGradient>
        </defs>
        <g stroke="rgba(15,34,51,0.08)" strokeWidth="1">
          <line x1="20" y1="40" x2="540" y2="40" /><line x1="20" y1="90" x2="540" y2="90" /><line x1="20" y1="140" x2="540" y2="140" />
        </g>
        {total > 0 && (
          <>
            <g fill="#4F86E8" fillOpacity="0.85">
              {dias.map((d, i) => d.salidas > 0 && (
                <rect key={d.iso} x={X[i] - 9} y={BASE - (d.salidas / max) * ALTO} width="18" height={(d.salidas / max) * ALTO} rx="5" />
              ))}
            </g>
            <path d={`${curva(pts)} L520 ${BASE} L40 ${BASE} Z`} fill="url(#g-area)" />
            <path d={curva(pts)} fill="none" stroke="#1D7C9A" strokeWidth="3" strokeLinecap="round" />
            {dias.map((d, i) => d.pagos > 0 && <circle key={d.iso} cx={X[i]} cy={pts[i][1]} r="6" fill="#FFFFFF" stroke="#1D7C9A" strokeWidth="3" />)}
          </>
        )}
        {total === 0 && (
          <text x="280" y="88" textAnchor="middle" fill="#4F6475" fontSize="13" fontWeight="600" fontFamily="Plus Jakarta Sans, sans-serif">
            Sin salidas ni pagos registrados esta semana
          </text>
        )}
        <g fill="#4F6475" fontSize="12" fontFamily="Plus Jakarta Sans, sans-serif" fontWeight="600" textAnchor="middle">
          {dias.map((d, i) => <text key={d.iso} x={X[i]} y="162">{d.etiqueta}</text>)}
        </g>
      </svg>
    </section>
  );
}
