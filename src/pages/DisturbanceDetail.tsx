import { useState, useEffect } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Zap, Calendar, Clock, User, Mail, Phone, MapPin, Edit, Trash2, Package, Plus, ArrowLeft, PenLine, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { de } from "date-fns/locale";
import { DisturbanceForm } from "@/components/DisturbanceForm";
import { DisturbanceMaterials } from "@/components/DisturbanceMaterials";
import { DisturbancePhotos } from "@/components/DisturbancePhotos";
import { SignatureDialog } from "@/components/SignatureDialog";

type Disturbance = {
  id: string;
  datum: string;
  start_time: string;
  end_time: string;
  pause_minutes: number;
  stunden: number;
  kunde_name: string;
  kunde_email: string | null;
  kunde_adresse: string | null;
  kunde_telefon: string | null;
  beschreibung: string;
  notizen: string | null;
  status: string;
  is_verrechnet: boolean;
  created_at: string;
  updated_at: string;
  user_id: string;
  profile_vorname?: string;
  profile_nachname?: string;
};

type Worker = {
  user_id: string;
  is_main: boolean;
  vorname: string;
  nachname: string;
};

const DisturbanceDetail = () => {
  const { id } = useParams<{ id: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [disturbance, setDisturbance] = useState<Disturbance | null>(null);
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [showEditForm, setShowEditForm] = useState(false);
  const [showSignatureDialog, setShowSignatureDialog] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [autoOpenSignatureHandled, setAutoOpenSignatureHandled] = useState(false);

  useEffect(() => {
    checkAuthAndFetch();
  }, [id]);

  const checkAuthAndFetch = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      navigate("/auth");
      return;
    }

    setCurrentUserId(session.user.id);

    // Check if admin
    const { data: roleData } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", session.user.id)
      .single();

    setIsAdmin(roleData?.role === "administrator");
    fetchDisturbance();
  };

  const fetchDisturbance = async () => {
    if (!id) return;
    
    setLoading(true);
    const { data, error } = await supabase
      .from("disturbances")
      .select("*")
      .eq("id", id)
      .single();

    if (error) {
      toast({
        variant: "destructive",
        title: "Fehler",
        description: "Regiebericht konnte nicht geladen werden",
      });
      navigate("/disturbances");
    } else {
      // Fetch profile name
      const { data: profile } = await supabase
        .from("profiles")
        .select("vorname, nachname")
        .eq("id", data.user_id)
        .single();
      
      setDisturbance({
        ...data,
        profile_vorname: profile?.vorname || "",
        profile_nachname: profile?.nachname || "",
      });

      // Fetch workers
      const { data: workersData } = await supabase
        .from("disturbance_workers")
        .select("user_id, is_main")
        .eq("disturbance_id", id);

      if (workersData && workersData.length > 0) {
        const workerIds = workersData.map(w => w.user_id);
        const { data: profiles } = await supabase
          .from("profiles")
          .select("id, vorname, nachname")
          .in("id", workerIds);

        const workersWithNames: Worker[] = workersData.map(w => {
          const profile = profiles?.find(p => p.id === w.user_id);
          return {
            user_id: w.user_id,
            is_main: w.is_main,
            vorname: profile?.vorname || "",
            nachname: profile?.nachname || "",
          };
        });
        setWorkers(workersWithNames);
      } else {
        setWorkers([]);
      }
      
      // Auto-open signature dialog if requested via URL parameter
      if (searchParams.get('openSignature') === 'true' && !autoOpenSignatureHandled) {
        setAutoOpenSignatureHandled(true);
        // Remove the parameter from URL
        searchParams.delete('openSignature');
        setSearchParams(searchParams, { replace: true });
        // Open signature dialog if status is "offen"
        if (data.status === 'offen') {
          setShowSignatureDialog(true);
        }
      }
    }
    setLoading(false);
  };

  const handleDelete = async () => {
    if (!disturbance) return;
    
    setDeleting(true);

    // Delete associated time entry first
    await supabase
      .from("time_entries")
      .delete()
      .eq("disturbance_id", disturbance.id);

    // Delete the disturbance (materials will cascade)
    const { error } = await supabase
      .from("disturbances")
      .delete()
      .eq("id", disturbance.id);

    if (error) {
      toast({
        variant: "destructive",
        title: "Fehler",
        description: "Regiebericht konnte nicht gelöscht werden",
      });
    } else {
      toast({
        title: "Erfolg",
        description: "Regiebericht wurde gelöscht",
      });
      navigate("/disturbances");
    }
    setDeleting(false);
  };

  const handleEditSuccess = () => {
    setShowEditForm(false);
    fetchDisturbance();
  };

  const handleSignatureSuccess = () => {
    setShowSignatureDialog(false);
    fetchDisturbance();
  };

  const getStatusBadge = (status: string, isVerrechnet?: boolean) => {
    if (isVerrechnet) {
      return <Badge className="bg-emerald-600 text-white text-base px-3 py-1">Verrechnet</Badge>;
    }
    switch (status) {
      case "offen":
        return <Badge variant="secondary" className="text-base px-3 py-1">Offen</Badge>;
      case "gesendet":
        return <Badge className="bg-blue-500 text-base px-3 py-1">Gesendet</Badge>;
      case "abgeschlossen":
        return <Badge className="bg-green-500 text-base px-3 py-1">Abgeschlossen</Badge>;
      default:
        return <Badge variant="outline" className="text-base px-3 py-1">{status}</Badge>;
    }
  };

  const handleToggleVerrechnet = async () => {
    if (!disturbance) return;
    
    const { error } = await supabase
      .from("disturbances")
      .update({ is_verrechnet: !disturbance.is_verrechnet })
      .eq("id", disturbance.id);
    
    if (error) {
      toast({
        variant: "destructive",
        title: "Fehler",
        description: "Status konnte nicht geändert werden",
      });
    } else {
      fetchDisturbance();
    }
  };

  const canEdit = disturbance && (currentUserId === disturbance.user_id || isAdmin);

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (!disturbance) {
    return (
      <div className="min-h-screen bg-background">
        <header className="border-b bg-card sticky top-0 z-50 shadow-sm">
          <div className="container mx-auto px-4 py-3">
            <div className="flex items-center gap-3">
              <Button variant="ghost" size="icon" onClick={() => navigate("/disturbances")}>
                <ArrowLeft className="h-5 w-5" />
              </Button>
              <h1 className="text-lg font-semibold">Regiebericht nicht gefunden</h1>
            </div>
          </div>
        </header>
        <main className="container mx-auto px-4 py-6 text-center">
          <p>Der angeforderte Regiebericht konnte nicht gefunden werden.</p>
          <Button onClick={() => navigate("/disturbances")} className="mt-4">
            Zurück zur Übersicht
          </Button>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card sticky top-0 z-50 shadow-sm">
        <div className="container mx-auto px-4 py-3">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => navigate("/disturbances")}>
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <h1 className="text-lg font-semibold">Regiebericht Details</h1>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-6 max-w-4xl space-y-6">
        {/* Header with status and actions */}
        <div className="flex flex-col sm:flex-row gap-4 justify-between items-start">
          <div className="flex items-center gap-4">
            <Zap className="h-8 w-8 text-primary" />
            <div>
              <h1 className="text-2xl font-bold">{disturbance.kunde_name}</h1>
              <p className="text-muted-foreground">
                {format(new Date(disturbance.datum), "EEEE, dd. MMMM yyyy", { locale: de })}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {getStatusBadge(disturbance.status, disturbance.is_verrechnet)}
            {isAdmin && disturbance.status !== "offen" && (
              <Button
                variant={disturbance.is_verrechnet ? "secondary" : "outline"}
                size="sm"
                onClick={handleToggleVerrechnet}
              >
                {disturbance.is_verrechnet ? "✓ Verrechnet" : "Als verrechnet markieren"}
              </Button>
            )}
            {canEdit && disturbance.status === "offen" && (
              <Button onClick={() => setShowSignatureDialog(true)} className="gap-1">
                <PenLine className="h-4 w-4" />
                Zur Unterschrift
              </Button>
            )}
            {canEdit && (
              <>
                <Button variant="outline" size="sm" onClick={() => setShowEditForm(true)}>
                  <Edit className="h-4 w-4 mr-1" />
                  Bearbeiten
                </Button>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="destructive" size="sm" disabled={deleting}>
                      <Trash2 className="h-4 w-4 mr-1" />
                      Löschen
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Regiebericht löschen?</AlertDialogTitle>
                      <AlertDialogDescription>
                        Diese Aktion kann nicht rückgängig gemacht werden. Der Regiebericht und alle zugehörigen Materialien werden endgültig gelöscht.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Abbrechen</AlertDialogCancel>
                      <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground">
                        Löschen
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </>
            )}
          </div>
        </div>

        {/* Customer Information */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <User className="h-5 w-5" />
              Kundendaten
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">Name</p>
              <p className="font-medium">{disturbance.kunde_name}</p>
            </div>
            {disturbance.kunde_email && (
              <div className="space-y-1">
                <p className="text-sm text-muted-foreground flex items-center gap-1">
                  <Mail className="h-4 w-4" /> E-Mail
                </p>
                <a href={`mailto:${disturbance.kunde_email}`} className="font-medium text-primary hover:underline">
                  {disturbance.kunde_email}
                </a>
              </div>
            )}
            {disturbance.kunde_telefon && (
              <div className="space-y-1">
                <p className="text-sm text-muted-foreground flex items-center gap-1">
                  <Phone className="h-4 w-4" /> Telefon
                </p>
                <a href={`tel:${disturbance.kunde_telefon}`} className="font-medium text-primary hover:underline">
                  {disturbance.kunde_telefon}
                </a>
              </div>
            )}
            {disturbance.kunde_adresse && (
              <div className="space-y-1">
                <p className="text-sm text-muted-foreground flex items-center gap-1">
                  <MapPin className="h-4 w-4" /> Adresse
                </p>
                <p className="font-medium">{disturbance.kunde_adresse}</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Time Information */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="h-5 w-5" />
              Arbeitszeit
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">Datum</p>
              <p className="font-medium">
                {format(new Date(disturbance.datum), "dd.MM.yyyy", { locale: de })}
              </p>
            </div>
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">Arbeitszeit</p>
              <p className="font-medium">
                {disturbance.start_time.slice(0, 5)} - {disturbance.end_time.slice(0, 5)}
              </p>
            </div>
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">Gesamtstunden</p>
              <p className="font-medium text-lg text-primary">{disturbance.stunden.toFixed(2)} h</p>
            </div>
            {disturbance.pause_minutes > 0 && (
              <div className="space-y-1">
                <p className="text-sm text-muted-foreground">Pause</p>
                <p className="font-medium">{disturbance.pause_minutes} Minuten</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Work Description */}
        <Card>
          <CardHeader>
            <CardTitle>Durchgeführte Arbeiten</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <p className="whitespace-pre-wrap">{disturbance.beschreibung}</p>
            </div>
            {disturbance.notizen && (
              <>
                <Separator />
                <div>
                  <p className="text-sm text-muted-foreground mb-2">Notizen</p>
                  <p className="whitespace-pre-wrap text-sm">{disturbance.notizen}</p>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* Workers Section */}
        {workers.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users className="h-5 w-5" />
                Beteiligte Mitarbeiter
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                {workers.map((worker) => (
                  <Badge 
                    key={worker.user_id} 
                    variant={worker.is_main ? "default" : "secondary"}
                    className="text-sm py-1 px-3"
                  >
                    {worker.vorname} {worker.nachname}
                    {worker.is_main && " (Ersteller)"}
                  </Badge>
                ))}
              </div>
              <p className="text-xs text-muted-foreground mt-3">
                Die Arbeitszeit wurde automatisch für alle {workers.length} Mitarbeiter gebucht.
              </p>
            </CardContent>
          </Card>
        )}

        {/* Photos Section */}
        <DisturbancePhotos 
          disturbanceId={disturbance.id} 
          canEdit={canEdit || false}
        />

        {/* Materials Section */}
        <DisturbanceMaterials 
          disturbanceId={disturbance.id} 
          canEdit={canEdit || false}
        />

        {/* Metadata */}
        {isAdmin && (disturbance.profile_vorname || disturbance.profile_nachname) && (
          <Card>
            <CardContent className="pt-4">
              <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
                <span>Erfasst von: {disturbance.profile_vorname} {disturbance.profile_nachname}</span>
                <span>Erstellt: {format(new Date(disturbance.created_at), "dd.MM.yyyy HH:mm", { locale: de })}</span>
                <span>Zuletzt aktualisiert: {format(new Date(disturbance.updated_at), "dd.MM.yyyy HH:mm", { locale: de })}</span>
              </div>
            </CardContent>
          </Card>
        )}
      </main>

      {/* Edit Form Dialog */}
      <DisturbanceForm
        open={showEditForm}
        onOpenChange={setShowEditForm}
        onSuccess={handleEditSuccess}
        editData={disturbance}
      />

      {/* Signature Dialog */}
      <SignatureDialog
        open={showSignatureDialog}
        onOpenChange={setShowSignatureDialog}
        disturbance={disturbance}
        onSuccess={handleSignatureSuccess}
      />
    </div>
  );
};

export default DisturbanceDetail;
