-- Dias del ROI editables por el admin. Migracion NO destructiva.
ALTER TABLE "track_records" ADD COLUMN IF NOT EXISTS "roiDays" INTEGER NOT NULL DEFAULT 30;
