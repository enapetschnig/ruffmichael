-- Öffentlicher Branding-Bucket (Firmenlogo für PDF-Berichte)
INSERT INTO storage.buckets (id, name, public)
VALUES ('branding', 'branding', true)
ON CONFLICT (id) DO NOTHING;

-- Nur Admins dürfen Branding-Dateien verwalten, lesen darf jeder (public bucket)
CREATE POLICY "Admins can manage branding files"
ON storage.objects FOR ALL
USING (bucket_id = 'branding' AND public.has_role(auth.uid(), 'administrator'))
WITH CHECK (bucket_id = 'branding' AND public.has_role(auth.uid(), 'administrator'));
