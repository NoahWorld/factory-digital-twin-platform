CREATE TABLE alarm_episodes (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  scope_id TEXT NOT NULL,
  rule_id TEXT NOT NULL,
  signature TEXT NOT NULL,
  asset_id TEXT NOT NULL,
  name TEXT NOT NULL,
  severity TEXT NOT NULL CHECK(severity IN ('info','warning','critical')),
  message TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  ended_at TEXT,
  end_reason TEXT CHECK(end_reason IN ('recovered','configuration_changed'))
);
CREATE UNIQUE INDEX alarm_one_active_rule ON alarm_episodes(project_id,scope_id,rule_id) WHERE ended_at IS NULL;
CREATE INDEX alarm_episodes_scope ON alarm_episodes(project_id,scope_id,occurred_at);
CREATE TABLE alarm_states (
  project_id TEXT NOT NULL,
  scope_id TEXT NOT NULL,
  rule_id TEXT NOT NULL,
  signature TEXT NOT NULL,
  rule_json TEXT NOT NULL CHECK(json_valid(rule_json)),
  configuration_revision INTEGER NOT NULL,
  confirmation TEXT NOT NULL CHECK(confirmation IN ('pending','known','unknown')),
  active_episode_id TEXT REFERENCES alarm_episodes(id),
  updated_at TEXT NOT NULL,
  PRIMARY KEY(project_id,scope_id,rule_id)
);
CREATE TABLE alarm_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL,
  scope_id TEXT NOT NULL,
  episode_id TEXT NOT NULL REFERENCES alarm_episodes(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN ('triggered','recovered','retired')),
  observed_at TEXT NOT NULL,
  values_json TEXT NOT NULL CHECK(json_valid(values_json))
);
CREATE INDEX alarm_events_scope ON alarm_events(project_id,scope_id,id);
CREATE INDEX alarm_events_retention ON alarm_events(observed_at);
