#!/bin/sh
# ──────────────────────────────────────────────────────────────────
# #65 · Verificación local de la migración 267 (recobro con beneficiario explícito) sobre el ESQUEMA COMPLETO 001-266 (sin la 267).
# SOLO Docker local y desechable. Cada base nueva sale de la plantilla y se borra al final (KEEP=1 las conserva).
#
# Uso (desde dspacios-travel/):
#   sh supabase/scripts/preparar_esquema_local.sh <contenedor> 266 plantilla65rec   # una vez (≈10 min); «266» excluye la 267 por sí solo
#   sh supabase/scripts/test_267_recobro_beneficiario.sh <contenedor> [plantilla]
#     plantilla  base con 001-266 SIN la 267 (por defecto plantilla65rec); solo se lee.
#
# GATES (todo es «exit ≠ 0» si falla; nada se da por bueno por defecto):
#   G1  la 267 se aplica; reaplicarla es idempotente.
#   G2  batería SQL (test_267_recobro_beneficiario.sql): psql con ON_ERROR_STOP=1 debe terminar con código 0, imprimir EXACTAMENTE
#       las afirmaciones esperadas con «OK», cero «FALLO», y la tabla t216.res debe coincidir (total = ok = esperadas).
#   G3  COMMIT REAL (base aparte, sin set constraints): una conversión sin beneficiario FALLA en el COMMIT con
#       RECOBRO_SIN_BENEFICIARIO y no deja venta ni línea; una con beneficiario hace COMMIT y deja la ficha.
#   G4  control NEGATIVO: la misma batería sobre una base SIN la 267 debe ser rechazada por el mismo gate (si pasara, el gate no sirve).
#   G5  rollback_267 quita trigger y función sin tocar datos; la 267 se reaplica después.
# ──────────────────────────────────────────────────────────────────
set -eu
CT="${1:-}"
PLANTILLA="${2:-plantilla65rec}"
ESPERADAS=27
export MSYS_NO_PATHCONV=1
ok_nombre() { printf '%s' "$1" | grep -Eq "$2"; }
ok_nombre "$CT" '^[A-Za-z0-9][A-Za-z0-9_.-]{0,62}$' || { echo "Uso: test_267_recobro_beneficiario.sh <contenedor> [plantilla]" >&2; exit 2; }
ok_nombre "$PLANTILLA" '^[a-z][a-z0-9_]{0,62}$' || { echo "Plantilla inválida." >&2; exit 2; }

AQUI="$(cd "$(dirname "$0")" && pwd)"
APP="$(cd "$AQUI/../.." && pwd)"
M267="$APP/supabase/migrations/20260601000267_recobro_beneficiario_explicito.sql"
RB267="$AQUI/rollback_267_recobro_beneficiario.sql"
VECTORES="$APP/pruebas/netoHija50.vectores.json"
DIR=/tmp/s267run
PW="${PGPASSWORD_267:-postgres}"
PS="docker exec -i -w $DIR -e PGPASSWORD=$PW $CT psql -h 127.0.0.1 -U supabase_admin -X -q"
SUF="$(od -An -N3 -tx1 /dev/urandom | tr -d ' \n')"
MARCA="test_267 $SUF"
DBA="t267_a_$SUF"; DBB="t267_b_$SUF"; DBC="t267_c_$SUF"
BASES=""
TMP="$(mktemp -d)"

limpiar() {
  st=$?
  rm -rf "$TMP"
  if [ "${KEEP:-}" != 1 ]; then
    for b in $BASES; do
      [ "$($PS -t -A -d postgres -c "select shobj_description(oid, 'pg_database') from pg_database where datname = '$b'" 2>/dev/null)" = "$MARCA" ] \
        && $PS -d postgres -c "drop database $b" >/dev/null 2>&1 || true
    done
  fi
  exit "$st"
}
trap limpiar EXIT

fallo() { echo "FALLO: $1" >&2; exit 1; }
ok() { echo "OK  $1"; }

docker inspect -f '{{.State.Running}}' "$CT" 2>/dev/null | grep -qx true || { echo "El contenedor $CT no está corriendo." >&2; exit 2; }
docker exec "$CT" sh -c "rm -rf $DIR && mkdir -p $DIR"
[ "$($PS -t -A -d postgres -c "select count(*) from pg_database where datname = '$PLANTILLA'")" = 1 ] || { echo "No existe la plantilla $PLANTILLA." >&2; exit 2; }
[ "$($PS -t -A -d "$PLANTILLA" -c "select count(*) from pg_trigger where tgname = 'trg_recobro_beneficiario_explicito'")" = 0 ] || { echo "La plantilla ya tiene la 267: debe ser la 001-266 sin la 267." >&2; exit 2; }

# Los scripts van por stdin (sin rutas de Windows) para que \ir funcione.
for f in test_216_fixtures.sql test_211_fixtures.sql test_222_fixtures.sql test_267_helpers.sql test_267_recobro_beneficiario.sql rollback_267_recobro_beneficiario.sql; do
  docker exec -i "$CT" sh -c "cat > $DIR/$f" < "$AQUI/$f"
done
docker exec -i "$CT" sh -c "cat > $DIR/267.sql" < "$M267"
docker exec -i "$CT" sh -c 'cat > /tmp/netoHija50.vectores.json' < "$VECTORES"

crear_base() { # $1 = nombre
  i=1
  until $PS -d postgres -c "create database $1 template $PLANTILLA" >/dev/null 2>"$TMP/cb.err"; do
    [ "$i" -lt 8 ] || { cat "$TMP/cb.err" >&2; fallo "no se pudo crear $1"; }
    i=$((i + 1)); sleep 2
  done
  BASES="$BASES $1"
  $PS -d postgres -c "comment on database $1 is '$MARCA'" >/dev/null
  $PS -d "$1" >/dev/null <<'SQL'
create or replace function auth.uid() returns uuid language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
                  (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid
$$;
create or replace function auth.role() returns text language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''),
                  (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'))::text
$$;
SQL
}
uno() { $PS -t -A -d "$1" -c "$2"; }
aplica_267() { $PS -d "$1" -1 -v ON_ERROR_STOP=1 -f "$DIR/267.sql" >"$TMP/ap.out" 2>&1 || { cat "$TMP/ap.out" >&2; fallo "la 267 no se aplicó en $1"; }; }

# Evalúa la batería SQL y devuelve 0 SOLO si TODOS los gates se cumplen; imprime el motivo si no.
evaluar_bateria() { # $1 = base ; $2 = salida
  if ! $PS -t -A -F '|' -v ON_ERROR_STOP=1 -d "$1" -f "$DIR/test_267_recobro_beneficiario.sql" >"$2" 2>&1; then
    echo "  psql terminó con error" >&2; grep -E "ERROR|FALLO" "$2" | head -5 | cut -c1-300 >&2; return 1
  fi
  n_ok="$(grep -c 'NOTICE:  OK  ' "$2" || true)"
  n_fallo="$(grep -c 'NOTICE:  FALLO' "$2" || true)"
  resumen="$(grep '^T267_RESUMEN|' "$2" || true)"
  [ "$n_fallo" = 0 ] || { echo "  $n_fallo afirmaciones en FALLO" >&2; grep 'NOTICE:  FALLO' "$2" | head -5 | cut -c1-260 >&2; return 1; }
  [ "$n_ok" = "$ESPERADAS" ] || { echo "  afirmaciones OK=$n_ok (esperadas $ESPERADAS)" >&2; return 1; }
  [ "$resumen" = "T267_RESUMEN|$ESPERADAS|$ESPERADAS|0" ] || { echo "  resumen inesperado: $resumen" >&2; return 1; }
  return 0
}

echo "=== G1 · aplicar la 267 (e idempotencia) ==="
crear_base "$DBA"
aplica_267 "$DBA"; ok "la 267 se aplica sobre el esquema 001-266"
aplica_267 "$DBA"; ok "reaplicarla es idempotente (create or replace + drop/create trigger)"

echo "=== G2 · batería SQL con conversiones REALES (198, 222 PVP y NETO) ==="
if evaluar_bateria "$DBA" "$TMP/bat.out"; then
  grep -E '^psql:.*NOTICE:  (OK|FALLO)|^NOTICE:  (OK|FALLO)' "$TMP/bat.out" | sed -E 's/^psql:[^ ]+ //' | cut -c1-170
  ok "batería: $ESPERADAS/$ESPERADAS afirmaciones OK, cero FALLO, psql sin error"
else
  cat "$TMP/bat.out" | cut -c1-300 | tail -30 >&2; fallo "la batería SQL no cumple los gates"
fi

echo "=== G3 · COMMIT REAL (sin set constraints): el trigger diferido corre al confirmar ==="
crear_base "$DBB"
aplica_267 "$DBB"
$PS -d "$DBB" -v ON_ERROR_STOP=1 >/dev/null <<'SQL' || fallo "no se pudieron preparar las fixtures de la base B"
\set vect `cat /tmp/netoHija50.vectores.json`
begin;
\ir test_216_fixtures.sql
\ir test_211_fixtures.sql
\ir test_222_fixtures.sql
\ir test_267_helpers.sql
insert into t216.ids values ('ok', t267.cot('freelance', 'Free 267')), ('sin', t267.cot('freelance', '')), ('amb', t267.cot('freelance', 'Ambigua 267'));
commit;
SQL
ID_OK="$(uno "$DBB" "select v from t216.ids where k = 'ok'")"; ID_SIN="$(uno "$DBB" "select v from t216.ids where k = 'sin'")"; ID_AMB="$(uno "$DBB" "select v from t216.ids where k = 'amb'")"
conv_sql() { printf "begin; select t216.escalar('service_role', null, t216.convertir_sql(%s)); commit;" "$1"; }
V0="$(uno "$DBB" 'select count(*) from public.ventas')"
for caso in "SIN:$ID_SIN" "AMB:$ID_AMB"; do
  nombre="${caso%%:*}"; id="${caso##*:}"
  if SAL="$($PS -d "$DBB" -v ON_ERROR_STOP=1 -c "$(conv_sql "$id")" 2>&1)"; then fallo "G3 $nombre: el COMMIT NO falló"; fi
  echo "$SAL" | grep -q 'RECOBRO_SIN_BENEFICIARIO' || fallo "G3 $nombre: el error no es RECOBRO_SIN_BENEFICIARIO: $SAL"
  [ "$(uno "$DBB" "select estado || '/' || coalesce(numero_contrato, '-') from public.cotizaciones where id = $id")" = "abierta/-" ] || fallo "G3 $nombre: la cotización cambió"
  [ "$(uno "$DBB" "select count(*) from public.ventas where cotizacion_id = $id")" = 0 ] || fallo "G3 $nombre: quedó una venta"
  ok "G3 $nombre: el COMMIT falla con RECOBRO_SIN_BENEFICIARIO y la cotización sigue abierta, sin venta"
done
[ "$(uno "$DBB" 'select count(*) from public.ventas')" = "$V0" ] || fallo "G3: cambió el número de ventas tras los commits fallidos"
[ "$(uno "$DBB" "select count(*) from public.aliados_b2b where numero_contrato not in (select numero_contrato from public.ventas)")" = 0 ] || fallo "G3: quedaron líneas de comisión huérfanas"
$PS -d "$DBB" -v ON_ERROR_STOP=1 -c "$(conv_sql "$ID_OK")" >/dev/null 2>"$TMP/c.err" || { cat "$TMP/c.err" >&2; fallo "G3: el COMMIT con beneficiario acreditado falló"; }
[ "$(uno "$DBB" "select aliado_id || '/' || aliado || '/' || tipo_aliado || '/' || recobro_total from public.aliados_b2b where numero_contrato = (select numero_contrato from public.cotizaciones where id = $ID_OK)")" = "925701/Free 267/freelance/200000.00" ] \
  || fallo "G3: la línea confirmada no quedó con la ficha 925701"
ok "G3 acreditado: el COMMIT confirma y la línea queda con la ficha 925701 sin cambiar el importe"

echo "=== G4 · control NEGATIVO: sin la 267 el mismo gate debe RECHAZAR la batería ==="
crear_base "$DBC"
if evaluar_bateria "$DBC" "$TMP/neg.out" 2>"$TMP/neg.err"; then fallo "G4: la batería PASÓ sin la 267; el gate no detecta nada"; fi
ok "G4: sin la 267 el gate rechaza ($(grep -c 'NOTICE:  FALLO' "$TMP/neg.out" || true) FALLO, motivo: $(head -1 "$TMP/neg.err" | cut -c1-80))"

echo "=== G5 · rollback_267 y reaplicación ==="
$PS -d "$DBA" -1 -v ON_ERROR_STOP=1 -f "$DIR/rollback_267_recobro_beneficiario.sql" >/dev/null || fallo "G5: el rollback falló"
[ "$(uno "$DBA" "select count(*) from pg_trigger where tgname = 'trg_recobro_beneficiario_explicito'")" = 0 ] || fallo "G5: el trigger sigue"
[ "$(uno "$DBA" "select count(*) from pg_proc where proname = 'fn_recobro_beneficiario_explicito'")" = 0 ] || fallo "G5: la función sigue"
ok "G5: rollback quita trigger y función"
aplica_267 "$DBA"
[ "$(uno "$DBA" "select count(*) from pg_trigger where tgname = 'trg_recobro_beneficiario_explicito' and tgdeferrable and tginitdeferred")" = 1 ] || fallo "G5: tras reaplicar no quedó el trigger diferido"
ok "G5: la 267 se reaplica tras el rollback"
echo "TODO OK"
