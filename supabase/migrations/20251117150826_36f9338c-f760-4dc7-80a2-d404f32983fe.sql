-- Storage-Policies für employee-documents Bucket korrigieren

-- Alte Policies löschen falls vorhanden
DROP POLICY IF EXISTS "Authenticated users can upload employee documents" ON storage.objects;
DROP POLICY IF EXISTS "Users can view own employee documents" ON storage.objects;
DROP POLICY IF EXISTS "Admins can view all employee documents" ON storage.objects;
DROP POLICY IF EXISTS "Admins can delete employee documents" ON storage.objects;

-- Neue Policies erstellen
-- Mitarbeiter können ihre eigenen Dokumente hochladen
CREATE POLICY "Authenticated users can upload employee documents"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'employee-documents' AND
  (storage.foldername(name))[1] = auth.uid()::text
);

-- Mitarbeiter können ihre eigenen Dokumente sehen
CREATE POLICY "Users can view own employee documents"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'employee-documents' AND
  (storage.foldername(name))[1] = auth.uid()::text
);

-- Admins können alle Dokumente sehen
CREATE POLICY "Admins can view all employee documents"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'employee-documents' AND
  has_role(auth.uid(), 'administrator'::app_role)
);

-- Admins können Dokumente löschen
CREATE POLICY "Admins can delete employee documents"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'employee-documents' AND
  has_role(auth.uid(), 'administrator'::app_role)
);