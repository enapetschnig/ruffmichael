// PostgREST liefert höchstens 1000 Zeilen je Anfrage. Seit dem KingBill-Import
// (1.650 Kunden, 6.600 Belege) muss jede „alles laden“-Abfrage blättern —
// sonst fehlen stillschweigend die Kunden ab „P“.
//
// Wichtig: Die Sortierung muss eindeutig sein (am Ende immer nach id), sonst
// überlappen sich die Seiten bei gleichen Werten und Zeilen erscheinen doppelt.
export async function alleZeilen<T>(
  seite: (von: number, bis: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<{ data: T[]; error: { message: string } | null }> {
  const alle: T[] = [];
  for (let von = 0; ; von += 1000) {
    const { data, error } = await seite(von, von + 999);
    if (error) return { data: alle, error };
    alle.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return { data: alle, error: null };
}
