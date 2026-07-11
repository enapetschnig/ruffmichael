import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { supabase } from '@/integrations/supabase/client';

interface OnboardingContextType {
  showInstallDialog: boolean;
  setShowInstallDialog: (show: boolean) => void;
  handleRestartInstallGuide: () => void;
  handleInstallDialogClose: () => void;
}

const OnboardingContext = createContext<OnboardingContextType | undefined>(undefined);

const SESSION_KEY = 'onboarding_dialog_shown_this_session';

export function OnboardingProvider({ children }: { children: ReactNode }) {
  const [showInstallDialog, setShowInstallDialog] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [hasChecked, setHasChecked] = useState(false);

  useEffect(() => {
    let isMounted = true;
    let hasCheckedLocal = false;

    // Initiales Laden der Session
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!isMounted) return;
      setUserId(session?.user?.id ?? null);
      if (session?.user && !hasCheckedLocal) {
        hasCheckedLocal = true;
        checkIfShouldShowInstallGuide(session.user.id);
      }
    });

    // Auth State Changes hören (wichtig für frische Registrierungen!)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (!isMounted) return;
        setUserId(session?.user?.id ?? null);
        
        // Nur bei SIGNED_IN Event (nach Login/Registrierung) und nur einmal prüfen
        if (event === 'SIGNED_IN' && session?.user && !hasCheckedLocal) {
          hasCheckedLocal = true;
          // Kurze Verzögerung, damit Trigger das Profil erstellen kann
          setTimeout(() => {
            if (isMounted) {
              checkIfShouldShowInstallGuide(session.user.id);
            }
          }, 500);
        }
      }
    );

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const checkIfShouldShowInstallGuide = async (userId: string, retryCount = 0) => {
    // Wenn bereits in dieser Session gezeigt wurde, nicht nochmal zeigen
    if (sessionStorage.getItem(SESSION_KEY) === 'true') {
      setHasChecked(true);
      return;
    }

    const { data: profileData, error } = await supabase
      .from("profiles")
      .select("anleitung_completed")
      .eq("id", userId)
      .maybeSingle();

    // Falls Profil noch nicht existiert (Trigger noch nicht ausgeführt), nochmal versuchen
    if (!profileData && retryCount < 3) {
      setTimeout(() => {
        checkIfShouldShowInstallGuide(userId, retryCount + 1);
      }, 1000);
      return;
    }

    setHasChecked(true);

    // Wenn Profil existiert und anleitung_completed = true, NICHT anzeigen
    if (profileData?.anleitung_completed === true) {
      return;
    }

    // Nur anzeigen wenn anleitung_completed explizit false ist ODER kein Profil (neuer User)
    if (!profileData || profileData.anleitung_completed === false) {
      setShowInstallDialog(true);
      sessionStorage.setItem(SESSION_KEY, 'true');
    }
  };

  const handleRestartInstallGuide = () => {
    setShowInstallDialog(true);
  };

  const handleInstallDialogClose = async () => {
    if (userId) {
      await supabase
        .from('profiles')
        .update({ anleitung_completed: true })
        .eq('id', userId);
    }
    setShowInstallDialog(false);
  };

  return (
    <OnboardingContext.Provider
      value={{
        showInstallDialog,
        setShowInstallDialog,
        handleRestartInstallGuide,
        handleInstallDialogClose,
      }}
    >
      {children}
    </OnboardingContext.Provider>
  );
}

export function useOnboarding() {
  const context = useContext(OnboardingContext);
  if (context === undefined) {
    throw new Error('useOnboarding must be used within OnboardingProvider');
  }
  return context;
}
