-- Add anleitung_completed field to profiles table
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS anleitung_completed boolean DEFAULT false;

-- Create invitation_logs table for tracking SMS invitations
CREATE TABLE IF NOT EXISTS invitation_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  telefonnummer text NOT NULL,
  gesendet_am timestamp with time zone DEFAULT now(),
  gesendet_von uuid REFERENCES auth.users(id),
  status text DEFAULT 'gesendet'
);

-- Enable Row Level Security
ALTER TABLE invitation_logs ENABLE ROW LEVEL SECURITY;

-- Only admins can view invitations
CREATE POLICY "Admins can view invitations"
ON invitation_logs
FOR SELECT
TO authenticated
USING (has_role(auth.uid(), 'administrator'::app_role));

-- Only admins can insert invitations
CREATE POLICY "Admins can insert invitations"
ON invitation_logs
FOR INSERT
TO authenticated
WITH CHECK (has_role(auth.uid(), 'administrator'::app_role));