-- 001_rollback.sql – vrátí 001_init.sql. Celé v jedné transakci: při chybě se neprovede nic.
-- Smaže schéma opravneni (VŠECHNA data oprávnění!), storage politiky „opravneni - …“, bucket opravneni-doklady
-- (jen když je prázdný). Objekty ostatních appek nechá být. Přístup účtů vrací sql/lokalni/001b_rollback.sql
-- (na pořadí nezáleží).
-- Potom v Dashboardu: Data API → Exposed schemas odeber `opravneni`.

begin;

-- Bucket mažeme jen prázdný; soubory se musí smazat přes Storage API (Dashboard → Storage).
do $$
begin
  if exists (select 1 from storage.objects where bucket_id = 'opravneni-doklady') then
    raise exception 'Bucket opravneni-doklady není prázdný – nejdřív smaž soubory v Dashboard → Storage.';
  end if;
end $$;

drop policy if exists "opravneni - cteni dokladu"   on storage.objects;
drop policy if exists "opravneni - nahrani dokladu" on storage.objects;
drop policy if exists "opravneni - zmena dokladu"   on storage.objects;
drop policy if exists "opravneni - mazani dokladu"  on storage.objects;

-- Supabase chrání storage tabulky triggerem; povolení platí jen do konce této transakce.
set local storage.allow_delete_query = 'true';
delete from storage.buckets where id = 'opravneni-doklady';

drop schema if exists opravneni cascade;

commit;

notify pgrst, 'reload schema';
