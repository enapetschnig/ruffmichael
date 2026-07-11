-- 1. Neues Feld hinzufügen mit Standard false
ALTER TABLE public.profiles ADD COLUMN is_active boolean DEFAULT false;

-- 2. ALLE existierenden Benutzer auf aktiv setzen (das System nicht zerschießen!)
UPDATE public.profiles SET is_active = true;

-- 3. Trigger anpassen: Erster Benutzer = aktiv, alle anderen = inaktiv
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  user_count INTEGER;
  assigned_role app_role;
  is_first_user BOOLEAN;
BEGIN
  SELECT COUNT(*) INTO user_count FROM auth.users WHERE id != NEW.id;
  
  is_first_user := (user_count = 0);
  
  IF is_first_user THEN
    assigned_role := 'administrator';
  ELSE
    assigned_role := 'mitarbeiter';
  END IF;
  
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, assigned_role);
  
  INSERT INTO public.profiles (id, vorname, nachname, is_active)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'vorname', ''),
    COALESCE(NEW.raw_user_meta_data->>'nachname', ''),
    is_first_user
  );
  
  RETURN NEW;
END;
$$;