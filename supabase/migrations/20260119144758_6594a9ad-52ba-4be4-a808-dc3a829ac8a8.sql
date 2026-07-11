-- Create materials table for text-based material entries
CREATE TABLE public.material_entries (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  material TEXT NOT NULL,
  menge TEXT,
  notizen TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.material_entries ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Authenticated users can view material entries"
ON public.material_entries
FOR SELECT
USING (auth.uid() IS NOT NULL);

CREATE POLICY "Users can insert own material entries"
ON public.material_entries
FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own material entries"
ON public.material_entries
FOR UPDATE
USING (auth.uid() = user_id);

CREATE POLICY "Admins can delete any material entries"
ON public.material_entries
FOR DELETE
USING (has_role(auth.uid(), 'administrator'::app_role));

CREATE POLICY "Users can delete own material entries"
ON public.material_entries
FOR DELETE
USING (auth.uid() = user_id);

-- Add updated_at trigger
CREATE TRIGGER update_material_entries_updated_at
BEFORE UPDATE ON public.material_entries
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();