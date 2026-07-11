-- Update handle_new_user function so new users are mitarbeiter by default
-- Only the very first user becomes administrator
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  user_count INTEGER;
  assigned_role app_role;
BEGIN
  -- Count existing users (excluding the current one being created)
  SELECT COUNT(*) INTO user_count FROM auth.users WHERE id != NEW.id;
  
  -- First user (user_count = 0) becomes administrator, all others become mitarbeiter
  IF user_count = 0 THEN
    assigned_role := 'administrator';
  ELSE
    assigned_role := 'mitarbeiter';
  END IF;
  
  -- Insert into user_roles
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, assigned_role);
  
  -- Insert into profiles with data from sign up metadata
  INSERT INTO public.profiles (id, vorname, nachname)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'vorname', ''),
    COALESCE(NEW.raw_user_meta_data->>'nachname', '')
  );
  
  RETURN NEW;
END;
$function$;