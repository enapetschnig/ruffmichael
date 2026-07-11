-- Adjust user_role_overrides policies to allow safe self upsert
-- Drop previous admin-only write policies
DROP POLICY IF EXISTS "Admins can insert role overrides" ON public.user_role_overrides;
DROP POLICY IF EXISTS "Admins can update role overrides" ON public.user_role_overrides;
DROP POLICY IF EXISTS "Admins can delete role overrides" ON public.user_role_overrides;

-- Insert: users can set their own override to 'mitarbeiter', admins can set any (including 'administrator')
CREATE POLICY "Users can insert own override (mitarbeiter) or admin any"
ON public.user_role_overrides
FOR INSERT
WITH CHECK (
  auth.uid() = user_id
  AND (
    override_role = 'mitarbeiter'::app_role
    OR public.has_role(auth.uid(), 'administrator'::app_role)
  )
);

-- Update: same rule, must be their own row
CREATE POLICY "Users can update own override (mitarbeiter) or admin any"
ON public.user_role_overrides
FOR UPDATE
USING (auth.uid() = user_id)
WITH CHECK (
  auth.uid() = user_id
  AND (
    override_role = 'mitarbeiter'::app_role
    OR public.has_role(auth.uid(), 'administrator'::app_role)
  )
);

-- Delete: allow user to clear own override, admins can clear any
CREATE POLICY "Users can delete own override or admin any"
ON public.user_role_overrides
FOR DELETE
USING (
  auth.uid() = user_id OR public.has_role(auth.uid(), 'administrator'::app_role)
);
