import { createClient } from "@/lib/supabase/server";
import { TarifarioPublic } from "./TarifarioPublic";
import { CartDrawer } from "./CartDrawer";
import { getProgramasResumen } from "@/lib/programas";
import { Logo } from "@/components/Logo";
import { BackgroundVideo } from "@/components/BackgroundVideo";
import { cargarResumenTarifario, MSG_ERROR_CARGAR_TARIFARIO } from "@/lib/tarifario/resumen";
import { cargarHotelesBernaloDescubiertos, cargarInfoHotelesBernalo, cargarDescripcionPaquetesBernalo, cargarPrioridadesRecomendadosBernalo } from "@/lib/tarifario/datosBernalo";
import { idsPaqueteBernaloFaltantes, fusionarDescripcionPaquete } from "@/lib/tarifario/descripcionPaquete";
import { orquestarCargaPublica } from "@/lib/tarifario/orquestacion";
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

// El mensaje público FIJO (nunca "Tarifario en preparación" cuando en
// realidad falló la consulta — defecto "PAGINACIÓN IGNORA ERRORES") vive en
// `lib/tarifario/resumen.ts` (`MSG_ERROR_CARGAR_TARIFARIO`, importado arriba)
// — una sola fuente, para no arriesgar que este archivo y el de detalle bajo
// demanda terminen mostrando textos distintos ante el mismo tipo de fallo.

// Diagnóstico del incidente de ~13s: la sesión (auth.getUser + consulta de
// perfil) se resuelve PRIMERO — de ahí sale `esAgencia`/`puedeReservar`, que
// solo se USAN para el render, nunca para decidir QUÉ datos pedir (el
// tarifario/programas/config_sitio son los mismos para cualquiera). Después
// arrancan CONCURRENTEMENTE las 3 fuentes independientes: cargarResumenTarifario,
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
  // Fase 3E Bernalo — fuente PARALELA e independiente (regla 6 del encargo):
  // nunca pasa por `orquestarCargaPublica`/`tarifario_resultado`. Best-effort
  // (igual que `configSitio`/`programas`): un fallo aquí nunca bloquea ni
  // rompe el tarifario público — la sección Bernalo simplemente queda vacía.
  const [resultadoCarga, resultadoBernalo] = await Promise.all([
    orquestarCargaPublica({
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
    cargarTarifario: () => cargarResumenTarifario(sb, FLUJO, flujoId),
    cargarProgramas: () => getProgramasResumen(sb, true), // público: SOLO publicados
    cargarConfigSitio: async () => sb.from("config_sitio").select("video_fondo_url").eq("id", 1).maybeSingle(),
    }),
    cargarHotelesBernaloDescubiertos().catch(() => ({ ok: false as const, error: "excepcion_carga_bernalo" })),
  ]);
  const { sesion, datos: resDatos, programas: resProgramas, configSitio: cfgSitio } = resultadoCarga;
  if (!resultadoBernalo.ok) {
    registrarErrorTecnico(FLUJO, flujoId, "datos_auxiliares_pagina", "error_hoteles_bernalo_descubiertos", resultadoBernalo.error);
  }
  const hotelesBernalo = resultadoBernalo.ok ? resultadoBernalo.hoteles : [];
  // Hallazgo confirmado (validación final): canal SEPARADO de identidad,
  // nunca derivado de `hotelesBernalo` (que en TarifarioPublic se filtra por
  // acomodación/categoría/régimen/texto antes de llegar a VistaBooking).
  // Viaja intacto hasta VistaBooking, exclusivamente para excluir tarjetas
  // persona obsoletas — ver el comentario en `datosBernalo.ts`. En fallo
  // técnico queda vacío (mismo criterio best-effort que `hotelesBernalo`):
  // no hay forma segura de "fallar cerrado" excluyendo tarjetas persona sin
  // saber cuáles — ocultarlas TODAS sería un daño mayor que el riesgo (ya
  // existente antes de esta función) de una tarjeta persona ocasionalmente
  // obsoleta.
  const hotelIdsUnidadAutoritativos = resultadoBernalo.ok ? resultadoBernalo.hotelIdsUnidadAutoritativos : [];
  const { user, esAgencia, puedeReservar } = sesion;
  registrarEtapa(
    FLUJO, flujoId, "tarifario_programas_config",
    Math.max(0, _cronoTotal() - sesion.ms),
    resDatos.ok && !resProgramas.error && !cfgSitio.error ? "ok" : "error"
  );

  if (!resDatos.ok) {
    // Nunca "Tarifario en preparación" cuando en realidad la consulta
    // falló — eso afirmaría algo falso. El detalle técnico ya quedó
    // saneado en el log dentro de cargarResumenTarifario() (registrarErrorTecnico).
    return (
      <div className="app-bg min-h-screen bg-gray-50">
        <main className="mx-auto max-w-[1700px] px-4 py-20 md:px-6">
          <p className="text-center text-red-500">{MSG_ERROR_CARGAR_TARIFARIO}</p>
        </main>
      </div>
    );
  }
  const {
    filasVisibles, filasAddon, cuposPorBloqueo, origenPorBloqueo, fotosPorHotel: fotosPorHotelLegacy, fotosPorServicio,
    infoPorHotel: infoPorHotelLegacy, capPorHotel, planesInfo, ventanaPorPaquete, descripcionPorPaquete: descripcionPorPaqueteLegacy,
    prioridadesRecomendados,
  } = resDatos.datos;

  // P2 (hallazgo confirmado): las tarjetas de hoteles por unidad mostraban
  // "Sin foto" fijo y nunca leían estrellas/descripción/Adults Only/Pet
  // friendly reales — `fotosPorHotel`/`infoPorHotel` de arriba solo cubren
  // los `hotelId` de `filasVisibles` (hoteles persona). Se enriquece con el
  // MISMO criterio (mismas columnas) para los `hotelId` de `hotelesBernalo`
  // y se combina en un solo mapa — best-effort: un fallo acá es decorativo
  // (la tarjeta unidad queda sin foto/badges) y NUNCA bloquea la página.
  //
  // Hallazgo confirmado (auditoría posterior): `descripcionPorPaqueteLegacy`
  // solo cubre paquetes con fila persona (bloqueo/porción terrestre) en
  // `tarifario_resumen` — un paquete cuyo único hotel es `modelo_tarifario =
  // 'unidad'` queda sin Incluye/No incluye aunque SÍ tenga contenido
  // configurado. `idsPaqueteBernaloFaltantes` (helper puro, lib/tarifario/
  // descripcionPaquete.ts) calcula los `paqueteId` REALES de `hotelesBernalo`
  // que YA no tienen descripción cargada por el flujo persona (regla 4: nunca
  // sobrescribe) — nunca el catálogo completo de paquetes (regla 6).
  //
  // Ambos conjuntos de IDs se calculan ANTES de disparar ninguna consulta,
  // para poder lanzar las DOS cargas Bernalo (fotos/info de hotel y
  // descripción de paquete) en el MISMO `Promise.all` — son independientes
  // entre sí (una consulta `hoteles`, la otra `armado_paquetes`) y antes
  // corrían en serie (`await` uno, luego `await` el otro), pagando dos
  // round-trips secuenciales sin necesidad.
  const hotelIdsBernalo = [...new Set(hotelesBernalo.map((h) => h.hotelId))];
  const paqueteIdsBernaloFaltantes = idsPaqueteBernaloFaltantes(hotelesBernalo, descripcionPorPaqueteLegacy);
  // Hoteles recomendados (migración 183) — prioridades de paquetes UNIDAD
  // (ver la cabecera de `cargarPrioridadesRecomendadosBernalo`). Se LANZA
  // acá (sin `await` todavía) para correr EN PARALELO con el `Promise.all`
  // de abajo — nunca en serie después de él — y se resuelve más abajo. No
  // se sumó como tercer elemento del `Promise.all` existente a propósito:
  // `pruebas/descripcionPaquetesBernaloWiring.test.ts` fija ese bloque
  // EXACTO (dos elementos) como guarda de regresión de concurrencia; un
  // tercer elemento ahí lo habría roto sin necesidad.
  const paqueteIdsBernaloTodos = [...new Set(hotelesBernalo.map((h) => h.paqueteId))];
  const prioridadesBernaloPromise = cargarPrioridadesRecomendadosBernalo(paqueteIdsBernaloTodos);
  // ⚠️ Guarda de concurrencia (regresión ya corregida una vez): las DOS
  // cargas siguientes DEBEN lanzarse juntas en este `Promise.all` — nunca
  // `await cargarInfoHotelesBernalo(...)` seguido de un `await
  // cargarDescripcionPaquetesBernalo(...)` por separado (eso las serializa
  // de nuevo). `pruebas/descripcionPaquetesBernaloWiring.test.ts` falla si
  // alguna de las dos vuelve a aparecer fuera de este arreglo.
  const [resultadoInfoBernalo, resultadoDescripcionBernalo] = await Promise.all([
    cargarInfoHotelesBernalo(hotelIdsBernalo),
    cargarDescripcionPaquetesBernalo(paqueteIdsBernaloFaltantes),
  ]);
  const resultadoPrioridadesBernalo = await prioridadesBernaloPromise;
  if (resultadoPrioridadesBernalo.error) {
    registrarErrorTecnico(FLUJO, flujoId, "datos_auxiliares_pagina", "error_prioridades_recomendados_bernalo", resultadoPrioridadesBernalo.error);
  }
  // Fusión con las prioridades del flujo persona — misma clave
  // (`claveOferta`, hotelId+paqueteId) en ambos conjuntos, así que combinan
  // sin colisión (un hotel no puede ser persona y unidad para el mismo
  // paquete a la vez).
  const prioridadesRecomendadasCombinadas = { ...prioridadesRecomendados, ...resultadoPrioridadesBernalo.prioridades };

  // P5 (hallazgo confirmado, validación final): `cargarInfoHotelesBernalo`
  // ya NO devuelve un único `ok` para las DOS consultas (fotos/hoteles) —
  // cada una es independiente (`errorFotos`/`errorInfo`), así que un fallo
  // en `hotel_fotos` nunca borra las estrellas/Adults Only/Pet friendly que
  // sí se resolvieron bien (y viceversa). El merge con lo legacy es
  // incondicional: `resultadoInfoBernalo.fotosPorHotel`/`infoPorHotel` ya
  // vienen vacíos (no ausentes) cuando su propia consulta falló.
  if (resultadoInfoBernalo.errorFotos) {
    registrarErrorTecnico(FLUJO, flujoId, "datos_auxiliares_pagina", "error_fotos_hoteles_bernalo", resultadoInfoBernalo.errorFotos);
  }
  if (resultadoInfoBernalo.errorInfo) {
    registrarErrorTecnico(FLUJO, flujoId, "datos_auxiliares_pagina", "error_info_hoteles_bernalo", resultadoInfoBernalo.errorInfo);
  }
  const fotosPorHotel = { ...fotosPorHotelLegacy, ...resultadoInfoBernalo.fotosPorHotel };
  const infoPorHotel = { ...infoPorHotelLegacy, ...resultadoInfoBernalo.infoPorHotel };

  // Best-effort (mismo criterio que fotos/info arriba): un fallo acá deja
  // esos paquetes sin Incluye/No incluye — nunca toca precio ni
  // disponibilidad Bernalo, que siguen siendo exclusivos de EditorPax/
  // cotizarAlojamientoBernaloPublico. La fusión (`fusionarDescripcionPaquete`,
  // helper puro) deja SIEMPRE ganando lo cargado por el flujo persona, sin
  // mutar ninguno de los dos objetos de entrada.
  if (resultadoDescripcionBernalo.error) {
    registrarErrorTecnico(FLUJO, flujoId, "datos_auxiliares_pagina", "error_descripcion_paquetes_bernalo", resultadoDescripcionBernalo.error);
  }
  const descripcionPorPaquete = fusionarDescripcionPaquete(resultadoDescripcionBernalo.descripcionPorPaquete, descripcionPorPaqueteLegacy);

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
        {/* P1-1: un catálogo con SOLO hoteles por unidad (sin ninguna fila
            legacy ni programa) es un catálogo válido — nunca "en
            preparación". `hotelesBernalo` es la tercera fuente que puede
            justificar montar `TarifarioPublic` por sí sola. */}
        {!filasVisibles.length && !programas.length && !hotelesBernalo.length ? (
          <p className="py-20 text-center text-gray-400">Tarifario en preparación.</p>
        ) : (
          <TarifarioPublic filas={filasVisibles} programas={programas} puedeReservar={puedeReservar} cuposPorBloqueo={cuposPorBloqueo} origenPorBloqueo={origenPorBloqueo} fotosPorHotel={fotosPorHotel} fotosPorServicio={fotosPorServicio} ventanaPorPaquete={ventanaPorPaquete} infoPorHotel={infoPorHotel} planesInfo={planesInfo} capPorHotel={capPorHotel} descripcionPorPaquete={descripcionPorPaquete} filasAddon={filasAddon} hotelesBernalo={hotelesBernalo} hotelIdsUnidadAutoritativos={hotelIdsUnidadAutoritativos} prioridadesRecomendados={prioridadesRecomendadasCombinadas} />
        )}
      </main>
    </div>
  );
}
