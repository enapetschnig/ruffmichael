import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import { FileText, Upload, Download, Trash2, Receipt, FileX, FileCheck, File } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface Document {
  name: string;
  created_at: string;
  id: string;
}

interface Props {
  employeeId: string;
  userId?: string;
}

type DocumentType = "lohnzettel" | "krankmeldung";

const documentTypes = [
  { id: "lohnzettel" as DocumentType, label: "Lohnzettel", icon: Receipt },
  { id: "krankmeldung" as DocumentType, label: "Krankmeldungen", icon: FileX },
];

export default function EmployeeDocumentsManager({ employeeId, userId }: Props) {
  const [documents, setDocuments] = useState<Record<DocumentType, Document[]>>({
    lohnzettel: [],
    krankmeldung: [],
  });
  const [uploading, setUploading] = useState<DocumentType | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    checkAdminStatus();
    fetchDocuments();
  }, [employeeId]);

  const checkAdminStatus = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .single();

    setIsAdmin(data?.role === "administrator");
  };

  const fetchDocuments = async () => {
    const newDocs: Record<DocumentType, Document[]> = {
      lohnzettel: [],
      krankmeldung: [],
    };

    for (const type of documentTypes) {
      const { data, error } = await supabase.storage
        .from("employee-documents")
        .list(`${userId || employeeId}/${type.id}`, {
          sortBy: { column: "created_at", order: "desc" },
        });

      if (error) {
        console.error(`Error fetching ${type.id}:`, error);
      } else if (data) {
        newDocs[type.id] = data;
      }
    }

    setDocuments(newDocs);
  };

  const handleUpload = async (type: DocumentType, files: FileList | null) => {
    if (!files || files.length === 0) return;

    const MAX_SIZE = 50 * 1024 * 1024;
    const oversizedFiles: string[] = [];

    Array.from(files).forEach((file) => {
      if (file.size > MAX_SIZE) {
        oversizedFiles.push(`${file.name} (${(file.size / 1024 / 1024).toFixed(2)} MB)`);
      }
    });

    if (oversizedFiles.length > 0) {
      toast({
        title: "Dateien zu groß",
        description: `Folgende Dateien sind zu groß (max. 50 MB):\n${oversizedFiles.join("\n")}`,
        variant: "destructive",
      });
      return;
    }

    setUploading(type);

    try {
      const uploadPromises = Array.from(files).map(async (file) => {
        const filePath = `${userId || employeeId}/${type}/${Date.now()}_${file.name}`;
        const { error } = await supabase.storage.from("employee-documents").upload(filePath, file);

        if (error) throw error;
      });

      await Promise.all(uploadPromises);

      toast({ title: "Erfolg", description: `${files.length} Dokument(e) hochgeladen` });
      fetchDocuments();
    } catch (error: any) {
      toast({ title: "Fehler", description: error.message, variant: "destructive" });
    } finally {
      setUploading(null);
    }
  };

  const handleDownload = async (type: DocumentType, fileName: string) => {
    try {
      const { data, error } = await supabase.storage
        .from("employee-documents")
        .download(`${userId || employeeId}/${type}/${fileName}`);

      if (error) throw error;

      const url = URL.createObjectURL(data);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error: any) {
      toast({ title: "Fehler", description: error.message, variant: "destructive" });
    }
  };

  const handleDelete = async (type: DocumentType, fileName: string) => {
    if (!isAdmin) {
      toast({ title: "Keine Berechtigung", variant: "destructive" });
      return;
    }

    if (!confirm(`Dokument "${fileName}" wirklich löschen?`)) return;

    try {
      const { error } = await supabase.storage
        .from("employee-documents")
        .remove([`${userId || employeeId}/${type}/${fileName}`]);

      if (error) throw error;

      toast({ title: "Erfolg", description: "Dokument gelöscht" });
      fetchDocuments();
    } catch (error: any) {
      toast({ title: "Fehler", description: error.message, variant: "destructive" });
    }
  };

  return (
    <div className="space-y-4">
      <Tabs defaultValue="lohnzettel" className="w-full">
        <TabsList className="grid w-full grid-cols-2 h-auto">
          {documentTypes.map((type) => {
            const Icon = type.icon;
            return (
              <TabsTrigger 
                key={type.id} 
                value={type.id}
                className="flex items-center gap-1 sm:gap-2 py-2 px-2 sm:px-4 text-xs sm:text-sm"
              >
                <Icon className="w-4 h-4 flex-shrink-0" />
                <span className="truncate">{type.label}</span>
              </TabsTrigger>
            );
          })}
        </TabsList>

        {documentTypes.map((type) => (
          <TabsContent key={type.id} value={type.id}>
            <Card>
              <CardHeader>
                <CardTitle>{type.label}</CardTitle>
                <CardDescription>
                  {documents[type.id].length} Dokument(e) hochgeladen
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {isAdmin && (
                  <div className="space-y-2">
                    <Label htmlFor={`upload-${type.id}`} className="text-sm sm:text-base">
                      Neue Datei hochladen
                    </Label>
                    <Input
                      id={`upload-${type.id}`}
                      type="file"
                      multiple
                      accept="*/*"
                      onChange={(e) => handleUpload(type.id, e.target.files)}
                      disabled={uploading === type.id}
                      className="h-11 cursor-pointer file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold hover:file:bg-accent"
                    />
                    {uploading === type.id && (
                      <p className="text-xs text-muted-foreground">Wird hochgeladen...</p>
                    )}
                  </div>
                )}

                <div className="space-y-2">
                  {documents[type.id].length === 0 ? (
                    <p className="text-sm text-muted-foreground">Keine Dokumente vorhanden</p>
                  ) : (
                    documents[type.id].map((doc) => (
                      <div
                        key={doc.name}
                        className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 border rounded-lg bg-card"
                      >
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                          <FileText className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium truncate">{doc.name.split("_").slice(1).join("_")}</p>
                            <p className="text-xs text-muted-foreground">
                              {new Date(doc.created_at).toLocaleDateString("de-DE")}
                            </p>
                          </div>
                        </div>
                        <div className="flex gap-2 self-end sm:self-auto">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleDownload(type.id, doc.name)}
                            className="h-9 min-w-[44px]"
                          >
                            <Download className="w-4 h-4" />
                          </Button>
                          {isAdmin && (
                            <Button
                              size="sm"
                              variant="destructive"
                              onClick={() => handleDelete(type.id, doc.name)}
                              className="h-9 min-w-[44px]"
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
