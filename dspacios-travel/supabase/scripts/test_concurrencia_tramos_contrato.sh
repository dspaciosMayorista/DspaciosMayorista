#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────
# PRUEBA DE CONCURRENCIA REAL — dos conexiones Postgres SEPARADAS guardando
# tramos del MISMO contrato al mismo tiempo, contra guardar_tramos_contrato()
# (migración 157). Un script .sql de una sola conexión NUNCA puede ejercitar
# esto: dos statements en la misma sesión/transacción no compiten por un
# candado entre sí. Aquí sí hay dos procesos `psql` reales, cada uno con su
# propia transacción.
#
#   supabase/scripts/test_concurrencia_tramos_contrato.sh [base] [puerto]
#
# QUÉ PRUEBA
#   guardar_tramos_contrato() valida el payload completo y RECIÉN DESPUÉS
#   bloquea la fila padre de `ventas` (SELECT...FOR UPDATE) antes de
#   escribir. Dos guardados concurrentes del MISMO contrato deben
#   serializarse en ese candado: el segundo espera a que el primero haga
#   COMMIT, y como cada guardado REEMPLAZA el itinerario completo, el
#   resultado final debe ser EXACTAMENTE uno de los dos payloads completos
#   — nunca una mezcla de campos de ambos guardados.
#
# CÓMO — determinismo sin depender de que el SO despache los procesos en
#   un orden exacto:
#   1) Conexión A toma el candado ELLA MISMA con un SELECT...FOR UPDATE
#      manual (antes de llamar al RPC) y lo retiene con un pg_sleep(3) — el
#      RPC, dentro de la misma transacción/conexión, vuelve a pedir el mismo
#      candado (ya lo tiene, no bloquea consigo misma) y guarda su payload.
#   2) Conexión B arranca 1s después (cuando A YA tiene el candado tomado) y
#      llama al RPC directo — su propia validación corre de inmediato, pero
#      el `for update` interno DEBE bloquearse hasta que A haga COMMIT.
#   3) Se espera a que ambos procesos terminen y se verifica el estado
#      final: debe ser EXACTAMENTE el payload de B (que commiteó después),
#      completo — ni una fila de A sobreviviendo, ni campos mezclados.
#
# Requiere PostgreSQL local corriendo (mismo requisito que
# pruebas/local-desde-cero.sh, que este script reutiliza para el andamiaje).
# ─────────────────────────────────────────────────────────────────────────
set -euo pipefail

BASE="${1:-dspacios_concurrencia}"
PUERTO="${2:-5432}"
AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "== Levantando '$BASE' con TODAS las migraciones (reutiliza local-desde-cero.sh)"
"$AQUI/pruebas/local-desde-cero.sh" "$BASE" "$PUERTO" > /tmp/concurrencia_setup.log 2>&1 || {
  echo "   FALLÓ el andamiaje — ver /tmp/concurrencia_setup.log"; cat /tmp/concurrencia_setup.log; exit 1;
}
echo "   listo"

echo "== Fixture: usuario superadmin + contrato con 1 tramo existente"
psql -p "$PUERTO" -d "$BASE" -v ON_ERROR_STOP=1 -q <<'SQL'
insert into auth.users (id, email) values ('c0000001-0000-0000-0000-000000000001', 'sa-conc@test.com')
  on conflict (id) do nothing;
insert into public.usuarios (id, email, nombre, rol, activo, tenant) values
  ('c0000001-0000-0000-0000-000000000001', 'sa-conc@test.com', 'Superadmin Concurrencia', 'superadmin', true, 'mayorista')
  on conflict (id) do update set nombre=excluded.nombre, rol=excluded.rol, activo=excluded.activo, tenant=excluded.tenant;

insert into public.ventas (numero_contrato, cliente, tenant, tipo_paquete) values
  ('77-9001', 'Cliente concurrencia', 'mayorista', 'dinamico')
  on conflict (numero_contrato) do nothing;
insert into public.contrato_vuelos (numero_contrato, aerolinea, direccion, numero_vuelo, orden) values
  ('77-9001', 'Original', 'ida', 'OG100', 0)
  on conflict do nothing;
SQL

# ── Conexión A: toma el candado manualmente, duerme 3s reteniéndolo,
#    guarda su payload (2 tramos, marcados CONCURRENTE_A), COMMIT.
(
  psql -p "$PUERTO" -d "$BASE" -v ON_ERROR_STOP=1 -q <<'SQL' > /tmp/concurrencia_A.log 2>&1
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'c0000001-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);

-- Toma el MISMO candado que usará guardar_tramos_contrato() por dentro —
-- así controlamos desde afuera cuánto tiempo lo retiene esta conexión.
select 1 from public.ventas where numero_contrato = '77-9001' for update;
select pg_sleep(3);

select * from public.guardar_tramos_contrato('77-9001', '[
  {"aerolinea":"CONCURRENTE_A","direccion":"ida","numeroVuelo":"AAA100"},
  {"aerolinea":"CONCURRENTE_A","direccion":"regreso","numeroVuelo":"AAA200"}
]'::jsonb);

commit;
SQL
) &
PID_A=$!

sleep 1
echo "== A ya tiene el candado (tomado hace 1s) — lanzando B, debe BLOQUEARSE hasta que A haga COMMIT"

# ── Conexión B: arranca cuando A YA tiene el candado. Llama al RPC
#    directo — su propia validación es instantánea, pero el `for update`
#    interno debe esperar a que A libere el candado.
(
  T0=$(date +%s)
  psql -p "$PUERTO" -d "$BASE" -v ON_ERROR_STOP=1 -q <<'SQL' > /tmp/concurrencia_B.log 2>&1
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'c0000001-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);

select * from public.guardar_tramos_contrato('77-9001', '[
  {"aerolinea":"CONCURRENTE_B","direccion":"ida","numeroVuelo":"BBB100"}
]'::jsonb);

commit;
SQL
  T1=$(date +%s)
  echo $((T1 - T0)) > /tmp/concurrencia_B_duracion.txt
) &
PID_B=$!

wait "$PID_A" "$PID_B"
echo "== Ambas conexiones terminaron"

DUR_B=$(cat /tmp/concurrencia_B_duracion.txt 2>/dev/null || echo 0)
echo "== B tardó ${DUR_B}s en total (debe ser >= 2s: se quedó esperando el candado de A, que lo soltó a los ~3s de haberlo tomado)"
if [ "$DUR_B" -lt 2 ]; then
  echo "   FALLÓ: B no se bloqueó — terminó demasiado rápido, el candado no está serializando de verdad."
  cat /tmp/concurrencia_A.log /tmp/concurrencia_B.log
  exit 1
fi

echo "== Verificando el estado final: debe ser EXACTAMENTE el payload de B — completo, sin mezcla con A"
RESULTADO=$(psql -p "$PUERTO" -d "$BASE" -tAc "
  select string_agg(aerolinea || '|' || direccion || '|' || numero_vuelo, ',' order by orden)
    from public.contrato_vuelos where numero_contrato = '77-9001';
")
ESPERADO="CONCURRENTE_B|ida|BBB100"

echo "   obtenido:  $RESULTADO"
echo "   esperado:  $ESPERADO"

if [ "$RESULTADO" != "$ESPERADO" ]; then
  echo "   FALLÓ: el estado final NO es exactamente el payload de B (posible mezcla o el orden de commit no fue el esperado)."
  cat /tmp/concurrencia_A.log
  echo "---"
  cat /tmp/concurrencia_B.log
  exit 1
fi

N_FILAS=$(psql -p "$PUERTO" -d "$BASE" -tAc "select count(*) from public.contrato_vuelos where numero_contrato = '77-9001';")
if [ "$N_FILAS" != "1" ]; then
  echo "   FALLÓ: se esperaba EXACTAMENTE 1 fila (el único tramo del payload de B), se encontraron $N_FILAS."
  exit 1
fi

echo "== PASÓ: guardado concurrente serializado correctamente — el resultado final es el guardado completo de B, ninguna fila de A sobrevivió, sin mezcla de campos."
