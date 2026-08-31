import { createClient } from "@/lib/supabase/server";
import { TarifarioPublic } from "./TarifarioPublic";
import { CartDrawer } from "./CartDrawer";
import { getProgramasResumen } from "@/lib/programas";
import { Logo } from "@/components/Logo";
import { BackgroundVideo } from "@/components/BackgroundVideo";
import { cargarDatosTarifario } from "@/lib/tarifario/datos";
import { orquestarCargaPublica } from "@/lib/tarifario/orquestacion";
import { compactarFilasTarifario } from "@/lib/tarifario/compacto";
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
// línea no tiene efecto de caché medible; cada visita paga el costo
// completo de sesión + datos, sin importar cuántos segundos pasaron desde
// la anterior. Se deja tal cual (sin tocarla ni quitarla) porque no forma
// parte del incidente que se está diagnosticando — el problema no es "sirve
// una respuesta vieja", es que CADA respuesta (cacheada o no) es lenta.
export const revalidate = 120; // revalida cada 2 min (hoy sin efecto — ver nota arriba)

const FLUJO = "pagina_tarifario_publico";

// Mensaje público FIJO — nunca "Tarifario en preparación" cuando en realidad
// falló la consulta (revisión posterior, defecto "PAGINACIÓN IGNORA ERRORES").
const MSG_ERROR_CARGAR_TARIFARIO = "No fue posible cargar el tarifario en este momento. Intenta nuevamente en unos segundos.";

// Diagnóstico del incidente de ~13s: la sesión (auth.getUser + consulta de
// perfil) se resuelve PRIMERO — de ahí sale `esAgencia`/`puedeReservar`, que
// solo se USAN para el render, nunca para decidir QUÉ datos pedir (el
// tarifario/programas/config_sitio son los mismos para cualquiera). Después
// arrancan CONCURRENTEMENTE las 3 fuentes independientes: cargarDatosTarifario,
// getProgramasResumen y config_sitio. La secuencia real (nunca se invoca
// ninguna de las 3 hasta que la sesión resolvió) la garantiza
// `orquestarCargaPublica()` (lib/tarifario/orquestacion.ts, función PURA
// probada con promesas diferidas en pruebas/tarifarioOrquestacion.test.ts)
// — no un comentario ni el orden visual del código. La autorización (arrays
// de roles) y el valor de `puedeReservar` NO cambian.
export default async function TarifarioPublicoPage() {
  const flujoId = generarFlujoId();
  const invocacion = siguienteInvocacionProceso(FLUJO);
  const _cronoPrep = iniciarCronometro();

  const sb = await createClient();

  // ⚠️ Ningún cierre de abajo reasigna una variable externa (regla
  // `react-hooks/immutability` del linter de React Compiler — trata este
  // Server Component como si fuera a re-renderizar, y prohíbe mutar
  // variables capturadas por un cierre incluso aunque en la práctica un
  // Server Component solo corre una vez por request). `resolverSesion`
  // DEVUELVE todo lo que el resto de la función necesita (`user`,
  // `esAgencia`, `puedeReservar`) en vez de escribir a `let`s de afuera.
  const _cronoTotal = iniciarCronometro();
  const { sesion, datos: resDatos, programas: resProgramas, configSitio: cfgSitio } = await orquestarCargaPublica({
    resolverSesion: async () => {
      // Detectar sesión (badge de agencia + permiso de reservar). Revisión
      // posterior, defecto "RESULTADOS OK FALSOS" — autenticacion_perfil
      // nombrada explícitamente: ambas consultas ahora revisan `error`, no
      // solo `data`. Un fallo técnico real degrada al mismo default seguro
      // que "sin sesión" (nunca otorga permisos de más), pero queda
      // reflejado como resultado=error, no "ok".
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
    cargarTarifario: () => cargarDatosTarifario(sb, FLUJO, flujoId),
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
    // Nunca "Tarifario en preparación" cuando en realidad la consulta
    // falló — eso afirmaría algo falso. El detalle técnico ya quedó
    // saneado en el log dentro de cargarDatosTarifario() (registrarErrorTecnico).
    return (
      <div className="app-bg min-h-screen bg-gray-50">
        <main className="mx-auto max-w-[1700px] px-4 py-20 md:px-6">
          <p className="text-center text-red-500">{MSG_ERROR_CARGAR_TARIFARIO}</p>
        </main>
      </div>
    );
  }
  const {
    filasVisibles, filasAddon, cuposPorBloqueo, origenPorBloqueo, fotosPorHotel, fotosPorServicio,
    infoPorHotel, capPorHotel, planesInfo, ventanaPorPaquete, incluidosPorPaquete,
  } = resDatos.datos;
  if (resProgramas.error) {
    registrarErrorTecnico(FLUJO, flujoId, "programas_resumen", "error_getProgramasResumen", resProgramas.error);
  }
  const programas = resProgramas.programas;

  // Video de fondo del tarifario (global, opcional). Un error aquí es
  // puramente cosmético (el fondo queda sin video) — best-effort, pero
  // registrado como error técnico si ocurrió, nunca silencioso.
  if (cfgSitio.error) {
    registrarErrorTecnico(FLUJO, flujoId, "datos_auxiliares_pagina", "error_config_sitio", cfgSitio.error);
  }
  const videoFondo = cfgSitio.data?.video_fondo_url ?? null;
  registrarDatoPagina(FLUJO, flujoId, "datos_auxiliares_pagina", `consultas=1 detalle=config_sitio ${cfgSitio.error ? "resultado=error" : "resultado=ok"}`);

  // Costo de la propia instrumentación (revisión posterior, defecto "COSTO
  // DE LA PROPIA INSTRUMENTACIÓN"): cada valor se estima UNA sola vez y se
  // reutiliza — la estimación en sí queda detrás de
  // `DIAGNOSTICO_MEDIR_PAYLOAD=1` (ver el helper medirPayloadSiHabilitado).
  const estDatos = medirPayloadSiHabilitado(resDatos.datos);
  const estProgramas = medirPayloadSiHabilitado(programas);
  registrarDatoPagina(FLUJO, flujoId, "programas_resumen", `programas=${programas.length} ${textoEstimacionPayload(estProgramas)}`);

  // ⚠️ "preparacion_servidor" (revisión posterior, defecto "MEDICIÓN 'TOTAL'
  // INCORRECTA"): esta etapa termina ANTES del `return` de JSX — NO incluye
  // el procesamiento posterior del árbol React, la serialización RSC real
  // (formato Flight, no JSON), la transmisión al navegador, la hidratación
  // ni el pintado. Antes se llamaba "total", nombre que sugería falsamente
  // cubrir la respuesta completa.
  registrarDatoPagina(
    FLUJO, flujoId, "preparacion_servidor",
    `invocacion_proceso=${invocacion} datos_estimacion=${textoEstimacionPayload(estDatos)} programas_estimacion=${textoEstimacionPayload(estProgramas)}`
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
          <TarifarioPublic filas={compactarFilasTarifario(filasVisibles)} programas={programas} puedeReservar={puedeReservar} cuposPorBloqueo={cuposPorBloqueo} origenPorBloqueo={origenPorBloqueo} fotosPorHotel={fotosPorHotel} fotosPorServicio={fotosPorServicio} ventanaPorPaquete={ventanaPorPaquete} infoPorHotel={infoPorHotel} planesInfo={planesInfo} capPorHotel={capPorHotel} incluidosPorPaquete={incluidosPorPaquete} filasAddon={filasAddon} />
        )}
      </main>
    </div>
  );
}

