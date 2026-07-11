-- Testumgebung: Ermögliche allen Benutzern freien Rollenwechsel
-- Alte restriktive Policies löschen
DROP POLICY IF EXISTS "Users can insert own override (mitarbeiter) or admin any" ON public.user_role_overrides;
DROP POLICY IF EXISTS "Users can update own override (mitarbeiter) or admin any" ON public.user_role_overrides;

-- Neue permissive Policies für Testzwecke erstellen
-- Jeder authentifizierte User kann seine Override-Rolle frei wählen
CREATE POLICY "Users can insert any override for testing"
ON public.user_role_overrides
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update any override for testing"
ON public.user_role_overrides
FOR UPDATE
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);