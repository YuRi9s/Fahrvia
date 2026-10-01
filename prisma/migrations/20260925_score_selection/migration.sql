-- Retain worksheet/header selection alongside immutable source and mapping.
ALTER TABLE "ScoreImport" ADD COLUMN "selection" JSONB;
