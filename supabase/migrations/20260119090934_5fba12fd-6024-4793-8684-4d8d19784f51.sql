-- Create week_settings table for storing week type per user per week
CREATE TABLE public.week_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  week_start DATE NOT NULL, -- Always the Monday of the week
  week_type TEXT NOT NULL CHECK (week_type IN ('kurz', 'lang')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, week_start)
);

-- Enable RLS
ALTER TABLE public.week_settings ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view own week settings"
  ON public.week_settings FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own week settings"
  ON public.week_settings FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own week settings"
  ON public.week_settings FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own week settings"
  ON public.week_settings FOR DELETE
  USING (auth.uid() = user_id);

CREATE POLICY "Admins can view all week settings"
  ON public.week_settings FOR SELECT
  USING (has_role(auth.uid(), 'administrator'::app_role));

-- Trigger for updated_at
CREATE TRIGGER update_week_settings_updated_at
  BEFORE UPDATE ON public.week_settings
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();