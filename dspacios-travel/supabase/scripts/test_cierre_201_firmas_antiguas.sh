#!/bin/bash
# ──────────────────────────────────────────────────────────────────
# PRUEBA del cierre de firmas sin versión de la 201 y de los rollbacks.
# SOLO base LOCAL DESECHABLE en un contenedor Docker (nunca remota). Se corre
# desde el equipo (no dentro del contenedor) porque alimenta los scripts por
# entrada estándar.
#
# Uso:  bash test_cierre_201_firmas_antiguas.sh <contenedor> <base_con_201> <base_con_1_200>
#   Clona <base_con_201> (dos veces, en cierre201_prueba) y la borra al final.
#   <base_con_1_200> solo se LEE: referencia del catálogo antes de la 201.
#   La clonación necesita un superusuario: se hace como supabase_admin por TCP.
#
# Reglas que prueba:
#   · el código viejo NUNCA se bloquea antes de confirmar el despliegue nuevo
#     (incluido un despliegue retrasado más de 14 días);
#   · la activación exige evidencia del código nuevo y una ventana (≥ 3 días);
#     se puede cancelar mientras la ventana no termina;
#   · una firma que ya cerró NUNCA se reabre (cancelar, reprogramar, UPDATE,
#     DELETE, TRUNCATE, re-aplicar la 201, rollback de la 201);
#   · con la 201 puesta, el código anterior gestiona las retenciones (rollback
#     solo de código);
#   · el rollback TOTAL se niega con retenciones, sin modo "conservar", y solo
#     avanza con resoluciones reales.
# El paso del tiempo (ventana cumplida, plazo vencido) se SIMULA como dueño,
# desactivando un instante el trigger en la base de prueba.
# ──────────────────────────────────────────────────────────────────
set -u
CT="${1:?contenedor}"; BASE201="${2:?base con 201}"; BASE200="${3:?base con 1-200}"
DB=cierre201_prueba
AQUI="$(cd "$(dirname "$0")" && pwd)"
MIG="$AQUI/../migrations/20260601000201_pasajero_antes_contrato_vuelos.sql"
TMP="$(mktemp -d)"
FALLOS=0
CV=00000000-0000-0000-0000-0000000c1201
ok()    { echo "OK    $1"; }
fallo() { echo "FALLO $1"; FALLOS=$((FALLOS + 1)); }

P()   { docker exec -i "$CT" psql -U postgres -d "$1" -X -q -At -v ON_ERROR_STOP=1 "${@:2}"; }
ADM() { docker exec -e PGPASSWORD=postgres "$CT" psql -h 127.0.0.1 -U supabase_admin -d postgres -X -q -c "$1"; }
Q()   { P "$DB" -c "$1"; }
QX()  { P "$DB" -c "$1" > "$TMP/out" 2>&1; }
F()   { P "$DB" < "$1" > "$TMP/out" 2>&1; }
FCON() { { printf '%s\n' "$1"; cat "$2"; } | P "$DB" > "$TMP/out" 2>&1; }
CV()  { printf "begin;\nselect set_config('request.jwt.claims', json_build_object('sub', '%s', 'role', 'authenticated')::text, true) is not null;\nset local role authenticated;\n%s;\ncommit;\n" "$CV" "$1" | P "$DB" > "$TMP/out" 2>&1; }
dice() { grep -q -- "$1" "$TMP/out"; }
espera_error() { if dice "$2"; then ok "$1"; else fallo "$1 (salida: $(tr '\n' ' ' < "$TMP/out" | cut -c1-260))"; fi; }
sin_error()    { if dice ERROR; then fallo "$1: $(tr '\n' ' ' < "$TMP/out" | cut -c1-260)"; else ok "$1"; fi; }
S()   { echo "(select id from public.sillas where bloqueo_id = (select id from public.bloqueos_vuelo where record = 'PC201') and numero_silla = $1)"; }
VER() { echo "(select jsonb_build_object('updated_at', updated_at) from public.sillas where id = $(S "$1"))"; }
ESP() { echo "jsonb_build_object('numero_contrato', null, 'contrato_manual', null, 'updated_at', (select updated_at from public.sillas where id = $(S "$1")))"; }
foto() { Q "select coalesce(pasajero_nombres, '-') || '/' || estado || '/' || coalesce(contrato_manual, '-') || '/' || coalesce(plazo::text, '-') from public.sillas where id = $(S "$1")"; }
usos() { Q "select count(*) from public.vuelos_firmas_antiguas_uso"; }
estado_cierre() { Q "select estado || '/' || case when public._firmas_antiguas_cerradas() then 'cerradas' else 'abiertas' end from public.vuelos_cierre_firmas_201"; }
PLAZO="(public.fecha_negocio(now()) + 3)::text"
MSG_CERRADA="versión anterior de la aplicación que ya no se admite"
# Simula el paso del tiempo en la base de prueba: mueve cierra_en al pasado.
ventana_cumplida() {
  Q "alter table public.vuelos_cierre_firmas_201 disable trigger vuelos_cierre_firmas_201_monotono;
     update public.vuelos_cierre_firmas_201 set cierra_en = now() - interval '1 second' where id = 1;
     alter table public.vuelos_cierre_firmas_201 enable trigger vuelos_cierre_firmas_201_monotono;" >/dev/null
}
# Las cuatro firmas viejas (como las llama el código anterior) contra la silla $1.
viejas_funcionan() {
  CV "select public.editar_pasajero_silla($(S "$1"), jsonb_build_object('pasajero_nombres', 'VIEJO $1', 'plazo', $PLAZO))"
  sin_error "  $2: editar sin versión (código viejo) funciona"
  CV "select public.asignar_contrato_manual($(S "$1"), 'EXT-V$1')"; sin_error "  $2: asignar_contrato_manual(bigint,text) funciona"
  CV "select public.quitar_contrato_manual($(S "$1"))";           sin_error "  $2: quitar_contrato_manual(bigint) funciona"
  CV "select public.liberar_silla($(S "$1"))";                    sin_error "  $2: liberar_silla(bigint) funciona"
}
viejas_rechazadas() {
  local antes; antes="$(foto "$1")/$(usos)"
  CV "select public.editar_pasajero_silla($(S "$1"), jsonb_build_object('pasajero_nombres', 'VIEJO', 'plazo', $PLAZO))"
  espera_error "  $2: editar sin versión rechazada" "$MSG_CERRADA"
  CV "select public.asignar_contrato_manual($(S "$1"), 'EXT-V')"; espera_error "  $2: asignar_contrato_manual(bigint,text) rechazada" "$MSG_CERRADA"
  CV "select public.quitar_contrato_manual($(S "$1"))";          espera_error "  $2: quitar_contrato_manual(bigint) rechazada" "$MSG_CERRADA"
  CV "select public.liberar_silla($(S "$1"))";                   espera_error "  $2: liberar_silla(bigint) rechazada" "$MSG_CERRADA"
  [ "$(foto "$1")/$(usos)" = "$antes" ] && ok "  $2: la silla y el registro de uso no cambiaron" || fallo "$2: un rechazo cambió algo"
}
INVENTARIO="
select 'F '||p.oid::regprocedure::text||' '||md5(replace(p.prosrc, chr(13), ''))||' acl='||coalesce(p.proacl::text, '-')||' def='||p.prosecdef||' cfg='||coalesce(p.proconfig::text, '-')
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
union all
select 'V '||c.relname||' '||md5(replace(pg_get_viewdef(c.oid), chr(13), ''))||' acl='||coalesce(c.relacl::text, '-')||' opt='||coalesce(c.reloptions::text, '-')
  from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'v'
union all
select 'T '||c.relname||' '||c.relkind::text||' acl='||coalesce(c.relacl::text, '-')
  from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('r', 'S')
union all
select 'G '||t.tgrelid::regclass::text||' '||md5(pg_get_triggerdef(t.oid))
  from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and not t.tgisinternal
order by 1"
inventario() { P "$1" -c "$INVENTARIO" > "$2"; }
clonar() {
  ADM "drop database if exists $DB" >/dev/null
  ADM "create database $DB template $BASE201 owner postgres" >/dev/null || { echo "No se pudo clonar $BASE201"; exit 2; }
  P "$DB" > /dev/null <<SQL
insert into auth.users (id, email) values ('$CV', 'cv-cierre@local.test');
update public.usuarios set rol = 'control_vuelo', tenant = 'mayorista', activo = true, nombre = 'CV cierre' where id = '$CV';
insert into public.destinos (nombre) values ('DESTINO CIERRE 201');
insert into public.proveedores (nombre) values ('PROVEEDOR CIERRE 201');
insert into public.bloqueos_vuelo (record, destino_id, proveedor_id, fecha_ida, tarifa_neta, cupos_total, modalidad_emision)
select 'PC201', (select id from public.destinos where nombre = 'DESTINO CIERRE 201'),
       (select id from public.proveedores where nombre = 'PROVEEDOR CIERRE 201'), current_date + 30, 400000, 8, 'serie';
insert into public.sillas (bloqueo_id, numero_silla, estado)
select (select id from public.bloqueos_vuelo where record = 'PC201'), g, 'disponible' from generate_series(1, 8) g;
SQL
}
limpiar() { ADM "drop database if exists $DB" >/dev/null 2>&1; rm -rf "$TMP"; }
trap limpiar EXIT
# Copia LLENA del activador: lo que haría el dueño tras verificar Production en Vercel.
sed -e "s/'PEGAR_COMMIT'/'a1b2c3d'/" -e "s#'PEGAR_DOMINIO'#'https://app.dspacios.test'#" -e "s/'no'::text/'si'::text/g"     -e "s/'PEGAR_NOMBRE'/'Dueño de prueba'/" "$AQUI/activar_cierre_firmas_201.sql" > "$TMP/activar.sql"
inventario "$BASE201" "$TMP/inv_201"
inventario "$BASE200" "$TMP/inv_200"
clonar

echo "── 1. Despliegue retrasado: el código viejo NUNCA se bloquea antes de confirmar el nuevo ──"
[ "$(estado_cierre)" = "abierto/abiertas" ] && ok "la 201 nace con el cierre ABIERTO y sin fecha" || fallo "estado inicial: $(estado_cierre)"
# Simula que la 201 lleva 30 días aplicada sin desplegar el código nuevo.
Q "insert into public.vuelos_firmas_antiguas_uso (firma, usado_en) values ('liberar_silla(bigint)', now() - interval '30 days'), ('asignar_contrato_manual(bigint,text)', now() - interval '20 days')" >/dev/null
Q "alter table public.vuelos_cierre_firmas_201 disable trigger vuelos_cierre_firmas_201_monotono; update public.vuelos_cierre_firmas_201 set actualizado_en = now() - interval '30 days'; alter table public.vuelos_cierre_firmas_201 enable trigger vuelos_cierre_firmas_201_monotono;" >/dev/null
viejas_funcionan 1 "30 días después de aplicar, sin código nuevo"
F "$TMP/activar.sql"; espera_error "activar (aun con la verificación de Vercel llena) sin ninguna llamada con versión: se niega" "Todavía no hay ninguna llamada con versión"
QX "update public.vuelos_cierre_firmas_201 set estado = 'cerrado', cierra_en = now()"; espera_error "cerrar de golpe (aun como dueño): se niega" "no se hace de golpe"
[ "$(estado_cierre)" = "abierto/abiertas" ] && ok "  ...y sigue abierto" || fallo "estado: $(estado_cierre)"

echo "── 2. Activación verificada tras el despliegue ──"
CV "select public.editar_pasajero_silla($(S 2), jsonb_build_object('pasajero_nombres', 'NUEVO', 'plazo', $PLAZO, 'esperado', $(ESP 2)))"
sin_error "el código nuevo hace una prueba rápida (editar con versión)"
[ -n "$(Q "select primer_uso_firma_nueva from public.vuelos_cierre_firmas_201")" ] && ok "  ...y queda la evidencia (primer uso del código nuevo)" || fallo "sin evidencia tras la llamada con versión"
QX "select public.programar_cierre_firmas_antiguas(2)"; espera_error "ventana menor a 3 días: se niega" "al menos 3 días"
F "$TMP/activar.sql"; sin_error "activar con evidencia: programado"
[ "$(estado_cierre)" = "programado/abiertas" ] && ok "  ...programado a 7 días; las firmas viejas siguen abiertas" || fallo "estado: $(estado_cierre)"
viejas_funcionan 3 "durante la ventana"
F "$AQUI/postcheck_cierre_firmas_201.sql"; espera_error "postcheck del cierre durante la ventana" "POSTCHECK CIERRE FIRMAS 201: TODO OK"
dice "programadas: cierran el" && ok "  ...muestra la fecha de cierre" || fallo "postcheck no muestra el programado"

echo "── 3. Rollback de la activación (cancelar dentro de la ventana) ──"
F "$AQUI/cancelar_cierre_firmas_201.sql"; sin_error "cancelar dentro de la ventana"
[ "$(estado_cierre)" = "abierto/abiertas" ] && ok "  ...vuelve a abierto sin fecha" || fallo "estado: $(estado_cierre)"
viejas_funcionan 4 "tras cancelar (código anterior re-desplegado)"
F "$AQUI/cancelar_cierre_firmas_201.sql"; espera_error "cancelar sin nada programado: se niega" "no estaba programado"
F "$TMP/activar.sql"; sin_error "re-activar tras volver al código nuevo"

echo "── 4. Ventana cumplida: se cierran solas y NUNCA se reabren ──"
ventana_cumplida
[ "$(estado_cierre)" = "programado/cerradas" ] && ok "al cumplirse la ventana se cierran solas (sin migración ni script)" || fallo "estado: $(estado_cierre)"
viejas_rechazadas 5 "ventana cumplida"
CV "select public.editar_pasajero_silla($(S 5), jsonb_build_object('pasajero_nombres', 'NUEVO 5', 'plazo', $PLAZO, 'esperado', $(ESP 5)))"; sin_error "  ...el código nuevo sigue funcionando (editar con versión)"
CV "select public.asignar_contrato_manual($(S 5), 'EXT-N5', $(VER 5))"; sin_error "  ...asignar con versión"
CV "select public.quitar_contrato_manual($(S 5), public.fecha_negocio(now()) + 2, $(VER 5))"; sin_error "  ...quitar con versión y plazo"
CV "select public.liberar_silla($(S 5), $(VER 5))"; sin_error "  ...Borrar con versión"
F "$AQUI/cancelar_cierre_firmas_201.sql"; espera_error "cancelar después del cierre: se niega" "ya cerraron"
QX "select public.programar_cierre_firmas_antiguas(30)"; espera_error "reprogramar después del cierre: se niega" "ya cerraron"
QX "update public.vuelos_cierre_firmas_201 set estado = 'abierto', cierra_en = null"; espera_error "UPDATE a abierto (como dueño): se niega" "ya cerraron"
QX "delete from public.vuelos_cierre_firmas_201"; espera_error "DELETE del estado: se niega" "no se borra"
QX "truncate public.vuelos_cierre_firmas_201"; espera_error "TRUNCATE del estado: se niega" "no se borra"
QX "update public.vuelos_cierre_firmas_201 set primer_uso_firma_nueva = null"; espera_error "borrar la evidencia: se niega" "no se modifica"
QX "update public.vuelos_cierre_firmas_201 set estado = 'cerrado'"; sin_error "consolidar el estado guardado en 'cerrado' (único cambio admitido)"
[ "$(estado_cierre)" = "cerrado/cerradas" ] && ok "  ...queda cerrado, con fecha de cierre" || fallo "estado: $(estado_cierre)"
QX "update public.vuelos_cierre_firmas_201 set estado = 'programado'"; espera_error "  ...y tampoco vuelve a programado" "ya cerraron"
P "$DB" -1 < "$MIG" > "$TMP/out" 2>&1; sin_error "re-aplicar la 201 sobre una base ya cerrada"
[ "$(estado_cierre)" = "cerrado/cerradas" ] && ok "  ...no reabre nada" || fallo "re-aplicar reabrió: $(estado_cierre)"
F "$AQUI/rollback_201_pasajero_antes_contrato_vuelos.sql"; espera_error "rollback 201 con las firmas cerradas: se niega" "ya cerraron: revertir la 201 las reabriría"
viejas_rechazadas 6 "después de todos los intentos"
F "$AQUI/postcheck_201_flujo_vuelos.sql"; espera_error "postcheck 201 en verde con el cierre puesto" "RESUMEN|t"
F "$AQUI/postcheck_cierre_firmas_201.sql"; espera_error "postcheck del cierre: CERRADAS" "CERRADAS (no se reabren)"

echo "── 5. Rollback solo de CÓDIGO: con la 201 puesta, el código anterior gestiona las retenciones ──"
clonar
CV "select public.editar_pasajero_silla($(S 1), jsonb_build_object('pasajero_nombres', 'RET UNO', 'plazo', $PLAZO))"; sin_error "código viejo: captura una retención (pasajero + plazo)"
[ "$(foto 1 | cut -d/ -f1-3)" = "RET UNO/en_plazo/-" ] && ok "  ...queda retenida en plazo" || fallo "silla 1: $(foto 1)"
CV "select public.asignar_contrato_manual($(S 1), 'EXT-REAL-1')"; sin_error "código viejo: la venta real recibe su contrato"
[ "$(foto 1 | cut -d/ -f1-3)" = "RET UNO/confirmada/EXT-REAL-1" ] && ok "  ...confirmada con su pasajero" || fallo "silla 1: $(foto 1)"
CV "select public.editar_pasajero_silla($(S 2), jsonb_build_object('pasajero_nombres', 'RET DOS', 'plazo', $PLAZO))"
Q "alter table public.sillas disable trigger user; update public.sillas set plazo = public.fecha_negocio(now()) - 1 where id = $(S 2); alter table public.sillas enable trigger user;" >/dev/null
CV "select public.asignar_contrato_manual($(S 2), 'EXT-REAL-2')"; espera_error "código viejo: una retención VENCIDA no recibe contrato" "venció"
CV "select public.editar_pasajero_silla($(S 2), jsonb_build_object('pasajero_nombres', 'RET DOS', 'plazo', (public.fecha_negocio(now()) + 2)::text))"; sin_error "  ...el código viejo actualiza el plazo"
CV "select public.asignar_contrato_manual($(S 2), 'EXT-REAL-2')"; sin_error "  ...y entonces sí recibe el contrato"
CV "select public.editar_pasajero_silla($(S 3), jsonb_build_object('pasajero_nombres', 'RET TRES', 'plazo', $PLAZO))"
CV "select public.liberar_silla($(S 3))"; sin_error "código viejo: Borrar libera una retención (si la persona desiste)"
[ "$(foto 3)" = "-/disponible/-/-" ] && ok "  ...queda disponible y sin datos" || fallo "silla 3: $(foto 3)"

echo "── 6. Rollback TOTAL con retenciones reales: sin 'conservar', solo resoluciones reales ──"
CV "select public.editar_pasajero_silla($(S 4), jsonb_build_object('pasajero_nombres', 'VENTA REAL', 'plazo', $PLAZO, 'esperado', $(ESP 4)))"
CV "select public.editar_pasajero_silla($(S 5), jsonb_build_object('pasajero_nombres', 'SE VENCIO', 'plazo', $PLAZO, 'esperado', $(ESP 5)))"
CV "select public.editar_pasajero_silla($(S 6), jsonb_build_object('pasajero_nombres', 'SIN DECIDIR', 'plazo', $PLAZO, 'esperado', $(ESP 6)))"
Q "alter table public.sillas disable trigger user; update public.sillas set plazo = public.fecha_negocio(now()) - 1 where id = $(S 5); alter table public.sillas enable trigger user;" >/dev/null
F "$AQUI/preparar_rollback_201_retenciones.sql"; espera_error "preparar: 3 retenciones (1 vencida, 2 vigentes por decidir)" "^3|1|2|0|"
dice "nunca" || dice "BLOQUEA el rollback total" && ok "  ...indica qué bloquea y que el contrato debe ser real" || fallo "preparar no explica las vías reales"
F "$AQUI/rollback_201_pasajero_antes_contrato_vuelos.sql"; espera_error "rollback total con retenciones: se niega y las lista" "Quedan 3 retención(es)"
FCON "set app.rollback_201_retenciones = 'conservar';" "$AQUI/rollback_201_pasajero_antes_contrato_vuelos.sql"
espera_error "  ...'conservar' ya no existe: sigue negándose" "Quedan 3 retención(es)"
F "$TMP/activar.sql" >/dev/null
CV "select public.editar_pasajero_silla($(S 7), jsonb_build_object('pasajero_nombres', 'X', 'esperado', $(ESP 7)))" >/dev/null
CV "select public.editar_pasajero_silla($(S 7), jsonb_build_object('pasajero_nombres', null, 'esperado', $(ESP 7)))" >/dev/null
F "$TMP/activar.sql"; sin_error "(activación programada para la prueba siguiente)"
F "$AQUI/rollback_201_pasajero_antes_contrato_vuelos.sql"; espera_error "rollback total con el cierre programado: pide cancelarlo antes" "cancelarlo antes"
F "$AQUI/cancelar_cierre_firmas_201.sql"; sin_error "  ...se cancela (todavía en la ventana)"
CV "select public.asignar_contrato_manual($(S 4), 'EXT-VENTA-REAL', $(VER 4))"; sin_error "venta real: contrato manual con el número de esa venta"
CV "select public.liberar_retencion_vencida($(S 5), $(VER 5))"; sin_error "vencida sin venta: Liberar"
F "$AQUI/rollback_201_pasajero_antes_contrato_vuelos.sql"; espera_error "con 1 vigente sin decidir, sigue esperando" "Quedan 1 retención(es)"
CV "select public.liberar_silla($(S 6), $(VER 6))"; sin_error "la persona desiste: Borrar (datos en auditoría y en el listado)"
F "$AQUI/rollback_201_pasajero_antes_contrato_vuelos.sql"; sin_error "sin retenciones: rollback total aplicado"
inventario "$DB" "$TMP/inv_x"
diff "$TMP/inv_200" "$TMP/inv_x" > "$TMP/d" && ok "catálogo idéntico al de 1–200" || fallo "catálogo distinto del de 1–200: $(head -6 "$TMP/d")"
F "$AQUI/postcheck_192_197_vuelos_fase_b.sql"; espera_error "postcheck 192–197 en verde" "99|RESUMEN|t"
F "$AQUI/preparar_rollback_201_retenciones.sql"; espera_error "preparar después del rollback: 0" "^0|0|0|0|"
[ "$(foto 4 | cut -d/ -f1-3)" = "VENTA REAL/confirmada/EXT-VENTA-REAL" ] && ok "la venta real sigue confirmada con su pasajero" || fallo "silla 4: $(foto 4)"
CV "select public.quitar_contrato_manual($(S 4))"; sin_error "con la 194, la venta se gestiona (quitar contrato manual)"
P "$DB" -1 < "$MIG" > "$TMP/out" 2>&1; sin_error "la 201 se vuelve a aplicar (nunca había cerrado)"
inventario "$DB" "$TMP/inv_x"
diff "$TMP/inv_201" "$TMP/inv_x" > "$TMP/d" && ok "  ...catálogo idéntico al de la 201" || fallo "catálogo distinto tras re-aplicar: $(head -6 "$TMP/d")"

echo
if [ "$FALLOS" -eq 0 ]; then echo "CIERRE Y ROLLBACKS 201: TODO OK (base de prueba borrada)"; else echo "CIERRE Y ROLLBACKS 201: $FALLOS FALLO(S)"; exit 1; fi
