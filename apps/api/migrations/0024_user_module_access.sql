ALTER TABLE users ADD COLUMN can_access_2d INTEGER NOT NULL DEFAULT 0 CHECK (can_access_2d IN (0, 1));
ALTER TABLE users ADD COLUMN can_access_3d INTEGER NOT NULL DEFAULT 0 CHECK (can_access_3d IN (0, 1));

-- Preserve the access existing accounts had before module grants existed.
UPDATE users SET can_access_2d = 1, can_access_3d = 1;
