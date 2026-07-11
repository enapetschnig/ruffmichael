import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // Alle User-Ordner im Bucket finden
    const { data: folders, error } = await supabase.storage
      .from('employee-documents')
      .list('', { limit: 1000 })

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), { 
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const results: { moved: string; to: string }[] = []
    const errors: { path: string; error: string }[] = []

    for (const folder of folders || []) {
      // Nur Ordner (keine Dateien) verarbeiten
      if (folder.id) continue

      // Prüfen ob es einen krankmeldungen Ordner gibt (Plural - der alte Pfad)
      const { data: oldFiles } = await supabase.storage
        .from('employee-documents')
        .list(`${folder.name}/krankmeldungen`)

      if (oldFiles && oldFiles.length > 0) {
        for (const file of oldFiles) {
          // Nur Dateien, keine Ordner
          if (!file.id) continue

          const oldPath = `${folder.name}/krankmeldungen/${file.name}`
          const newPath = `${folder.name}/krankmeldung/${file.name}`

          try {
            // Datei herunterladen
            const { data: fileData, error: downloadError } = await supabase.storage
              .from('employee-documents')
              .download(oldPath)

            if (downloadError || !fileData) {
              errors.push({ path: oldPath, error: downloadError?.message || 'Download failed' })
              continue
            }

            // Datei am neuen Ort hochladen
            const { error: uploadError } = await supabase.storage
              .from('employee-documents')
              .upload(newPath, fileData, { upsert: true })

            if (uploadError) {
              errors.push({ path: oldPath, error: uploadError.message })
              continue
            }

            // Alte Datei löschen
            const { error: deleteError } = await supabase.storage
              .from('employee-documents')
              .remove([oldPath])

            if (deleteError) {
              errors.push({ path: oldPath, error: `Uploaded but delete failed: ${deleteError.message}` })
            } else {
              results.push({ moved: oldPath, to: newPath })
            }
          } catch (e) {
            errors.push({ path: oldPath, error: String(e) })
          }
        }
      }
    }

    return new Response(JSON.stringify({ 
      success: true, 
      migrated: results,
      errors: errors,
      summary: `${results.length} Dateien verschoben, ${errors.length} Fehler`
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { 
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
