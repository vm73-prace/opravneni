-- 003_rollback.sql – vrátí 003_ai_log.sql (log AI vyčtení a denní limit). Smaže i záznamy logu.
begin;
drop function if exists opravneni.ai_dokonci(bigint, text, text, int, int, numeric, int);
drop function if exists opravneni.ai_zacni(text, text, int, text);
drop table if exists opravneni.ai_log;
commit;
notify pgrst, 'reload schema';
