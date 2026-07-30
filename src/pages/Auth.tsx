import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";


export default function Auth() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [isLogin, setIsLogin] = useState(true);
  const [showPasswordReset, setShowPasswordReset] = useState(false);
  // Recovery-Modus: wird aktiv, wenn der Nutzer über den Passwort-Reset-Link zurückkommt
  const [isRecovery, setIsRecovery] = useState(false);

  // Supabase feuert beim Öffnen des Reset-Links das Event 'PASSWORD_RECOVERY';
  // dann schalten wir die UI in den "neues Passwort setzen"-Modus um.
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") {
        setIsRecovery(true);
      }
    });
    return () => subscription.unsubscribe();
  }, []);

  // Neues Passwort setzen (nach Klick auf Reset-Link)
  const handleUpdatePassword = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);

    const formData = new FormData(e.currentTarget);
    const password = formData.get("new-password") as string;
    const confirm = formData.get("confirm-password") as string;

    // Mindestlänge prüfen
    if (password.length < 6) {
      toast({
        variant: "destructive",
        title: "Passwort zu kurz",
        description: "Das Passwort muss mindestens 6 Zeichen lang sein.",
      });
      setLoading(false);
      return;
    }

    // Beide Felder müssen übereinstimmen
    if (password !== confirm) {
      toast({
        variant: "destructive",
        title: "Passwörter stimmen nicht überein",
        description: "Bitte geben Sie in beiden Feldern dasselbe Passwort ein.",
      });
      setLoading(false);
      return;
    }

    const { error } = await supabase.auth.updateUser({ password });

    if (error) {
      toast({
        variant: "destructive",
        title: "Fehler",
        description: error.message,
      });
      setLoading(false);
      return;
    }

    toast({
      title: "Passwort geändert",
      description: "Ihr neues Passwort wurde gespeichert.",
    });
    setIsRecovery(false);
    navigate("/");
    setLoading(false);
  };

  const handleLogin = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);

    const formData = new FormData(e.currentTarget);
    const email = formData.get("email") as string;
    const password = formData.get("password") as string;

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      toast({
        variant: "destructive",
        title: "Fehler beim Anmelden",
        description: error.message,
      });
      setLoading(false);
      return;
    }

    toast({
      title: "Erfolgreich angemeldet",
    });
    navigate("/");
    setLoading(false);
  };

  const handleSignup = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);

    const formData = new FormData(e.currentTarget);
    const vorname = formData.get("vorname") as string;
    const nachname = formData.get("nachname") as string;
    const email = formData.get("email") as string;
    const password = formData.get("password") as string;

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/`,
        data: { vorname, nachname },
      },
    });

    if (error) {
      toast({
        variant: "destructive",
        title: "Fehler bei der Registrierung",
        description: error.message,
      });
      setLoading(false);
      return;
    }

    toast({ 
      title: "Registrierung erfolgreich!",
      description: "Sie können jetzt die App nutzen.",
    });
    
    navigate("/");
    setLoading(false);
  };


  const handlePasswordReset = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);

    const formData = new FormData(e.currentTarget);
    const email = formData.get("reset-email") as string;

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth`,
    });

    if (error) {
      toast({
        variant: "destructive",
        title: "Fehler",
        description: error.message,
      });
    } else {
      toast({
        title: "E-Mail gesendet",
        description: "Prüfen Sie Ihr Postfach für den Passwort-Reset-Link.",
      });
      setShowPasswordReset(false);
    }
    setLoading(false);
  };


  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
           <img src="/ruff-logo.png" alt="Ruff Michael Logo" className="h-16 mx-auto mb-4" />
          <CardTitle>Ruff Michael GmbH</CardTitle>
          <CardDescription>Wärme · Kälte · Regelung</CardDescription>
        </CardHeader>
        <CardContent>
          {isRecovery ? (
            /* Recovery-Modus: neues Passwort setzen */
            <div className="space-y-6">
              <div>
                <h3 className="text-lg font-semibold">Neues Passwort setzen</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  Bitte vergeben Sie ein neues Passwort für Ihr Konto.
                </p>
              </div>

              <form onSubmit={handleUpdatePassword} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="new-password">Neues Passwort</Label>
                  <Input
                    id="new-password"
                    name="new-password"
                    type="password"
                    required
                    minLength={6}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="confirm-password">Passwort bestätigen</Label>
                  <Input
                    id="confirm-password"
                    name="confirm-password"
                    type="password"
                    required
                    minLength={6}
                  />
                </div>

                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? "Lädt..." : "Passwort speichern"}
                </Button>
              </form>
            </div>
          ) : showPasswordReset ? (
            <div className="space-y-6">
              <div>
                <h3 className="text-lg font-semibold">Passwort zurücksetzen</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  Geben Sie Ihre E-Mail-Adresse ein, um einen Reset-Link zu erhalten.
                </p>
              </div>

              <form onSubmit={handlePasswordReset} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="reset-email">E-Mail</Label>
                  <Input
                    id="reset-email"
                    name="reset-email"
                    type="email"
                    placeholder="ihre@email.at"
                    required
                  />
                </div>

                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? "Lädt..." : "Reset-Link senden"}
                </Button>

                <Button
                  type="button"
                  variant="ghost"
                  className="w-full"
                  onClick={() => setShowPasswordReset(false)}
                >
                  Zurück zur Anmeldung
                </Button>
              </form>
            </div>
          ) : (
            <div className="space-y-6">
              {/* Login/Registrieren Auswahl */}
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant={isLogin ? "default" : "outline"}
                  className="flex-1"
                  onClick={() => setIsLogin(true)}
                >
                  Anmelden
                </Button>
                <Button
                  type="button"
                  variant={!isLogin ? "default" : "outline"}
                  className="flex-1"
                  onClick={() => setIsLogin(false)}
                >
                  Registrieren
                </Button>
              </div>

              {/* Formular */}
              <form onSubmit={isLogin ? handleLogin : handleSignup} className="space-y-4">
                {!isLogin && (
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="vorname">Vorname</Label>
                      <Input id="vorname" name="vorname" type="text" required />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="nachname">Nachname</Label>
                      <Input id="nachname" name="nachname" type="text" required />
                    </div>
                  </div>
                )}

                <div className="space-y-2">
                  <Label htmlFor="email">E-Mail</Label>
                  <Input
                    id="email"
                    name="email"
                    type="email"
                    autoComplete="email"
                    placeholder="ihre@email.at"
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="password">Passwort</Label>
                  <Input
                    id="password"
                    name="password"
                    type="password"
                    required
                    minLength={6}
                  />
                </div>

                {isLogin && (
                  <button
                    type="button"
                    onClick={() => setShowPasswordReset(true)}
                    className="text-sm text-primary hover:underline"
                  >
                    Passwort vergessen?
                  </button>
                )}

                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? "Lädt..." : (isLogin ? "Anmelden" : "Registrieren")}
                </Button>
              </form>

            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
