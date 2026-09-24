-- One-time reconciliation for databases started from the codex/ branch before
-- its migrations were merged into main. Stop all application services and
-- back up PostgreSQL before running this script through psql.
-- The canonical main history keeps V4__meshopt_publications.sql unchanged.
BEGIN;
SET LOCAL lock_timeout = '5s';
LOCK TABLE flyway_schema_history IN ACCESS EXCLUSIVE MODE;

DO $$
DECLARE
  branch_count integer;
  meshopt_count integer;
  version_count integer;
BEGIN
  SELECT count(*) INTO branch_count
  FROM flyway_schema_history
  WHERE success AND (
    (version = '4' AND script = 'V4__twin_drive_documents.sql' AND checksum = 1652498715) OR
    (version = '5' AND script = 'V5__user_module_access.sql' AND checksum = -512625541) OR
    (version = '6' AND script = 'V6__project_publications.sql' AND checksum = 910495266)
  );
  SELECT count(*) INTO meshopt_count
  FROM flyway_schema_history
  WHERE success AND version = '7' AND script = 'V7__meshopt_publications.sql'
    AND checksum = 1892771696;
  SELECT count(*) INTO version_count
  FROM flyway_schema_history
  WHERE version IN ('4', '5', '6', '7');

  IF branch_count <> 3 OR meshopt_count > 1 OR version_count <> 3 + meshopt_count THEN
    RAISE EXCEPTION 'Unexpected Flyway V4-V7 history; no changes made';
  END IF;

  UPDATE flyway_schema_history
  SET version = CASE version
      WHEN '4' THEN '5' WHEN '5' THEN '6' WHEN '6' THEN '7' ELSE '4' END,
      script = CASE script
      WHEN 'V4__twin_drive_documents.sql' THEN 'V5__twin_drive_documents.sql'
      WHEN 'V5__user_module_access.sql' THEN 'V6__user_module_access.sql'
      WHEN 'V6__project_publications.sql' THEN 'V7__project_publications.sql'
      ELSE 'V4__meshopt_publications.sql' END
  WHERE version IN ('4', '5', '6', '7');

  RAISE NOTICE 'Reconciled % codex migrations and % existing Meshopt migration',
    branch_count, meshopt_count;
END $$;
COMMIT;
