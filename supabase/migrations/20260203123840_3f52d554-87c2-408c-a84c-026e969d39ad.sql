-- Mitarbeiter können in ihren eigenen Ordner Krankmeldungen hochladen
CREATE POLICY "Users can upload own sick notes"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'employee-documents' 
    AND (storage.foldername(name))[1] = auth.uid()::text
    AND (storage.foldername(name))[2] = 'krankmeldung'
  );

-- Mitarbeiter können eigene Krankmeldungen löschen
CREATE POLICY "Users can delete own sick notes"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'employee-documents' 
    AND (storage.foldername(name))[1] = auth.uid()::text
    AND (storage.foldername(name))[2] = 'krankmeldung'
  );