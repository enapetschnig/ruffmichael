-- Add unique constraint to prevent duplicate time entries for same user on same day
-- This prevents race conditions where rapid clicks could create duplicate entries
ALTER TABLE public.time_entries
ADD CONSTRAINT time_entries_user_datum_unique UNIQUE (user_id, datum);