-- Update handle_new_user function to include napetschnig.chris@gmail.com as admin
CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  assigned_role app_role;
BEGIN
  -- office@moebel-eder.at und napetschnig.chris@gmail.com werden immer Administrator
  IF NEW.email = 'office@moebel-eder.at' OR NEW.email = 'napetschnig.chris@gmail.com' THEN
    assigned_role := 'administrator';
  ELSE
    assigned_role := 'mitarbeiter';
  END IF;
  
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, assigned_role);
  
  -- ALLE Nutzer sind sofort aktiv (is_active = true)
  INSERT INTO public.profiles (id, vorname, nachname, is_active)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'vorname', ''),
    COALESCE(NEW.raw_user_meta_data->>'nachname', ''),
    true
  );
  
  RETURN NEW;
END;
$function$;