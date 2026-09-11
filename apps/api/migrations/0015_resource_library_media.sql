CREATE TABLE media_assets (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  original_filename TEXT NOT NULL,
  media_type TEXT NOT NULL CHECK (media_type IN ('video', 'audio')),
  format TEXT NOT NULL CHECK (format IN ('mp4', 'webm', 'mp3', 'wav', 'ogg', 'm4a', 'aac')),
  content_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL CHECK (byte_size > 0),
  sha256 TEXT NOT NULL,
  object_key TEXT NOT NULL UNIQUE,
  created_by_user_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL
);

CREATE INDEX media_assets_project_created_idx
  ON media_assets (project_id, media_type, created_at DESC, id);
