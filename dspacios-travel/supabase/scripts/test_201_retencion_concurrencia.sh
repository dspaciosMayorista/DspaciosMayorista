#!/bin/sh
# ──────────────────────────────────────────────────────────────────
# CONCURRENCIA · migración 201 — liberación manual de retenciones vencidas.
# DOS SESIONES REALES, SOLO base LOCAL DESECHABLE en un contenedor Docker
# (nunca remota). Datos PV* / DTM-79xx confirmados y borrados al final.
#
# Uso:  sh test_201_retencion_concurrencia.sh <base_desechable> [contenedor]
#
# Cada escenario retiene a la 1.ª sesión antes del COMMIT con sus candados
# tomados, comprueba que la 2.ª queda esperando y entonces la suelta (misma
# "puerta" de test_traslado_concurrencia.sh).
# ──────────────────────────────────────────────────────────────────
set -eu
DB="${1:-}"
CT="${2:-supabase_db_sbqvrckukbjzhtzqpyzg}"
if [ -z "$DB" ] || [ "$DB" = "postgres" ]; then
  echo "Indica una base desechable distinta de 'postgres'." >&2; exit 2
fi
if [ "${DENTRO_CONTENEDOR:-}" != 1 ]; then
  exec docker exec -i -e PGPASSWORD=postgres -e DENTRO_CONTENEDOR=1 "$CT" sh -s -- "$DB" "$CT" < "$0"
fi
PSQL="psql -h 127.0.0.1 -U postgres -d $DB -X -q -t -A -v ON_ERROR_STOP=1"
TMP="$(mktemp -d)"
FALLOS=0
ok()    { echo "OK    $1"; }
fallo() { echo "FALLO $1"; FALLOS=$((FALLOS + 1)); }

U1='00000000-0000-0000-0000-0000000e2091'   # control_vuelo mayorista
U2='00000000-0000-0000-0000-0000000e2092'   # otro control_vuelo mayorista

limpiar() {
  $PSQL <<'SQL' >/dev/null || echo "AVISO: la limpieza de datos PV* falló; revísala a mano." >&2
begin;
set local app.eliminando_contrato = 'true';
do $$ begin
  if to_regclass('public.vuelos_firmas_antiguas_uso') is not null then
    delete from public.vuelos_firmas_antiguas_uso
     where actor_id in ('00000000-0000-0000-0000-0000000e2091', '00000000-0000-0000-0000-0000000e2092');
  end if;
end $$;
delete from public.sillas where bloqueo_id in (select id from public.bloqueos_vuelo where record like 'PV%');
delete from public.ventas where numero_contrato like 'DTM-79%';
delete from public.bloqueo_cambios where bloqueo_id in (select id from public.bloqueos_vuelo where record like 'PV%');
delete from public.bloqueos_vuelo where record like 'PV%';
delete from public.destinos where nombre = 'PV DESTINO';
delete from public.proveedores where nombre = 'PV PROVEEDOR';
delete from public.usuarios where id in ('00000000-0000-0000-0000-0000000e2091', '00000000-0000-0000-0000-0000000e2092');
delete from auth.users where id in ('00000000-0000-0000-0000-0000000e2091', '00000000-0000-0000-0000-0000000e2092');
commit;
SQL
  rm -rf "$TMP"
}
trap limpiar EXIT
limpiar; TMP="$(mktemp -d)"

# PVA001: #1..#4 retenciones VENCIDAS sin contrato (el dueño simula el paso del
# tiempo: plazo de ayer en Bogotá), #5 contrato pendiente vencido (del cron),
# #6 libre.
$PSQL <<SQL >/dev/null
insert into auth.users (id, email) values ('$U1', 'pv-1@local.test'), ('$U2', 'pv-2@local.test');
update public.usuarios set rol = 'control_vuelo', tenant = 'mayorista', activo = true, nombre = 'PV Uno' where id = '$U1';
update public.usuarios set rol = 'control_vuelo', tenant = 'mayorista', activo = true, nombre = 'PV Dos' where id = '$U2';
insert into public.destinos (nombre) values ('PV DESTINO');
insert into public.proveedores (nombre) values ('PV PROVEEDOR');
insert into public.bloqueos_vuelo (record, destino_id, proveedor_id, fecha_ida, tarifa_neta, cupos_total) values
  ('PVA001', (select id from public.destinos where nombre = 'PV DESTINO'), (select id from public.proveedores where nombre = 'PV PROVEEDOR'), current_date + 40, 300000, 11);
insert into public.sillas (bloqueo_id, numero_silla, estado)
  select b.id, g, 'disponible' from public.bloqueos_vuelo b, generate_series(1, 11) g where b.record = 'PVA001';
update public.sillas set estado = 'en_plazo', pasajero_nombres = 'RETENIDO ' || numero_silla, numero_doc = '90' || numero_silla,
       plazo = public.fecha_negocio(now()) - 1
 where bloqueo_id = (select id from public.bloqueos_vuelo where record = 'PVA001') and (numero_silla between 1 and 4 or numero_silla in (10, 11));
-- #7..#9: retenciones VIGENTES (para Borrar / editar con la versión vista).
update public.sillas set estado = 'en_plazo', pasajero_nombres = 'VIGENTE ' || numero_silla, plazo = public.fecha_negocio(now()) + 5
 where bloqueo_id = (select id from public.bloqueos_vuelo where record = 'PVA001') and numero_silla between 7 and 9;
insert into public.ventas (numero_contrato, cliente, tenant, estado, plazo, bloqueo_ref_id) values
  ('DTM-7905', 'pendiente vencido', 'mayorista', 'pendiente', public.fecha_negocio(now()) - 1,
   (select id from public.bloqueos_vuelo where record = 'PVA001'));
update public.sillas set estado = 'en_plazo', numero_contrato = 'DTM-7905', pasajero_nombres = 'DEL CONTRATO', plazo = public.fecha_negocio(now()) - 1
 where bloqueo_id = (select id from public.bloqueos_vuelo where record = 'PVA001') and numero_silla = 5;
SQL
A=$($PSQL -c "select id from public.bloqueos_vuelo where record = 'PVA001'")
silla()   { $PSQL -c "select id from public.sillas where bloqueo_id = $A and numero_silla = $1"; }
version() { $PSQL -c "select jsonb_build_object('updated_at', updated_at)::text from public.sillas where id = $1"; }
estado()  { $PSQL -c "select estado || '|' || coalesce(numero_contrato, contrato_manual, '-') || '|' || coalesce(pasajero_nombres, '-') || '|' || coalesce(plazo::text, '-') from public.sillas where id = $1"; }
cambios() { $PSQL -c "select count(*) from public.bloqueo_cambios where bloqueo_id = $A and detalle like 'Silla $1: retención vencida%'"; }

PUERTA=420291
esperar() {
  for _ in $(seq 1 1200); do
    [ "$($PSQL -c "$1")" -ge 1 ] && return 0
    sleep 0.05
  done
  return 1
}
cerrar_puerta() {
  rm -f "$TMP/puerta"; mkfifo "$TMP/puerta"
  $PSQL < "$TMP/puerta" >/dev/null 2>&1 &
  PUERTA_PID=$!
  exec 3>"$TMP/puerta"
  echo "select pg_advisory_lock($PUERTA);" >&3
  esperar "select count(*) from pg_locks where locktype = 'advisory' and objid = $PUERTA and granted" \
    || fallo "no se pudo cerrar la puerta (prueba no concluyente)"
}
abrir_puerta() {
  echo "select pg_advisory_unlock($PUERTA);" >&3
  exec 3>&-
  wait "$PUERTA_PID" 2>/dev/null || true
}
# sesion_retenida <uid> <sql> <archivo> · sesion <uid> <sql> <archivo>
sesion_retenida() {
  $PSQL >"$3" 2>&1 <<SQL || true
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '$1', 'role', 'authenticated')::text, true) is not null;
select 'R:' || ($2)::text;
select pg_advisory_lock($PUERTA) is not null;
select pg_advisory_unlock($PUERTA);
commit;
SQL
}
sesion() {
  $PSQL >"$3" 2>&1 <<SQL || true
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '$1', 'role', 'authenticated')::text, true) is not null;
select 'R:' || ($2)::text;
commit;
SQL
}
primera_en_puerta() {
  esperar "select count(*) from pg_locks where locktype = 'advisory' and objid = $PUERTA and not granted" \
    || fallo "la 1.ª sesión no llegó a la puerta (prueba no concluyente)"
}
segunda_bloqueada() {
  esperar "select count(*) from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock' and wait_event <> 'advisory'" \
    || fallo "la 2.ª sesión no quedó esperando los candados de la 1.ª (prueba no concluyente)"
}
liberar() { echo "public.liberar_retencion_vencida($1, '$2'::jsonb)"; }

# ── 1. Retención VENCIDA: no recibe contrato hasta actualizar su plazo ────────
HOY=$($PSQL -c "select public.fecha_negocio(now())::text")
ts1()       { $PSQL -c "select updated_at::text from public.sillas where id = $1"; }
plazo_hoy() { echo "public.editar_pasajero_silla($1, json_build_object('pasajero_nombres', '$2', 'plazo', public.fecha_negocio(now())::text, 'esperado', json_build_object('numero_contrato', null, 'contrato_manual', null, 'updated_at', '$3'))::jsonb)"; }
S1=$(silla 1); V1=$(version "$S1")
# 1a. Asignar directo sobre la vencida: rechazo inmediato, nada cambia.
sesion "$U2" "public.asignar_contrato_manual($S1, 'EXT-PV-1', '$V1'::jsonb)" "$TMP/a0"
grep -q 'venció (plazo' "$TMP/a0" && [ "$(estado "$S1" | cut -d'|' -f1-3)" = "en_plazo|-|RETENIDO 1" ] \
  && ok "1a. una retención vencida no recibe contrato: «$(grep -o 'ERROR:.*' "$TMP/a0" | head -1 | cut -c9-95)…»" \
  || { fallo "1a. asignar sobre vencida"; cat "$TMP/a0"; }
# 1b. Otro operador actualiza el plazo a hoy y se retiene; la asignación con la versión vieja espera y se rechaza.
cerrar_puerta
sesion_retenida "$U1" "$(plazo_hoy "$S1" "RETENIDO 1" "$(ts1 "$S1")")" "$TMP/a1" &
P1=$!
primera_en_puerta
sesion "$U2" "public.asignar_contrato_manual($S1, 'EXT-PV-1', '$V1'::jsonb)" "$TMP/a2" &
P2=$!
segunda_bloqueada
abrir_puerta
wait "$P1" "$P2"
grep -q '^R:' "$TMP/a1" && grep -q 'cambió desde que la viste' "$TMP/a2" \
  && ok "1b. la actualización del plazo gana; la asignación con la versión vieja espera y se rechaza" \
  || { fallo "1b. plazo vs asignación"; cat "$TMP/a1" "$TMP/a2"; }
[ "$(estado "$S1")" = "en_plazo|-|RETENIDO 1|$HOY" ] && ok "1b. queda retenida con plazo de hoy y sin contrato" || fallo "1b. estado: $(estado "$S1")"
# 1c. Con la versión nueva (plazo de hoy, aún no vencida) sí se asigna.
V1B=$(version "$S1")
sesion "$U2" "public.asignar_contrato_manual($S1, 'EXT-PV-1', '$V1B'::jsonb)" "$TMP/a3"
grep -q '^R:' "$TMP/a3" && [ "$(estado "$S1")" = "confirmada|EXT-PV-1|RETENIDO 1|$HOY" ] \
  && ok "1c. con el plazo actualizado a hoy, la asignación confirma la retención con su pasajero" || { fallo "1c. asignar tras actualizar plazo"; cat "$TMP/a3"; }
# 1d. FIRMA VIEJA (sin versión) esperando a la actualización del plazo: evalúa la regla sobre el estado ya
#     confirmado (plazo de hoy) y asigna; queda registrada como uso antiguo.
S10=$(silla 10)
cerrar_puerta
sesion_retenida "$U1" "$(plazo_hoy "$S10" "RETENIDO 10" "$(ts1 "$S10")")" "$TMP/a4" &
P1=$!
primera_en_puerta
sesion "$U2" "public.asignar_contrato_manual($S10, 'EXT-PV-10')" "$TMP/a5" &
P2=$!
segunda_bloqueada
abrir_puerta
wait "$P1" "$P2"
grep -q '^R:' "$TMP/a5" && [ "$(estado "$S10" | cut -d'|' -f1-2)" = "confirmada|EXT-PV-10" ] \
  && [ "$($PSQL -c "select count(*) from public.vuelos_firmas_antiguas_uso where firma = 'asignar_contrato_manual(bigint,text)' and silla_id = $S10")" = 1 ] \
  && ok "1d. la firma vieja evalúa la regla bajo candado sobre el estado vigente (plazo de hoy) y queda registrada como uso antiguo" \
  || { fallo "1d. firma vieja tras actualizar plazo"; cat "$TMP/a5"; }
# 1e. Liberar la vencida primero; la actualización del plazo con la versión vieja espera y se rechaza.
S11=$(silla 11); V11=$(version "$S11"); T11=$(ts1 "$S11")
cerrar_puerta
sesion_retenida "$U1" "$(liberar "$S11" "$V11")" "$TMP/a6" &
P1=$!
primera_en_puerta
sesion "$U2" "$(plazo_hoy "$S11" "RETENIDO 11" "$T11")" "$TMP/a7" &
P2=$!
segunda_bloqueada
abrir_puerta
wait "$P1" "$P2"
grep -q '^R:' "$TMP/a6" && grep -q 'cambió desde que la viste' "$TMP/a7" && [ "$(estado "$S11")" = "disponible|-|-|-" ] \
  && ok "1e. la liberación gana; actualizar el plazo con la versión vieja se rechaza y no resucita la retención" \
  || { fallo "1e. liberar vs actualizar plazo"; cat "$TMP/a6" "$TMP/a7"; }

# ── 2. Liberar primero; la asignación (con la versión que vio) espera y se rechaza ──
S2=$(silla 2); V2=$(version "$S2")
cerrar_puerta
sesion_retenida "$U1" "$(liberar "$S2" "$V2")" "$TMP/b1" &
P1=$!
primera_en_puerta
sesion "$U2" "public.asignar_contrato_manual($S2, 'EXT-PV-2', '$V2'::jsonb)" "$TMP/b2" &
P2=$!
segunda_bloqueada
abrir_puerta
wait "$P1" "$P2"
grep -q '^R:' "$TMP/b1" && ok "2. la liberación (versión vigente) se aplica" || { fallo "2. liberación"; cat "$TMP/b1"; }
grep -q 'cambió desde que la viste' "$TMP/b2" && [ "$(estado "$S2")" = "disponible|-|-|-" ] \
  && ok "2. la asignación con la versión vieja se rechaza: la silla queda libre, sin contrato ni datos inesperados" \
  || { fallo "2. la asignación tras la liberación: $(estado "$S2")"; cat "$TMP/b2"; }
[ "$(cambios 2)" = 1 ] && [ "$($PSQL -c "select count(*) from public.auditoria where tabla = 'sillas' and registro_id = '$S2' and antes ->> 'pasajero_nombres' = 'RETENIDO 2'")" -ge 1 ] \
  && ok "2. la liberación dejó su línea en el historial del record y la imagen anterior en auditoría" || fallo "2. auditoría de la liberación"

# ── 3. Otro operador edita (extiende el plazo) primero; la liberación espera ──
S3=$(silla 3); V3=$(version "$S3")
cerrar_puerta
sesion_retenida "$U1" "public.editar_pasajero_silla($S3, '{\"pasajero_nombres\":\"RETENIDO 3 EXTENDIDO\",\"numero_doc\":\"903\",\"plazo\":\"2099-12-31\",\"esperado\":{\"numero_contrato\":null,\"contrato_manual\":null}}'::jsonb)" "$TMP/c1" &
P1=$!
primera_en_puerta
sesion "$U2" "$(liberar "$S3" "$V3")" "$TMP/c2" &
P2=$!
segunda_bloqueada
abrir_puerta
wait "$P1" "$P2"
grep -q '^R:' "$TMP/c1" && grep -qE 'aún no vence|cambió desde que la viste' "$TMP/c2" \
  && ok "3. la edición gana; la liberación se rechaza con un mensaje claro: «$(grep -o 'ERROR:.*' "$TMP/c2" | head -1 | cut -c9-80)…»" \
  || { fallo "3. edición vs liberación"; cat "$TMP/c1" "$TMP/c2"; }
[ "$(estado "$S3")" = "en_plazo|-|RETENIDO 3 EXTENDIDO|2099-12-31" ] && [ "$(cambios 3)" = 0 ] \
  && ok "3. la edición del otro operador se conserva entera; nada se borró" || fallo "3. estado final: $(estado "$S3")"

# ── 4. Doble clic: dos liberaciones de la misma silla a la vez ────────────────
S4=$(silla 4); V4=$(version "$S4")
cerrar_puerta
sesion_retenida "$U1" "$(liberar "$S4" "$V4")" "$TMP/d1" &
P1=$!
primera_en_puerta
sesion "$U2" "$(liberar "$S4" "$V4")" "$TMP/d2" &
P2=$!
segunda_bloqueada
abrir_puerta
wait "$P1" "$P2"
grep -q '^R:' "$TMP/d1" && grep -q 'ya no está retenida' "$TMP/d2" \
  && ok "4. la 1.ª libera; la 2.ª espera y responde que ya no está retenida" || { fallo "4. doble liberación"; cat "$TMP/d1" "$TMP/d2"; }
[ "$(cambios 4)" = 1 ] && [ "$(estado "$S4")" = "disponible|-|-|-" ] \
  && ok "4. una sola liberación registrada; silla disponible y sin datos" || fallo "4. cambios=$(cambios 4) estado=$(estado "$S4")"

# ── 5. El cron no toca retenciones; solo su contrato pendiente ────────────────
$PSQL -c "update public.sillas set estado = 'en_plazo', pasajero_nombres = 'RETENIDO 6', plazo = public.fecha_negocio(now()) - 1 where id = $(silla 6)" >/dev/null
$PSQL -c "set role service_role; select public.liberar_vencidas(public.fecha_negocio(now()));" > "$TMP/e1" 2>&1
[ "$(estado "$(silla 6)")" = "en_plazo|-|RETENIDO 6|$($PSQL -c "select (public.fecha_negocio(now()) - 1)::text")" ] \
  && [ "$(estado "$(silla 5)")" = "disponible|-|-|-" ] \
  && [ "$($PSQL -c "select estado from public.ventas where numero_contrato = 'DTM-7905'")" = "cancelado" ] \
  && ok "5. el cron liberó solo el contrato pendiente vencido; la retención vencida sigue esperando liberación manual" \
  || { fallo "5. cron"; cat "$TMP/e1"; echo "#5 $(estado "$(silla 5)") · #6 $(estado "$(silla 6)")"; }

# ── 6. Borrar (liberar_silla con versión) frente a una edición ────────────────
ts()     { $PSQL -c "select updated_at::text from public.sillas where id = $1"; }
editar() { echo "public.editar_pasajero_silla($1, json_build_object('pasajero_nombres', '$2', 'plazo', (public.fecha_negocio(now()) + 5)::text, 'esperado', json_build_object('numero_contrato', null, 'contrato_manual', null, 'updated_at', '$3'))::jsonb)"; }
borrar() { echo "public.liberar_silla($1, '$2'::jsonb)"; }
# 6a. La edición va primero; el Borrar (con la versión que vio su pantalla) espera.
S7=$(silla 7); V7=$(version "$S7"); T7=$(ts "$S7")
cerrar_puerta
sesion_retenida "$U1" "$(editar "$S7" "EDITADO 7" "$T7")" "$TMP/f1" &
P1=$!
primera_en_puerta
sesion "$U2" "$(borrar "$S7" "$V7")" "$TMP/f2" &
P2=$!
segunda_bloqueada
abrir_puerta
wait "$P1" "$P2"
grep -q '^R:' "$TMP/f1" && grep -q 'cambió desde que la viste' "$TMP/f2" \
  && ok "6a. la edición gana; el Borrar con la versión vieja se rechaza sin borrar nada" || { fallo "6a. edición vs Borrar"; cat "$TMP/f1" "$TMP/f2"; }
[ "$(estado "$S7" | cut -d'|' -f1-3)" = "en_plazo|-|EDITADO 7" ] && ok "6a. la edición del otro operador se conserva" || fallo "6a. estado final: $(estado "$S7")"

# 6b. El Borrar va primero; la edición (con la versión vieja) espera.
S8=$(silla 8); V8=$(version "$S8"); T8=$(ts "$S8")
cerrar_puerta
sesion_retenida "$U1" "$(borrar "$S8" "$V8")" "$TMP/g1" &
P1=$!
primera_en_puerta
sesion "$U2" "$(editar "$S8" "EDITADO 8" "$T8")" "$TMP/g2" &
P2=$!
segunda_bloqueada
abrir_puerta
wait "$P1" "$P2"
grep -q '^R:' "$TMP/g1" && grep -q 'cambió desde que la viste' "$TMP/g2" \
  && ok "6b. el Borrar gana; la edición con la versión vieja se rechaza sin escribir nada" || { fallo "6b. Borrar vs edición"; cat "$TMP/g1" "$TMP/g2"; }
[ "$(estado "$S8")" = "disponible|-|-|-" ] && ok "6b. la silla queda libre y sin datos de nadie" || fallo "6b. estado final: $(estado "$S8")"

# 7. FIRMA VIEJA sin versión (compatibilidad de despliegue): se documenta que NO protege.
S9=$(silla 9); T9=$(ts "$S9")
cerrar_puerta
sesion_retenida "$U1" "$(editar "$S9" "EDITADO 9" "$T9")" "$TMP/h1" &
P1=$!
primera_en_puerta
sesion "$U2" "public.liberar_silla($S9)" "$TMP/h2" &
P2=$!
segunda_bloqueada
abrir_puerta
wait "$P1" "$P2"
if grep -q '^R:' "$TMP/h2" && [ "$(estado "$S9")" = "disponible|-|-|-" ]; then
  echo "AVISO 7. liberar_silla(bigint), la firma VIEJA sin versión, borró la edición concurrente: queda sin protección hasta que se active el cierre tras desplegar el código nuevo"
else
  fallo "7. se esperaba demostrar que la firma vieja no protege: $(estado "$S9")"; cat "$TMP/h2"
fi

# ── Identidad ───────────────────────────────────────────────────────────────
[ "$($PSQL -c "select string_agg(numero_silla::text, ',' order by numero_silla) from public.sillas where bloqueo_id = $A")" = "1,2,3,4,5,6,7,8,9,10,11" ] \
  && ok "las 11 sillas conservan id y número histórico" || fallo "identidad de sillas"

echo
[ "$FALLOS" = 0 ] && echo "CONCURRENCIA RETENCIONES: TODO OK (datos de prueba borrados)" || { echo "CONCURRENCIA RETENCIONES: $FALLOS FALLO(S)"; exit 1; }
