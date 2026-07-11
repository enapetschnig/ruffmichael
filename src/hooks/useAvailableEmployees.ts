import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

export type Employee = {
  id: string;
  vorname: string;
  nachname: string;
  is_active: boolean;
};

export const useAvailableEmployees = (excludeCurrentUser = true) => {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  useEffect(() => {
    fetchEmployees();
  }, [excludeCurrentUser]);

  const fetchEmployees = async () => {
    setLoading(true);
    
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      setCurrentUserId(user.id);
    }

    const { data, error } = await supabase
      .from("profiles")
      .select("id, vorname, nachname, is_active")
      .eq("is_active", true)
      .order("nachname");

    if (!error && data) {
      let filteredEmployees = data;
      if (excludeCurrentUser && user) {
        filteredEmployees = data.filter(e => e.id !== user.id);
      }
      setEmployees(filteredEmployees);
    }
    
    setLoading(false);
  };

  return { employees, loading, currentUserId, refetch: fetchEmployees };
};
