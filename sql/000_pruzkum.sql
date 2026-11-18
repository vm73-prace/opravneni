-- 000_pruzkum.sql – JEN ČTENÍ (jediný SELECT), nic nemění.
-- Projekt „servisní záznamy“ (pqehuuamgecmdmrdhmza). Podklad pro 001_init.sql appky opravneni.
select 'schemata' as sekce, (
  select coalesce(jsonb_agg(jsonb_build_object('schema', n.nspname, 'komentar', obj_description(n.oid, 'pg_namespace')) order by n.nspname), '[]'::jsonb)
  from pg_namespace n
  where n.nspname not like 'pg\_%' and n.nspname not in ('information_schema')
) as obsah
union all
select 'profily_sloupce', (
  select coalesce(jsonb_agg(jsonb_build_object('sloupec', column_name, 'typ', udt_name, 'null', is_nullable, 'default', column_default) order by ordinal_position), '[]'::jsonb)
  from information_schema.columns where table_schema = 'public' and table_name = 'profily'
)
union all
select 'profily_pristupy', ( -- jen id, e-mail, aktivni, aplikace (bez dalších osobních údajů)
  select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'email', u.email, 'aktivni', p.aktivni, 'aplikace', p.aplikace) order by u.created_at), '[]'::jsonb)
  from public.profily p left join auth.users u on u.id = p.id
)
union all
select 'profily_politiky_a_triggery', (
  select jsonb_build_object(
    'politiky', (select coalesce(jsonb_agg(jsonb_build_object('politika', policyname, 'prikaz', cmd, 'role', roles::text, 'using', qual, 'with_check', with_check)), '[]'::jsonb)
                 from pg_policies where schemaname = 'public' and tablename = 'profily'),
    'triggery', (select coalesce(jsonb_agg(jsonb_build_object('trigger', t.tgname, 'definice', pg_get_triggerdef(t.oid))), '[]'::jsonb)
                 from pg_trigger t where t.tgrelid = to_regclass('public.profily') and not t.tgisinternal),
    'prava', (select relacl::text from pg_class where oid = to_regclass('public.profily'))
  )
)
union all
select 'smi_funkce', ( -- vzory <slug>.smi() a *_smi() ostatních appek
  select coalesce(jsonb_agg(jsonb_build_object('funkce', n.nspname || '.' || p.proname, 'security_definer', p.prosecdef, 'nastaveni', p.proconfig::text,
    'prava', p.proacl::text, 'definice', pg_get_functiondef(p.oid)) order by 1), '[]'::jsonb)
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where p.proname like '%smi%' and n.nspname not in ('pg_catalog', 'information_schema')
)
union all
select 'storage_politiky', (
  select coalesce(jsonb_agg(jsonb_build_object('politika', policyname, 'prikaz', cmd, 'role', roles::text) order by policyname), '[]'::jsonb)
  from pg_policies where schemaname = 'storage'
)
union all
select 'buckety', (
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'public', public, 'limit', file_size_limit, 'typy', allowed_mime_types) order by id), '[]'::jsonb)
  from storage.buckets
)
union all
select 'storage_triggery', (
  select coalesce(jsonb_agg(jsonb_build_object('tabulka', t.tgrelid::regclass::text, 'trigger', t.tgname)), '[]'::jsonb)
  from pg_trigger t join pg_class c on c.oid = t.tgrelid where not t.tgisinternal and c.relnamespace = 'storage'::regnamespace
)
union all
select 'rozsireni', (
  select coalesce(jsonb_agg(jsonb_build_object('nazev', extname, 'schema', extnamespace::regnamespace::text) order by extname), '[]'::jsonb) from pg_extension
)
union all
select 'role_api', ( -- nastavení PostgREST (exposed schemas, pokud je čitelné)
  select coalesce(jsonb_agg(jsonb_build_object('role', r.rolname, 'nastaveni', r.rolconfig::text)), '[]'::jsonb)
  from pg_roles r where r.rolname in ('authenticator', 'anon', 'authenticated')
)
union all
select 'velikost', (
  select jsonb_build_object('db_mb', round(pg_database_size(current_database()) / 1048576.0, 1),
    'storage_mb', (select round(coalesce(sum((metadata->>'size')::bigint), 0) / 1048576.0, 1) from storage.objects))
);
