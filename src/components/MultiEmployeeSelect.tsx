import { useState, useEffect, useCallback, useRef } from "react";
import { Users, AlertTriangle, Loader2 } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { supabase } from "@/integrations/supabase/client";
import { useAvailableEmployees, Employee } from "@/hooks/useAvailableEmployees";

type TimeConflict = {
  employeeId: string;
  employeeName: string;
  existingStart: string;
  existingEnd: string;
};

type MultiEmployeeSelectProps = {
  selectedEmployees: string[];
  onSelectionChange: (employees: string[]) => void;
  date: string;
  startTime: string;
  endTime: string;
  label?: string;
};

export const MultiEmployeeSelect = ({
  selectedEmployees,
  onSelectionChange,
  date,
  startTime,
  endTime,
  label = "Weitere Mitarbeiter (optional)",
}: MultiEmployeeSelectProps) => {
  const { employees, loading } = useAvailableEmployees(true);
  const [conflicts, setConflicts] = useState<TimeConflict[]>([]);
  const [checkingConflicts, setCheckingConflicts] = useState(false);
  
  // Ref to track if component is mounted for async operations
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Stable function to set employee checked state (add or remove)
  const setEmployeeChecked = useCallback((employeeId: string, checked: boolean) => {
    if (checked) {
      // Add employee if not already selected
      if (!selectedEmployees.includes(employeeId)) {
        onSelectionChange([...selectedEmployees, employeeId]);
      }
    } else {
      // Remove employee
      onSelectionChange(selectedEmployees.filter(id => id !== employeeId));
    }
  }, [selectedEmployees, onSelectionChange]);

  // Stable conflict check function with cancellation support
  const checkTimeConflicts = useCallback(async (signal: { cancelled: boolean }) => {
    if (!date || !startTime || !endTime || selectedEmployees.length === 0) {
      setConflicts([]);
      return;
    }
    
    setCheckingConflicts(true);
    const foundConflicts: TimeConflict[] = [];

    try {
      for (const employeeId of selectedEmployees) {
        // Check if cancelled before each async operation
        if (signal.cancelled) return;

        const { data: existingEntries, error } = await supabase
          .from("time_entries")
          .select("start_time, end_time, taetigkeit")
          .eq("user_id", employeeId)
          .eq("datum", date);

        if (error) {
          console.error("Error fetching time entries for conflict check:", error);
          continue;
        }

        // Check if cancelled after async operation
        if (signal.cancelled) return;

        if (existingEntries && existingEntries.length > 0) {
          const employee = employees.find(e => e.id === employeeId);
          
          for (const entry of existingEntries) {
            // Check for vacation/sick day
            if (["Urlaub", "Krankenstand", "Weiterbildung", "Feiertag"].includes(entry.taetigkeit || "")) {
              foundConflicts.push({
                employeeId,
                employeeName: employee ? `${employee.vorname} ${employee.nachname}` : "Unbekannt",
                existingStart: entry.taetigkeit || "",
                existingEnd: "",
              });
              continue;
            }

            // Check for time overlap - with null safety
            if (!entry.start_time || !entry.end_time) continue;

            try {
              const timeToMinutes = (time: string) => {
                const parts = time.split(':');
                if (parts.length < 2) return 0;
                const h = parseInt(parts[0], 10) || 0;
                const m = parseInt(parts[1], 10) || 0;
                return h * 60 + m;
              };

              const newStart = timeToMinutes(startTime);
              const newEnd = timeToMinutes(endTime);
              const existStart = timeToMinutes(entry.start_time);
              const existEnd = timeToMinutes(entry.end_time);

              if (newStart < existEnd && newEnd > existStart) {
                foundConflicts.push({
                  employeeId,
                  employeeName: employee ? `${employee.vorname} ${employee.nachname}` : "Unbekannt",
                  existingStart: entry.start_time.substring(0, 5),
                  existingEnd: entry.end_time.substring(0, 5),
                });
              }
            } catch (parseError) {
              console.error("Error parsing time for conflict check:", parseError, entry);
            }
          }
        }
      }

      // Only update state if not cancelled and still mounted
      if (!signal.cancelled && isMountedRef.current) {
        setConflicts(foundConflicts);
      }
    } catch (error) {
      console.error("Error in checkTimeConflicts:", error);
    } finally {
      // Always reset loading state if still mounted and not cancelled
      if (!signal.cancelled && isMountedRef.current) {
        setCheckingConflicts(false);
      }
    }
  }, [date, startTime, endTime, selectedEmployees, employees]);

  // Check for time conflicts when selection or time changes
  useEffect(() => {
    const signal = { cancelled: false };

    if (selectedEmployees.length > 0 && date && startTime && endTime && !loading) {
      checkTimeConflicts(signal);
    } else {
      setConflicts([]);
      setCheckingConflicts(false);
    }

    return () => {
      signal.cancelled = true;
    };
  }, [selectedEmployees, date, startTime, endTime, loading, checkTimeConflicts]);

  if (loading) {
    return (
      <div className="space-y-2">
        <Label className="flex items-center gap-2">
          <Users className="h-4 w-4" />
          {label}
        </Label>
        <div className="flex items-center gap-2 text-muted-foreground text-sm">
          <Loader2 className="h-4 w-4 animate-spin" />
          Lade Mitarbeiter...
        </div>
      </div>
    );
  }

  if (employees.length === 0) {
    return (
      <div className="space-y-2">
        <Label className="flex items-center gap-2">
          <Users className="h-4 w-4" />
          {label}
        </Label>
        <p className="text-sm text-muted-foreground">
          Keine weiteren aktiven Mitarbeiter verfügbar
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label className="flex items-center gap-2">
          <Users className="h-4 w-4" />
          {label}
        </Label>
        {selectedEmployees.length > 0 && (
          <Badge variant="secondary" className="text-xs">
            {selectedEmployees.length} ausgewählt
          </Badge>
        )}
      </div>

      <div className="border rounded-lg p-3 space-y-2 max-h-48 overflow-y-auto bg-muted/30">
        {employees.map((employee) => {
          const isSelected = selectedEmployees.includes(employee.id);
          const hasConflict = conflicts.some(c => c.employeeId === employee.id);
          const checkboxId = `employee-checkbox-${employee.id}`;
          
          return (
            <label
              key={employee.id}
              htmlFor={checkboxId}
              className={`flex items-center space-x-3 p-2 rounded-md hover:bg-muted/50 cursor-pointer transition-colors ${
                isSelected ? "bg-primary/10" : ""
              } ${hasConflict ? "border-l-2 border-amber-500" : ""}`}
            >
              <Checkbox
                id={checkboxId}
                checked={isSelected}
                onCheckedChange={(checked) => {
                  // Use explicit boolean to add/remove, preventing double-toggle
                  setEmployeeChecked(employee.id, checked === true);
                }}
              />
              <span className="flex-1 text-sm font-medium">
                {employee.vorname} {employee.nachname}
              </span>
              {hasConflict && (
                <AlertTriangle className="h-4 w-4 text-amber-500" />
              )}
            </label>
          );
        })}
      </div>

      {/* Show conflicts */}
      {conflicts.length > 0 && (
        <Alert variant="destructive" className="bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800">
          <AlertTriangle className="h-4 w-4 text-amber-600" />
          <AlertDescription className="text-amber-800 dark:text-amber-200">
            <p className="font-medium mb-1">Mögliche Überschneidungen:</p>
            <ul className="text-sm space-y-1">
              {conflicts.map((conflict, idx) => (
                <li key={idx}>
                  <strong>{conflict.employeeName}</strong>:{" "}
                  {conflict.existingEnd 
                    ? `${conflict.existingStart} - ${conflict.existingEnd}` 
                    : conflict.existingStart}
                </li>
              ))}
            </ul>
            <p className="text-xs mt-2">
              Die Einträge werden trotzdem erstellt. Bitte prüfen Sie die Daten.
            </p>
          </AlertDescription>
        </Alert>
      )}

      {checkingConflicts && (
        <p className="text-xs text-muted-foreground flex items-center gap-1">
          <Loader2 className="h-3 w-3 animate-spin" />
          Prüfe Überschneidungen...
        </p>
      )}
    </div>
  );
};
