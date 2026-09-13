-- Package provenance is target-project scoped. It never grants source access.
CREATE TABLE project_package_identities (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  source_project_id TEXT NOT NULL,
  entity_kind TEXT NOT NULL CHECK (entity_kind IN ('asset','source','binding','model','image')),
  source_id TEXT NOT NULL,
  target_id TEXT NOT NULL,
  resource_sha256 TEXT,
  PRIMARY KEY(project_id,source_project_id,entity_kind,source_id),
  UNIQUE(project_id,entity_kind,target_id)
);
CREATE TABLE project_package_imports (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  source_project_id TEXT NOT NULL,
  source_version_id TEXT NOT NULL,
  source_snapshot_sha256 TEXT NOT NULL,
  package_manifest_sha256 TEXT NOT NULL,
  version_id TEXT NOT NULL REFERENCES project_versions(id) ON DELETE CASCADE,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  UNIQUE(project_id,source_project_id,source_version_id)
);
CREATE INDEX project_package_imports_version_idx ON project_package_imports(version_id);

CREATE TABLE project_draft_restorations (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  version_id TEXT NOT NULL REFERENCES project_versions(id) ON DELETE CASCADE,
  base_revision INTEGER NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL
);
