ALTER TABLE asset_data_bindings ADD COLUMN transform_json TEXT CHECK(transform_json IS NULL OR json_valid(transform_json));
