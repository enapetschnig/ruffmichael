-- Schritt 1: Profil für napetschnig.chris@gmail.com erstellen
INSERT INTO public.profiles (id, vorname, nachname, is_active)
SELECT id, 'Max', 'Mustermann', true
FROM auth.users
WHERE email = 'napetschnig.chris@gmail.com'
ON CONFLICT (id) DO NOTHING;

-- Schritt 2: Administrator-Rolle zuweisen (diese E-Mail ist in der Whitelist)
INSERT INTO public.user_roles (user_id, role)
SELECT id, 'administrator'::app_role
FROM auth.users
WHERE email = 'napetschnig.chris@gmail.com'
ON CONFLICT (user_id, role) DO NOTHING;

-- Schritt 3: Mitarbeiter-Eintrag erstellen
INSERT INTO public.employees (user_id, vorname, nachname, email)
SELECT id, 'Max', 'Mustermann', 'napetschnig.chris@gmail.com'
FROM auth.users
WHERE email = 'napetschnig.chris@gmail.com'
ON CONFLICT DO NOTHING;

-- Schritt 4: Trigger für zukünftige Registrierungen reparieren
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();