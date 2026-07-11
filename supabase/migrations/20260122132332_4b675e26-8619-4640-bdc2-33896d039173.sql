-- Add signature columns to disturbances table
ALTER TABLE public.disturbances
ADD COLUMN IF NOT EXISTS unterschrift_kunde TEXT,
ADD COLUMN IF NOT EXISTS unterschrift_am TIMESTAMPTZ;