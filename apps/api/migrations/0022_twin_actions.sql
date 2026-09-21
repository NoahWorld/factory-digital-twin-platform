-- NULL preserves the legacy click behavior; [] explicitly disables configured actions.
ALTER TABLE canvas_nodes ADD COLUMN interaction_json TEXT
  CHECK (interaction_json IS NULL OR (json_valid(interaction_json) AND json_type(interaction_json) = 'object'));
ALTER TABLE standalone_3d_instances ADD COLUMN click_actions_json TEXT
  CHECK (click_actions_json IS NULL OR (json_valid(click_actions_json) AND json_type(click_actions_json) = 'array'));
