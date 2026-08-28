import { createClient } from "@/lib/supabase/server";
import { TarifarioPublic } from "./TarifarioPublic";
import { CartDrawer } from "./CartDrawer";
import { Logo } from "@/components/Logo";
import { BackgroundVideo } from "@/components/BackgroundVideo";
import { orquestarCargaPublica } from "@/lib/tarifario/orquestacion";
import { buscarPaginaTarifarioCompleta } from "@/lib/tarifario/datos";
import { getProgramasResumen } from "@/lib/programas";
import { PAGE_SIZE_BLOQUEO } from "@/lib/tarifario/consulta";
import {
  generarFlujoId, registrarEtapa, registrarDatoPagina, registrarErrorTecnico,
  siguienteInvocacionProceso, medirPayloadSiHabilitado, textoEstimacionPayload, iniciarCronometro,
} from "@/lib/observabilidad/medicion";

// Alcance/invalidación de este caché (verificado con el build, no solo
// leído del código): esta página llama `sb.auth.getUser()` sin condición —
// una API "dinámica" (lee cookies) que en Next.js App Router fuerza el
// renderizado dinámico por-request de TODO el segmento. Cuando eso ocurre,
// `export const revalidate` deja de aplicar (no hay caché de ruta completa
// que revalidar: nunca llega a cachearse en primer lugar). Confirmado en la
// salida real de `npm run build` de esta rama: `/tarifario` sale marcada
// `ƒ` (Dynamic, server-rendered on demand), no `○`/ISR — así que HOY esta
// línea no tiene efecto de caché medible.
export const revalidate = 120; // revalida cada 2 min (hoy sin efecto — ver nota arriba)

const FLUJO = "pagina_tarifario_publico";

// Mensaje público FIJO — nunca "Tarifario en preparación" cuando en realidad
// falló la consulta (revisión posterior, defecto "PAGINACIÓN IGNORA ERRORES").
const MSG_ERROR_CARGAR_TARIFARIO = "No fue posible cargar el tarifario en este momento. Intenta nuevamente en unos segundos.";

/**
 * Rediseño "carga bajo demanda" (medición real de preview: la versión
 * anterior descargaba el catálogo COMPLETO — 17.197 filas, ~11,1 MB — antes
 * de pintar nada, y la caché compartida de la ronda anterior fue rechazada
 * por Next ("items over 2MB can not be cached"), así que cada visita repetía
 * el trabajo completo). Ahora esta página solo pide la PRIMERA página
 * (módulo "Paquetes"/bloqueo, `PAGE_SIZE_BLOQUEO` filas — documentado en
 * `lib/tarifario/consulta.ts`) — el resto del catálogo se explora con
 * "Cargar más"/cambiar de pestaña o filtro DESDE EL NAVEGADOR
 * (`TarifarioPublic`, Server Action `buscarPaginaTarifarioAccion`), nunca
 * bajando el resto de una sola vez. No se reemplazó la caché de la ronda
 * anterior por varias cachés más chicas del mismo catálogo completo — eso
 * conservaría el problema de transferencia/renderizado; se retiró sin
 * reemplazo (`lib/tarifario/catalogoCache.ts` ya no existe).
 *
 * ⚠️ Visitante ANÓNIMO = estado NORMAL, nunca error técnico: en
 * `resolverSesion` de abajo, `user === null` sin `authError` (el caso de
 * cualquier visitante sin sesión) toma la rama por defecto
 * (`esAgencia=false, puedeReservar=false`) y registra `resultado=ok` — el
 * único camino que registra `resultado=error` es un fallo TÉCNICO real de
 * `auth.getUser()`/la consulta de perfil (`authError`/`perfilError`
 * presentes). Esto no cambió en esta ronda.
 */
export default async function TarifarioPublicoPage() {
  const flujoId = generarFlujoId();
  const invocacion = siguienteInvocacionProceso(FLUJO);
  const _cronoPrep = iniciarCronometro();

  const sb = await createClient();

  const _cronoTotal = iniciarCronometro();
  const { sesion, datos: resDatos, programas: resProgramas, configSitio: cfgSitio } = await orquestarCargaPublica({
    resolverSesion: async () => {
      const _cronoAuth = iniciarCronometro();
      const { data: { user }, error: authError } = await sb.auth.getUser();
      let esAgencia = false;
      let puedeReservar = false;
      let huboError = false;
      if (authError) {
        huboError = true;
        registrarErrorTecnico(FLUJO, flujoId, "autenticacion_perfil", "error_auth_getUser", authError);
      } else if (user) {
        const { data: perfil, error: perfilError } = await sb.from("usuarios").select("rol").eq("id", user.id).single();
        if (perfilError) {
          huboError = true;
          registrarErrorTecnico(FLUJO, flujoId, "autenticacion_perfil", "error_consulta_perfil", perfilError);
        } else {
          esAgencia = !!perfil && ["agencia", "freelance", "superadmin", "operaciones", "gerencia", "administracion"].includes(perfil.rol);
          puedeReservar = !!perfil && ["superadmin", "operaciones", "gerencia", "administracion", "venta", "agencia", "freelance"].includes(perfil.rol);
        }
      }
      const ms = _cronoAuth();
      registrarEtapa(FLUJO, flujoId, "autenticacion_perfil", ms, huboError ? "error" : "ok");
      return { user, esAgencia, puedeReservar, huboError, ms };
    },
    cargarTarifario: () =>
      buscarPaginaTarifarioCompleta(sb, { modulo: "bloqueo", page: 1, pageSize: PAGE_SIZE_BLOQUEO }, FLUJO, flujoId, PAGE_SIZE_BLOQUEO),
    cargarProgramas: () => getProgramasResumen(sb, true), // público: SOLO publicados
    cargarConfigSitio: async () => sb.from("config_sitio").select("video_fondo_url").eq("id", 1).maybeSingle(),
  });
  const { user, esAgencia, puedeReservar } = sesion;
  registrarEtapa(
    FLUJO, flujoId, "tarifario_programas_config",
    Math.max(0, _cronoTotal() - sesion.ms),
    resDatos.ok && !resProgramas.error && !cfgSitio.error ? "ok" : "error"
  );

  if (!resDatos.ok) {
    return (
      <div className="app-bg min-h-screen bg-gray-50">
        <main className="mx-auto max-w-[1700px] px-4 py-20 md:px-6">
          <p className="text-center text-red-500">{MSG_ERROR_CARGAR_TARIFARIO}</p>
        </main>
      </div>
    );
  }
  const { datos, total, page, pageSize } = resDatos;
  const {
    filasVisibles, filasAddon, cuposPorBloqueo, origenPorBloqueo, fotosPorHotel, fotosPorServicio,
    infoPorHotel, capPorHotel, planesInfo, ventanaPorPaquete, incluidosPorPaquete,
  } = datos;
  if (resProgramas.error) {
    registrarErrorTecnico(FLUJO, flujoId, "programas_resumen", "error_getProgramasResumen", resProgramas.error);
  }
  const programas = resProgramas.programas;

  if (cfgSitio.error) {
    registrarErrorTecnico(FLUJO, flujoId, "datos_auxiliares_pagina", "error_config_sitio", cfgSitio.error);
  }
  const videoFondo = cfgSitio.data?.video_fondo_url ?? null;
  registrarDatoPagina(FLUJO, flujoId, "datos_auxiliares_pagina", `consultas=1 detalle=config_sitio ${cfgSitio.error ? "resultado=error" : "resultado=ok"}`);

  const estDatos = medirPayloadSiHabilitado(datos);
  const estProgramas = medirPayloadSiHabilitado(programas);
  registrarDatoPagina(FLUJO, flujoId, "programas_resumen", `programas=${programas.length} ${textoEstimacionPayload(estProgramas)}`);
  registrarDatoPagina(
    FLUJO, flujoId, "preparacion_servidor",
    `invocacion_proceso=${invocacion} filas_pagina=${filasVisibles.length} total=${total} page=${page} pageSize=${pageSize} datos_estimacion=${textoEstimacionPayload(estDatos)} programas_estimacion=${textoEstimacionPayload(estProgramas)}`
  );
  registrarEtapa(FLUJO, flujoId, "preparacion_servidor", _cronoPrep(), "ok");

  return (
    <div className="app-bg min-h-screen bg-gray-50">
      <header className={`relative overflow-hidden bg-brand-gradient px-6 pt-8 pb-16 text-white ${videoFondo ? "flex min-h-[60vh] flex-col justify-end" : "min-h-[200px] flex flex-col justify-end"}`}>
        <BackgroundVideo url={videoFondo} overlay={0.4} />
        {!videoFondo && (
          <div
            className="absolute inset-0 bg-cover bg-center opacity-15"
            style={{ backgroundImage: "url('https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=1920&fit=crop&auto=format')" }}
          />
        )}
        <div className="relative mx-auto flex w-full max-w-[1700px] flex-wrap items-end justify-between gap-4">
          <div>
            <Logo variant="white" height={56} priority className="h-12 w-auto md:h-14" />
            <p className="mt-2 text-sm opacity-90">Tarifario 2026</p>
          </div>
          <div className="flex flex-col items-end gap-2">
            <div className="flex items-center gap-3">
              {esAgencia && (
                <span className="rounded-full bg-white/20 px-3 py-1.5 text-xs font-medium">Modo agencia</span>
              )}
              {user ? (
                <a href="/dashboard" className="rounded-lg bg-white px-4 py-2 text-sm font-medium" style={{ color: "var(--brand-primary)" }}>
                  Ir al panel →
                </a>
              ) : (
                <>
                  <a href="/portal/b2b" className="rounded-lg bg-white px-4 py-2 text-sm font-medium" style={{ color: "var(--brand-primary)" }}>
                    Portal B2B
                  </a>
                  <a href="/login" className="rounded-lg border border-white/60 px-4 py-2 text-sm font-medium text-white hover:bg-white/10">
                    Portal Admin
                  </a>
                </>
              )}
            </div>
            <CartDrawer checkoutHabilitado fotosPorHotel={fotosPorHotel} />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1700px] px-4 pt-0 pb-8 md:px-6">
        {!filasVisibles.length && !programas.length ? (
          <p className="py-20 text-center text-gray-400">Tarifario en preparación.</p>
        ) : (
          <TarifarioPublic
            filasIniciales={filasVisibles} totalInicial={total} cargaInicial
            programas={programas} puedeReservar={puedeReservar}
            cuposPorBloqueo={cuposPorBloqueo} origenPorBloqueo={origenPorBloqueo}
            fotosPorHotel={fotosPorHotel} fotosPorServicio={fotosPorServicio}
            ventanaPorPaquete={ventanaPorPaquete} infoPorHotel={infoPorHotel} planesInfo={planesInfo}
            capPorHotel={capPorHotel} incluidosPorPaquete={incluidosPorPaquete} filasAddon={filasAddon}
          />
        )}
      </main>
    </div>
  );
}
