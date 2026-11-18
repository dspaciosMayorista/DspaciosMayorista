-- Fault injection for the failure scenarios (private copy only). Revert with faltas_off.sql.
update public.programas set portada_url = case id
  when 916009 then 'http://127.0.0.1:54371/slow/8000/huge-1.jpg?p=916009'
  when 916010 then 'http://127.0.0.1:54371/missing/x.jpg?p=916010'
  when 916011 then 'http://127.0.0.1:54371/fail/x.jpg?p=916011'
  when 916012 then 'http://127.0.0.1:54371/trunc/huge-2.jpg?p=916012' end where id between 916009 and 916012;
update public.servicios_adicionales set foto_url = case id
  when 916001 then 'http://127.0.0.1:54371/missing/x.jpg?s=916001'
  when 916002 then 'http://127.0.0.1:54371/fail/x.jpg?s=916002'
  when 916003 then 'http://127.0.0.1:54371/trunc/large-1.jpg?s=916003'
  when 916004 then 'http://127.0.0.1:54371/slow/8000/large-2.jpg?s=916004' end where id between 916001 and 916004;
