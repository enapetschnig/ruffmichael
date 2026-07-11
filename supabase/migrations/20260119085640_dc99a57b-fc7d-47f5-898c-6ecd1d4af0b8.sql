-- Add week_type column to time_entries for storing long/short week info
ALTER TABLE public.time_entries 
ADD COLUMN week_type TEXT CHECK (week_type IN ('kurz', 'lang'));