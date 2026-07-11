-- Add pause_start and pause_end columns to time_entries table
ALTER TABLE time_entries 
ADD COLUMN pause_start time without time zone,
ADD COLUMN pause_end time without time zone;