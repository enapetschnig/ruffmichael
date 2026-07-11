-- Make taetigkeit column optional in time_entries table
ALTER TABLE public.time_entries 
ALTER COLUMN taetigkeit DROP NOT NULL;