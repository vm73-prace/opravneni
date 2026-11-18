-- 002_rollback.sql – vrátí 002_upozorneni.sql (funkce pro skript upozornění). Log ani nastavení nemaže.
begin;
drop function if exists opravneni.zapis_upozorneni(text, jsonb);
drop function if exists opravneni.upozorneni_data(text);
drop function if exists opravneni.over_token(text);
revoke usage on schema opravneni from anon;
commit;
notify pgrst, 'reload schema';
