import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FileText, Upload, Download, Eye, Trash2 } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { FileViewer } from "@/components/FileViewer";
import { saveUpload } from "@/lib/offlineData";
import { getSessionUser } from "@/lib/auth";

interface Document {
  name: string;
  path: string;
  created_at?: string;
}

// Wandelt einen benutzerfreundlichen Namen in einen gültigen Supabase-Storage-Key um.
// Supabase Storage lehnt Nicht-ASCII-Object-Keys ab ("Invalid key"), daher werden
// Umlaute/ß zuerst transliteriert und danach alle übrigen Sonderzeichen entfernt.
const toStorageKey = (name: string) =>
  name
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/Ä/g, "Ae")
    .replace(/Ö/g, "Oe")
    .replace(/Ü/g, "Ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-zA-Z0-9._ ()-]/g, "_");

export default function MyDocuments() {
  const [payslips, setPayslips] = useState<Document[]>([]);
  const [sickNotes, setSickNotes] = useState<Document[]>([]);
  const [uploading, setUploading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string>("");
  const [viewingFile, setViewingFile] = useState<{ name: string; path: string; bucketName: string } | null>(null);

  useEffect(() => {
    fetchUserAndDocuments();
  }, []);

  const fetchUserAndDocuments = async () => {
    try {
      // Offline-sicher: Benutzer aus der lokalen Session lesen statt Netz-getUser(),
      // sonst hängt die Seite ohne Verbindung dauerhaft im Lade-Spinner.
      const user = await getSessionUser();
      if (!user) {
        toast({ variant: "destructive", title: "Fehler", description: "Sie müssen angemeldet sein" });
        return;
      }

      setUserId(user.id);
      await Promise.all([
        fetchDocuments(user.id, "lohnzettel", setPayslips),
        fetchDocuments(user.id, "krankmeldung", setSickNotes),
      ]);
    } finally {
      // Ladezustand IMMER beenden – auch bei fehlendem Netz/Benutzer – kein Endlos-Spinner.
      setLoading(false);
    }
  };

  const fetchDocuments = async (
    userId: string,
    type: "lohnzettel" | "krankmeldung",
    setter: (docs: Document[]) => void
  ) => {
    const { data, error } = await supabase.storage
      .from("employee-documents")
      .list(`${userId}/${type}`);

    if (error) {
      console.error(`Fehler beim Laden von ${type}:`, error);
      return;
    }

    if (data) {
      const docs = data.map((file) => ({
        name: file.name,
        path: `${userId}/${type}/${file.name}`,
        created_at: file.created_at,
      }));
      setter(docs);
    }
  };

  const handleUpload = async (type: "lohnzettel" | "krankmeldung", file: File | null) => {
    if (!file || !userId) return;

    if (file.size > 50 * 1024 * 1024) {
      toast({ variant: "destructive", title: "Fehler", description: "Datei ist zu groß (max. 50 MB)" });
      return;
    }

    setUploading(true);

    // Storage-Key ohne Sonderzeichen/Umlaute; Anzeigename bleibt im Original erhalten.
    const filePath = `${userId}/${type}/${Date.now()}_${toStorageKey(file.name)}`;

    // Offline-fähiger Upload über die Warteschlange: ohne Netz geht die Krankmeldung
    // nicht verloren, sondern wird beim nächsten Verbindungsaufbau automatisch synchronisiert.
    const res = await saveUpload(
      {
        bucket: "employee-documents",
        path: filePath,
        blob: file,
        contentType: file.type || undefined,
        upsert: false,
      },
      `${type === "lohnzettel" ? "Lohnzettel" : "Krankmeldung"}: ${file.name}`
    );

    if (res.error) {
      console.error("Upload-Fehler:", res.error);
      toast({ variant: "destructive", title: "Fehler", description: `Upload fehlgeschlagen: ${res.error}` });
    } else if (res.queued) {
      // Offline: freundlicher Hinweis statt hartem Fehler.
      toast({ title: "Offline gespeichert", description: "Wird bei Verbindung hochgeladen" });
    } else {
      toast({ title: "Erfolg", description: "Dokument hochgeladen" });
      await fetchDocuments(userId, type, type === "lohnzettel" ? setPayslips : setSickNotes);
    }

    setUploading(false);
  };

  const handleView = (doc: Document, type: "lohnzettel" | "krankmeldung") => {
    setViewingFile({
      name: doc.name,
      path: doc.path,
      bucketName: "employee-documents"
    });
  };

  const handleDelete = async (doc: Document, type: "lohnzettel" | "krankmeldung") => {
    if (!confirm(`Möchten Sie "${doc.name}" wirklich löschen?`)) return;

    const { error } = await supabase.storage
      .from("employee-documents")
      .remove([doc.path]);

    if (error) {
      toast({ variant: "destructive", title: "Fehler", description: "Löschen fehlgeschlagen" });
    } else {
      toast({ title: "Erfolg", description: "Dokument gelöscht" });
      await fetchDocuments(userId, type, type === "lohnzettel" ? setPayslips : setSickNotes);
    }
  };

  if (loading) {
    return <div className="p-4">Lädt...</div>;
  }

  return (
    <div className="min-h-screen bg-background">
      <PageHeader title="Meine Dokumente" />

      <div className="container mx-auto p-4 max-w-4xl">
        <Tabs defaultValue="payslips" className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="payslips">
              <FileText className="w-4 h-4 mr-2" />
              Meine Lohnzettel
            </TabsTrigger>
            <TabsTrigger value="sicknotes">
              <FileText className="w-4 h-4 mr-2" />
              Krankmeldungen
            </TabsTrigger>
          </TabsList>

          <TabsContent value="payslips" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Meine Lohnzettel</CardTitle>
                <CardDescription>
                  Vom Administrator hochgeladene Lohnzettel
                </CardDescription>
              </CardHeader>
              <CardContent>
                {payslips.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Keine Lohnzettel vorhanden</p>
                ) : (
                  <div className="space-y-2">
                    {payslips.map((doc) => (
                      <div
                        key={doc.path}
                        className="flex items-center justify-between p-3 border rounded-md hover:bg-accent"
                      >
                        <div className="flex items-center gap-3 flex-1 min-w-0">
                          <FileText className="w-5 h-5 text-primary shrink-0" />
                          <span className="text-sm truncate">{doc.name}</span>
                        </div>
                        <div className="flex gap-2 shrink-0">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleView(doc, "lohnzettel")}
                          >
                            <Eye className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="sicknotes" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Krankmeldungen hochladen</CardTitle>
                <CardDescription>
                  Krankmeldungen für den Administrator hochladen
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <Label htmlFor="sicknote-upload">Krankmeldung auswählen</Label>
                  <Input
                    id="sicknote-upload"
                    type="file"
                    onChange={(e) => handleUpload("krankmeldung", e.target.files?.[0] || null)}
                    disabled={uploading}
                    accept=".pdf,.jpg,.jpeg,.png"
                  />
                  {uploading && <p className="text-sm text-muted-foreground">Lädt hoch...</p>}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Meine Krankmeldungen</CardTitle>
                <CardDescription>
                  Hochgeladene Krankmeldungen
                </CardDescription>
              </CardHeader>
              <CardContent>
                {sickNotes.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Keine Krankmeldungen vorhanden</p>
                ) : (
                  <div className="space-y-2">
                    {sickNotes.map((doc) => (
                      <div
                        key={doc.path}
                        className="flex items-center justify-between p-3 border rounded-md hover:bg-accent"
                      >
                        <div className="flex items-center gap-3 flex-1 min-w-0">
                          <FileText className="w-5 h-5 text-primary shrink-0" />
                          <span className="text-sm truncate">{doc.name}</span>
                        </div>
                        <div className="flex gap-2 shrink-0">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleView(doc, "krankmeldung")}
                          >
                            <Eye className="w-4 h-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleDelete(doc, "krankmeldung")}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      {viewingFile && (
        <FileViewer
          open={true}
          onClose={() => setViewingFile(null)}
          fileName={viewingFile.name}
          filePath={viewingFile.path}
          bucketName={viewingFile.bucketName}
        />
      )}
    </div>
  );
}
