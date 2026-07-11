-- Drop old restrictive policy
DROP POLICY IF EXISTS "Admins can insert projects" ON public.projects;

-- Allow all authenticated users to create projects
CREATE POLICY "Authenticated users can insert projects"
ON public.projects
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() IS NOT NULL);