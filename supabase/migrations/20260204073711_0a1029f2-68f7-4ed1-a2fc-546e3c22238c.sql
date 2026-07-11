-- Profil für page.research@gmail.com erstellen
INSERT INTO public.profiles (id, vorname, nachname, is_active)
SELECT id, 'Max', 'Mustermann', true
FROM auth.users
WHERE email = 'page.research@gmail.com'
ON CONFLICT (id) DO NOTHING;

-- Rolle zuweisen
INSERT INTO public.user_roles (user_id, role)
SELECT id, 'mitarbeiter'::app_role
FROM auth.users
WHERE email = 'page.research@gmail.com'
ON CONFLICT (user_id, role) DO NOTHING;