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

interface Document {
  name: string;
  path: string;
  created_at?: string;
}

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
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      toast({ variant: "destructive", title: "Fehler", description: "Sie müssen angemeldet sein" });
      return;
    }

    setUserId(user.id);
  await Promise.all([
      fetchDocuments(user.id, "lohnzettel", setPayslips),
      fetchDocuments(user.id, "krankmeldung", setSickNotes),
    ]);
    setLoading(false);
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

    const filePath = `${userId}/${type}/${Date.now()}_${file.name}`;
    const { error } = await supabase.storage
      .from("employee-documents")
      .upload(filePath, file);

    if (error) {
      console.error("Upload-Fehler:", error);
      toast({ variant: "destructive", title: "Fehler", description: `Upload fehlgeschlagen: ${error.message}` });
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
