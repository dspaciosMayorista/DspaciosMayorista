#!/bin/bash
# ──────────────────────────────────────────────────────────────────
# PRUEBA · activación verificada del cierre y SALIDA ante un defecto SQL
# después del cierre irreversible (sin usar la 204 ni una 205 anticipada).
# SOLO base LOCAL DESECHABLE en un contenedor Docker (nunca remota). Se corre
# desde el equipo.
#
# Uso:  bash test_201_salida_post_cierre.sh <contenedor> <base_con_201>
#
# 1. activar_cierre_firmas_201.sql se niega sin la verificación humana de
#    Vercel (commit, Ready/Current, dominio de Production, Previews resueltos),
#    aunque la base ya tenga una llamada con versión (que puede ser de un Preview).
# 2. Defecto simulado en editar_contrato_manual con el cierre ya cumplido:
#    contener → hotfix fuera de banda (guarda, re-ejecución, reversión) →
#    consolidación idempotente; en ningún paso se reabre una firma vieja.
# El paso del tiempo (ventana cumplida) se SIMULA como dueño en la base de prueba.
# ──────────────────────────────────────────────────────────────────
set -u
CT="${1:?contenedor}"; BASE201="${2:?base con 201}"
DB=salida201_prueba
AQUI="$(cd "$(dirname "$0")" && pwd)"
MIG="$AQUI/../migrations/20260601000201_pasajero_antes_contrato_vuelos.sql"
TMP="$(mktemp -d)"
FALLOS=0
CV=00000000-0000-0000-0000-0000000c1202
ok()    { echo "OK    $1"; }
fallo() { echo "FALLO $1"; FALLOS=$((FALLOS + 1)); }
P()   { docker exec -i "$CT" psql -U postgres -d "$1" -X -q -At -v ON_ERROR_STOP=1 "${@:2}"; }
ADM() { docker exec -e PGPASSWORD=postgres "$CT" psql -h 127.0.0.1 -U supabase_admin -d postgres -X -q -c "$1"; }
Q()   { P "$DB" -c "$1"; }
F()   { P "$DB" < "$1" > "$TMP/out" 2>&1; }
CV()  { printf "begin;\nselect set_config('request.jwt.claims', json_build_object('sub', '%s', 'role', 'authenticated')::text, true) is not null;\nset local role authenticated;\n%s;\ncommit;\n" "$CV" "$1" | P "$DB" > "$TMP/out" 2>&1; }
dice() { grep -q -- "$1" "$TMP/out"; }
espera_error() { if dice "$2"; then ok "$1"; else fallo "$1 (salida: $(tr '\n' ' ' < "$TMP/out" | cut -c1-260))"; fi; }
sin_error()    { if dice ERROR; then fallo "$1: $(tr '\n' ' ' < "$TMP/out" | cut -c1-260)"; else ok "$1"; fi; }
S()   { echo "(select id from public.sillas where bloqueo_id = (select id from public.bloqueos_vuelo where record = 'PS201') and numero_silla = $1)"; }
VER() { echo "(select jsonb_build_object('updated_at', updated_at) from public.sillas where id = $(S "$1"))"; }
estado_cierre() { Q "select estado || '/' || case when public._firmas_antiguas_cerradas() then 'cerradas' else 'abiertas' end from public.vuelos_cierre_firmas_201"; }
hash_de() { Q "select md5(replace(prosrc, chr(13), '')) from pg_proc where oid = to_regprocedure('$1')"; }
FIRMA="public.editar_contrato_manual(bigint,text,jsonb)"
limpiar() { ADM "drop database if exists $DB" >/dev/null 2>&1; rm -rf "$TMP"; }
trap limpiar EXIT

ADM "drop database if exists $DB" >/dev/null
ADM "create database $DB template $BASE201 owner postgres" >/dev/null || { echo "No se pudo clonar $BASE201"; exit 2; }
P "$DB" > /dev/null <<SQL
insert into auth.users (id, email) values ('$CV', 'cv-salida@local.test');
update public.usuarios set rol = 'control_vuelo', tenant = 'mayorista', activo = true, nombre = 'CV salida' where id = '$CV';
insert into public.destinos (nombre) values ('DESTINO SALIDA 201');
insert into public.proveedores (nombre) values ('PROVEEDOR SALIDA 201');
insert into public.bloqueos_vuelo (record, destino_id, proveedor_id, fecha_ida, tarifa_neta, cupos_total, modalidad_emision)
select 'PS201', (select id from public.destinos where nombre = 'DESTINO SALIDA 201'),
       (select id from public.proveedores where nombre = 'PROVEEDOR SALIDA 201'), current_date + 30, 400000, 4, 'serie';
insert into public.sillas (bloqueo_id, numero_silla, estado)
select (select id from public.bloqueos_vuelo where record = 'PS201'), g, 'disponible' from generate_series(1, 4) g;
update public.sillas set contrato_manual = 'EXT-S' || numero_silla, estado = 'confirmada', pasajero_nombres = 'PAX ' || numero_silla
 where bloqueo_id = (select id from public.bloqueos_vuelo where record = 'PS201');
SQL

# Copias LLENAS del activador (lo que haría el dueño tras verificar en Vercel).
llenar() { sed -e "s/'PEGAR_COMMIT'/'$1'/" -e "s#'PEGAR_DOMINIO'#'$2'#" -e "s/'no'::text/'$3'::text/g" -e "s/'PEGAR_NOMBRE'/'Dueño de prueba'/" \
             "$AQUI/activar_cierre_firmas_201.sql" > "$TMP/$4.sql"; }
llenar a1b2c3d https://app.dspacios.test si completo
llenar a1b2c3d https://dspacios-git-rama-equipo.vercel.app si preview
llenar a1b2c3d https://app.dspacios.test no incompleto

echo "── 1. Activación: la evidencia de la base NO prueba Producción; se exige la verificación de Vercel ──"
CV "select public.editar_contrato_manual($(S 1), 'EXT-S1', $(VER 1))"
sin_error "una llamada con versión (podría venir de un Preview: misma base)"
[ -n "$(Q "select primer_uso_firma_nueva from public.vuelos_cierre_firmas_201")" ] && ok "  ...la base registra el primer uso" || fallo "sin primer uso"
F "$AQUI/activar_cierre_firmas_201.sql"; espera_error "activador SIN llenar: se niega aunque haya llamada con versión" "Falta el commit del deployment de Production"
F "$TMP/preview.sql";     espera_error "dominio con forma de Preview (-git-): se niega" "parece un Preview"
F "$TMP/incompleto.sql";  espera_error "verificación incompleta (Ready/commit/pantalla/Previews en 'no'): se niega" "verificación en Vercel está incompleta"
[ "$(estado_cierre)" = "abierto/abiertas" ] && ok "  ...ningún intento fallido programó nada" || fallo "estado: $(estado_cierre)"
F "$TMP/completo.sql";    sin_error "verificación completa: programado"
[ "$(Q "select nota like '%commit a1b2c3d%' and nota like '%https://app.dspacios.test%' and nota like '%Dueño de prueba%' from public.vuelos_cierre_firmas_201")" = t ] \
  && ok "  ...la verificación queda como constancia en el estado del cierre" || fallo "nota: $(Q "select nota from public.vuelos_cierre_firmas_201")"
Q "alter table public.vuelos_cierre_firmas_201 disable trigger vuelos_cierre_firmas_201_monotono;
   update public.vuelos_cierre_firmas_201 set cierra_en = now() - interval '1 second' where id = 1;
   alter table public.vuelos_cierre_firmas_201 enable trigger vuelos_cierre_firmas_201_monotono;" >/dev/null
[ "$(estado_cierre)" = "programado/cerradas" ] && ok "ventana cumplida: firmas viejas cerradas (irreversible)" || fallo "estado: $(estado_cierre)"
CIERRE="$(estado_cierre)"
viejas_siguen_cerradas() {
  CV "select public.liberar_silla($(S 4))"; espera_error "  $1: la firma vieja sigue rechazada" "ya no se admite"
  [ "$(estado_cierre)" = "$CIERRE" ] && ok "  $1: el estado del cierre no cambió" || fallo "$1: estado $(estado_cierre)"
}

echo "── 2. Defecto en $FIRMA tras el cierre: CONTENER ──"
sed -e "s/'PEGAR_FIRMA'/'$FIRMA'/" -e "s/'PEGAR_MOTIVO'/'defecto simulado'/" "$AQUI/contener_funcion_201.sql" > "$TMP/contener.sql"
sed -e "s/'PEGAR_FIRMA'/'$FIRMA'/" "$AQUI/levantar_contencion_201.sql" > "$TMP/levantar.sql"
sed -e "s/'PEGAR_FIRMA'/'public.liberar_silla(bigint)'/" -e "s/'PEGAR_MOTIVO'/'x'/" "$AQUI/contener_funcion_201.sql" > "$TMP/contener_vieja.sql"
F "$AQUI/contener_funcion_201.sql"; espera_error "contener sin llenar: se niega" "fuera de la lista de contención"
F "$TMP/contener_vieja.sql";        espera_error "contener una firma VIEJA: fuera de la lista (no se toca)" "fuera de la lista de contención"
F "$TMP/contener.sql";              sin_error "contener la función defectuosa"
CV "select public.editar_contrato_manual($(S 2), 'EXT-S2B', $(VER 2))"; espera_error "  ...la app falla cerrada (permiso denegado), sin tocar datos" "permission denied for function editar_contrato_manual"
[ "$(Q "select contrato_manual from public.sillas where id = $(S 2)")" = EXT-S2 ] && ok "  ...la silla 2 no cambió" || fallo "silla 2 cambió"
CV "select public.asignar_contrato_manual($(S 3), 'X', $(VER 3))"; espera_error "  ...las demás funciones con versión siguen operando" "Solo se asigna un contrato manual"
F "$AQUI/postcheck_201_flujo_vuelos.sql"; espera_error "  ...postcheck 201 la muestra (permiso faltante)" "RESUMEN|f"
F "$TMP/contener.sql";              espera_error "re-contener: no cambia nada" "ya estaba contenida"
viejas_siguen_cerradas "con la contención"

echo "── 3. HOTFIX fuera de banda (sin migración) ──"
H201=$(hash_de "$FIRMA")
awk '/^create or replace function public\.editar_contrato_manual\(/,/^end \$\$;/' "$MIG" \
  | sed "s/'Escribe el número de contrato manual.'/'Escribe el número de contrato manual (corregido).'/" > "$TMP/cuerpo_hotfix.sql"
awk '/^create or replace function public\.editar_contrato_manual\(/,/^end \$\$;/' "$MIG" > "$TMP/cuerpo_201.sql"
grep -q "(corregido)" "$TMP/cuerpo_hotfix.sql" && ok "cuerpo corregido preparado (cambio simulado del defecto)" || fallo "no se pudo preparar el cuerpo"
HFIX=$( { echo "begin;"; cat "$TMP/cuerpo_hotfix.sql"; echo "select md5(replace(prosrc, chr(13), '')) from pg_proc where oid = to_regprocedure('$FIRMA');"; echo "rollback;"; } | P "$DB" | tail -1 )
[ -n "$HFIX" ] && [ "$HFIX" != "$H201" ] && [ "$(hash_de "$FIRMA")" = "$H201" ] && ok "hash del corregido medido en Docker sin dejar cambios" || fallo "medición del hash"
hotfix() { # $1 cuerpo, $2 hash esperado antes, $3 hash nuevo, $4 salida
  sed -e "s/'PEGAR_FIRMA'/'$FIRMA'/" -e "s/'PEGAR_HASH_201'/'$2'/" -e "s/'PEGAR_HASH_HOTFIX'/'$3'/" -e "s/'PEGAR_MOTIVO'/'defecto simulado'/" \
      -e "s/'PEGAR_AUTORIZACION'/'${5:-Dueño, autorizado para este incidente (prueba)}'/" \
      -e "/^@@CUERPO@@$/{r $1" -e "d}" "$AQUI/plantilla_hotfix_201.sql" > "$4"; }
hotfix "$TMP/cuerpo_hotfix.sql" "$H201" "$HFIX" "$TMP/hf_sin_autorizacion.sql" PEGAR_AUTORIZACION
F "$TMP/hf_sin_autorizacion.sql"; espera_error "hotfix SIN autorización del dueño para el incidente: se niega" "Falta la autorización del dueño para ESTE incidente"
[ "$(hash_de "$FIRMA")" = "$H201" ] && ok "  ...y no cambió nada" || fallo "un hotfix sin autorización cambió la función"
hotfix "$TMP/cuerpo_hotfix.sql" 00000000000000000000000000000000 "$HFIX" "$TMP/hf_malo.sql"
hotfix "$TMP/cuerpo_hotfix.sql" "$H201" "$HFIX" "$TMP/hf.sql"
hotfix "$TMP/cuerpo_201.sql"    "$HFIX" "$H201" "$TMP/hf_revertir.sql"
sed -e "s/'PEGAR_FIRMA'/'public._registrar_firma_antigua(text,bigint)'/" -e "s/'PEGAR_HASH_201'/'$H201'/" -e "s/'PEGAR_HASH_HOTFIX'/'$HFIX'/" \
    -e "s/'PEGAR_MOTIVO'/'x'/" -e "s/'PEGAR_AUTORIZACION'/'x'/" -e "/^@@CUERPO@@$/d" "$AQUI/plantilla_hotfix_201.sql" > "$TMP/hf_cierre.sql"
F "$TMP/hf_cierre.sql"; espera_error "hotfix sobre una pieza del cierre: prohibido" "no toca las firmas viejas ni las piezas del cierre"
F "$TMP/hf_malo.sql";   espera_error "hotfix con el hash de origen equivocado: se niega" "ni como la dejó la 201 ni corregida"
[ "$(hash_de "$FIRMA")" = "$H201" ] && ok "  ...y no cambió nada" || fallo "un hotfix rechazado cambió la función"
F "$TMP/hf.sql";        sin_error "hotfix aplicado (guarda de hash, todo o nada)"
[ "$(hash_de "$FIRMA")" = "$HFIX" ] && ok "  ...la función tiene el cuerpo probado" || fallo "hash tras hotfix"
F "$TMP/hf.sql";        espera_error "re-ejecutar el hotfix: mismo cuerpo, sin cambios" "ya estaba aplicado"
viejas_siguen_cerradas "con el hotfix"
F "$TMP/levantar.sql";  sin_error "levantar la contención"
CV "select public.editar_contrato_manual($(S 2), '   ', $(VER 2))"; espera_error "  ...la función corregida responde (comportamiento nuevo)" "(corregido)"
CV "select public.editar_contrato_manual($(S 2), 'EXT-S2B', $(VER 2))"; sin_error "  ...y edita normalmente"

echo "── 4. Revertir el HOTFIX (sí es un rollback real: vuelve al cuerpo de la 201) ──"
F "$TMP/hf_revertir.sql"; sin_error "revertir el hotfix con el cuerpo literal de la 201"
[ "$(hash_de "$FIRMA")" = "$H201" ] && ok "  ...la función vuelve a la 201" || fallo "hash tras revertir"
F "$AQUI/postcheck_201_flujo_vuelos.sql"; espera_error "  ...postcheck 201 en verde" "RESUMEN|t"
viejas_siguen_cerradas "tras revertir el hotfix"
F "$AQUI/rollback_201_pasajero_antes_contrato_vuelos.sql"; espera_error "el rollback TOTAL de la 201 sigue sin estar disponible" "ya cerraron: revertir la 201 las reabriría"

echo "── 5. Consolidación (futura migración, la primera libre DESPUÉS de la 204) ──"
F "$TMP/hf.sql"; sin_error "hotfix aplicado otra vez (estado de Producción)"
# La consolidación usa el mismo esquema: en Producción (ya corregida) no cambia nada.
F "$TMP/hf.sql"; espera_error "consolidar sobre Producción ya corregida: no-op" "ya estaba aplicado"
ADM "drop database if exists ${DB}_nuevo" >/dev/null 2>&1
ADM "create database ${DB}_nuevo template $BASE201 owner postgres" >/dev/null
P "${DB}_nuevo" < "$TMP/hf.sql" > "$TMP/out" 2>&1; sin_error "consolidar sobre un entorno nuevo (solo la 201): aplica el corregido"
[ "$(P "${DB}_nuevo" -c "select md5(replace(prosrc, chr(13), '')) from pg_proc where oid = to_regprocedure('$FIRMA')")" = "$HFIX" ] \
  && ok "  ...ambos entornos terminan con el mismo cuerpo" || fallo "entorno nuevo con otro cuerpo"
[ "$(P "${DB}_nuevo" -c "select estado from public.vuelos_cierre_firmas_201")" = abierto ] \
  && ok "  ...en el entorno nuevo el cierre sigue su propio ciclo (abierto)" || fallo "estado en entorno nuevo"
ADM "drop database if exists ${DB}_nuevo" >/dev/null 2>&1

echo
if [ "$FALLOS" -eq 0 ]; then echo "SALIDA POST-CIERRE 201: TODO OK (bases de prueba borradas)"; else echo "SALIDA POST-CIERRE 201: $FALLOS FALLO(S)"; exit 1; fi
