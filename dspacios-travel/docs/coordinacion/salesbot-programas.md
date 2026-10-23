# SalesBot de programas #56 - bitacora del ejecutor

Responsable: chat independiente de SalesBot (ejecutor). Rinde cuentas al Auditor. Unica superficie de escritura: este archivo. `TASKS.md` y `WORKSTREAMS.md` los mantiene el Coordinador.

## Estado vigente (2026-10-18)

- **Gate actual (Auditor, 2026-10-18):** seguir afinando el contrato solo en esta bitacora, sin codigo ni SQL.
  - No presentar un total ni una comision calculada hasta resolver **#57** (paridad entre el precio mostrado y el cobrado, y la base comisionable sin impuestos).
  - La posible lectura anonima de costos es el frente separado **#58**; #56 no cambia sus permisos.
  - Quedan pendientes: los roles (incluido `control_vuelo`), la retencion y el acceso a las conversaciones, y la vigencia de los datos.
  - Q1 la ejecuta el Auditor cuando coordine esa revision.
- **Base de lectura:** `main` = `89b6f19d` (PR #364).
- **Que se hizo y que no:** no se edito codigo, no se ejecuto SQL, no se creo worktree ni rama, no se uso ningun modelo de IA y no se corrio ninguna prueba. Lo marcado "demostrado por lectura" no esta comprobado en ejecucion ni en Produccion.
- **Documento inicial:** `docs/futuro/salesbot-consulta-programas.md` sigue sin seguimiento en el worktree de rescate; no se copio ni se edito.
- **2026-10-18, cambio de alcance (Auditor):** SalesBot es multiproducto. Se entrego en solo lectura el mapa de bloqueo y porcion terrestre (seccion "Alcance multiproducto"). #366 = pieza parcial de Programas. No se editaron motores, vuelos, reservas ni la 218.
- **2026-10-19, r2 implementada LOCAL (seccion "Implementacion local r2"):** bloqueo y porcion terrestre con pestanas, sin commit; #366 sigue en Draft. La prueba de cableado de r1 que caia con `EISDIR` se corrigio con autorizacion del Auditor (+2/-2). `test:unit` final: 5899/5911; las 12 que fallan son ajenas a #56. **Hallazgo:** H-PQ1 ampliado y reproducido en simulacion. **NO GO del Auditor y correcciones r2.1** (seccion propia): pendiente nuevo gate.
- **2026-10-19, mapa de Servicios y Dinamico (solo lectura, seccion propia):** hallazgos H-SV1 (precio de servicios distinto entre Reservar interno y checkout) y H-DI1 (vigencia de compra de salidas dinamicas no aplicada), entregados al Coordinador junto con H-PQ1 como frentes fuera de #56. Pendientes D13-D15.
- **2026-10-20, r2.2 + r2.3 (local, sin commit):** la oferta de bloqueo ya no publica ruta ni origen (ni `bloqueo_label` ni `origenPorBloqueo`), y `pct_mk` no interpretable se rechaza en vez de volverse 0. Focales 213/213 y contrapruebas 25/25. Pendientes: el gate y la autorizacion del dueno; GitHub Actions tras el push.
- **2026-10-20, MVP de conversacion guiada: encargo recibido, codigo NO iniciado.**
  - **Base verificada:** head de #366 = `c12ecba6` (r2.3 + workflow `test-salesbot-56.yml`), worktree limpio.
  - **Falta la reserva:** `WORKSTREAMS.md` no la tiene todavia; la fila de #56 sigue siendo la de la ampliacion a bloqueos y porcion. El encargo condiciona el codigo a que el Coordinador confirme la reserva exacta.
  - **Reserva aprobada por el dueno (2026-10-20), con la condicion de "no afectar los demas trabajos ni danar ningun flujo":** la propuesta del encargo mas las tres rutas adicionales de abajo. Codigo iniciado sobre `c12ecba6`.
    - **Decision de compatibilidad:** sin `?producto=`, la pagina abre la conversacion; si llegan parametros de busqueda de Programas (formularios GET existentes), abre Programas como antes. No se toca `PanelProgramas.tsx`.
  - **Rutas adicionales que el MVP necesitaria, fuera de la propuesta:**
    - **(1)** `pruebas/salesbot56Cableado.test.ts:46-49` y `pruebas/salesbot56BloqueoCableado.test.ts:133-137`. Exigen que la pagina y las pantallas sean de servidor, sin `"use client"`, `textarea` ni "chat", y la conversacion necesita un componente de cliente. Hay que acotar esas reglas a las vistas secundarias y a la lectura `server-only`, no quitarlas.
    - **(2)** `.github/workflows/test-salesbot-56.yml`: lista las suites una por una, asi que las nuevas `salesbot56Conversacion*` no correrian sin agregarlas. Los `paths` ya cubren las rutas.
    - **(3)** Para verificar movil y escritorio en el navegador integrado: un `.claude/launch.json` local, o arrancar el dev server de otra forma, y una sesion real de un rol aprobado. El dev local lee datos de Produccion en modo lectura; lo decide el dueno.
- **2026-10-19, entrega para revision:** r2.1 ya esta commiteado y subido como `e08c2b80` (head de #366), y su contenido es identico al parche r2.1. Gate solicitado y hoja de decisiones de la 218 en sus secciones. Servicios queda en analisis hasta #61 (H-SV1). Dinamico espera #62 y el hotfix #63.
- **2026-10-19, aclaracion del dueno:** no hay un chat Auditor aparte. El ejecutor (#56) rinde cuentas directamente al Coordinador; donde esta bitacora dice "Auditor" desde el 2026-10-19, se refiere al Coordinador.
- **2026-10-19, instruccion del Auditor sobre el alcance (registrada; NO se mezcla con el PR #366):**
  - #56 sigue siendo multiproducto. Continua el gate actual de Bloqueos y Porcion terrestre (r2.1).
  - **Dinamico: NO entra todavia al bot.** Depende de dos cambios ajenos a #56:
    - **(a)** el hotfix que coordina Chat #4 para poder elegir promociones de Empaquetados en Salidas dinamicas;
    - **(b)** la correccion de la vigencia de esas salidas, **#62** (es el H-DI1 de esta bitacora).
    - Cuando ambos esten integrados en `main`, el ejecutor revisa la paridad del bot con el flujo de venta actualizado antes de proponer la pieza.
  - **Servicios/receptivos:** solo analisis. No se cambian los motores, y ningun precio de servicio se publica como definitivo hasta que se resuelva **H-SV1** (diferencia entre Reservar interno y checkout).
  - Respondidas asi D14 (Dinamico espera) y, en parte, D13 (Servicios: solo analisis por ahora).
- **Historial de esta bitacora:**
  - Fases 1 y 2 entregadas.
  - Decisiones D1-D7 del dueno incorporadas.
  - Correccion del ejecutor sobre la comision B2B (ver D1).
  - Esta version reorganiza el contrato segun el gate actual.

## Implementacion local r1 (GO LOCAL del Auditor, 2026-10-18)

- **GO del Auditor:**
  - Solo busqueda y detalle, para los roles aprobados y en Mayorista, con lectura segura, PVP por persona como referencia y pruebas focales.
  - B2B: solo el % propio de la agencia elegida, sin inventar el general.
  - Nada de chat sin proveedor, totales, reservas, canales, conversaciones guardadas ni migracion 218.
  - No tocar `reservar/actions.ts`, `proxy.ts`, RLS, CRM, `types/database.ts` ni `package.json`.
  - Sin staging, commit, push ni SQL remoto.
- **Donde:** worktree `.claude/worktrees/salesbot-programas-56`, rama `codex/56-salesbot-programas`, creada desde `main` `89b6f19d` (verificado al crearlo, = `origin/main`). Dependencias instaladas con `pnpm install --frozen-lockfile`; el lockfile no cambio.
- **Archivos tocados** (todos dentro de la reserva):
  - **Modificado `lib/programas.ts` (+135/-10):**
    - Se extrae SIN CAMBIOS el armado del detalle a `armarDetallePrograma`, la funcion pura que incluye el PVP por salida. `getProgramaDetalle` conserva sus consultas de siempre y le delega el armado.
    - Nuevo `getProgramaDetalleSeguro`: propaga todos los errores, filtra hoteles y precios por las categorias del programa (R3/R4) y no lee el proveedor.
    - Las unicas lineas eliminadas son la cabecera movida y el `select` de salidas, ahora en una constante con el mismo texto.
  - **Modificado `lib/constants.ts` (+4):** modulo `salesbot` con los 5 roles aprobados (sin `control_vuelo`) y la ruta `/dashboard/salesbot`. `proxy.ts` la protege sin tocarlo, porque toma la ruta de `MODULO_POR_RUTA`.
  - **Modificado `app/(dashboard)/layout.tsx` (+1):** entrada "Consulta de programas" con `modulo: "salesbot"` y `minoristaOculto: true`. Usa la clave de icono existente `tarifario` para no tocar `SidebarNav.tsx`.
  - **Nuevo `lib/salesbot/contrato.ts`:** tipos, lista negra (`CLAVES_PROHIBIDAS`), sello de 15 minutos.
  - **Nuevo `lib/salesbot/acceso.ts`:** decision pura de acceso con la misma lista de roles que la ruta, y solo Mayorista.
  - **Nuevo `lib/salesbot/consulta.ts`:** funciones puras de criterios, filtros, fecha (vigencia y blackouts, como en reservar), marca `precio_en_revision` (#57), lista blanca del detalle y % propio de la agencia (estados `propio`, `sin_pct_propio`, `pct_invalido`, `no_encontrada`; nunca un default).
  - **Nuevo `lib/salesbot/lectura.ts`:**
    - `server-only`, con la sesion del usuario y sin `service_role`.
    - Solo lee: sin insert, update, delete ni RPC.
    - Lecturas internas paginadas.
    - Falla cerrado ante cualquier error.
    - Defensa final: si una salida trae una clave prohibida, responde error.
  - **Nuevo `app/(dashboard)/dashboard/salesbot/page.tsx`:**
    - Consulta de servidor: formulario GET con texto, destino, transporte, fecha, presupuesto, audiencia y agencia.
    - Resultados con "Desde" por persona (referencia), detalle con lista blanca y sello con su vigencia.
    - No es un chat ni hay JavaScript de cliente.
  - **Nuevas pruebas:** `pruebas/salesbot56Consulta.test.ts`, `pruebas/salesbot56Detalle.test.ts` y `pruebas/salesbot56Cableado.test.ts`. Son `.test.ts`, asi que entran solas por el glob de `test:unit` sin tocar `package.json`.
- **Resultados (ejecutados por el ejecutor en el worktree):**
  - Las 3 suites nuevas: **55/55**, 0 fallos.
  - **Contrapruebas** (mutacion temporal y restauracion verificada por hash):
    - M1: el lector seguro sin filtrar precios por programa hace fallar 1 prueba.
    - M2: el neto en el detalle hace fallar 1 prueba.
    - M3: un default para una agencia sin % hace fallar 1 prueba.
    - M4: `control_vuelo` en el modulo hace fallar 3 pruebas.
  - **Regresion de las suites existentes que tocan programas, constantes y menu** (12 archivos: `programasResumen`, `programaModalidadMk`, `programaTarifaComisionable`, `programaImpuestosAcomodacion`, `programaDestinoFijo`, `programaRutaAlojamiento`, `dashboardShellWiring`, `sidebarNavPendienteWiring`, `tarifarioCargaWiring`, `contratoManual`, `loadingScreen`, `vuelosInfanteContratoManual.wiring`): **429/429**.
  - `tsc --noEmit` exit 0; ESLint de los archivos tocados exit 0 y sin avisos; `git diff --check` limpio.
  - `pnpm run build`: exit 0 (Next 16.3.0 con Turbopack, 16/16 paginas; `/dashboard/salesbot` dinamica). El build no modifico archivos rastreados; solo aparece el aviso de siempre sobre el campo `pnpm` de `package.json`.
  - No se corrio la suite unitaria completa ni la React.
- **Parche completo para revision:** scratchpad del ejecutor, `salesbot56-r1.patch` (2022 lineas, sha256 `0ffb8ee7d26a8144`). Incluye los 3 archivos modificados y los 8 nuevos.
- **No verificado:** la pagina en un navegador con datos reales, con sesion de cada rol y tenant. Solo hay pruebas unitarias y de cableado.

## Implementacion local r2: Bloqueos y Porcion terrestre (2026-10-19)

- **Encargo del Auditor:**
  - Implementar `buscarBloqueos`, `cotizarBloqueo`, `buscarPorcion` y `cotizarPorcion` segun la reserva #56, con los motores vigentes y totales orientativos.
  - B2B: solo el % propio, sin monto. Pestanas por producto. Fuera: add-ons, mascotas y Bernalo.
  - Nunca netos, record, datos de sillas ni errores internos.
  - Probar paridad de precios, cupos, vigencia, acceso y saneamiento de la salida.
  - #366 sigue en Draft. Sin staging, commit, push ni SQL remoto. Detenerse si hace falta editar un motor o un archivo fuera de la reserva.
- **Donde:** el mismo worktree y la misma rama (HEAD `b2fa783f`), con los cambios sin commit y nada en staging.
- **Archivos** (todos dentro de la reserva, verificado con `git diff --name-only`):
  - **Modificados (autorizados):**
    - `lib/salesbot/contrato.ts`:
      - La lista negra suma `record`, `tarifa_neta`, `tarifa_para_empaquetar`, `impuesto`, `impuestoTotal`, `netoPorAcom`, `netos`, `costoNeto`, `costo_neto`, `proveedorId`, `proveedor_id_servicio`, `serviciosIncluidos`, `numero_silla`, `pasajero_nombres`, `pasajero_apellidos`, `numero_doc`, `nacimiento`, `cupos_ocupados` y `cupos_devueltos`.
      - Nuevos codigos `no_encontrado` y `no_cotizable`, y las 4 fuentes nuevas del sello.
      - `total` sigue prohibido; el total de paquetes se llama `total_orientativo`.
    - `app/(dashboard)/dashboard/salesbot/page.tsx`: ahora solo trae el encabezado "Consulta comercial", las pestanas y el panel activo. El contenido de Programas paso a `PanelProgramas.tsx` sin cambiar su comportamiento.
  - **Nuevos:**
    - `lib/salesbot/paquetes/contrato.ts`, `bloqueo.ts` y `porcion.ts`: puros.
    - `lib/salesbot/paquetes/lectura.ts`: `server-only`.
    - Pantallas `comun.tsx`, `PanelProgramas.tsx`, `PanelBloqueos.tsx` y `PanelPorcion.tsx`.
    - 6 pruebas: `pruebas/salesbot56{Bloqueo,BloqueoParidad,BloqueoLectura,BloqueoCableado,Porcion,PorcionParidad}.test.ts`.
  - **Sin tocar:**
    - Los motores (`lib/tarifario/*`, `lib/reservar/*`, `lib/acomodaciones.ts`, `lib/calc/*`), `reservar/actions.ts`, el checkout y `proxy.ts`.
    - RLS, migraciones, `package.json`, `types/database.ts` y `pruebas/support/*`.
    - Los archivos de r1 que no estaban autorizados: `acceso.ts`, `consulta.ts`, `lectura.ts`, `programas.ts`, `constants.ts`, `salesbot56Consulta.test.ts` y `salesbot56Detalle.test.ts`.
    - `salesbot56Cableado.test.ts` solo se toco despues, con autorizacion expresa del Auditor (ver "Prueba de r1 rota", abajo).
- **Como funciona:**
  - **Contexto (`prepararConsultaPaquetes`):**
    - Misma regla de acceso que r1 (`resolverAccesoConsulta`): 5 roles, solo Mayorista y usuario activo. Los mensajes son propios, para no hablar "de programas" en las otras pestanas.
    - Exige que la llave de servidor EXISTA: solo comprueba su presencia, nunca lee su valor. Sin ella el cargador del tarifario no filtra la vigencia de compra ni los cupos, asi que se falla cerrado.
    - Carga el catalogo UNA vez por peticion con `cargarDatosTarifario`.
  - **buscarBloqueos:**
    - Agrupa `filasVisibles` en ofertas de paquete x origen x hotel. Las filas ya vienen filtradas por paquete publicable, vigencia de compra y salida no pasada. El origen es el bloqueo negociado o el tiquete de sistema, y cada oferta debe tener exactamente uno, como exige el motor.
    - El "desde" es el minimo entre habitaciones.
    - Sillas: conteo agregado de `cuposPorBloqueo`. Sin dato, `no_verificada`; un empaquetado queda `sujeto_a_confirmacion`.
    - Ruta: sale de `bloqueo_label`, con una defensa que quita tokens con forma de record.
  - **cotizarBloqueo:**
    - La oferta y el combo deben estar VISIBLES; si no, `no_encontrado` y el motor no se llama.
    - `computarReserva` corre con la SESION del usuario y con la misma forma de entrada que el checkout (`checkout/actions.ts:698-722`): sin datos personales, pasajeros, add-ons ni mascotas, con `edadesMenores`.
    - Total = `precioVenta` del motor; `alcanzan_sillas` = sillas >= `paxConSilla`.
  - **buscarPorcion:**
    - El destino es obligatorio y debe estar entre los publicados; nunca se reliquida el catalogo completo.
    - `buscarHoteles` reliquida en vivo y su `total` sale como `total_orientativo`.
  - **cotizarPorcion:**
    - El hotel debe estar publicado en porcion.
    - `cotizarPorFechas` da el PVP por persona de cada combo y marca `precio_no_final` si hay incluidos por grupo pendientes.
    - Con combo y composicion, suma el total de `computarReserva`.
    - Si no hay tarifa, devuelve las sugerencias de fecha en forma publica.
  - **Errores del motor (`clasificarMensajeMotor`):**
    - Pasan a `error_tecnico`, con mensaje generico, los que traen senal tecnica: Postgres o Supabase, "No se pudo", "No pudimos ... en este momento", nombres de tablas o cualquier identificador snake_case.
    - Pasan a `no_cotizable`, con su motivo, los comerciales: Adults Only, vigencia vencida, sin tarifa.
    - Bernalo recibe un motivo propio, sin nombres internos.
    - Todo rechazo queda registrado en el servidor.
  - **Defensa final:** `clavesProhibidasEn` revisa cada salida.
  - **Pantallas:**
    - Pestanas Programas / Bloqueos / Porcion terrestre (`?producto=`) con formularios GET de servidor, sin JavaScript propio.
    - Fechas con el `DateInput` compartido, iconos lucide y sello de 15 minutos.
    - B2B usa el mismo `porcentajeAgencia` de r1: solo el % propio, sin base ni monto.
- **Hallazgo nuevo: H-PQ1 ampliado (reproducido en simulacion, NO verificado en Produccion; para el Coordinador, no se toca desde #56):**
  - Ademas de las mascotas y el impuesto, `computarReserva` usa el `pct_mk` leido con la sesion (`computo.ts:348`) para cobrar los **servicios incluidos por grupo** (`cargoGrupoIncluido`, `computo.ts:~903`).
  - Para `venta`, `agencia`, `freelance` y `anon`, la RLS 018 de `armado_paquetes` devuelve vacio, y el grupo se cobra **sin markup**.
  - Reproducido con el motor real y datos simulados, en bloqueo y en porcion: un traslado por grupo de 100.000 con `pct_mk` 0,2 da 125.000 en sesion interna y 100.000 en sesion de `venta`.
  - En porcion, ademas, la busqueda (`buscarHoteles`, con service-role) muestra el total correcto, y la venta montada por `venta` cobraria menos.
  - **Impacto probable fuera del bot:** un contrato que monta un asesor `venta`, o el checkout publico, para un paquete con incluidos por grupo se venderia sin el margen de ese servicio.
  - **Mitigacion dentro del bot, sin tocar el motor:**
    - `sesionLeeMarkup` hace un select de `armado_paquetes.id` con la sesion.
    - Si la sesion no ve el paquete y el total trae un cargo fuera de las lineas por persona (`cargoFueraDeLineas` > 0), el bot NO presenta el total: responde `no_cotizable` ("pide el total a administracion u operaciones").
    - Sin cargo aparte, el total no depende del % y se presenta.
- **Prueba de r1 rota por la carpeta nueva (RESUELTO 2026-10-19, con autorizacion expresa del Auditor):**
  - `pruebas/salesbot56Cableado.test.ts` (r1) hacia `readdirSync("lib/salesbot/")` y leia cada entrada como archivo. Con `lib/salesbot/paquetes/` (carpeta que exige la reserva) caia con `EISDIR` antes de correr sus pruebas, y dejaba rojo `test:unit`.
  - El ejecutor se detuvo porque ese archivo estaba fuera de la reserva. El Auditor autorizo filtrar solo `.ts` al leer `lib/salesbot/`.
  - **Arreglo aplicado (+2/-2):** `.filter((f) => f.endsWith(".ts"))` en las dos lecturas del directorio (lineas 14 y 54). No cambia ninguna regla.
  - Despues del arreglo: el cableado de r1 da 12/12 y ESLint exit 0.
  - La subcarpeta `paquetes/` la cubre `salesbot56BloqueoCableado.test.ts`, que recorre `lib/salesbot/` COMPLETO con las mismas reglas y algunas mas.
- **Correccion de paso en Programas:** el `<input type="date">` nativo de r1 incumplia `calendariosCobertura.test.ts`; ahora es `DateInput`. r1 ya fallaba esa prueba y no se detecto porque no se corrio la suite completa.
- **Resultados (ejecutados por el ejecutor en el worktree):**
  - **Pruebas focales: 185/185.**
    - Nuevas: Bloqueo 44, BloqueoParidad 16, BloqueoLectura 36, BloqueoCableado 18, Porcion 18 y PorcionParidad 9 (141 en total).
    - Tambien r1 Consulta y Detalle (43) y el calendario (1).
  - **Paridad con el motor real** (`computarReserva`, `buscarHoteles` y `cotizarPorFechas`, con el cliente simulado del repo):
    - La entrada del bot da un resultado IDENTICO (`deepEqual`) al de la entrada del checkout con datos del cliente.
    - Valores exactos calculados a mano: bloqueo 2.400.000 y porcion 1.800.000.
    - En porcion, la busqueda, el precio por persona y la venta coinciden.
  - **Cupos:** 2 libres no alcanzan; 3 y 5 si; 0 = sin sillas; sin dato = no verificada.
  - **Vigencia:** tarifa vencida, empaquetado desactivado y oferta no visible no dan precio.
  - **Acceso:** 5 roles si. No: `control_vuelo`, los roles externos, sin sesion, usuario inactivo y Minorista; sin autorizacion ni siquiera se carga el catalogo.
  - **Contrapruebas:** 17 mutaciones, 17 detectadas, con restauracion verificada por hash.
  - **Regresion `test:unit` completa:**
    - **Primera corrida** (antes de `DateInput` y del arreglo de r1): 5900 pruebas, 5886 pasan y 14 fallan. 1 era la de r1 por `EISDIR`, 1 la del calendario y 12 las ajenas de abajo.
    - **Corrida final** (`pnpm run test:unit`, con el codigo final y el arreglo de r1): **5911 pruebas, 5899 pasan y 12 fallan.**
      - Ninguna de las 12 es de #56. El cableado de r1 ya corre sus 12 pruebas y todas pasan; la del calendario pasa.
      - Las 12 estan en 8 archivos ajenos (`crmLeads.wiring`, `crmLeadsNormalizacion`, `personasConsulta.wiring` (214), `hotelModalOrdenSecciones`, `ocupacionBernaloUI3EWiring`, `tarjetaCompletaBuscarAlojamiento`, `tarjetaHotelExpandible` y `suitesPruebas`). Son las mismas 12 de la primera corrida.
      - No leen ningun archivo de esta pieza (ninguno menciona `salesbot`, y el unico que recorre carpetas revisa `pruebas/*.react.ts`, de los que esta pieza no agrego ninguno): son independientes por construccion. No se verificaron en un checkout limpio de `b2fa783f`.
  - `tsc --noEmit` exit 0. ESLint sobre `salesbot/`, `lib/salesbot/` y `pruebas/salesbot56*` exit 0. `git diff --check` limpio y archivos nuevos sin espacios finales.
  - `pnpm run build` con el codigo final: exit 0 (16/16 paginas; `/dashboard/salesbot` dinamica). No modifico archivos rastreados.
  - No se corrio la suite React (`test:react`).
- **Parche:** scratchpad del ejecutor, `salesbot56-r2.patch` (4437 lineas, sha256 `3a5dae8b31d20f40`, 17 archivos: 3 modificados y 14 nuevos; incluye el arreglo de r1). Nada en staging.
- **Limitaciones:**
  - `paquetes/lectura.ts` repite la autenticacion de `lib/salesbot/lectura.ts`, que no se podia modificar. Usa la misma regla, con sus propios mensajes.
  - ~~La defensa contra un record en `bloqueo_label` es heuristica~~ (P1 del NO GO; corregido en r2.1 con lista blanca).
  - Las sillas son las libres AL CONSULTAR: no se apartan. El bot nunca afirma disponibilidad hotelera.
  - Mascotas, add-ons y Bernalo quedan fuera; tampoco hay monto de comision.
  - **No verificado:** la pagina en un navegador con datos reales y con la sesion de cada rol.
- **Sigue sin hacer:** chat, conversaciones, migracion 218, canales y monto de comision.

## Correcciones r2.1 al NO GO del Auditor (2026-10-19)

**Veredicto recibido: NO GO** para commit y push de r2.
- El Auditor verifico que el parche coincide con el worktree (17 archivos, `3a5dae8b...`) y que no toca superficies prohibidas.
- Encontro dos P1 y un P2. Las tres correcciones estan en archivos de esta pieza, dentro de la reserva. No se toco ningun motor, y sigue sin commit ni staging.
- Decisiones del Auditor: **B, si**: H-PQ1 ampliado pasa a un frente propio de precio y venta, fuera de #56. **C, si**: las 12 fallas son deuda de la base. Las corrio en `main` y en r2 y dieron identicas, 196/208 en las 8 suites.

- **P1, PNR visible (`bloqueo.ts:66`): corregido con lista blanca.**
  - `rutaPublica` ya no intenta reconocer un PNR para borrarlo. Extrae SOLO la primera ruta en codigos IATA de 3 letras separados por guion (`MAD-BOG`, `BOG-ADZ-BOG`), la normaliza a mayusculas y descarta todo lo demas. Sin ruta reconocible devuelve null: la tarjeta muestra destino y fechas, y el titulo de cotizacion ya no deja un " · " suelto.
  - El caso del Auditor pasa: `"MAD-BOG · QWERTY"` da `"MAD-BOG"`. Tambien `"QWERTY · MAD-BOG"`, `"L93FYZ · BOG-ADZ"`, `"AV9381 BOG-CTG"` y `"bog - adz"`.
  - Devuelven null: `"QWERTY"`, `"L93FYZ"`, `"ABCDEF-BOG"` (PNR pegado a la ruta con guion), `"QWE-RTYU"` y `"Salida especial"`.
  - **Riesgo residual:** un PNR escrito como dos grupos de 3 letras con guion (`ABC-DEF`) se tomaria por ruta. Un PNR no se escribe asi.
- **P1, error tecnico crudo (`contrato.ts:159`): corregido con lista blanca.**
  - `clasificarMensajeMotor` falla cerrado en tres niveles:
    1. Con senal tecnica o vacio: `error_tecnico`, con mensaje generico.
    2. Si coincide COMPLETO con un mensaje comercial conocido: `no_cotizable` con ese texto.
    3. Cualquier otro: `no_cotizable` con `MOTIVO_NO_COTIZABLE_GENERICO` ("Esta combinacion no se puede cotizar desde aqui. Revisala con el asesor."). El texto del motor nunca sale.
  - La lista blanca (`MENSAJES_COMERCIALES`, 24 patrones anclados con `^...$`) se armo leyendo los mensajes reales de `computo.ts`, `cotizar.ts`, `edadesMenores.ts`, `distribucionHabitaciones.ts` y `origen.ts`. Los patrones dinamicos solo admiten numeros, fechas ISO y palabras fijas (`niño` / `infante`, `menores` / `adultos` / `pax`).
  - El caso del Auditor sale con el motivo generico: `"Error interno: fallo de conexion con inventario privado"`. Tampoco pasa un mensaje conocido con texto agregado.
  - **Riesgo residual:** un mensaje comercial nuevo de los motores, que no este en la lista, se vera generico hasta agregarlo. Falla cerrado.
- **P2, guarda de markup incompleta (`lectura.ts:116`): endurecida, con un riesgo residual declarado.**
  - `leerMarkupSesion` lee la MISMA columna que el motor (`armado_paquetes.pct_mk`, `computo.ts:348`), con la misma sesion y la misma normalizacion (`Number(...) || 0`). Un error o una fila invisible cuentan como "no confiable".
  - `computarConMarkupVerificado` lee antes del motor y, si el total trae cargo fuera de las lineas, otra vez despues. El total solo se presenta si las dos lecturas funcionan y dan el mismo %. Un `pct_mk` nulo vale 0, igual que en el motor, y cuenta como configuracion real.
  - Sin cargo aparte, el total no depende del %: se presenta y no se hace la segunda lectura.
  - El valor leido nunca sale: solo se compara (`antes.pct === despues.pct`), y `pct_mk` ya esta en la lista negra.
  - **Riesgo residual (no se puede cerrar sin tocar el motor):** si falla SOLO la lectura interna de `computarReserva` y las dos del bot funcionan, el motor sigue con 0 sin avisar. El arreglo de fondo es que el motor falle ante ese error; corresponde al frente H-PQ1 (decision B), no a #56.
- **Pruebas nuevas o cambiadas:**
  - `salesbot56Bloqueo`: 47.
    - Ruta por lista blanca, con el caso del Auditor.
    - Mensaje desconocido con motivo generico, con el caso del Auditor.
    - Ocho mensajes dinamicos conocidos y tres intentos con texto agregado.
  - `salesbot56BloqueoLectura`: 40.
    - Falla la lectura de `pct_mk` antes o despues: sin total.
    - El % cambia entre lecturas: sin total.
    - Se leen la misma columna y dos veces, y el valor no sale.
    - `pct_mk` nulo cuenta como confiable.
    - Sin cargo aparte no hay segunda lectura.
  - `salesbot56BloqueoCableado`: 19. Del paquete solo se selecciona `pct_mk`, y el % solo se compara.
- **Resultados r2.1 (ejecutados por el ejecutor en el worktree):**
  - Focales: **205/205**. Son las 6 suites de esta pieza (149), las 3 de r1 (55) y el calendario (1).
  - Contrapruebas: **22/22 detectadas**, con restauracion verificada por hash. Son las 17 anteriores (una actualizada) y 5 nuevas:
    - La lectura posterior se quita.
    - Se ignora el error de `pct_mk` (como hace el motor).
    - La ruta vuelve a devolver el texto.
    - Cualquier mensaje desconocido sale.
    - La lista blanca queda sin anclar.
    - El script modifica archivos temporalmente; por eso lo corre el ejecutor y no el Auditor.
  - `tsc --noEmit`, ESLint y `git diff --check`: exit 0. Archivos nuevos sin espacios finales.
  - `test:unit` completo: **5919 pruebas, 5907 pasan y 12 fallan**: son las mismas 12 ajenas (decision C). Las 8 de mas son las pruebas nuevas.
  - `pnpm run build`: exit 0 (16/16 paginas; `/dashboard/salesbot` dinamica). No modifico archivos rastreados.
- **Parche:** scratchpad del ejecutor, `salesbot56-r2.1.patch` (4592 lineas, sha256 `abc683b74b03a6f0`, 17 archivos: 3 modificados y 14 nuevos). Nada en staging. **Pendiente: nuevo gate del Auditor.**

## Gate solicitado para r2.1 (entrega para revision, 2026-10-19)

**Estado exacto, verificado por el ejecutor (solo lectura de git; sin staging, commit ni push del ejecutor):**
- **r2.1 YA esta commiteado y subido; el encargo lo suponia sin commit.**
  - Commit **`e08c2b80`** "feat: ampliar SalesBot a bloqueos y porcion terrestre", autor Odair, 2026-10-19 19:34 -0500, padre `b2fa783f` (r1).
  - Es el HEAD local del worktree `.claude/worktrees/salesbot-programas-56`, y `git ls-remote` confirma que es el head remoto de `codex/56-salesbot-programas`, la rama del PR #366.
- **Contenido del commit = parche r2.1 que entrego el ejecutor:**
  - Los mismos 17 archivos (`git diff --name-only b2fa783f e08c2b80` = la lista del parche).
  - Los 17 blobs del commit coinciden con los hashes `index` del parche `salesbot56-r2.1.patch` (sha256 `abc683b74b03a6f0`).
  - Diff `b2fa783f..e08c2b80`: +4059/-396.
- **Worktree:** limpio (diff vacio contra HEAD), sin archivos sin seguimiento y sin nada en staging.
- **CI de #366:** como el head remoto es `e08c2b80`, un CI corrido despues de ese push corresponde a r2.1, no a r1. **No verificado por el ejecutor:** `gh` no esta instalado en esta sesion, asi que no se pudo leer el estado de los checks ni si el PR sigue en Draft. Confirmalo en GitHub: el SHA del check debe ser `e08c2b80`.
- **Base:** #366 parte de `89b6f19d`. Desde entonces `main` avanzo a `ecae7678` (#39, #53 y #42/219). No se rebaso ni se fusiono main en la rama. Antes de pasar a Ready hara falta actualizar desde `main` y repetir las pruebas focales; no se hizo, para no cambiar lo que se revisa.

**Correcciones de r2.1 frente al NO GO:**
- **P1, PNR:** `rutaPublica` pasa a lista blanca. Solo extrae una ruta IATA (`ABC-DEF[-GHI]`); todo lo demas se descarta, y si no hay ruta devuelve null.
  - **Riesgo residual:** un PNR escrito como `ABC-DEF` se tomaria por ruta. Un PNR no lleva guion.
- **P1, errores tecnicos:** el texto del motor solo sale si coincide completo con uno de los 24 mensajes comerciales reales (patrones anclados `^...$`). Los de senal tecnica dan `error_tecnico`; cualquier otro, un motivo generico.
  - **Riesgo residual:** un mensaje comercial nuevo se vera generico hasta agregarlo a la lista. Falla cerrado.
- **P2, markup:** lee `pct_mk`, la misma columna que el motor, con la misma sesion, antes y despues de `computarReserva`. Si hay cargo por grupo, exige que las dos lecturas funcionen y coincidan; si no, no muestra el total.
  - **Riesgo residual:** si falla solo la lectura interna del motor, este sigue con 0. El arreglo de fondo es del motor (frente H-PQ1), no de #56.
- **Pruebas** (corridas sobre el arbol que hoy es `e08c2b80`; no se repitieron porque el contenido no cambio):
  - Focales 205/205.
  - Contrapruebas 22/22, con restauracion por hash.
  - `test:unit` 5907/5919: las 12 fallas son las ajenas confirmadas identicas en `main`.
  - `tsc`, ESLint y build: exit 0.
- **Alcance intacto:**
  - Programas: precio de referencia, sin total.
  - Bloqueos y Porcion: total orientativo del motor de venta.
  - B2B: solo el % propio de la agencia, sin base ni monto.
  - Fuera: Servicios (#61, H-SV1) y Dinamico (#62 y hotfix #63 de Chat #4).

**Lo que se pide al Coordinador:**
- Veredicto sobre r2.1 (`e08c2b80`).
- Como regularizar que el commit y el push ocurrieran antes del veredicto: validarlos tal cual, o pedir un ajuste en un commit nuevo.
- Si #366 se actualiza desde `main` antes de Ready.
- El ejecutor no hace staging, commit ni push hasta ese veredicto.

## Correcciones r2.2 al segundo NO GO, ampliadas en r2.3 (2026-10-19/20; sobre `e08c2b80`, sin commit)

**Encargos:**
- **Gate de r2.1, NO GO por dos puntos:** privacidad de ruta y markup.
- **Gate de r2.2, P1 pendiente:** `origenPorBloqueo` tampoco es una fuente estructurada. `lib/tarifario/datos.ts:199-201` lo rellena con el primer segmento del texto libre `bloqueos_vuelo.ruta` cuando falta `origen`: con `origen` NULL y `ruta` = "PNR-BOG", r2.2 publicaba "Desde PNR".
- **Limites:** solo rutas de SalesBot ya reservadas. No se tocan `lib/tarifario/datos.ts`, motores, #42, migraciones ni la 218. Sin Docker, SQL remoto, staging, commit, push ni cambios al PR hasta un nuevo gate y la autorizacion del dueno.

**Decisiones vigentes:**
- **Ruta (r2.3):** la oferta de bloqueo NO publica ruta ni origen.
  - Se eliminaron `rutaPublica` (r2.1), `origenPublico` y `origen_iata` (r2.2), en la oferta, la busqueda por texto y la interfaz.
  - No se usa `bloqueo_label`, `bloqueos_vuelo.ruta` ni `origenPorBloqueo`, ni siquiera como respaldo.
  - La tarjeta muestra destino y noches, con las fechas debajo. El titulo de cotizacion muestra hotel, destino y fechas. El placeholder de busqueda es "Hotel, destino o paquete".
- **Markup (r2.2, sin cambios en r2.3):** `interpretarPctMk` (`paquetes/contrato.ts`) ya no convierte en 0 lo que no entiende.
  - `NULL` vale 0, la semantica valida del motor.
  - Se acepta un numero finito en [0, 1) o un texto numerico exacto.
  - Todo lo demas es no confiable.
  - La lectura previa y la posterior deben funcionar y dar el mismo valor; si no, no se muestra un total que dependa del cargo por grupo.
- **Se mantienen:** lista blanca de errores, rol y tenant, B2B solo con el % propio, y salida sin netos, costos, proveedor, impuesto ni datos de silla.
- **Riesgo residual (#60, H-PQ1; no se resuelve en #56):** si falla SOLO la lectura interna de `computarReserva` (`computo.ts:348`), el motor sigue con 0.

**Pruebas de esta ronda:**
- **Ruta:**
  - `ABC-DEF`, `MAD-BOG · QWERTY`, `PNR-BOG`, `L93FYZ · BOG-ADZ`, `QWERTY`, vacio y null: ningun fragmento llega a la oferta, y no existen las claves `ruta`, `origen`, `origen_iata` ni `bloqueo_label`.
  - Destino y fechas se conservan.
  - El empaquetado tampoco publica la etiqueta.
  - **Regresion del caso del gate**, en la capa de lectura: cargador con `origenPorBloqueo = {10: "PNR"}` y etiqueta "PNR-BOG". Ni `buscarBloqueos`, ni `ofertaBloqueoPorClave`, ni `cotizarBloqueo` contienen "PNR".
  - Cableado: ningun archivo de SalesBot usa `bloqueo_label`, `.ruta`, `ruta:`, `origenPorBloqueo`, `origen_iata` ni `origenPublico`; la tarjeta y el titulo usan solo destino, noches y fechas.
- **Markup:** 15 valores invalidos, en la lectura previa y en la posterior, en bloqueo y en porcion; error de lectura; porcentaje cambiado; fila sin la columna; `"0.2"` como texto; `NULL`.

**Diff vigente sobre `e08c2b80`:**
- 7 archivos rastreados (+146/-47): `PanelBloqueos.tsx`, `paquetes/{bloqueo,contrato,lectura}.ts` y las pruebas `salesbot56{Bloqueo,BloqueoCableado,BloqueoLectura}`.
- Parche `salesbot56-r2.3.patch` en el scratchpad (362 lineas, sha256 `d7f35f83ac265deb`). Reemplaza a `salesbot56-r2.2.patch`.

**EJECUTADO por el ejecutor en este PC (Node; sin Docker ni SQL):**
- Pruebas focales **213/213** (las 9 suites `salesbot56*` y `calendariosCobertura`).
- Contrapruebas **25/25 detectadas**, con restauracion verificada por hash. Incluyen "la oferta vuelve a publicar la etiqueta como ruta" y "la oferta publica origenPorBloqueo".
- `tsc --noEmit`, ESLint de lo tocado y `git diff --check`: exit 0.
- Nada en staging.

**NO EJECUTADO:** `test:unit` completo, `pnpm run build`, `test:react`, la pagina en un navegador y ningun SQL. Quedan para GitHub Actions despues del push autorizado.

**Nota de la bitacora:** la version de r2.2 de esta seccion quedo truncada y con dos copias completas del inicio del archivo. El reemplazo de texto con que se inserto interpreto `` $` `` como "todo lo anterior". Se reconstruyo con el prefijo y el sufijo originales; hay una copia previa en el scratchpad del ejecutor, `bitacora_respaldo_antes_r23.md`.

**Estado git:** r2.3 ya esta commiteado y subido: `2a54ffc8` "fix: evitar exponer rutas y validar markup en SalesBot", head de #366, identico al parche r2.3 (sha256 `d7f35f83...`).

## Workflow focal `test-salesbot-56.yml` (2026-10-20; sobre `2a54ffc8`, sin commit)

**Encargo:** crear unicamente `.github/workflows/test-salesbot-56.yml`, sin tocar el workflow 214, codigo, pruebas, migraciones ni dependencias.

**Archivo nuevo** (126 lineas; diff `salesbot56-workflow.patch` en el scratchpad, sha256 `7ab3f11595583e4b`; sin otros cambios en el worktree):
- **Disparo:** `pull_request` hacia `main` y `workflow_dispatch`, sin `pull_request_target`.
  - `paths`: el propio workflow, `lib/salesbot/**`, `app/(dashboard)/dashboard/salesbot/**`, `pruebas/salesbot56*` y las tres superficies que tocó r1 (`lib/programas.ts`, `lib/constants.ts`, `app/(dashboard)/layout.tsx`).
  - Agregar el workflow al Draft dispara su primer run.
- **Permisos y concurrencia:** `permissions: contents: read`, `persist-credentials: false` y `concurrency` por PR.
- **Ejecucion:** Ubuntu 24.04 directo, sin contenedores ni servicios.
  - Actions fijadas por SHA, verificado con `git ls-remote` contra los repos oficiales: `actions/checkout` v4.2.2 (`11bd7190...`) y `actions/setup-node` v4.4.0 (`49933ea5...`).
  - Node `24.14.0`, la misma version local. pnpm del `packageManager` (`pnpm@10.33.0`) via `corepack enable`, e instalacion con `pnpm install --frozen-lockfile`.
- **Jobs:** todos los pasos son obligatorios, sin `continue-on-error`, y cada job y cada paso tiene tiempo limite.
  - **`focales`** (20 min): las 10 suites (`salesbot56Consulta`, `Detalle`, `Cableado`, `Bloqueo`, `BloqueoParidad`, `BloqueoLectura`, `BloqueoCableado`, `Porcion`, `PorcionParidad` y `calendariosCobertura`), `tsc --noEmit -p .` y ESLint de `app/(dashboard)/dashboard/salesbot/`, `lib/salesbot/` y `pruebas/salesbot56*.test.ts`.
  - **`build`** (25 min): `pnpm run build`, con `NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_ANON_KEY` FICTICIOS (dominio `.invalid`, no son secretos ni conectan a Supabase).
- **Sin** secretos, Supabase remoto ni Docker.
- **FUERA de este workflow:** la suite unitaria completa (`test:unit`), las pruebas React (`test:react`) y cualquier prueba en navegador.

**Verificacion (ejecutada por el ejecutor):**
- Sintaxis valida con `js-yaml` (el del lockfile). Se comprobaron: eventos, ramas, permisos, runners, tiempos, actions fijadas, ausencia de `continue-on-error`, de contenedores, de `secrets.`, de `docker` y de `supabase.co`.
- Las 10 suites con el mismo comando del workflow: **213/213**.
- ESLint con el mismo comando: exit 0.
- `git diff --check`: limpio.
- Build simulado con las mismas variables publicas ficticias y `SUPABASE_SERVICE_ROLE_KEY` vacia: exit 0, 16/16 paginas.
  - **Salvedad:** en este PC el resto de variables del `.env.local` sigue cargado (no se leyo ni se movio), asi que no replica exactamente el runner. El primer run en Actions lo confirma.

**No ejecutado:** el workflow en GitHub (requiere commit y push del dueno despues del gate de Auditorias).

## MVP de conversacion guiada (2026-10-20; sobre `c12ecba6`, sin commit)

**Reserva:** la del encargo mas tres rutas adicionales, aprobadas por el dueno con la condicion de no afectar otros trabajos ni danar ningun flujo:
- `salesbot56BloqueoCableado.test.ts`, acotado.
- `.github/workflows/test-salesbot-56.yml`, solo la lista de suites.
- Un `launch.json` local para verificar en navegador; se creo, se uso y se borro, sin entrar al diff.

**Que hace:**
- **Vista principal:** `/dashboard/salesbot` sin parametros abre la conversacion. Programas, Bloqueos y Porcion quedan como pestanas secundarias.
  - **Compatibilidad:** `productoDe` abre Programas cuando llegan sus parametros GET, que no llevan `producto`. La prueba verifica que todos los `name=` de `PanelProgramas.tsx` esten en esa lista. `PanelProgramas.tsx` no se toco.
- **`lib/salesbot/conversacion/contrato.ts`** (puro): el estado y la entrada que manda el navegador se sanean (`sanearEstado`, `sanearEntrada`). Cualquier campo mal formado queda vacio y nada fuera del contrato pasa.
- **`interpretar.ts`** (puro, determinista):
  - Reconoce producto, comandos (empezar de nuevo, asesor, ayuda, agencia, corregir un campo), fechas (rango en palabras, ISO, dd/mm/aaaa), cantidades, habitaciones por tipo, menores con sus edades, destino de lista o libre y posicion en una lista.
  - Ante un producto, una fecha o una cantidad ambiguos, devuelve candidatos y el flujo pregunta. Ambiguo es, por ejemplo: "paquete", dia y mes intercambiables, una fecha sin ano, "2 o 3", "2 ninos" sin edades.
  - Las fechas pasadas o inexistentes se rechazan.
- **`flujo.ts`** (puro, con las consultas inyectadas):
  - Producto, datos obligatorios, busqueda, seleccion, y detalle o cotizacion. Se puede corregir cualquier respuesta (se borra lo que dependia de ella) y empezar de nuevo.
  - Toda seleccion se revalida contra el servidor en cada turno; si cambio o no existe, muestra "ya no esta disponible" con los resultados actuales.
  - Programas: precio de referencia por persona y "el total lo calcula el asesor", nunca un total.
  - Bloqueos y Porcion: "Cotizacion ORIENTATIVA" del motor de venta.
  - B2B: solo el % propio de la agencia, nunca base ni monto.
  - Sin resultados o con un error, ofrece ajustar la busqueda o consultar a un asesor.
  - Defensa final con `clavesProhibidasEn`.
- **`actions.ts`** ("use server", `conversar`):
  - Revalida en cada turno la sesion, el usuario activo, el rol y el tenant, con la misma regla que las consultas (`resolverAccesoConsulta`), antes de tocar cualquier dato.
  - Sin autorizacion descarta el estado y no consulta nada.
  - Usa solo las consultas saneadas de SalesBot. El registro de errores lleva solo el tipo de error, nunca el texto ni el estado.
- **`PanelConversacion.tsx`** (cliente): la conversacion vive en memoria. Sin `localStorage`, URL, logs ni `fetch` propio.
  - Accesibilidad: `role="log"` con `aria-live`, entrada etiquetada, opciones en un grupo con nombre, foco visible y foco devuelto a la entrada.
  - Diseno adaptable a movil y escritorio con Tailwind.
- **Nada de esto:** LLM, Kommo, WhatsApp, reservas, migraciones, dependencias nuevas, cambios a motores, ni trabajo de #60, #61 o #62.

**Diff:**
- 4 archivos rastreados (+38/-11): `comun.tsx`, `page.tsx`, `salesbot56BloqueoCableado.test.ts` y el workflow.
- 9 nuevos: `PanelConversacion.tsx`, `actions.ts`, `conversacion/{contrato,interpretar,flujo}.ts` y 4 pruebas `salesbot56Conversacion{,Flujo,Acciones,Cableado}`.
- Parche `salesbot56-conversacion.patch` en el scratchpad (2457 lineas, sha256 `74a3c383bcc03277`).
- Texto propuesto para el PR: `pr366_texto_propuesto.md` en el scratchpad.

**EJECUTADO (Node, sin Docker ni SQL):**
- Las 14 suites del workflow: **288/288**. Las nuevas suman 75: interprete 19, flujo 30, accion 14 y cableado 12.
- `tsc`, ESLint de las rutas SalesBot, `git diff --check` y `pnpm run build` (16/16, `/dashboard/salesbot` dinamica): exit 0.
- Dev local: sin sesion, `/dashboard/salesbot` redirige a `/login`.

**NO VERIFICADO (por decision del dueno se omitio el navegador):**
- La conversacion en movil y escritorio con una sesion real.
- La accesibilidad con lector de pantalla.
- Datos reales de Produccion.
- Tampoco se corrieron `test:unit` completo ni `test:react`.

## 218 - hoja breve de decisiones (2026-10-19; solo diseno, sin GO de SQL ni de implementacion)

La 218 sigue reservada solo como numero. El diseno tecnico completo esta en "Migracion 218 - registro de conversaciones", mas abajo.

**Conciliacion con #42 / 219** (integrada en `main` `ecae7678`; leida, no modificada):
- La 219 no depende de la 218 (lo dice en su cabecera) y la 218 no depende de la 219. La 218 no toca ningun objeto de la 214 ni de la 219:
  - `personas`, `persona_capturas`, `cotizacion_participantes`.
  - El esquema `p214_priv`, sus funciones y `r219_foto_214`.
  - `buscar_personas_documento`, `crm_personas_cotizacion_buscar` y las fachadas de cotizacion.
- **Esquema propio `p218_priv`, sin reutilizar `p214_priv`.** La 219 reutilizo `p214_priv` para no sumar esquemas expuestos, pero su rollback restaura la 214 EXACTA desde `r219_foto_214`, y su postcheck revisa ese esquema. Meter objetos ajenos ahi mezclaria los dos ciclos de vida.
  - **Costo:** un esquema mas que vigilar, que no debe quedar en "Exposed schemas" de la Data API.
- **El bot no identifica personas.** La 218 no escribe en el registro de personas, y el enmascarado elimina documentos antes de guardar. Si algun dia una conversacion se vincula con un lead o una persona, sera por las fachadas de #42/CRM, con un gate propio, nunca desde la 218.
- **Mismo criterio que la 214 y la 219:** sin `trg_auditoria` en tablas con datos sensibles. Las tablas de la 218 viven fuera de `public`, asi que el bloque `DO` de la 087 no las alcanza.
- **Orden de numeros:** 218 < 219 y la 219 ya esta en `main`.
  - En CI y en local se aplican en orden numerico (218 antes que 219), sin conflicto porque son independientes.
  - En Produccion las corre el dueno a mano. Si se usara `supabase db push`, la CLI rechaza una migracion con numero menor al ultimo aplicado, salvo con `--include-all`.

**Decisiones necesarias:**

| # | Decision | Opciones | Recomendacion del ejecutor |
|---|---|---|---|
| 218-1 | Como ejecutar la anonimizacion al mes | **A)** Cron de Vercel diario. Ya hay 3 en `vercel.json` (`liberar-vencidas`, `notificaciones`, `reconciliar-financiero`), con `CRON_SECRET` que falla cerrado. Llama `p218_priv.anonimizar_vencidas()` con service-role. **B)** `pg_cron` en Supabase: el repo no lo usa en ninguna migracion y no esta verificado que este habilitado. **C)** Manual: no cumple "al mes". | **A**, con el patron que ya existe. La funcion es idempotente y transaccional, y el dato vive entre 1 mes y 1 mes + 1 dia. Exige reservar `vercel.json` y una ruta `app/api/cron/*`. Falta alerta si el cron no corre (no hay monitoreo hoy). |
| 218-2 | Quien lee conversaciones | Superadmin: todo. Gerencia: **su tenant** o **los dos**. El asesor dueno: las suyas. Nadie mas (administracion, operaciones, venta no duenos, externos e inactivos ven 0, sin revelar que existen). | Gerencia solo su tenant (hoy da igual: el piloto es solo Mayorista). Lectura solo por funciones `SECURITY DEFINER` en `public`, nunca tablas directas. Opcional: que cada lectura de superadmin o gerencia deje rastro. |
| 218-3 | Enmascarado antes del primer guardado | Lo hace la app, con `enmascararPII()` (correos, 7 o mas digitos con o sin separadores y documentos por tipo), ANTES de llamar al escritor `server-only`. La base solo tiene un CHECK de respaldo (correo y 7 digitos seguidos), que rechaza, no corrige. | Asi. **Decision adicional:** enmascarar TAMBIEN antes de enviar el texto al proveedor de IA, porque el proveedor ve el mensaje antes que la base. Hoy no hay proveedor (D4 al final), pero define el contrato. Y `registrarErrorTecnico` nunca debe registrar textos del usuario. |
| 218-4 | Riesgo de los respaldos | **A)** Aceptarlo: los respaldos o el PITR de Supabase conservan lo borrado durante su ventana (segun el plan; no verificado). **B)** Borrado criptografico: cifrar los textos con una llave por mes guardada fuera de la base y destruir la llave al anonimizar, asi los respaldos quedan ilegibles. **C)** No guardar texto, solo metricas (no sirve para revisar las respuestas del bot). | **A**, documentada y con la ventana real confirmada por el dueno en Supabase (Settings -> Database -> Backups). B solo si el dueno exige que no quede nada: anade gestion de llaves y mas alcance. |
| 218-5 | Alcance del workflow focal de GitHub Actions | Un archivo nuevo `.github/workflows/test-salesbot-218.yml`, con el patron de `test-personas-cotizaciones-42.yml`: imagen de Supabase Postgres y PostgREST fijadas por version, `permissions: contents: read`, sin secretos, sin Supabase remoto, sin `pull_request_target`, `paths` limitado a la 218, sus scripts, `lib/salesbot/privacidad*` y el escritor. Aplica la cadena 001-219 completa (prueba que convive con la 214 y la 219) y corre A1-A4, E1-E4, R1-R7, AU1, RB1 y el job TS de `enmascararPII`. | Asi. No toca `test-214-personas.yml`, `test-216-217-*` ni `test-personas-cotizaciones-42.yml`. Requiere reservar el archivo, que esta fuera de la reserva de #56, y aprobar su primera ejecucion. |
| 218-6 | Numero | Conservar 218 (independiente, aplicacion manual) o renumerar al siguiente libre despues de la 219. | Conservar 218, salvo que Produccion use `db push`. Lo decide el Coordinador, que da los numeros. |

**Siguen sin GO:**
- La 218 (SQL y app), guardar conversaciones, el chat y el proveedor de IA.
- Esta hoja no crea archivos ni ejecuta nada.

## Mapa de los siguientes productos: Servicios/receptivos y Dinamico (2026-10-19; solo lectura)

**Que es y que no:**
- Lectura de codigo y migraciones, hecha mientras el Auditor revisa r2.1. No se edito ningun archivo del repo ni del worktree, no se ejecuto SQL y no se corrio nada.
- Lo marcado "por lectura" no esta comprobado en ejecucion.
- **Base:** worktree `b2fa783f` (= `89b6f19d` + r1). Se verifico que `main` (`87beb622`) no cambio `lib/reservar`, `lib/tarifario`, `paquetes/actions.ts` ni el checkout desde esa base.
- Orden propuesto: **Servicios primero** (motor limpio y ya en lista blanca) y **Dinamico despues** (tiene un defecto de vigencia que conviene cerrar antes).

### Producto 3: Servicios / receptivos (tours y traslados sueltos)

- **Motores vigentes (consumir sin editar):**
  - `buscarReceptivos(unknown)` (`lib/reservar/cotizar.ts:857`): busqueda en vivo.
    - Toma `tarifario_resultado_publicable` (`modulo = 'servicios'`, `paquete_activo = true`) y liquida cada servicio con `calcularResultadoServicio`.
    - Aplica temporadas por fecha del viaje, vigencia de compra, modo persona o grupo, recargo individual, liquidacion por noche y markup del paquete.
    - Lee todo con service-role, `pct_mk` incluido: **H-PQ1 no lo afecta**.
    - Falla cerrado: cualquier error de consulta devuelve el mensaje generico.
    - Excluye los servicios marcados como incluidos de un paquete, para que no se cobren dos veces.
  - `liquidarServicioPuntual({paqueteId, servicioId, fechaIda, fechaRegreso, pax})` (`cotizar.ts:1016`): misma formula, para un solo servicio.
    - Es lo que usa el **checkout publico** al cobrar (`checkout/actions.ts:901`).
    - Ya devuelve una frontera publica (`RespuestaPublicaServicioPuntual`: `{ok, resultado}` o `{ok: false, tipo, mensaje}` con mensaje publico, sin detalle interno).
- **Entradas:** destino (match exacto con `destino_nombre`), fecha de ida y regreso (ida no anterior a hoy, tope de noches) y pax (entero de 1 al maximo de consulta). `paqueteId` es opcional y solo acota el alcance.
- **Salida del motor** (`ResultadoServicio`): `servicioId`, `nombre`, `destino`, `descripcion`, `paqueteId`, `total`, `pax`, `noches`, `moneda` y `categoria`. **No trae netos, proveedor ni recargo crudo.** El bot igual la pasaria por lista blanca y lista negra (`total` pasa a `total_orientativo`).
- **Precio:** `total` es el PVP de todo el grupo para esas fechas y ese pax. Seria el total orientativo y coincide con lo que cobra el checkout publico.
- **Disponibilidad:** no hay inventario de servicios en el sistema: "sujeto a confirmacion del proveedor", como el hotel.
- **Permisos:** no hace falta ninguno nuevo; el motor lee con service-role. Mismos 5 roles y solo Mayorista.
- **Archivos que habria que reservar:** `lib/salesbot/paquetes/servicio.ts` (puro), operaciones nuevas en `paquetes/lectura.ts`, `PanelServicios.tsx`, una pestana mas en `comun.tsx` y pruebas `pruebas/salesbot56Servicio*`.
- **Pruebas focales propuestas:**
  - Paridad: el total del bot = `buscarReceptivos` = `liquidarServicioPuntual` para el mismo par, fechas y pax, con el motor real y el cliente simulado.
  - Temporada vigente frente a GENERAL.
  - Recargo individual con 1 pax.
  - Modo grupo por rango.
  - Que un incluido no aparezca.
  - Vigencia de compra vencida sin precio.
  - Lista negra y saneamiento de errores.
  - Acceso, como en r2.
- **HALLAZGO H-SV1, MEDIO (por lectura; posible defecto de precio, fuera de #56, para el Coordinador):**
  - Reservar interno vende un servicio suelto con `computarReserva`, en su rama `modulo = 'servicios'` (`reservar/actions.ts:196` y `:939`). Esa rama fija `meta.fecha_ida = null` (`computo.ts:~703`), asi que el bloque de temporadas (`computo.ts:~750`, `if (fechaViaje && ...)`) **nunca se ejecuta**.
  - En esa rama solo se toman el PVP de la temporada GENERAL guardado en `tarifario_resultado` y el recargo, sin liquidacion por noche ni temporada vigente.
  - El checkout publico, en cambio, re-liquida en vivo con temporadas (`liquidarServicioPuntual`).
  - **Resultado probable:** el mismo servicio, en las mismas fechas y con el mismo pax, puede costar distinto vendido por Reservar interno que por el checkout o la busqueda.
  - **Ademas:** esa rama lee con la SESION `servicios_adicionales` (categoria y proveedor, `computo.ts:~733`). La RLS de la 016 solo deja leerla a los 4 roles internos, asi que para `venta` la categoria queda `otro` y el proveedor null. No cambia el precio, pero si la clasificacion y la CxP.
  - No verificado en ejecucion ni en Produccion.
  - **Consecuencia para el bot:** su total igualaria al del checkout publico, no necesariamente al de Reservar interno, hasta que H-SV1 se resuelva. Hay que decirlo en pantalla o esperar la decision del Coordinador.

#### Servicios: analisis detallado y contrato propuesto (2026-10-19; solo lectura, nada implementado)

**Restricciones vigentes (Auditor):**
- Solo analisis: no se cambian motores.
- Ningun precio de servicio se publica como definitivo mientras H-SV1 este abierto.
- Nada de esto entra al PR #366.

**Como liquida cada canal hoy** (por lectura; base `b2fa783f`, igual a `main` `87beb622` en estos archivos):

| Paso | Checkout publico y busqueda (`buscarReceptivos` / `liquidarServicioPuntual`) | Reservar interno (`computarReserva`, `modulo = 'servicios'`) |
|---|---|---|
| Fuente | Catalogo vivo con service-role: `servicios_adicionales`, `servicio_temporadas`, `servicio_tarifa_pax`, `armado_*` | PVP congelado de `tarifario_resultado_publicable` (`precio_pvp`, `recargo_individual`) |
| Temporada | La vigente para la FECHA DEL VIAJE (`temporadaVigenteParaFecha`, con prioridad y vigencia de compra; `liquidacionServicio.ts:205`) | Siempre GENERAL: `meta.fecha_ida = null` impide entrar al bloque de temporadas (`computo.ts:~750`) |
| Liquidacion por noche o por dia | `factorLiquidacion(liquidacion, noches REALES de la consulta)` | El factor quedo horneado al generar con las noches del PAQUETE (`pq.noches`, `paquetes/actions.ts:~1124`), no con las del viaje |
| Recargo individual (1 pax, modo persona) | Neto de la temporada vigente (o el general) + markup | Recargo del snapshot (GENERAL) |
| Redondeo | Una vez, sobre el total (`redondearVenta(marcar(costoNeto))`) | Por persona al generar, y luego x pax |
| Markup | `pct_mk` con service-role, validado (`validarPctMarkup` rechaza null o fuera de rango) | Horneado en el snapshot |
| Incluidos del paquete | Se excluyen | No se ofrecen (no se publican) |

**Diferencias concretas de H-SV1** (cuatro fuentes independientes, todas por lectura):
- **(1) Temporada:** fuera de GENERAL, Reservar interno cobra la tarifa general.
- **(2) Noches:** en un servicio por noche o por dia, si la estadia real difiere de `pq.noches`, Reservar interno cobra las noches del paquete.
- **(3) Recargo individual** de temporada.
- **(4) Redondeo:** diferencia de unos pesos, por redondear por persona.
- El Coordinador debe decidir cual es el precio correcto. Por los comentarios del codigo (re-liquidacion "autoritativa" en el checkout) parece el vivo, pero **no se asume**.

**Contrato propuesto para el bot** (se implementa solo con GO y reserva):
- **`buscarServicios(entrada)`**
  - Entradas: `destino` (obligatorio, de la lista de destinos con servicios publicados, como en porcion), `fechaIda`, `fechaRegreso`, `pax` (1 a 40), `texto` opcional sobre nombre o descripcion, y `limite` (10 por defecto).
  - Motor: `buscarReceptivos` (sin `paqueteId`).
  - Salida por servicio (lista blanca): `servicio_id`, `paquete_id`, `nombre`, `destino`, `descripcion`, `categoria`, `moneda`, `pax`, `noches` y `total_orientativo`.
  - Ademas: `precio_definitivo: false`, `motivo_no_definitivo: "pendiente_paridad_canales"` y `disponibilidad: "sujeto_a_confirmacion"`.
- **`cotizarServicio(entrada)`**
  - Entradas: `paquete`, `servicio`, fechas y `pax`.
  - Motor: `liquidarServicioPuntual`, la misma funcion que cobra el checkout.
  - Exige que el par este visible en la busqueda (falla cerrado).
  - Errores: usa el `mensaje` publico del motor solo si coincide con la lista blanca de r2.1; si no, el motivo generico.
- **Mientras H-SV1 este abierto**, la pantalla diria: "Precio de referencia del canal web. Puede diferir del precio de Reservar interno; confirma con el asesor." Nunca "total" a secas.
- **Sin service-role propio:** el motor lo usa internamente, como en r2.
- **Lista negra** (ya cubierta por r2): `precio_persona`, `costoNeto`, `proveedor_id`, `liquidacion`, `pct_mk` y `recargo_individual` crudo.

**Archivos a reservar cuando haya GO:**
- `lib/salesbot/paquetes/servicio.ts` (puro).
- Dos operaciones nuevas en `paquetes/lectura.ts`.
- `app/(dashboard)/dashboard/salesbot/PanelServicios.tsx` y la pestana en `comun.tsx`.
- Pruebas `pruebas/salesbot56Servicio{,Paridad,Lectura}.test.ts`.
- Sin motores, `reservar/actions.ts`, checkout ni migraciones.

**Pruebas focales propuestas:**
- Paridad bot = `buscarReceptivos` = `liquidarServicioPuntual`, con el motor real y el cliente simulado, para el mismo par, fechas y pax.
- Temporada vigente frente a GENERAL.
- Por noche con estadia distinta de `pq.noches`.
- Recargo individual con 1 pax.
- Grupo por rango, y rango que no cubre el pax (sin precio).
- El incluido se excluye.
- Vigencia de compra de la temporada vencida.
- Moneda USD.
- `precio_definitivo` siempre false mientras H-SV1 este abierto.
- Lista negra, saneamiento y acceso, como en r2.
- **Reproduccion de H-SV1:** el mismo servicio, con el motor de checkout y con `computarReserva` en `modulo = 'servicios'`, para la misma fecha, en temporada y en estadia distinta de `pq.noches`. Sirve como prueba de aceptacion del frente H-SV1, y es del Coordinador, no de #56.

**Dependencias:**
- Servicios no pasa de analisis hasta: **(1)** decision del Coordinador sobre H-SV1 (cual precio es el correcto y su arreglo), y **(2)** GO del Auditor con reserva.
- Si el precio correcto resulta ser el vivo, el bot ya usaria el motor correcto y solo quitaria la marca `precio_definitivo: false`.
- Si resultara ser el de Reservar interno, el contrato cambia de motor.

### Producto 4: Dinamico (vuelo por sistema + hotel, sin record)

> **2026-10-19, Auditor:** Dinamico NO entra al bot por ahora. Espera **(a)** el hotfix de Chat #4 para elegir promociones de Empaquetados en Salidas dinamicas y **(b)** **#62**, la vigencia de esas salidas (= H-DI1). Con ambos integrados, revisar la paridad con el flujo de venta actualizado; el mapa de abajo puede quedar desactualizado.

- **Modelo:** tabla `salidas_dinamicas` (migracion 094): `paquete_id`, `ruta` (IATA, por ejemplo "MDE - MIA - MDE"), fechas y horas, `valor_tiquete` (NETO), `aplica_mk` o `ta`, `fee_infante`, `compra_inicio` / `compra_fin`, `activo` y `notas`.
  - Al generar el tarifario, cada salida da filas `modulo = 'dinamico'` con `salida_id`. La etiqueta publica es ruta + fecha, sin PNR (`paquetes/actions.ts:1108`).
  - **RLS:** `salidas_dinamicas` solo es legible para los 4 roles internos (094); `venta` no la lee. El bot no la necesita.
- **Motores vigentes:**
  - Oferta: `cargarDatosTarifario` → `filasVisibles` con `modulo = 'dinamico'`, ya filtradas por salida no pasada (`datos.ts:223`).
  - Precio: `computarReserva` con `modulo = 'dinamico'` y `salidaId` (origen `salida`, `resolverOrigenVuelo`). Toma la rama de record fijo, igual que bloqueo: PVP congelado de `tarifario_resultado_publicable` filtrado por `salida_id`, y revalida el neto y la vigencia de compra del HOTEL con service-role.
  - Hoy solo se vende desde Reservar interno (`reservar/nuevo/page.tsx:19`). El checkout publico no lleva `salidaId`.
- **Entradas:** `salidaId` + paquete + hotel + combo + composicion (habitaciones y edades), igual que bloqueo, sin fechas libres.
- **Precio:** `precioVenta` de `computarReserva`. Es la misma reduccion que bloqueo (`resolverCotizacion`) y la misma guarda de H-PQ1 por cargo de grupo.
- **Disponibilidad:** sin inventario de sillas (tiquete por sistema): "sujeto a confirmacion", como el empaquetado.
- **HALLAZGO H-DI1, MEDIO (por lectura; posible defecto de vigencia, fuera de #56, para el Coordinador):**
  - La vigencia de compra de la SALIDA (`salidas_dinamicas.compra_inicio` / `compra_fin`) no se aplica en ninguna etapa:
    - **Al generar el tarifario:** solo se filtra `activo = true` (`paquetes/actions.ts:1030`), no la ventana de compra.
    - **Al mostrar:** `cargarDatosTarifario` revalida activo y vigencia de los EMPAQUETADOS (`datos.ts:238-260`), pero no de las salidas dinamicas; solo descarta las que ya salieron.
    - **Al vender:** `computarReserva` revalida el empaquetado (`computo.ts:252-262`), pero no la salida.
  - **Resultado probable:** una salida fuera de su ventana de compra, o desactivada despues de generar el tarifario, sigue visible y se puede vender hasta regenerarlo. Es el mismo defecto que ya se corrigio para los empaquetados.
  - No verificado en ejecucion ni en Produccion.
  - **Consecuencia para el bot:** si el bot se apoya solo en el cargador, heredaria el defecto.
    - **Opcion 1 (recomendada):** esperar el arreglo del motor.
    - **Opcion 2:** filtrar en el bot con una lectura propia de `salidas_dinamicas`. Esa tabla no la lee `venta` (094), y el bot no tiene service-role propio: haria falta un permiso o un RPC nuevo, fuera de lo autorizado. **No se recomienda.**
- **Archivos que habria que reservar (cuando H-DI1 este resuelto):** extender `paquetes/bloqueo.ts` (origen `salida`) o un `paquetes/dinamico.ts` puro, la lectura, `PanelDinamico.tsx`, una pestana mas en `comun.tsx` y pruebas `pruebas/salesbot56Dinamico*`.
- **Pruebas focales propuestas:**
  - Paridad con la entrada de Reservar interno (`salidaId`).
  - `rutaPublica` con la etiqueta "MDE - MIA - MDE · 10/03/2027" debe dar "MDE-MIA-MDE".
  - Salida pasada, desactivada o fuera de compra sin precio (lo ultimo depende de H-DI1).
  - Acceso y saneamiento, como en r2.

### Decisiones que necesitaria (no asumidas)

- **D13:** ¿Servicios entra como siguiente pieza de #56? ¿El bot puede mostrar el total de `buscarReceptivos`, que coincide con el checkout publico, con la advertencia de H-SV1, o se espera ese frente?
- **D14:** ¿Dinamico espera el arreglo de H-DI1 en el motor? (Recomendado.)
- **D15:** H-SV1 y H-DI1 pasan al Coordinador como frentes propios, como se hizo con H-PQ1.

## Alcance multiproducto: mapa de bloqueo y porcion terrestre (2026-10-18; solo lectura)

**Encargo del Auditor:**
- El dueno amplio el alcance: SalesBot es para todas las ventas (`docs/futuro/salesbot-ventas-multproducto.md`, sin seguimiento en el checkout principal).
- Prioridad: primero bloqueo y despues porcion terrestre.
- Entregar en una sola ronda: motores y datos vigentes, entradas, precio, disponibilidad real, permisos, archivos a reservar y pruebas focales.
- #366 (borrador, head `b2fa783f`, la r1 de arriba) es una pieza parcial. El PVP de Programas NO se reutiliza para estos productos.
- Sin editar motores de Booking, vuelos, reservas ni la 218.

**Base:** `main` `89b6f19d`. Todo lo de abajo es lectura de codigo y migraciones: no se ejecuto nada ni se edito ningun archivo del repo.

### Bloqueo (paquete con vuelo negociado y hotel)

- **Oferta publicada:**
  - `cargarDatosTarifario` (`lib/tarifario/datos.ts:127`), el mismo cargador del tarifario publico, devuelve `filasVisibles` de `tarifario_resultado` con `modulo = 'bloqueo'`.
  - Solo entran:
    - Paquetes con snapshot publicable y activos (vista `tarifario_resultado_publicable`, `182:294-300`).
    - Con vigencia de compra no vencida (`filtrarTarifarioVencidas`, `lib/tarifario/vigencia.ts:138`, service-role).
    - Con salida no pasada (`datos.ts:222-223`).
  - Cada fila trae:
    - `bloqueo_label`: solo la ruta, nunca el PNR.
    - `fecha_ida` y `fecha_regreso`, fijas.
    - `noches`.
    - Hotel, destino, categoria, regimen y acomodacion.
    - `precio_pvp` por persona: vuelo + hotel + servicios incluidos (`componerTarifa`, `lib/calc/paquetes.ts:691`).
    - `moneda`.
- **Dos origenes de vuelo bajo el mismo modulo:**
  - Bloqueo real (`bloqueo_id`, con record y sillas).
  - Empaquetado de la 156 (`empaquetado_id`): tiquete de sistema, sin sillas, con su propia vigencia de compra (`datos.ts:248-257`).
- **Precio cotizado:**
  - `computarReserva(sb, input)` (`lib/reservar/computo.ts:234`), rama de record fijo (`:474-685`).
  - El PVP sale de la fila publicable del origen EXACTO (`:475-494`) y se multiplica por los pax de cada habitacion (`pax_tarifa`). Se suman ninos e infantes (clasificados por edad exacta, `:630-639`), servicios add-on y mascota.
  - Revalida en vivo, con service-role, el neto y la VIGENCIA DE COMPRA (`:577-628`). Si vencio, falla con "tarifa ya no vigente".
  - Es la MISMA funcion que usan `crearCotizacion` y `reservarDesdeTarifario` (`reservar/actions.ts:196`, `:939`): la paridad con la venta es por construccion. No escribe nada (0 insert/update/delete/rpc en el archivo).
- **Disponibilidad real:**
  - Sillas libres = `cupos_por_bloqueo.cupos_disponibles` (`201:328`, `security_invoker`). Libre = `_silla_libre` (`194:208-213`): estado `disponible` o `cambio_entrante`, sin contrato, sin venta manual y sin datos de pasajero.
  - La reserva compara ese numero contra `paxConSilla` antes de vender (`reservar/actions.ts:221-228`).
  - El empaquetado no tiene sillas, y el hotel no tiene inventario en el sistema.
  - Semantica para el bot: "N sillas libres al momento de consultar; no se apartan ni se prometen". Empaquetado y hotel: "sujeto a confirmacion".
- **Entradas minimas:** paquete + origen (bloqueo o empaquetado) -> hotel -> categoria y regimen -> habitaciones por tipo -> edades exactas de los menores (nunca fecha de nacimiento). Las fechas son las del record; no las elige el usuario.

### Porcion terrestre (hotel sin vuelo)

- **Oferta publicada:**
  - Filas `modulo = 'porcion_terrestre'` con `precio_pvp` "desde": la noche mas barata de la ventana por las noches del paquete (`liquidarHotelMasBarato`).
  - **No es una cotizacion**; el documento del dueno lo prohibe como precio final.
- **Busqueda en vivo:** `buscarHoteles(BusquedaInput)` (`lib/reservar/cotizar.ts:515`).
  - Entradas: `fechaIda`, `fechaRegreso`, `habitaciones[]` (una por habitacion), `adultos`, `cantidadMenores`, `edadesMenores[]` y `destino`.
  - Reliquida cada hotel de porcion publicable con service-role, valida capacidad (`hotel_acomodaciones`) y edades por hotel, y ordena por total.
  - Devuelve por hotel: `paqueteNombre`, `combos[]` con `total`, moneda, noches, menores clasificados y la condicion informativa. Sin netos.
- **Precio por hotel:** `cotizarPorFechas({paqueteId, hotelId, fechaIda, fechaRegreso})` (`:272`).
  - Devuelve combos categoria x regimen con PVP por persona y acomodacion.
  - `sugerencias` de fechas cercanas cuando no hay tarifa o faltan noches minimas.
  - `serviciosGrupoPendientes`: si trae algo, el precio NO es final (`:339-343`).
  - Valida el rango de viaje del paquete (`:301-304`) y las noches minimas (`:307-309`).
- **Total cotizado:** `computarReserva` en su rama con fechas (`computo.ts:352-473`), que llama a `liquidarHotelPaquete` con service-role. Es la misma fuente que la cotizacion y la venta.
- **Disponibilidad real:**
  - **No existe inventario hotelero en el sistema.** Verificado: ninguna tabla ni codigo de allotment o inventario de habitaciones.
  - El bot solo puede decir "tarifa vigente para esas fechas, sujeto a confirmacion". "Sin tarifa" no significa "sin habitaciones".
- **Hoteles por unidad (Bernalo, `modelo_tarifario = 'unidad'`):**
  - Motor aparte: `busquedaUnidadActions.buscarAlojamientosUnidadPorFechas` -> `computarReservaBernalo` (`lib/reservar/computoReservaBernalo.ts`).
  - `computarReserva` los rechaza (`computo.ts:284-298`), y la busqueda publica no tiene limite de uso (hoja tecnica, seccion 6).
  - Propuesta: fuera de la primera pieza de porcion.

### Permisos (verificados por lectura de migraciones)

| Fuente | Quien lee | Como la usaria el bot |
| --- | --- | --- |
| `tarifario_resultado_publicable` | `anon` y `authenticated` (`182:328`); trae `r.*`, incluidos `impuesto` y `base_comisionable` | Sesion; la lista blanca descarta `impuesto` y `base_comisionable` |
| `tarifario_resultado` (base) | Todo para superadmin, gerencia, administracion y operaciones; el resto solo lo publicable (`182:271-275`) | Via el cargador |
| `armado_*` | Solo superadmin, gerencia, administracion y operaciones (`018:126-132`) | Los motores ya leen con service-role donde hace falta (ver H-PQ1) |
| `tarifa_hotel`, `hotel_temporadas` | Solo superadmin, gerencia, administracion y operaciones (`016:76-82`) | Solo dentro de los motores existentes, con service-role |
| `bloqueos_vuelo`, `sillas` | Los 6 roles internos, `venta` incluido, sin tenant (`005:185-195`, nunca eliminadas) | Solo el conteo de `cupos_por_bloqueo`; nunca `record` ni datos de silla |
| `hoteles` / `hotel_acomodaciones` | Publica (`005:215`) / cualquier sesion (`027:46`) | Via los motores |

El bot NO agrega codigo propio con `service-role`: reutiliza los motores, que ya lo usan internamente con su salida saneada. Mismos roles y tenant que la r1: los 5 aprobados, solo Mayorista. Los catalogos de paquetes, tarifario y vuelos no tienen tenant.

### Hallazgos nuevos (fuera de #56; para el Coordinador; no se tocan desde aqui)

- **H-PQ1, MEDIO (posible defecto, demostrado por lectura y no probado):**
  - `computarReserva` lee con la SESION `armado_paquetes.pct_mk` (`computo.ts:348`) e `impuesto_fijo` (`:935-940`). Sus llamadores pasan `createClient()` (`reservar/actions.ts:196`, `:939`; tambien el checkout publico, `checkout/actions.ts:723`).
  - Para `venta`, `agencia`, `freelance` y `anon`, la RLS de la 018 devuelve vacio sin error. Entonces `pctMk` queda en 0 y la mascota se cobra sin markup, e `impuestoTotal` queda en 0.
  - `planComisionReserva` (`reservar/actions.ts:247`) usa ese impuesto: la base de la comision B2B seria el PVP completo.
  - Falta confirmar si la base de datos (`registrar_comision_b2b_reserva`) lo corrige con su propia fuente.
  - El bot no expone mascotas ni montos de comision mientras esto siga abierto.
- **H-VU1, ALTO (privacidad, por lectura):**
  - `"sillas: lectura operativa"` (`005:193-195`) deja a `venta` y `control_vuelo` leer TODAS las sillas, con nombres, documentos y fechas de nacimiento que la 201 copia a la silla. No filtra por tenant ni por dueno.
  - Eso evita la restriccion que la 141/142 puso sobre `contrato_pasajeros`.
  - Tambien `bloqueos_vuelo`, con `record` y `tarifa_neta`, queda legible para `venta`.
  - Frente aparte, del estilo de #58.
- **Hoja tecnica desactualizada:** `vuelos-inventario.md` dice que `cupos_por_bloqueo` no se consulta. Si se consulta (`datos.ts:170`, `reservar/actions.ts:221`).
- **Dato, no defecto:** en un bloqueo con impuesto tipo tiquete, `tarifario_resultado.impuesto` = `tarifa_para_empaquetar`, la tarifa de reventa, no `tarifa_neta` (`paquetes/actions.ts:1058-1060`). No filtra el costo, pero es estructura interna: queda fuera de la lista blanca.

### Contrato propuesto para la pieza siguiente (no implementado)

**`buscarBloqueos({ destino?, texto?, fechaDesde?, fechaHasta? })`:**
- Fuente: `cargarDatosTarifario(sb)` filtrado a `modulo = 'bloqueo'`, mas `cuposPorBloqueo`.
- Agrupa por (paquete, origen del vuelo, hotel).
- Salida: ruta, `fecha_ida`, `fecha_regreso`, noches, destino, hotel, categorias y regimenes, `desde_pvp_por_persona` (minimo de `ACOM_ROOMS`, el mismo criterio que `minRoomPvp`), moneda, `origen_vuelo` (`'bloqueo'`|`'sistema'`) y `sillas_libres`. Este ultimo es un numero en bloqueo y `null` en sistema.
- `disponibilidad`:
  - `'sillas_libres'` con N > 0.
  - `'sin_sillas'` con N = 0: se muestra igual, pero no se ofrece.
  - `'sujeto_a_confirmacion'` en sistema.

**`cotizarBloqueo({ paqueteId, bloqueoId | empaquetadoId, hotelId, categoria, regimen, habitaciones, edadesMenores })`:**
- Fuente: `computarReserva` con entrada interna sin datos personales (`tipoAsesor: 'interno'`, cliente vacio, `pasajeros: []`, sin servicios ni mascotas), mas el conteo de `cupos_por_bloqueo` contra `paxConSilla`.
- Salida: lineas (habitaciones, pax, PVP por persona), menores clasificados, total, moneda, condiciones de tarifa (texto), `sillas_libres`, `alcanzan: boolean` y sello.
- **El total depende de D8.**

**`buscarPorcion({ destino (obligatorio), fechaIda, fechaRegreso, habitaciones[], adultos, edadesMenores })`:**
- Fuente: `buscarHoteles`.
- Salida: hotel, paquete, noches, moneda, combos (categoria, regimen, total), condicion informativa y `disponibilidad: 'sujeto_a_confirmacion'`.

**`cotizarPorcion({ paqueteId, hotelId, fechaIda, fechaRegreso, categoria?, regimen?, habitaciones?, edadesMenores? })`:**
- Fuente: `cotizarPorFechas` para el PVP por persona de cada combo, las sugerencias de fecha y `precio_no_final` cuando hay servicios grupales pendientes.
- Con habitaciones, ademas `computarReserva` para el total, sujeto a D8.

**Comun a las cuatro:**
- **Lista negra ampliada:** `record`, `tarifa_neta`, `tarifa_para_empaquetar`, `impuesto`, `base_comisionable`, `netoPorAcom`, `costo_*`, datos de proveedor y de silla.
- **Errores:**
  - Los mensajes de `computarReserva` que empiezan por "No se pudo" pueden traer el texto crudo de Supabase: se convierten en `error_tecnico`, sin detalle.
  - Los comerciales se mapean a codigos: `tarifa_vencida`, `sin_tarifa_fechas`, `capacidad`, `adults_only`, `sin_sillas` y `parametros_faltantes`.
- **Excluido de la v1:**
  - Mascotas (por H-PQ1).
  - Servicios add-on.
  - Hoteles Bernalo por unidad.
  - Paquetes dinamicos.
  - El monto de comision B2B (solo el % propio, como en la r1).

### Archivos que habria que reservar (propuesta para el Coordinador)

- **Nuevos:**
  - `lib/salesbot/paquetes/{contrato,bloqueo,porcion}.ts`: puros.
  - `lib/salesbot/paquetes/lectura.ts`: `server-only`; solo llama a los motores.
  - Pantalla(s) dentro de `app/(dashboard)/dashboard/salesbot/*`: ya reservada para #56. Pestanas por producto o subrutas, segun D11.
  - `pruebas/salesbot56Bloqueo*.test.ts` y `pruebas/salesbot56Porcion*.test.ts`.
- **Modificar, dentro de lo ya reservado para #56:** `lib/salesbot/contrato.ts` (lista negra comun) y `app/(dashboard)/dashboard/salesbot/page.tsx` (navegacion entre productos).
- **Consumidos sin editar** (el Coordinador avisa si otro frente cambia su contrato):
  - `lib/tarifario/datos.ts`, `lib/tarifario/vigencia.ts`
  - `lib/reservar/computo.ts`, `lib/reservar/cotizar.ts`, `lib/reservar/origen.ts`
  - `lib/reservar/edadesMenores.ts`, `lib/reservar/comisionReserva.ts`
  - `lib/acomodaciones.ts`, `lib/calc/paquetes.ts`
- **No tocar:**
  - `reservar/actions.ts`, `VistaBooking.tsx`, `BuscadorBooking.tsx` y todo `app/tarifario/*`.
  - Vuelos y sillas.
  - `proxy.ts`, RLS y migraciones (incluida la 218).
  - `package.json` y `types/database.ts`.

### Pruebas focales propuestas (ninguna ejecutada)

- **Paridad bloqueo:** para las mismas entradas, el total de `cotizarBloqueo` == `computarReserva(...).precioVenta`, y la suma de lineas cuadra. Con clientes simulados y `mock.module` del cliente admin, el mismo patron que ya usan las pruebas del checkout.
- **Cupos:**
  - Sillas libres < pax: `alcanzan: false`. Iguales: `true`.
  - Error al leer cupos: `error_tecnico`.
  - Empaquetado: `sujeto_a_confirmacion`, sin conteo.
  - Nunca aparece `record`.
- **Vigencia:**
  - Tarifa vencida: `tarifa_vencida`.
  - Salida pasada o paquete no publicable: no aparecen en la busqueda.
- **Porcion:**
  - La salida mapeada de `buscarHoteles` no trae netos.
  - Paridad entre el total de `buscarHoteles` y `computarReserva` para la misma composicion. Si difieren, la prueba lo deja a la vista: no se oculta.
  - Fechas sin tarifa: devuelve las sugerencias. Noches minimas: su error. Servicios grupales: `precio_no_final`.
  - Destino obligatorio.
- **Comun:**
  - Lista negra a cualquier profundidad.
  - Un "No se pudo..." nunca sale como texto.
  - Acceso: roles, inactivo, externo, Minorista.
  - Un hotel Bernalo: `no_disponible_en_consulta`, sin error tecnico.

### Decisiones pendientes (no asumidas)

- **D8:** ¿se muestran totales de bloqueo y porcion? Recomendacion: si, como "cotizacion orientativa sujeta a confirmacion", porque salen de la misma funcion que la venta (paridad por construccion) y con prueba de paridad.
- **D9:** comision B2B en paquetes.
  - Recomendacion: solo el % propio del aliado. El "% general" de paquetes SI existe en el sistema (`parametros_tributarios.COMISION_AGENCIA`/`COMISION_FREELANCE`, con 12 % / 11 % de respaldo en codigo, `lib/finanzas/comisionB2B.ts:457-462`), pero no se muestra sin decision.
  - Ningun monto mientras H-PQ1 siga abierto.
- **D10:** ¿servicios add-on en la v1? Recomendacion: no.
- **D11:** ¿una pagina con pestanas por producto o una ruta por producto? Ambas caben en la reserva de `salesbot/*`.
- **D12:** ¿hoteles Bernalo por unidad en una pieza posterior? Recomendacion: si, despues de porcion.

## Fase 1 - Lectura realizada

Dentro del alcance aprobado:
- `lib/programas.ts` y `docs/tecnico/programas-y-cotizacion-manual.md` (secciones 1.3-1.7 y 3).
- La vitrina `app/tarifario/programa/[id]/page.tsx` y el cargador del tarifario publico (`app/tarifario/page.tsx`, llamada a `getProgramasResumen`).
- `app/(dashboard)/dashboard/reservar/programa/[id]/page.tsx` y `reservarPrograma` / `reservarProgramaInterno` (`reservar/actions.ts:2843-3146`).
- `lib/tenant.ts`, `lib/tenant.server.ts` y `docs/tecnico/multitenant-auth-auditoria.md` (secciones 1 y 4).
- `docs/futuro/crm-leads-whatsapp-instagram.md` (encabezados) y la migracion 202 (tabla, actor, RPC y permisos).
- Esquema: politicas RLS de la 031 y la 068, la 213 (`programa_destinos_fijos`) y las columnas de `programas` y sus hijas en `types/database.ts`.

Ampliaciones justificadas, dentro del mismo mapa:
- `lib/calc/programaPrecio.ts`: es el motor real de `pvpPrograma`, que `lib/programas.ts` reexporta.
- `lib/programas/destinoFijo.ts`: contiene `programaVisibleEnPublico`, la regla de visibilidad de la vitrina.
- `app/tarifario/TarifarioPublic.tsx` (solo `PorProgramas`) y `comisiones/page.tsx`, `contratos/[numero]/gestion-actions.ts:174-222`, la 205 (`registrar_comision_b2b_manual`, base) y `lib/constants.ts` (`ROLES_INTERNOS`, `LECTURA_MODULO`): para responder D1/D7 y D3 sin suponer.

No leido (fuera de alcance): editor de programas, importador, resto de `TarifarioPublic.tsx`, 151, 161, 163 y 164 mas alla de lo citado.

## Fase 1 - Mapa de fuentes

| Dato comercial | Fuente | Consulta reutilizable hoy | Observaciones |
| --- | --- | --- | --- |
| Lista de programas visibles al publico | `programas` (`activo`, `publicado`, `destino_fijo_id` no nulo) + `programa_ciudades`, `programa_destinos_fijos` | `getProgramasResumen(sb, true)` (`lib/programas.ts:87`) | Devuelve `error` separado de `programas`. Solo campos de vitrina en su salida. |
| Precio "Desde" | `programas.desde_precio` (manual, manda) o el minimo PVP de `programa_precios` / `programa_salidas` | Dentro de `getProgramasResumen` | Ignora salidas `bajo_solicitud`. En el camino historico usa `dias` de cabecera. |
| Detalle: ruta, itinerario, hoteles por categoria, inclusiones, tours, blackouts | `programa_ciudades`, `programa_dias`, `programa_categorias`, `programa_categoria_hoteles`, `programa_inclusiones`, `programa_tours`, `programa_blackouts` | `getProgramaDetalle(sb, id)` (`lib/programas.ts:281`) | No filtra `publicado`/`activo`/destino (la vitrina filtra despues y no mira `activo`). Ignora los `error`. Ver R3-R5. |
| PVP por persona y acomodacion | `programa_precios` (modo categoria) o `programa_salidas` (modo salida); regla en `programas.regla_comisionable_*` | `getProgramaDetalle` -> `calcularPvpAcomodacionSalida` / `pvpPrograma` | Funciones puras. Redondeo hacia arriba: mil COP o dolar entero. Es el precio que D5 declara correcto. |
| Total de una configuracion | Mismas tablas | **No existe consulta de solo lectura.** Solo dentro de `reservarProgramaInterno`, que ademas crea venta y contrato | Hoy no coincide con el PVP mostrado: frente **#57**. |
| Vigencia | `programas.vigencia_desde/hasta` | `reservarProgramaInterno:2991-2994`, contra la fecha de ida | Solo la fecha de ida. |
| Blackouts | `programa_blackouts` | `reservarProgramaInterno:2997-3005`, contra la fecha de ida | Solo la fecha de ida. |
| "A solicitud" | `bajo_solicitud` en precios y salidas | Detalle y reserva | Unico parecido a disponibilidad. **No hay inventario ni cupos de programas.** |
| Edades | `programas.edad_nino_min/max`, `edad_infante_max` | `reservarProgramaInterno:3121-3144` | Defaults 1 y 11. |
| Condiciones de pago | `condicion_pago_tipo`, `condicion_pago_pct_inicial`, `condicion_pago_dias_saldo`, `restriccion_comercial` (164); `texto_condiciones`, `texto_cancelacion`, `texto_pagos` | Leidas por `reservarProgramaInterno:2983` | Textos libres sin estructura. |
| Minimo/maximo de pax | `programas.min_pax`, `max_pax` | Ninguna | No se validan al reservar (R6). |
| Tours opcionales | `programa_tours` (`precio` es neto) | `getProgramaDetalle` los publica con markup y fee, sin asistencia | `min_pax` y `dias_operacion` solo informativos. |
| Comision B2B | `aliados_b2b` via `registrar_comision_b2b_manual` (205): base `greatest(0, precio_venta - ventas.impuesto)`; % en `aliados.pct_comision` (040, NULL = default general) y `usuarios.pct_comision` (077) | `crearComisionB2B` (`gestion-actions.ts:174`), manual, por contrato | En programas no se calcula al reservar (queda "por definir" en `comisiones/page.tsx:81-100`) y su base hoy incluye los impuestos del proveedor: frente **#57**. Fuente del "default general": no leida. |
| Tenant | `programas` y sus hijas no tienen `tenant` ni RLS por tenant | `tenantContext` / `getTenant` del usuario | Catalogo global; minorista solo lo oculta en la UI. |
| Leads | `crm_leads` (202): tenant obligatorio, canal, etapas, tipo+numero | RPC `crm_lead_crear`, `_actualizar`, `_tomar`, `_cambiar_etapa`, `_registrar_actividad` | Todas exigen un actor humano activo (`crm_lead_actor`). Encaja con "el bot prepara, el asesor guarda". |

## Frentes separados que nacieron de este analisis (no se implementan en #56)

- **#57. Programas: paridad de precio cobrado y base comisionable B2B** (registrado por el Coordinador; responsable por asignar). Demostrado por lectura, no probado:
  1. `reservarProgramaInterno` cobra con `pvpPrograma(neto)` (`:3046-3053`, `:3081`), la ruta historica. No lee `tarifa_*` ni `impuesto_*` (`:3017`), mientras la vitrina, el detalle y el formulario muestran `calcularPvpAcomodacionSalida` (regla 161).
  2. En modo salida con `noches` nulo, la reserva usa `dias - 1` (`:3009`, `:3045`) y el detalle usa `dias`.
  3. No registra `ventas.impuesto`, asi que la comision de agencia se calcula sobre el PVP completo.
  - Decisiones del dueno que #57 hereda: D5 (vale el precio mostrado; asistencia por dias del programa con salida sin noches) y D7 (la base comisionable excluye los impuestos del proveedor).
  - Abierto en #57, no en #56: significado exacto del "impuesto" por modo (`impuesto`, `pct`, `ninguno`); en modo `pct` la resta porcentual no es necesariamente un impuesto. Tambien el fee bancario y la salida con noches cargadas.
  - **Correccion del ejecutor:** la version anterior de esta bitacora proponia usar `montoNoComisionable` como impuesto. Se retira: lo define #57.
- **#58. Programas: auditar lectura anonima de costos y borradores** (registrado; responsable por asignar). La 031 (`:162-170`) y la 068 (`:43`) crean `for select using (true)` sobre `programas` y sus hijas; solo la 213 cierra `programa_destinos_fijos`. Con la llave publica, la Data API podria entregar netos, tarifas, impuestos, `pct_mk`, reglas, `proveedor_id`, `notas` y programas no publicados. No verificado en Produccion. #56 no cambia esos permisos.
- **Hallazgos menores que el piloto rodea sin modificar codigo existente:**
  - R3: `getProgramaDetalle` ignora los `error`.
  - R4: lee `programa_precios` y `programa_categoria_hoteles` completas, sin filtrar por programa (`lib/programas.ts:303-304`); hay riesgo de truncamiento por "Max rows".
  - R5: la vitrina no exige `activo`.
  - R6: `min_pax`/`max_pax` no se validan al reservar.

## Fase 2 - Contrato de consultas de solo lectura (propuesta; nada implementado)

### Principios
1. **El modelo nunca toca la base.** Solo recibe la salida de estas operaciones, ejecutadas en el servidor. No recibe credenciales ni filas crudas.
2. **Lista blanca de salida.** Cada operacion devuelve solo los campos listados. Nunca: `neto`, `neto_*`, `tarifa_*`, `impuesto_*`, `pct_mk`, `pct_fee_tarjeta`, `regla_comisionable_*`, proveedor, `notas`, `nino_valor_servicios`, ni ids internos que no sirvan para la consulta siguiente.
3. **Mismo motor que el sistema.** Precios solo de `pvpPrograma` / `calcularPvpAcomodacionSalida`. El bot no calcula, no suma y no redondea.
4. **Regla de cifras mientras #57 no este fusionado y validado:** el bot puede dar el "Desde" y el PVP por persona de cada acomodacion, que es el precio mostrado y el que D5 declara correcto. **No da totales, subtotales, base comisionable ni monto de comision**, ni siquiera estimados. Para un total, responde que lo calcula el asesor en Reservar.
5. **Errores explicitos.** Union discriminada; un fallo tecnico nunca se presenta como "sin resultados".
6. **Sello de consulta.** Cada salida lleva `consultado_en` (instante del servidor; fechas de negocio en Bogota) y `fuente` (operacion y version del contrato). La **vigencia de un dato dentro de una conversacion es de 15 minutos** (decision del dueno, 2026-10-18); vencida, se vuelve a consultar. Sin cache entre conversaciones.
7. **Sin disponibilidad.** Nunca se afirman cupos: solo "precio publicado vigente" o "a solicitud", y siempre "sujeto a confirmacion del asesor".

### Contexto comun
- **Llamador:** codigo de servidor del piloto, con la sesion del usuario interno. No `service_role`.
- **Autorizacion:** sesion valida, `usuarios.activo = true` y rol en {superadmin, gerencia, administracion, operaciones, venta}; `control_vuelo` queda fuera (decision del dueno, 2026-10-18). Fallar cerrado si el perfil no se puede leer.
- **Tenant (D2 = solo Mayorista):** el de la sesion (`tenantContext`), nunca deducido del texto. Si no es `mayorista` (por ejemplo, superadmin con Minorista activa), la respuesta es `no_autorizado` con el motivo "el piloto opera solo en Mayorista".
- **Audiencia (D1 = B2C y B2B):** el usuario interno marca en cada conversacion si atiende a un viajero final (B2C) o a una agencia/freelance (B2B). En B2B elige la agencia del catalogo `aliados`, nunca por nombre libre. Ambas audiencias reciben el mismo PVP. Mientras #57 siga abierto, en B2B el bot puede mostrar el % de comision configurado en la ficha de esa agencia, pero nunca la base ni el monto, con la nota "la comision la calcula y confirma el asesor". Si la agencia no tiene % propio, dice que se aplica el default general sin dar la cifra, porque la fuente de ese default no se leyo.
- **Marca de precio en revision (propuesta):** mientras #57 siga abierto, el servidor marca `precio_en_revision: true` en cada programa afectado: regla comisionable activa en modalidad `base_neta_impuestos_al_final` con tarifa de proveedor cargada, o salida sin noches con asistencia medica. La marca se calcula con campos internos que no se exponen; el bot agrega "el precio de este programa esta en revision, confirmalo con el asesor".
- **Visibilidad:** consultable solo si `activo = true` y `programaVisibleEnPublico` (publicado + destino fijo).

### Operacion 1 - `buscarProgramas`
- **Entrada:** `{ destino?, texto?, tipo_transporte?: 'ninguno'|'aereo'|'terrestre', fecha_salida?, presupuesto_max_por_persona?: { monto, moneda }, limite?: 1..10 (default 5) }`.
- **Fuente:** `getProgramasResumen(sb, true)` mas un filtro en servidor por `activo`. Destino y texto se comparan, sin tildes ni mayusculas, contra `destino.nombre`, `nombre`, `subtitulo` y `ciudades`. `fecha_salida` y presupuesto se resuelven con el detalle de los candidatos (vigencia, salidas, PVP por persona).
- **Salida ok:** `{ resultados: [{ id, nombre, subtitulo, destino, ciudades[], dias, noches, moneda, desde_pvp, desde_origen: 'manual'|'calculado'|null, tipo_transporte, precio_en_revision, url_vitrina }], total, truncado }`.
- **Errores:** `sin_resultados`, `error_tecnico`. Si `getProgramasResumen` trae programas pero con `error`, la salida va con `parcial: true` y sin "Desde".

### Operacion 2 - `detallePrograma`
- **Entrada:** `{ id }`.
- **Fuente:** el mismo calculo de `getProgramaDetalle`, pero propagando errores y filtrando por `programa_id` las consultas de precios y hoteles (R3/R4). Diseno recomendado para el gate de codigo: **extraer sin cambiar comportamiento** la funcion pura que hoy arma los PVP por salida y acomodacion dentro de `getProgramaDetalle` (`pvpDeSalida` y la eleccion de `dias`), y usarla desde la vitrina y desde el bot. No reescribirla: el propio codigo registra que duplicar esa decision ya produjo el defecto 2 de la revision del PR #277. Toca `lib/programas.ts`, superficie compartida.
- **Salida ok:** `{ id, nombre, subtitulo, destino, tipo_transporte, dias, noches, moneda, vigencia: { desde, hasta }, salidas_texto, ciudades: [{ nombre, noches, alojamiento_previsto }], itinerario: [{ dia, titulo, comidas[], descripcion }], modo_precio, categorias: [{ id, nombre, hoteles: [{ ciudad, hotel }], precios: [{ acomodacion, pvp_por_persona | 'a_solicitud' }] }], salidas: [{ id, etiqueta, fecha_desde, fecha_hasta, noches, columna, precios: [{ acomodacion, pvp_por_persona }] | 'a_solicitud' }], incluye[], no_incluye[], tours: [{ nombre, ciudad, pvp_por_persona, min_pax, dias_operacion, descripcion }], blackouts: [{ desde, hasta, motivo }], edades: { nino_min, nino_max, infante_max }, condiciones: { pago: { tipo, pct_inicial, dias_saldo }, restriccion_comercial, texto_condiciones, texto_cancelacion, texto_pagos }, precio_en_revision, url_vitrina }`. `min_pax` y `max_pax` quedan fuera por decision del dueno (R6 = no).
- **Errores:** `no_encontrado` (no existe, no publicado, sin destino o inactivo: misma respuesta, para no revelar borradores), `error_tecnico` (cualquier subconsulta fallida; nunca un detalle parcial).

### Operacion 3 - `precioPrograma`: DESHABILITADA hasta #57
- **Estado:** definida para cuando #57 este fusionado y validado; el piloto no la expone antes. Mientras tanto, si piden un total, el bot responde que lo calcula el asesor en Reservar.
- **Entrada prevista:** `{ id, categoria_id? | salida_id?, fecha_salida, habitaciones: { sencilla?, doble?, triple?, multiple? }, ninos?, infantes? }`.
- **Fuente prevista:** la funcion pura de liquidacion que salga de #57 y que use tambien `reservarPrograma`, para que el bot y la reserva den siempre el mismo numero. #56 no la extrae.
- **Validaciones previstas:** las de la reserva (vigencia, blackout, categoria o salida del programa, acomodacion sin precio o "a solicitud", nino sin precio, al menos un pasajero). Sin aviso de `min_pax`/`max_pax` (R6 = no).
- **Salida prevista:** `{ moneda, lineas: [{ descripcion, habitaciones, pax, pvp_por_persona, subtotal }], ninos, infantes, total, total_pax, condiciones_pago, sujeto_a_confirmacion: true, consultado_en }`. En B2B, ademas: `{ agencia, base_comisionable, pct_comision, comision_estimada, nota }`, con la base que fije #57.
- **Errores previstos:** `parametros_faltantes` (lista exacta), `fuera_de_vigencia`, `en_blackout`, `sin_precio`, `a_solicitud`, `no_encontrado`, `comision_no_disponible`, `error_tecnico`.

### Catalogo de respuestas no exitosas

| Codigo | Cuando | Que hace el bot |
| --- | --- | --- |
| `no_autorizado` | Sin sesion, usuario inactivo, rol fuera del piloto, tenant distinto de Mayorista | No responde sobre programas; indica el motivo general. |
| `parametros_invalidos` / `parametros_faltantes` | Entrada mal formada o incompleta | Pregunta exactamente lo que falta. |
| `sin_resultados` | Busqueda valida sin programas | Lo dice y ofrece al asesor. |
| `no_encontrado` | Programa inexistente, no publicado, sin destino o inactivo | Lo dice, sin distinguir la causa. |
| `a_solicitud` | Acomodacion o salida "a solicitud" | No da precio; ofrece al asesor. |
| `fuera_de_vigencia` / `en_blackout` | Fecha fuera de vigencia o en blackout | Lo dice y sugiere otra fecha o al asesor. |
| `comision_no_disponible` | B2B sin agencia elegida o sin % | No da comision. |
| `error_tecnico` | Cualquier fallo de lectura | Se abstiene y transfiere; nunca rellena. |

## Verificador de cifras (diseno; nada implementado)

Funcion pura de servidor que revisa cada respuesta del modelo antes de mostrarla.
- **Extrae de la respuesta:**
  - Montos, en formatos como `USD $2.200`, `$ 1.465.000`, `1.100 USD` o `COP 3.500.000`.
  - Porcentajes.
  - Fechas, en formatos como `29/05/2027`, `29 de mayo` o `mayo 29`.
  - Numeros de dias, noches y pax.
- **Normaliza:** separador de miles colombiano, moneda explicita y fechas a ISO, con el ano tomado del resultado de la consulta.
- **Compara cada cifra** contra el conjunto de valores de las salidas de operacion de esa conversacion y contra los numeros que escribio el propio usuario (por ejemplo, "somos 4"). La coincidencia debe ser exacta tras normalizar; no hay tolerancia.
- **Si una cifra no tiene respaldo**, la respuesta se sustituye por una abstencion con transferencia al asesor y queda registrada como fallo del verificador.
- **Mientras #57 siga abierto**, cualquier monto que no sea un "Desde" o un PVP por persona devuelto por las operaciones cuenta como fallo, aunque sea la suma correcta de valores respaldados. Asi el modelo no puede construir un total por su cuenta.
- **Pruebas previstas:**
  - Montos con y sin moneda.
  - Montos reformateados.
  - Sumas inventadas.
  - Fechas con y sin ano.
  - Porcentaje de comision con y sin respaldo.
  - Numeros del usuario.

## Migracion 218 - registro de conversaciones: diseno tecnico (borrador; NO creada, NO ejecutada)

Numero 218 reservado por el Coordinador, solo como numero. Reglas de privacidad confirmadas por el dueno (`WORKSTREAMS.md`, fila #56):
- Documentos, telefonos y correos se enmascaran ANTES de guardar.
- Solo leen superadmin, gerencia y el asesor dueno de la conversacion.
- Al mes se eliminan los textos, las entradas de las consultas y la identidad del asesor, y quedan solo metricas agregadas sin vinculo personal.
- Nada se guarda hasta el gate de la 218.

### Decision de diseno: tablas en un esquema PRIVADO, no en `public`

- **Hecho comprobado:** el bloque `DO` de la 087 (`087:123-135`) recorre TODAS las tablas de `public`, salvo `auditoria` y `tarifario_resultado`, y les adjunta `trg_auditoria`. Ese trigger guarda el antes y el despues de cada fila en `auditoria`, sin retencion.
- **Riesgo:** si las conversaciones vivieran en `public` y alguien re-corriera ese bloque (CLAUDE.md lo sugiere para tablas nuevas), los textos quedarian copiados para siempre en `auditoria` y la anonimizacion del mes seria falsa.
- **Propuesta:** esquema `p218_priv`, fuera de la Data API, sin USAGE para `anon` ni `authenticated`. Mismo criterio que `p214_priv`.

### Objetos propuestos

**Tablas en `p218_priv`** (sin trigger de auditoria; RLS activa sin policies, por defensa):
- **`conversaciones`:** `id uuid`, `tenant text` (CHECK = `'mayorista'` en el piloto), `usuario_id uuid` (FK a `usuarios`), `audiencia` ('b2c'|'b2b'), `aliado_id bigint` (FK a `aliados`; solo con audiencia b2b, por CHECK), `estado` ('abierta'|'cerrada'|'transferida'), `iniciada_en timestamptz`, `cerrada_en timestamptz`.
- **`mensajes`:** `id`, `conversacion_id` (FK ON DELETE CASCADE), `rol` ('usuario'|'bot'|'sistema'), `texto` (ya enmascarado), `creado_en`.
- **`consultas`:** `id`, `conversacion_id` y `mensaje_id` (FK CASCADE), `operacion` (catalogo MULTIPRODUCTO segun `salesbot-ventas-multproducto.md`: 'buscarProgramas'|'detallePrograma'|'porcentajeAgencia'|'buscarBloqueos'|'cotizarBloqueo'|'buscarPorcion'|'cotizarPorcion', ampliable por migracion), `producto` ('programa'|'bloqueo'|'porcion_terrestre'), `entrada jsonb` (enmascarada), `resumen_salida jsonb` (solo ids de programa, conteos y codigo: nunca textos ni precios), `version_contrato`, `consultado_en`, `latencia_ms`, `codigo_resultado`.
- **`respuestas_modelo`:** `id`, `mensaje_id` (FK CASCADE), `proveedor`, `modelo`, `version`, `tokens_entrada`, `tokens_salida`, `costo_estimado numeric`, `latencia_ms`, `verificador_ok boolean`, `cifras_sin_respaldo int`. Es un conteo, no las cifras.
- **`revisiones`:** `id`, `mensaje_id` (FK CASCADE), `decision` ('util'|'corregida'|'descartada'), `nota` (enmascarada), `revisado_en`.
- **`metricas_diarias`** (lo unico que sobrevive al mes): `fecha date`, `tenant`, `operacion`, `codigo_resultado`, `audiencia`, `proveedor`, `modelo`, `verificador_ok`, `decision`, `n`, `latencia_ms_total`, `costo_total`, `tokens_total`. PK sobre las dimensiones. **Sin** `usuario_id`, `aliado_id`, `conversacion_id` ni textos.

**Defensa de enmascarado en la base** (respaldo; el enmascarado real lo hace la app antes de llamar):
- CHECK en `mensajes.texto`, `revisiones.nota` y en los valores de texto de `consultas.entrada` (por trigger):
  - Rechaza todo lo que parezca un correo (`[^@\s]+@[^@\s]+\.[a-z]{2,}`).
  - Rechaza toda secuencia de 7 o mas digitos seguidos.
- Los precios que redacta el sistema van con separador de miles (`2.500.000`) y pasan.
- Es una red de seguridad, no la regla completa: un telefono escrito con espacios lo atrapa la funcion de la app, no el CHECK.

**Escritura** (solo servidor):
- Funciones `SECURITY DEFINER` en `p218_priv` (`iniciar_conversacion`, `registrar_mensaje`, `registrar_consulta`, `registrar_respuesta`, `registrar_revision`, `cerrar_conversacion`), con EXECUTE solo para `service_role`.
- La app las llama desde codigo `server-only` despues de autenticar al usuario, y les pasa el `usuario_id`.
- Cada funcion valida:
  - El actor existe, esta activo, su rol esta entre los 5 aprobados y su tenant es Mayorista.
  - La conversacion es suya y esta abierta.
  - `aliado_id` coincide con la audiencia.
  - El texto respeta el CHECK.
- `search_path` fijo y `pg_temp` al final.
- **Alternativa descartada:** RPC en `public` con `auth.uid()`, como la 202. Permitiria al usuario fabricar mensajes con rol `bot` por la Data API y sesgar la evaluacion.

**Lectura:**
- Funciones `SECURITY DEFINER` en `public`, expuestas y con EXECUTE para `authenticated`: `salesbot_mis_conversaciones()` y `salesbot_conversacion(p_id uuid)`.
- Autorizan dentro de la funcion:
  - Superadmin ve todo.
  - Gerencia ve su tenant.
  - El dueno ve solo las suyas.
  - Administracion, operaciones y venta no duenos: 0 filas, sin revelar si la conversacion existe.
  - Un usuario inactivo o externo: nada.
- Sin acceso directo a tablas.

**Retencion al mes** (`p218_priv.anonimizar_vencidas(p_ahora timestamptz default now())`, EXECUTE solo `service_role`):
1. Toma un `pg_advisory_xact_lock` propio, para que dos corridas simultaneas no cuenten doble.
2. Selecciona las conversaciones con `iniciada_en < p_ahora - interval '1 month'`, con su detalle bloqueado.
3. Suma sus filas en `metricas_diarias` por dimension (`insert ... on conflict do update set n = n + excluded.n ...`).
4. Borra esas conversaciones; el CASCADE elimina mensajes, consultas, respuestas y revisiones.
5. Devuelve los conteos (conversaciones y filas eliminadas, metricas actualizadas).

Todo ocurre en UNA transaccion: si algo falla, no se borra nada y no se cuenta nada. Es idempotente: una segunda corrida no encuentra nada que borrar. Es irreversible por diseno: no queda tabla con texto ni vinculo personal.

**Disparador de la retencion** (DECISION pendiente del Coordinador y el dueno; no se asume):
- **A)** Cron de Vercel diario, siguiendo el patron de `app/api/cron/*` con `CRON_SECRET` que falla cerrado. Exige reservar `vercel.json` y una ruta nueva.
- **B)** `pg_cron` en Supabase, si la extension esta habilitada (no verificado).
- Con corrida diaria, el dato vive entre 1 mes y 1 mes + 1 dia. El postcheck reporta la edad maxima vigente.

**Rollback** (`rollback_218_*.sql`):
- Solo con todas las tablas vacias (las metricas incluidas), sin CASCADE y abortando si hay filas.
- Si ya hubo uso real, la 218 es forward-only y se retira con una migracion nueva.

**Riesgo residual que se declara, no se resuelve en la 218:** los respaldos de Supabase (PITR/backups) conservan lo borrado durante su propia ventana de retencion. Si el dueno exige que tampoco este ahi, es una decision de plan o configuracion de Supabase, no de esta migracion.

### Codigo de app asociado (para el gate de la 218, no ahora)
- **`lib/salesbot/privacidad.ts`, funcion pura `enmascararPII(texto)`:**
  - Correos -> `[correo]`.
  - Secuencias de 7 o mas digitos, admitiendo espacios, guiones o parentesis entre ellos, que no sean montos con separador de miles -> `[numero]`.
  - Un tipo de documento del catalogo (CC, CE, TI, RC, PAS, PPT, NIT) o las palabras "cedula", "pasaporte" o "documento" seguidas de 4 o mas caracteres alfanumericos -> `[documento]`.
  - Se aplica tambien a los valores de texto de `entrada`.
- **Escritor `server-only`** que llama las funciones de `p218_priv` con `service_role` tras `contexto()` de `lectura.ts`. Es el unico uso de `service_role` en #56, acotado a esas funciones.
- **`types/database.ts`:** se integra en serie despues de #39 (WORKSTREAMS).

### Pruebas propuestas para la 218 (ninguna ejecutada)
- **SQL en PostgreSQL local, con el mismo arnes y el mismo patron de CI que la 214, previa autorizacion del workflow:**
  - **A1 (ACL por rol x dueno):**
    - El dueno ve lo suyo.
    - Superadmin ve todo y gerencia ve su tenant.
    - Administracion, operaciones y venta no duenos ven 0.
    - Inactivo, `agencia`, `freelance`, `cliente_final` y `control_vuelo` ven 0.
    - `anon` sin acceso.
  - **A2:** sin DML directo; `p218_priv` no aparece en REST ni GraphQL (404/406) y `authenticated` no tiene USAGE.
  - **A3:** EXECUTE de los escritores solo para `service_role`; `authenticated` recibe `42501`.
  - **A4:** los escritores rechazan:
    - Actor inactivo, de otro rol o de otro tenant.
    - Conversacion ajena o cerrada.
    - `aliado_id` con audiencia b2c.
  - **E1-E4 (enmascarado):** el CHECK rechaza un correo y 7 digitos seguidos, y acepta `2.500.000` y fechas ISO. El trigger valida los textos dentro de `entrada`.
  - **R1-R7 (retencion):**
    - Vencida: se agrega y se borra. Vigente: queda.
    - El borde exacto de 1 mes se compara con `p_ahora` fijo.
    - Una segunda corrida no hace nada.
    - Dos corridas a la vez: una espera el lock y no hay doble conteo.
    - Una falla forzada a mitad deja todo intacto.
    - Tras la corrida, `metricas_diarias` no tiene columnas de identidad y en ninguna tabla de `p218_priv` queda texto de esas conversaciones.
  - **AU1:** ninguna tabla de `p218_priv` tiene `trg_auditoria`, y `auditoria` no tiene filas de ellas. Re-correr el bloque `DO` de la 087 no las alcanza, porque estan fuera de `public`.
  - **RB1:** el rollback aborta con filas y limpia con las tablas vacias.
- **TS:**
  - Vectores de `enmascararPII`: correos, telefonos con y sin separadores, documentos por tipo, montos con miles, fechas, texto sin datos personales y texto vacio.
  - Prueba de cableado: el escritor es `server-only` y solo llama funciones de `p218_priv`.
- **Preflight y postcheck de una sola fila `resultado`:** objetos, ACL, ausencia de auditoria y edad maxima vigente.

### Lo que sigue abierto para el gate de la 218
1. Disparador de la retencion: A (Vercel) o B (`pg_cron`).
2. Si "gerencia ve su tenant" o ambos tenants. El piloto es solo Mayorista, asi que hoy da lo mismo.
3. Autorizacion del workflow de CI focal de la 218, ruta de raiz como en la 214.
4. Aceptacion del riesgo residual de los respaldos de Supabase.

## Propuesta para el gate del piloto (no autorizada; requiere reserva del Coordinador)

- **Archivos nuevos:** tipos del contrato, operaciones de servidor, verificador puro, adaptador del proveedor de IA (interfaz neutra; D4 diferido, probable DeepSeek), pagina y acciones del piloto en el dashboard, y pruebas.
- **Superficies compartidas que tocaria:**
  - `lib/programas.ts`: extraer la funcion pura de PVP por salida.
  - `lib/constants.ts`: modulo en `LECTURA_MODULO` y `MODULO_POR_RUTA`, que tambien usa `proxy.ts`.
  - El menu del dashboard.
  - La migracion de D6.
- **No tocaria:** `reservar/actions.ts` (la operacion 3 esta deshabilitada), RLS de programas (#58), `crm_leads` ni personas (#42).
- **Variables de entorno:** solo nombres, nunca valores. La llave del proveedor y un tope de gasto configurable.
- **Prerrequisitos:**
  - Roles decididos.
  - Retencion y acceso de D6.
  - Vigencia de los datos.
  - Proveedor y tope de gasto (D4).
  - Numero de migracion.
  - Antes de cualquier canal externo, #58 cerrado.
  - Para totales o comisiones, #57 fusionado y validado.

## Plan de pruebas para el gate del piloto (propuesto; nada ejecutado)

1. **Lista blanca:** con datos de prueba de ambos modos y regla comisionable, ninguna salida contiene claves prohibidas, comprobado por recorrido de claves.
2. **Paridad de PVP por persona:** la funcion extraida da los mismos valores que `getProgramaDetalle` actual en ambos modos, salidas con y sin noches, y modalidad historica y nueva. La paridad del total con la reserva es de #57.
3. **Marca de revision:** `precio_en_revision` se activa exactamente en los dos casos de #57 y en ningun otro.
4. **Visibilidad:** no publicado, sin destino e inactivo dan `no_encontrado`; el provisional visible se comporta como en la vitrina.
5. **Errores:** con fallos inyectados en cada subconsulta, la salida es `error_tecnico`.
6. **Truncamiento:** con mas filas que el limite de la API, el detalle de un programa sigue completo.
7. **Vigencia y blackout:** fechas en el borde dan el mismo resultado que la reserva.
8. **Autorizacion:** sin sesion, usuario inactivo, rol fuera del piloto (incluido `control_vuelo`), usuario EXTERNO (`agencia`, `freelance` o `cliente_final`), `anon` y tenant Minorista: `no_autorizado`.
   - **Correccion 2026-10-18 (senalada por el Auditor):** la version anterior decia "B2B: `no_autorizado`". Es incorrecto. La AUDIENCIA B2B esta permitida: el usuario interno atiende a una agencia y ve el % propio de esa agencia. Lo que no se permite es que un usuario externo B2B use la consulta, porque no es usuario del piloto.
9. **Verificador:** los casos de su seccion, incluida la prohibicion de totales mientras #57 siga abierto.
10. **Evaluacion conversacional (no unitaria):** juego de preguntas reales anonimizadas, con resultado esperado (respuesta, aclaracion o abstencion). Mide exactitud factual, abstenciones correctas, transferencias, latencia y costo. Las cifras sin respaldo bloquean.

## Decisiones del dueno (2026-10-18)

- **D1. Publico: B2C y B2B.**
  - **Correccion del ejecutor (2026-10-18):** se habia dicho que los programas no tenian comision de agencia. Es falso: existe el mecanismo general de la 205, con base `precio_venta - ventas.impuesto` y el % de la ficha del aliado.
  - En programas, la comision no se calcula al reservar, y su base hoy incluye los impuestos del proveedor (#57).
  - Mientras #57 siga abierto, el bot no da base ni monto (gate del Auditor).
- **D2. Solo Mayorista.**
- **D3. Usuarios internos, para consultar** (no reservan desde el bot). La lista exacta de roles sigue **pendiente**.
- **D4. Proveedor diferido.** Primero un bot alimentado solo con datos del sistema; proveedor probable DeepSeek. En el gate del piloto se revisan con documentacion vigente su API de herramientas, el tratamiento de datos, el costo y el tope de gasto.
- **D5. Vale el precio mostrado** (regla 161), y con salida sin noches la asistencia se cobra por dias del programa. Lo hereda #57.
- **D6. Conversaciones en base: si.** Retencion, acceso y enmascarado **pendientes**.
- **D7. La comision de agencia en programas se calcula sin los impuestos del proveedor**, como en paquetes. Lo hereda #57, incluida la definicion de "impuesto" por modo.

## Decisiones del dueno sobre los pendientes (2026-10-18, segunda ronda)

- **Roles del piloto:** superadmin, gerencia, administracion, operaciones y venta. **`control_vuelo` NO entra.** El asesor revisa SIEMPRE la respuesta antes de pasarla al cliente.
- **Conversaciones (D6):**
  - Se conservan **1 mes** y luego se **anonimizan**. El dueno rechazo los 12 meses propuestos.
  - El resto de la propuesta se registra como aceptado, porque el dueno solo cambio el plazo: las leen superadmin, gerencia y el usuario que tuvo la conversacion; documentos, telefonos y correos van enmascarados en el texto guardado; no se guarda nada antes de que exista la migracion. Si el Auditor prefiere una aceptacion expresa de esos tres puntos, se pide.
  - "Anonimizar" queda por precisar en el diseno: borrar o enmascarar los datos personales y la identidad del usuario interno, conservando las metricas.
- **Vigencia de un dato dentro de una conversacion:** 15 minutos; vencido, el bot vuelve a consultar.
- **Proveedor de IA y tope de gasto (D4):** ultima etapa. El piloto se construye con el proveedor intercambiable y no se enciende sin esta decision.
- **Ejecutor del piloto:** el dueno confirma a este mismo chat. La reserva (worktree, rama, archivos y numero de migracion) sigue siendo del Coordinador.

- **Aviso de `min_pax`/`max_pax` (R6): NO.** El bot no avisa del minimo ni del maximo de pasajeros hasta que esos datos se revisen.
  - Hechos que motivaron la decision: los campos "Min. pax" y "Max. pax" de la cabecera (`CabeceraForm.tsx:181-186`) traen defaults 2 y 19 (`:45-46`), no se muestran en la vitrina y la reserva no los valida, asi que probablemente no se mantienen.
  - El dueno eligio la opcion C tras un ejemplo: viajero solo frente a minimo 2, y grupo de 25 frente a maximo 19.
  - Consecuencia: las operaciones no devuelven `min_pax`/`max_pax` y el verificador los trata como cifras sin respaldo si el modelo los menciona.

## Pendientes (no asumidos)

1. **Precisar "anonimizar"** (D6), en el diseno del registro.
2. **Fuente del "default general"** de comision de agencia (040): no leida; se revisa antes de mostrar un % por defecto.
3. **Proveedor y tope de gasto (D4):** diferido a la ultima etapa; el piloto no se enciende sin esto.
4. **Dependencias externas:** #57 (totales y comisiones) y #58 (antes de cualquier canal externo).

## Consulta Q1 (solo lectura; la ejecuta el Auditor cuando coordine la revision)

Mide insumos de #57, #58 y R4 en una sola fila, solo con conteos y booleanos, sin valores de costos.

```sql
select jsonb_build_object(
  'anon_select', (
    select jsonb_object_agg(c.relname, has_table_privilege('anon', c.oid, 'SELECT') order by c.relname)
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r' and c.relname like 'programa%'),
  'politicas_lectura_abiertas', (
    select jsonb_agg(tablename || ' | ' || policyname order by tablename)
      from pg_policies
     where schemaname = 'public' and tablename like 'programa%'
       and cmd in ('SELECT', 'ALL') and qual = 'true'),
  'filas', jsonb_build_object(
    'programas', (select count(*) from public.programas),
    'programa_precios', (select count(*) from public.programa_precios),
    'programa_categoria_hoteles', (select count(*) from public.programa_categoria_hoteles),
    'programa_salidas', (select count(*) from public.programa_salidas)),
  'p57_publicados_modalidad_nueva_con_tarifa', (
    select count(distinct p.id)
      from public.programas p join public.programa_salidas s on s.programa_id = p.id
     where p.publicado and p.activo and p.regla_comisionable is true
       and p.regla_comisionable_modalidad_mk = 'base_neta_impuestos_al_final'
       and greatest(coalesce(s.tarifa_sencilla, 0), coalesce(s.tarifa_doble, 0),
                    coalesce(s.tarifa_triple, 0), coalesce(s.tarifa_multiple, 0)) > 0),
  'p57_salidas_sin_noches_con_asistencia', (
    select count(*)
      from public.programa_salidas s join public.programas p on p.id = s.programa_id
     where p.publicado and p.activo and p.modo_precio = 'salida'
       and s.noches is null and coalesce(p.asistencia_medica_dia, 0) > 0)
) as resultado;
```

Complemento: el valor de "Max rows" en Supabase (Settings -> API), para compararlo con `filas`.

## Cruces conocidos

- **Contrato:** ninguno; solo lectura.
- **Piloto:**
  - `lib/programas.ts`, por la funcion pura de PVP; la usan la vitrina, el tarifario interno y reservar.
  - `lib/constants.ts`, que tambien usa `proxy.ts`.
  - El menu del dashboard.
  - La migracion de D6.
- **Fuera del piloto:**
  - `reservar/actions.ts` es de #57, y del codigo de #42 y #40.
  - La RLS de programas es de #58.
  - Los leads van en la fase 5 y se secuencian con #42.
