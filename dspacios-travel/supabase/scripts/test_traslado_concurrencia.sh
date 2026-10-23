#!/bin/sh
# ───────────────────────────────────────────────────────────────────────────
# PRUEBA DE CONCURRENCIA · migración 194 — DOS SESIONES REALES en paralelo.
# SOLO contra una base LOCAL DESECHABLE dentro del contenedor Docker de
# Supabase local (nunca remota). A diferencia de test_traslado_sillas.sql,
# aquí los datos de prueba deben CONFIRMARSE (la otra sesión tiene que verlos);
# se crean con prefijo PC* y se borran al final, pase o falle.
#
# Uso:  sh test_traslado_concurrencia.sh <base_desechable> [contenedor]
#       (p. ej. una copia restaurada con pg_restore; se niega a usar "postgres")
# ───────────────────────────────────────────────────────────────────────────
set -eu
DB="${1:-}"
CT="${2:-supabase_db_sbqvrckukbjzhtzqpyzg}"
if [ -z "$DB" ] || [ "$DB" = "postgres" ]; then
  echo "Indica una base desechable distinta de 'postgres'." >&2; exit 2
fi
# Todo el script corre DENTRO del contenedor (un solo `docker exec`): así cada
# sesión psql arranca en milisegundos y el orden entre las dos sesiones lo
# controla una "puerta" (advisory lock), no la latencia de `docker exec` (en Windows, con
# la máquina cargada, llegó a 5–12 s por llamada y volvía la prueba aleatoria).
if [ "${DENTRO_CONTENEDOR:-}" != 1 ]; then
  exec docker exec -i -e PGPASSWORD=postgres -e DENTRO_CONTENEDOR=1 "$CT" sh -s -- "$DB" "$CT" < "$0"
fi
PSQL="psql -h 127.0.0.1 -U postgres -d $DB -X -q -t -A -v ON_ERROR_STOP=1"
TMP="$(mktemp -d)"
FALLOS=0
ok()    { echo "OK    $1"; }
fallo() { echo "FALLO $1"; FALLOS=$((FALLOS + 1)); }

U='00000000-0000-0000-0000-00000000c001'   # control_vuelo mayorista
U2='00000000-0000-0000-0000-00000000c002'  # otro control_vuelo mayorista

limpiar() {
  $PSQL <<'SQL' >/dev/null || echo "AVISO: la limpieza de datos PC* falló; revísala a mano." >&2
-- Con la migración 200 el historial es inmutable: la limpieza de esta base
-- DESECHABLE usa la salida de mantenimiento (dueño + bandera, en una sola
-- transacción). Sin la 200, la bandera no tiene efecto.
begin;
set local app.correccion_historial = 'on';
delete from public.movimientos_silla where bloqueo_origen_id in (select id from public.bloqueos_vuelo where record like 'PC%')
   or bloqueo_destino_id in (select id from public.bloqueos_vuelo where record like 'PC%');
delete from public.operaciones_vuelo where actor_id in ('00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-00000000c002');
delete from public.sillas where bloqueo_id in (select id from public.bloqueos_vuelo where record like 'PC%');
-- sillas → ventas (FK sillas.numero_contrato) → bloqueos (FK ventas.bloqueo_ref_id)
delete from public.ventas where numero_contrato like 'DTM-995%';
delete from public.bloqueo_cambios where bloqueo_id in (select id from public.bloqueos_vuelo where record like 'PC%');
delete from public.bloqueos_vuelo where record like 'PC%';
delete from public.destinos where nombre = 'PC DESTINO';
delete from public.proveedores where nombre = 'PC PROVEEDOR';
delete from public.usuarios where id in ('00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-00000000c002');
delete from auth.users where id in ('00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-00000000c002');
commit;
SQL
  rm -rf "$TMP"
}
trap limpiar EXIT
limpiar; TMP="$(mktemp -d)"

# ── Fixtures confirmados: CY (6 cupos libres), CX (3 cupos: 1 ocupado, 2 libres) ──
$PSQL <<SQL >/dev/null
insert into auth.users (id, email) values ('$U', 'pc-1@local.test'), ('$U2', 'pc-2@local.test');
update public.usuarios set rol = 'control_vuelo', tenant = 'mayorista', activo = true, nombre = 'PC Uno' where id = '$U';
update public.usuarios set rol = 'control_vuelo', tenant = 'mayorista', activo = true, nombre = 'PC Dos' where id = '$U2';
insert into public.destinos (nombre) values ('PC DESTINO');
insert into public.proveedores (nombre) values ('PC PROVEEDOR');
insert into public.bloqueos_vuelo (record, destino_id, proveedor_id, fecha_ida, tarifa_neta, cupos_total) values
  ('PCY001', (select id from public.destinos where nombre = 'PC DESTINO'), (select id from public.proveedores where nombre = 'PC PROVEEDOR'), current_date + 40, 300000, 6),
  ('PCX001', (select id from public.destinos where nombre = 'PC DESTINO'), (select id from public.proveedores where nombre = 'PC PROVEEDOR'), current_date + 40, 300000, 3);
insert into public.sillas (bloqueo_id, numero_silla, estado)
  select b.id, g, 'disponible' from public.bloqueos_vuelo b, generate_series(1, b.cupos_total) g where b.record like 'PC%';
insert into public.ventas (numero_contrato, cliente, tenant, bloqueo_ref_id) values ('DTM-9950', 'pc', 'mayorista', (select id from public.bloqueos_vuelo where record = 'PCX001'));
update public.sillas set estado = 'confirmada', numero_contrato = 'DTM-9950', pasajero_nombres = 'PAX'
 where bloqueo_id = (select id from public.bloqueos_vuelo where record = 'PCX001') and numero_silla = 1;
SQL
Y=$($PSQL -c "select id from public.bloqueos_vuelo where record = 'PCY001'")
X=$($PSQL -c "select id from public.bloqueos_vuelo where record = 'PCX001'")
SX=$($PSQL -c "select id from public.sillas where bloqueo_id = $X and numero_silla = 1")

suma()   { $PSQL -c "select sum(cupos_total) from public.bloqueos_vuelo where record like 'PC%'"; }
activas(){ $PSQL -c "select count(*) from public.sillas s join public.bloqueos_vuelo b on b.id = s.bloqueo_id where b.record like 'PC%' and s.estado::text not in ('cambio','retirada')"; }
cupos()  { $PSQL -c "select cupos_total from public.bloqueos_vuelo where id = $1"; }
cuadra() { $PSQL -c "select count(*) from public.bloqueos_vuelo b where b.record like 'PC%' and b.cupos_total <> (select count(*) from public.sillas s where s.bloqueo_id = b.id and s.estado::text not in ('cambio','retirada'))"; }
# sesion <uid> <sql> <segundos_de_espera_antes_de_commit> <archivo_salida>
sesion() {
  $PSQL >"$4" 2>&1 <<SQL || true
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '$1', 'role', 'authenticated')::text, true) is not null;
select 'R:' || ($2)::text;
select pg_sleep($3);
commit;
SQL
}
SUMA0=$(suma); ACT0=$(activas)
echo "Inicio: cupos PCY=$(cupos $Y) PCX=$(cupos $X) · suma=$SUMA0 · activas=$ACT0"

# ── Orden determinista con una "puerta" (advisory lock) ─────────────────────
# Nada depende de tiempos fijos: una sesión controladora retiene el advisory
# lock $PUERTA; la 1ª sesión aplica su operación y queda esperando la puerta
# CON sus bloqueos de fila tomados (su transacción sigue abierta); la 2ª se
# lanza y la puerta solo se abre cuando la base confirma que la 2ª está
# esperando esos bloqueos (wait_event_type = 'Lock', no advisory). Así se
# prueba de verdad que la 2ª espera y luego ve el estado confirmado.
PUERTA=424242
# esperar <sql que devuelve un número>: hasta que sea >= 1 (máx. ~60 s).
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
# sesion_retenida <uid> <sql> <archivo>: aplica la operación y espera la puerta antes de COMMIT.
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
primera_en_puerta() {
  esperar "select count(*) from pg_locks where locktype = 'advisory' and objid = $PUERTA and not granted" \
    || fallo "la 1ª sesión no llegó a la puerta (prueba no concluyente)"
}
segunda_bloqueada() {
  esperar "select count(*) from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock' and wait_event <> 'advisory'" \
    || fallo "la 2ª sesión no quedó esperando los bloqueos de la 1ª (prueba no concluyente)"
}

# ── 1. Mismo operacion_id en dos sesiones a la vez (doble clic / reintento) ──
OP='c0c0c0c0-0000-0000-0000-000000000001'
cerrar_puerta
sesion_retenida "$U" "public.trasladar_cupos($Y, $X, 2, 'conc', '$OP')" "$TMP/a1" &
P1=$!
primera_en_puerta
sesion "$U" "public.trasladar_cupos($Y, $X, 2, 'conc', '$OP')" 0 "$TMP/a2" &
P2=$!
segunda_bloqueada
abrir_puerta
wait "$P1" "$P2"
grep -q '"repetida": false' "$TMP/a1" && grep -q '"repetida": true' "$TMP/a2" \
  && ok "1. mismo op simultáneo: la 1ª aplica, la 2ª espera y responde 'repetida'" \
  || { fallo "1. mismo op simultáneo"; cat "$TMP/a1" "$TMP/a2"; }
[ "$(cupos $Y)" = 4 ] && [ "$(cupos $X)" = 5 ] && ok "1. se aplicó UNA sola vez (PCY 6→4, PCX 3→5)" || fallo "1. cupos PCY=$(cupos $Y) PCX=$(cupos $X)"

# ── 2. Dos usuarios trasladan a la vez los MISMOS cupos libres (PCY tiene 4) ──
cerrar_puerta
sesion_retenida "$U" "public.trasladar_cupos($Y, $X, 3, 'conc', gen_random_uuid())" "$TMP/b1" &
P1=$!
primera_en_puerta
sesion "$U2" "public.trasladar_cupos($Y, $X, 3, 'conc', gen_random_uuid())" 0 "$TMP/b2" &
P2=$!
segunda_bloqueada
abrir_puerta
wait "$P1" "$P2"
grep -q '"movidas": 3' "$TMP/b1" && grep -q 'solo tiene 1 cupo(s) libre(s)' "$TMP/b2" \
  && ok "2. competencia por los mismos libres: uno traslada 3, el otro espera, ve que solo queda 1 y se rechaza" \
  || { fallo "2. competencia por libres"; cat "$TMP/b1" "$TMP/b2"; }
[ "$(cupos $Y)" = 1 ] && [ "$(cupos $X)" = 8 ] && ok "2. PCY 4→1, PCX 5→8 (nunca se vendió un cupo dos veces)" || fallo "2. cupos PCY=$(cupos $Y) PCX=$(cupos $X)"

# ── 3. Mover pasajero (modo A, toma 1 libre de PCY) vs trasladar el único libre de PCY ──
cerrar_puerta
sesion_retenida "$U" "public.mover_pasajero($SX, $Y, 'solo_datos', false, 'conc', gen_random_uuid())" "$TMP/c1" &
P1=$!
primera_en_puerta
sesion "$U2" "public.trasladar_cupos($Y, $X, 1, 'conc', gen_random_uuid())" 0 "$TMP/c2" &
P2=$!
segunda_bloqueada
abrir_puerta
wait "$P1" "$P2"
grep -q '"movidas": 1' "$TMP/c1" && grep -q 'solo tiene 0 cupo(s) libre(s)' "$TMP/c2" \
  && ok "3. mover vs trasladar: el pasajero ocupa el libre; el traslado ya no lo encuentra y se rechaza" \
  || { fallo "3. mover vs trasladar"; cat "$TMP/c1" "$TMP/c2"; }
grep -qi deadlock "$TMP/c1" "$TMP/c2" && fallo "3. hubo deadlock" || ok "3. sin deadlock"

# ── 4. La 1ª retiene el record más que el lock_timeout (5 s): la 2ª no espera para siempre ──
cerrar_puerta
sesion_retenida "$U" "public.trasladar_cupos($X, $Y, 1, 'conc', gen_random_uuid())" "$TMP/d1" &
P1=$!
primera_en_puerta
sesion "$U2" "public.trasladar_cupos($X, $Y, 1, 'conc', gen_random_uuid())" 0 "$TMP/d2"   # primer plano: corta sola
abrir_puerta
wait "$P1"
grep -q 'lock timeout' "$TMP/d2" && grep -q '"movidas": 1' "$TMP/d1" \
  && ok "4. la 2ª sesión corta a los 5 s con 'lock timeout' (55P03) y no aplica nada" \
  || { fallo "4. lock_timeout"; cat "$TMP/d1" "$TMP/d2"; }

# ── 5. Respuesta perdida: una sesión CONFIRMA (commit) y OTRA conexión reintenta igual ──
# El pasajero DTM-9950 quedó en PCY (caso 3). Modo B: PCY → PCX con su cupo.
SP=$($PSQL -c "select id from public.sillas where numero_contrato = 'DTM-9950'")
[ "$($PSQL -c "select bloqueo_id from public.sillas where id = $SP")" = "$Y" ] \
  && ok "5. punto de partida: el pasajero está en PCY" || fallo "5. el pasajero no quedó en PCY tras el caso 3"
OP5='c0c0c0c0-0000-0000-0000-000000000005'
CY5=$(cupos $Y); CX5=$(cupos $X)
sesion "$U" "public.mover_pasajero($SP, $X, 'con_cupo', false, 'conc', '$OP5')" 0 "$TMP/e1"
sesion "$U" "public.mover_pasajero($SP, $X, 'con_cupo', false, 'conc', '$OP5')" 0 "$TMP/e2"
grep -q '"repetida": false' "$TMP/e1" && grep -q '"repetida": true' "$TMP/e2" \
  && ok "5. modo B confirmado y reintentado desde otra conexión: el reintento responde 'repetida'" \
  || { fallo "5. reintento modo B"; cat "$TMP/e1" "$TMP/e2"; }
[ "$(cupos $Y)" = $((CY5 - 1)) ] && [ "$(cupos $X)" = $((CX5 + 1)) ] \
  && [ "$($PSQL -c "select bloqueo_id from public.sillas where id = $SP")" = "$X" ] \
  && [ "$($PSQL -c "select count(*) from public.movimientos_silla where operacion_id = '$OP5'")" = 1 ] \
  && ok "5. modo B aplicado UNA sola vez (PCY −1, PCX +1, 1 fila de historial)" \
  || fallo "5. modo B aplicado más de una vez: PCY=$(cupos $Y) PCX=$(cupos $X)"
# Modo A: de vuelta PCX → PCY usando el cupo libre que quedó en PCY.
OP6='c0c0c0c0-0000-0000-0000-000000000006'
CY6=$(cupos $Y); CX6=$(cupos $X)
sesion "$U" "public.mover_pasajero($SP, $Y, 'solo_datos', false, 'conc', '$OP6')" 0 "$TMP/f1"
sesion "$U" "public.mover_pasajero($SP, $Y, 'solo_datos', false, 'otro motivo', '$OP6')" 0 "$TMP/f2"
grep -q '"repetida": false' "$TMP/f1" && grep -q '"repetida": true' "$TMP/f2" \
  && ok "5. modo A confirmado y reintentado desde otra conexión: el reintento responde 'repetida'" \
  || { fallo "5. reintento modo A"; cat "$TMP/f1" "$TMP/f2"; }
[ "$(cupos $Y)" = "$CY6" ] && [ "$(cupos $X)" = "$CX6" ] \
  && [ "$($PSQL -c "select count(*) from public.sillas where numero_contrato = 'DTM-9950'")" = 1 ] \
  && [ "$($PSQL -c "select bloqueo_id from public.sillas where numero_contrato = 'DTM-9950'")" = "$Y" ] \
  && [ "$($PSQL -c "select count(*) from public.movimientos_silla where operacion_id = '$OP6'")" = 1 ] \
  && ok "5. modo A aplicado UNA sola vez (cupos iguales, pasajero en una sola silla de PCY)" \
  || fallo "5. modo A aplicado más de una vez"

# ── Invariantes ─────────────────────────────────────────────────────────────
[ "$(suma)" = "$SUMA0" ] && ok "suma de cupos constante ($SUMA0) tras toda la concurrencia" || fallo "suma de cupos $SUMA0 → $(suma)"
[ "$(activas)" = "$ACT0" ] && ok "suma de sillas activas constante ($ACT0)" || fallo "activas $ACT0 → $(activas)"
[ "$(cuadra)" = 0 ] && ok "cada record: cupos_total = sillas activas" || fallo "hay records descuadrados"
DUP=$($PSQL -c "select count(*) from (select bloqueo_id, numero_silla from public.sillas where bloqueo_id in ($Y, $X) group by 1, 2 having count(*) > 1) d")
[ "$DUP" = 0 ] && ok "sin números de silla repetidos en el destino" || fallo "$DUP números de silla repetidos"

echo
[ "$FALLOS" = 0 ] && echo "CONCURRENCIA: TODO OK (datos de prueba borrados)" || { echo "CONCURRENCIA: $FALLOS FALLO(S)"; exit 1; }
