-- =============================================================
-- Spec-43 follow-up: add 'route_mismatch' to reception_scan_result_enum
--
-- The Retornos tab needs to distinguish "barcode not found in the system"
-- from "barcode found but belongs to a different route". The original code
-- recorded both as scan_result='not_found' (with route-mismatch rows keeping
-- a non-null package_id), which collides in audit queries.
--
-- ALTER TYPE ... ADD VALUE cannot be used in the same transaction that
-- references the new value, so this migration only adds the value;
-- application code starts using it in a later commit.
-- =============================================================

ALTER TYPE reception_scan_result_enum ADD VALUE IF NOT EXISTS 'route_mismatch';
