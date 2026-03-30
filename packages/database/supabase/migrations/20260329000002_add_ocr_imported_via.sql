-- 20260329000002_add_ocr_imported_via.sql
-- Adds 'OCR' value to the imported_via_enum type.
-- Part of spec-23: OCR Agent + Camera Intake Multi-Photo.

ALTER TYPE public.imported_via_enum ADD VALUE IF NOT EXISTS 'OCR';
