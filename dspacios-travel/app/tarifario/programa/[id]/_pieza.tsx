/* Datos + render compartido de las piezas gráficas de un programa (flyer cuadrado,
   historia IG, portada horizontal). Se renderiza con next/og (Satori): solo
   flexbox e inline styles. NO es una ruta (prefijo _). */
import { ImageResponse } from "next/og";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { pvpPrograma } from "@/lib/programas";
import { formatMoneda } from "@/lib/utils";

type SB = SupabaseClient<Database>;
export type Formato = "flyer" | "story" | "portada";

export type PiezaData = {
  nombre: string;
  subtitulo: string | null;
  dias: number | null;
  noches: number | null;
  moneda: string;
  ruta: string;
  desde: number | null;
  portadaUrl: string | null;
  incluyeAereo: boolean;
  highlights: string[];
  publicado: boolean;
};

export async function getPiezaData(sb: SB, id: number): Promise<PiezaData | null> {
  const { data: p } = await sb
    .from("programas")
    .select("id, nombre, subtitulo, dias, noches, moneda, pct_mk, pct_fee_tarjeta, asistencia_medica_dia, desde_precio, incluye_aereo, portada_url, highlights, publicado")
    .eq("id", id)
    .maybeSingle();
  if (!p) return null;

  const { data: ciudades } = await sb.from("programa_ciudades").select("nombre, orden").eq("programa_id", id).order("orden");

  let desde: number | null = p.desde_precio && p.desde_precio > 0 ? Number(p.desde_precio) : null;
  if (desde == null) {
    let minNeto: number | null = null;
    const { data: cats } = await sb.from("programa_categorias").select("id").eq("programa_id", id);
    const catIds = (cats ?? []).map((c) => c.id);
    if (catIds.length) {
      const { data: pr } = await sb.from("programa_precios").select("neto, bajo_solicitud").in("categoria_id", catIds);
      for (const r of pr ?? []) if (!r.bajo_solicitud && r.neto && r.neto > 0) minNeto = minNeto == null ? r.neto : Math.min(minNeto, r.neto);
    }
    const { data: sal } = await sb.from("programa_salidas").select("neto_sencilla, neto_doble, neto_triple, neto_multiple, neto_nino, bajo_solicitud").eq("programa_id", id);
    for (const s of sal ?? []) {
      if (s.bajo_solicitud) continue;
      for (const v of [s.neto_doble, s.neto_triple, s.neto_multiple, s.neto_sencilla, s.neto_nino]) if (v && v > 0) minNeto = minNeto == null ? v : Math.min(minNeto, v);
    }
    if (minNeto != null) desde = pvpPrograma(minNeto, { pctMk: p.pct_mk, asistenciaDia: p.asistencia_medica_dia, dias: p.dias, pctFee: p.pct_fee_tarjeta });
  }

  return {
    nombre: p.nombre,
    subtitulo: p.subtitulo,
    dias: p.dias,
    noches: p.noches,
    moneda: p.moneda,
    ruta: (ciudades ?? []).map((c) => c.nombre).filter(Boolean).join("  ·  "),
    desde,
    portadaUrl: p.portada_url,
    incluyeAereo: p.incluye_aereo,
    highlights: (p.highlights ?? []).filter(Boolean),
    publicado: p.publicado,
  };
}

const BRAND = "#1D7C9A";
const ACCENT = "#26BBD9";
const LIMA = "#AEF44A";

// Escala tipográfica por formato (px sobre el lienzo nativo).
function escala(formato: Formato) {
  if (formato === "story") return { w: 1080, h: 1920, pad: 90, titulo: 92, sub: 40, meta: 36, pill: 46, chip: 32, logo: 64 };
  if (formato === "portada") return { w: 1200, h: 630, pad: 64, titulo: 64, sub: 30, meta: 26, pill: 34, chip: 24, logo: 48 };
  return { w: 1080, h: 1080, pad: 80, titulo: 78, sub: 36, meta: 32, pill: 42, chip: 30, logo: 60 }; // flyer
}

// Construye la respuesta de imagen (PNG) para una ruta de pieza.
export async function piezaResponse(sb: SB, req: Request, id: number, formato: Formato): Promise<Response> {
  if (!Number.isFinite(id)) return new Response("ID inválido", { status: 400 });
  const data = await getPiezaData(sb, id);
  if (!data) return new Response("Programa no encontrado", { status: 404 });
  const url = new URL(req.url);
  const marcaBlanca = url.searchParams.get("marca") === "blanca";
  const s = escala(formato);
  return new ImageResponse(piezaElement({ data, formato, origin: url.origin, marcaBlanca }), { width: s.w, height: s.h });
}

// Devuelve el árbol JSX para ImageResponse.
export function piezaElement(opts: { data: PiezaData; formato: Formato; origin: string; marcaBlanca: boolean }) {
  const { data, formato, origin, marcaBlanca } = opts;
  const s = escala(formato);
  const sellos = [data.incluyeAereo ? "Con aéreo" : "Solo terrestre", "Servicios compartidos", "Tarifa por persona"];
  const highlights = data.highlights.slice(0, formato === "portada" ? 3 : 5);

  return (
    <div style={{ display: "flex", width: s.w, height: s.h, position: "relative", fontFamily: "sans-serif" }}>
      {/* Fondo */}
      {data.portadaUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={data.portadaUrl} alt="" width={s.w} height={s.h} style={{ position: "absolute", top: 0, left: 0, width: s.w, height: s.h, objectFit: "cover" }} />
      ) : (
        <div style={{ position: "absolute", top: 0, left: 0, width: s.w, height: s.h, display: "flex", backgroundImage: `linear-gradient(135deg, ${BRAND} 0%, ${ACCENT} 60%, ${LIMA} 130%)` }} />
      )}
      {/* Velo oscuro */}
      <div style={{ position: "absolute", top: 0, left: 0, width: s.w, height: s.h, display: "flex", backgroundImage: "linear-gradient(180deg, rgba(0,0,0,0.15) 0%, rgba(0,0,0,0.45) 55%, rgba(0,0,0,0.82) 100%)" }} />

      {/* Contenido */}
      <div style={{ position: "relative", display: "flex", flexDirection: "column", justifyContent: "space-between", width: s.w, height: s.h, padding: s.pad, color: "#fff" }}>
        {/* Top: logo */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          {!marcaBlanca ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={`${origin}/marca/logo-white.png`} alt="" height={s.logo} style={{ height: s.logo, objectFit: "contain" }} />
          ) : <div style={{ display: "flex" }} />}
          {data.dias ? (
            <div style={{ display: "flex", backgroundColor: "rgba(255,255,255,0.18)", borderRadius: 999, padding: `${s.chip * 0.3}px ${s.chip * 0.7}px`, fontSize: s.meta, fontWeight: 600 }}>
              {data.dias} días / {data.noches ?? ""} noches
            </div>
          ) : <div style={{ display: "flex" }} />}
        </div>

        {/* Bottom: título + meta + precio + sellos */}
        <div style={{ display: "flex", flexDirection: "column" }}>
          {highlights.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", marginBottom: s.pad * 0.3 }}>
              {highlights.map((h, i) => (
                <div key={i} style={{ display: "flex", backgroundColor: "rgba(174,244,74,0.92)", color: "#2b3d09", borderRadius: 999, padding: `${s.chip * 0.25}px ${s.chip * 0.6}px`, fontSize: s.chip, fontWeight: 700, marginRight: 12, marginBottom: 12 }}>
                  {h}
                </div>
              ))}
            </div>
          )}
          <div style={{ display: "flex", fontSize: s.titulo, fontWeight: 800, lineHeight: 1.05, letterSpacing: -1 }}>{data.nombre}</div>
          {data.ruta && <div style={{ display: "flex", fontSize: s.sub, marginTop: s.pad * 0.18, color: "rgba(255,255,255,0.92)" }}>{data.ruta}</div>}

          <div style={{ display: "flex", alignItems: "center", marginTop: s.pad * 0.35 }}>
            {data.desde != null && (
              <div style={{ display: "flex", alignItems: "baseline", backgroundColor: ACCENT, borderRadius: 18, padding: `${s.pill * 0.35}px ${s.pill * 0.7}px`, fontSize: s.pill, fontWeight: 800 }}>
                Desde {formatMoneda(data.desde, data.moneda)}
                <span style={{ fontSize: s.meta, fontWeight: 600, marginLeft: 10 }}>/ persona</span>
              </div>
            )}
          </div>

          <div style={{ display: "flex", flexWrap: "wrap", marginTop: s.pad * 0.32 }}>
            {sellos.map((x) => (
              <div key={x} style={{ display: "flex", border: "2px solid rgba(255,255,255,0.55)", borderRadius: 999, padding: `${s.chip * 0.22}px ${s.chip * 0.6}px`, fontSize: s.chip, fontWeight: 600, marginRight: 12, marginBottom: 12 }}>
                {x}
              </div>
            ))}
          </div>

          {!marcaBlanca && (
            <div style={{ display: "flex", fontSize: s.meta * 0.82, marginTop: s.pad * 0.3, color: "rgba(255,255,255,0.78)" }}>
              D&apos;spacios Travel · Tarifas por persona, sujetas a disponibilidad.
            </div>
          )}
          {marcaBlanca && (
            <div style={{ display: "flex", fontSize: s.meta * 0.82, marginTop: s.pad * 0.3, color: "rgba(255,255,255,0.7)" }}>
              Tarifas por persona, sujetas a disponibilidad y cambios sin previo aviso.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
