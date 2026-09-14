-- Supports metric-change coalescing lookups by project, field, and recency.
CREATE INDEX "project_changes_project_id_field_changed_at_idx"
ON "project_changes"("project_id", "field", "changed_at" DESC);

-- Supports a project-local newest published tweet lookup in the growth view.
CREATE INDEX "feed_items_project_id_posted_at_idx"
ON "feed_items"("project_id", "posted_at" DESC);
