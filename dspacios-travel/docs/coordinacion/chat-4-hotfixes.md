# Chat #4 - Hotfixes

## Estado vigente - #63 fuente SIN RECORD / #67 integrada / orden #50 -> #63 -> #40, 2026-10-21

**CONTRATO CORREGIDO, listo para revision de reserva del Coordinador; NO GO de implementacion.** Esta nota prevalece sobre el uso anterior de promociones como si fueran tipos/estados, sobre igualdad de destino exacto anterior a #67 y sobre la secuencia anterior que solo esperaba #57. No se inicia codigo/SQL ni se reserva ejecutor/worktree/migracion/workflow. El dueno fija **#50 -> #63 -> grupo #40 E2/E3**; #56 mantiene su carril sin estos motores.

### Base y fuentes verificadas

origin/main LOCAL=0d360b39a1ceb1486175b96c44e0967d614416c8, PR374/#67; HEAD/main del checkout principal=51ca079e con documentos ajenos sucios. No se avanzo main ni se hizo fetch/reset. Se leyo codigo vigente con git show origin/main para no auditar version anterior a220. #57 y #62 ya integradas; #40H0/E1 y #68 aparecen en historial actual, conservar sus cambios. Aplicacion remota220/postcheck12OK/0fallos/12total es reporte del Coordinador/dueno y TASKS, NO SQL ejecutado por Chat#4. No reaplicar220. #67 conserva prueba funcional humana pendiente, no declarar produccion validada por existencia del commit.

TASKS63 describe fuente sin record, multiples salidas de destinos autorizados67, TRM/COP y servicios globales. WORKSTREAMS linea7 confirma orden #50->#63->grupo40. Skills Supabase ya leidas en esta conversacion se mantienen aplicadas para revision de ACL/RLS/puertas; no implementacion ni llamada al proyecto.

### 1. Semantica de origen CORREGIDA y auditoria de etiqueta editable

En Empaquetados NO existen tipos ni estados de promocion. Promocion es etiqueta visual de salida de Sistema sin PNR. #63 no crea tipo_promocion, flag promocional, descuentos, temporada promocional ni filtro por texto Promocion. Tampoco usa estados de emision/pago como sustituto de PNR ni lee vuelos de contratos como inventario reutilizable.

Evidencia de codigo actual:
- app/(dashboard)/dashboard/vuelos/EmpaquetadosTabla.tsx:32-38 tiene union de ORIGEN UI promocion|contrato e ids prefijados promocion:<id>/contrato:<numero>; NO es un enum de negocio en empaquetados.
- :187-189 dibuja EstadoBadge fijo Contrato si f.origen==contrato, y Promocion para TODA fila de origen empaquetados. El badge no tiene input/onChange: en la superficie revisada NO encontre etiqueta Promocion editable. Ademas ese badge no comprueba record, por lo que hoy una fila de empaquetados CON PNR puede seguir rotulada Promocion: hay discrepancia semantica real con la decision del dueno.
- vuelos/page.tsx:293 e historico/page.tsx:189 construyen origen:promocion por venir de empaquetados, y origen:contrato desde contratos. No decide precio ni cambia tipo por editar el badge; no renombrar toda esa union tecnica sin necesidad.
- Lo SI editable es Record(PNR): NuevoEmpaquetadoForm.tsx:72 y ControlEmpaquetadoForm.tsx:65-66; guarda actualizarControlEmpaquetado -> RPC actualizar_control_empaquetado, con historial y RLS. El PNR es dato operativo editable deliberadamente; no bloquearlo por confundirlo con una etiqueta. No se verifico pantalla live ni fila real que el dueno vio.

Riesgo funcional: el badge fijo por origen NO es autoridad para importar; si #63 filtra etiqueta/tipoUI o acepta toda la lista combinada, puede importar contratos o salidas ya conPNR, contrario al requisito. Texto descriptivo escrito en campoPNR tambien cuenta como datoPNR no vacio (no convertir automaticamente PROMOCION a NULL ni borrar records existentes). No se demuestra explotacion ni dato malo real, solo fuente del riesgo. El selector63 consulta tabla empaquetados y su id REAL; verifica NULL/trim(record)==vacio, activo, fechas/compra/moneda y destino67 al listar, guardar, generar y aceptar.

Recomendacion de UI acotada a reservar: badge fijo Promocion SOLO si origen empaquetados y PNRausente; conPNR mostrar etiqueta Sistema/Empaquetado (texto no editable), dejando PNR en su campo operativo. Filas Contrato conservan su identidad. Si el dueno observa una etiqueta editable en otra pantalla, no afirmar que fue reproducido en estas fuentes; no necesita otra decision de negocio para blindar elegibilidad servidor.

PNR que se agrega/cambia despues de vincular: invalida oferta #63 NO aceptada y exige revisar fuente, sin borrar PNR/vinculo ni convertir en manual silenciosamente. Intento ya aceptado conserva snapshot y trazabilidad; cambios operativos legitimos no reescriben deuda/historico. Este cambio de record debe entrar a cobertura de revision63 aunque trigger181 actual no lo escuche. QuitarPNR no incorpora automaticamente nada: vuelve elegible como candidato pendiente para seleccion expresa.

### 2. Configuracion UNICA de destinos #67, objetos vigentes a reutilizar

Existentes220: armado_paquetes.destinos_aereos_alternativos y tabla armado_paquete_destinos_aereos, pais_comparable_67, destinos_aereos_efectivos_67, guardar_destinos_aereos_67, validar_config_destinos_aereos_67, validar_vinculo_aereo_67 y triggers de config/origen. Helper integrado lib/paquetes/destinosAereos67.ts exporta resolverDestinosAereosPaquete, validarLoteOrigenesAereos, validarOrigenAereoPaquete, filtrarFilasPorOrigenAereo y prepararGuardadoDestinosAereos.

#63 usa exactamente esa config: OFF padrecomercial; ON padre+alternativasactivas mismopais comparable, sin alias/IATA como pais. Hotel/destinopublico/servicios siguen comerciales. NO nueva lista de destinos en salida ni clonar normalizarPais. Seleccion multiple valida cada empaquetado contra ids efectivos usando helperexistente y elegibilidad sinPNR de63. Una salida por(paquete_id,empaquetado_id), FKRESTRICT, fuenteNULL=alta manualconservada.

Diferencia concreta de integracion: filtrarFilasPorOrigenAereo hoy solo trata modulo=bloqueo, y validar_config_destinos_aereos_67/triggers revisan armado_vuelos/armado_empaquetados. #63 debe extender en NUEVA migracion sus guardas de retiro/config/origendestino para contemplar salidas_dinamicas vinculadas y extender filtro por salida_id->empaquetado_id, sin aceptar ids simultaneos ni convertir origen de reserva: sigue salidaId. No modificar archivo220 ni reaplicarlo ni quitar guardasBloqueo existentes. La guardaSQL compartida debe preservar ACL/tenant y todos los contratos67.

Retirar alternativa/apagarcheck/cambiarpadre con enlaces vigentes que se invalidarian sigue RECHAZANDO guardado y pidiendo desvinculacion explicita, ahora tambien con salidas vinculadas. No borrar vuelos/ventas ni anadir traslados. Cambios posteriores de pais/source destino hacen invalida oferta no aceptada y se detectan al cargar/generar/aceptar. Registrar config/revision67 en huella de63. Alta manual libre sigue su flujo; no afirmar pais validado de un texto de ruta sin registrofuente.

### 3. Contrato unico completo #63 (sustituye terminos, conserva H/T/R/F)

A Editor Desde salida sin record (puede rotularse Desde promocion como ayuda visual) consulta SOLO empaquetados, multiple y todas elegibles revisadas, sin incorporacion automatica. Nuevas fuentes aparecen pendientes; usuario agrega y regenera. UI separa manual/vinculada, sin cambiar fuente al editar campos copiados. Servicios globales traslados/tours reutilizan armado_servicios (incluido/opcional, persona/grupo, estancia/dia/noche), una asociacion/cobro. No crear un servicio de traslado por elegir aeropuertoalternativo.
B Moneda: todas fuentes actualesCOP confirmado por dueno, columnaexplicita con posibilidad futuraUSD pero no activada ahora. Hotel/serviciosUSD se liquidan en origen con sus temporadas/descuentos, NETO xTRMdearmado(COP/USD) antesMK. MismaTRM positiva persistida porpaquete/oferta, sin fallback1; manuales conservan moneda acreditada de tiquete/TA/fee antes de cambiar moneda publicada. Tarifario/cop/ventaCOP, no inferido de un hotel. AereoR=tarifa_para_empaquetarCOP sin MK/TA adicional; N=tarifa_proveedor solo costo, feeFigualclienteproveedor una vez. No motor de descuentos nuevo.
C BNC/impuesto configurado: tiquete=R porpaxconSilla y fijo=importe configurado en moneda validada/convertidaCOP; no impuesto nuevo ni precio proveedor comoBNC. InfanteBNC0. Hotelinfante/serviciosaplicables+F en UNA fila; FsinMK ni redondeo, ajuste de redondeoCOP solo partehotel/servicios, mismo total enform/cotizacion/venta. CostoHotel incluye netoinfante; edades reales/AdultsOnly respetados. No tocar legadoBNC global ni reglas #57/50 por inferencia.
D Publicacion atomica via publicar_tarifario_resultado181 extendido por migracionnueva: snapshotpreciosCOP+TRM+revision+fuentes y metadata privada coherentes. Sin separar publicarCOP de guardarTRM/config o autopublicar tras nuevas fuentes; error deja pendiente sin cachevieja publicable. Cargadores resumen/detalle usan vigencia62+destinos67+PNRausente antes de aceptacion; error tecnico no se presenta como disponibilidad0.
E Aceptacion previa atomica con snapshot completoprivado. Cotizacion+snapshot en transaccion, altas/autoria219 preservadas. T0anteslecturas; aceptar_oferta_63 compara revisionpublicada/fuente/config/venta y huellacompleta, revalida ENESEINSTANTE fechacompra/ida/record/country/destino/monedas/TRM bajo locks. Cambiorevision/precio/itinerario antes de aceptar -> nuevacotizacion/reconfirmacion, no cobro silencioso. Snapshotcontiene costos/proveedores/retencion/todosservicios/edades/B2Bsiaplica/TC y obligacionesoriginales; ninguna lectura viva posterior cambia esos datos.
F Numero reservado y cabecerainsert con triggerintentoactual/snapshot/tenant=fencing. Descartadoantescabecera no vuelve a insertarse; despuescabecera no takeoverporreloj. Guardarpendiente SOLO tras hijas completadas y exactoalaceptado; RPCfinanciera H para#63 deriva/rechaza payload alternativo incluso llamadadirecta/reconciliador. Preservar K15ya_completo primero y comportamiento no63 de210. MetadataCP/snapshot convertido atomicos confinanzas. Sinpayload -> reversionsegura; conpayload -> mismacomposicionR0aceptada aunque catalogoR1. Convertedterminal sin reaperturasilenciosa; lease demora, no prueba demuerte. Ordenlocks probadoCI, no RPCgigante delmotor.
G CxP: deuda original porproveedor/moneda y equivalentesCOP congelados privados porobligacion; ventas.costoCOP. Hguarda CxP+metadata enmismatransaccion; postearAsientoCxP obtiene importeCOP de metadata63 y errores no caen a nominalUSD. asegurarCuentasPorPagar valida obligaciones63/no complementofantasma por compararUSDvsCOP. Protege principal/proveedor/moneda snapshot de edicion incompatible sin bloquearpagosvalidosexistentes. TCpago separadadeTRMarmado, no reinterpretar trm1/2/3. Compatibilidad pagosUSD/asiento/cobertura es gate, no cambio de politica financiera #50.

### 4. Mapa preciso de superficies PROPUESTO, sin reservar

Prefijo app/(dashboard)/dashboard/ para rutas UI/acciones siguientes:
- paquetes/ConfigForm.tsx; paquetes/[id]/{page.tsx,ArmadoClient.tsx,SalidasDinamicasEditor.tsx}; paquetes/actions.ts: monedaTRM/editor/guardado idempotente/generacion, reutilizando220. No crear configuracionduplicada67.
- vuelos/empaquetados-actions.ts y vuelos/empaquetados/{NuevoEmpaquetadoForm.tsx,[id]/EditarEmpaquetadoForm.tsx}: monedaCOP/validacion fuente, operaciones generales no inventan tipo/estadopromocion.
- vuelos/EmpaquetadosTabla.tsx: SOLAMENTE etiqueta derivadaPNR+origen, sin uniondiscriminante nueva ni tiposcomerciales; ControlEmpaquetadoForm.tsx fuente de lectura no ruta para deshabilitarPNR. No cambiarvuelos/page.tsx/historico solo para renombrar literaltecnico origen:promocion.
- reservar/nuevo/ReservaForm.tsx: totalinfante/opcionalesCOP/revision/reconfirmacion.
- reservar/actions.ts: SOLO crearCotizacion/convertirCotizacion/reservarDesdeTarifarioInterno y depsmodo63 sobre base POST#50; NO Programas, carrito/comparativas/manuales ni duplicar cambios #50. Debe leerse diff final50 antes de mantener firma/campos del contrato.
Sin prefijo anterior:
- lib/paquetes/destinosAereos67.ts: extender consumidores de fuente por salidadinamica y comprobacionretiro, sin segunda regla.
- lib/calc/paquetes.ts; lib/reservar/{computo.ts,empaquetadoOrigen.ts,salidaDinamicaVigente.ts,incluidosCotizados.ts}: solo ramas63 conversion/BNC/infante/fuente/normalizacion, legacyintacto.
- lib/tarifario/{datos.ts,filtrosPostCarga.ts,resumen.ts} y app/tarifario/detalle-actions.ts: monedaCOP/publicabilidad/salidavinculada sinPNR+220+62, errores seguros.
- lib/contabilidad/asientos.ts SOLO postearAsientoCxP importeCOP63; lib/reservar/asegurarCuentasPorPagar.ts SOLO obligaciones63; app/(dashboard)/dashboard/contratos/[numero]/gestion-actions.ts y contratos/actions.ts SOLO rechazo explicito de mutacion que contradiga snapshot/CxP63, por delimitar con entrega50, no reglasNETO/comisionglobal.
- types/database.ts SOLO nuevas secciones/RPC, conservar 220/221 y cambiospost50.
Nuevos propuestos: lib/reservar/{ofertaDinamica63.ts,payloadFinanciero63.ts,prepararOferta63.ts,importeObligacion63.ts}. Son helpers de fuente/SNAPSHOT #63, no taxonomia promociones. nombreslibres de literalPromocion para no perpetuar tipo inexistente.

### 5. Migracion candidata y gates

Candidata: UNA migracion ADITIVA propia de #63, NUMERO/NOMBRE PENDIENTE del Coordinador DESPUES de#50; no proponer220(aplicada) ni221(#68integrada) ni inferir siguiente disponible. Objetos: monedaCOPfuente/salidasmanuales, modo/TRM/revisionarmado, FKfuente/unique, snapshots/ofertas/intentos/obligacionesprivados, fanoutrevision incluidoPNR, ACL/RLS/auditoria087, RPCcrearcotizacion/aceptar y extensionpublicacion181, Hregistrarfinanciero210, fencingcabecera/CXP. Extender funciones/guardas220 para salidasvinculadas ENmigracionnueva, sin editar220; postcheck debe demostrar que Bloqueo/Sistema67 se conserva. No rollbackdestructivo con aceptaciones/contratos; forward-only tras uso, rollbackpreuso probado.

Scripts nuevos preflight/postcheck/rollbackseguro/pruebas SQL/API/carreras y workflowfocal a DESIGNAR/reservar porCoordinador, no creado. BaseSQL debe incluir #50 y 220/221, enesquema desechable/Actions sinsecretos; noSQLremoto/Previewporagente. No reabrir estadoDB de220 por ausencia en historia manual.

Pruebasnuevas propuestas: ofertaDinamica63.test.ts, ofertaDinamicaGenerar63.test.ts, ofertaDinamicaEditor63.react.ts, ofertaDinamicaReserva63.react.ts, ofertaDinamicaFlujos63.test.ts, ofertaDinamicaMonedaCxp63.test.ts, ofertaDinamica63.pg.ts bajo pruebas/. Agregar casos ETIQUETA/PNR: literalUIrenombrado no cambia precio/eligibilidad, badge noeditable, textoPNR no vacio no esPromocion, listacombinada no permite contratos, sourceid y NULL/trimPNRautoridad, asignarPNRdespuesvinculo invalida noaceptadas, borrarPNR deja pendiente noautoimporta.

CIobligatorio ademas: Nfuentes/todas revisadas/nuevaspendientes/dedupconcurrencia; padre+alternativas220mismopais y retirorechazado para salidasvinculadas; manualintacto; conversionUSD/COPunica/TRMfaltante; serviciosglobales todosmodos/cobrounico; feeF0/Fno1000/hotelinfanteausente/presente/AdultsOnly/edades; BNCdosmodos paridadtotalvisiblecotizacionventa; CxPorigen/contabilidadCOP/coberturasinduplicado/pagoUSDcompatibilidad; fuente/TRM/config/PNR/revision/fechaBogotacambian entreT0/aceptacion; claimviejo/cabecera/reversion/respuestaperdida/reconciliador/Hdirectapayloadadulterado/ya_completo; REST/GraphQLsinmetadata y roletenant; rollbacksoloantesuso; regresiones62/67/219/221 y #50final, buildTSdifflimitado. Son pruebas PROPUESTAS, no ejecutadas.

Gates: (1) #50 integrada y contrato63 conciliado con diffreal; (2) Coordinador reserva exactosuperficies/funciones/migracionworkflow/ejector y GOlocal; (3) diff+pruebaslocales Chat#4; (4) Coordinador decide Draft/CI; (5) CIreal/auditoria locks/privacidad/CXP/preflight y GOdespliegue separado; (6) duenoSQL/merge/Vercel+validacionfuncional. NO se declara #63 cerrado por un selector, por #67fusionada o por etiqueta. #40E2/E3 despues63; #40H0E1/#68 integrados no se revierten; #56 sin nuevosmotoreshastaGOfinal.

### Riesgos residuales / veredicto para el Coordinador

La etiqueta no es editable en el codigo del badge revisado; PNRsi es editable operativo. El riesgo probado por lectura es su clasificacionactual pororigen (no porrecord), no una mutaciondeprecio al renombrar un badge. Se blinda elegibilidad por ids/record y se corrige displayacotado, sin nueva taxonomia. No reabrir aldueno preguntas deprecio/moneda/fee.

Dependencia BLOQUEANTE de implementacion = #50 y reservaexpresa. MonedaCXP/guardsH/T/R/F siguen requisitosdelGO, no residuales aceptadossinprueba. El mapa es unico pero debe conciliar funciones compartidas con la ENTREGAreal50 antes de reservar; no inventar firmas finales de un codigo aun nointegrado. Ningun numero ni workflowquedan reservados por esta nota.

Solo actualizada esta bitacora. Sin codigo/worktree/mainupdate/SQL/staging/commit/push/PR. Lista para lectura del Coordinador; sin mensajes a otroschats desde Chat#4. No hay pregunta bloqueante de negocio nueva.

---

## Historico - #67 y contratos anteriores de #63

# Chat #4 - Hotfixes

## Estado vigente - #67 reserva verificada / prompt de ejecucion, 2026-10-20

**GO LOCAL #67 Bloqueo/Sistema vigente por decision del dueno y reserva del Coordinador, NO por iniciativa de Chat #4.** Unico Opus, worktree NUEVO .claude/worktrees/destinos-aereos-67, rama codex/67-destinos-aereos; base origin/main a4c999cf7076f979a62a3de99f5aab66e58bf359. Migracion220 exclusiva 20260601000220_paquete_destinos_aereos.sql, scripts/runner220 y workflow .github/workflows/test-220-destinos-aereos-67.yml segun WORKSTREAMS nota Decision y reserva #67. GatePR lo decide Coordinador titular tras auditoria de Chat#4. Sin GO de codigo Dinamico/#63 ni SQLremoto/Preview.

Verificado: TASKS67 refleja GO y base; WORKSTREAMS nota141 delimita funciones/rutas. origin/main local=a4c999cf; main ya habia sido avanzado por Coordinador segun su nota. El diff 2dd8c951..a4c999cf es #57 (reservar/actions.ts, ProgramaReservaForm y helper/pruebasProgramas); interseccion con rutas app/lib/types de #67 VACIA. Por tanto no se necesita conciliar cambios de precio de Programas para este hotfix. No se repiten pruebas de #57 ni se atribuye su auditoria/validacion de Produccion a Chat#4.

Worktree propuesto no existe, rama local codex/67-destinos-aereos no listada, archivo220 no esta en arbol base a4c999cf. Comprobacion local solamente; no fetch ni inventario SQLremoto. Ejecutor revalida base/rutas/numero antes de crear. No se crean desde Chat#4. Status conserva dos documentos modificados y tres untracked ajenos; no se tocan.

Prompt final para entregar al unico Opus: implementar #67 Bloqueo/Sistema desde esa base y SOLO nota de reserva vigente; conservar checkOFF exacto, checkON union padre+alternativas activas mismopais comparable, sin inferir por IATA/nombre. Pais ausente/error bloquea alternativas. Retiro/off/cambio padre con enlaces incompatibles rechaza, requiere desmarcarexplicitamente, sin borrados ni cambioshotel/servicios/PNR ni traslados. Misma config/helper queda consumible por #63, pero NO implementar selector/importador Dinamico ni validarle promociones inexistentes. Preservar alta manualDinamico/#62.

Rutas autorizadas app: paquetes/{ConfigForm.tsx,actions.ts,[id]/page.tsx,[id]/ArmadoClient.tsx}, vuelos/empaquetados-actions.ts (solo linkssimple/lote), lib/paquetes/destinosAereos67.ts nuevo, lib/reservar/computo.ts solo guardaBloqueo, lib/tarifario/{datos,filtrosPostCarga,resumen}.ts y app/tarifario/detalle-actions.ts solo ocultar/rechazar origeninvalido, types/database.ts solo220. Rutas appdashboard llevan prefijo app/(dashboard)/dashboard/. SQL/scripts/workflow y pruebas nuevas destinosAereos67* segun reserva. No reservar/actions.ts, package, checkout/carrito, precios/TRM/CXP/#63. Cualquier funcion/ruta extra pide ampliacion.

Exigir rojo/verde con mocks consumidores reales y pruebas UI; SQL/RLS/API/carreras solo esquema desechable/CI sin secretos, permisos read-onlyworkflow. JuanDolio+SDQ+PUJ fixtures del mismo pais, varios vuelos/destino, otropais/null/inactivo/idforjado/batchmixto rechazados, OFFexacto, ondedup, retirada/offrechaza sinparcial, carrerasconfiglink, fuente/pais mutado oculta/rechaza venta, error tecnico diferenciado, regresiones #62/manualDinamico y precio/cupo/proveedor conservados. No afirmar inventario/disponibilidad real en Produccion por fixtures. BuildTS/diffcheck/status/stagingvacio tras ultimodiff. GateCI requiere resultados reales, no testplaneados; auditoria local antes de CoordinadorPR, el usuario publica cuando reciba GO.

El ejecutor no toca worktrees ajenos ni hace staging/commit/push/PR/SQLremoto/escriturasPreview. No llama #67Dinamicocerrado: esa mitad espera #63 completo con TRM/editor y misma config. Entrega base/diff/paths/huellas/logs/ejecutado-noejecutado/riesgos a Chat#4; solo el Coordinador mantiene TASKS/CURRENT_GOAL/WORKSTREAMS.

Solo actualizada esta bitacora por Chat#4, sin codigo ni worktree/SQL/migracion creados. Lista para que el dueno copie el prompt al ejecutor y el Coordinador lea verificacion de reserva/delta.

---

## Historico - contrato #67 y #63

# Chat #4 - Hotfixes

## Estado vigente - #67 destinos aereos alternativos, contrato corto, 2026-10-20

**Contrato listo para decision de reserva del Coordinador; NO GO de codigo/SQL y ninguna reserva realizada por Chat #4.** #67 permite vincular vuelo de otro destino del MISMO pais, preservando destino comercial/hotel/servicios. No agrega traslados ni deduce proximidad geografica. Base leida main2dd8c951; TASKS67/WORKSTREAMS67 contrastados. Solo lectura, sin pruebas/BDProduccion. No se audito disponibilidad real de registros JuanDolio/SDQ/PUJ: usar fixture o verificacion autorizada posterior, no afirmar que existen/comprables.

### Evidencia / limite de Dinamico

paquetes/[id]/page.tsx:34,48 filtra bloqueos_vuelo y empaquetados por destino_id del paquete; hoteles/servicios tienen sus filtros separados. La consulta inicial lee destinos(nombre,pais) del paquete, pero el selector de destinos solo pide id/nombre/codigo_iata. destinos.pais es TEXT nullable (types/database.ts:1400), no FK a pais. setVuelo/setTodosVuelos y setEmpaquetado/setTodosEmpaquetados hacen upsert por id sin validar pais/destino servidor: cambiar solo la consulta UI NO es suficiente.

HOY: tipo Bloqueo ya admite vuelos negociados y vuelos Sistema por armado_empaquetados. Tipo Dinamico solo usa salidas_dinamicas manuales; NO existe selector/importacion/vinculo de promociones de empaquetados a esas salidas. Esa parte depende de #63 y NO se declara habilitada/cerrada por #67. Alta manual permanece. Checkout tipado no admite Dinamico; para Bloqueo sigue motor/computo actual. No construir otra importacion de promociones para #67.

### Persistencia / regla unica propuesta

- Check por paquete destinos_aereos_alternativos boolean DEFAULT false.
- Tabla armado_paquete_destinos_aereos(paquete_id,destino_id), PK compuesta, FKs; solo alternativas elegidas, sin vuelos ni hoteles duplicados.
- Efectivos(checkOFF)={destino_comercial}; efectivos(checkON)={destino_comercial} UNION alternativas seleccionadas. Activar requiere al menos una alternativa valida distinta; multiseleccion deduplicada. Padre comercial siempre incluido, no selector sustitutivo de hotel.
- Un helper servidor compartido resolverDestinosAereosPaquete devuelve ids efectivos/configrevision o error, y validarOrigenAereoPaquete contrasta fuente viva y enlace. #63 usa el MISMO helper/tabla/check para filtrar/importar promociones, guardar y aceptar; eliminar su regla anterior de promocion.destino_id == paquete.destino_id por igualdad estricta cuando checkON. No segundo array/config dentro de salidas ni otro filtro de pais.
- Validar desde destinos persistidos: destino comercial presente, candidatos existentes/activos, mismo pais normalizado (trim, case y diacriticos deterministas, sin alias inventados ni comparar nombre de ciudad). Pais vacio/desconocido/ambiguo NO autoriza alternativa. Republica Dominicana vs RD no se equiparan por heuristica: corregir el catalogo mediante proceso autorizado si corresponde. IATA sirve de etiqueta, nunca prueba de pais ni cercania. CheckOFF mantiene filtro exacto anterior aunque no haya pais: no mezclar todos por defecto. Si no existe destino comercial, no listar todos los vuelos como fallback.
- Validacion en servidor tanto guardarconfig como vincular simple/lote y generar/reservar. DB tiene misma restriccion contra DML directo con triggers/RPC INVOKER autorizados segun RLS vigente; candado de paquete ordenado serializa config con links y evita reinsertar fuente retirada. No permisos nuevos por inferencia ni helper SECURITYDEFINER publico sin ACL/tenant.

### Desactivar/quitar destino/cambiar destino comercial

Politica minima sin borrados silenciosos: calcular enlaces actuales que dejarian de ser validos y RECHAZAR guardado de config mostrando ids/nombres/rutas afectados. Usuario debe desmarcar explicitamente esos vuelos en UI existente y despues guardar; no force-detach ni borrar vuelos, contratos o cotizaciones. Off solo puede guardarse cuando enlaces restantes pertenecen al destino comercial. Igual para quitar una alternativa/cambiarpais/destinocomercial. Error en la consulta de enlaces no significa cero referencias.

Trigger protege guardar y agregar en carrera; si un catalogo de destino/pais o fuente cambia posteriormente, invalidar tarifario de paquetes afectados y no permitir nueva oferta/reserva mientras la fuente ya no cumple. No alterar contrato ya emitido ni reasignar aeropuerto de una cotizacion; la nueva venta se bloquea/recotiza segun sus guardas, sin arreglar historicos. Para #63, estas modificaciones forman parte de su revision/huella y aceptacionT/H; la politica de retiro se aplica tambien a salidas vinculadas (su futuro empaquetado_id), no a texto libre de altas manuales. Las manuales siguen su recorrido actual; no afirmar pais verificable de una ruta libre ni inventarles promocion asociada.

No ampliar hoteles/servicios al pais entero. Paquete publico sigue JuanDolio, hotelJuanDolio; vuelo elegido identifica SDQ/PUJ y sus fechas/ruta, sin prometer traslado. Mostrar nombre destino aereo y codigoIATA si existe, ruta de la fuente, sin exponer PNR al cliente ni inventar aeropuerto cuando destino no tiene IATA. Fecha/activo/compra/cupo se siguen validando como hoy; pais permitido NO implica disponibilidad o cupo.

### Mapa exacto PROPUESTO #67, no reservado

Rutas relativas a dspacios-travel:
1 app/(dashboard)/dashboard/paquetes/ConfigForm.tsx: check/listamultiple/candidatos/error enlaces; posible carga de candidatos por nueva accion servidor en actions, sin ampliar paginas por conveniencia.
2 app/(dashboard)/dashboard/paquetes/actions.ts: PaqueteConfig/configToRow, crear/actualizarconfig mediante puerta atomica, setVuelo/setTodosVuelos y generarTarifario validan efectivos; no precio/TRM/CxP.
3 app/(dashboard)/dashboard/paquetes/[id]/page.tsx: cargarconfig/candidatos con pais y consultas aereas IN ids efectivos; hoteles/servicios intactos.
4 app/(dashboard)/dashboard/paquetes/[id]/ArmadoClient.tsx: mostrar destino/IATA de fuente y seleccionmultiple existente, sin habilitar promocionesDinamico.
5 app/(dashboard)/dashboard/vuelos/empaquetados-actions.ts: SOLO setEmpaquetado/setTodosEmpaquetados con validacion servidor/lote; no editar producto o monedas.
6 NUEVO lib/paquetes/destinosAereos67.ts: normalizacion pura/ids efectivos, lecturas minimas, validacion simple/lote/config coherente, dependencias inyectables. Contrato exportado consumible #63, no precios.
7 lib/reservar/computo.ts: validar origen seleccionado/enlace/destinoefectivo para paquete; no mismaigualdad padre que rechace SDQ/PUJ permitidos. Consulta fracaso=error seguro, sin devolver datos privilegiados.
8 lib/tarifario/datos.ts y 9 lib/tarifario/filtrosPostCarga.ts: ocultar filas fuente que ya no cumple config/pais, aun con cache anterior. Solo vuelos negociados/empaquetados, no hoteles pais ni free text salidasmanuales.
10 lib/tarifario/resumen.ts y 11 app/tarifario/detalle-actions.ts: propagar errorOrigenAereo tecnico, no disfrazar sin disponibilidad; fuente realmente no elegible puede ocultarse sin error tecnico. No cambiar proyeccionesSQL si idsfuente/paquete ya estan en filas.
12 types/database.ts: secciones config/tabla/RPCnueva.
SQL NUEVO, numero/nombre por Coordinador: checktabla/PK/FK, guardas mismo pais/configlink, invalidacion ante config/catalogopais/origen y extension de revision181, ACL/RLS/atomicidad. No editar migracionesviejas ni reservar numero por inferencia. Scripts preflight/postcheck/rollback sin uso y arnes CI nuevos a reservar; no ejecutarSQLremoto. Si rollback elimina config referenciada por ventas, rechazar y forward-only.
Pruebas nuevas propuestas: pruebas/destinosAereos67.test.ts (puras), destinosAereosFlujos67.test.ts (acciones/cargadores/computo reales con mocks), destinosAereosEditor67.react.ts, destinosAereos67.pg.ts (constraints/API/roles/carreras). Workflow focal a designar por Coordinador, no creado/reservado desde este chat; usar comandos directos sin package/loader.

### Cruces y secuencia propuesta

#63 comparte configuracion, editor, acciones, helpervigencia/computo, tipos/cargadores y futura migracion: implementar #67 primero si Coordinador prioriza urgencia, integrarlo y #63 consume la configuracion unica desde main actualizado. No intentar los dos en paralelo en esas rutas ni duplicar countrylogic. #63 debe ampliar sus triggers de origen/revision al permiso67 y mantener snapshotsaceptados.

#57 tiene reserva de reservar/actions.ts que #67 NO necesita editar: su gate y avance pueden continuar si Coordinador confirma cruces de nuevas migraciones/helpers al reservar. #63 SI se integra en serie con #57 por ese archivo. #50/#60/#61/#64 no absorbidos. No tocar worktrees ni asignar otro implementador.

### Pruebas focales minimas para gate

- JuanDolio comercial+hotel; SDQ y PUJ mismo pais seleccionables, varios vuelos por cada destino; IDs reales de fixture, nunca nombres como autorizacion.
- CheckOFF exacto padre; ON unionpadre+seleccion; otro pais/paisnull/aliasambiguo/inactivo/idinexistente/batchmixto rechazados por servidor, incluyendo POST directo y DML fueraUI. Sin destino padre NO consulta global.
- Agregar simple/todos con validacionlote antes de writes y deduplicacion; misma fuente seleccionada una vez; sin vuelos elegibles mensaje claro.
- Quitar/off con enlaces bloquea SIN cambio parcial; retirar enlaces explicitamente permite guardar; carrera volver a vincular vs guardado no salta guarda. Catalogopais/fuentedestino mutados despues de generar invalida/ofertaoculta y computo rechaza.
- Generar/cargarresumen/detalle/cotizar/reservar con vueloSDQ/PUJ permitido preserva precio/tipoorigen/proveedor/cupo; padre/hotel/publicoJuanDolio intacto y ninguntraslado anadido. Errorlectura distinto de no disponibilidad; regresion #62 vigencia y empaquetadodirecto.
- Regresion alta manual Dinamico intacta. Prueba integracion de promocionesDinamico se marca PENDIENTE #63, no omitida ocultada ni gate62verde como sustituto. Cuando #63 exista: mismasfuentes autorizadas/importmultiple/revision/retirar bloquea/aceptacion y monedaCP en su CI.
- BuildTS final, diffcheck y mocksconsumidoresreales; permisos/carrera en PGdesechable/CI. Ninguna prueba ejecutada en esta ronda.

**Siguiente: Coordinador decide reserva y prioridad #67 -> #63, con mapa anterior. Contrato urgente de Bloqueo/Sistema listo para reserva; Dinamico por promociones NO cerrado hasta #63 completo.** No preguntas de negocio nuevas bloqueantes: politica de retiro propuesta es rechazo seguro con accion explicita de usuario. Solo esta bitacora actualizada, sin codigo/SQL/staging/commit/push/PR ni numero de migracion reservado.

---

## Historico - contrato completo #63 y auditorias anteriores

# Chat #4 - Hotfixes

## Estado vigente - #63 contrato UNICO COMPLETO para reserva, 2026-10-20

**Se retira la propuesta F1 interna por decision del dueno transmitida por el Coordinador. #63 es UNA entrega completa: editor multiple + alta manual + servicios globales + TRM/monedas + publicacion + cotizacion/aceptacion/venta/CxP.** Los bloques internos siguientes solo ordenan implementacion/pruebas: ninguno es un producto parcial publicable. **GO TECNICO PARA QUE EL COORDINADOR RESERVE el objetivo completo bajo este mapa y condiciones H/T/R/F; NO hay GO de codigo ni reserva realizada por Chat #4.** No se elige ejecutor/worktree/numero SQL/workflow. Ninguna pregunta de negocio pendiente; los riesgos tecnicos tienen tratamiento/prueba explicitos abajo, no exencion silenciosa.

Base inspeccionada main=origin/main LOCAL 2dd8c951 (#62 ya integrado). WORKSTREAMS canonico confirma reserva #57 sobre reservar/actions.ts solo reservarProgramaInterno. #63 debe integrarse EN SERIE despues de conciliar #57 sobre main vigente: no tomar archivo de su worktree ni editar funciones de Programas. #42/219 integrado se conserva. No pruebas/SQL ejecutados en esta ronda; todo contrato y CI es especificacion. Checkout/comparativas/carrito no admiten dinamico en recorrido actual y quedan fuera.

### 1. Contrato funcional y cardinalidad cerrados

Conservar altas manuales. SalidasDinamicasEditor ofrece Desde promocion con seleccion MULTIPLE, tabla fuente empaquetados y nunca contratos. Fuente COP explicita segun confirmacion del dueno para todos los registros actuales; sin admitir USD aereo promocional ahora, pero columna explicita permite evolucion futura por migracion propia. Filtrar por destino exacto del paquete, activo, ventana compra inclusiva Bogota, viaje no pasado y fechas/precios verificables. Revalidar ids en servidor con permisos/tenant; no confiar en importes/proveedor del formulario.

N promociones elegibles -> N salidas con vuelos/fechas/precio propios y mismos hoteles/servicios configurados globalmente. UNIQUE(paquete_id,empaquetado_id), fuente NULL en manuales, FK RESTRICT y snapshots historicos sin cascada destructiva. Fuente puede pertenecer a paquetes diferentes. Agregar todas = conjunto elegible revisado en esa accion, no suscripcion. Reintentos/concurrencia no duplican. Promociones nuevas aparecen pendientes y SOLO se incorporan por accion explicita + regeneracion; nunca triggers que agreguen promociones futuras al paquete.

Hoteles y traslados/tours se configuran una vez por paquete: reutilizar armado_hoteles/armado_servicios. Separar secciones UI por categoria real sin segunda tabla ni segunda asociacion. Conservar incluido/opcional, persona/grupo y liquidacion estancia/dia/noche. Cambio de destino exige retirar/revisar vinculos incompatibles; no ocultarlos y conservarlos vendibles. Eliminar vinculo no transforma automaticamente promocion en manual; desactivar no borra documentos ya aceptados.

### 2. Moneda, netos, precio final y redondeo (R/F)

Modo explicito del paquete dinamico #63 con moneda PUBLICADA COP, independiente de monedas de costos. No usar la moneda de cualquier hotel disponible como ahora hace paquetes/[id]/page.tsx: inferencia actual es incorrecta para mezcla. Legacy sin modo#63 conserva reglas previas.

Cada entrada tiene moneda de origen confiable: hotel/servicio desde catalogo, promocion COP; salida MANUAL necesita moneda de tiquete/TA/fee explicita. Para manuales existentes, conservar la moneda del paquete previo a activar el modo COP (capturada/versionada antes de reemplazar moneda publicada) y mostrarla para revision; si no puede acreditarse, bloquear activacion, nunca asumir COP por el nuevo total. No convertir ni reescribir valores del catalogo.

TRM de armado por paquete, COP por 1USD, positiva/finita y obligatoria si hay componente USD. No fallback1 para mezcla. Usar una unica TRM para oferta aceptada. USD -> COP: multiplicar NETO por TRM antes de MK; COP queda igual. Tarifas/temporadas/descuentos aplican primero en moneda origen; descuentos de monto no se interpretan como COP antes de liquidar. Fee/TA fijos manuales se convierten segun moneda declarada. Sin inventar conversion para otra moneda.

- Promocion aerea: reventa tarifa_para_empaquetar COP como aporte final sin MK ni TA; neto tarifa_proveedor COP solo costo/CxP; F fee infantil exacto cliente/proveedor una vez.
- Vuelo manual: neto en moneda declarada -> COP -> MK O TA existente, sin aplicar regla promocional a manuales.
- Hotel y servicios: liquidacion neta en moneda origen -> COP -> MK una vez. Incluido persona horneado no se suma en venta otra vez; incluido grupo se cobra una vez segun grupo real y opcional solo al elegirlo. No dividir cargo grupo por adulto y luego cobrarlo otra vez. Conservar reglas actuales de edad/ocupacion y no aplicar preciofinal aereo a servicios.
- PVP por fila adulta = hotel/servicios marginados + aereo, con redondeo COP existente. Infante: parte hotel/servicios redondeada + F exacto (sin redondear ni marginar fee); ajuste de redondeo identificado aparte. Ninguna pantalla vuelve a redondear el total infante/fee.
- BNC tiquete = aporte de reventa promocional COP por pax con silla; fijo = configuracion del paquete con importe en moneda explicita de salidaCOP. No sumar BNC al PVP, no confundir con costo proveedor. No cambiar regla de impuesto de Programas #57 ni comisiones #50. Si se cambia moneda de paquete, el fijo viejo debe conservar moneda origen y convertirse/reconfirmarse antes de publicar, no reinterpretarse nominalmente.

### 3. Costos, deuda proveedor y asiento (hallazgo de compatibilidad cerrado en contrato)

Evidencia: CxPFinanciera ya admite moneda, cuentas_por_pagar tiene moneda/valor_total y trm1/2/3 de PAGOS; no tiene TRM de armado. financieroContrato/210 persisten deuda nominal; postearAsientoCxP en asientos.ts:159 recibe valorTotal sin moneda/TRM y lo usa directamente. asegurarCuentasPorPagar.ts:91 suma cobertura nominal mediante cxpCobertura, que no distingue monedas. No basta poner moneda=USD en CxP y costosCOP en ventas: produciria asiento nominal y suplemento fantasma de deuda.

Contrato para SOLO #63:
A Snapshot privado acepta costo origen/moneda, TRM, equivalenteCOP y acreedor (id/nombre/retencion) por componente y obligacion. ventas.costo_* COP; CxP.valor_total/moneda conservan deuda nominal origen (USD si el hotel cobra USD), no deuda convertida arbitrariamente. Cada CxP creada queda vinculada atomicamente a su obligacion/snapshot privado con equivalenteCOP congelado. TRM1/2/3 no se usan como TC de constitucion.
B Puerta financiera H deriva todo desde aceptacion, crea CxP y metadatos privados en misma transaccion; no guardar equivalencia despues del RPC en otro commit. Clave obligacion estable por componente; duplicar mismo proveedor no mezcla deudas con moneda distinta. AereoCOP y servicios USD pueden coexistir sin sumarse nominalmente.
C postearAsientoCxP, punto central comun, resuelve por cuentaId+contrato/tenant si es obligacion63; usa equivalenteCOP privado verificado para lineas contables. Si falta metadata/error no postea nominalUSD comoCOP: devuelve error detectable al mecanismo de recuperacion existente. Legacy conserva valorTotal actual. Helpers nuevos no importan asientos para evitar ciclo. Reintentos normales y reconciliador usan el mismo punto central, sin cambiar todas las acciones llamadoras.
D asegurarCuentasPorPagar, solo si venta tiene marcador63 validado, NO crea faltantes inventados con nominales: valida obligaciones aceptadas y CxP de la misma revision con equivalentesCOP; si completas retorna0, si falta alguna deriva recuperacion de la aceptacion/puerta H o devuelve requiere_revision, nunca insertar suplementoCOP por comparar100USD con400000COP. cxpCobertura legacy no se cambia. Error de lectura no significa no es63; debe distinguir ausencia de marcador de fallo.
E CxP63 aceptadas protegen de mutacion de principal/moneda/proveedor/retencion sin flujo autorizado. Triggers acotados rechazan DML que rompa snapshot y no bloquean abonos/pagos permitidos existentes. gestion-actions devuelve mensaje de rechazo al intentar editar/recrear principal protegido; no reescribir deudas anteriores. No introducir motor de diferencias de cambio ni recalcular pagos/historicos: pagos proveedor existentes deben conservar moneda original; CI verifica la compatibilidad actual y TC de pago separada de TC armado. Si una prueba demuestra que pago/asiento de diferencia necesita cambios, es BLOQUEO CONCRETO para Coordinador, no se absorbe #50 por inferencia.

Estos ajustes centrales son necesidades demostradas de #63, no GO para refactor contable global. Requieren reserva expresa de funciones compartidas; lista exacta abajo. No cambiar reglas de comision/NETO ni reabrir #50.

### 4. H/T: publicacion, aceptacion y recuperacion UNICAS

Publicacion: extender puerta publicar_tarifario_resultado181 mediante migracion nueva. Guardar filasCOP, moneda paqueteCOP, revision/config/TRM y snapshot privado de precios/costos/procedencia en UNA transaccion o nada. Candado/generacion/revision ya existentes se conservan. Cambio de fuente/config/TRM/moneda/servicios invalida oferta, no autopublica. Mutaciones SQL directas tambien invalidan por trigger. Seleccion multiple se guarda en lote idempotente y devuelve pendiente de generar; guardar no anuncia tarifa publicada. Error de publicacion deja pendiente/fallida sin mezclar filas viejas con moneda nueva.

Lectura vitrina: lib/tarifario/datos y resumen/detalle via filtrosPostCarga consultan #62 y fuente vinculada ademas de publicabilidad; error tecnico falla cerrado con errorSalida propagado, no sin disponibilidad. Exponer solo PVP/COP/revision opaca; no netos/proveedores/huella de costo reversible.

Cotizar: prepararOferta63 captura T0 (revision fuente/publicada/venta/config), resuelve TODOS los componentes/precios/CxP en solo lectura y persiste cotizacion + snapshot privado en RPC atomica. Verifica revision al guardar para evitar cotizacion rasgada; autoria/alta219 conserva su puerta/aviso existentes. Documento muestra precio/fecha/moneda aceptables, no proveedor/neto. Sin introducir dinamico a checkout/carrito/comparativa.

Aceptar al convertir: aceptar_oferta_63 bloquea oferta/intento y paquete en orden definido, compara T0/publicada=fuente/publicable y huella financiera completa con la cotizada, revalida AHORA en SQL compra/activo/fechas/destino/monedas/TRM (incluido cambio de dia sin UPDATE). Cambios antes de aceptacion requieren nueva cotizacion/reconfirmacion; no cobrar importe nuevo silencioso. Snapshot aceptado inmutable contiene precioCOP/BNC, netos/monedas/TC, acreedores, retenciones, tramos, pax y edades, costosCOP y obligaciones origen. Reservar numero dentro de la misma transaccion de aceptacion. No enviar datos financieros del navegador a RPC publica; funciones de servidor service_role con autorizacion previa por sesion/rol/tenant comprobada y clave idempotente por cotizacion/operacion.

Cabecera: trigger BEFOREINSERT ventas valida numero/intentoactual/tenant/cabecera contra snapshot y marca materializando en MISMA transaccion de insert. Antes de cabecera se puede descartar intento viejo; numero viejo queda tombstone y no puede crear otra cabecera. Despues de cabecera no takeover por reloj; errores recuperan/revierten solo ese numero, FKs impiden writes hijos de cabecera borrada. Sin reabrir oferta convertida por venta ausente. No nueva UI/RPC de reapertura en este alcance minimo: incidencia requiere_revision, nunca otra venta automatica.

Materializar: rama63 usa solamente payload DEVUELTO por aceptacion para cabecera/tramos/hotel/items y finanzas; no repetir lecturas vivas de costos/proveedores en pasos9-11. Payload de contrato_financiero_pendiente debe igualar aceptacion exacta y solo se guarda tras hijos completados. Un metadata guard verifica identidad/estado del intento y no confunde dos solicitudes con igualprecio.

H OBLIGATORIA: redefinir registrar_financiero_contrato EN migracion NUEVA, sin editar210. Para contrato63, solo procesa aceptacion actual/cabecera valida, deriva costos/CxP/monedas/metadata desde snapshot y rechaza payload alternativo; incluye llamadas DIRECTAS y reconciliador. Preserva salida ya_completo/K15 primero, no borrar/repostear asientos ni cambiar costo tras completo. Contratos legacy ejecutan semantica210 exacta. Snapshot convertido se marca por trigger en misma transaccion financiera. RPC antigua sin pendiente no puede fabricar cuenta63 distinta: guard de aceptacion igual que llamada ordinaria.

Recuperacion: pendiente con payload aceptado -> reconciliador mismo payload, incluso si fuente cambia despues de aceptar; sin payload -> reversion incompleto con controles existentes de pagos/completado. Oferta vuelve abierta solo si materializacion no completa fue revertida y numero descartado; convertida terminal. Worker viejo tras reversión no crea cabecera/hijas ni altera ganador. Lease/antiguedad son demora operativa, NO garantia de que proceso murio; no cambiar cron vercel ni maxDuration como sustituto del fencing. Probar orden real de candados con triggers y reconciliador; reintento seguro sin respuesta perdida ni doble cuenta. No nueva RPC gigante.

### 5. R/F: invalidacion y fixture numerico de contrato completo

Tabla de cobertura CI lista cada dato entre T0 y aceptacion y su revision/exencion: tarifas/temporadas/hotel/unidad no soportada, edades/pax/AdultsOnly/mascota, catalogo servicios/grupos/temporadas/modos, salidas/vinculos, proveedor/neto/retencion, configB2B si afecta precio, fuenteCOP, TRM y reglaBNC. Cambio solo de costo/proveedor puede invalidar aceptacion aunque PVP igual. Nuevas fuentes no vinculadas no cambian oferta existente ni se publican; cambio fuente vinculada obliga revisar/regenerar. Despues de aceptar, cambio catalogo no altera precio ni deudas acordadas; indisponibilidad operativa posterior es incidencia, no cambiar vuelo/historico.

Fixture completo propuesto (no ejecutado): TRM4000; hotel adulto neto100USD ->400000COP ->500000PVP con MK20%; tour incluido persona neto10USD ->40000COP ->50000PVP; reventa aerea1130000COP, neto1000000COP, F80500COP; dos adultos y un infante con hotel neto10USD y sin tour aplicable al infante. AdultoPVP1680000; infante hotel50000+F80500=130500; total3490500COP. Costos hotel210USD=840000COP; servicios20USD=80000COP; aereo2080500COP. CxP origen hotel210USD, tour20USD, aereo2080500COP; equivalentes y asientosCOP son840000/80000/2080500. Cobertura no agrega deudas porque no compara210 con840000.

BNC tiquete2260000 -> base1230500; fijo100000COP x2 -> base3290500. F una vez en venta y una en costo, sin MK/TA. Sin hotelinfante: PVPinf80500 y total3440500; costo hotel200USD. F0 y hotelinfausente: fila0, total3360000. Hotelinf neto10.075USD ->40300COP ->50375 marginado ->51000 redondeado, infante131500; distinguir ajuste625 en componente hotel de F exacto. Clasificacion edades del motor decide paxconSilla/infantes, no input crudo. AdultsOnly rechaza menor y no crea filas vendibles invalidas.

ReservaForm NUEVO hallazgo de alcance: reservar/nuevo/ReservaForm.tsx:164-166 suma habitaciones y nino/nino2 pero no fila infante; #63 debe incluirlo en total visible y conservar revision/precio mostrado. Tambien opcionals USD deben llegar al formulario en PVP COP normalizado, no calcular precioServicio con nominalUSD. Generar/cotizar/convertir/asiento deben compartir resultados/contrato y mostrar reconfirmacion si precio/revision cambiaron antes de aceptar. Nunca cargos sorpresa al cobrar infante/servicio.

### 6. MAPA UNICO PARA RESERVA PROPUESTA, no reserva efectuada

Rutas relativas a dspacios-travel, salvo workflow raiz:
UI y catalogo:
1 app/(dashboard)/dashboard/paquetes/[id]/SalidasDinamicasEditor.tsx
2 app/(dashboard)/dashboard/paquetes/[id]/page.tsx
3 app/(dashboard)/dashboard/paquetes/[id]/ArmadoClient.tsx
4 app/(dashboard)/dashboard/paquetes/ConfigForm.tsx
5 app/(dashboard)/dashboard/paquetes/actions.ts (CRUD lote idempotente, fuente/moneda, generar/publicar/revisiones)
6 app/(dashboard)/dashboard/vuelos/empaquetados-actions.ts
7 app/(dashboard)/dashboard/vuelos/empaquetados/NuevoEmpaquetadoForm.tsx
8 app/(dashboard)/dashboard/vuelos/empaquetados/[id]/EditarEmpaquetadoForm.tsx
9 app/(dashboard)/dashboard/reservar/nuevo/ReservaForm.tsx (infante/opcionalesCOP/total/revision/reconfirmacion solo#63)
Motor y oferta:
10 lib/calc/paquetes.ts (helpers puros explicitamente modo63, legacy intacto)
11 lib/reservar/computo.ts
12 lib/reservar/empaquetadoOrigen.ts
13 lib/reservar/salidaDinamicaVigente.ts
14 lib/reservar/incluidosCotizados.ts (datos origen/COP y validacion de incluidos sin exponer netos)
15 lib/tarifario/datos.ts
16 lib/tarifario/filtrosPostCarga.ts
17 lib/tarifario/resumen.ts (estado/errores vigencia vinculada y monedaCOP)
18 app/tarifario/detalle-actions.ts (errores/normalizacion publica modo63)
19 app/(dashboard)/dashboard/reservar/actions.ts: SOLO crearCotizacion/convertirCotizacion/reservarDesdeTarifarioInterno/dependencias privadas modo63; excluir reservarProgramaInterno y otras ramas #57/Bernalo/carrito.
Financiero acotado:
20 lib/contabilidad/asientos.ts: SOLO postearAsientoCxP, resolver importeCOP por obligacion63; no tocar comisiones, abonos ni pagos/asientos ajenos.
21 lib/reservar/asegurarCuentasPorPagar.ts: SOLO guard/validacion recuperacion obligaciones63; no cambiar algoritmo legacy de faltantes.
22 app/(dashboard)/dashboard/contratos/[numero]/gestion-actions.ts: SOLO manejar rechazo de editar principal/proveedor/moneda de CxP63/guardarCostos protegidos sin exito ficticio; no pagos/comisiones/facturas.
23 app/(dashboard)/dashboard/contratos/actions.ts: SOLO guard/error de actualizarServiciosContrato para contrato63 aceptado, no reemplazar con catalogo vivo ni cambiar #50. Si no hay edicion compatible, rechazo explicito conservando pantalla; no nuevo editor financiero.
24 types/database.ts (secciones/campos/RPC de#63, no regen indiscriminada)
Nuevos:
25 lib/reservar/ofertaDinamica63.ts (snapshot/huella/BNC/monedas/fee)
26 lib/reservar/payloadFinanciero63.ts (costosCXP por snapshot)
27 lib/reservar/prepararOferta63.ts (captura/coherencia/aceptacion y dependencia E/S)
28 lib/reservar/importeObligacion63.ts (resolver interno metadataCXP/importeCOP, sin dependencia hacia asientos)
SQL/CI propuestos:
UNA migracion nueva NUMERO/NOMBRE por reservar, que incluya COPfuente/manualmoneda/TRMmodo, enlaceunico, snapshots/ofertas/intentos/obligaciones privados, revisiones/triggersfanout, RPC crear_cotizacion_oferta_63/aceptar_oferta_63/lote vinculos/publicar extendido y H financiera, fencing/guardasCP/cabecera y ACL/RLS. No editar migraciones antiguas. Persistir metadataCXP en transaccion de registrarfinanciero; permisos no deben exponer netos por REST/GraphQL. Integrar auditoria087. Rollback con datos/uso real rechaza y requiere forward-only; no borrar snapshots aceptados para desinstalar.
Scripts nuevos preflight/postcheck/rollback seguro solo sin uso, arnes SQL/API/carreras de esa migracion, workflow propuesto .github/workflows/test-promociones-dinamicas-63.yml (a reservar, no creado).
Pruebas nuevas propuestas bajo pruebas/: ofertaDinamica63.test.ts, ofertaDinamicaGenerar63.test.ts, ofertaDinamicaEditor63.react.ts, ofertaDinamicaReserva63.react.ts, ofertaDinamicaFlujos63.test.ts, ofertaDinamicaMonedaCxp63.test.ts, ofertaDinamica63.pg.ts. Ejecutar React por comando directo, sin modificar package.json/loader. Test existentes no editables automaticamente; reservar solo fixture especifico si falla por contrato nuevo demostrado.

Fuera de mapa: lib/reservar/cxpCobertura.ts, financieroContrato.ts, reconciliacionFinanciera.ts, ruta cron y reconciliacion-actions (pueden mantenerse porque H y postearAsientoCxP central cubren sus caminos, a demostrar con pruebas), CartContext/checkout/comparativas, pago/conversion manual198, motores Bernalo, edicion Programas #57, #50/#60/#61/#64. Si CI muestra otra ruta necesaria, ejecutor informa caso concreto antes de ampliar, no absorbe frente externo. Mapa amplio por alcance real solicitado, no autoriza refactor global.

### 7. CI y gates del unico objetivo

1 Unitarias: formulas precisas USD/COP, TRM invalida/ausente, conversion unica antesMK, aereoR/F sin MKTA, redondeo, BNCdosmodos, infantehotelpresente/ausente/F0/no multiplo1000/edades, modos servicioincluido/opcional/grupo/estancia, proveedor/metadataCOP y cobertura sin duplicado.
2 React reales: seleccion0/1/N/todas, pendientes futuras no agregadas, destinoequivocado, errores/reintentos sin duplicado, servicios globales una vez, manualmoneda, TRMpersistente y pendientespublicacion; ReservaForm totalinfante/opcionalCOP y reconfirmacion repetida antes de aceptar.
3 Consumidores reales con mocks: generar -> cargarresumen/detalle -> cotizar -> convertir -> financieros/asiento/reconciliar; mismo precioCOP/revision/BNC/componentes/deudaorigenequivalente en todo camino; sin llamados externos o DBProduccion.
4 PG/REST/GraphQL CI desechable: migracion sobre219+#62/base actual y #57 integrado, grants/RLS por roles y tenant, snapshots privados, huella/costonoexpuestos, triggerDML/constraints, unica publicacion atomica y metadataCXP, H directa con payloadadulterado, ya_completo inmutable, racebeforeafteraceptar frente a fuente/TRM/config/retencion, relojfecha sin UPDATE, dobleclic/claimviejo antescabecera/no takeoverdespues, caidas por fases/pendiente/no pendiente/respuestaperdida/reversionfallida/workerrezagado/reconciliador, no deuda extra, rollback sinuso y rechazo con uso.
5 Regresiones focales #62, 171/172/181/210, 211 segun puerta consumida y #42/219; #57 en archivo compartido sin tocarProgramas; legacyCOP/USD y salida manual sin vinculo; preservar precios/comisiones #50 sin alegar corregirlos. Verificar tambien pago proveedor USD existente contra su moneda y separacion TCpago/TCarmado: si falla, bloqueo concreto antes de Ready, no ocultar como ajuste menor.
6 Build+TypeScript sobre ultimo diff; diffcheck/stagingvacio; evidencia reportada separada de ejecutada. CI real antes de Ready/merge; Prod SQL/merge/despliegue cada uno con GO del dueno, sin prueba financiera artificial. No tratar tests planeados como verdes.

### 8. Dependencias, veredicto y siguiente accion

Secuencia: #57 integra/conciliacion main vigente -> Coordinador reserva UNICO ejecutor/worktree/migracion/workflow y mapa#63 -> implementacion LOCAL completa con UI/mixedcurrency+servidor -> Chat#4 audita -> Coordinador decide Draft/CI -> CI y auditoria de fronteras -> GOhumano de despliegue/SQL/merge. No etapaCOP interna aprobada ni publicar un selector sin backend ni un backend parcial como solucion original.

Hallazgo financiero implica ampliar funciones centrales asientos/asegurar y guardas de edicionSOLO63; el Coordinador debe reservarlas expresamente. Eso es dependencia para GO, no decision de negocio al dueno ni traslado de#50. Si el Coordinador no autoriza esas superficies, NO GO de implementacion por moneda/CXP incompletas; no ofrecer deudaCOP falsa como atajo. No se solicita nueva regla comercial ni valorTRM hoy (se captura en cada paquete al usarlo).

Contrato completo listo para decision de reserva del Coordinador; condicionesH/T/R/F y puertas/shared helpers especificadas, riesgos restantes son pruebas obligatorias con stop concreto, no preguntas abiertas de negocio. NO se reserva nada desde Chat#4. Solo actualizada esta bitacora; sin codigo/worktree/SQLremoto/staging/commit/push/PR. No enviadas respuestas a otros chats sin autorizacion humana directa.

---

## Historico - propuestas F1 retiradas y auditorias anteriores

# Chat #4 - Hotfixes

## Estado vigente - #63 contrato corregido, reserva F1 condicionada, 2026-10-20

**Veredicto: GO TECNICO CON CONDICIONES PARA RESERVAR F1 INTERNA; NO GO DE IMPLEMENTACION HASTA RESERVA/GO EXPRESOS DEL COORDINADOR.** No se declara el diseno actual seguro sin condiciones. No se exige otra ronda abierta de diseno: el Coordinador puede convertir las condiciones cerradas siguientes en requisitos de la reserva/pruebas. Si no acepta su ampliacion, permanece NO GO de F1. F2a/F2b siguen sin contrato/reserva final; #63 completo NO esta aprobado ni resuelto para venta.

Entrega revisada: adjunto a4cf8c36-bdcd-4f95-888e-d2bf8844ae0f/Texto pegado.txt, solo diseno, base main=origin/main local 2dd8c951 verificada. Revision directa focal de RPC210, tabla/estados172 y helper financiero/reconciliacion ya leidos; sin pruebas/SQL ejecutados ni cambios de codigo.

### Lo aceptado de esta correccion

1 Aceptacion PREVIA atomica elegida de forma consistente: R0 aceptada puede completarse despues de cambiar catalogo a R1 sin sustituir datos. Esto resuelve el conflicto anterior entre CAS final y reconciliador, siempre que no exista bypass de payload. No se necesita mantener fuentes bloqueadas durante toda la materializacion.
2 Numero reservado en aceptacion como identidad durable + trigger INSERT ventas que comprueba intento actual/numero/tenant/snapshot y marca materializando en la MISMA transaccion de cabecera. Antes de cabecera, intento descartado rechaza worker viejo; despues de cabecera no hay takeover automatico. Tras reversion, numero sigue descartado y FKs impiden hijas sobre cabecera borrada. Son mecanismos reales de fencing; lease solo retrasa recuperacion, no demuestra muerte.
3 Snapshot completo privado, cotizacion+oferta en una transaccion y contador de cambios de costo/proveedor/retencion mejoran coherencia. Preservar autoria/avisos de alta 219 fuera del insert como hoy, con regresion #42. Tablas privadas con ACL/RLS y funciones solo service_role no eximen de validar tenant/autorizacion del caller servidor.
4 Oferta convertida terminal; no reapertura por desaparicion de venta. No incluir ahora nueva UI/accion de reapertura: se puede mantener requiere_revision terminal y tratar reapertura operativa como follow-up. Si el Coordinador reserva reabrirOferta63, debe exigir motivo/autorizacion/sin venta ni efectos financieros vinculados y auditoria en CI; ausencia de venta sola no prueba ausencia de historia.
5 Cotizacion dinamica existe fuera de carrito/comparativa; F1 no modifica checkout ni CartContext. No extrapolar congelado por pagos manuales a esta puerta. #50/#60/#61/#64 fuera.

### Condiciones OBLIGATORIAS para reserva F1 (cerradas)

H - Cerrar la puerta financiera antigua para contratos #63, no aceptar el residual ofrecido.
Evidencia: RPC210:105-119 bloquea venta y da ya_completo si no pendiente, pero si esta pendiente usa p_costos/p_cxp directamente (:151-193). Trigger sobre contrato_financiero_pendiente NO valida una llamada directa a la RPC sin esa tabla. Es tambien riesgo de otro escritor legitimo o future regression, no solo atacante con llave de servicio. Aceptar snapshot unico y dejar argumento alternativo sin validar es incoherente con garantia de misma revision.

Reserva debe incluir REDEFINICION ACOTADA de registrar_financiero_contrato mediante migracion NUEVA (nunca editar archivo210): para numero ligado a intento #63, validar cabecera/intento autorizado y estado, y derivar costos/CxP del snapshot aceptado o rechazar argumentos distintos. Conservar primero la salida ya_completo y la proteccion K15 para legacy; no mover ni duplicar CxP/asientos en reentrada. Para contratos sin intento comportamiento exacto210. ReconciliacionFinanciera.ts y financieroContrato.ts pueden seguir sin cambios si todas sus llamadas pasan por esa puerta protegida y pruebas lo demuestran. No hace falta wrapper/RPC gigante. Esto debe constar en reserva de FUNCION compartida, aunque no requiera editar mas TS; no invadir #50 sin avisar al Coordinador.

Prueba negativa obligatoria: aceptar R0 -> llamada directa antigua con costos/CxP adulterados o sin pendiente -> rechazo o payload derivado R0; despues llamada reconciliador misma aceptacion -> una finalizacion; contrato ya completo no tocado/revertido. Probar INSERT/UPDATE pendiente distinto tambien, como plantea C8.

T - Elegibilidad VIVA EN T2, no solo counters.
El tiempo cambia sin UPDATE/trigger. Si T0/T1 ocurren antes de medianoche Bogota y T2 despues, revision igual NO demuestra ventana de compra abierta/viaje vigente. aceptar_oferta_63 debe revalidar en la transaccion de aceptacion estado/fechas/ventanas de salida Y promocion, destino/moneda y configuracion, con fecha de negocio obtenida de reloj de aceptacion (documentar now/statement_timestamp segun duracion) y guardas fuente existentes. Caso R0 aceptado antes de vencer puede materializarse despues segun semantica elegida; R0 aun NO aceptado y ya vencido se rechaza. Dos pruebas distintas, no promesa de disponibilidad en vivo de aerolinea.

R - Cobertura completa de revision/snapshot e inmutabilidad.
La prueba cobertura propuesta es condicion CI, no pendiente para abrir otra ronda. Lista cerrada de tablas/campos leidos entre T0/T2, incluidas servicios/grupo/retenciones y datos B2B si cambian precio/cabecera; cada una tiene invalidacion o exencion demostrada. El contador se incrementa en la MISMA transaccion del cambio. Snapshot coste y precio se calcula una vez y las escrituras TS usan el payload DEVUELTO por aceptar, no variables previas ni nuevas lecturas de proveedor. Guardar pendiente se compara con aceptacion exacta y no hay fase posterior que vuelva a recomputar costos. Ningun campo de cost/proveedor/huella reversible se publica.

El orden de candados debe probarse con aceptacion, insert cabecera, registrar financiero, revertir y recuperacion. No aceptar la frase no coexisten como prueba: existe venta->oferta en finalizacion/reversion y oferta->intento en aceptacion. CI de dos sesiones verifica ausencia de deadlocks/ciclo; si hay uno, ordenar o abortar/reintentar sin duplicar. No introducir clocks/future_timestamp como mecanismo de seguridad: conservarlo solo como politica de retraso y comprobar que reconciliador no considera prematuramente pendientes #63. No cambiar frecuencia cron en F1.

F - BNC e infante.
Aceptado: fila infante unica incluso F0, Adults Only rechaza, edades autoritativas para venta/costo; neto hotel infante se suma a CxP solo #63. BNC no-infante coherente de misma revision, tiquete=reventa, fijo=configuracion, infante0. Tablas numericas a-e son ESPECIFICACION, no pruebas corridas.

Fee exacto mas redondeo SOLO de parte hotel/servicios es regla local propuesta #63 para satisfacer igualdad del componente; requiere que todos los consumidores de F1 conserven el total y no lo redondeen de nuevo al millar. No cambiar redondearVenta global/legacy. Probar F80.500, hotel neto40.300, total3.391.500, CxP hotel840.300/aerea2.080.500 y diferencia de redondeo625 en componente hotel, no fee. El primer fixture mezcla hotel+servicios400.000 y etiqueta todo como CxP hotel800.000: separar coste hotel de servicios o fijar servicios=0 para esa tabla; no ocultar CxP de servicios dentro de hotel.

### Fases / producto y reserva propuesta al Coordinador

F1 interna COP puede reservarse SOLO si el Coordinador aprueba esa division e incorpora H/T/R/F como aceptacion. No exponer nueva funcionalidad ni crear enlaces por scripts manuales; todas fuentes legacy NULL siguen igual. Guardas de generador, computo y aceptacion rechazan mezcla COP/USD. #63 queda incompleto hasta F2b, porque paquete USD+promocion COP es requisito confirmado del dueno.

Mapa F1 de adjunto aceptable con condiciones, relativo a dspacios-travel:
- Existentes: app/(dashboard)/dashboard/reservar/actions.ts (crear/cotizar/convertir/reservar, sin otros flujos), lib/reservar/{computo.ts,empaquetadoOrigen.ts,salidaDinamicaVigente.ts}, app/(dashboard)/dashboard/paquetes/actions.ts, types/database.ts.
- Nuevos: lib/reservar/{ofertaDinamica63.ts,payloadFinanciero63.ts,prepararOferta63.ts}.
- UNA migracion nueva NUMERO SIN ASIGNAR: moneda COP, FK/unicidad fuente, ofertas/intentos privados, contador/fanout, sincronizacion y fencing, RPC crear_cotizacion_oferta_63/aceptar_oferta_63, integracion inmutabilidad/auditoria. Incluir H sobre funcion registrar_financiero_contrato y guardas de payload antes de aprobar reserva. No editar171/172/181/210/219. reabrir_oferta_63 opcional solo si Coordinador lo reserva expresamente; terminal sin UI es opcion minima.
- Nuevos scripts SQL preflight/postcheck/rollback de nueva migracion, pruebas SQL y carreras/API+roles, workflow .github/workflows/test-promociones-dinamicas-63.yml. Rollback solo si no destruye aceptaciones/contratos reales; tras uso debe ser forward-only o rechazar rollback con datos, segun prueba. No prometer rollback seguro tras materializacion.
- Pruebas nuevas bajo pruebas/: ofertaDinamica63.test.ts (puras), ofertaDinamicaGenerar63.test.ts (generador real), ofertaDinamicaFlujos63.test.ts (cotizar/convertir/recuperar), ofertaDinamica63.pg.ts (API/roles). H/T/R/F y C1-C13 ajustados son gate CI antes de ready/merge. Pruebas existentes no editables automaticamente: cualquier fixture roto requiere causa/reserva especifica, no lista abierta para arreglar lo que falle.

No hace falta reservar financieroContrato/reconciliacion si H controla todas las vias en SQL y tests lo prueban. Si el ejecutor descubre otra via no protegible con este mapa, detiene SOLO ese punto y devuelve caso concreto al Coordinador, sin rediseño ilimitado ni ampliacion automatica.

F2a editor/catalogo/servicios globales y F2b TRM conservan propuesta del adjunto, pero NO mapa cerrado ni GO ahora. F2b requiere verificar moneda deuda/CxP y conversion unica antes de reserva; no basta mencionar snapshotv2 y calc/paquetes. No se autoriza numero SQL, worktree ni otro ejecutor en esta auditoria. Un unico ejecutor cuando Coordinador lo designe; #57/#40 y demas worktrees conservan sus reservas.

### Siguiente paso concreto

Coordinador decide: aprobar F1 interna con reserva exacta anterior y H/T/R/F obligatorias, o mantener #63 sin GO si no desea dividir producto. Si aprueba, Chat #4 entrega prompt final de implementacion con etapas locales y gate CI, sin pedir otra respuesta de negocio. No codigo/SQL por esta nota; auditoria y pruebas aqui descritas son lectura/PLAN, no validaciones ejecutadas.

Solo bitacora actualizada. Sin codigo, SQL remoto, staging, commit, push ni PR. Lista para Coordinador; #62 integrada no equivale a #63 liberada.

---

## Historico - auditorias y propuestas previas

# Chat #4 - Hotfixes

## Estado vigente - #63 auditoria de contrato F1 del ejecutor, 2026-10-20

**Veredicto: NO GO TECNICO de implementacion/reserva completa.** El documento d31d4a29-ac9c-46e5-80a1-34c0634dae1c/Texto pegado.txt aporta una reduccion valida de superficies, pero NO demuestra la garantia financiera/reintentos prometida. Requiere correccion TECNICA por el mismo ejecutor y decision del Coordinador sobre fase F1/F2. Ninguna pregunta de negocio cerrada se reabre. #62 ya esta fusionada; main/origin/main locales 2dd8c951 verificados, sin red ni cambios de codigo.

### Aceptado y correcciones al mapa anterior de Chat #4

- CartContext.tsx:31 y checkout/actions.ts:57 tipan solo bloqueo|porcion_terrestre; el recorrido dinamico existente inspeccionado es ReservaForm -> crearCotizacion -> convertirCotizacion -> reservarDesdeTarifarioInterno. El mapa anterior de Chat #4 sobredimensionaba checkout/carrito/comparativas: retirarlos de F1 es correcto; no habilitar Dinamico en esas rutas por conveniencia ni afirmar que todas las entradas runtime quedan validadas por un tipo TS.
- convertirCotizacion:1178 y siguientes rechaza manual y madre comparativa; pagos/congelados de cotizacion manual no deben incorporarse a F1. Mantener intactas 164/198/211/216/217/219. Nuevo rechazo de cambio de precio en cotizacion dinamica es comportamiento expreso de #63, no describirlo como existente.
- Reusar revision/puerta de publicacion 181 y RPC financiera 171/172/210 es razonable. No hace falta convertir todo motor en una RPC gigante ni una maquina por paso sin necesidad. Pero CAS solo en llamada final no protege todos sus caminos alternativos.
- Propuesta de COP explicita legacy concuerda con decision directa del dueno. Numero 220 NO reservado: que no aparezca archivo local 220 no autoriza asignarlo ni demuestra disponibilidad de todas las ramas/remoto.

### P1. Reconciliador elude la nueva frontera CAS

Evidencia actual: financieroContrato.ts:240 guarda payload pendiente en commit propio ANTES de deps.rpc. reconciliacionFinanciera.ts:65-83 lee ese payload y vuelve a llamar registrarFinancieroContrato SIN oferta63; la RPC financiera existente no verifica intento/revision. Contrato F1 afirma expresamente que el reconciliador no cambia y que completa sin CAS.

Carrera concreta: A calcula R0 y guarda pendiente; cambia fuente a R1; A pierde proceso antes del wrapper o wrapper rechaza; B/reconciliador lee pendiente R0 y llama puerta antigua, completando contrato sin chequeo ni marcar snapshot en transaccion. Si claim ya vencio, incluso puede completar intento ajeno al actual. El hecho de que payload sea internamente R0 NO prueba que fue aceptado/finalizado conforme a la frontera CAS propuesta. Tambien puede haber costos leidos despues de R0 mezclados antes de guardar pendiente.

Correccion requerida: elegir UNA semantica. O aceptacion previa atomica crea snapshot financiero completo inmutable autorizado (despues el reconciliador consume solo esa aceptacion, sin recalcular); o CAS final es autoritativo y TODOS los caminos de finalizacion/recuperacion pasan por el mismo chequeo de claim/revision. No combinar ambas explicaciones. Si se modifica reconciliacion, declarar su archivo y la puerta que usa en reserva. Si se protege en SQL, delimitar funciones/guardas NUEVAS e impedir la via antigua para contratos #63, conservando legacy/210. Prueba CI: guardar pendiente -> cambiar fuente -> matar A -> correr reconciliador antes del reintento humano; no ok de revision no aceptada ni doble cuenta.

### P1. Timeout no es fencing; borrar y reiniciar no cierra reintentos

Documento F1 deja pasos 3-11 sin cambio y solo revisa propietario del claim al final. Un worker A con claim vencido sigue pudiendo numerar/insertar ventas/pasajeros/tramos mientras B lo toma y revierte/reinicia. Registrar numero con transicionar despues de siguienteNumeroContrato no liga atomicamente esa identidad a la primera escritura de cabecera. Una comprobacion de token antes del INSERT tampoco es fencing si takeover puede ocurrir entre ambos.

Hay que fijar operacion concreta que vincula intento/numero/cabecera y que impide efectos del worker desplazado, o NO permitir takeover automatico de un intento con posible escritura en curso y enviarlo a recuperacion controlada bajo candado. Probar A pausado antes/despues de insert cabecera, B toma claim, A continua; ninguna cabecera huerfana, doble materializacion ni reversion del ganador. Quince minutos no demuestra proceso muerto. No aprobar contrato de timeout sin esa garantia; no imponer maquina grande si una alternativa acotada la prueba.

Estado convertida no debe volver automaticamente a abierta porque falte venta: puede existir borrado/reversion o historial financiero y la identidad de una venta ya consumida no se vuelve un pedido nuevo por ausencia. Exigir decision/recuperacion explicita o mantener marca consumida; no cambiar borrar/recrear historicos #50/#59 ni crear otra venta silenciosa.

### P1. Snapshot/revision de costos incompleto y persistencia partida

Huella F1 incluye aereo/hotel pero no define todos los servicios incluidos/opcionales/grupo, sus costos/proveedores/monedas/retenciones que se leen en pasos posteriores. reservar/actions.ts:773-864 consulta servicios/proveedores despues de crear cabecera; costoHotel se combina con proveedor leido vivo :738. Proveedores.nombre/retenciones declarados fuera de huella aunque influyen en acreedor/importes/retenciones de CxP. Si afectan el payload financiero, o quedan congelados en snapshot aceptado o hay revision/validacion explicita; no llamarlos cosmeticos sin prueba.

El contador aparte propuesto solo escucha algunos campos (proveedor y neto aereo). Documentar cobertura completa precios servicio/temporada/rangos/hotel, fee, proveedor/retencion y cualquier campo que cambia CxP; revisar orden de lectura R0, captura de TODOS los datos, R1/CAS para evitar snapshot rasgado. No hace falta esconder vitrina por mero costo si esa politica se acuerda, pero nueva cotizacion/conversion debe detectar diferencia material aunque PVP sea igual. El trigger 181 actual no lo cubre todo, punto correctamente detectado por ejecutor.

Cotizacion y snapshot insertados en dos commits y marcar descartada despues de error no garantizan unicidad/trazabilidad ante caida o UPDATE fallido; falla cerrada al convertir sin snapshot reduce daño pero no hace atomica la aceptacion. Proponer insert cotizacion+snapshot privado en UNA transaccion/puerta acotada, preservando autoria/alta de personas 219, o declarar/garantizar estado pendiente inconvertible detectable y recuperacion concreta. No decir atomico si son commits separados.

### P1. F1/F2 cambia la entrega solicitada; no es alcance de producto completo

TRM/mezcla USD-COP y selector MULTIPLE con nuevas pendientes/servicios globales son requisitos confirmados de #63, no extras opcionales. F1 backend COP solo sin UI ni TRM puede ser una fase interna util, pero necesita aprobacion del Coordinador, gate de no exposicion y secuencia F2 concreta antes de ofrecerlo como solucion al caso paquete USD + promocion COP. No se autoriza el uso de scripts/SQL manuales para crear vinculos fuera de UI aprobada. En F1 debe rechazarse explicitamente fuente COP con hotel/servicios USD, sin sumar monedas ni etiquetar COP como USD. No desplegar ruta parcial ni relajar validacion de moneda vigente.

#64 SI esta en TASKS.md del checkout compartido, linea373; el ejecutor puede haber leido version committed atrasada. Mantener separado: no implementar cotizacion libre/servicios no catalogados ni confundirla con armado de promociones. No reserva 220 o worktree de #63 por este documento.

### P2. Infante: redondeo, cero y costo de hotel deben quedar completos

Fila unica infante y ejemplo de 2 adultos+1 infante son correctos como algebra del componente. Pero el contrato afirma que fee cliente solo coincide con costo si es multiplo de1000: no se acepta como nueva restriccion del dueno. Mantener F como componente exacto cliente/proveedor, y desglosar ajuste de redondeo del PVP si aplica, sin renombrarlo fee ni aplicar MK. Probar F=80.500 o80.123 y distinguir suma de componentes de total redondeado, sin cambiar regla global.

Fila infante debe existir cuando los componentes aplican, no solo fee>0: F=0 + hotel infante ausente no debe transformar un infante valido en adulto/omitirlo por falta de fila; definir representacion de precio0 compatible con motor. Adults Only sigue bloqueando. Ademas costoHotelTotal actual en reservar/actions.ts:734-736 suma habitaciones/nino/nino2, pero NO netoPorAcom.infante: el ejemplo Hneto=40.000 implica tambien COSTO/CxP hotel+40.000, no solo PVP infante+50.000. Corregirlo solo para oferta63 si se acepta reserva; no ampliar legacy globalmente sin asignacion. Coste aereo usa numInfantes reclasificado del snapshot, no input.infantes crudo.

### BNC: parte aceptada

Impuesto/BNC tiquete = reventa aerea por pax con silla y fijo=parametro paquete preserva semantica del generador. Usar campo impuesto de fila publicada es viable si pertenece a revision/oferta aceptada y todas sus filas no-infante son coherentes, no primera fila arbitraria. Fila infante BNC0 conserva criterio paxConSilla. Plan debe probar igualdad tarifario -> crearCotizacion -> convertir/venta; checkout/comparativa quedan fuera de F1 tras reduccion correcta. Error/nulo/config ilegible rechaza, sin fallback0. Mantener costo_proveedor fuera de BNC y reventa sin MK/TA adicional.

### Correccion pedida al MISMO ejecutor, solo diseno

Entregar UNA revision focal del contrato, sin codigo ni SQL, con:
1 Politica F1/F2 para aprobacion del Coordinador: F1 interna no expuesta COP, F2 TRM/editor multiple/servicios globales; criterios de salida y superficies por fase, no asumir division aprobada.
2 Frontera de aceptacion/finalizacion unica y tratamiento concreto del reconciliador/puerta financiera antigua; aclarar si CAS final o aceptacion previa, con cronologia de carrera que cumpla ese criterio.
3 Fencing o recuperacion manual segura de claim vencido con pasos viejos aun vivos; numero/cabecera e idempotencia atomicos. No reapertura automatica de snapshot convertido por venta ausente.
4 Snapshot completo privado con todos los costos/proveedores/fee/monedas/retenciones y cobertura de revision; cotizacion/snapshot atomicamente enlazados o estado pendiente recuperable.
5 Fixture infante con/sin hotel, F0 y F no multiplo1000, CxP HOTEL y AEREA correctas y BNC ambos modos; demostrar contrato por tablas/cronologia, no afirmar pruebas ejecutadas.
6 Lista final de archivos/funciones nuevas o extendidas por fase; migracion SIN numero asignado hasta reserva. Solicitar explicitamente reconciliacion/puertas adicionales si necesarias; nada de #50/#60/#61/#64 por inferencia.

No se ejecutaron pruebas ni SQL: el adjunto es diseno, no implementacion. Solo bitacora actualizada por Chat #4. No GO de codigo, migracion, staging, commit, push ni PR. Lista para lectura del Coordinador; no quedan preguntas de negocio al dueno, solo decisiones de secuencia/alcance y correccion tecnica.

---

## Historico - main actualizado y entregas previas

# Chat #4 - Hotfixes

## Estado vigente - #62 fusionado, main actualizado, continuacion #63, 2026-10-20

Peticion directa del dueno: #62 fusionado, actualizar main y continuar #63 con el ejecutor que espera actualizacion.

**HECHO: main del checkout principal actualizado por fast-forward autorizado de 9e4d1322 a 2dd8c951e524e6271444c3377c8ade713120ab96 (#62, PR #370). HEAD = main = origin/main LOCALES.** origin/main ya contenia el merge; no fetch ni consulta por red. Se incorporaron tambien los cambios previos #53/#42 que faltaban en el main principal. No merge commit creado.

Preservados y comprobados por SHA256 los cinco documentos locales: CURRENT_GOAL.md, TASKS.md, TASKS_ARCHIVE.md, COORDINATOR_HANDOFF.md, salesbot-ventas-multproducto.md. Status final conserva exactamente dos modificados y tres untracked documentales; staging vacio; diff check limpio salvo avisos informativos LF/CRLF de esos documentos (sin errores). No se editaron documentos centrales para reflejar el merge: siguen bajo el Coordinador y pueden contener estado historico atrasado.

Primer intento de merge no pudo crear ORIG_HEAD.lock por sandbox; se reintento con escalacion autorizada por la peticion directa, salida 0 y conservacion verificada. No rechazo de auto-review. No reset, stash, clean ni operaciones sobre worktrees ajenos.

Comprobado commit visible fix: validar vigencia de salidas dinamicas #62 (#370), 10 rutas. Blobs integrados helper add79acd01b54d187b0e491a379a880d48e171dc y prueba flujos 37a79bebf994255d5d72e4b663fc7ee50757afbc coinciden con auditoria. No se repiten build/pruebas por actualizar base con contenido ya auditado. Merge confirmado localmente; Vercel/Produccion NO verificados por esta actualizacion.

### Actualizacion para el mismo ejecutor de #63

Base nueva de trabajo tecnico: origin/main/main 2dd8c951, verificable otra vez antes de reservar implementacion. #62 ya no es bloqueo de integracion, usar su helper comun de vigencia sin reimplementar. Mantener todas las decisiones de negocio cerradas; no preguntar de nuevo moneda COP, reventa aerea sin MK/TA, TRM de componentes, servicios globales neto+MK, impuestos configurados ni fee doble naturaleza.

El siguiente paso sigue siendo revision tecnica acotada SIN CODIGO: contrastar la propuesta de aceptacion/version/snapshot privado y materializacion idempotente de la nota anterior con las puertas reales vigentes 181/171/172/210/211/219. Entregar operaciones/funciones concretas, parametros internos/autorizacion, claves por paso, estados/errores y recuperacion; no exigir una RPC gigante ni alterar finanzas #50. Confirmar BNC por snapshot y fila infante unica con fixture 2 adultos+1 infante presente/ausente hotel, y mapa minimo de reserva/migracion/pruebas para el Coordinador. La ampliacion a financieroContrato/reconciliacion/puertas de escritura solo esta PROPUESTA, no GO para editar. Un unico ejecutor existente; no se lanzo otro ni se le escribio a otro chat desde aqui.

El permiso de actualizar main es expreso y ya ejecutado; la peticion de continuar #63 no se usa para inventar worktree/numero SQL ni saltarse la reserva del Coordinador. Hasta su GO, no implementar #63. #50/#60/#61 y #64 separados. Sin staging, commit, push, PR, merge de PR ni SQL remoto por Chat #4. Solo fast-forward local expresamente pedido y actualizacion de esta bitacora.

---

## Historico - auditoria #62 y diseno #63

# Chat #4 - Hotfixes

## Estado vigente - #62 auditoria incremental final, 2026-10-20

**Veredicto: APROBADO LOCALMENTE para el gate de PR del Coordinador sobre ecae767880b06e880d2e836c1e052c79801bf935.** Cerrados los dos bloqueos de auditoria anterior: vitrina real y prueba de generarTarifario real. No se identificaron nuevos defectos bloqueantes en el diff. NO significa listo/desplegado/validado en Produccion: el Coordinador decide GO de Git/PR al dueno y despues siguen merge/despliegue/validacion humana. #63 sigue solo diseno/NO GO de implementacion, despues de integrar #62.

### Estado y diff comprobados personalmente

Mismo worktree C:\Users\Asus\Documents\DspaciosMayorista\.claude\worktrees\salida-dinamica-62; rama codex/62-salida-dinamica-vigente. HEAD = origin/main LOCAL = ecae7678. No fetch por Chat #4. Estado inicial/final: siete archivos modificados mas tres nuevos sin seguimiento, exactamente las diez rutas de la entrega ampliada. Nada en staging y git diff --check limpio. Sin SQL, manifiestos, lockfile ni aliasLoader en el diff. Se preservan las tres guardas originales; helper/ prueba pura mantienen hashes previos. La prueba de flujos se amplia sin borrar contratos anteriores.

Diff incremental revisado de filtrosPostCarga/resumen/detalle/prueba filtro y arnes de flujos. filtrosPostCarga lee campos minimos de salida viva con helper comun y devuelve errorSalida independiente; no elegible = fila oculta, errorSalida null; error tecnico/sin admin con filas relevantes = oculta y errorSalida. Resumen y ambos caminos de detalle propagan error con mensaje publico existente y observabilidad, sin confundir con catalogo vacio. Mantiene filtros hoteles/empaquetados y filas sin salida_id. Separar bloque de errorSalida para no romper regex previos no cambia su semantica.

### Pruebas ejecutadas personalmente en esta ronda

Desde dspacios-travel del worktree:
node --test --experimental-strip-types --experimental-test-module-mocks --experimental-loader ./pruebas/support/aliasLoader.mjs pruebas/salidaDinamicaVigencia62.test.ts pruebas/salidaDinamicaFlujos62.test.ts pruebas/filtrosPostCarga.test.ts

**106 tests, 26 suites, 106 pass, 0 fail/cancelled/skipped/todo; salida 0; ~6,5 s.** Ejecutan helper y computo, carga completa, filtro postcarga y consumidores REALES cargarResumenTarifario, obtenerDetalleSalida, obtenerDetalleServicios y generarTarifario con clientes/cache simulados. Capturan p_filas del RPC de publicacion: solo salidas elegibles; ninguna elegible no publica, error de lectura no publica, porcion no consulta salidas. Registro ESM LOCAL en la prueba resuelve next/cache a stub antes del import dinamico; no cambia loader compartido. No son consultas ni publicaciones contra una BD real.

La prueba del camino Servicios con salida_id es sintetica para cubrir propagacion de error, no un producto real de Servicios con vuelo. Casos de negocio invalido y fallos tecnicos estan diferenciados. Limites inclusivos y cambio de dia Bogota cubiertos en la prueba pura/flujos.

### Dos fallos ajenos: reproducidos y fuente base contrastada

Ejecutada personalmente ocupacionBernaloUI3EWiring.test.ts aislada con comando unitario del proyecto y reporter TAP: **64 tests, 62 pass, 2 fail, 0 omitidas/canceladas/todo; proceso Node salida 1**. Fallos exactamente en HotelBernaloCotizarModal: regex UbicacionHotel y SeccionesIncluye. No se corrigieron ni suprimieron.

Comparacion git diff --exit-code origin/main vacia para la propia prueba y sus fuentes relevantes: VistaBooking.tsx, TarifarioPublic.tsx, app/tarifario/page.tsx, datosBernalo.ts y destinosPorcion.ts. La prueba lee fuentes e importa helper sin ninguno de los modulos modificados por #62. Esto acredita que los dos fallos corresponden al mismo contenido de base y son ajenos al diff; NO se afirma haber ejecutado una copia limpia de origin/main. No es motivo para ampliar #62 a UI Bernalo ni volver a tocar #52/#54.

Regresion amplia PERTINENTE reportada por ejecutor: 54 archivos, 1868 tests, 1866 pass/2 fail, sin omitidas. No reejecutada completa por Chat #4; los dos fallos aislados SI fueron reproducidos arriba. No declarar bateria completa verde. Las regex anteriores de detalle pasan segun ejecutor; no se alteraron esas pruebas.

### Build y evidencias revisadas, sin repeticion automatica

Leidos encabezado y final de evidencia_build_final_62.txt: pnpm run build, Next16.3.0/Turbopack, compilacion correcta (~20,3 s), TypeScript terminado (~26,5 s), 16/16 paginas, tabla de rutas/Proxy y BUILD_EXIT 0. Ejecutado por el ejecutor despues del ultimo cambio; Chat #4 reviso el log y no repitio build. El primer intento fallo por tipo del fixture (valor_tiquete); ejecutor lo corrigio y repitio: no confundir el log anterior con el verde final. Aviso previo pnpm.onlyBuiltDependencies sin relacion con este diff. Advertencias experimentales de Node y tipo de modulo sin cambio de package.json.

Logs reportados/revisables en:
C:\Users\Asus\AppData\Local\Temp\claude\c--Users-Asus-Documents-DspaciosMayorista\52a6fbf5-c255-4e88-80bc-89a6991edd8b\scratchpad\
- evidencia_build_final_62.txt: revisado personalmente.
- evidencia_regresion_final_62.txt: inspeccion parcial del log; bateria completa reportada, fallos reproducidos aislados como arriba.
- evidencia_verde_final_62.txt: reporte del ejecutor contrastado por ejecucion independiente de 106/106.
- evidencia_rojo_ampliacion62.txt y evidencia_rojo_filtrosPostCarga.txt: reportadas 17/54 y 12/24 fallos respectivamente, no restauradas ni reejecutadas por Chat #4. No atribuirse ejecucion roja.
Los logs son temporales; este registro conserva resultados, limites y huellas.

### Huellas finales auditadas, git hash-object

- app/(dashboard)/dashboard/paquetes/actions.ts: b43e6ffbfe28420e2edc42f4d52216fbc672a46b
- app/tarifario/detalle-actions.ts: c7c9ab6fb56a95c5d3a762d56d4229afc2704701
- lib/reservar/computo.ts: 3ec25eef62491a91374912f91bb0ee7bf5d85eb5
- lib/tarifario/datos.ts: 06eb01e2630a7a6b43171424f767eb53c4f26de4
- lib/tarifario/filtrosPostCarga.ts: 43745ecb91c61353e3dc476a49b61ae6a8e71f6a
- lib/tarifario/resumen.ts: 1b578118d5547358dd6a843510d2a27ee9c84f9d
- pruebas/filtrosPostCarga.test.ts: 0909f2978fd8b9c3bc62fadf41dd2e2cfbb6646a
- lib/reservar/salidaDinamicaVigente.ts: add79acd01b54d187b0e491a379a880d48e171dc
- pruebas/salidaDinamicaVigencia62.test.ts: bbac3c7dc7600e5bb0891b2cfca9cad7f009d189
- pruebas/salidaDinamicaFlujos62.test.ts: 37a79bebf994255d5d72e4b663fc7ee50757afbc

### Gate y limites

Lista para que Coordinador lea y decida GO al dueno para preparar PR de #62. No otra ampliacion local ni migracion requerida por este diff. Tras integracion, tarjetas debe conciliar computo sobre #62; #63 se basa en main ya integrado. #50/#60/#61 intactos. Dinamico en SalesBot NO se habilita automaticamente por este veredicto.

No se verifico configuracion real de llave de servicio Vercel: afirmacion de que siempre esta en Produccion corresponde al ejecutor, no evidencia independiente de Chat #4. Sin ese cliente la carga devuelve error tecnico deliberadamente, no disponibilidad parcial. Aun requiere smoke humano con fuentes reales despues del despliegue autorizado; no crear contratos/pagos artificiales en Produccion. El cierre del alcance #62 no garantiza atomicidad futura de precio/fuente de #63.

Chat #4 solo audito y actualizo esta bitacora; sin codigo, worktree, staging, commit, push, PR, merge ni SQL remoto. No declara #62 listo para Produccion ni #63 autorizado.

---

## Historico - auditoria previa de #62 y diseno #63

# Chat #4 - Hotfixes

## Estado vigente - #62 auditoria entrega local, 2026-10-20

**Veredicto: CON CORRECCIONES / NO GO de PR.** Las seis rutas reservadas respetadas; guardas de venta y helper revisados sin defecto bloqueante nuevo identificado. Ejecutadas personalmente 61/61 focales sin omitidas. Falta cerrar la vitrina REAL y ejecutar generarTarifario real en prueba. El mapa inicial de seis rutas propuesto por Chat #4 no cubria filtrosPostCarga; es una omision del alcance de auditoria inicial, no incumplimiento del ejecutor, que paro y la reporto sin editar fuera de reserva.

### Verificado personalmente

Worktree C:\Users\Asus\Documents\DspaciosMayorista\.claude\worktrees\salida-dinamica-62, rama codex/62-salida-dinamica-vigente. HEAD = origin/main LOCAL = ecae767880b06e880d2e836c1e052c79801bf935. Tres archivos modificados y tres nuevos exactos del alcance, nada en staging; git diff --check limpio sobre tracked. Leidos diff real y helper nuevo, pruebas/filtros/call sites relevantes. Sin escrituras de codigo por Chat #4.

Ejecucion independiente desde dspacios-travel del worktree:
node --test --experimental-strip-types --experimental-test-module-mocks --experimental-loader ./pruebas/support/aliasLoader.mjs pruebas/salidaDinamicaVigencia62.test.ts pruebas/salidaDinamicaFlujos62.test.ts
**61 tests, 15 suites, 61 pass, 0 fail/cancelled/skipped/todo; salida 0; ~24,3 s.** Incluye computarReserva y cargarDatosTarifario reales con mocks, ayuda de generacion y cuatro pruebas de cableado de actions. No constituye ejecucion de generarTarifario ni de vitrina real.

Revision helper: activo estricto, ida con formato ISO y no pasada, compra inclusiva Bogota, fila ausente/error rechazan. Validacion ISO es de formato, no calendario general; BD date ya impone fechas validas, no se pide ampliar para datos imposibles de BD. Cliente admin solo para lectura de campos minimos de vigencia; no devuelve fila privilegiada al navegador. Politica 094: roles superadmin/gerencia/administracion/operaciones; usar cliente de sesion bloquearia venta/B2B/publico por fila invisible. Usar admin para esta guarda es compatible con el servidor actual, sin SQL nuevo. La guarda no sustituye seleccion de tarifa publica/paquete ni autorizacion de venta.

Huellas auditadas de archivos nuevos:
- salidaDinamicaVigente.ts: add79acd01b54d187b0e491a379a880d48e171dc
- salidaDinamicaVigencia62.test.ts: bbac3c7dc7600e5bb0891b2cfca9cad7f009d189
- salidaDinamicaFlujos62.test.ts: 88f114abc46157eed023d4047d39054f8607fa2e

### Hallazgos / alcance a aprobar por el Coordinador

P1 - OFERTA CADUCA SIGUE VISIBLE EN VITRINA REAL. lib/tarifario/filtrosPostCarga.ts:38-83 no consulta salidas_dinamicas; solo fecha cacheada, hotel y empaquetado. resumen.ts:313 y detalle-actions.ts:139,302 llaman ese filtro. Confirmado por busqueda de referencias que cargarDatosTarifario es definicion/uso de pruebas y no llamada de produccion en rutas inspeccionadas. Nuevo filtro en datos.ts es correcto para su funcion, pero no basta para #62. salida_id YA existe en COLUMNAS_RESUMEN/resumen y detalle: no hace falta SQL ni cambiar proyeccion de esquema.

Solicitud cerrada de ampliacion al MISMO ejecutor, solo tras aprobacion del Coordinador:
1 lib/tarifario/filtrosPostCarga.ts: FilaFiltrable incluye salida_id; reutilizar salidasDinamicasVigentes, ocultar inactiva/vencida/futura/eliminada/error y sin admin. Mantener no-dinamicas y filtro de empaquetados/hotel. Agregar errorSalida independiente, no fingir error de hotel/empaquetado.
2 pruebas/filtrosPostCarga.test.ts: pruebas reales de filtro vigente/inactivo/compra futura/vencida/borrado/error/sin admin y mezcla de filas, sin borrar regresiones existentes.
3 lib/tarifario/resumen.ts: consumir errorSalida en huboErrorFiltros y observabilidad, preservando contrato actual fail-closed de carga ante error tecnico. No editar precios ni UI.
4 app/tarifario/detalle-actions.ts: consumir errorSalida donde maneja errorVigencia/errorEmpaquetado (dos caminos), devolver mensaje publico existente de error tecnico, no ok/vacio por consulta fallida. No cambiar filtros/combos ajenos.

Las dos rutas extra respecto a lo solicitado por ejecutor son NECESARIAS para preservar el contrato de error que ya tienen resumen/detalle. Ambos hoy comprueban solamente errorVigencia/errorEmpaquetado; agregar nueva consulta fallible sin propagar su error disfrazaria fallo tecnico de no_disponibilidad. No se autoriza esta ampliacion unilateralmente desde Chat #4. Pruebas de consumidores nuevos pueden extender salidaDinamicaFlujos62.test.ts ya reservado, sin mas archivos. Test del filtro aislado no reemplaza resumen/detalle real. No se pide SQL ni permisos.

P2 - GENERAR TARIFARIO REAL AUN NO EJECUTADO EN PRUEBAS. salidaDinamicaFlujos62.test.ts:390-462 ejecuta seleccionarSalidasVigentes y cuatro regex; no comprueba secuencia RPC generacion/publicacion ni que error de lectura impida publicar. Mantener helper tests como unitarias, pero agregar prueba del actions real: registro local ESM dentro del test ya reservado para resolver next/cache -> next/cache.js ANTES de import dinamico, y mock de cache/server/DB. Precedente existente callbackDestinoSeguro.test.ts usa register(data URL) para next/server; por ello NO se necesita pedir editar aliasLoader.mjs como primera opcion. No se ha probado ese arnes nuevo en esta auditoria: ejecutor debe validarlo, reportar otra dependencia concreta si falla, no ampliar loader global a ciegas. No require generar tarifario contra BD real ni tocar loader/package. Capturar RPCs: vigente publica solo elegibles; vencidas no se incluyen; error de consulta no publica y deja estado de fallo correcto. No borrar los casos existentes para ocultar fallos.

### Reportado por ejecutor, no repetido o contrastado por Chat #4

- Rojo base: 26 pruebas, 10 pass/16 fail; log scratchpad sin ruta completa en la entrega. No se reviso log de rojo ni se restauraron archivos del worktree por Chat #4.
- Verde focal 61/61 si reproducido personalmente arriba.
- Regresion acotada: 46 archivos existentes, 1676 tests sin fallos/omitidas, salida 0. No revisado log ni ejecutada esa bateria por Chat #4.
- Build pnpm run build tras ultimo cambio, salida 0 (compilacion ~2,3 min, TypeScript ~5,9 min, 16/16 paginas); unica advertencia pnpm.onlyBuiltDependencies. No se recibio ruta completa del log, no se inspecciono ni reejecuto build. Pedir log revisable en entrega siguiente; repetir build cuando cambie codigo de vitrina/consumidores, no ahora sin cambios.
- Instalacion pnpm frozen lockfile sin cambios: reportada. Git no muestra lockfile/manifiestos modificados. Espacios de untracked revisados por ejecutor; diff check tracked ejecutado personalmente.
- Sonda filtro real deja una fila invalida visible: reportada y compatible con fuente leida, no reejecutada aqui. El hallazgo P1 no depende de asumir ejecutada esa sonda por Chat #4.

### Proximo gate y prompt de correccion a preparar tras autorizacion

Coordinador debe aprobar 4 rutas adicionales exactas (total 10 rutas de alcance), mismo ejecutor/worktree/base, sin duplicar agente ni tomar codigo desde Chat #4. Mantener seis rutas originales; no hacer refactor de cargarDatosTarifario fuera de lo necesario. Generador real se prueba dentro del archivo nuevo existente, sin loader compartido. Si hace falta algo mas, presentar causa antes de ampliar.

Ejecutar focales originales + filtrosPostCarga.test.ts y pruebas reales de resumen/detalle/generador incluidas, regresion pertinente por nuevas rutas, build una vez despues del ultimo cambio y diff check/status/staging. Entregar diff incremental, log completo con rutas revisables, rojo/verde de vitrina/generador, conteos sin omitidas, base/hashes finales y limites. Conservar orden con tarjetas/compute servicios y #62 -> #63; Dinamico SalesBot sigue sin GO.

No reabrir BNC/precio/monedas/infantes #63 ni #50/#60/#61 en esta correccion. No es GO de publicacion; gate final requiere ver corregido camino de produccion y errores propagados. Solo esta bitacora actualizada; sin codigo, worktrees, staging, commit, push, PR ni SQL remoto.

---

## Historico - diseno y autorizaciones previas

# Chat #4 - Hotfixes

## Estado vigente - #62 prompt final / #63 lectura autorizada, 2026-10-19

Recibido del dueno el adjunto 4d9bbbdd-0306-46b7-9355-d70a59273c2b/Texto pegado.txt: confirma base y seis rutas de #62, solicita prompt final y autoriza lectura tecnica acotada #63. El GO LOCAL #62 del texto esta condicionado a designacion del ejecutor unico por el dueno. No se designo ni lanzo uno desde este chat. #63 permanece sin GO de implementacion/worktree/migracion. Solo se actualiza bitacora.

### #62: prompt final emitido al dueno

Unico ejecutor a designar por el dueno. Worktree propuesto .claude/worktrees/salida-dinamica-62, rama codex/62-salida-dinamica-vigente, desde origin/main verificado. Base conocida local ecae767880b06e880d2e836c1e052c79801bf935, no checkout principal 9e4d1322. Fetch autorizado por el texto recibido al ejecutor, no realizado por Chat #4. Si base avanza, comprobar cruces antes de ramificar; cambio en seis rutas = parar y avisar; base no cruzada puede usarse dejando hash y evidencia al auditor. No mover main ni cambios ajenos.

Seis rutas exclusivas: app/(dashboard)/dashboard/paquetes/actions.ts; lib/tarifario/datos.ts; lib/reservar/computo.ts; NUEVO lib/reservar/salidaDinamicaVigente.ts; NUEVO pruebas/salidaDinamicaVigencia62.test.ts; NUEVO pruebas/salidaDinamicaFlujos62.test.ts. No SQL/migracion/manifiestos. Crear helper real de estado/ventana/viaje/error y reutilizar en tres consumidores, primero prueba roja. No convertir fallo de lectura o fila invisible a activa; no confundir codigo de error con resultado vacio. Sin cambios de precio, BNC, CxP, servicios ni promociones #63.

Matriz: salida activa vigente; ventana futura/vencida e inclusiva Bogota/cambio de dia; viaje pasado; desactivacion o borrado DESPUES de publicar; error/fila invisible; tarifario viejo no ofrecido, computo rechaza sin escrituras; caminos reales de generacion/cargador/computo bajo mocks, no solo regex. Una fuente correcta no puede desaparecer por un mock incompleto; regresion de manual y empaquetado directo. Ejecutar pruebas por glob unitario ya existente con aliasLoader, comando focal para los dos archivos; pnpm run build una vez despues del diff final (incluye TS), diff check/status/staging. No bateria amplia automatica ni tsc duplicado si build lo cubre.

Cruce tarjetas informado en adjunto (no revalidado por Chat #4): worktree tarifario-tarjetas-servicios fa4e5324 modifica computo en servicios. Orden #62 -> tarjetas. Antes de empezar y antes de entrega verificar refs locales; si tarjetas entra primero o otro agente cambia base compartida, NO integrar su worktree ni arreglar servicios: informar hash/diff/rangos al Coordinador, pedir orden/conciliacion concreta, preservando cambios. No deducir autorizacion para editar otro worktree porque hunks esten lejos.

Criterio gate: evidencia roja antes/verde despues, todas las focales sin fallos/omitidas, build 0 o fallo ajeno documentado (no aprobarlo automaticamente), diff limitado a seis rutas, diff check limpio, nada staged, hash/base final/cambios/limites entregados a Chat #4. Si requiere permisos/SQL/rutas adicionales, detener solo punto bloqueado y devolver evidencia al Coordinador. Sin staging/commit/push/PR/SQL remoto; #63 despues de integracion #62 por el dueno.

### #63: lectura adicional y operacion concreta propuesta

Lectura de origen origin/main ecae7678 en los siete archivos autorizados y migracion 181. Alcance adicional presentado en comentario: financieroContrato.ts y RPCs financieras 171/172/210 (solo tramos relevantes). Una busqueda rg con comodin Windows fallo por expansion de shell, corregida con rg --files/-g; no se tomo como ausencia de archivos. Sin lectura de secretos ni prueba ejecutada.

Evidencia nueva que reduce alcance:
- reservar/actions.ts inserta ventas con financiero_estado=pendiente; errores intentan revertirContratoIncompleto. Al final llama registrarFinancieroContrato.
- lib/reservar/financieroContrato.ts:225-240 persiste previamente costos+CxP en contrato_financiero_pendiente para reintento durable; RPC registrar_financiero_contrato escribe costos/CxP atomicos. Migracion 210 mantiene candado de venta y ya_completo como exito inmutable. No reemplazarla ni debilitarla.
- Pero pendientes se guardan DESPUES de otras escrituras y proveedores/netos de hotel/servicios se leen posteriormente al computo. Reutilizar RPC financiera sin congelar esos datos permitiria mezclar revisiones. Snapshot publico de checkout anula proveedor y no contiene netos; incluidosCotizados verifica huellas antes de convertir, no transaccion de toda venta.
- snapshotCondiciones.ts:220 usa importes de componentes en moneda de cotizacion y TRM de cobro (COP=1); no almacena costes/proveedor. No usarlo para snapshot financiero de armado ni meter netos en JSON publico.

Operacion propuesta en SQL NUEVO, a reservar tras aprobacion de ampliacion:
1. aceptar_oferta_dinamica_63 (nombre conceptual concreto): sesion/tenant y cotizacion/opcion/solicitud autorizados por servidor; recibe referencia a oferta publicada/revision y composicion validada, NO netos del navegador. En UNA transaccion toma candados de configuracion/salida/fuentes con orden determinista, comprueba revision/activo/ventana/TRM/huellas/participantes, bloquea fuente cambiada, y crea un registro PRIVADO e inmutable de intento y snapshot. Unicidad de idempotencia por tenant+operacion origen+grupo y hash de solicitud; mismo reintento devuelve mismo intento, contenido distinto con misma clave rechaza. El snapshot contiene precio/BNC/fees, fechas/tramos, costos y proveedores de TODOS los componentes, conversion USD->COP y revision, no solo aereo. Esto es aceptacion con punto de orden definido: cambios que llegan despues invalidan futuras ofertas, no reescriben un intento aceptado.
2. comenzar_materializacion_63: bloquea intento, genera/asocia UNA cabecera pendiente e identifica numero de contrato en la MISMA transaccion que lo reclama; segunda llamada devuelve la misma. Nunca reservar numero/insertar cabecera desde JS y registrar idempotencia despues. Alta/snapshot de cotizacion se enlaza atomicamente a intento; comparativa necesita intento por opcion con eleccion autorizada por frontera 211, no ofertas hijas autopublicadas. Mantener sellado/alta de personas 219 y autorizacion de tenant.
3. pasos acotados de materializacion: cada operacion de escritura del alcance #63 consume snapshotId y clave de paso, toma candado de intento, verifica estado/digest y hace efecto+marca del paso en la MISMA transaccion. Usar ids/llaves de filas determinados por intento para que respuesta perdida/reintento no duplique pasajeros/tramos/items. No recalcular precio/costo/proveedor con catalogo vivo entre pasos; no permitir marcar paso sin filas reales ni DML directo que altere importe protegido. No afirmar que un check JS mas INSERT cumple esto. No es una RPC gigante del motor: los calculos existentes permanecen TS; SQL implementa aceptacion y escrituras acotadas validadas contra snapshot privado. Exige probar el contrato exacto de cada paso con datos reales del esquema antes de GO completo.
4. finalizar_materializacion_63: con candado de intento comprueba pasos completos, fija payload financiero derivado del MISMO snapshot, y usa puerta financiera vigente en la misma transaccion de finalizacion; no aceptar costos/CxP distintos enviados por cliente. Mantener ya_completo/210 y guardarPendiente/172 para recuperacion con contenido identico. Ningun intento parcial debe devolverse como ok ni admitir pagos como venta lista.
5. Recuperacion: estado preparado/materializando/completo/fallido con error y paso durable, reintento autenticado retoma MISMO snapshot y numero, nunca snapshot nuevo con pasos viejos. Si no se puede retomar, marcar requiere_revision y no crear otro contrato automaticamente. Contrato completo no se revierte por respuesta perdida; fallo de compensacion se registra, no se oculta. Reconciliacion financiera actual solo puede completar su fase tras validar que pasos previos del intento estan listos; de otro modo un worker podria completar finanzas mientras faltan tramos. Si catalogo cambia despues de aceptacion, conservar snapshot aceptado para intento en curso, sin sustituirlo; si interviene indisponibilidad operativa, detener/registrar incidencia sin cambiar historico ni saldo.

Esta operacion es CONTRATO PROPUESTO, no garantia del codigo actual ni autorizacion de nueva puerta financiera. El limite no es solo financiero: encajar RPCs de pasos/sellado 219/211 y reconciliacion exige una ampliacion EXPLICITA de superficies antes de implementacion. No tocar pagos ni #50 ni 198/216/217 por inferencia. Si no cabe sin cambiar esas fronteras, volver al Coordinador con alternativa reducida y no prometer venta #63 terminada.

### BNC: plan ejecutable acotado sin decision nueva

Divergencia confirmada por lectura: generador usa impuesto_tipo=tiquete ? costoTiquete : impuesto_fijo; para empaquetado costoTiquete es reventa. computo.ts:934-943 solo lee impuesto_fijo. Resolver en nuevo componente snapshot #63: BNC por pax con silla = reventa COP si tiquete, fijo configurado si fijo. Guardar regla/importe y lectura por todos los consumidores; no usar tarifa_proveedor ni calcular otra vez desde paquete mutable. Generador, cotizar, checkout y comparativa deben compartir el mismo resultado puro y version; venta agrega por asignacion real de pax, sin BNC de infantes nueva. No fix global de legacy ni #50.

Fixture de pruebas a implementar, NO corrido: hotel+servicios PVP 500.000, reventa 1.130.000, fijo 100.000, neto aereo distinto. Por adulto PVP 1.630.000; tiquete BNC 1.130.000/base 500.000; fijo BNC 100.000/base 1.530.000. Con 2 adultos, multiplicar agregados por dos antes de comision. Capturar outputs de cada consumidor real, no solo comprobar helper ni regex. Probar ambos modos con servicio global, moneda convertida y cambio concurrente de configuracion; legacy no se reinterpreta. Error de lectura de config/snapshot rechaza, no BNC=0.

### Fee unico: demostracion algebraica y fixture

Para 2 adultos+1 infante: R=1.130.000 COP final adulto; N=900.000 COP neto proveedor por adulto (ejemplo tecnico), F=100.000 COP fee infantil (mismo cliente/proveedor). Componente aereo venta = 2R+F = 2.360.000; costo aereo = 2N+F = 1.900.000. Ningun MK/TA de paquete altera R ni F. Doble F daria 2.460.000 y debe fallar; usar R para fila infante tambien debe fallar.

Lugar unico de cobro: pvpPorAcom.infante ya COMPUESTO para #63 con hotel/servicios aplicables + F; computo suma esa fila una sola vez, reservar/checkout itemizan el mismo importe y NO agregan fee fuera del total. Tarifa hotel infante presente H: fila=aporteH+serviciosInfante+F (solo H/servicios llevan su MK segun contrato). Ausente: no inventar neto hotel ni sustituir tarifa adulta; aporteH=0, pero el vuelo F sigue debiendose/cobrandose. Materializar fila infante #63 aunque no haya neto_infante de hotel; si el hotel es Adults Only o impide esa edad, rechazar, no interpretar ausencia como permiso. Usar numInfantes reclasificado por edades del motor para coste y venta; el writer hoy usa input.infantes para costo, por lo que #63 debe consumir snapshot con clasificacion autoritativa, no ese dato crudo. Pruebas H presente/ausente y F=0, MK>0, TA>0, fechas/edades y Adults Only; confirmar costo y precio, no solo JSON renderizado. Este ejemplo es especificacion/prueba pendiente, NO evidencia de ejecucion.

### Mapa y veredicto actualizados

#62 se mantiene GO TECNICO PARA RESERVAR: exactamente seis rutas y cero migracion del prompt anterior. Mismo helper en generar/cargar/computar, integracion #62 -> tarjetas -> #63 segun orden final del Coordinador; si tarjetas no se integra antes #63, conciliar despues sin modificar su worktree.

#63 NO GO de implementacion; se solicita al Coordinador aceptar/ajustar operacion propuesta y AMPLIACION acotada al mapa anterior:
- lib/reservar/financieroContrato.ts: enlazar intento/snapshot en guardar pendiente/finalizar preservando retorno 210.
- lib/reservar/reconciliacionFinanciera.ts: impedir recuperacion financiera adelantada para intentos #63 incompletos y reintentar mismo payload, sin afectar contratos legacy. Este archivo se identifica por dependencia; no se afirma auditado completo en esta ronda.
- NUEVO lib/reservar/aceptacionDinamica63.ts: orquestacion servidor y errores/identidad por intento; sin netos en frontend.
- SQL NUEVO de #63: ledger privado de intento/snapshot+ACL, unicidad/digest, aceptacion, comienzo y pasos/finalizacion, invalidacion/revision y extension de publicacion 181 en una migracion aditiva por reservar. Si se necesita tocar escritura de pasajeros o puertas 211/219 existentes para consumir pasos, debe delimitarse funcion/firma en la reserva antes de GO, nunca editar migraciones existentes ni duplicar alta de personas. No se elige numero ni se pide SQL remoto.
- Pruebas nuevas adicionales propuestas: pruebas/aceptacionDinamica63.test.ts y pruebas/aceptacionDinamica63.pg.ts, incluidas en CI focal propuesto. Matar proceso despues de aceptar, crear cabecera, cada paso, guardarPendiente y llamada financiera; perdida de respuesta y concurrencia de doble clic/fuente/TRM/config; reintentos mismo resultado, sin doble contrato/CxP/fee, financiero ya_completo no borrado, intento incompleto no cobrable y snapshot privado no legible por venta/anon. Regresiones 210/219/211/216/217 pertinentes.

No mover todo el motor a SQL; no afirmar venta atomica por reutilizar solo RPC financiera. No exigir al dueno otra respuesta de negocio. El bloqueo residual es aprobacion del alcance y definicion comprobable de pasos concretos con las puertas vigentes, a cargo del Coordinador/Chat #4 en lectura. El mapa anterior de UI/calculo/catalogo/checkout se mantiene; esta ampliacion es explicita y no esta autorizada para escribir.

Lista para Coordinador: prompt #62 listo para ejecutor designado; contrato #63 con operacion concreta propuesta, BNC y fee fijados, y ampliacion/limite claramente reportados. Sin codigo, worktree nuevo, migracion, pruebas, staging, commit, push, PR ni SQL remoto por Chat #4.

---

## Historico - gates y decisiones previos

# Chat #4 - Hotfixes

## Estado vigente - revision TECNICA focal #62 -> #63, 2026-10-19

**#62: GO TECNICO PARA RESERVAR su fase acotada, condicionado al GO efectivo del Coordinador; no implementado. #63: NO GO TECNICO todavia para reserva de implementacion completa.** Las decisiones del dueno estan cerradas y no se vuelven a preguntar. El bloqueo restante es tecnico: cerrar paridad BNC/infante y frontera transaccional de snapshot/revision frente a conversion/venta/CxP, sin filtrar costos ni ampliar la refactorizacion a #50/#60/#61.

Base verificada: origin/main LOCAL ecae767880b06e880d2e836c1e052c79801bf935 (#42/#368); main/HEAD del checkout principal sigue antiguo y documentos ajenos preservados. Revisiones mediante git show origin/main; sin modificar checkout/worktrees ni consultar red. 219 aplicada 20/20 es confirmacion recibida del Coordinador. No pruebas ejecutadas en esta ronda: evidencia es lectura de codigo/SQL.

### 1. BNC: demostracion y hallazgo que exige prueba de paridad

lib/calc/paquetes.ts:691-707: PVP = redondearVenta(hotel + servicios + vuelo); impuesto/BNC NO se agrega encima; baseComisionable = PVP - impuesto.
paquetes/actions.ts:1081-1089: para empaquetado actual tipo Bloqueo costoTiquete = tarifa_para_empaquetar; impuesto_tipo=tiquete toma EXACTAMENTE ese importe como BNC. impuesto_tipo distinto usa impuesto_fijo. La rama dinamica :1095-1110 hace lo mismo con valor_tiquete. Por tanto para #63 vinculado, aporte aereo final = reventa SIN aporteVuelo(MK/TA), pero BNC tiquete = esa reventa; BNC fijo = configurado. Esto PRESERVA la semantica del GENERADOR vigente y la eleccion del dueno; NO requiere decision comercial nueva. tarifa_proveedor se usa solo para costo/CxP. No inventar BNC=neto financiero.

Ejemplo tecnico, no precio cotizado: hotel+servicios ya marginados=500.000 COP y promocion=1.130.000 -> PVP=1.630.000. Tiquete: BNC=1.130.000, base=500.000. Fijo configurado 100.000: BNC=100.000, base=1.530.000. No sumar otra vez la BNC al PVP.

DIVERGENCIA por lectura EN LA BASE POST #42: lib/reservar/computo.ts:934-943 lee SOLO impuesto_fijo y multiplica por paxConSilla; no consulta impuesto_tipo ni la BNC de fila. reservar/actions.ts:247,313 consume impuestoTotal para comision/venta. Asi que conservar el generador sin corregir el contrato de consumo de #63 no conserva la BNC de extremo a extremo. No se demostro en Produccion y no se etiqueta como regresion introducida por #63. Propuesta acotada: resolver BNC por salida #63 desde snapshot/revision autoritativos con tipo/fijo/importe aereo, no desde datos de cliente ni fallback 0; probar paridad tarifario/cotizar/checkout/comparativa/venta. NO arreglar globalmente comisiones antiguas ni absorber #50/#60/#61. Legacy conserva ruta existente hasta asignacion separada; documentar limitacion con claridad.

Infantes: computo.ts cobra pvpPorAcom.infante, y reservar/actions.ts:237 suma fee_infante al costo; la fila infante del generador recibe el mismo aporteVueloVal que las demas acomodaciones. No basta sumar fee despues: #63 debe construir componente aereo infante = fee final, no tiquete adulto, conservando parte hotel/servicios aplicable y edades reales. Seleccionar UNA ubicacion de cobro (recomendado fila infante ya compuesta) y no cargo adicional. Fee mismo importe al cliente/proveedor, cero segundo MK/TA. Prueba con 2 adultos+1 infante y hotel infante presente/ausente para demostrar una sola suma. BNC actual multiplica paxConSilla, no se extiende a infantes por inferencia; preservar ese criterio y mostrarlo en pruebas.

### 2. Invalidacion/reconfirmacion: contrato cerrado propuesto

Revision de oferta depende de paquete/configuracion (MK, TA de manuales, impuestos, hoteles/servicios, destino), TRM, salida manual, fuente enlazada (vuelo/fechas/reventa/neto/proveedor/fee/estado/compra), y tarifas hotel/servicios usadas. Cambio material incrementa revision para paquetes vinculados y marca pendiente. No incorporar nuevas promociones ni regenerar/publicar automaticamente #63. Datos iguales no requieren cambio material; criterio debe ser determinista.

- Vitrina/carrito/borrador sin aceptacion: ocultar/no aceptar revision vencida. Mostrar necesita revision/regeneracion; al regenerar precio/fechas nuevos requieren reconfirmacion explicita, no sustitucion silenciosa. Payload cliente solo ids/revision publica, servidor resuelve datos reales. El selector multiple no vende ni crea CxP.
- Cotizacion sin pago: no sobrescribir automaticamente documento anterior; reliquidar al intentar confirmar/convertir. Si cambia revision/precio/itinerario, rechazar y solicitar nueva cotizacion/reconfirmacion por flujo existente. Sin editar pagos, titular/personas #42 o historicos por efecto de fuente.
- Cotizacion congelada por pago y contrato: precio, TRM aceptada, composicion y snapshot inmutables; no revalorar ni actualizar proveedor/costo historico al cambiar catalogo. Si ya no se puede cumplir la fuente, incidencia operativa explicita; no convertir una cotizacion a vuelo alternativo ni crear nuevo costo con precio historico sin autorizacion y flujo propio. No reabrir pagos/conversiones 164/198/211/216/217/219.
- Cambio concurrente al aceptar: revision debe comprobarse en la MISMA frontera de escritura/finalizacion, no solo al iniciar computo. Una lectura previa y otra previa no eliminan la carrera entre segundo check y escritura. Una firma en browser tampoco sustituye este control.

### 3. Publicacion atomica y trazabilidad sin exposicion

Evidencia: migracion 181, publicar_tarifario_resultado: bloquea armado_paquetes FOR UPDATE (:708-723), compara generacion y revision, valida lote y persiste filas con moneda p_moneda y estado/moneda paquete en transaccion. paquetes/actions.ts:1198-1205 usa ese RPC. Extender esta puerta EN UNA NUEVA migracion, sin editar 181 ni crear publicacion paralela. Snapshot/huella fuente, modo de precio, TRM y revision del lote deben publicarse juntos o nada. Actualizacion de fuente/TRM/config necesita invalidacion en BD; solo triggers de UI no cubren DML directo.

Propuesta de persistencia minima: referencia nullable fuente en salidas_dinamicas, unicidad parcial (paquete_id,empaquetado_id), moneda COP explicita en empaquetados actuales segun decision del dueno y restriccion a COP para este alcance, TRM de armado/revision en configuracion, snapshot PRIVADO por oferta/salida/revision de componentes y costo/proveedor/moneda/fee. Ubicar costo/proveedor fuera de tarifario_resultado, payload y detalle legibles al rol venta/anon. El checkout existente (:748-756 aprox.) ya usa huellas de incluidos sin costo/proveedor en payload; #63 debe mantener esa frontera. Tabla privada/ACL y acceso mediante servidor/RPC autorizado, con pruebas REST/GraphQL por rol. FK no debe borrar snapshots historicos en cascada.

El snapshot privado conserva costo neto y moneda de origen, PVP final o neto+MK, TRM de armado, equivalente COP, ids de proveedor y revision aceptada. Costo aereo = neto proveedor x pax con silla + fee x infantes; precio aereo = reventa x pax con silla + fee x infantes. Las otras lineas usan neto convertido antes de MK. En venta COP no reutilizar TRM de cobro para convertir otra vez; deuda USD al proveedor conserva moneda original y equivalente contable trazable. Cotizacion aceptada no puede mostrar revision A y crear CxP de revision B.

BLOQUEO TECNICO concreto #63: reservar/actions.ts obtiene resolverDatosVuelo con lectura viva, crea contrato/venta/tramos e items en llamadas separadas; computo usa tarifa cacheada. No se ha demostrado una frontera unica existente capaz de mantener revision aceptada y CxP coherentes durante TODA finalizacion. Una CAS al publicar tarifario no hace atomica la venta. Antes de reservar implementacion completa, falta fijar la operacion concreta que asegura snapshot inmutable/revision aceptada antes del primer efecto y su consumo idempotente en cada write, mas rechazo/recuperacion de intentos parciales. No se prescribe migrar todo el motor a una RPC gigante ni tocar finanzas #50 por inferencia. Hacer lectura tecnica acotada de esa puerta y su contrato de compensacion/idempotencia; si requiere ampliar superficies, Coordinador decide alcance antes del GO.

### 4. Mapa cerrado minimo por fase y gates

#62 - PROPUESTA LISTA PARA RESERVA, sin SQL previsto:
1 app/(dashboard)/dashboard/paquetes/actions.ts
2 lib/tarifario/datos.ts
3 lib/reservar/computo.ts
4 NUEVO lib/reservar/salidaDinamicaVigente.ts
5 NUEVO pruebas/salidaDinamicaVigencia62.test.ts
6 NUEVO pruebas/salidaDinamicaFlujos62.test.ts
Objetivo solo estado/compra/fechas/error de salida manual en generar/cargar/computar. Prueba roja de vencida/inactiva post-publicacion, limites inclusivos Bogota, fila invisible/error, no escritura y manual vigente. Mocks ejecutan consumidores, no solo regex. Si no hay acceso al activo con rol actual, fallo cerrado y devolver bloqueo de permisos al Coordinador, no meter SQL autonomamente. Regresion empaquetado directo. Auditoria y gate propio -> usuario integra -> #63 se concilia sobre nuevo main. No habilitar Dinamico SalesBot solo por filtros del bot.

#63 - mapa cerrado FUNCIONAL ya propuesto, NO reserva efectiva mientras falte frontera de finalizacion:
A UI/catalogo: paquetes/[id]/{SalidasDinamicasEditor.tsx,page.tsx,ArmadoClient.tsx}, paquetes/ConfigForm.tsx, paquetes/actions.ts; vuelos/empaquetados-actions.ts, vuelos/empaquetados/{NuevoEmpaquetadoForm.tsx,[id]/EditarEmpaquetadoForm.tsx}. Prefijo de todas: app/(dashboard)/dashboard/.
B calculo/fuente: lib/calc/paquetes.ts; NUEVO lib/reservar/promocionDinamica.ts; helper vigencia #62; lib/reservar/{computo.ts,empaquetadoOrigen.ts,incluidosCotizados.ts}; lib/tarifario/datos.ts.
C aceptar/escribir: app/tarifario/checkout/actions.ts; app/(dashboard)/dashboard/reservar/actions.ts. Conservar #42/219 altas de personas y sus errores/idempotencia.
D persistencia: types/database.ts (solo secciones), UNA NUEVA migracion a reservar para referencia/unicidad/moneda/TRM/snapshot privado/invalidacion/extension RPC de publicacion; preflight/postcheck/arnes transaccional y .github/workflows/test-promociones-dinamicas-63.yml. La operacion concreta para finalizacion de venta sigue pendiente segun bloqueo anterior; no afirmar mapa SQL ejecutable completo hasta cerrarla. No usar 218 ni 219 ni renumerar nada vigente.
E pruebas nuevas: promocionDinamica63.test.ts, promocionDinamica63.react.ts, promocionDinamicaFlujos63.test.ts, promocionDinamica63.pg.ts bajo pruebas/. Sin package.json/lockfile. No tocar CartContext/VistaBooking, payload neto en cliente ni discriminante origen (sigue salidaId). Si la frontera final exige archivo adicional, volver a reserva en vez de ampliacion implicita.

Pruebas #63 exigidas: N fuentes/deduplicacion doble clic/concurrencia; nuevas pendientes; destino/moneda/rol; fuente/TRM/config cambiadas antes/durante publicar y antes/durante aceptar; PVP final sin MK/TA duplicado; neto USD x TRM antes MK y redondeo COP; BNC tiquete/fijo en generador y todos consumidores; adulto/nino/infante sin doble fee ni tarifa adulta al infante; servicios globales en todos modos una vez; CxP neta/proveedor/moneda correctos con snapshot de MISMA revision; conversion/reintento/fracaso parcial sin duplicacion; congelados inmutables; venta sin acceso a snapshots privados; RLS/ACL/DML directo en CI; regresiones #42/219 y fronteras 216/217 pertinentes. Build TS al ultimo diff y diff check. No se declaran corridas por existir este plan.

### Decisiones y siguiente entrega

GO tecnico #62 para que Coordinador reserve y autorice a un ejecutor unico; esto NO inicia codigo. NO GO #63 hasta cerrar la frontera de aceptacion/venta y reproducir paridad BNC/infante en un plan ejecutable acotado; no hay otra pregunta de negocio. El Coordinador puede autorizar solo esa lectura tecnica adicional sin habilitar implementacion. #50 sigue en su chat; #60/#61 separados. #42 no es bloqueo pendiente: usar su codigo integrado de ecae7678 y no editar su worktree.

Solo actualizada esta bitacora. Sin codigo, SQL remoto, staging, commit, push, PR ni creacion de worktree. Lista para lectura del Coordinador.

---

## Historico - decisiones y disenos previos

# Chat #4 - Hotfixes

## Estado vigente - #63, decisiones directas del dueno cerradas, 2026-10-19

**Las tres consultas de negocio pendientes quedan respondidas directamente por el dueno en este chat. NO constituyen GO de codigo, reserva de archivos ni SQL.** El Coordinador debe revisar el contrato tecnico y liberar la secuencia #62 -> #63 cuando corresponda. #50 queda fuera del carril; no absorber #60/#61.

1. MONEDA: el dueno confirma que TODAS las promociones actuales de Empaquetados estan en COP. Por ahora solo se admiten promociones aereas COP; prever moneda explicita en el modelo para futuro USD, sin habilitarlo ahora. Esta confirmacion elimina la necesidad de pedir revision individual de moneda de las actuales; cualquier marcado de legacy como COP requiere migracion/GO propio, no se ejecuto backfill. Hoteles/servicios USD siguen requiriendo TRM de armado por paquete para convertir netos a COP y publicar COP, conforme decision anterior.
2. IMPUESTO/BNC: respuesta directa los establecidos en la creacion del paquete. Conservar seleccion y parametros existentes; no inventar otra regla fiscal ni reemplazarlos por decision del implementador. En modo impuesto_tipo=tiquete, propuesta tecnica coherente con esa opcion: usar el aporte aereo de venta correspondiente a la salida (tarifa_para_empaquetar final COP en la promocion), manteniendo impuesto fijo cuando fue elegido; tarifa_proveedor sigue siendo coste/CxP y no redefine BNC. La respuesta del dueno no menciono expresamente esos nombres de columna: esta correspondencia es propuesta tecnica a revisar por el Coordinador, no una nueva decision literal atribuida al dueno.
3. FEE INFANTES: a la pregunta explicita sobre si el fee registrado es importe al cliente o coste del proveedor, el dueno responde ambas cosas. Por tanto, para promocion COP, ese mismo importe es coste por infante para CxP y precio cobrado por infante al cliente: sin segundo MK/TA ni doble cargo. Costo aereo total = tarifa_proveedor x pax con silla + fee_infante x infantes; aporte aereo de venta = tarifa_para_empaquetar x pax con silla + fee_infante x infantes, sujeto a las reglas de edades/distribucion ya vigentes. No aplicar fee simultaneamente en fila infante del tarifario y en cargo adicional. Estas formulas describen el contrato de componentes, no autorizan saltarse redondeo/impuesto configurado ni alterar la liquidacion de otros componentes de los infantes.
4. TRASLADOS/TOURS: el dueno confirma SI al contrato propuesto: NETO de catalogo sujeto a MK; conservar incluido/opcional, persona/grupo, liquidacion por estancia/dia/noche. Globales para todas las salidas, reutilizar armado_servicios, sin duplicar asociaciones ni cobros. La reventa final sin segundo margen aplica a la promocion AEREA y no se propaga a servicios.

### Gate y siguiente accion del Coordinador

Ya no se deben volver a preguntar moneda legacy, neto de servicios o doble naturaleza del fee. Conservadas decisiones anteriores: varias promociones por paquete con salida propia, altas manuales, deduplicacion por paquete/fuente, nuevas solo pendientes y agregadas por accion expresa, TRM por paquete para mezcla de componentes y salida COP. El mapa de reservas y pruebas #62 -> #63 esta en la nota inmediatamente anterior.

Queda revision TECNICA del Coordinador sobre correspondencia de BNC con configuracion existente, invalidacion/reconfirmacion por fuente o TRM cambiadas, snapshot/CxP y persistencia atomica; aceptar la propuesta de fuente cambiada o devolver ajuste concreto. Despues, confirmar base main vigente y reservas/ejecutor/migracion antes de emitir GO. No se interpreta la respuesta a preguntas de negocio como permiso para implementar. Pruebas especificas deben demostrar fee cobrado una vez y coste una vez, tarifa aerea final sin segundo margen, opcion impuesto fijo/tiquete preservada, servicios con su MK y monedas COP/USD convertidas una vez.

Solo se actualizo esta bitacora. Sin codigo, worktree, pruebas, SQL remoto, staging, commit, push ni PR. Lista para que el Coordinador lea las decisiones confirmadas.

---

## Historico - secuencia y contrato tecnico previos

# Chat #4 - Hotfixes

## Estado vigente - #62 -> #63, decisiones minimas y propuesta final de reserva, 2026-10-19

**NO GO de codigo vigente.** Continuan solo diseno y bitacora. #50 permanece fuera de este carril; #60/#61 no se absorben. Esta nota sustituye el bloqueo de escritura simultanea con #42 de la ronda anterior: #42 ya se integro, ahora corresponde conciliar con su resultado.

### Base comprobada y fuentes

Verificado sin red: origin/main LOCAL = ecae767880b06e880d2e836c1e052c79801bf935, commit feat: registrar personas de cotizaciones en CRM #42 (#368). HEAD/main del checkout principal siguen 9e4d1322 con documentos ajenos modificados; no se avanzaron ni editaron. CURRENT_GOAL.md local conserva descripcion antigua del Draft #368: prevalece para este hecho la actualizacion expresa del Coordinador y el commit visible. Aplicacion 219 y postcheck 20/20 son confirmacion del Coordinador, no SQL ejecutado/verificado por Chat #4.

Contrastado diff 9e4d1322..origin/main en computo.ts, reservar/actions.ts, checkout/actions.ts y types/database.ts (+121/-9 conjunto). Lectura puntual del codigo de origin/main confirma altas/referencias de personas en reservar y su integracion; no se repitio auditoria de #42. Cualquier worktree #62 debe partir de origin/main vigente comprobado al GO; #63 parte del main que ya integre #62. No copiar checkout principal ni continuar sobre 9e4d1322.

### Minimo que debe decidir el dueno: tres respuestas agrupadas

1. MONEDA FUENTE LEGACY: confirmar si TODAS las promociones antiguas elegibles tienen reventa, neto y fee en COP, o si hay excepciones que deben revisarse por registro. Propuesta: campo moneda explicita obligatorio para nuevas, revision individual para legacy no acreditadas, sin backfill COP global por el ejemplo. La direccion TRM ya esta decidida (COP por USD por paquete, salida COP en mezcla): no volver a preguntarla. Persistirla y validarla es responsabilidad tecnica.
2. BNC + INFANTES: cuando impuesto_tipo=tiquete, indicar si BNC corresponde a tarifa_proveedor neta o tarifa_para_empaquetar final de la promocion. Confirmar si fee_infante de promocion es SOLO costo al proveedor o tambien precio final al cliente, y cual es cada importe si difieren. Mantener moneda de esos importes explicita. Son decisiones comerciales que el codigo no puede deducir de la palabra tarifa ni de la frase sobre MK. No alterar otras reglas de impuesto fijo/comision sin decision.
3. TRASLADOS/TOURS: confirmar que se reutiliza el contrato actual de catalogo como NETO sujeto a MK, conservando incluido/opcional, persona/grupo y liquidacion por estancia/dia/noche. Recomendacion: SI. Si el dueno los quiere a precio final, eso cambia el modelo y requiere otro modo expreso; la decision de reventa final del aereo NO se extiende a ellos.

No hace falta abrir mas preguntas de negocio para elegir nombre del campo, indice, snapshot o helper. Para fuente cambiada se propone regla segura concreta: salida ofertada invalidada hasta revision/regeneracion explicita; cambio de precio/fecha/TRM exige reconfirmar antes de aceptar nueva venta, nunca ajuste silencioso. Mantener documentos y pagos congelados intactos; si ya no se puede cumplir el vuelo, bloquear nueva conversion/venta e informar incidencia, no cambiar de vuelo ni precio ni modificar el historico. El Coordinador puede aprobar esta regla con el contrato; si el dueno desea otra politica, especificarla antes del GO. No se solicita nuevamente decisiones ya cerradas (multiples fuentes, servicios globales, sin segundo MK/TA, pendientes sin autopublicacion).

### Secuencia concreta propuesta

G0 - Coordinador cierra las tres respuestas, acepta regla de cambio de fuente, verifica main vigente y reserva a UN ejecutor y Chat #4 auditor. No crear worktree ni elegir migracion por este documento. Reserva a continuacion es solicitud cerrada, no una reserva efectuada.

G1 - #62 primero: reproducir con fuente manual existente activa fuera de ventana e inactiva despues de generar. Corregir solo elegibilidad comun de salida dinamica (existencia/activo/compra/viaje y fallo de lectura) al generar, cargar y computar venta. No precio mixto, promociones, CxP nueva ni cambios #60/#61. Un helper comun evita tres reglas divergentes. Si la reproduccion no demuestra fallo, registrar resultado y no implementar correccion hipotetica. Auditoria focal, pruebas y gate propio antes de integrar #62 por el dueno. No cambiar historicos.

G2 - #63 sobre main con #62 integrado: mismo ejecutor si el Coordinador lo elige, en rama/worktree independiente desde esa base. Primero persistencia aditiva/moneda/TRM y resolver precio-vigencia; luego generacion/publicacion atomica y editor multiple; despues cargador/checkout/cotizacion/reserva/CxP y snapshots. Aunque el orden interno se divida en commits futuros, no publicar una UI que prometa vinculo antes de completar el servidor. ACL/RLS y compatibilidad de filas legacy probadas en CI desechable. Migracion y despliegue tienen GO separados del dueno; ningun SQL remoto por Chat #4.

G3 - Gate tecnico de #63: precio/tarifa/revision unica en todos los caminos, pruebas de monedas y CxP, conservacion del registro de personas #42, sin regresion manual/legacy ni cambios congelados. Auditoria Chat #4 -> Coordinador -> usuario para Git/PR. Dinamico en #56 sigue cerrado hasta estos gates; #50 continua su secuencia propia, no se le entrega escritura a este carril.

### Mapa final PROPUESTO para reserva de #62 (rutas relativas a dspacios-travel)

Codigo existente:
- app/(dashboard)/dashboard/paquetes/actions.ts: filtro vigente antes de generar filas dinamicas.
- lib/tarifario/datos.ts: consulta/filtrado vivo por salida_id, fallo cerrado.
- lib/reservar/computo.ts: misma validacion antes de producir cotizacion/venta.
Codigo nuevo propuesto:
- lib/reservar/salidaDinamicaVigente.ts: resolver unico de elegibilidad, fecha Bogota y errores.
Pruebas nuevas propuestas:
- pruebas/salidaDinamicaVigencia62.test.ts (limites/zonahoraria/errores).
- pruebas/salidaDinamicaFlujos62.test.ts (generar/cargar/computar con mocks reales de sus entradas; handler/motor, no solo regex).
Sin cambio de esquema previsto para #62. Si la lectura de permisos reales demuestra que requiere SQL, volver al Coordinador; no ampliar por inferencia.

### Mapa final PROPUESTO para reserva de #63 (despues de #62)

Armado/catalogo/configuracion:
- app/(dashboard)/dashboard/paquetes/[id]/SalidasDinamicasEditor.tsx: manual/Desde promocion, multiple, pendientes, vinculo visible.
- app/(dashboard)/dashboard/paquetes/[id]/page.tsx: candidatos autorizados por destino, moneda salida explicita.
- app/(dashboard)/dashboard/paquetes/[id]/ArmadoClient.tsx: categorias globales Traslados/Tours reutilizando armado_servicios, sin segunda asociacion.
- app/(dashboard)/dashboard/paquetes/ConfigForm.tsx: TRM/modo COP mixto y estado pendiente de regeneracion.
- app/(dashboard)/dashboard/paquetes/actions.ts: validacion fuente/idempotencia, guardar vs publicar, calculo/persistencia atomica con revision.
- app/(dashboard)/dashboard/vuelos/empaquetados-actions.ts y vuelos/empaquetados/{NuevoEmpaquetadoForm.tsx,[id]/EditarEmpaquetadoForm.tsx}: moneda explicita y validada, sin inferencia historica. Las dos ultimas rutas se entienden bajo app/(dashboard)/dashboard/.
Motor/resolucion/consumo:
- lib/calc/paquetes.ts: conversion de NETOS antes de MK, aporte final aereo separado; no MK al total.
- lib/reservar/promocionDinamica.ts (nuevo propuesto): resolver fuente enlazada, revision y datos privados/costos.
- lib/reservar/salidaDinamicaVigente.ts (ya integrado por #62): ampliacion para validar tambien fuente, sin duplicar vigencia manual.
- lib/reservar/computo.ts y lib/tarifario/datos.ts: moneda salida/revision/eligibilidad unica.
- lib/reservar/empaquetadoOrigen.ts: resolver salida enlazada con proveedor/costo neto de promocion, manteniendo salidaId y cero cupo negociado.
- lib/reservar/incluidosCotizados.ts: costos/moneda de servicios incluidos consistentes con la TRM congelada, sin sumar incluidos dos veces.
- app/tarifario/checkout/actions.ts y app/(dashboard)/dashboard/reservar/actions.ts: snapshots privados, simple/comparativa/conversion, CxP y venta COP sin segunda conversion; preservar #42.
Persistencia:
- types/database.ts: solo secciones/campos de este contrato.
- UNA migracion NUEVA con numero y nombre por reservar por el Coordinador, scripts nuevos preflight/postcheck y arnes CI focal. No editar existentes 214/216/217/219; no usar 218 reservada #56. La migracion debe extender atomicamente el guardado vigente de tarifario/revision si hace falta, no separar publicacion de PVP de moneda/TRM/snapshot en escrituras parciales.
- .github/workflows/test-promociones-dinamicas-63.yml (nuevo propuesto): esquema desechable/ACL/RLS/constraints/atomicidad. Numero y nombres SQL quedan por reservar tras comprobar disponibilidad, no se inventan en el prompt.
Pruebas nuevas propuestas:
- pruebas/promocionDinamica63.test.ts: precio/moneda/origen/resolucion.
- pruebas/promocionDinamica63.react.ts: selector/editor multiple y servicios globales (comando directo, sin pedir package.json).
- pruebas/promocionDinamicaFlujos63.test.ts: cargador, checkout, cotizacion y reserva, CxP/snapshot/registro personas con mocks de frontera.
- pruebas/promocionDinamica63.pg.ts: integridad real/roles/idempotencia/publicacion atomica en CI.

Deliberadamente fuera de reserva: CartContext, VistaBooking, contratos/cotizaciones manuales UI, motores Bernalo, panel #50 y SalesBot. Mantener payload publico en salida_id; revision de oferta publica puede devolverse por el servidor sin exponer snapshot de costos. lib/reservar/origen.ts mantiene discriminante salida, no admitir mezcla de ids. Si una prueba demuestra que debe cambiar una de esas rutas, el ejecutor presenta causa concreta al Coordinador antes de ampliarla. No sumar package.json ni lockfile por conveniencia.

### Persistencia y limites cerrados en propuesta

Una salida por (paquete_id, empaquetado_id) con unicidad parcial; manual con fuente NULL conserva contrato actual. Varias promociones por paquete; una fuente puede usarse en paquetes distintos. No se copian contratos. Elegibles filtradas por destino/estado/ventanas/moneda; nuevas solo pendientes hasta agregar y regenerar. Vinculo FK no autoriza cascada que borre salida/historico: proponer RESTRICT y desactivacion, snapshots inmutables en documentos aceptados.

TRM de armado en paquete/config y snapshot de oferta, positiva y versionada COP/USD; fuente y componentes conservan monedas/netos originales, equivalentes COP, regla de precio y proveedor. Guardar TRM en encabezado del contrato como si se vendiera USD provocaria doble conversion: la venta #63 mixta es COP; el cambio de armado se guarda en desglose privado, sin reinterpretar TRM de cobro. El snapshot generico de condiciones existente acepta trm, con fallback 1: no usar ese fallback para costes USD ni cambiar su semantica global; validar antes y mantener venta COP compatible con reglas de congelado. Una CxP USD mantiene deuda USD y su equivalente contable trazable; su registro real queda cubierto por pruebas financieras, no por formatear el valor.

### Matriz minima de pruebas / salida de gates

#62: activa hoy; ventana futura/vencida; limites inclusivos Bogota y cambio de dia; inactiva/eliminada despues de generar; viaje pasado; lectura denegada/error; cargador oculta y computo rechaza sin escritura; cotizacion y reserva llegan a ese mismo computo. Regresiones de empaquetado directo y manual vigente. Si falla cualquier camino no se libera Dinamico al bot.

#63: 0/1/N promociones, mismo destino y destino ajeno; seleccionar todas revisadas; reintento/doble clic/concurrencia = una fila; futuras quedan pendientes; fuente cambiada/borrada/vencida y error de lectura; revision TRM invalida oferta. Precio aereo COP 1.130.000 conserva aporte con MK positivo/TA configurada; hotel USD y tour USD convertidos una vez y marginados una vez; servicio COP sin conversion; neto CxP nunca reventa. BNC/infantes segun decision expresa; roundings COP y PVP por salida. Tours/traslados globales en persona/grupo, dia/noche, incluido/opcional sin doble cobro ni duplicacion por N salidas. Contrato simple/comparativa, eleccion, cotizacion y conversion con proveedor real, tramos, snapshot y alta de personas #42. Moneda ausente/TRM invalida bloquea; roles venta/tenant y no exposicion de netos; preservar historicos congelados y carreras contra primer pago/cambio de fuente. Regresion manual/paquete COP o USD legacy y 219/216/217 relevante en CI. Build con TS despues de ultimo cambio y diff check; no baterias amplias repetidas sin motivo.

Pruebas arriba son PLAN, ninguna ejecutada en esta ronda. Orden de trabajo y reservas requieren GO del Coordinador; no se creo worktree, migracion, codigo ni SQL, no staging/commit/push/PR. Solo actualizada esta bitacora. Lista para lectura del Coordinador con tres respuestas minimas del dueno y secuencia #62 -> #63.

---

## Historico - contrato #63 anterior y otros frentes

# Chat #4 - Hotfixes

## Estado vigente - #63 Desde promocion en Dinamico, contrato tecnico, 2026-10-19

**Veredicto: DISENO MINIMO PROPUESTO, NO GO de codigo/SQL.** Requiere reserva del Coordinador y resolver las precisiones finales abajo. Sustituye la recomendacion operativa anterior solo como objetivo de producto: el dueno quiere soportarlo en Dinamico, conservar alta manual y enlazar promociones reales de empaquetados. No se implementa por el mero registro de esta propuesta.

### Decisiones recibidas del dueno via Coordinador

1. Varias promociones por paquete del mismo destino; cada una tiene salida, fechas, vuelo y precio propios. Alta manual permanece.
2. La promocion aerea aporta tarifa_para_empaquetar como precio de reventa, SIN segundo MK ni TA. tarifa_proveedor es costo para proveedor/CxP, nunca sustituye ese PVP.
3. Ejemplo aereo en COP. Cuando se mezclan monedas, TRM explicita POR PAQUETE para convertir USD a COP y generar/vender tarifario COP. No inferir moneda por el simbolo $ ni asignar USD al valor COP.
4. Hoteles, traslados y tours iguales para TODAS las salidas: configuracion GLOBAL por paquete, no por salida.
5. Promociones futuras no se incorporan ni publican automaticamente. Se muestran pendientes; usuario agrega explicitamente y regenera.

### Compatibilidad demostrada por lectura

Base inspeccionada: main local 9e4d1322; solo lectura, sin pruebas funcionales/SQL ni datos reales. Codigo actual no satisface el contrato:
- paquetes/actions.ts:1353-1413 define valorTiquete NETO en moneda del paquete y usa MK/TA; crear/actualizar intentan regenerar e ignoran fallos de generacion. Se necesita diferenciar guardar seleccion de publicar tarifario y no anunciar exito de publicacion cuando falla.
- :673-698 rechaza mezcla de moneda hotel/servicios; :889-970 compone y persiste moneda del HOTEL; page.tsx deduce USD si hay hotel USD. No basta agregar TRM al editor. Cambiarlo solo para #63 mediante modo explicito y conservar reglas legacy en demas paquetes.
- ArmadoClient.tsx:322 ya administra armado_servicios global; :847 de actions hornea incluidos por persona al hotel, opcionales van como add-on y los incluidos por grupo se resuelven despues en computo.ts. Traslados/tours no deben volver a insertarse ni sumarse en una tabla por salida.
- origen.ts:80-83 exige salidaId en dinamico y rechaza empaquetadoId directo; datosVueloSalida en empaquetadoOrigen.ts usa valor_tiquete como costo y proveedor null. Un copy-paste de la promocion perderia procedencia, costo neto/proveedor y vigencia viva.
- datos.ts filtra vigencia de empaquetados por empaquetado_id de fila, pero las filas dinamicas llevan salida_id. computo.ts solo revalida empaquetados directos. Resolver #62 en el motor compartido para manuales y vinculadas; no poner un filtro exclusivo en esta UI.

### Modelo minimo propuesto (nombres conceptuales, no migracion reservada)

Mantener salidas_dinamicas.id como identidad operativa de cada salida y salida_id en tarifario/carrito/reserva. Agregar referencia nullable a empaquetados y discriminacion manual/promocion; NULL conserva manuales historicas sin reinterpretarlas. Una promocion pertenece a muchos paquetes, pero a lo sumo UNA salida vinculada por (paquete_id, empaquetado_id), garantizado en BD con unicidad parcial y en escritura idempotente para doble clic/concurrencia. No poner simultaneamente salida_id y empaquetado_id directos en payload: el servidor deriva la fuente desde la salida, manteniendo discriminante unico sin doble vuelo/CxP/sillas.

Selector multiple Desde promocion: fuente SOLO tabla empaquetados, campos comerciales minimos; nunca contratos/contrato_vuelos. Filtrar destino exacto, activo, ida/regreso validos y viaje no pasado, ventana compra inclusiva en America/Bogota, moneda verificable y tarifa valida. Las ya vinculadas aparecen identificadas; pendientes = elegibles no vinculadas. Seleccionar todas significa todas las elegibles revisadas en esa accion, no suscripcion futura. Validar cada id otra vez en servidor, paquete tipo dinamico y permiso/tenant real; no confiar en listas ni precio/proveedor remitidos por navegador. Al cambiar destino no mantener enlaces incompatibles ocultos. Al retirar fuente no convertirla silenciosamente en manual.

Persistir vinculo mas snapshot privado de campos usados, monedas origen, costo neto, reventa, fee infante, proveedor, fechas/tramos/estado/ventanas, revision o huella fuente, modo de precio, TRM COP/USD y revision de configuracion del paquete. La fuente necesita moneda EXPLICITA confiable: empaquetados hoy no la guarda. Propuesta minima: ampliar ese catalogo con moneda validada o contrato de moneda confirmado y persistido por fuente; no backfill global COP por el ejemplo. Fuentes legacy sin moneda verificable no son elegibles hasta revision. Evitar guardar copia editable que pueda divergir silenciosamente del vinculo.

Enlazadas: fuente controla vuelo/fechas/precios/ventana; configuracion comercial local no puede alterar reventa ni habilitar segundo margen. Si fuente cambia desde generacion, invalidar revision vigente y exigir revisar/regenerar/reconfirmar; ocultar/bloquear oferta incoherente, nunca vender precio nuevo silenciosamente con cache anterior. No sincronizacion destructiva de historicos ni publicacion automatica. Un helper de servidor debe resolver manual/promocion y su elegibilidad para generar, cargar, cotizar y reservar, incluido acceso fallido = rechazo.

### Contrato de calculo por componente

- Aereo promocion: aporte PVP = tarifa_para_empaquetar COP, una sola vez. NO aporteVuelo(valor,true,MK,TA) ni MK aplicado al total de paquete. Costo/CxP = tarifa_proveedor en su moneda original, con proveedor de la fuente; fee infante separado segun pax. TA cero/no aplicable para este origen.
- Aereo manual: mantiene NETO valor_tiquete y decision MK O TA existente; requiere moneda declarada coherente, conversion previa si USD en modo COP mixto.
- Hotel neto: resolver noches/temporadas en moneda de origen; convertir neto USD x TRM a COP; aplicar marcar = netoCOP/(1-MK) una sola vez. No convertir precios de temporada reescribiendo catalogo ni alterar reglas de descuentos por monto. Verificar temporadas precio_final_autoritativo y no confundir esa bandera con la promocion aerea.
- Traslados/tours: reutilizar servicios_adicionales + armado_servicios (incluido/opcional, persona/grupo, liquidacion por dia/noche). Separar UI por categoria, una sola asociacion por paquete/servicio y un solo motor. Neto USD a COP con la misma TRM ANTES de MK; incluido persona ya horneado no se vuelve a sumar en checkout, grupo se calcula una sola vez por grupo real y opcional solo al elegirse. Confirmar si su catalogo representa neto o final antes de anunciar otra modalidad de promocion para esos servicios; no se ha autorizado precio final para tours/traslados.
- PVP COP = aporte hotel + incluidos + aereo final/manual + extras elegidos segun reglas actuales; redondeo final una sola vez con regla COP existente, no redondeos diferentes por pantalla. La frase el valor COP se monta sobre el mk se interpreta como sumar a la parte hotel/servicios ya marginada; NO margen adicional a la promocion.
- Netos proveedor, PVP cliente y base comisionable son magnitudes distintas. Definir impuesto/BNC: actual impuesto_tipo=tiquete usa costoTiquete que en promocion pasaria a reventa; no decidir automaticamente si BNC es neto proveedor o precio aereo final. Tampoco cambiar comisiones ni impuestos por inferencia.

TRM: dato persistente validado positivo/finito, unidades COP por 1 USD, sin fallback 1 en mezcla. Snapshot guarda TRM usada y revision; cambiarla exige regenerar/reconfirmar oferta, no recalcular contratos/cotizaciones congelados. Venta COP debe evitar una segunda conversion por trm_contrato; distinguir TRM de armado (costos origen) de TRM de cobro. CxP mantiene moneda y deuda original de cada proveedor mas equivalente COP/TC aplicado para contabilidad; no etiquetar deuda USD como COP sin conversion trazable.

### Mapa de superficies para reservar (sin autorizar aun)

Directas confirmadas:
- app/(dashboard)/dashboard/paquetes/[id]/{SalidasDinamicasEditor.tsx,page.tsx,ArmadoClient.tsx}: selector multiple, pendientes, datos/proveedor privado, secciones globales servicios, moneda salida/TRM y errores.
- app/(dashboard)/dashboard/paquetes/actions.ts: CRUD con enlace validado/idempotencia, generacion, revision, conversion y separacion reventa/neto, persistencia atomica tarifario.
- lib/calc/paquetes.ts: helpers puros de aportes/conversion segun modo sin cambiar legacy; nueva resolucion comun de fuente/precio/vigencia en ruta a reservar.
- lib/tarifario/datos.ts: elegibilidad viva por salida y fuente, moneda COP, cache vieja invalida.
- lib/reservar/{computo.ts,empaquetadoOrigen.ts}: validar salida/vinculo/moneda/TRM, precio y costo/proveedor; origen.ts debe conservar salida como discriminante, adaptacion solo si prueba demuestra necesaria.
- app/tarifario/checkout/actions.ts: cotizacion simple/comparativa, reliquidacion, snapshot interno; no enviar netos/proveedor/comisiones al carrito publico.
- app/(dashboard)/dashboard/reservar/actions.ts: reservar, cotizar, convertir, tramos/snapshots y CxP con la misma resolucion; respetar congelados y reglas de pagos 164/198/211/216/217.
- types/database.ts y migracion NUEVA por reservar: enlace/indice, moneda fuente y TRM/config/revision/snapshot donde corresponda, tipos/ACL/RLS y compatibilidad NULL. No numero elegido; 218 reservada #56 y aparece archivo 219 de #42 en su worktree: NO reutilizarlos.

Dependencias a inspeccionar/reservar antes del GO, sin afirmar auditadas completas: formulario y actions de Empaquetados para moneda; lib/cotizacion/snapshotCondiciones.ts y snapshot usado por conversion; lib/reservar/incluidosCotizados.ts; payload/validacion de app/tarifario/TarifarioPublic.tsx y detalle-actions.ts; serviciosHotel.tsx/CartContext solo si la nueva revision requiere cambios. ConfigForm.tsx si TRM se configura alli. No ampliar todo por defecto: resolver almacenamiento/version en contrato y entonces fijar lista final. No anunciar mapa exhaustivo de archivos de implementacion antes de ese cierre.

### Cruces reales y secuencia

- #42 worktree personas-cotizaciones-42 tiene cambios locales comprobados en reservar/actions.ts, checkout/actions.ts, checkout/page.tsx, computo.ts y types/database.ts, mas migracion 219. Cruce DIRECTO: integrar en serie y conciliar sobre su base aprobada, no editar esos archivos en paralelo. El Coordinador fija orden #42/#63 y reserva.
- #60/#61/#62 comparten computo.ts. Propuesta: un unico ejecutor para contrato de vigencia #62 requerido por #63, con pruebas manual/promocion, y secuencia expresa; no dos agentes arreglando la misma guarda. No absorber precios de servicios #61 ni fix MK #60 sin asignacion.
- #54 worktree editar-addons-carrito-54 conserva historia propia; no inferir integrado por ramas existentes. Sus superficies de servicios/checkout deben conciliarse con main vigente al crear #63. #49 toca VistaBooking y #56 SalesBot consume datos; no dar Dinamico por habilitado en el bot antes del gate #62/#63. #50 NETO requiere coordinacion si toca conversion/venta/CxP. Tablero canonico manda sobre listado de ramas.

### Precisiones aun necesarias antes del GO

A. Contrato de moneda para promociones legacy, autoridad/captura de esa moneda y ubicacion/version de TRM de armado; no inferirlas por formato.
B. Impuesto/BNC cuando aereo es reventa final; moneda de fee infante y si ese fee es costo o PVP (el campo actual se usa en costo). Mantener cifra conocida no decide su semantica.
C. Confirmar contrato neto de tours/traslados del catalogo y que se conservan modos incluido/opcional y persona/grupo; no extender regla promocion final a ellos sin decision.
D. Recuperacion ante fuente cambiada: propuesta es bloquear hasta revision/regeneracion; definir comportamiento de cotizaciones previas sin pago y confirmar preservacion de congeladas. No actualizar historicos como efecto de editar una promocion.
E. Reserva y orden con #42/#62; migracion/persistencia atomica y CxP multimoneda requieren auditoria tecnica propia. No prometer resolverlo con un selector y un campo TRM.

### Pruebas de aceptacion propuestas (NO ejecutadas)

Alta manual sin regresiones; N promociones de mismo destino a N salidas; seleccionar todas y reintento/concurrencia sin duplicados; futura solo pendiente; fuente equivocada/invisible/borrada/inactiva/vencida y cambio tras publicar rechazados en cargador/checkout/reserva; noches y hotel global distintos por salida; traslados/tours globales cobrados una vez en todos los modos; precio 1.130.000 COP intacto con MK positivo, TA no aplicada; hotel/servicio USD x TRM y COP sin conversion, TRM ausente/cero rechazada; cambio de TRM invalida revision sin modificar congelados; infantes/impuestos/base comisionable; proveedor real y CxP neta sin doble vuelo/sillas; snapshot, comparativa, eleccion/conversion y concurrencia con cambio de fuente/primer pago; rol venta y RLS sin exponer netos; regresion legacy COP y USD. SQL nuevo se prueba en esquema desechable/CI si se autoriza, nunca remoto por este chat.

**Bitacora lista para el Coordinador: #63 tiene contrato propuesto y cruces demostrados, pero NO GO de implementacion hasta cerrar A-E y reservar el alcance en serie.** Solo se escribio esta bitacora; no codigo, SQL, staging, commit, push ni PR. No mensajes directos a otros chats desde Chat #4.

---

## Historico - triage anterior y otros frentes

# Chat #4 - Hotfixes

## Estado vigente - triage Empaquetador / paquete Dinamico, 2026-10-19

**Recomendacion al Coordinador: para esta salida ya creada, usar un paquete NUEVO tipo Bloqueo (vuelo + hotel), seleccionar SOLO el vuelo en Vuelos por Sistema — Empaquetados y generar su tarifario.** Es el camino ya implementado para ese origen; no convierte el vuelo en cupo negociado ni necesita inventar un record. No recomiendo cambiar a ciegas el tipo del paquete Dinamico existente ni copiar el vuelo como salida dinamica para salir del paso. Es recomendacion por lectura, no validacion de los datos particulares ni GO para escrituras del agente en Produccion.

### Evidencia y condiciones operativas

Lectura en checkout principal HEAD 9e4d1322. Se preservan cambios documentales ajenos en CURRENT_GOAL.md, TASKS.md y los tres documentos sin seguimiento. Sin codigo ni Git de publicacion. No pruebas, navegador, build ni SQL remoto ejecutados para este triage.

- ArmadoClient.tsx:231-274: el selector Empaquetados aparece solo en bloqueo; dinamico muestra su editor propio. El nombre Bloqueo en ConfigForm.tsx:129 es ambiguo comercialmente, porque incluye tambien Sistema; no demuestra cupo negociado. Confirmar destino/rango de viaje, hotel y fechas reales para encontrar el empaquetado.
- paquetes/actions.ts:1081-1089: Sistema liquida con tarifa_para_empaquetar del empaquetado, noches ida/regreso, hoteles y configuracion del paquete; aplica la decision de MK o TA del enlace. Usa modulo bloqueo con bloqueo_id nulo y empaquetado_id real. No toma tarifa_proveedor como PVP. Crear paquete nuevo exige reproducir conscientemente hotel/regimen, servicios, moneda, impuestos, margen o TA, comisiones/condicion comercial pertinentes: NO se promete precio identico a un Dinamico previo por cambiar solo el nombre del tipo.
- lib/reservar/empaquetadoOrigen.ts:119-144 y reservar/actions.ts:208-237, :718: conserva proveedor del empaquetado y costo neto de tarifa_proveedor para costo aereo/CxP, por pax con silla mas fee de infantes. El control de cupo negociado solo corre si origen.tipo=bloqueo (:216); un origen empaquetado no se transforma en ese origen por el tipo del paquete. Revisar que la ficha tenga neto y proveedor correctos: costo faltante cae a 0 en helper, y este triage NO acredita esos datos concretos ni que toda CxP este emitida correctamente en Produccion.
- paquetes/actions.ts:1004-1022 y lib/reservar/computo.ts:251-261: activo y ventana de compra del empaquetado se filtran al generar y se revalidan al reservar. empaquetadoOrigen.ts:127-131 vuelve a cerrar lecturas fallidas/inactivo/vencido. No es consulta de disponibilidad ni precio en vivo de una aerolinea: el sistema usa lo registrado, el dueno debe confirmar vigencia comercial real de la tarifa.
- Experiencia comercial: misma liquidacion vuelo+hotel, seleccion de fechas y tramos reales en contrato (reservar/actions.ts:593), ruta publica sin PNR en label (paquetes/actions.ts:1086-1089). No vi fundamento para exigir record ni cupo negociado al empaquetado. No se audito cada vista comercial/PDF; verificar precio final y presentacion antes de publicar, sin crear contrato/pago artificial en Produccion.

### Cambiar el tipo de un paquete ya creado

ConfigForm permite cambiar tipo; paquetes/actions.ts:144-156 actualiza la fila sin migrar armado_empaquetados/armado_vuelos/salidas_dinamicas ni regenerar el tarifario. Por ello cambiar el tipo no convierte una salida ni sus referencias. Puede dejar seleccion oculta del tipo anterior y tarifario viejo hasta regeneracion; carritos/cotizaciones guardadas pueden conservar ids/modulo anteriores y requieren conciliacion especifica. No se ha inspeccionado el paquete real para saber si esta vacio, publicado o referenciado.

Si el existente es un borrador realmente sin uso, el Coordinador puede valorar reconfigurarlo con revision de enlaces y regeneracion; no asumir esa condicion. Si ya esta publicado, cotizado o vendido, preferir paquete nuevo y tratar retirada/reemplazo comercial del anterior como decision humana. No editar historicos ni cambiar tipo con SQL directo.

### Alcance de admitir Empaquetados en Dinamico

No es un selector faltante aislado. lib/reservar/origen.ts:80-83 rechaza empaquetadoId en dinamico y exige salidaId; generarTarifario consulta salidas_dinamicas exclusivamente para ese tipo (paquetes/actions.ts:1028-1048). Un cambio real exige decision de producto sobre si Dinamico incorpora un segundo origen o si se unifican conceptos; despues reserva y ejecutor unico para armado/cargador, generacion, discriminante/payload de buscador-carrito-cotizacion-reserva, proveedor/neto/CxP, snapshots/tramos, vigente/activo y pruebas de ambos origenes sin doble vuelo, sillas ni CxP. El alcance exacto y eventual esquema se auditan antes de reservar; no hay migracion propuesta/autorizada en este triage. No habilitar solo la UI ni eliminar la guarda del servidor.

Cruces: #60 (posible subcobro por markup) y #62 (vigencia de salidas dinamicas) ya tienen auditorias propias y comparten computo.ts. Este triage no las implementa ni afirma resueltos sus riesgos. La revision del total/MK es condicion operativa antes de ofrecer la nueva combinacion, no garantia global de motor. No abrir implementacion paralela duplicada.

**Entrega lista para el Coordinador: salida inmediata viable por diseno = NUEVO Bloqueo + origen Empaquetado, conservando los datos del vuelo y comprobando configuracion/precio/proveedor/vigencia reales. Soporte de ese origen en Dinamico requiere entrega separada; no se justifica hotfix de codigo inmediato solo por esta incompatibilidad de tipo.** Solo se actualiza esta bitacora; #53 mantiene su aprobacion tecnica historica debajo y #52 su seguimiento de Produccion.

---

## Historico - #53 y otros frentes

# Chat #4 - Hotfixes

## Estado vigente - #53 callback OAuth, gate tecnico local final, 2026-10-19

**Veredicto: APROBADO LOCALMENTE para el gate de PR del Coordinador sobre 9e4d13227ebaae6b97a0aaa504b4b35345c383c8.** Conciliacion completada por el ejecutor unico, tres archivos intactos, build y prueba focal verdes. No hay hallazgos bloqueantes pendientes en el alcance auditado. El Coordinador conserva la decision de GO al usuario; esta aprobacion no publica, integra ni cierra #53.

### Verificado personalmente por Chat #4 en esta ronda

- Worktree C:\Users\Asus\Documents\DspaciosMayorista\.claude\worktrees\callback-next-25; rama codex/25-callback-next-seguro. HEAD = main = origin/main LOCALES = 9e4d13227ebaae6b97a0aaa504b4b35345c383c8. Sin consulta por red.
- Status: solo M dspacios-travel/app/auth/callback/route.ts y ?? dspacios-travel/lib/auth/destinoSeguro.ts, ?? dspacios-travel/pruebas/callbackDestinoSeguro.test.ts. Nada en staging; git diff --check limpio.
- Diff del handler revisado de nuevo, identico al auditado sobre 014b8edf. Huellas de las tres rutas identicas a la auditoria inicial y a hashes_antes.txt/hashes_despues.txt del respaldo:
  route.ts: 18bc0ab31a38f033fd1740fa2acd7b819ae2a063
  destinoSeguro.ts: faf82e402ad7a7285d2e3036a2f3d9ee7c47fde1
  callbackDestinoSeguro.test.ts: 0f1a8c40d445714b634e0b7cb5899796514c4fb0
- Comparacion entre bases: no cambia ninguna de las tres rutas, pnpm-lock.yaml, pruebas/support, next.config.ts ni proxy.ts. package.json SI cambia: solo lista de test:react; sin cambios de dependencias. La prueba nueva entra en glob existente de test:unit. Esto describe los cruces relevantes, no significa que esos sean todos los cambios del main completo.
- Revisados encabezado y final del log de build: Next 16.3.0/Turbopack, compiled successfully, TypeScript finalizado, paginas 16/16 y tabla de rutas completa con Proxy. Revisado resumen de prueba focal: **62 tests, 5 suites, 62 pass, 0 fail/cancelled/skipped/todo**, ~1,3 s. La ejecucion sobre esta base y sus salidas 0 corresponden al ejecutor; Chat #4 reviso logs, no volvio a correrlos.
- En auditoria inicial Chat #4 ejecuto independientemente las mismas pruebas: **62/62**, salida 0, ~1,9 s, sobre 014b8edf. Se conserva esa distincion; hashes identicos no se presentan como ejecucion personal sobre la base nueva.
- core.autocrlf=true; route.ts i/lf y w/crlf, attr text=auto. El aviso reportado sobre conversion LF/CRLF de nuevos archivos no bloquea: no se normalizaron ni reescribieron archivos para silenciarlo y las huellas Git coinciden.

### Reportado por el ejecutor y contrastado donde se indica

- Fast-forward autorizado git merge --ff-only origin/main: salida 0 desde 014b8edf hasta 9e4d1322, sin fetch, sin conflictos ni ediciones de codigo/documentos. El resultado de refs y preservacion de contenido si fue verificado personalmente arriba.
- pnpm run build una vez: salida 0, ~264 s; TypeScript incluido. Prueba focal una vez, salida 0. No se repitieron bateria amplia, lint ni tsc separado; no se declara toda la bateria verde.
- Solo artefactos ignorados del build (.next, next-env.d.ts, tsconfig.tsbuildinfo); estado no ignorado verificado arriba. Comprobacion de espacios de nuevos archivos contra vacio y busqueda de secretos en logs: reportadas por ejecutor, no repetidas personalmente.
- Advertencias: pnpm.onlyBuiltDependencies ignorado y avisos Node por loaders/mocks experimentales/MODULE_TYPELESS_PACKAGE_JSON. No introducidas por #53; no se amplio alcance para corregirlas.

### Evidencia y limites

Respaldo temporal revisado:
C:\Users\Asus\AppData\Local\Temp\claude\c--Users-Asus-Documents-DspaciosMayorista\762569a2-c5fe-4fd9-bf73-6ac6c5077df5\scratchpad\respaldo53_014b8edf

Contiene copias y hashes de tres archivos, patches/estado antes y despues, build_9e4d1322.log y test_callback_9e4d1322.log. Es temporal; el veredicto, las huellas y los resultados esenciales quedan persistidos en esta bitacora. No se copio evidencia a otras rutas ni se modifico el worktree por Chat #4.

La validacion cubre saneamiento de destinos y handler real con cliente Supabase simulado; no demuestra un login Google real. Queda validacion humana del flujo OAuth en Preview/Produccion segun gate del Coordinador. No hay migracion ni SQL. Sin staging, commit, push, PR o merge de PR. #52 conserva su seguimiento funcional de Produccion aparte; #25 no recibe cambios.

**Lista para lectura del Coordinador: puede resolver GO al usuario para preparar/publicar el PR de #53; no se requiere otro ciclo tecnico local por la conciliacion auditada.** Chat #4 solo actualizo esta bitacora. Historial anterior conservado debajo; el gate pendiente de la auditoria inicial queda sustituido por este veredicto.

---

## Historico - auditoria inicial de #53 y frentes anteriores

# Chat #4 - Hotfixes

## Estado vigente - #53 callback OAuth, auditoria inicial, 2026-10-19

**Veredicto: CON OBSERVACIONES / gate de PR PENDIENTE de conciliacion y build sobre main actual. No se identificaron defectos bloqueantes en el diff revisado sobre la base antigua.** No se autoriza publicar desde esta bitacora; el Coordinador decide GO al usuario despues del informe final.

Asignacion recibida del Coordinador y contrastada con CURRENT_GOAL.md, TASKS.md #53 y WORKSTREAMS.md canonico. Chat #4 solo coordina/audita y escribe esta bitacora. El ejecutor unico conserva toda escritura en el worktree. #52 sigue como seguimiento funcional de Produccion y no se mezcla con #53. El registro de #54 queda como historico separado abajo, sin revalidarlo en esta ronda.

### Comprobado personalmente

- Worktree: C:\Users\Asus\Documents\DspaciosMayorista\.claude\worktrees\callback-next-25. Rama codex/25-callback-next-seguro; HEAD 014b8edf7ff34fb093c87a5ab9728785098d621a. main = origin/main LOCALES = 9e4d13227ebaae6b97a0aaa504b4b35345c383c8; sin fetch/red.
- Estado: route.ts modificado; destinoSeguro.ts y callbackDestinoSeguro.test.ts nuevos sin seguimiento. Staging vacio; git diff --check limpio. Diff seguido del handler +3/-1; los dos archivos nuevos se leyeron completos, no estan incluidos en git diff --stat por ser untracked.
- Revision directa: helper exige ruta con una sola barra inicial, rechaza barras invertidas/controles, codificacion malformada o ambigua, comprueba URL normalizada y mismo origen. Default /dashboard. Handler usa helper antes del redirect y conserva exchangeCodeForSession y /login?error=oauth. No cambia clientes, cookies, politicas Auth, panel ni RLS. Sin migracion. No se proponen refactors ni ampliaciones.
- Cruce de bases comprobado: ninguna de las tres rutas de #53 cambia entre 014b8edf y 9e4d1322. SI cambia package.json; no aparecen cambios en pnpm-lock.yaml, pruebas/support ni next.config.ts en esa comparacion. Esto no sustituye el build sobre la base nueva.
- Prueba focal ejecutada personalmente desde dspacios-travel del worktree:
  node --test --experimental-strip-types --experimental-test-module-mocks --experimental-loader ./pruebas/support/aliasLoader.mjs pruebas/callbackDestinoSeguro.test.ts
  **62/62; 0 fallos, 0 omitidas, 0 canceladas, 0 todo; salida 0; ~1,9 s.** Incluye helper y handler real con Supabase simulado, destinos locales, userinfo, barras/controles/codificaciones, fallo de intercambio y ausencia de codigo. No es OAuth real ni validacion de Vercel. Solo advertencias experimentales Node y MODULE_TYPELESS_PACKAGE_JSON; no se cambia package.json para silenciarlas.
- Typecheck previo y contraprueba roja con codigo viejo: reportados por el ejecutor, no verificados personalmente en esta ronda. Build aun NO ejecutado.

Huellas antes de conciliar (git hash-object):
- app/auth/callback/route.ts: 18bc0ab31a38f033fd1740fa2acd7b819ae2a063
- lib/auth/destinoSeguro.ts: faf82e402ad7a7285d2e3036a2f3d9ee7c47fde1
- pruebas/callbackDestinoSeguro.test.ts: 0f1a8c40d445714b634e0b7cb5899796514c4fb0

### Siguiente accion - mismo ejecutor

No hay agente ejecutor accesible en el arbol de esta sesion. No se lanzo un segundo implementador ni se envio un mensaje a otro chat sin autorizacion humana directa. Se entrega prompt para retomar con el ejecutor unico existente; no se considera conciliada la rama ni aprobado el build por preparar este prompt.

Prompt para el ejecutor unico:

Retoma exclusivamente #53 en C:\Users\Asus\Documents\DspaciosMayorista\.claude\worktrees\callback-next-25, rama codex/25-callback-next-seguro. Lee AGENTS.md y las instrucciones aplicables al ejecutor; contrasta CURRENT_GOAL.md del checkout principal, TASKS.md #53 y WORKSTREAMS.md canonico. No releas CLAUDE.md completo. Chat #4 audita; tu conservas la unica escritura.

Conciliacion autorizada con main local 9e4d13227ebaae6b97a0aaa504b4b35345c383c8, sin red si ya existe. Antes comprueba rama, refs, status, staging y hashes de las tres rutas. Preserva todos los cambios ajenos y los nuevos sin seguimiento; guarda respaldo recuperable fuera del repo de los tres archivos y del patch antes de mover la base. Comprueba que la base es ancestro y que las tres rutas no cruzan. Usa git merge --ff-only origin/main solo si el ref local sigue siendo el objetivo y Git puede conservar los cambios; si aparece otro HEAD, cruce o conflicto, informa antes de ampliar alcance. No uses reset destructivo, clean, stash, checkout que sobrescriba archivos, ni copies cambios del checkout principal.

Despues verifica hashes y diff contra base nueva: exactamente las mismas tres rutas y mismo contenido. Desde dspacios-travel ejecuta una vez pnpm run build y repite la prueba focal:
node --test --experimental-strip-types --experimental-test-module-mocks --experimental-loader ./pruebas/support/aliasLoader.mjs pruebas/callbackDestinoSeguro.test.ts

Ejecuta git diff --check y confirma status final/staging vacio. Usa dependencias existentes; no instales ni cambies package.json, lockfile, loaders, next.config, cliente Supabase, Auth/RLS ni panel #25. Si build genera algun archivo no esperado, documentalo y no borres cambios de origen dudoso. No imprimas .env, secretos, codigos OAuth ni tokens. No staging, commit, push, PR, merge de PR ni SQL remoto. El fast-forward local especificado es solo conciliacion de base. No escribas documentos centrales ni esta bitacora.

Devuelve base antes/despues, estado Git, respaldo, hashes antes/despues, diff/cruces, comandos y salidas de build/prueba, conteos de omitidas y advertencias, y logs revisables sin secretos. Si falla algo, describe el bloqueo sin ampliar rutas. No es necesario repetir bateria amplia ni typecheck separado si el build ya lo ejecuta. El Coordinador decide GO de publicacion tras auditoria de Chat #4.

### Gate restante

Recibir y auditar conciliacion + build/pruebas sobre 9e4d1322; registrar resultado final en esta bitacora para lectura del Coordinador. Sin escrituras de codigo/worktree ni operaciones de publicacion realizadas por Chat #4. No se pide ejecutar SQL ni migraciones. Validacion de OAuth real en Vercel sigue a cargo del usuario despues de la secuencia que autorice el Coordinador.

---

## Historico conservado - #54 y rondas anteriores

# Chat #4 - Hotfixes

Chat #4 coordina y audita; solo edita esta bitacora. El Coordinador mantiene TASKS.md, CURRENT_GOAL.md, WORKSTREAMS.md y orden global. Un unico Opus implementa #54. Usuario conserva staging, commit, push, PR, merge, SQL remoto y validacion en Vercel. El usuario comunica al Coordinador que la bitacora cambio; sin mensajes directos entre chats.

## Estado vigente - #54, actualizacion de base a 862edf42, 2026-10-18

**Veredicto: APROBADO LOCALMENTE para el gate de PR del Coordinador sobre 862edf42. Las 11 huellas de producto y pruebas son identicas a ronda 3; build Next y suites React de #54 verdes sobre la base nueva. Unico cambio posterior: registro autorizado de las dos pruebas React nuevas en `test:react` de package.json, verificado (ver abajo). La auditoria de ronda 3 sigue vigente.** Los 7 fallos de la base no se tocan en #54. Sin staging, commit, push, PR ni SQL.

### package.json - registro en test:react (autorizacion del dueno, 2026-10-18)

- Alcance autorizado: agregar a `scripts["test:react"]` las rutas `pruebas/editarAddonsCarrito54.react.ts` y `pruebas/editarAddonsCheckout54.react.ts`, sin cambiar nada mas del archivo. Lo hizo el mismo Opus de esta sesion con un reemplazo exacto de texto.
- Verificado personalmente por Chat #4 contra `HEAD:dspacios-travel/package.json`: el nuevo `test:react` empieza con el valor anterior completo y el unico agregado es el sufijo exacto " pruebas/editarAddonsCarrito54.react.ts pruebas/editarAddonsCheckout54.react.ts" (al final, despues de programaDestinoFijo.filtro.react.ts). Los demas scripts y el resto del package.json son identicos tras parsear; `git diff --numstat` 1/1, un solo bloque en la linea 16; JSON valido; 61 rutas (antes 59). Finales de linea conservados (w/crlf, i/lf, linea final CRLF segun Opus). `git diff --check` limpio, nada en staging.
- Huella: package.json 64d8ac422be0dea960bf0b578a4ded14333e7e4c (HEAD) -> **72a18f688600afcc47e49df2d3eee5f6d2accb05**.
- Solo se corrieron las dos pruebas registradas, con el comando de ronda 2: **34/34, 0 fallos, 0 canceladas, 0 omitidas, 0 todo; salida 0; ~48 s** (ejecutado por Opus; Chat #4 reviso el log). No se corrio la suite completa test:react ni el build: no cambia codigo de app.
- Diff de #54 ahora: 9 rutas modificadas (seis de producto, dos pruebas existentes autorizadas y package.json) + 3 pruebas nuevas sin seguimiento. Las otras 11 huellas siguen identicas.

### Base y avance

- Worktree y rama sin cambios (ver abajo). HEAD = origin/main LOCAL = 862edf42ad953e7a0c565e01f848192f9ae4189a, por `git merge --ff-only origin/main` desde 8987932e (salida 0, "Fast-forward", 15 archivos, +4831). Sin consulta remota por red: origin/main local ya apuntaba a 862edf42. `main` local sigue en 8987932e; no se toco.
- Contenido de #363 (#32/214) revisado por Chat #4 con `git diff --name-only 8987932e 862edf42`: workflow test-214, doc personas-identidad, lib/personas/{consulta,fuentes,identidad}.ts, tres pruebas de personas, migracion 214, cinco scripts *_214_* y types/database.ts.
- **Correccion a la premisa del Coordinador suplente:** #363 SI toca `types/database.ts` (+17, aditivo: solo agrega en Functions el tipo del RPC `buscar_personas_documento`; no modifica tipos existentes). No cruza ninguno de los 11 archivos de #54, ni package.json, lockfile, pruebas/support (loaders) ni next.config. Sin impacto en #54; el TypeScript del build verde lo confirma. No cambia el veredicto.

### Ejecucion

- Ejecutor: un unico Opus (subagente nuevo de esta sesion de Chat #4; la instancia de rondas anteriores no era alcanzable). Solo hizo el fast-forward y las verificaciones; no edito archivos del proyecto. Logs en el scratchpad de la sesion (no persistente).
- `pnpm run build` desde dspacios-travel, una vez: **salida 0** segun Opus. Next 16.3.0/Turbopack, "Compiled successfully in 39.2s", TypeScript 2.4 min sin errores, 16/16 paginas estaticas, arbol de rutas completo + Proxy. Unica advertencia: campo "pnpm" de package.json ignorado (previa, no de #54). `git status` posterior identico: el build no creo ni modifico archivos con seguimiento o no ignorados. Chat #4 reviso el log (resumen de rutas presente, sin errores); no ejecuto el build personalmente.
- Suites React de #54 (mismo comando de ronda 2, abajo), una vez: **34/34, 0 fallos, 0 omitidas, 0 canceladas, 0 todo; salida 0; ~142 s.** Chat #4 reviso el log: cero marcas de fallo.
- No reejecutadas, vigentes por huellas identicas y sin cruce con #363: puras 25/25 (ronda 1), servicioAdicionalTarjeta.react.ts 15/15 y busquedaPorcionTerrestreWiring.test.ts 103/103 (ronda 3). Bateria amplia, lint y tsc sueltos no se repitieron; no se afirma bateria completa verde.

### Diff comprobado personalmente por Chat #4

- Antes y despues del avance: 8 rutas modificadas + 3 pruebas nuevas sin seguimiento, nada en staging (`git diff --cached` vacio), `git diff --check` limpio. `git hash-object` de las 11 rutas identico a las huellas auditadas de abajo (las nueve de ronda 2 y las dos de ronda 3).

### Siguiente gate

- **Bitacora lista para el Coordinador: #54 APROBADO LOCALMENTE para su gate de PR sobre 862edf42, con package.json (test:react) incluido en el diff.** El Coordinador decide el gate global; el usuario conserva staging, commit, push, PR, merge y validacion en Vercel. No declara publicada, integrada ni cerrada la tarea. Coordinacion con #49 sobre VistaBooking.tsx sigue igual.

## Historico - #54, tercera auditoria sobre 8987932e, 2026-10-18

**Veredicto (sustituido por el estado vigente de arriba solo en la base): APROBADO LOCALMENTE para pasar al gate de PR del Coordinador sobre 8987932e. Tres hallazgos iniciales resueltos; ampliacion de las dos pruebas existentes autorizada por el usuario mediante el prompt solicitado, implementada y auditada. No quedan bloqueos tecnicos locales identificados.** La publicacion e integracion conservan sus gates y responsables. Texto del modal: observacion menor fuera de alcance, no bloqueante.

### Alcance, base y diff comprobados personalmente

- GO LOCAL expreso del usuario de 2026-10-17 para seis rutas de implementacion y tres pruebas nuevas sigue vigente; no se necesita nueva confirmacion para correcciones dentro de esas rutas.
- Worktree C:\Users\Asus\Documents\DspaciosMayorista\.claude\worktrees\editar-addons-carrito-54; rama codex/54-editar-addons-carrito. HEAD = main = origin/main LOCALES = 8987932e5be8c7b4f9e9c8230570035e8674bb8b. Sin consulta remota por red.
- Estado final de ronda 3: ocho rutas modificadas (seis de producto y dos pruebas existentes autorizadas), mas tres pruebas nuevas sin seguimiento. Sin staging; git diff --check limpio. Producto y tres pruebas nuevas identicos por hash a ronda 2. Sin manifiestos, lockfile, loaders, SQL, types/database.ts o documentos centrales en el diff.
- Incremental revisado contra ronda 1: BuscadorBooking.tsx, CartContext.tsx, un texto de aviso en serviciosHotel.tsx y dos pruebas React nuevas. Contrastado con archivos actuales y hashes. VistaBooking.tsx, vinculoServicios.ts, servicioAdicionalPaquete.ts y la prueba pura conservan sus huellas de ronda 1.

### Hallazgos anteriores - CERRADOS

1. **Hotel persona revalidado.** BuscadorBooking.tsx:660 incorpora revalidarHotelPersona; :879 lo ejecuta al confirmar en paralelo con revalidarServicios. Reutiliza buscarHoteles y la forma de entrada del buscador existente (habitaciones, adultos, edades, fechas y destino). Selecciona hotel/paquete/combo exactos y comprueba claveReservaPersona y moneda. Rechazo/error deja conjunto y borrador intactos; tarifa distinta muestra precio fresco, invalida cotizacion de servicios y exige reconfirmacion. Retirar todos conserva el hotel guardado. Pruebas nuevas cubren precio del HOTEL con servicios estables, sin oferta/combo, otra ocupacion/paquete, rechazo/error y respuesta tardia.
2. **Resultado de mutaciones en un lote.** CartContext.tsx:246-249 mantiene ultimoRef despues de todas las mutaciones ya solicitadas y encola las mismas transformaciones puras en React; :307 decide actualizarConjunto contra ese estado. Todas las mutaciones actualizan la referencia, incluidos add, addConjunto, remove, clear y precio Bernalo. No captura resultados ni genera ids dentro del actualizador. Pruebas ejecutadas: remove+editar devuelve hotel_no_encontrado; dos ediciones con la misma firma aceptan solo la primera; editar+quitar y add de otro item respetan orden; tarjetas informan rechazos sin simular exito.
3. **Hidratacion StrictMode.** CartContext.tsx:238 usa estado hidratado y la persistencia espera al render con los datos hidratados; ya no escribe [] durante el primer ciclo de efectos. Los nuevos montajes usan StrictMode en la raiz y localStorage precargado. La regresion dedicada :722 conserva contenido/ids/almacenamiento, persiste una edicion y la relee al remontar. Corrige el defecto heredado identificado en ronda 1; no se lo atribuye como regresion nueva de #54.

### Pruebas ejecutadas por Chat #4 en ronda 2 (vigentes por hashes identicos)

Desde dspacios-travel del worktree:

node --experimental-test-module-mocks --import ./pruebas/support/registrarProgramasRuta.mjs --experimental-loader ./pruebas/support/reactLoader.mjs --test pruebas/editarAddonsCarrito54.react.ts pruebas/editarAddonsCheckout54.react.ts

- **34/34, 0 fallos, 0 omitidas, 0 canceladas; salida 0; aproximadamente 57 s.** Incluye regresiones de los tres hallazgos, ambas tarjetas, sincronizacion de mutaciones e hidratacion real bajo StrictMode, y checkout simple/comparativa con acciones simuladas que capturan entradas. No es prueba de servidor real.
- Prueba pura: **25/25 ejecutadas personalmente en ronda 1**; archivo y helpers puros mantienen hashes identicos. No se repitio sin cambios relevantes.
- git diff --check y estado/hashes finales verificados. No se repitieron TypeScript, lint, build o baterias amplias ya reportadas tras ultimo cambio.

### Evidencia visual revisada y limites

- Revisadas directamente dos capturas de Opus: movil-05-tarifa-hotel-cambio.png y escritorio-03-borrador-total.png, dentro del scratchpad harness54/capturas.
- Se leen precio fresco 1.250.000 y anterior 1.200.000 tachado, total 1.515.000 y reconfirmacion en movil; en escritorio, borrador con total 1.465.000 y acciones confirmar/descartar. No se detecta clipping en esas capturas.
- Opus reporta 18 capturas, banco con tarjetas/CartProvider reales, StrictMode raiz, Server Actions simuladas y Chromium a 375/1280 px; cero overflow de pagina y errores de pagina. Chat #4 NO ejecuto ese recorrido de navegador ni verifico personalmente las 18 capturas, tacto fisico, lector de pantalla o la app con datos reales.
- Precio pegado al boton En el carrito en movil es un detalle previo reportado por Opus; no se amplio #54 para redisenar esa fila.

### Historico de ronda 2: verificaciones reportadas por Opus

- TypeScript, ESLint sobre nueve rutas y build Next/Turbopack: salida 0. Pruebas puras 25/25 y React nuevas 34/34, estas ultimas si contrastadas mediante ejecucion independiente arriba.
- Regresion React seleccionada 50/50. servicioAdicionalTarjeta.react.ts aislada 14/15: solo falla el bloqueo viejo. En corrida combinada el intento de imprimir el nodo jsdom al fallar puede agotar memoria/tiempo; no reejecutado por Chat #4.
- Cableado relacionado: 1283 pruebas, nueve fallos = siete previos de base y dos por patrones antiguos de montadoRef. No afirmar toda la regresion verde.
- Contrapruebas: restauracion temporal de entrega 1 hace fallar los casos nuevos; archivos restaurados por cmp. No ejecutadas por Chat #4.

### Ronda 3 - ampliacion autorizada, diff y ejecucion independiente

La peticion del usuario de entregar el prompt para que el mismo Opus ejecutara las adaptaciones autoriza estas dos rutas. Esa autorizacion ya fue ejercida; no queda pendiente volver a solicitarla.

- pruebas/servicioAdicionalTarjeta.react.ts: sustituye el bloqueo obsoleto por una prueba sustantiva del contrato nuevo: seleccion guardada hidratada, modal editable, borrador sin cambios al carrito/localStorage, descarte, confirmacion con datos frescos y conservacion de ids/vinculos. Restaura la seleccion al final para el fixture secuencial. Agrega el stub existente de buscarHoteles y su limpieza; no cambia archivos de soporte. Invalida la respuesta sin precio del caso anterior cambiando alimentacion y regresando. No elimina pruebas.
- pruebas/busquedaPorcionTerrestreWiring.test.ts: admite exactamente los dos efectos permitidos (setup/cleanup montadoRef apto para StrictMode y sincronizacion de huellaRef). Conserva prohibiciones de cambiar categoria/alimentacion/precio desde efectos y de disparar busquedas desde selector. Verifica guardas de confirmacion y finally frente a desmontaje/intentos obsoletos. No se limita a suprimir aserciones fallidas.
- Revisado el diff real de ambas rutas y contrastados los nueve hashes anteriores: producto y tres pruebas nuevas sin cambios respecto a ronda 2. Sin hallazgos nuevos bloqueantes.

Ejecutadas personalmente desde dspacios-travel del worktree, salida 0 en ambas:

1. node --experimental-test-module-mocks --import ./pruebas/support/registrarProgramasRuta.mjs --experimental-loader ./pruebas/support/reactLoader.mjs --test pruebas/servicioAdicionalTarjeta.react.ts
   Resultado: **15/15, 0 fallos, 0 omitidas, 0 canceladas, 0 todo**, aproximadamente 31 s.
2. node --test --experimental-strip-types --experimental-test-module-mocks --experimental-loader ./pruebas/support/aliasLoader.mjs pruebas/busquedaPorcionTerrestreWiring.test.ts
   Resultado: **103/103, 0 fallos, 0 omitidas, 0 canceladas, 0 todo**, aproximadamente 0,7 s.

Siguen vigentes las 34/34 React de ronda 2 y 25/25 puras de ronda 1, ejecutadas por Chat #4: sus archivos y el producto conservan sus hashes. No se reejecutaron suites amplias, TypeScript, lint o build sin cambios relevantes que lo justificaran.

Opus reporta para ronda 3 (no ejecutado personalmente por Chat #4): lint y tsc salida 0; contrapruebas con montadoRef antiguo, tercer efecto indebido y producto base hacen fallar las regresiones esperadas. Bateria adicional: 1258 pruebas, 1251 pasan y siete fallan; reproduce los mismos siete fallos contra base. Distribucion: hotelModalOrdenSecciones.test.ts (2), ocupacionBernaloUI3EWiring.test.ts (2), tarjetaCompletaBuscarAlojamiento.test.ts (2), tarjetaHotelExpandible.test.ts (1), por expectativas anteriores a #52 sobre UbicacionHotel/HotelModal. No se atribuyen a #54 ni se afirma bateria completa verde. Los resultados incompatibles descritos en el apartado historico de ronda 2 quedan sustituidos para las DOS pruebas adaptadas por las ejecuciones independientes de arriba.

P3 diferido, no bloqueante: tarjetaHotelCompartida.tsx dice cuando lo agregues, frase imprecisa al editar. Sigue fuera de alcance; no se exige ampliacion ni otro ciclo para aprobar #54. Se mantienen los ajustes aceptados de unidad (precioMostrado y montadoRef).

### Huellas auditadas (git hash-object; no commits)

- BuscadorBooking.tsx: 93ff5f40f188542230535461c8097416ebefb744
- VistaBooking.tsx: c275d9ff1cc660385561d0a92491ae195e49416c
- serviciosHotel.tsx: 60f6893df510fcd2bed719f505c40cfdee977871
- CartContext.tsx: 877f0f2b2b4ccfc5f5be32d2e60524f03eed11bb
- vinculoServicios.ts: 6fd8fd0a64c420a24a04d42ed4245935a7731f97
- servicioAdicionalPaquete.ts: 538976774d91b0d9b08dd51131c7a03405ae7a9a
- editarAddonsCarrito54.test.ts: e957b38d236eb495ccb92db0116b3c17e7e36bf6
- editarAddonsCarrito54.react.ts: 3a821304cb2d7c4bf0a793721a06b6b4dfa726fb
- editarAddonsCheckout54.react.ts: 418ab8651c1ec1ef6848bcef585e52ba98a55ed4

- servicioAdicionalTarjeta.react.ts (ronda 3): 3a3e4985156721c57975124eee6940dd8fdd5129
- busquedaPorcionTerrestreWiring.test.ts (ronda 3): 1b02821e008d2af029eeeb250dd7ef4d0151a4cc

### Siguiente gate y coordinacion

- **Bitacora lista para lectura del Coordinador: #54 APROBADO LOCALMENTE para su gate de PR; tres hallazgos resueltos y adaptaciones autorizadas verificadas 15/15 y 103/103.** Mismo Opus, mismo worktree. No quedan autorizaciones de pruebas pendientes. El Coordinador decide el gate global; el usuario conserva staging, commit, push, PR y merge. Esto no declara publicada, integrada ni cerrada la tarea.
- #54 no bloquea validacion de #35 ni avance de #32. Mantener coordinacion con #49 sobre VistaBooking.tsx si inicia cambios; no habilitar Bernalo comparativo ni cambiar contratos de #35.
- #52 mantiene seguimiento funcional de Produccion como registra el tablero; no se cierra por esta auditoria.
- Chat #4 solo audito y actualizo esta bitacora. Sin modificaciones de codigo/worktree, staging, commit, push, PR, merge, SQL remoto ni escrituras de prueba en Preview. Validacion de Vercel/app real sigue a cargo del usuario.



















## Gate del Coordinador suplente sobre #63 (2026-10-21)

**Contexto.** #62 ya esta fusionado (`2dd8c951`). Tambien estan en `main` #67 (220, `0d360b39`) y #50 (222/223, `2d5dff0e`). El contrato tecnico de este archivo se leyo sobre `9e4d1322` y quedo desfasado: #67 cambio `paquetes/actions.ts`, `[id]/page.tsx`, `ArmadoClient.tsx`, `ConfigForm.tsx`, `empaquetados-actions.ts`, `lib/reservar/computo.ts` y `lib/tarifario/datos.ts` (destinos aereos efectivos por paquete), y #50 cambio `app/tarifario/checkout/actions.ts`.

**Correccion de entendimiento del dueno (2026-10-20).** En los tiquetes no hay promociones ni tipos de promocion: "Promocion" es solo la etiqueta (`EmpaquetadosTabla.tsx:32,189`) de las salidas sin record de origen `empaquetados`. En #63, "promocion" significa exclusivamente "salida de origen empaquetados"; no hay motor de descuentos. El dueno no sabe por que se puede poner otra etiqueta: hay que ubicar ese campo y proponer si se fija.

**Revision tecnica (el suplente acepta):**
- **BNC en modo `impuesto_tipo=tiquete`:** se usa la `tarifa_para_empaquetar` final COP de la salida, igual que hoy en Bloqueo (paquetes/actions.ts, ver :673 de este archivo). El impuesto fijo se conserva cuando fue el elegido. `tarifa_proveedor` es solo costo/CxP.
- **Fuente o TRM cambiadas:** la salida ofertada queda invalidada hasta revision y regeneracion explicita. Un cambio de precio, fecha o TRM exige reconfirmar antes de una venta nueva, nunca un ajuste silencioso. Los documentos y pagos congelados no se tocan; si el vuelo ya no se puede cumplir, se bloquea la venta o conversion nueva.
- **Snapshot/CxP y persistencia atomica:** se aceptan como requisitos obligatorios.
- **Fee de infante:** el mismo importe es costo y precio, cobrado una vez y costeado una vez.
- **Servicios:** NETO con su MK. **Moneda:** las salidas aereas solo en COP por ahora, con moneda explicita en el modelo.
- **Destinos aereos (#67):** una salida de `empaquetados` solo es elegible si su destino pertenece a los destinos aereos efectivos del paquete (`destinos_aereos_efectivos_67`: el comercial, mas las alternativas cuando el check esta encendido). Se reutiliza la guarda de la 220; no se duplica.

**Numero de migracion:** se reserva la **224** para #63 (siguiente libre: 222/223 son de #50 y estan cerradas; 215 y 218 siguen reservadas). Es reserva de numero, no GO de SQL.

**Decision:** ciclo de **re-base del contrato** (solo diseno, en esta bitacora) sobre `origin/main` `2d5dff0e`. Despues, reserva de archivos y GO LOCAL. Sin codigo hasta entonces.


---

## #63 re-base sobre 2d5dff0e (2026-10-21)

**Ciclo de RE-BASE del contrato, SOLO DISENO. NO GO de codigo ni de SQL.** Re-ancla el contrato completo de este archivo (H/T/R/F, aceptacion E/F y CxP G de "contrato UNICO COMPLETO" y "SIN RECORD") sobre `origin/main` **2d5dff0e**, bajo el "Gate del Coordinador suplente" (prevalece donde difiera). Decisiones fijas del prompt, NO reabiertas: promocion = solo salida de origen empaquetados; varias salidas por paquete y alta manual; nuevas solo pendientes; aereas solo COP con moneda explicita; R (`tarifa_para_empaquetar`) precio final sin segundo MK/TA y N (`tarifa_proveedor`) costo/CxP; BNC tiquete = R, fijo conservado; F (fee infante) una vez como costo y una como precio; hotel/traslados/tours globales NETO con MK; TRM por paquete y tarifario COP convertido una vez; fuente o TRM cambiada invalida la salida hasta revision y regeneracion, sin ajuste silencioso y sin tocar lo congelado; elegibilidad por `destinos_aereos_efectivos_67` reutilizando la guarda de la 220; una sola migracion aditiva, **224**.

**Lectura y limites.** `git rev-parse origin/main` = 2d5dff0e (#50 `2d5dff0e`, #67 `0d360b39`, #68 `51ca079e`, #62 `2dd8c951`). Todo se leyo con `git show`/`git diff 9e4d1322 2d5dff0e` (sin worktree, sin fetch). No lei `.env*` ni `sitio-web/node_modules`. No se ejecuto codigo, pruebas ni SQL; las cifras de la seccion 4 son aritmetica manual contra las formulas leidas (`marcar` = costo/(1-mk) en `lib/calc/paquetes.ts:650`, `redondearVenta` COP = techo al mil, `:686`), NO salida de pruebas. Anclas `archivo:linea` son de 2d5dff0e.

### 0. Etiqueta "Promocion": donde se cambia y propuesta

- Es un literal de interfaz: `EstadoBadge estado="Promoción"` en `app/(dashboard)/dashboard/vuelos/EmpaquetadosTabla.tsx:189` (rama `f.origen !== "contrato"`, `:187-189`); el tipo `OrigenEmpaquetadoFila = "promocion" | "contrato"` esta en `:32`, y las filas se arman en `vuelos/page.tsx:293` y `vuelos/historico/page.tsx:189`. **No es una columna de `empaquetados` (migracion 156) ni un campo editable en pantalla**; para cambiar la palabra hay que editar ese literal y desplegar. No participa de precio ni de elegibilidad.
- Lo que SI es editable y operativo en esa familia: `record` (PNR), `estado_emision`, `estado_pago`, `activo`, tarifas y ventanas (`NuevoEmpaquetadoForm.tsx`, `ControlEmpaquetadoForm.tsx`, RPC `actualizar_control_empaquetado`).
- Colision de palabra: "Promocion" ya significa otra cosa en hoteles (`es_promocion`, temporadas Base/Promocion, migraciones 179/180; `ArmadoClient.tsx:68`, `lib/calc/paquetes.ts:613`). Es un riesgo de confusion para el editor nuevo, no un bug.
- **Propuesta (a ratificar, ver Q2):** dejar el literal fijo, sin campo ni tipos en BD; en el codigo y la UI de #63 evitar la palabra: texto de UI "Salida de Empaquetados", identificadores `salidaVinculada`/`..63` (los helpers nuevos del mapa ya evitan "promocion"). No renombrar la union tecnica `origen:"promocion"`.

### 1. Que cambio desde 9e4d1322, por archivo del mapa, y como encaja #63

Resumen: entre 9e4d1322 y 2d5dff0e cambiaron 107 archivos de `dspacios-travel/` (sin contar docs ni TASKS); los que tocan el mapa de #63 son estos. Migraciones nuevas: 219, 220, 221, 222, 223 (224 es la siguiente libre; 215 y 218 siguen reservadas).

| Archivo (prefijo dspacios-travel/) | Cambio desde 9e4d1322 | Ancla 2d5dff0e | Como encaja #63 |
|---|---|---|---|
| `app/(dashboard)/dashboard/paquetes/actions.ts` (+151/-12) | #62: `seleccionarSalidasVigentes` en `generarTarifario` y error de lectura que ya aborta. #67: imports, `PaqueteConfig` con `destinosAereosAlternativos/Ids` (opcionales), `entradaDestinosAereos`, `crearPaquete` (RPC `guardar_destinos_aereos_67`), `actualizarPaquete`, `listarDestinosAereosCandidatos`, validacion de lote en `setVuelo/setTodosVuelos`, guarda de destino en `generarTarifario` **solo `tipo==="bloqueo"`**. SIN cambio: rama dinamico, `filasHoteles`, moneda, servicios, publicacion, CRUD de salidas. | #62 `:20`, `:1156-1160`, `:1179-1183`; #67 `:21-31`, `:86-92`, `:144-152`, `:155-185` (RPC `:174`), `:189-213` (`:199`,`:201`), `:216-233`, `:245`, `:277`, guarda `:1074-1097` (`permiteDestinoAereo :1082`, filtros `:1110`,`:1142`); sin cambio: dinamico `:1231-1246` (BNC `valor_tiquete` `:1243`), `filasHoteles :956-1060` (**sin caso especial para infante**, `:1008`,`:1029`), moneda `:775-795`, servicios `:1258-1301`, publicar `:1334`, CRUD salidas `:1511-1565` | Rama vinculada dentro del bucle de salidas; ampliar la guarda `:1074` a dinamico reutilizando `resolverDestinosAereosPaquete/leerInfoFuentes/motivoRechazoFuente`; alta/baja de vinculos en lote idempotente (sin regenerar solo); TRM/modo en `PaqueteConfig/configToRow`; publicar por la RPC extendida (seccion 3) |
| `paquetes/[id]/page.tsx` (+29/-2) | #67: efectivos de la 220, `.in("destino_id", idsAereos)` para vuelos y empaquetados | `:34-41`, `:50`, `:62`; sin cambio: salidas `select("*")` `:106`, `monedaPaquete` inferida del hotel USD `:109` | Candidatos = `empaquetadosDisp` (ya filtrado por la 220) + filtros 63 (activo, compra, viaje no pasado, moneda, record); marcar vinculadas; la moneda ya no se infiere del hotel en modo 63 |
| `paquetes/[id]/ArmadoClient.tsx` (+44/-10) | #67: error tecnico de destinos aereos, errores de vinculo, etiqueta de destino aereo por fila (solo Bloqueo) | `:86-98`, `:193-285`; editor dinamico `:300-302`; **servicios `:354-355` ya son globales, sin condicion de tipo** | Solo paso de props al editor y estado de revision. **Correccion al mapa anterior:** no hace falta una seccion nueva "Traslados/Tours": el armado de servicios ya es por paquete y comun a todas las salidas |
| `paquetes/ConfigForm.tsx` (+78/-2) | #67: bloque de destinos aereos | envio `:141` y bloque `:194-210`, ambos **solo `tipo==="bloqueo"`** | Extender el bloque a `dinamico` (hoy un Dinamico no puede configurar alternativas aunque #63 las consume) y agregar modo/TRM |
| `paquetes/[id]/SalidasDinamicasEditor.tsx` | SIN cambio | editor manual completo, moneda del paquete `:61`, campos `valorTiquete/aplicaMk/ta/feeInfante` | Separar manual de vinculada (solo lectura de datos de la fuente), seleccion multiple, pendientes, estado de revision |
| `vuelos/empaquetados-actions.ts` (+12/-1) | #67: `setEmpaquetado/setTodosEmpaquetados` validan la 220 (tabla `armado_empaquetados`, solo Bloqueo) | `:286-340` | No entra (ver seccion 2) |
| `lib/reservar/computo.ts` (+46) | #62: vigencia de salida **manual** (lee 4 columnas) con cliente de servicio; #67: destino aereo solo para origen bloqueo/empaquetado; #42: `ref` en `PasajeroReserva`. SIN cambio: lectura de precio de `tarifario_resultado_publicable`, infante, BNC, servicios | #62 `:278-287`; #67 `:299-307`; #42 `:70`; precio `:522-545`; infante `:499-501`,`:685`; **BNC `:977-986` lee solo `impuesto_fijo` x `paxConSilla`**, aun con `impuesto_tipo=tiquete`; servicios `:757-870`, grupo incluido `:930-970` | Rama vinculada en `:278` (resolver salida->fuente) y llamar `validarOrigenAereoPaquete` con la fuente derivada (no duplicar la 220); BNC por resolver puro para vinculadas; servicios USD->COP con la TRM del paquete; legacy intacto |
| `lib/reservar/salidaDinamicaVigente.ts` (nuevo por #62, 162 l.) | Elegibilidad solo de salida manual: `activo`, `fecha_ida`, ventana de compra propia | `COLUMNAS_VIGENCIA_SALIDA`, `evaluarSalidaDinamica`, `verificarSalidaDinamicaVigente`, `salidasDinamicasVigentes` | Extender con la fuente vinculada (activo, compra, record) sin romper la firma que usan generar/cargar/computar |
| `lib/paquetes/destinosAereos67.ts` (nuevo por #67, 536 l.) | Fuente unica de la regla 220 | `motivoRechazoFuente :210`, `resolverEfectivosPorPaquetes :228`, `leerInfoFuentes :286`, `validarLoteOrigenesAereos :315`, `validarOrigenAereoPaquete :352`, **`filtrarFilasPorOrigenAereo :377` solo `modulo==="bloqueo"`**, **`vinculosIncompatibles :429` solo `armado_vuelos/armado_empaquetados`**, `mensajeErrorBase :510` | **Reserva nueva** (no estaba en el mapa anterior): extender `filtrarFilasPorOrigenAereo` a filas con `salida_id` (salida -> `empaquetado_id`) y `vinculosIncompatibles` a salidas vinculadas, sin segunda regla de pais |
| `lib/tarifario/datos.ts` (+44), `lib/tarifario/filtrosPostCarga.ts` (+59), `lib/tarifario/resumen.ts` (+13), `app/tarifario/detalle-actions.ts` (+27) | #62 y #67 enchufan los dos helpers anteriores y propagan `errorSalida/errorOrigenAereo` | `datos.ts:267-307` (el propio archivo dice que no tiene llamadores de produccion), `filtrosPostCarga.ts:82-130`, `resumen.ts:345-364`, `detalle-actions.ts:147-165`,`:322-334` | Si la extension vive en los dos helpers compartidos, estos cuatro quedan SIN diff y solo se prueban (el filtro de `empaquetado_id` de filas, `filtrosPostCarga.ts:82-100`, no aplica porque la fila dinamica lleva `salida_id`, no `empaquetado_id`) |
| `app/(dashboard)/dashboard/reservar/actions.ts` (+117/-70) | #42 en `crearCotizacion` (`ref` de pasajeros, alta en registro de personas); #57 en `reservarProgramaInterno` (fuera de #63). SIN cambio en `reservarDesdeTarifarioInterno` | #42 `:1006-1030`,`:1157-1178`; #57 `:2884-3300`; `resolverDatosVuelo :221`; `infantesN :241` (de `input.infantes` crudo) y `costoAereo :246`; `pushCxP :706` sin `moneda`; CxP aerea `:727`; tramos `:602-640`; snapshot de vuelo `:1054-1075` con `origen.tipo==="salida" ? null` en `:1060-1061`; `convertirCotizacion :1185` (sin guarda de precio; el carrito solo compara moneda `:1819-1828`) | Solo `crearCotizacion/convertirCotizacion/reservarDesdeTarifarioInterno` y sus dependencias privadas en modo 63, preservando #42; el diff de #57/#50 no se toca |
| `app/tarifario/checkout/actions.ts` (+73/-18) | #42 (alta de personas), #50 (modalidad PVP/NETO de la hija B2B) | #42 `:1056`,`:1364`,`:1465`; #50 `:1392-1446`; items del carrito solo `bloqueoId` (`:62`,`:707`) | **Sin cambio**: el carrito no transporta `salidaId` ni `empaquetadoId`, Dinamico no viaja por checkout (confirma "fuera de alcance") |
| #50 (222/223) | `cotizacion_neto*`, esquema privado `p50_priv`, `convertir_cotizacion_manual_controlada`, `registrar_validacion_comparativa_n50` | solo comparativa manual | Sin cruce de funciones con #63 (no toca `computo` ni `registrar_financiero_contrato`); sirve de patron de convenciones (esquema privado + tablas solo-insercion con trigger) |
| `types/database.ts` (+182) | secciones de #42/#62/#67/#68/#50 | `salidas_dinamicas :15-31` (sin moneda ni `empaquetado_id`, `fecha_ida: string`), `armado_paquetes :2359+` | Solo secciones nuevas y las columnas agregadas |
| **Sin diff desde 9e4d1322** | | `lib/calc/paquetes.ts` (`marcar :650`, `aporteVuelo :660`, `redondearVenta :686`, `componerTarifa :691`, `factorLiquidacion :751`); `lib/reservar/empaquetadoOrigen.ts` (`datosVueloSalida :149-175`: `costo_neto=valor_tiquete`, proveedor `null`); `incluidosCotizados.ts`; `origen.ts :80-83`; `ReservaForm.tsx :162-165` (el total visible **no suma infante**); `EmpaquetadosTabla.tsx`; `ControlEmpaquetadoForm.tsx`; `lib/contabilidad/asientos.ts`, `asegurarCuentasPorPagar.ts`, `cxpCobertura.ts`, `reconciliacionFinanciera.ts`, `financieroContrato.ts`, `contratos/actions.ts`, `contratos/[numero]/gestion-actions.ts`; migraciones 171/172/210 | Los anclajes del contrato anterior en estos archivos siguen validos |

**Hallazgos de la relectura sobre 2d5dff0e** (todos por lectura; ninguno reproducido):
1. La 220 NO cubre Dinamico en seis puntos: `generarTarifario :1074` (solo bloqueo), `filtrarFilasPorOrigenAereo :377` (solo bloqueo), `vinculosIncompatibles :429`, SQL `validar_config_destinos_aereos_67` (220 `:251`, solo `armado_vuelos/armado_empaquetados`), triggers de invalidacion de la 220 (`:400-441`, abanico solo por `armado_*`), `ConfigForm :141/:194` y `computo :299` (solo origen bloqueo/empaquetado). La propia 220 declara que los vinculos de Dinamico son tarea de #63 (cabecera de la 220, "QUE NO HACE").
2. La 181 ya invalida cuando cambia un empaquetado (`tarifario_trg_empaquetados`, `m181:407-412`, columnas `activo, compra_*, tarifa_para_empaquetar, fecha_*, ruta`), pero el abanico es solo por `armado_empaquetados` (`:389-405`), no por `salidas_dinamicas`, y NO escucha `tarifa_proveedor`, `fee_infante`, `proveedor_id`, `record`, `moneda`, `aerolinea`, `vuelo_*`, `hora_*`. Un cambio de costo o de record hoy no invalida nada.
3. La invalidacion de la 181 ya bloquea lecturas: `tarifario_invalidar(ids, true)` pone `tarifario_snapshot_publicable=false` y la vista `tarifario_resultado_publicable` (182) oculta las filas hasta una publicacion exitosa; `publicar_tarifario_resultado` (`m181:662-868`) compara generacion y revision capturadas y devuelve `false` si la fuente cambio durante el calculo. Es el mecanismo base de "sin ajuste silencioso", pero **a nivel de paquete completo**, no de salida (ver Q3).
4. `publicar_tarifario_resultado` inserta una lista FIJA de columnas e **ignora la `moneda` por fila** (usa `p_moneda`): no puede llevar TRM, snapshot ni huellas; hay que envolverla (seccion 3).
5. `RLS` de `empaquetados` (156): `SELECT` abierto tambien a `venta` y `control_vuelo` (`"empaquetados: lectura operativa"`), es decir **`tarifa_proveedor` (neto) ya es legible por esos roles por la API**, independiente de #63. Choca con el requisito "sin exposicion de netos" (Q11).
6. El generador no trata distinto al infante: `filasHoteles` aplica a la fila `infante` el mismo `aporteVueloVal` (vuelo completo) y los servicios incluidos por persona (`paquetes/actions.ts:1008`,`:979`). El contrato 63 lo define distinto solo para vinculadas (F en lugar del vuelo adulto). Es comportamiento legacy que #63 no debe tocar (Q5).
7. `convertirCotizacion` (simple) re-liquida con el precio publicado vigente y **no compara el precio cotizado** (solo la rama de carrito compara moneda, `:1819-1828`; el precio solo se compara en Bernalo y comparativas). Un regenerado cambia el precio al convertir en silencio para cualquier paquete; #63 necesita una guarda propia para vinculadas (Q7).
8. La CxP del flujo persona no manda `moneda` (`pushCxP :706`; las RPC 171/172/210 caen a `'COP'`, `:147`/`:311`/`:172`), mientras que el flujo Bernalo/carrito si la manda (`:2311`,`:2558`). #63 debe enviarla explicita (Q8).
9. El costo aereo usa `input.infantes` crudo (`:241`,`:246`) mientras el precio usa los infantes reclasificados por edad de `computarReserva`; en vinculadas el costo debe consumir la clasificacion del motor (Q6).
10. `salidas_dinamicas.fecha_ida` es NOT NULL y la tabla no tiene moneda; `valor_tiquete` esta comentado "en la moneda del paquete" (094). Para manuales hay que acreditar la moneda antes de activar el modo 63, como ya fija el contrato.
11. Cartera y checkout no necesitan cambios: confirma la exclusion de carrito/comparativas.
12. `ReservaForm.tsx :162-165` sigue sin sumar infante en `totalHotel` (hallazgo del contrato anterior, vigente).

### 2. Mapa actualizado (rutas relativas a `dspacios-travel/`, salvo workflow en la raiz)

**ENTRAN (editar, mismo alcance acotado del contrato "UNICO COMPLETO"):**
- UI/catalogo: `app/(dashboard)/dashboard/paquetes/[id]/SalidasDinamicasEditor.tsx`, `paquetes/[id]/page.tsx`, `paquetes/[id]/ArmadoClient.tsx` (solo paso de props y banner de revision), `paquetes/ConfigForm.tsx` (bloque 220 tambien en Dinamico + modo/TRM), `paquetes/actions.ts` (rama vinculada, lote de vinculos, TRM/modo, publicacion extendida), `reservar/nuevo/ReservaForm.tsx` (total con infante, opcionales en COP normalizado, reconfirmacion).
- Motor: `lib/calc/paquetes.ts` (solo helpers puros modo 63 al final del archivo, legacy intacto), `lib/reservar/computo.ts`, `lib/reservar/empaquetadoOrigen.ts` (`datosVueloSalida` resuelve la fuente: `costo_neto=tarifa_proveedor`, proveedor, record, F), `lib/reservar/salidaDinamicaVigente.ts`, `lib/reservar/incluidosCotizados.ts` (solo si una prueba demuestra necesidad: costos de incluidos en moneda origen).
- Servidor de venta: `app/(dashboard)/dashboard/reservar/actions.ts` (`crearCotizacion`, `convertirCotizacion`, `reservarDesdeTarifarioInterno` y dependencias privadas modo 63; sin Programas, carrito ni comparativas).
- Financiero acotado (sin cambios de politica): `lib/contabilidad/asientos.ts` (solo `postearAsientoCxP`), `lib/reservar/asegurarCuentasPorPagar.ts` (solo obligaciones 63), `contratos/[numero]/gestion-actions.ts`, `contratos/actions.ts` (solo rechazos de edicion que contradigan snapshot/CxP 63).
- `types/database.ts` (solo secciones nuevas).
- Nuevos propuestos: `lib/reservar/{ofertaDinamica63,payloadFinanciero63,prepararOferta63,importeObligacion63}.ts` (sin la palabra "promocion").

**NECESITAN RESERVA NUEVA respecto del mapa anterior:**
1. `lib/paquetes/destinosAereos67.ts` (obligatorio: extension de `filtrarFilasPorOrigenAereo`, `vinculosIncompatibles` y la fuente `FuenteAerea`, hallazgo 1; sin ella la regla de pais se duplicaria).
2. `app/(dashboard)/dashboard/reservar/nuevo/page.tsx` (condicional: lee filas por `salida_id` en `:30-40`; solo si la revision opaca/moneda 63 debe viajar al formulario).
3. `vuelos/EmpaquetadosTabla.tsx` (una linea, solo si se aprueba el badge por PNR de Q2).
4. Documentacion al cierre (regla del CLAUDE.md de la raiz): `docs/tecnico/tarifario-y-paquetes.md` y `docs/tecnico/reservar.md`.
5. Archivos SQL/CI nuevos de la 224 (seccion 3.8).

**SALEN del mapa (con motivo y condicion de reentrada):**
- `vuelos/empaquetados-actions.ts`, `vuelos/empaquetados/NuevoEmpaquetadoForm.tsx`, `vuelos/empaquetados/[id]/EditarEmpaquetadoForm.tsx`: la moneda explicita de la fuente vive en la columna `empaquetados.moneda` con DEFAULT/CHECK `COP` de la 224; las acciones y formularios actuales siguen insertando sin tocarla. Reentran si Q9 pide mostrar/validar la moneda en el formulario o avisar "este vuelo esta vinculado a N paquetes".
- `lib/tarifario/datos.ts`, `lib/tarifario/filtrosPostCarga.ts`, `lib/tarifario/resumen.ts`, `app/tarifario/detalle-actions.ts`: quedan solo con pruebas porque consumen los helpers compartidos (`salidaDinamicaVigente.ts`, `destinosAereos67.ts`). Reentran si la prueba roja de "salida vinculada con fuente inactiva/destino movido no se muestra" no pasa sin tocarlos.
- `lib/reservar/origen.ts`: el discriminante sigue siendo `salidaId` (rechaza `empaquetadoId` en dinamico, `:80-83`); las filas vinculadas publican `salida_id` y `empaquetado_id` NULL.
- `app/tarifario/checkout/actions.ts`, `lib/cart/**`, comparativas: confirmado fuera (hallazgo 11).
- `app/(dashboard)/dashboard/paquetes/[id]/ArmadoClient.tsx` pierde su alcance de "categorias globales Traslados/Tours" (ya existe, `:354`); queda en paso de props.

**Cruces a verificar al GO** (no resueltos aqui): worktree `tarjetas` (reservar/actions.ts y computo.ts, ver memoria del proyecto); el diff final de #57/#50 sobre `reservar/actions.ts` antes de fijar firmas; TASKS/WORKSTREAMS vigentes.

### 3. Contenido de la 224 y convivencia con la 220

Nombres provisionales; sufijo `_63` y esquema privado `p63_priv` (convencion de `p50_priv`/`p214_priv`). **No se edita 181/210/220; se reutilizan por llamada, no por copia.**

**3.1 Columnas en tablas existentes**
- `empaquetados.moneda text not null default 'COP'` + CHECK solo `'COP'` (futuro USD = migracion propia). El DEFAULT rellena las filas actuales como COP, que es lo confirmado por el dueno el 2026-10-19 (ver Q9).
- `salidas_dinamicas`: `empaquetado_id bigint` FK `ON DELETE RESTRICT` a `empaquetados`; `moneda text` (NULL = manual legacy, `'COP'` obligatoria si es vinculada); `moneda_acreditada` (moneda de tiquete/TA/fee de las manuales, capturada al activar el modo 63 desde `armado_paquetes.moneda` publicada; si nunca se publico no se puede acreditar y se bloquea la activacion); `fecha_ida` pasa a admitir NULL; CHECK de dos formas: manual = `empaquetado_id is null` con `fecha_ida not null`; vinculada = `empaquetado_id not null`, `moneda='COP'` y SIN datos propios de vuelo ni precio (`valor_tiquete=0`, `aplica_mk=false`, `ta=0`, `fee_infante=0`, fechas/ruta/horas/compra NULL), de modo que la fuente se lee viva y no hay copia que diverja; indice unico parcial `(paquete_id, empaquetado_id) where empaquetado_id is not null`; trigger que impide cambiar `empaquetado_id` (re-vincular = quitar y agregar).
- `armado_paquetes`: modo de precio (`legacy` por defecto | `cop_trm_63`) y `trm_armado numeric` (COP por 1 USD, CHECK positiva y finita si el modo es 63; **sin fallback a 1**). Cambiar modo o TRM es una fuente invalidante.
- No se agregan columnas a `tarifario_resultado`: las filas vinculadas publican `salida_id` (`empaquetado_id` NULL) y la 181 inserta una lista fija de columnas (hallazgo 4).

**3.2 Tablas privadas (`p63_priv`, sin `USAGE` para `anon/authenticated`, accesibles solo por RPC de servicio; no exponen netos por REST/GraphQL)**
- Oferta publicada: por paquete y revision publicada: modo, TRM, huella del conjunto y, por salida/componente, moneda y neto de origen, TRM, equivalente COP, MK, aporte, proveedor (id), R, N, F, regla de BNC. Inmutable (trigger solo-insercion como `tg_solo_insercion` de la 222).
- Aceptacion/intento: cotizacion, clave de idempotencia, revisiones T0, snapshot completo, estado (`preparado|materializando|completo|descartado|requiere_revision`), numero reservado, reclamo/lease.
- Obligaciones: por componente y proveedor, moneda y monto de origen, TRM, equivalente COP congelado, vinculo atomico a la CxP creada, retencion.
- Marcador 63 de la venta (para que `asegurarCuentasPorPagar` distinga "no es 63" de "falla de lectura").

**3.3 Funciones/RPC (SECURITY DEFINER con `search_path` fijo; solo `service_role` salvo indicacion; candado de rol interno como en 181/220)**
- `publicar_tarifario_resultado_63`: envuelve la RPC de la 181 y, **en la misma transaccion**, escribe la oferta privada, TRM y revision; si cualquiera falla o la revision cambio, no se publica nada. Los paquetes `legacy` siguen llamando a la 181 sin cambios.
- Alta/baja de vinculos en lote idempotente: valida cada empaquetado en SQL (existe, activo, compra, viaje, **record ausente segun Q1**, moneda, destino) y deja el estado "pendiente de generar"; no publica.
- `crear_cotizacion_oferta_63` y `aceptar_oferta_63` (captura T0; al convertir: candados en orden fijo, comparar revision publicada/fuente/config/huella financiera, revalidar compra/activo/fechas/destino/moneda/TRM **en SQL con la fecha de Bogota**, reservar numero y persistir snapshot, todo en una transaccion).
- Materializacion: cabecera de la venta bajo trigger BEFORE INSERT con intento vigente (fencing), pasos acotados que consumen solo el snapshot, finalizacion con payload derivado.
- **H:** redefinir `registrar_financiero_contrato` con la misma firma (la 210 intacta como archivo): contratos 63 derivan costos/CxP/monedas del snapshot y rechazan payload alternativo, incluida llamada directa y reconciliador; contratos legacy conservan la semantica de la 210 exacta, incluido `ya_completo` primero.
- Guarda de vinculo de salida (reutiliza la 220): trigger de restriccion DIFERIDO sobre `salidas_dinamicas` que, si hay `empaquetado_id`, llama `validar_vinculo_aereo_67(paquete,'empaquetado',fuente)` y exige que el paquete sea `dinamico`.
- Guarda de configuracion (nueva, no reemplaza la 220): `p63_priv.validar_salidas_vinculadas(paquete)` en triggers de restriccion diferidos sobre `armado_paquetes` (destino, check de alternativas, tipo) y `armado_paquete_destinos_aereos`; calcula con `destinos_aereos_efectivos_67` y rechaza con el mismo prefijo `destino_aereo_vinculos` para que `mensajeErrorBase` (`destinosAereos67.ts:510`) siga funcionando.

**3.4 Triggers de invalidacion (usan `tarifario_invalidar` de la 181)**
- Sobre `empaquetados`, abanico por `salidas_dinamicas.empaquetado_id` (bloquea): cambios en `tarifa_para_empaquetar, tarifa_proveedor, fee_infante, proveedor_id, aerolinea, vuelo_*, hora_*, fecha_*, ruta, destino_id, moneda, activo, compra_*` **y `record`** (con `trim`), cubriendo lo que la 181/220 no escuchan.
- Sobre `armado_paquetes`: modo de precio y TRM.
- La 181 ya cubre altas/bajas/cambios de `salidas_dinamicas` (`m181:416-433`).
- Inmutabilidad y proteccion: snapshots solo-insercion; CxP 63 con trigger que rechaza cambiar principal/moneda/proveedor/retencion sin flujo autorizado, sin bloquear abonos/pagos ya permitidos.

**3.5 RLS/ACL.** Tablas privadas: ningun `grant` a `anon/authenticated`; lectura solo por RPC de servicio con autorizacion previa en servidor (sesion, rol, tenant). `salidas_dinamicas` conserva su politica interna de la 094 (`superadmin/gerencia/administracion/operaciones`); `venta` no la lee. Auditoria 087: adjuntar el trigger solo donde no duplique costos innecesariamente (decision de implementacion, a confirmar en la reserva). Pruebas por REST y GraphQL con JWT de cada rol, y sonda de que el neto no se filtra por `empaquetados` (Q11).

**3.6 Convivencia con la 220**
| Objeto 220 | Que hace la 224 |
|---|---|
| `destinos_aereos_efectivos_67`, `pais_comparable_67`, `validar_vinculo_aereo_67` | Se LLAMAN; no se copian ni se redefinen |
| `validar_config_destinos_aereos_67` (solo ve `armado_vuelos/armado_empaquetados`) | Queda tal cual; se agrega una guarda hermana para salidas vinculadas con los mismos triggers diferidos |
| `trg_invalidar_origen_aereo_67` (abanico por `armado_*`) | Queda; se agrega abanico por salidas (3.4) |
| `guardar_destinos_aereos_67` (atomica, INVOKER) | Sin cambios; las guardas diferidas de la 224 se evaluan en el mismo COMMIT, de modo que un guardado que dejaria una salida vinculada fuera de los destinos efectivos falla completo |
| Tablas `armado_paquete_destinos_aereos`, columna `destinos_aereos_alternativos` | Sin cambios; ConfigForm las expone tambien en Dinamico |
- **Orden de aplicacion y rollback:** 224 va despues de 220/181/210; sus objetos dependen de funciones 220/181. El rollback de la 224 debe correr antes que el de la 220 y se NIEGA si existen salidas vinculadas, ofertas/aceptaciones o paquetes en modo 63 (forward-only tras uso, como pide el contrato).
- **Prueba de no regresion de la 220 en el postcheck:** comparar `pg_get_functiondef` de las funciones 220/181/210 con el estado del preflight para demostrar que no se redefinieron (salvo `registrar_financiero_contrato`, que si se redefine y tiene su propia prueba de paridad legacy).
- **Orden de candados** (una sola secuencia para publicar, vincular, aceptar y financiar, a probar con sesiones reales como `test_220_carrera.sh`): paquete -> salida -> fuente (`empaquetados`, FOR SHARE) -> oferta/intento -> venta. La 220 y la 181 ya toman el paquete primero.

**3.7 Preflight / postcheck / rollback**
- Preflight (solo lectura): existen los objetos de 181/182/210/220; `salidas_dinamicas` sin filas incompatibles con los CHECK nuevos (todas manuales con `fecha_ida`); `empaquetados` sin nulos que impidan el DEFAULT; salidas vinculadas/ofertas = 0 (primera aplicacion); lista de paquetes Dinamico con salidas manuales (para acreditar moneda antes de activar el modo).
- Postcheck: columnas, CHECK, indice unico parcial, triggers, firmas y ACL de cada funcion, `anon` bloqueado, tablas privadas sin `grant`, 220/181/210 sin redefinir, `registrar_financiero_contrato` legacy identico en salida.
- Rollback seguro solo sin uso.

**3.8 Archivos SQL/CI nuevos (nombres propuestos)** `supabase/migrations/20260601000224_salida_vinculada_empaquetado.sql`; `supabase/scripts/{preflight,postcheck,rollback}_224_*.sql`; `supabase/scripts/test_224_{fases.sh,carrera.sh,api.sh,*.sql}`; workflow raiz `.github/workflows/test-224-salida-vinculada-63.yml` (el nombre `test-promociones-dinamicas-63.yml` del mapa anterior se descarta por la regla de no usar "promocion"). Misma forma del `test-220-destinos-aereos-67.yml`: solo lectura (`permissions: contents: read`), sin secretos ni Supabase remoto, sin `pull_request_target`, acciones fijadas por SHA (el checkout `11bd7190...` v4.2.2 de la 220), imagen de Postgres/PostgREST desechable, `set +e` antes de cada pipeline con `tee` y comprobacion explicita de marcas OK, y un segundo job de pruebas TS/React en imagen Node con version exacta. Esquema base: `preparar_esquema_local.sh "$CT" 223 "$PLANTILLA"` (la 224 es la mas alta, no hace falta la copia sin archivo de la 220).

### 4. Matriz de pruebas actualizada (PLAN; ninguna ejecutada; cifras a mano)

Parametros comunes: MK del paquete 20% (`marcar = costo/0,8`), COP con techo al mil por fila, R = 1.130.000, N = 1.000.000 (FX1) o 900.000, F = 80.500 (FX1).

**FX1 (fixture del contrato, TRM 4.000):** 2 adultos (1 hab doble) + 1 infante. Hotel adulto neto USD 100 -> 400.000 -> **500.000**; tour incluido por persona neto USD 10 -> 40.000 -> **50.000**; hotel infante neto USD 10 -> 40.000 -> 50.000.
- Adulto: 500.000 + 50.000 + 1.130.000 = **1.680.000**. Infante (sin tour): 50.000 + F 80.500 = **130.500**. Total **3.490.500**.
- Costos: hotel USD 210 = COP 840.000; tour USD 20 = COP 80.000; aereo 2 x 1.000.000 + 80.500 = **2.080.500**. Venta aerea 2 x 1.130.000 + 80.500 = 2.340.500.
- CxP en origen: hotel USD 210 (`moneda` USD), tour USD 20 (USD), aereo COP 2.080.500; `ventas.costo_hotel` 840.000, `costo_aereo` 2.080.500; asientos 840.000/80.000/2.080.500; `asegurarCuentasPorPagar` devuelve 0 (no compara USD 210 con COP 840.000).
- BNC tiquete: 2 x 1.130.000 = 2.260.000 -> base 1.230.500. BNC fijo 100.000 x 2 = 200.000 -> base 3.290.500. El infante no genera BNC.
- Variantes: sin tarifa de hotel infante -> infante = F = 80.500, total 3.440.500, costo hotel USD 200; F = 0 y sin hotel infante -> fila 0, total 3.360.000; hotel infante USD 10,075 -> 40.300 -> 50.375 -> redondeo 51.000, infante 131.500 (el ajuste de 625 queda en la parte hotel; F exacto); si el tour SI aplicara al infante (comportamiento actual del generador) -> infante 180.500, total 3.540.500 (Q4).
- Deben FALLAR: F cobrado dos veces (total 3.571.000); R usado en la fila infante (infante 1.180.000, total 4.540.000); MK sobre R (R/0,8 = 1.412.500, adulto 1.963.000); doble conversion o ninguna conversion de TRM.

**FX2 (COP puro, redondeo y BNC):** hotel neto 413.700 -> 517.125; PVP adulto = 517.125 + 1.130.000 = 1.647.125 -> **1.648.000** (el redondeo cae una sola vez sobre el total, R no se redondea aparte). BNC tiquete 1.130.000 -> base **518.000**; BNC fijo 100.000 -> base **1.548.000**; con 2 adultos `impuestoTotal` 2.260.000 / 200.000 (hoy `computo :977-986` daria 200.000 en ambos modos para esta salida: debe fallar si no se corrige). Fila vinculada con `ta = 50.000` o `aplica_mk` verdadero debe ser rechazada por el CHECK; con doble margen el resultado seria 1.930.000 (debe fallar).

**FX3 (USD y TRM no redonda):** TRM 3.987,65; hotel neto USD 103,50 -> 412.721,775 -> /0,8 = 515.902,21875 -> + 1.130.000 = 1.645.902,22 -> **1.646.000**. Cambio de TRM a 4.010,00 -> 415.035 -> 518.793,75 -> 1.648.793,75 -> **1.649.000**: el paquete queda bloqueado (`snapshot_publicable=false`), la vista publicable devuelve 0 filas, la cotizacion de 1.646.000 NO se convierte (rechazo con el nuevo importe) y un contrato ya aceptado conserva 1.646.000 y sus CxP. Tour opcional por persona USD 50 por noche, 3 noches, misma TRM: 199.382,5 -> 249.228,125 x 3 = 747.684,375 -> **748.000**. TRM ausente, cero, negativa o NaN con componente USD: no genera. Servicio en COP en modo 63: sin conversion.

**FX4 (tres salidas, hotel y servicios globales):** neto hotel 100.000 por noche y persona, tour incluido por noche neto 20.000 (`marcar` = 25.000 x noches), R de 1.130.000 / 1.250.000 / 1.390.000 para 3 / 4 / 5 noches. Adulto: S1 375.000 + 75.000 + 1.130.000 = **1.580.000**; S2 500.000 + 100.000 + 1.250.000 = **1.850.000**; S3 625.000 + 125.000 + 1.390.000 = **2.140.000**. Un servicio por grupo (neto 600.000 -> 750.000) se cobra **una vez por reserva**, no por pasajero ni por salida. Doble clic o N intentos concurrentes de "agregar todas" dejan exactamente N salidas.

**FX5 (elegibilidad por 220):** comercial Juan Dolio (RD, activo, id A), alternativas {SDQ (RD, activo, B)} con check encendido, PUJ (RD, inactivo, C), MIA (EE. UU., D). Efectivos {A, B}. Fuente a A o B: elegible; a C o D: rechazada (inactivo / otro pais); check apagado: solo A. Apagar el check o quitar B con una salida vinculada a B: el guardado falla completo con `destino_aereo_vinculos` (SQL) y la pre-validacion TS lo anticipa; un cambio de pais/estado de B oculta la salida en lectura por la regla viva y deja registrada la revision (la invalidacion de la 220 es NO bloqueante, 220 seccion E). Dinamico con check encendido desde `ConfigForm`.

**FX6 (fuente cambiada y congelado):** FX2 con R 1.130.000 -> 1.150.000 (sin tocar nada mas): snapshot bloqueado, `computo` rechaza con mensaje de revision (no "tarifa no encontrada"), tras regenerar el adulto es 1.668.000 y la cotizacion de 1.648.000 se rechaza al convertir con el importe nuevo. Cambio solo de `tarifa_proveedor` (900.000 -> 950.000, PVP igual 1.648.000): invalida la aceptacion pendiente aunque el PVP no cambie. Contratos ya aceptados: precio y CxP intactos. Asignar `record` despues del vinculo: invalida la oferta no aceptada y no borra vinculo ni PNR; quitar el `record` deja la fuente como candidata pendiente, no la agrega sola (Q1).

**FX7 (clasificacion de infantes):** `input.infantes = 1` pero la fecha de nacimiento lo clasifica nino: costo aereo y precio usan la clasificacion del motor (Q6). Hotel Adults Only: rechaza menor y no crea filas vendibles invalidas.

**Capas y casos obligatorios**
- U, unitarias puras: conversion unica antes de MK; R/F sin MK/TA; redondeo; BNC en dos modos; infante con hotel presente/ausente/F=0/no multiplo de 1.000; servicios persona/grupo/incluido/opcional/noche/dia; paridad de cada formula TS contra su espejo SQL con los mismos vectores.
- G/C, consumidores reales con fronteras simuladas (como `pruebas/destinosAereosFlujos67.test.ts`, reutilizando `destinosAereos67Soporte.ts`): generar -> resumen/detalle -> cotizar -> convertir -> CxP/asiento/recuperacion, con un mismo precio COP, revision, BNC y deuda de origen en todo camino; carrito/comparativa sin cambio.
- R, React por comando directo (sin tocar `package.json`): seleccion 0/1/N/todas revisadas, pendientes futuras no agregadas, destino equivocado, errores sin duplicado, `ReservaForm` total con infante, reconfirmacion repetida.
- S, SQL en CI desechable (tras aplicar 001-223): preflight, aplicacion, postcheck, idempotencia, rollback sin uso y rechazo con uso; CHECK de las dos formas de `salidas_dinamicas`; guardas diferidas; invalidaciones incluido `record`, `tarifa_proveedor` y `fee_infante`; publicacion atomica extendida; H legacy identica a la 210 y H 63 rechaza payload alterado incluida llamada directa; `ya_completo` inmutable.
- K, carreras y cortes (sesiones reales, auto-abortables): doble clic; reclamo viejo antes de cabecera sin retomar despues; proceso muerto tras aceptar, tras numero, tras cabecera, tras cada hija, tras `guardarPendiente` y tras la RPC financiera; respuesta perdida; reconciliador; configuracion/fuente/TRM cambiando entre T0 y aceptacion y contra el primer pago; sin doble contrato, doble CxP ni doble fee.
- A, API/RLS/GraphQL: `venta`, `anon`, otro tenant sin acceso a oferta/snapshot/obligaciones; sonda del neto en `empaquetados` (Q11).
- W, regresion: manual sin vinculo y paquete COP/USD legacy sin cambios; #62 (vigencia), #67 (Bloqueo/Sistema), #42/219 (altas de personas), #50, 171/172/210 pertinentes; pago a proveedor en USD y TC de pago separada de la TRM de armado. Build con TypeScript sobre el ultimo diff y `git diff --check`; no repetir baterias amplias sin motivo.

### 5. Riesgos y preguntas explicitas (sin resolver aqui; el gate es del Coordinador)

**Riesgos principales:** (R1) la 224 reune publicacion, aceptacion, fencing, H financiera y proteccion de CxP en una sola migracion muy grande, con la superficie financiera de la 210 redefinida; (R2) cruce de archivos con el worktree `tarjetas` y con el diff final de #57/#50 en `reservar/actions.ts`/`computo.ts`; (R3) el invalidador por paquete completo puede ocultar todas las ofertas por un cambio de una sola fuente hasta regenerar; (R4) el neto `tarifa_proveedor` ya es legible por `venta`/`control_vuelo` (hallazgo 5); (R5) comportamiento legacy del infante y de la guarda de precio en conversion (hallazgos 6 y 7) que #63 no debe tocar pero conviven con las filas nuevas; (R6) dependencia de datos: si alguna salida manual de un paquete USD no puede acreditar su moneda, el modo 63 no se puede activar en ese paquete.

**Preguntas:**
- **Q1. "Sin record".** El contrato "SIN RECORD" (arriba) exige PNR ausente para elegir una fuente y que asignarlo despues invalide la oferta no aceptada. El Gate define "promocion" como "salida de origen empaquetados" y solo describe esas filas como "sin record". Que prevalece: (a) mantener "record ausente" como requisito de elegibilidad e invalidacion, o (b) elegibilidad solo por origen empaquetados con record permitido (entonces `record` sale de la lista de triggers y del selector, y el contrato/cotizacion pueden mostrar el PNR como en un Empaquetado directo).
- **Q2. Etiqueta.** Fijar el literal `Promoción` (`EmpaquetadosTabla.tsx:189`) tal cual, o cambiarlo por un badge derivado del PNR (una linea en ese archivo, que entraria al mapa), o por "Sistema"/"Empaquetado". En el codigo y la UI de #63 se evita la palabra "promocion" en cualquier caso; confirmar.
- **Q3. Granularidad de invalidacion.** Reutilizar el bloqueo por paquete de la 181 (una fuente cambiada oculta todas las ofertas del paquete hasta regenerar, mecanismo ya probado, sin estado por salida), o invalidar solo la salida afectada (exige version por salida, estado propio y filtro de lectura, mas superficie).
- **Q4. Servicios incluidos y el infante.** El fixture FX1 supone que el tour incluido no aplica al infante; el generador actual lo hornea en la fila infante (`paquetes/actions.ts:979`). Cual es la regla para vinculadas (vectores 130.500 o 180.500).
- **Q5. Infante legacy.** El generador carga a la fila infante el aporte de vuelo completo del adulto en Bloqueo/Dinamico manual (`:1008`, sin caso especial). Es intencional o un defecto aparte: abrir ticket separado y no tocarlo en #63, o incluirlo.
- **Q6. Costo con infantes reclasificados.** `reservar/actions.ts:241-246` usa `input.infantes` crudo para el costo aereo. Para vinculadas usar la clasificacion del motor; confirmar si el arreglo se limita a vinculadas o se extiende a todos los origenes.
- **Q7. Guarda de precio al convertir.** Hoy `convertirCotizacion` no compara precio. Limitar la reconfirmacion a cotizaciones de salidas vinculadas, o extenderla a todos los paquetes (cambia comportamiento actual).
- **Q8. Moneda de la CxP.** El flujo persona no envia `moneda` y las RPC caen a COP; para vinculadas se enviara explicita (hotel/tour en USD, aereo en COP). Confirmar, y si se abre verificacion aparte de contratos persona en USD ya existentes.
- **Q9. Moneda de la fuente y de las manuales.** Confirmar que el DEFAULT `'COP'` de `empaquetados.moneda` en la 224 es el "GO propio" que pedia la nota del 2026-10-19 para marcar legacy como COP (el SQL sigue necesitando el GO del dueno). Y si el formulario de empaquetados debe mostrar la moneda o avisar de vinculos al editar (reentrada de esos tres archivos).
- **Q10. Modo y mezcla.** Confirmar que `cop_trm_63` es un modo explicito del paquete (nunca inferido del hotel), si en ese modo se admiten hoteles COP y USD mezclados (hoy se rechaza, `paquetes/actions.ts:775-795`), y que cambiar de modo con salidas manuales exige acreditar su moneda y regenerar.
- **Q11. Neto expuesto.** Corregir `empaquetados` para `venta`/`control_vuelo` dentro de la 224 (vista sin `tarifa_proveedor` al estilo de la 144/146) o como hotfix aparte antes de #63; el criterio de aceptacion "sin exposicion de netos" depende de esto.
- **Q12. Numero de vuelo y record en documentos.** Hoy, para origen salida, el snapshot de cotizacion anula `numero_vuelo` (`reservar/actions.ts:1060-1061`). Para vinculadas, mostrar los datos de la fuente igual que un Empaquetado directo o mantener null.
- **Q13. Regeneracion tras agregar.** Las salidas manuales regeneran el tarifario al crear/editar y tragan el error (`paquetes/actions.ts:1533-1565`); para vinculadas el contrato pide "guardar no publica". Confirmar que el alta de vinculos deja el paquete en "pendiente de generar" y que el boton existente es la accion explicita.
- **Q14. Reentrada.** Confirmar que `datos.ts`, `filtrosPostCarga.ts`, `resumen.ts`, `detalle-actions.ts` y los tres archivos de empaquetados salen del mapa con la condicion de reentrada de la seccion 2.
- **Q15. TRM.** Captura manual por paquete, sin valor por defecto; el parametro `trm_referencia` (4.000, migracion 096) puede mostrarse solo como referencia o no mostrarse.
- **Q16. Tamano de la 224.** Es una sola migracion con publicacion, aceptacion, materializacion, H y proteccion de CxP. Si el Coordinador prefiere partirla por riesgo, necesita un segundo numero; no se parte por iniciativa propia.
- **Q17. Orden y reservas.** Orden de entrada respecto del worktree `tarjetas` y del diff final de #57/#50; ejecutor, worktree y nombre del workflow (se propone `test-224-salida-vinculada-63.yml`).

Solo se actualizo esta bitacora. Sin codigo, worktree, rama, migracion, SQL, staging, commit, push ni PR. El gate lo decide el Coordinador.

## Gate del Coordinador suplente sobre el re-base #63 (2026-10-21)

Revisado el re-base (seccion "#63 re-base sobre 2d5dff0e"). El diseno es coherente con las decisiones fijas, y los hallazgos de la guarda de la 220 en Dinamico y de la exposicion del neto son validos. Resoluciones del suplente:

- **Q1 = (a).** Se mantiene "record ausente" como requisito de elegibilidad, como dijo el dueno: Promocion es la etiqueta de las salidas sin record. Asignar un PNR despues invalida la oferta no aceptada (contrato "SIN RECORD" de este archivo).
- **Q2:** el badge "Promocion" solo se muestra si el origen es empaquetados Y no hay PNR. Con PNR se muestra "Empaquetado" (texto fijo). Entra al mapa `EmpaquetadosTabla.tsx`, solo para ese cambio de badge. En el codigo y la UI de #63 no se usa la palabra "promocion": se usa "Salida de Empaquetados".
- **Q3:** invalidacion por paquete, reutilizando la 181, que ya esta probada. La version por salida queda fuera de v1.
- **Q4 y Q5: van al dueno** (tour incluido para el infante; aporte de vuelo de adulto cobrado al infante en el codigo actual).
- **Q6:** usar la clasificacion del motor solo para las vinculadas. Para los demas origenes se abre un ticket aparte.
- **Q7:** la reconfirmacion de precio al convertir se limita a las cotizaciones de salidas vinculadas.
- **Q8:** las vinculadas mandan la moneda explicita en la CxP. La verificacion de los contratos persona en USD existentes es un ticket aparte.
- **Q9:** el DEFAULT 'COP' de `empaquetados.moneda` queda aceptado; el dueno ya confirmo que todas las fuentes actuales son COP. Sin cambios en el formulario de empaquetados en v1.
- **Q10:** `cop_trm_63` es un modo explicito del paquete y nunca se infiere. En ese modo se admite mezclar hoteles COP y USD (decision de producto: paquete mixto con TRM). Cambiar de modo exige acreditar la moneda de las manuales y regenerar.
- **Q11:** **hotfix aparte y primero.** Cierra la lectura de `tarifa_proveedor` (y de cualquier neto) de `empaquetados` para `venta`/`control_vuelo`, con el patron de la 144/146. **Renumeracion: la 224 pasa al hotfix y #63 usa la 225.** Mismo ejecutor y en serie: primero el hotfix (PR propio), despues #63.
- **Q12:** las vinculadas muestran los datos de vuelo de la fuente como un Empaquetado directo. Sin PNR, porque son sin record.
- **Q13:** si. Agregar vinculos deja el paquete "pendiente de generar", y la accion explicita es el boton existente.
- **Q14:** se acepta que salgan del mapa con condicion de reentrada.
- **Q15:** TRM manual por paquete, sin valor por defecto. `trm_referencia` solo se muestra como referencia.
- **Q16:** con el hotfix separado, #63 queda en una sola migracion (225).
- **Q17:** #63 entra antes que el worktree `tarjetas` (viejo), que concilia despues. Ejecutor: el mismo del re-base. Worktrees `.claude/worktrees/neto-empaquetados-224` (hotfix) y `.claude/worktrees/salidas-empaquetados-63`. Workflows `test-224-neto-empaquetados.yml` y `test-225-salida-vinculada-63.yml`. La base de ambos es el `origin/main` vigente al crearlos.

**Estado:** falta que el dueno responda Q4 y Q5. Despues: GO LOCAL del hotfix 224 y luego de #63 (225) con el mapa de la seccion 2 ajustado (mas `lib/paquetes/destinosAereos67.ts` y el badge).

**Respuesta del dueno a Q4/Q5 (2026-10-21):** "de 0 a 1.99 puede tener un fee; de 2 en adelante tarifa de adulto". Y para los servicios: "igual que el aereo: de 0 a 1.99 anos se deja el campo para que se llene, puede ser $0; de 2 en adelante tarifa de adulto".
- **Q5: es un DEFECTO activo.** El generador (`paquetes/actions.ts`, alrededor de :979-1040) suma a la fila `infante` el aporte de vuelo de adulto y los servicios incluidos completos. El costo (`reservar/actions.ts:246`) si usa `fee_infante`. Resultado: al infante se le cobra el vuelo de adulto.
- **Q4: hace falta un campo nuevo.** Los servicios no tienen precio de infante (ninguna columna de infante en las migraciones de servicios), y `bloqueos_vuelo` no tiene `fee_infante`, que solo existe en salidas dinamicas (094) y en empaquetados (156).
- **Decision del suplente:** tarea NUEVA y urgente, "Tarifa de infante 0-1,99", **antes de #63**, porque toca las mismas lineas del generador.
  - Vuelo del infante = `fee_infante` de la fuente (salida dinamica, empaquetado y bloqueo, con campo nuevo en bloqueos).
  - Servicio del infante = campo nuevo "precio infante" por servicio y temporada (puede ser 0).
  - De 2 anos en adelante = tarifa de adulto (o la de nino segun hotel, sin cambios).
  - Debe aplicarse igual en generador, reservar, cotizacion y CxP.
- **Nueva numeracion:** 224 = hotfix del neto de empaquetados; **225 = tarifa de infante**; **226 = #63**. Las tres en serie, con el mismo ejecutor. #63 usa la regla de infante ya corregida.
- **Pendiente de verificar (suplente):** la migracion 195 menciona un "grupo D" de 16 columnas con adulto/infante en bloqueos. Puede que ya exista un valor de infante para Bloqueo fuera de `bloqueos_vuelo`. El ejecutor lo confirma antes de proponer un campo nuevo.

**Confirmacion del dueno (2026-10-22), criterio de aceptacion de #63:** el objetivo es que un paquete dinamico con una salida vinculada de empaquetados ("promocion", sin record) se pueda **cotizar y reservar SIN cupo**, porque los empaquetados no manejan cupos. Las guardas siguen aplicando: activo, vigencia de compra y viaje (#62), destino aereo (#67/220), moneda y la invalidacion por cambio de fuente. Debe probarse explicitamente: cotizar y reservar sin ninguna validacion de `cupos_por_bloqueo` en una vinculada. Los Bloqueos siguen exigiendo cupo como hoy.


---

## #63 re-base 2 sobre 3cfe731c (2026-10-22)

**Ciclo de RE-BASE 2, SOLO DISENO, corto. NO GO de codigo ni de SQL.** Actualiza el re-base sobre 2d5dff0e (arriba) con lo que entro despues: **#376** (hotfix 224/225, `328f6f06`) y **#377** (tarifa de infante 226, `3cfe731c`). Fijo y NO reabierto: el Gate del suplente, las respuestas del dueno (Q4/Q5; confirmacion 2026-10-22: una vinculada se cotiza y reserva SIN cupo) y lo siguiente: **#63 = migracion 227**; los infantes de las vinculadas usan la regla de la 226 (`menoresDeDos`), sin reimplementarla; si #63 necesitara columnas de `empaquetados` para la venta, se agregan a `empaquetados_basica` desde la 227 sin devolver la tabla base a `venta` ni exponer netos; la 227 ENVUELVE el publicador VIGENTE (el de la 226).

**Lectura.** `git fetch` + `origin/main` = **3cfe731c** (solo dos commits sobre 2d5dff0e: #376 y #377). Todo con `git show`/`git diff 2d5dff0e 3cfe731c` (48 archivos, 4.279 +/182 -), sin worktree. Sin `.env*` ni `sitio-web/node_modules`. Nada se ejecuto; las cifras de la seccion 3 son aritmetica manual (`marcar` = costo/(1-mk), techo al mil por fila en COP, regla B de la 226: techo de hotel + servicios y fee EXACTO). Anclas `archivo:linea` = 3cfe731c, rutas relativas a `dspacios-travel/`.

### 1. Que cambia en el mapa y en la 227 (ancla 3cfe731c)

**1.1 Cerrado por la 224/225/226 (sale de la lista de pendientes de #63)**
- **Neto de `empaquetados` legible por `venta` (hallazgo 5, Q11):** CERRADO. `empaquetados_basica` (`224:57`, 21 columnas sin `tarifa_proveedor`, `fee_infante`, `tarifa_para_empaquetar`, `estado_pago`, `notas`; grant solo a `authenticated` `:75`) y policy "lectura con costos" sin `venta` (`225:34-36`). `computo.ts:276` lee la vista. El servidor con service-role lee la tabla base sin pasar por la vista (cabecera de la 224), asi que **#63 no necesita columnas nuevas en `empaquetados_basica`**: la elegibilidad y el costo de una vinculada se resuelven con el cliente de servicio, igual que ya hace la salida manual (`computo.ts:296-303`, `:324`; `reservar/actions.ts:224`). Si una prueba demostrara lo contrario, se agregan a la vista desde la 227 sin tocar la policy (decision fija); se anticipa que no.
- **Infante (Q4, Q5, hallazgos 6 y 12; Q6 en la practica):** la 226 ya corrigio el defecto en TODOS los origenes. Generador: `filasHoteles(..., feeInfante)` `paquetes/actions.ts:974-997`, fila `precio_pvp_menor2` con fee exacto `:1034`/`:1068`, fila de infante con hotel $0 `:1111`, fee por fuente en `:1244` (bloqueo), `:1269` (empaquetado), `:1290` (salida manual), `:1274` (porcion, sin fee). Venta: `tarifarMenores`/`contarMenoresDeDos` `computo.ts:521-535`, `:715-728`; `paxConSilla` = solo 2+ y `paxServAdulto` `:798`. Costo aereo `reservar/actions.ts:248-253` = `costo_neto x paxConSilla + fee_infante x menores de 2` con el conteo del motor (ya no `input.infantes` crudo, hallazgo 9). `ReservaForm.tsx:170-175` ya suma el infante (hallazgo 12 cerrado). **Consecuencia para #63:** la rama vinculada del generador solo debe llamar a `filasHoteles` con `aporteVuelo = R` y `feeInfante = F de la fuente`; no hay logica de infante propia que escribir, y la Q6 del gate ("solo vinculadas") queda superada por la 226 (ya aplica a todos los origenes).
- **Cupos (confirmacion del dueno):** `reservar/actions.ts:228-239` valida `cupos_por_bloqueo` **solo `origen.tipo === "bloqueo"`**; `computo.ts` no lee cupos; el tramo de vuelo ya admite `origen.tipo==="salida"` (`:609`). Una vinculada es origen `salida`: hoy no pasa por cupo. Se conserva y se **prueba explicitamente** (seccion 3, FX8). La conversion de carrito (`:1980`) es solo Bloqueo.

**1.2 Cambios que alteran lo que 227 envuelve o toca**
| Objeto | Estado a 3cfe731c | Efecto en la 227 |
|---|---|---|
| `publicar_tarifario_resultado(bigint,bigint,bigint,text,jsonb)` | Reemplazado por la 226 (`226:86`): inserta `precio_pvp_menor2` ademas de las columnas de la 181; sigue ignorando la `moneda` de la fila (usa `p_moneda`) | `publicar_tarifario_resultado_63` lo LLAMA con el mismo payload de filas (incluida `precio_pvp_menor2`); no copia su cuerpo. El postcheck de la 227 compara `pg_get_functiondef` del publicador contra el estado del preflight (la 226) |
| `tarifario_resultado_publicable` (`select r.*`) y `tarifario_resumen` | Recreadas por la 226 (`226:447`, `:456`; `precio_infante` = precio del menor de 2 años) | Si la 227 agregara alguna columna a `tarifario_resultado` hay que RECREAR la vista (precedente de la 226); la decision vigente sigue siendo no agregar columnas ahi |
| Triggers de invalidacion | La 226 reemplazo los de `servicios_adicionales`, `bloqueos_vuelo` y `empaquetados` (`226:426-440`): `empaquetados` ahora escucha `fee_infante` ademas de `activo, compra_*, tarifa_para_empaquetar, fecha_*, ruta` | La 227 NO redefine `tarifario_trg_empaquetados` ni su funcion; agrega un trigger propio con abanico por `salidas_dinamicas.empaquetado_id` y las columnas que faltan (`tarifa_proveedor, proveedor_id, aerolinea, vuelo_*, hora_*, destino_id, moneda, record`). Dos triggers sobre la misma tabla invalidan de forma idempotente |
| Funciones/vistas 224/225/226 | Nuevas en el estado base | El postcheck de "no regresion" suma a la lista 181/210/220: `publicar_tarifario_resultado`, `crear_bloqueo`, `tarifario_trg_bump_servicio_catalogo`, las dos vistas, `empaquetados_basica` y la policy de `empaquetados` (225) |
| `bloqueos_vuelo.fee_infante` y `servicios_adicionales/servicio_temporadas.precio_infante` | Columnas nuevas (226) | Sin cruce con la 227 |
| Esquema para CI | Cadena real hasta la **226** | `preparar_esquema_local.sh "$CT" 226 "$PLANTILLA"` |

**1.3 Anclas del mapa que se movieron (tabla de la seccion 1 del re-base anterior, columna "Ancla")**
- `paquetes/actions.ts`: `aporteServiciosIncluidos :943` y `...Menor :959`; `filasHoteles :974`; lectura de fuentes con `fee_infante` `:725`/`:731`; guarda de destino aereo (**sigue solo `tipo==="bloqueo"`**) `:1126-1127`; lectura de salidas `:1201` (`select("*")`, ya trae `fee_infante`); rama dinamico `:1286-1290` (BNC `valor_tiquete` por `aporteVuelo :1286`); publicar `:1381`; moneda `:784`; CRUD de salidas `:1641`/`:1655`; nueva `paquetesConTarifarioAnteriorAInfante :1464` (solo lectura; el aviso de Paquetes la usa).
- `computo.ts`: empaquetado `:276`; salida manual `:296-303`; destino aereo `:324`; lectura cacheada `:550`/filtro `salida_id :560`; menores `:521-535`, `:715-728`; **BNC `:1036-1043` SIGUE leyendo solo `impuesto_fijo x paxConSilla`** (ignora `impuesto_tipo`), ahora con `paxConSilla` = solo 2+.
- `reservar/actions.ts`: `resolverDatosVuelo :224`; cupos solo bloqueo `:228-239`; `infantesN :248`; `costoAereo :253`; `pushCxP :698` (sin `moneda`); CxP aerea `:719`; tramos de vuelo `:609`; snapshot con `numero_vuelo` null para salida `:1063-1064`; `crearCotizacion :944`; `convertirCotizacion :1185`; CxP de hotel con neto de infante `:738`; CxP de servicios con precio de infante `:798-831`; carrito `:1523` (cupo `:1980`, fuera).
- `empaquetadoOrigen.ts`: `datosVueloBloqueo :85` (ahora lee `fee_infante`), `datosVueloEmpaquetado :121` (`costo_neto = tarifa_proveedor :143`, `fee_infante :145`), `datosVueloSalida :151`. La salida vinculada se resuelve en `resolverDatosVuelo :183` hacia `datosVueloEmpaquetado`-like con `record` ausente y el fee de la fuente.
- Sin diff desde 2d5dff0e (anclas del re-base anterior vigentes): `SalidasDinamicasEditor.tsx`, `paquetes/[id]/page.tsx`, `ArmadoClient.tsx`, `ConfigForm.tsx`, `destinosAereos67.ts`, `salidaDinamicaVigente.ts` (`seleccionarSalidasVigentes :156`), `origen.ts`, `datos.ts` (solo la lista de columnas del detalle ganó `precio_pvp_menor2`), `filtrosPostCarga.ts`, `resumen.ts`, `contratos/**`, `asientos.ts`, `asegurarCuentasPorPagar.ts`.

**1.4 Contenido de la 227 respecto del plan de la "224"**
Sin cambios de diseno (3.1 a 3.8 del re-base anterior, con `_63` y `p63_priv`), salvo: (a) numero y archivos `20260601000227_salida_vinculada_empaquetado.sql`, `*_227_*`; (b) envuelve el publicador de la 226; (c) el abanico de invalidacion es un trigger PROPIO (no se reemplaza el de la 226); (d) sin columnas nuevas ni cambios en `empaquetados_basica`; (e) postcheck con las huellas ampliadas (1.2) y, por la leccion del C10 de la 226, **toda consulta a `information_schema.columns` se restringe a tablas base** (`information_schema.tables.table_type = 'BASE TABLE'`) o nombra la vista a proposito; (f) rollback de la 227 ANTES del de la 226/220 y negado con uso; (g) orden de despliegue: preflight -> **aplicar la 227 ANTES de fusionar/desplegar el codigo** (el codigo lee columnas y RPC nuevas) -> postcheck -> codigo.

### 2. Mapa final de reserva para el GO LOCAL (rutas relativas a `dspacios-travel/`; workflow en la raiz)

**EDITAR**
- UI/catalogo: `app/(dashboard)/dashboard/paquetes/[id]/SalidasDinamicasEditor.tsx`, `paquetes/[id]/page.tsx`, `paquetes/[id]/ArmadoClient.tsx` (props y banner de revision), `paquetes/ConfigForm.tsx` (bloque 220 tambien en Dinamico + modo/TRM), `paquetes/actions.ts` (rama vinculada, lote de vinculos, TRM/modo, publicacion 63; la llamada manual de `:1290` y `:1244/:1269` NO cambia), `reservar/nuevo/ReservaForm.tsx` (opcionales en COP normalizado y reconfirmacion), `vuelos/EmpaquetadosTabla.tsx` (solo el badge: "Promocion" si origen empaquetados Y sin PNR; con PNR "Empaquetado").
- Condicional (solo si la revision opaca/moneda 63 debe viajar al formulario): `reservar/nuevo/page.tsx` (ya modificado por la 226 en `:31`, `:86`, `:119`).
- Motor: `lib/calc/paquetes.ts` (helpers puros modo 63 al final; legacy y `precioMenorDeDos` intactos), `lib/reservar/computo.ts`, `lib/reservar/empaquetadoOrigen.ts`, `lib/reservar/salidaDinamicaVigente.ts`, `lib/paquetes/destinosAereos67.ts` (`filtrarFilasPorOrigenAereo`, `vinculosIncompatibles`, fuente), `lib/reservar/incluidosCotizados.ts` (condicional: solo si una prueba demuestra necesidad).
- Servidor de venta: `app/(dashboard)/dashboard/reservar/actions.ts` (`crearCotizacion`, `convertirCotizacion`, `reservarDesdeTarifarioInterno` y dependencias privadas modo 63; sin Programas, carrito ni comparativas).
- Financiero acotado: `lib/contabilidad/asientos.ts` (solo `postearAsientoCxP`), `lib/reservar/asegurarCuentasPorPagar.ts` (solo obligaciones 63), `contratos/[numero]/gestion-actions.ts`, `contratos/actions.ts` (solo rechazos de edicion que contradigan snapshot/CxP 63).
- `types/database.ts` (solo secciones nuevas).
- **SOLO LECTURA (importar, no editar):** `lib/reservar/menoresDeDos.ts` (`contarMenoresDeDos`, `tarifarMenores`, `menoresDelComputo`, `MENSAJE_TARIFARIO_SIN_INFANTE`). Si #63 necesitara cambiarlo, se detiene y pide ampliacion.

**NUEVOS**
- `lib/reservar/{ofertaDinamica63,payloadFinanciero63,prepararOferta63,importeObligacion63}.ts` (sin la palabra "promocion").
- SQL/CI: `supabase/migrations/20260601000227_salida_vinculada_empaquetado.sql`; `supabase/scripts/{preflight,postcheck,rollback}_227_salida_vinculada_empaquetado.sql`; `supabase/scripts/test_227_{fases.sh,carrera.sh,api.sh}` y `test_227_salida_vinculada.sql`; **`.github/workflows/test-227-salida-vinculada-63.yml`** (forma de `test-226-tarifa-infante.yml`: `permissions: contents: read`, sin secretos ni Supabase remoto, sin `pull_request_target`, acciones por SHA `11bd7190...` v4.2.2, `set +e` antes de cada `tee`, marcas `OK` exigidas, imagenes `supabase/postgres:15.8.1.085` y PostgREST `v16.1`, esquema `... 226`, y un job TS en `node:24.14.0-bookworm-slim`).
- Pruebas: `pruebas/salidaVinculada63*.test.ts` y `*.react.ts` (React por comando directo, sin tocar `package.json`, salvo autorizacion expresa del dueno como en la 226).
- Documentacion al cierre: `docs/tecnico/tarifario-y-paquetes.md`, `docs/tecnico/reservar.md`.

**PRUEBAS EXISTENTES que se ajustaran SOLO en su forma si el cambio las ata al texto del fuente** (precedente de la 226, a reportar como desviacion): `pruebas/{checkoutBernaloWiring,bernaloIntegracionGuardWiring,computoIncluidosLecturaWiring,empaquetados,precioFinalAutoritativoWiring,serviciosPaqueteWiring,tarifaInfante226Cableado,salidaDinamicaFlujos62,destinosAereosFlujos67}.test.ts` y `destinosAereos67Soporte.ts`. La prueba de cableado de la 226 fija la llamada MANUAL del generador (`Number(sal.fee_infante) || 0` y la de bloqueo/empaquetado): la rama vinculada debe ser un camino aparte, sin alterar esas lineas.

**SALEN (condicion de reentrada igual al re-base anterior):** `vuelos/empaquetados-actions.ts`, `vuelos/empaquetados/{NuevoEmpaquetadoForm,[id]/EditarEmpaquetadoForm}.tsx`, `lib/tarifario/{datos,filtrosPostCarga,resumen}.ts`, `app/tarifario/detalle-actions.ts`, `lib/reservar/origen.ts`, `app/tarifario/checkout/actions.ts`, `lib/cart/**`, comparativas, `producto/servicios/**` y los formularios de Bloqueo (226, ya cerrados). NO se tocan Bernalo, Programas, cotizacion/contrato manual ni `bloqueos_vuelo.tarifa_neta` (hotfix pendiente aparte).

### 3. Vectores actualizados (aritmetica a mano; regla de la 226 + BNC)

Comunes: MK 20% (`/0,8`), COP con techo al mil por fila, **regla B** (techo de hotel + servicios, **F exacto**, sin MK ni TA), R = 1.130.000 (`tarifa_para_empaquetar`, precio final), N = 1.000.000 (`tarifa_proveedor`, costo/CxP), F = 80.500 (`empaquetados.fee_infante`, precio = costo, una vez), TRM 4.000.

**FX1 (modo `cop_trm_63`):** 2 adultos (1 hab doble) + **1 menor de 1 año**. Hotel adulto neto USD 100 -> 400.000 -> 500.000; hotel infante neto USD 10 -> 40.000 -> 50.000; tour incluido por persona neto adulto USD 10 -> 40.000 -> 50.000.
- Adulto = techo(500.000 + 50.000 + 1.130.000) = **1.680.000**; 2 adultos = 3.360.000.
- Infante de 1 año segun el `precio_infante` del tour (convertido y con MK como el de adulto):
  - USD 0 (gratis): 50.000 + F 80.500 = **130.500**; total **3.490.500**.
  - NULL (paga como adulto, aviso): techo(50.000 + 50.000) + 80.500 = **180.500**; total **3.540.500**.
  - USD 5 -> 20.000 -> 25.000: techo(75.000) + 80.500 = **155.500**; total **3.515.500**.
- Variantes de hotel (tour USD 0): sin tarifa de hotel infante -> 0 + 80.500 = **80.500** (total 3.440.500); F = 0 y sin hotel infante -> **0** (total 3.360.000); hotel infante USD 10,075 -> 40.300 -> 50.375 -> techo **51.000** + 80.500 = **131.500** (el ajuste queda en la parte hotel; F exacto), total 3.491.500.
- **Niño de 2 años** (hotel con infante hasta 2; adulto en vuelo y servicios, V8 de la 226): fila infante pvp = techo(50.000 + 50.000 + 1.130.000) = **1.230.000**, ocupa silla; total 3.360.000 + 1.230.000 = **4.590.000**.
- Costos (CxP en origen, aereo en COP): hotel USD 210 (200 + 10 del infante, que la 226 ya suma) = COP 840.000; tour segun caso: USD 20 (gratis), USD 30 (NULL), USD 25 (USD 5) -> COP 80.000 / 120.000 / 100.000; **aereo = 2 x 1.000.000 + F 80.500 = 2.080.500** (el niño de 2 años NO paga F: 3 x 1.000.000 = 3.000.000). `ventas.costo_hotel` 840.000, `costo_aereo` 2.080.500; `asegurarCuentasPorPagar` no compara USD con COP (devuelve 0).
- **BNC (`paxConSilla` = solo 2+):** infante de 1 año no genera BNC. Tiquete: 2 x 1.130.000 = 2.260.000 -> base 3.490.500 - 2.260.000 = **1.230.500**; fijo 100.000 x 2 = 200.000 -> base **3.290.500**. Con el niño de 2 años (3 pax con silla): tiquete 3.390.000 -> base 4.590.000 - 3.390.000 = **1.200.000**; fijo 300.000 -> base **4.290.000**. Debe FALLAR el codigo actual para una vinculada con `impuesto_tipo = tiquete` (`computo.ts:1040-1043` daria solo el fijo).
- Deben FALLAR: F cobrado dos veces (infante 211.000 en el caso gratis); R en la fila infante (1.230.000 en vez de 130.500); MK sobre R (R/0,8 = 1.412.500; adulto 1.963.000); doble o ninguna conversion de TRM; infante tarifado con el vuelo de adulto (defecto 226 reintroducido).

**FX2 (COP puro, redondeo y BNC):** hotel neto 413.700 -> 517.125; adulto = techo(517.125 + 1.130.000) = **1.648.000** (el redondeo cae una vez sobre el total). Infante de 1 año: hotel infante neto 20.000 -> 25.000, sin tour, F 80.500 -> 25.000 + 80.500 = **105.500**; total 2 adultos + infante = 3.296.000 + 105.500 = **3.401.500**. BNC tiquete 2.260.000 -> base **1.141.500**; fijo 200.000 -> base **3.201.500**. Fila vinculada con `ta = 50.000` o `aplica_mk` verdadero: rechazada por el CHECK (doble margen daria adulto 1.930.000).

**FX3 (USD y TRM no redonda):** TRM 3.987,65; hotel adulto USD 103,50 -> 412.721,775 -> 515.902,22 -> adulto **1.646.000** (sin cambios). Infante: hotel USD 10,35 -> 41.272,1775 -> /0,8 = 51.590,22 -> techo **52.000** + F 80.500 = **132.500**. Cambio de TRM a 4.010,00 bloquea el paquete (adulto 1.649.000); cotizacion previa se rechaza al convertir con el importe nuevo; contrato aceptado intacto. **Salida manual USD acreditada** (fee USD 25): F = 25 x 3.987,65 = 99.691,25 -> infante = 52.000 + 99.691,25 = **151.691,25** (ver pregunta R1).

**FX4 (tres salidas, hotel y servicios globales):** sin cambios (adultos 1.580.000 / 1.850.000 / 2.140.000; servicio por grupo una vez por reserva). Nuevo: **4 adultos + 1 infante con un servicio por grupo = rango de 4, sin cargo de infante** (regla del dueno en la 226), tambien en vinculadas.

**FX5, FX6, FX7:** sin cambios de cifras (elegibilidad por 220; fuente/TRM cambiada; clasificacion de infantes). FX7 ahora se cumple con el conteo del motor en todos los origenes (226); la prueba de #63 solo verifica que la vinculada lo usa.

**FX8 (cupos, confirmacion del dueno 2026-10-22):** dinamico con una salida vinculada sin ningun Bloqueo en el paquete y 0 cupos en `cupos_por_bloqueo`/`sillas`: cotizar y reservar OK con `paxConSilla = 3` aunque "disponibles" sea 0; el cliente falso **lanza si se consulta `cupos_por_bloqueo` o `sillas` en la rama vinculada**; el mismo flujo con un Bloqueo del mismo paquete sigue rechazando por falta de cupo (`reservar/actions.ts:228-239`). Guardas que SI aplican a la vinculada: activo, ventana de compra y viaje no pasado (#62), destino aereo (#67/220), moneda y la invalidacion por cambio de fuente.

**Capas** (sin cambios respecto del re-base anterior): U, G/C, R, S, K, A, W; el esquema S/K/A parte de la cadena hasta la **226**; fixtures de ventas con `DTM-NNNN`; conteos reales, nunca literales que otro bloque pueda alterar; sin variables PL/pgSQL con nombre de columna; el postcheck consulta columnas solo de tablas base. Mantener ademas los guardas de la 226 como regresion: `pruebas/tarifaInfante226*.test.ts`.

### 4. Riesgos y preguntas nuevas

**Riesgos nuevos (todos acotados):**
- **R-a.** La rama vinculada convive con tests de cableado de la 226 atados a texto exacto (seccion 2): se ajustan solo en su forma y se reporta.
- **R-b.** Dos triggers de invalidacion sobre `empaquetados` (el de la 226 y el de la 227): idempotentes, pero el postcheck debe probar que ninguno reemplaza al otro.
- **R-c.** Si el generador de la rama vinculada lee la fuente con la sesion de un rol interno, depende de que la policy de la 225 siga incluyendo `superadmin/gerencia/administracion/operaciones` (si; `225:34-36`); la lectura de venta/CxP va siempre por service-role.
- **R-d.** La regeneracion tras la 227 de paquetes ya publicados sigue siendo manual (aviso de Paquetes de la 226); los paquetes en modo 63 nuevos nacen con la columna `precio_pvp_menor2` poblada.

**Preguntas (sin resolver aqui):**
- **R1. Fee de una salida manual USD en modo 63.** El fee (precio = costo) se convierte con la TRM del paquete como el resto de la manual acreditada; en COP exacto puede traer centavos (99.691,25). ¿Se mantiene exacto como el F de una fuente COP (la columna es `numeric(15,2)`), o se redondea al peso/al mil? Efecto: precio publicado no multiplo de mil en ese caso.
- **R2. Alcance de la regla de menores en el documento.** La 226 rotula "Infante · …", "Infante (2 años) · …" y "Niño 1 (menor de 2 años) · …". Confirmar que las vinculadas usan los mismos rotulos sin variantes.

No hay mas preguntas: las demas decisiones (record ausente, badge, invalidacion por paquete, moneda de la CxP, TRM manual, una sola migracion, orden y workflow) estan resueltas por el Gate.

Solo se actualizo esta bitacora. Sin codigo, worktree, rama, migracion, SQL, staging, commit, push ni PR. El gate lo decide el Coordinador.
