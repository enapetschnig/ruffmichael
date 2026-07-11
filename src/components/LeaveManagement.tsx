import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Calendar, Check, X, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { de } from "date-fns/locale";

type Profile = {
  id: string;
  vorname: string;
  nachname: string;
};

type LeaveRequest = {
  id: string;
  user_id: string;
  start_date: string;
  end_date: string;
  days: number;
  type: string;
  status: string;
  notizen: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
};

type LeaveBalance = {
  id: string;
  user_id: string;
  year: number;
  total_days: number;
  used_days: number;
};

interface LeaveManagementProps {
  profiles: Profile[];
}

export default function LeaveManagement({ profiles }: LeaveManagementProps) {
  const { toast } = useToast();
  const [requests, setRequests] = useState<LeaveRequest[]>([]);
  const [balances, setBalances] = useState<LeaveBalance[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [editingBalance, setEditingBalance] = useState<string | null>(null);
  const [editDays, setEditDays] = useState("");

  const fetchData = async () => {
    setLoading(true);
    const [{ data: reqData }, { data: balData }] = await Promise.all([
      supabase
        .from("leave_requests")
        .select("*")
        .order("created_at", { ascending: false }),
      supabase
        .from("leave_balances")
        .select("*")
        .eq("year", selectedYear),
    ]);

    if (reqData) setRequests(reqData as LeaveRequest[]);
    if (balData) setBalances(balData as LeaveBalance[]);
    setLoading(false);
  };

  useEffect(() => {
    fetchData();
  }, [selectedYear]);

  const getProfileName = (userId: string) => {
    const p = profiles.find((p) => p.id === userId);
    return p ? `${p.vorname} ${p.nachname}` : "Unbekannt";
  };

  const handleReview = async (requestId: string, newStatus: "genehmigt" | "abgelehnt") => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const request = requests.find((r) => r.id === requestId);
    if (!request) return;

    const { error } = await supabase
      .from("leave_requests")
      .update({
        status: newStatus,
        reviewed_by: user.id,
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", requestId);

    if (error) {
      toast({ variant: "destructive", title: "Fehler", description: error.message });
      return;
    }

    // If approved, update used_days in leave_balances
    if (newStatus === "genehmigt") {
      const year = new Date(request.start_date).getFullYear();
      const existingBalance = balances.find(
        (b) => b.user_id === request.user_id && b.year === year
      );

      if (existingBalance) {
        await supabase
          .from("leave_balances")
          .update({ used_days: existingBalance.used_days + request.days })
          .eq("id", existingBalance.id);
      } else {
        await supabase.from("leave_balances").insert({
          user_id: request.user_id,
          year,
          total_days: 25,
          used_days: request.days,
        });
      }
    }

    toast({
      title: newStatus === "genehmigt" ? "Genehmigt" : "Abgelehnt",
      description: `Urlaubsantrag wurde ${newStatus}`,
    });
    fetchData();
  };

  const ensureBalance = async (userId: string) => {
    const existing = balances.find((b) => b.user_id === userId && b.year === selectedYear);
    if (existing) return;

    await supabase.from("leave_balances").insert({
      user_id: userId,
      year: selectedYear,
      total_days: 25,
      used_days: 0,
    });
    fetchData();
  };

  const updateTotalDays = async (balanceId: string, totalDays: number) => {
    const { error } = await supabase
      .from("leave_balances")
      .update({ total_days: totalDays })
      .eq("id", balanceId);

    if (error) {
      toast({ variant: "destructive", title: "Fehler", description: error.message });
    } else {
      toast({ title: "Gespeichert", description: "Urlaubstage aktualisiert" });
    }
    setEditingBalance(null);
    fetchData();
  };

  const statusBadge = (status: string) => {
    switch (status) {
      case "beantragt":
        return <Badge variant="secondary">Beantragt</Badge>;
      case "genehmigt":
        return <Badge className="bg-green-600 text-white">Genehmigt</Badge>;
      case "abgelehnt":
        return <Badge variant="destructive">Abgelehnt</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const pendingRequests = requests.filter((r) => r.status === "beantragt");
  const processedRequests = requests.filter((r) => r.status !== "beantragt");

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Pending requests */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calendar className="h-5 w-5" />
            Offene Urlaubsanträge
            {pendingRequests.length > 0 && (
              <Badge variant="destructive">{pendingRequests.length}</Badge>
            )}
          </CardTitle>
          <CardDescription>Urlaubsanträge genehmigen oder ablehnen</CardDescription>
        </CardHeader>
        <CardContent>
          {pendingRequests.length === 0 ? (
            <p className="text-muted-foreground text-center py-4">
              Keine offenen Anträge
            </p>
          ) : (
            <div className="space-y-3">
              {pendingRequests.map((req) => (
                <div
                  key={req.id}
                  className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-lg border bg-card"
                >
                  <div>
                    <p className="font-medium">{getProfileName(req.user_id)}</p>
                    <p className="text-sm text-muted-foreground">
                      {format(new Date(req.start_date), "dd.MM.yyyy", { locale: de })} –{" "}
                      {format(new Date(req.end_date), "dd.MM.yyyy", { locale: de })}
                      {" · "}{req.days} {req.days === 1 ? "Tag" : "Tage"}
                    </p>
                    {req.notizen && (
                      <p className="text-sm mt-1">{req.notizen}</p>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      onClick={() => handleReview(req.id, "genehmigt")}
                    >
                      <Check className="h-4 w-4 mr-1" /> Genehmigen
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => handleReview(req.id, "abgelehnt")}
                    >
                      <X className="h-4 w-4 mr-1" /> Ablehnen
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Leave Balances */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Urlaubskontingent {selectedYear}</CardTitle>
              <CardDescription>Urlaubstage pro Mitarbeiter verwalten</CardDescription>
            </div>
            <Select
              value={String(selectedYear)}
              onValueChange={(v) => setSelectedYear(Number(v))}
            >
              <SelectTrigger className="w-[120px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[selectedYear - 1, selectedYear, selectedYear + 1].map((y) => (
                  <SelectItem key={y} value={String(y)}>
                    {y}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {profiles
              .filter((p) => p.vorname && p.nachname)
              .map((profile) => {
                const balance = balances.find(
                  (b) => b.user_id === profile.id && b.year === selectedYear
                );
                const remaining = balance
                  ? balance.total_days - balance.used_days
                  : 25;

                return (
                  <div
                    key={profile.id}
                    className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-3 rounded-lg border"
                  >
                    <div>
                      <p className="font-medium">
                        {profile.vorname} {profile.nachname}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {balance
                          ? `${balance.used_days} von ${balance.total_days} Tagen verbraucht · ${remaining} übrig`
                          : "Noch kein Kontingent angelegt"}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {balance && editingBalance === balance.id ? (
                        <div className="flex gap-1">
                          <Input
                            type="number"
                            value={editDays}
                            onChange={(e) => setEditDays(e.target.value)}
                            className="w-20"
                          />
                          <Button
                            size="sm"
                            onClick={() =>
                              updateTotalDays(balance.id, Number(editDays))
                            }
                          >
                            OK
                          </Button>
                        </div>
                      ) : balance ? (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setEditingBalance(balance.id);
                            setEditDays(String(balance.total_days));
                          }}
                        >
                          Tage ändern
                        </Button>
                      ) : (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => ensureBalance(profile.id)}
                        >
                          Kontingent anlegen
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
          </div>
        </CardContent>
      </Card>

      {/* Recent processed requests */}
      {processedRequests.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Bearbeitete Anträge</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {processedRequests.slice(0, 20).map((req) => (
                <div
                  key={req.id}
                  className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-3 rounded-lg border"
                >
                  <div>
                    <p className="font-medium">{getProfileName(req.user_id)}</p>
                    <p className="text-sm text-muted-foreground">
                      {format(new Date(req.start_date), "dd.MM.yyyy", { locale: de })} –{" "}
                      {format(new Date(req.end_date), "dd.MM.yyyy", { locale: de })}
                      {" · "}{req.days} {req.days === 1 ? "Tag" : "Tage"}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {statusBadge(req.status)}
                    {req.reviewed_by && (
                      <span className="text-xs text-muted-foreground">
                        von {getProfileName(req.reviewed_by)}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
