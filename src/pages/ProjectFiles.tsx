import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import {
  ChevronRight,
  File as FileIcon,
  Folder,
  FolderInput,
  FolderPlus,
  Home,
  Loader2,
  MoreVertical,
  Pencil,
  Trash2,
  Upload,
} from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { projectLabel } from "@/lib/projectLabel";

const BUCKET = "project-files";
const PLACEHOLDER_NAMES = [".keep", ".emptyFolderPlaceholder"];
const ROOT_VALUE = "__root__";
const MAX_FOLDER_DEPTH = 5;

type StorageEntry = {
  name: string;
  id: string | null;
  updated_at?: string | null;
  created_at?: string | null;
  metadata?: { size?: number } | null;
};

type ItemRef = { kind: "folder" | "file"; name: string };

const sanitizeFileName = (name: string) =>
  name.replace(/[^a-zA-Z0-9._ ()äöüÄÖÜß-]/g, "_");

const formatBytes = (bytes?: number | null) => {
  if (bytes === undefined || bytes === null) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
};

const formatDate = (iso?: string | null) => {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
};

const ProjectFiles = () => {
  const { projectId } = useParams<{ projectId: string }>();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [projectName, setProjectName] = useState("");
  const [path, setPath] = useState<string[]>([]);
  const [folders, setFolders] = useState<StorageEntry[]>([]);
  const [files, setFiles] = useState<StorageEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);

  // Dialog-Zustände
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState("");
  const [renameTarget, setRenameTarget] = useState<ItemRef | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [moveTarget, setMoveTarget] = useState<string | null>(null);
  const [moveDestinations, setMoveDestinations] = useState<string[]>([]);
  const [moveDest, setMoveDest] = useState("");
  const [moveLoading, setMoveLoading] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ItemRef | null>(null);

  const basePath = [projectId, ...path].join("/");

  useEffect(() => {
    if (!projectId) return;
    const fetchProjectName = async () => {
      const { data, error } = await supabase
        .from("projects")
        .select("name, adresse, customers(strasse, ort)")
        .eq("id", projectId)
        .single();

      if (error) {
        toast({
          variant: "destructive",
          title: "Fehler",
          description: "Projekt konnte nicht geladen werden.",
        });
      } else if (data) {
        setProjectName(projectLabel(data));
      }
    };
    fetchProjectName();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  useEffect(() => {
    loadEntries();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, path]);

  const loadEntries = async () => {
    if (!projectId) return;
    setLoading(true);
    const { data, error } = await supabase.storage.from(BUCKET).list(basePath, {
      limit: 1000,
      sortBy: { column: "name", order: "asc" },
    });

    if (error) {
      toast({
        variant: "destructive",
        title: "Fehler beim Laden",
        description: error.message,
      });
      setFolders([]);
      setFiles([]);
    } else {
      const entries = ((data || []) as StorageEntry[]).filter(
        (entry) => !PLACEHOLDER_NAMES.includes(entry.name)
      );
      setFolders(entries.filter((entry) => entry.id === null));
      setFiles(entries.filter((entry) => entry.id !== null));
    }
    setLoading(false);
  };

  // Listet rekursiv alle Objekt-Keys (inkl. .keep) unterhalb eines Prefix
  const listAllKeysUnder = async (prefix: string): Promise<string[]> => {
    const { data, error } = await supabase.storage.from(BUCKET).list(prefix, {
      limit: 1000,
      sortBy: { column: "name", order: "asc" },
    });
    if (error) throw error;

    const keys: string[] = [];
    for (const entry of (data || []) as StorageEntry[]) {
      if (entry.id === null) {
        keys.push(...(await listAllKeysUnder(`${prefix}/${entry.name}`)));
      } else {
        keys.push(`${prefix}/${entry.name}`);
      }
    }
    return keys;
  };

  // Listet rekursiv alle Ordnerpfade (relativ zum Projektstamm)
  const listAllFolderPaths = async (
    prefix: string,
    relPath: string,
    depth: number
  ): Promise<string[]> => {
    if (depth <= 0) return [];
    const { data, error } = await supabase.storage.from(BUCKET).list(prefix, {
      limit: 1000,
      sortBy: { column: "name", order: "asc" },
    });
    if (error) throw error;

    const result: string[] = [];
    for (const entry of (data || []) as StorageEntry[]) {
      if (entry.id === null) {
        const childRel = relPath ? `${relPath}/${entry.name}` : entry.name;
        result.push(childRel);
        result.push(
          ...(await listAllFolderPaths(`${prefix}/${entry.name}`, childRel, depth - 1))
        );
      }
    }
    return result;
  };

  // Verschiebt alle Objekte von einem Prefix zu einem anderen
  const moveAllUnder = async (oldPrefix: string, newPrefix: string) => {
    const keys = await listAllKeysUnder(oldPrefix);
    for (const key of keys) {
      const newKey = newPrefix + key.slice(oldPrefix.length);
      const { error } = await supabase.storage.from(BUCKET).move(key, newKey);
      if (error) throw error;
    }
  };

  const validateFolderName = (name: string): string | null => {
    if (!name) return "Bitte einen Namen eingeben.";
    if (name.includes("/")) return 'Der Name darf kein "/" enthalten.';
    if (
      folders.some((f) => f.name === name) ||
      files.some((f) => f.name === name)
    ) {
      return `"${name}" existiert hier bereits.`;
    }
    return null;
  };

  const handleCreateFolder = async () => {
    const name = createName.trim();
    const validationError = validateFolderName(name);
    if (validationError) {
      toast({
        variant: "destructive",
        title: "Ungültiger Name",
        description: validationError,
      });
      return;
    }

    setBusy(true);
    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(`${basePath}/${name}/.keep`, new Blob([]), {
        contentType: "text/plain",
        upsert: true,
      });
    setBusy(false);

    if (error) {
      toast({
        variant: "destructive",
        title: "Fehler",
        description: `Ordner konnte nicht erstellt werden: ${error.message}`,
      });
      return;
    }

    toast({ title: "Ordner erstellt", description: `"${name}" wurde angelegt.` });
    setCreateOpen(false);
    setCreateName("");
    loadEntries();
  };

  const openRenameDialog = (item: ItemRef) => {
    setRenameTarget(item);
    setRenameValue(item.name);
  };

  const handleRename = async () => {
    if (!renameTarget) return;
    const rawName = renameValue.trim();
    const newName =
      renameTarget.kind === "file" ? sanitizeFileName(rawName) : rawName;

    if (newName === renameTarget.name) {
      setRenameTarget(null);
      return;
    }

    const validationError = validateFolderName(newName);
    if (validationError) {
      toast({
        variant: "destructive",
        title: "Ungültiger Name",
        description: validationError,
      });
      return;
    }

    setBusy(true);
    try {
      if (renameTarget.kind === "folder") {
        await moveAllUnder(
          `${basePath}/${renameTarget.name}`,
          `${basePath}/${newName}`
        );
      } else {
        const { error } = await supabase.storage
          .from(BUCKET)
          .move(`${basePath}/${renameTarget.name}`, `${basePath}/${newName}`);
        if (error) throw error;
      }
      toast({
        title: "Umbenannt",
        description: `"${renameTarget.name}" heißt jetzt "${newName}".`,
      });
      setRenameTarget(null);
      loadEntries();
    } catch (error: unknown) {
      toast({
        variant: "destructive",
        title: "Fehler beim Umbenennen",
        description: error instanceof Error ? error.message : String(error),
      });
    }
    setBusy(false);
  };

  const openMoveDialog = async (folderName: string) => {
    if (!projectId) return;
    setMoveTarget(folderName);
    setMoveDest(path.length > 0 ? ROOT_VALUE : "");
    setMoveDestinations([]);
    setMoveLoading(true);
    try {
      const allFolders = await listAllFolderPaths(projectId, "", MAX_FOLDER_DEPTH);
      const sourceRel = [...path, folderName].join("/");
      const currentRel = path.join("/");
      setMoveDestinations(
        allFolders.filter(
          (p) =>
            p !== sourceRel &&
            !p.startsWith(`${sourceRel}/`) &&
            p !== currentRel
        )
      );
    } catch (error: unknown) {
      toast({
        variant: "destructive",
        title: "Fehler",
        description: "Zielordner konnten nicht geladen werden.",
      });
    }
    setMoveLoading(false);
  };

  const handleMoveFolder = async () => {
    if (!moveTarget || !projectId || !moveDest) return;
    const destRel = moveDest === ROOT_VALUE ? "" : moveDest;
    const destPrefix = destRel ? `${projectId}/${destRel}` : projectId;

    setBusy(true);
    try {
      // Kollision am Zielort prüfen
      const { data: destEntries, error: destError } = await supabase.storage
        .from(BUCKET)
        .list(destPrefix, { limit: 1000 });
      if (destError) throw destError;
      if ((destEntries || []).some((entry) => entry.name === moveTarget)) {
        toast({
          variant: "destructive",
          title: "Nicht möglich",
          description: `Am Zielort existiert bereits ein Eintrag namens "${moveTarget}".`,
        });
        setBusy(false);
        return;
      }

      await moveAllUnder(`${basePath}/${moveTarget}`, `${destPrefix}/${moveTarget}`);
      toast({
        title: "Verschoben",
        description: `"${moveTarget}" wurde nach ${destRel ? `"${destRel}"` : "den Projektstamm"} verschoben.`,
      });
      setMoveTarget(null);
      loadEntries();
    } catch (error: unknown) {
      toast({
        variant: "destructive",
        title: "Fehler beim Verschieben",
        description: error instanceof Error ? error.message : String(error),
      });
    }
    setBusy(false);
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setBusy(true);
    try {
      const keys =
        deleteTarget.kind === "folder"
          ? await listAllKeysUnder(`${basePath}/${deleteTarget.name}`)
          : [`${basePath}/${deleteTarget.name}`];

      for (let i = 0; i < keys.length; i += 100) {
        const { error } = await supabase.storage
          .from(BUCKET)
          .remove(keys.slice(i, i + 100));
        if (error) throw error;
      }

      toast({
        title: "Gelöscht",
        description: `"${deleteTarget.name}" wurde gelöscht.`,
      });
      setDeleteTarget(null);
      loadEntries();
    } catch (error: unknown) {
      toast({
        variant: "destructive",
        title: "Fehler beim Löschen",
        description: error instanceof Error ? error.message : String(error),
      });
    }
    setBusy(false);
  };

  const handleUpload = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    setUploading(true);

    let successCount = 0;
    for (const file of Array.from(fileList)) {
      const safeName = sanitizeFileName(file.name) || "datei";
      const { error } = await supabase.storage
        .from(BUCKET)
        .upload(`${basePath}/${safeName}`, file);

      if (error) {
        const alreadyExists =
          error.message.toLowerCase().includes("already exists") ||
          error.message.toLowerCase().includes("duplicate");
        toast({
          variant: "destructive",
          title: `Fehler bei "${file.name}"`,
          description: alreadyExists
            ? "Eine Datei mit diesem Namen existiert hier bereits."
            : error.message,
        });
      } else {
        successCount++;
      }
    }

    if (successCount > 0) {
      toast({
        title: "Hochgeladen",
        description: `${successCount} Datei(en) erfolgreich hochgeladen.`,
      });
    }

    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
    loadEntries();
  };

  const handleOpenFile = async (fileName: string) => {
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(`${basePath}/${fileName}`, 3600);

    if (error || !data?.signedUrl) {
      toast({
        variant: "destructive",
        title: "Fehler",
        description: "Datei konnte nicht geöffnet werden.",
      });
      return;
    }
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  };

  const isEmpty = folders.length === 0 && files.length === 0;

  return (
    <div className="min-h-screen bg-background">
      <PageHeader
        title={projectName || "Projektordner"}
        backPath={`/projects/${projectId}`}
      />

      <main className="container mx-auto px-3 sm:px-4 lg:px-6 py-4 sm:py-6 max-w-4xl">
        {/* Breadcrumbs */}
        <div className="flex items-center flex-wrap gap-0.5 mb-4 text-sm">
          <Button
            variant="ghost"
            size="sm"
            className={`h-8 px-2 ${path.length === 0 ? "font-semibold" : ""}`}
            onClick={() => setPath([])}
          >
            <Home className="h-4 w-4 mr-1" />
            Projektordner
          </Button>
          {path.map((segment, index) => (
            <span key={`${segment}-${index}`} className="flex items-center gap-0.5">
              <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
              <Button
                variant="ghost"
                size="sm"
                className={`h-8 px-2 max-w-[10rem] sm:max-w-none ${
                  index === path.length - 1 ? "font-semibold" : ""
                }`}
                onClick={() => setPath(path.slice(0, index + 1))}
              >
                <span className="truncate">{segment}</span>
              </Button>
            </span>
          ))}
        </div>

        {/* Aktionen */}
        <div className="flex flex-wrap gap-2 mb-4">
          <Button
            onClick={() => {
              setCreateName("");
              setCreateOpen(true);
            }}
          >
            <FolderPlus className="h-4 w-4 mr-2" />
            Neuer Ordner
          </Button>
          <Button
            variant="outline"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
          >
            {uploading ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Upload className="h-4 w-4 mr-2" />
            )}
            {uploading ? "Wird hochgeladen..." : "Dateien hochladen"}
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => handleUpload(e.target.files)}
          />
        </div>

        {/* Inhalt */}
        <Card>
          <CardContent className="p-0">
            {loading ? (
              <div className="py-12 flex items-center justify-center gap-2 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Lädt...
              </div>
            ) : isEmpty ? (
              <div className="py-12 text-center text-muted-foreground px-4">
                <Folder className="h-10 w-10 mx-auto mb-3 opacity-40" />
                <p className="font-medium">Ordner ist leer</p>
                <p className="text-sm mt-1">
                  Erstellen Sie einen Ordner oder laden Sie Dateien hoch.
                </p>
              </div>
            ) : (
              <div className="divide-y">
                {folders.map((folder) => (
                  <div
                    key={folder.name}
                    className="flex items-center gap-3 px-3 sm:px-4 py-3 hover:bg-muted/50 cursor-pointer transition-colors"
                    onClick={() => setPath([...path, folder.name])}
                  >
                    <Folder className="h-5 w-5 text-primary shrink-0 fill-primary/20" />
                    <span className="flex-1 min-w-0 truncate font-medium">
                      {folder.name}
                    </span>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 shrink-0"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent
                        align="end"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <DropdownMenuItem
                          onClick={() =>
                            openRenameDialog({ kind: "folder", name: folder.name })
                          }
                        >
                          <Pencil className="h-4 w-4 mr-2" />
                          Umbenennen
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => openMoveDialog(folder.name)}>
                          <FolderInput className="h-4 w-4 mr-2" />
                          Verschieben
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          className="text-destructive focus:text-destructive"
                          onClick={() =>
                            setDeleteTarget({ kind: "folder", name: folder.name })
                          }
                        >
                          <Trash2 className="h-4 w-4 mr-2" />
                          Löschen
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                ))}

                {files.map((file) => (
                  <div
                    key={file.name}
                    className="flex items-center gap-3 px-3 sm:px-4 py-3 hover:bg-muted/50 cursor-pointer transition-colors"
                    onClick={() => handleOpenFile(file.name)}
                  >
                    <FileIcon className="h-5 w-5 text-muted-foreground shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="truncate text-sm font-medium">{file.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {[formatBytes(file.metadata?.size), formatDate(file.updated_at || file.created_at)]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 shrink-0"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent
                        align="end"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <DropdownMenuItem onClick={() => handleOpenFile(file.name)}>
                          <FileIcon className="h-4 w-4 mr-2" />
                          Öffnen
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() =>
                            openRenameDialog({ kind: "file", name: file.name })
                          }
                        >
                          <Pencil className="h-4 w-4 mr-2" />
                          Umbenennen
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          className="text-destructive focus:text-destructive"
                          onClick={() =>
                            setDeleteTarget({ kind: "file", name: file.name })
                          }
                        >
                          <Trash2 className="h-4 w-4 mr-2" />
                          Löschen
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </main>

      {/* Dialog: Neuer Ordner */}
      <Dialog
        open={createOpen}
        onOpenChange={(open) => {
          if (!busy) setCreateOpen(open);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Neuer Ordner</DialogTitle>
            <DialogDescription>
              {path.length > 0
                ? `Neuen Ordner in "${path[path.length - 1]}" erstellen.`
                : "Neuen Ordner im Projektstamm erstellen."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="new-folder-name">Ordnername</Label>
            <Input
              id="new-folder-name"
              value={createName}
              onChange={(e) => setCreateName(e.target.value)}
              placeholder="z. B. Hydraulik"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreateFolder();
              }}
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setCreateOpen(false)}
              disabled={busy}
            >
              Abbrechen
            </Button>
            <Button onClick={handleCreateFolder} disabled={busy}>
              {busy && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Erstellen
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog: Umbenennen */}
      <Dialog
        open={!!renameTarget}
        onOpenChange={(open) => {
          if (!open && !busy) setRenameTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {renameTarget?.kind === "folder"
                ? "Ordner umbenennen"
                : "Datei umbenennen"}
            </DialogTitle>
            <DialogDescription>
              {renameTarget?.kind === "folder"
                ? "Alle enthaltenen Dateien werden mit verschoben."
                : "Geben Sie einen neuen Dateinamen ein."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="rename-input">Neuer Name</Label>
            <Input
              id="rename-input"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") handleRename();
              }}
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setRenameTarget(null)}
              disabled={busy}
            >
              Abbrechen
            </Button>
            <Button onClick={handleRename} disabled={busy}>
              {busy && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {busy ? "Wird umbenannt..." : "Umbenennen"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog: Verschieben */}
      <Dialog
        open={!!moveTarget}
        onOpenChange={(open) => {
          if (!open && !busy) setMoveTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Ordner verschieben</DialogTitle>
            <DialogDescription>
              {`Wählen Sie das Ziel für "${moveTarget ?? ""}". Alle enthaltenen Dateien werden mit verschoben.`}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Zielordner</Label>
            {moveLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                Ordner werden geladen...
              </div>
            ) : (
              <Select value={moveDest} onValueChange={setMoveDest}>
                <SelectTrigger>
                  <SelectValue placeholder="Zielordner wählen" />
                </SelectTrigger>
                <SelectContent>
                  {path.length > 0 && (
                    <SelectItem value={ROOT_VALUE}>
                      Projektstamm (oberste Ebene)
                    </SelectItem>
                  )}
                  {moveDestinations.map((dest) => (
                    <SelectItem key={dest} value={dest}>
                      {dest.split("/").join(" / ")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {!moveLoading && moveDestinations.length === 0 && path.length === 0 && (
              <p className="text-sm text-muted-foreground">
                Keine anderen Zielordner vorhanden.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setMoveTarget(null)}
              disabled={busy}
            >
              Abbrechen
            </Button>
            <Button
              onClick={handleMoveFolder}
              disabled={busy || moveLoading || !moveDest}
            >
              {busy && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {busy ? "Wird verschoben..." : "Verschieben"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* AlertDialog: Löschen */}
      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open && !busy) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {deleteTarget?.kind === "folder" ? "Ordner löschen?" : "Datei löschen?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget?.kind === "folder"
                ? `Der Ordner "${deleteTarget?.name}" und alle darin enthaltenen Dateien und Unterordner werden unwiderruflich gelöscht.`
                : `Die Datei "${deleteTarget?.name}" wird unwiderruflich gelöscht.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Abbrechen</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={busy}
              onClick={(e) => {
                e.preventDefault();
                handleDelete();
              }}
            >
              {busy ? "Wird gelöscht..." : "Löschen"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default ProjectFiles;
