import { Building2, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useNavigate } from "react-router-dom";
import { PageHeader } from "@/components/PageHeader";

const ConstructionSites = () => {
  const navigate = useNavigate();

  const sites = [
    {
      id: 1,
      name: "Einfamilienhaus Müller",
      address: "Hauptstraße 12, 1010 Wien",
      workers: 4,
      status: "Aktiv",
      progress: 65,
    },
    {
      id: 2,
      name: "Dachsanierung Schmidt",
      address: "Bergstraße 45, 8010 Graz",
      workers: 2,
      status: "Aktiv",
      progress: 30,
    },
    {
      id: 3,
      name: "Carport Bau Huber",
      address: "Waldweg 8, 4020 Linz",
      workers: 3,
      status: "Pausiert",
      progress: 80,
    },
  ];

  return (
    <div className="min-h-screen bg-background">
      <PageHeader title="Baustellen" />
      <main className="container mx-auto px-4 py-6 max-w-5xl">

        <div className="grid gap-6">
          {sites.map((site) => (
            <Card key={site.id} className="border-2 hover:shadow-lg transition-all">
              <CardHeader className="bg-primary/5">
                <div className="flex justify-between items-start">
                  <div className="flex gap-3">
                    <div className="w-12 h-12 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
                      <Building2 className="w-6 h-6" />
                    </div>
                    <div>
                      <CardTitle className="text-xl mb-2">{site.name}</CardTitle>
                      <CardDescription className="flex items-center gap-2 text-base">
                        <MapPin className="w-4 h-4" />
                        {site.address}
                      </CardDescription>
                    </div>
                  </div>
                  <Badge variant={site.status === "Aktiv" ? "default" : "secondary"} className="text-sm">
                    {site.status}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="pt-6">
                <div className="space-y-4">
                  <div className="flex justify-between items-center">
                    <span className="text-sm font-medium">Fortschritt</span>
                    <span className="text-sm text-muted-foreground">{site.progress}%</span>
                  </div>
                  <div className="w-full bg-secondary rounded-full h-3">
                    <div
                      className="bg-accent h-3 rounded-full transition-all"
                      style={{ width: `${site.progress}%` }}
                    />
                  </div>
                  <div className="flex justify-between items-center pt-2">
                    <span className="text-sm text-muted-foreground">
                      {site.workers} Mitarbeiter vor Ort
                    </span>
                    <Button variant="outline">Details ansehen</Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </main>
    </div>
  );
};

export default ConstructionSites;
