#!/bin/sh
# ──────────────────────────────────────────────────────────────────
# CONCURRENCIA · migración 201 — editar / quitar el contrato MANUAL de una silla.
# DOS OPERADORES REALES (dos sesiones), SOLO base LOCAL DESECHABLE en un
# contenedor Docker (nunca remota). Datos PCM* confirmados y borrados al final.
#
# Uso:  sh test_201_contrato_manual_concurrencia.sh <base_desechable> [contenedor]
#
# Cada escenario retiene a la 1.ª sesión antes del COMMIT con sus candados
# tomados, comprueba que la 2.ª queda esperando y entonces la suelta (misma
# "puerta" de test_201_retencion_concurrencia.sh). Las dos vieron la MISMA
# versión de la silla: gana una, la otra se rechaza sin cambiar nada.
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

U1='00000000-0000-0000-0000-0000000e2101'   # control_vuelo mayorista
U2='00000000-0000-0000-0000-0000000e2102'   # otro control_vuelo mayorista

limpiar() {
  $PSQL <<'SQL' >/dev/null || echo "AVISO: la limpieza de datos PCM* falló; revísala a mano." >&2
begin;
do $$ begin
  if to_regclass('public.vuelos_firmas_antiguas_uso') is not null then
    delete from public.vuelos_firmas_antiguas_uso
     where actor_id in ('00000000-0000-0000-0000-0000000e2101', '00000000-0000-0000-0000-0000000e2102');
  end if;
end $$;
delete from public.bloqueo_cambios where bloqueo_id in (select id from public.bloqueos_vuelo where record like 'PCM%');
delete from public.sillas where bloqueo_id in (select id from public.bloqueos_vuelo where record like 'PCM%');
delete from public.bloqueos_vuelo where record like 'PCM%';
delete from public.destinos where nombre = 'PCM DESTINO';
delete from public.proveedores where nombre = 'PCM PROVEEDOR';
delete from public.usuarios where id in ('00000000-0000-0000-0000-0000000e2101', '00000000-0000-0000-0000-0000000e2102');
delete from auth.users where id in ('00000000-0000-0000-0000-0000000e2101', '00000000-0000-0000-0000-0000000e2102');
commit;
SQL
  rm -rf "$TMP"
}
trap limpiar EXIT
limpiar; TMP="$(mktemp -d)"

# PCM001: #1..#6 con contrato manual EXT-n, confirmadas, con pasajero y plazo vigente.
$PSQL <<SQL >/dev/null
insert into auth.users (id, email) values ('$U1', 'pcm-1@local.test'), ('$U2', 'pcm-2@local.test');
update public.usuarios set rol = 'control_vuelo', tenant = 'mayorista', activo = true, nombre = 'PCM Uno' where id = '$U1';
update public.usuarios set rol = 'control_vuelo', tenant = 'mayorista', activo = true, nombre = 'PCM Dos' where id = '$U2';
insert into public.destinos (nombre) values ('PCM DESTINO');
insert into public.proveedores (nombre) values ('PCM PROVEEDOR');
insert into public.bloqueos_vuelo (record, destino_id, proveedor_id, fecha_ida, tarifa_neta, cupos_total) values
  ('PCM001', (select id from public.destinos where nombre = 'PCM DESTINO'), (select id from public.proveedores where nombre = 'PCM PROVEEDOR'), current_date + 40, 300000, 6);
insert into public.sillas (bloqueo_id, numero_silla, estado)
  select b.id, g, 'disponible' from public.bloqueos_vuelo b, generate_series(1, 6) g where b.record = 'PCM001';
update public.sillas set estado = 'confirmada', contrato_manual = 'EXT-' || numero_silla,
       pasajero_nombres = 'PASAJERO ' || numero_silla, numero_doc = '70' || numero_silla, plazo = public.fecha_negocio(now()) + 6
 where bloqueo_id = (select id from public.bloqueos_vuelo where record = 'PCM001');
SQL
A=$($PSQL -c "select id from public.bloqueos_vuelo where record = 'PCM001'")
silla()   { $PSQL -c "select id from public.sillas where bloqueo_id = $A and numero_silla = $1"; }
version() { $PSQL -c "select jsonb_build_object('updated_at', updated_at)::text from public.sillas where id = $1"; }
estado()  { $PSQL -c "select estado || '|' || coalesce(contrato_manual, '-') || '|' || coalesce(pasajero_nombres, '-') from public.sillas where id = $1"; }
lineas()  { $PSQL -c "select count(*) from public.bloqueo_cambios where bloqueo_id = $A and detalle like 'Silla $1: contrato manual%'"; }
PLAZO="public.fecha_negocio(now()) + 3"

PUERTA=420301
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
# carrera <sql_1.ª> <sql_2.ª>: la 1.ª retiene sus candados; la 2.ª espera; se suelta la 1.ª.
carrera() {
  cerrar_puerta
  sesion_retenida "$U1" "$1" "$TMP/r1" &
  P1=$!
  primera_en_puerta
  sesion "$U2" "$2" "$TMP/r2" &
  P2=$!
  segunda_bloqueada
  abrir_puerta
  wait "$P1" "$P2"
}
editar() { echo "public.editar_contrato_manual($1, '$2', '$3'::jsonb)"; }
quitar() { echo "public.quitar_contrato_manual($1, $PLAZO, '$2'::jsonb)"; }

# ── 1. Dos operadores editan la referencia a la vez ────────────────────────
S=$(silla 1); V=$(version "$S")
carrera "$(editar "$S" EXT-1A "$V")" "$(editar "$S" EXT-1B "$V")"
grep -q '^R:' "$TMP/r1" && grep -q 'cambió desde que la viste' "$TMP/r2" && [ "$(estado "$S")" = "confirmada|EXT-1A|PASAJERO 1" ] \
  && [ "$(lineas 1)" = 1 ] \
  && ok "1. editar vs editar: gana la 1.ª (EXT-1A); la 2.ª espera y se rechaza; una sola línea de historial" \
  || { fallo "1. editar vs editar: $(estado "$S")"; cat "$TMP/r1" "$TMP/r2"; }

# ── 2. Uno edita la referencia; otro quita el contrato con la versión vieja ──
S=$(silla 2); V=$(version "$S")
carrera "$(editar "$S" EXT-2A "$V")" "$(quitar "$S" "$V")"
grep -q '^R:' "$TMP/r1" && grep -q 'cambió desde que la viste' "$TMP/r2" && [ "$(estado "$S")" = "confirmada|EXT-2A|PASAJERO 2" ] \
  && ok "2. editar vs quitar: la referencia nueva queda; quitar con la versión vieja se rechaza (no quita un contrato que no vio)" \
  || { fallo "2. editar vs quitar: $(estado "$S")"; cat "$TMP/r1" "$TMP/r2"; }

# ── 3. Uno quita el contrato (queda retenida); otro edita la referencia con la versión vieja ──
S=$(silla 3); V=$(version "$S")
carrera "$(quitar "$S" "$V")" "$(editar "$S" EXT-3B "$V")"
grep -q '^R:' "$TMP/r1" && grep -q 'cambió desde que la viste' "$TMP/r2" && [ "$(estado "$S")" = "en_plazo|-|PASAJERO 3" ] \
  && ok "3. quitar vs editar: queda retenida en plazo sin contrato; editar no resucita el contrato" \
  || { fallo "3. quitar vs editar: $(estado "$S")"; cat "$TMP/r1" "$TMP/r2"; }

# ── 4. Los dos quitan a la vez ───────────────────────────────────────────
S=$(silla 4); V=$(version "$S")
carrera "$(quitar "$S" "$V")" "$(quitar "$S" "$V")"
grep -q '^R:' "$TMP/r1" && grep -q 'cambió desde que la viste' "$TMP/r2" && [ "$(estado "$S")" = "en_plazo|-|PASAJERO 4" ] \
  && [ "$(lineas 4)" = 1 ] \
  && ok "4. quitar vs quitar: una sola vez; la 2.ª se rechaza" \
  || { fallo "4. quitar vs quitar: $(estado "$S")"; cat "$TMP/r1" "$TMP/r2"; }

# ── 5. Uno corrige el pasajero; otro edita la referencia con la versión vieja, y luego con la nueva ──
S=$(silla 5); V=$(version "$S")
PAX="public.editar_pasajero_silla($S, json_build_object('pasajero_nombres', 'CORREGIDO 5', 'numero_doc', '705', 'plazo', ($PLAZO)::text, 'esperado', json_build_object('numero_contrato', null, 'contrato_manual', 'EXT-5', 'updated_at', '$V'::jsonb ->> 'updated_at'))::jsonb)"
carrera "$PAX" "$(editar "$S" EXT-5B "$V")"
grep -q '^R:' "$TMP/r1" && grep -q 'cambió desde que la viste' "$TMP/r2" && [ "$(estado "$S")" = "confirmada|EXT-5|CORREGIDO 5" ] \
  && ok "5a. corregir pasajero vs editar referencia: la corrección queda; la edición con la versión vieja se rechaza" \
  || { fallo "5a. pasajero vs referencia: $(estado "$S")"; cat "$TMP/r1" "$TMP/r2"; }
V=$(version "$S")
sesion "$U2" "$(editar "$S" EXT-5B "$V")" "$TMP/r3"
grep -q '^R:' "$TMP/r3" && [ "$(estado "$S")" = "confirmada|EXT-5B|CORREGIDO 5" ] \
  && ok "5b. con la versión nueva, editar la referencia conserva la corrección del pasajero" \
  || { fallo "5b. editar tras recargar: $(estado "$S")"; cat "$TMP/r3"; }

# ── 6. AVISO: la firma vieja de quitar (sin versión) no comprueba lo que vio ──
S=$(silla 6); V=$(version "$S")
carrera "$(editar "$S" EXT-6A "$V")" "public.quitar_contrato_manual($S)"
if grep -q '^R:' "$TMP/r2" && [ "$(estado "$S")" = "en_plazo|-|PASAJERO 6" ]; then
  echo "AVISO 6. firma vieja quitar_contrato_manual(bigint): esperó y quitó EXT-6A aunque nunca la vio (compatibilidad; se cierra al activarse el cierre tras el despliegue)"
else
  fallo "6. firma vieja: $(estado "$S")"; cat "$TMP/r2"
fi

echo
if [ "$FALLOS" -eq 0 ]; then echo "CONTRATO MANUAL 201: TODO OK (datos de prueba borrados)"; else echo "CONTRATO MANUAL 201: $FALLOS FALLO(S)"; exit 1; fi
