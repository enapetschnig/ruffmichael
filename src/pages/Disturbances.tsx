import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Zap, Plus, Calendar, Clock, User, Mail, Phone, MapPin, Filter, Search, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { de } from "date-fns/locale";
import { DisturbanceForm } from "@/components/DisturbanceForm";

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
  user_id: string;
  profile_vorname?: string;
  profile_nachname?: string;
};

const Disturbances = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [disturbances, setDisturbances] = useState<Disturbance[]>([]);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editingDisturbance, setEditingDisturbance] = useState<Disturbance | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("alle");

  useEffect(() => {
    checkAuth();
  }, []);

  const checkAuth = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      navigate("/auth");
      return;
    }

    // Check if admin
    const { data: roleData } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", session.user.id)
      .single();

    setIsAdmin(roleData?.role === "administrator");
    fetchDisturbances();
  };

  const fetchDisturbances = async () => {
    setLoading(true);
    
    const { data, error } = await supabase
      .from("disturbances")
      .select("*")
      .order("datum", { ascending: false });

    if (error) {
      toast({
        variant: "destructive",
        title: "Fehler",
        description: "Störungen konnten nicht geladen werden",
      });
    } else {
      // Fetch profile names separately for admin view
      if (data && data.length > 0) {
        const userIds = [...new Set(data.map(d => d.user_id))];
        const { data: profiles } = await supabase
          .from("profiles")
          .select("id, vorname, nachname")
          .in("id", userIds);
        
        const profileMap = new Map(profiles?.map(p => [p.id, p]) || []);
        
        const enrichedData = data.map(d => ({
          ...d,
          profile_vorname: profileMap.get(d.user_id)?.vorname || "",
          profile_nachname: profileMap.get(d.user_id)?.nachname || "",
        }));
        
        setDisturbances(enrichedData);
      } else {
        setDisturbances([]);
      }
    }
    setLoading(false);
  };

  const handleFormSuccess = () => {
    setShowForm(false);
    setEditingDisturbance(null);
    fetchDisturbances();
  };

  const getStatusBadge = (status: string, isVerrechnet?: boolean) => {
    if (isVerrechnet) {
      return <Badge className="bg-emerald-600 text-white">Verrechnet</Badge>;
    }
    switch (status) {
      case "offen":
        return <Badge variant="secondary">Offen</Badge>;
      case "gesendet":
        return <Badge className="bg-blue-500">Gesendet</Badge>;
      case "abgeschlossen":
        return <Badge className="bg-green-500">Abgeschlossen</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const handleToggleVerrechnet = async (e: React.MouseEvent, disturbanceId: string, currentValue: boolean) => {
    e.stopPropagation();
    
    const { error } = await supabase
      .from("disturbances")
      .update({ is_verrechnet: !currentValue })
      .eq("id", disturbanceId);
    
    if (error) {
      toast({
        variant: "destructive",
        title: "Fehler",
        description: "Status konnte nicht geändert werden",
      });
    } else {
      fetchDisturbances();
    }
  };

  const filteredDisturbances = disturbances.filter((d) => {
    const matchesSearch =
      d.kunde_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      d.beschreibung.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (d.kunde_adresse?.toLowerCase().includes(searchQuery.toLowerCase()) ?? false);
    
    let matchesStatus = true;
    if (statusFilter === "verrechnet") {
      matchesStatus = d.is_verrechnet === true;
    } else if (statusFilter === "nicht_verrechnet") {
      matchesStatus = d.is_verrechnet === false;
    } else if (statusFilter !== "alle") {
      matchesStatus = d.status === statusFilter;
    }
    
    return matchesSearch && matchesStatus;
  });

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b bg-card sticky top-0 z-50 shadow-sm">
        <div className="container mx-auto px-4 py-3">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => navigate("/")}>
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <h1 className="text-lg font-semibold">Regieberichte</h1>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-6 max-w-4xl">
        {/* Header with action button */}
        <div className="flex flex-col sm:flex-row gap-4 justify-between items-start sm:items-center mb-6">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Zap className="h-6 w-6 text-primary" />
              Regieberichte
            </h1>
            <p className="text-muted-foreground">
              Service-Einsätze dokumentieren
            </p>
          </div>
          <Button onClick={() => setShowForm(true)} className="gap-2">
            <Plus className="h-4 w-4" />
            Neuer Regiebericht
          </Button>
        </div>

        {/* Filter Section */}
        <Card className="mb-6">
          <CardContent className="pt-4">
            <div className="flex flex-col sm:flex-row gap-4">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Suche nach Kunde, Beschreibung..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10"
                />
              </div>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-full sm:w-[180px]">
                  <Filter className="h-4 w-4 mr-2" />
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="alle">Alle Status</SelectItem>
                  <SelectItem value="offen">Offen</SelectItem>
                  <SelectItem value="gesendet">Gesendet</SelectItem>
                  <SelectItem value="abgeschlossen">Abgeschlossen</SelectItem>
                  <SelectItem value="verrechnet">Verrechnet</SelectItem>
                  <SelectItem value="nicht_verrechnet">Nicht verrechnet</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {/* Disturbances List */}
        {filteredDisturbances.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <Zap className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <h3 className="text-lg font-medium mb-2">Keine Einträge gefunden</h3>
              <p className="text-muted-foreground mb-4">
                {searchQuery || statusFilter !== "alle"
                  ? "Keine Einträge entsprechen Ihren Filterkriterien"
                  : "Erstellen Sie Ihren ersten Regiebericht"}
              </p>
              {!searchQuery && statusFilter === "alle" && (
                <Button onClick={() => setShowForm(true)} variant="outline">
                  <Plus className="h-4 w-4 mr-2" />
                  Ersten Regiebericht erfassen
                </Button>
              )}
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {filteredDisturbances.map((disturbance) => (
              <Card
                key={disturbance.id}
                className="cursor-pointer hover:shadow-md transition-shadow"
                onClick={() => navigate(`/disturbances/${disturbance.id}`)}
              >
                <CardContent className="pt-4">
                  <div className="flex flex-col sm:flex-row gap-4 justify-between">
                    <div className="flex-1 space-y-2">
                      <div className="flex items-start justify-between">
                        <div>
                          <h3 className="font-semibold text-lg flex items-center gap-2">
                            <User className="h-4 w-4 text-muted-foreground" />
                            {disturbance.kunde_name}
                          </h3>
                          {isAdmin && (disturbance.profile_vorname || disturbance.profile_nachname) && (
                            <p className="text-xs text-muted-foreground">
                              Erstellt von: {disturbance.profile_vorname} {disturbance.profile_nachname}
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-2 flex-wrap">
                          {getStatusBadge(disturbance.status, disturbance.is_verrechnet)}
                          {isAdmin && disturbance.status !== "offen" && (
                            <Button
                              variant={disturbance.is_verrechnet ? "secondary" : "outline"}
                              size="sm"
                              className="h-6 text-xs"
                              onClick={(e) => handleToggleVerrechnet(e, disturbance.id, disturbance.is_verrechnet)}
                            >
                              {disturbance.is_verrechnet ? "✓ Verrechnet" : "Verrechnen"}
                            </Button>
                          )}
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Calendar className="h-4 w-4" />
                          {format(new Date(disturbance.datum), "dd.MM.yyyy", { locale: de })}
                        </span>
                        <span className="flex items-center gap-1">
                          <Clock className="h-4 w-4" />
                          {disturbance.start_time.slice(0, 5)} - {disturbance.end_time.slice(0, 5)} ({disturbance.stunden.toFixed(1)}h)
                        </span>
                        {disturbance.kunde_adresse && (
                          <span className="flex items-center gap-1">
                            <MapPin className="h-4 w-4" />
                            {disturbance.kunde_adresse}
                          </span>
                        )}
                      </div>

                      <p className="text-sm line-clamp-2">{disturbance.beschreibung}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </main>

      {/* Disturbance Form Dialog */}
      <DisturbanceForm
        open={showForm}
        onOpenChange={setShowForm}
        onSuccess={handleFormSuccess}
        editData={editingDisturbance}
      />
    </div>
  );
};

export default Disturbances;
