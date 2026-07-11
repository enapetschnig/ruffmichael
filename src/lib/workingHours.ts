export interface WorkTimePreset {
  startTime: string;
  endTime: string;
  pauseStart: string;
  pauseEnd: string;
  pauseMinutes: number;
  totalHours: number;
}

/**
 * Gibt die Normalarbeitszeit für einen Tag zurück
 * Mo-Do: 8.5h, Fr: 4.5h (ohne Überstunde), Sa-So: 0h
 */
export function getNormalWorkingHours(date: Date): number {
  const dayOfWeek = date.getDay();
  
  // Wochenende
  if (dayOfWeek === 0 || dayOfWeek === 6) return 0;
  
  // Montag - Donnerstag: 8.5 Stunden
  if (dayOfWeek >= 1 && dayOfWeek <= 4) return 8.5;
  
  // Freitag: 4.5 Stunden (ohne die 0.5h Überstunde)
  if (dayOfWeek === 5) return 4.5;
  
  return 0;
}

/**
 * Gibt die Freitags-Überstunde zurück (0.5h für ZA)
 */
export function getFridayOvertime(date: Date): number {
  return date.getDay() === 5 ? 0.5 : 0;
}

/**
 * Gibt die tatsächlichen Arbeitsstunden für Freitag zurück (inkl. Überstunde)
 * Mo-Do: 8.5h, Fr: 5.0h (inkl. 0.5h Überstunde), Sa-So: 0h
 */
export function getTotalWorkingHours(date: Date): number {
  const dayOfWeek = date.getDay();
  
  // Wochenende
  if (dayOfWeek === 0 || dayOfWeek === 6) return 0;
  
  // Montag - Donnerstag: 8.5 Stunden
  if (dayOfWeek >= 1 && dayOfWeek <= 4) return 8.5;
  
  // Freitag: 5.0 Stunden (inkl. 0.5h Überstunde)
  if (dayOfWeek === 5) return 5.0;
  
  return 0;
}

/**
 * Gibt die Sollstunden für eine Woche zurück: 39 Stunden
 */
export function getWeeklyTargetHours(): number {
  return 39;
}

/**
 * Gibt Standard-Arbeitszeiten für einen Tag zurück
 */
export function getDefaultWorkTimes(date: Date): WorkTimePreset | null {
  const dayOfWeek = date.getDay();
  
  // Wochenende
  if (dayOfWeek === 0 || dayOfWeek === 6) return null;
  
  // Montag - Donnerstag: 07:00 - 16:00, Pause 12:00 - 12:30
  if (dayOfWeek >= 1 && dayOfWeek <= 4) {
    return {
      startTime: "07:00",
      endTime: "16:00",
      pauseStart: "12:00",
      pauseEnd: "12:30",
      pauseMinutes: 30,
      totalHours: 8.5
    };
  }
  
  // Freitag: 07:00 - 12:00, keine Pause
  if (dayOfWeek === 5) {
    return {
      startTime: "07:00",
      endTime: "12:00",
      pauseStart: "",
      pauseEnd: "",
      pauseMinutes: 0,
      totalHours: 5.0
    };
  }
  
  return null;
}

/**
 * Prüft ob ein Tag ein arbeitsfreier Tag ist (nur Wochenende)
 */
export function isNonWorkingDay(date: Date): boolean {
  const dayOfWeek = date.getDay();
  
  // Nur Wochenende ist arbeitsfrei
  return dayOfWeek === 0 || dayOfWeek === 6;
}
