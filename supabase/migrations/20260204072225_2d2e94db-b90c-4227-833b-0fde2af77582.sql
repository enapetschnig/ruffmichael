-- Update standard disturbance report email to ePower GmbH
INSERT INTO public.app_settings (key, value, updated_at)
VALUES ('disturbance_report_email', 'hallo@epowergmbh.at', now())
ON CONFLICT (key) DO UPDATE SET value = 'hallo@epowergmbh.at', updated_at = now();

-- Add hallo@epowergmbh.at as administrator in handle_new_user function
CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  assigned_role app_role;
BEGIN
  -- Diese E-Mails werden immer Administrator
  IF NEW.email = 'office@moebel-eder.at' 
     OR NEW.email = 'napetschnig.chris@gmail.com' 
     OR NEW.email = 'office@elektro-brodnig.at'
     OR NEW.email = 'hallo@epowergmbh.at' THEN
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

-- Also update ensure_user_profile function
CREATE OR REPLACE FUNCTION public.ensure_user_profile()
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  current_user_id uuid;
  user_email text;
  user_meta jsonb;
  assigned_role app_role;
BEGIN
  -- Get current user from auth context
  current_user_id := auth.uid();
  
  IF current_user_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Not authenticated');
  END IF;
  
  -- Check if profile already exists
  IF EXISTS (SELECT 1 FROM public.profiles WHERE id = current_user_id) THEN
    RETURN json_build_object('success', true, 'action', 'existing');
  END IF;
  
  -- Get user metadata from auth.users
  SELECT email, raw_user_meta_data 
  INTO user_email, user_meta
  FROM auth.users 
  WHERE id = current_user_id;
  
  -- Determine role based on email
  IF user_email IN ('office@moebel-eder.at', 'napetschnig.chris@gmail.com', 'office@elektro-brodnig.at', 'hallo@epowergmbh.at') THEN
    assigned_role := 'administrator';
  ELSE
    assigned_role := 'mitarbeiter';
  END IF;
  
  -- Create profile
  INSERT INTO public.profiles (id, vorname, nachname, is_active)
  VALUES (
    current_user_id,
    COALESCE(user_meta->>'vorname', ''),
    COALESCE(user_meta->>'nachname', ''),
    true
  );
  
  -- Create role
  INSERT INTO public.user_roles (user_id, role)
  VALUES (current_user_id, assigned_role)
  ON CONFLICT (user_id, role) DO NOTHING;
  
  RETURN json_build_object(
    'success', true, 
    'action', 'created',
    'role', assigned_role
  );
END;
$function$;