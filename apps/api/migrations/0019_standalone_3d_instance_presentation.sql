ALTER TABLE standalone_3d_instances
  ADD COLUMN animation_enabled INTEGER NOT NULL DEFAULT 1 CHECK (animation_enabled IN (0, 1));

ALTER TABLE standalone_3d_instances
  ADD COLUMN animation_speed REAL NOT NULL DEFAULT 1 CHECK (animation_speed >= 0.1 AND animation_speed <= 3);

ALTER TABLE standalone_3d_instances
  ADD COLUMN color_override TEXT CHECK (
    color_override IS NULL
    OR (
      length(color_override) = 7
      AND color_override GLOB '#[0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f]'
    )
  );

ALTER TABLE standalone_3d_instances
  ADD COLUMN opacity REAL NOT NULL DEFAULT 1 CHECK (opacity >= 0 AND opacity <= 1);
