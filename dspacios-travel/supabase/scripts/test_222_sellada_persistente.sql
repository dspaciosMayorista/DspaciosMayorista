-- Crea una hija NETO sellada y la DEJA COMMITEADA (para probar que rollback_222 se niega).
-- SOLO base desechable (la segunda base del runner test_222_neto_hija.sh). Nunca una base remota.
\set ON_ERROR_STOP on
\set vect `cat /tmp/netoHija50.vectores.json`
begin;
\ir test_216_fixtures.sql
\ir test_211_fixtures.sql
\ir test_222_fixtures.sql
select t222.hija_de('V1', 922201, 'agencia', 'neto', true, 'admin', 'persist-clave-0001');
commit;
