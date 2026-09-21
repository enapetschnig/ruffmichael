# Liest die KingBill-Datenbank (Access) fehlertolerant aus und schreibt je Tabelle eine JSON-Datei.
# Access-Dezimalfelder kommen aus access_parser als Rohbytes — werden hier entschlüsselt.
import json, struct, datetime, decimal, sys, logging
logging.disable(logging.ERROR)
from access_parser import AccessParser
import access_parser.access_parser as ap

# Fehlertolerant: eine kaputte Zeile darf nicht die ganze Tabelle verwerfen.
orig = ap.AccessTable._parse_row
def tolerant(self, record):
    laengen = {k: len(v) for k, v in self.parsed_table.items()}
    try:
        return orig(self, record)
    except Exception as e:
        # angefangene Zeile zurücknehmen, damit die Spalten gleich lang bleiben
        for k, v in self.parsed_table.items():
            del v[laengen.get(k, 0):]
        self.__dict__.setdefault("_kaputt", 0); self._kaputt += 1
ap.AccessTable._parse_row = tolerant

def dezimal(b, scale):
    if not isinstance(b, (bytes, bytearray)): return b
    if len(b) < 17: return None
    neg = b[0] & 0x80
    n = int.from_bytes(b[1:17], "little")
    v = decimal.Decimal(n) / (decimal.Decimal(10) ** scale)
    return float(-v if neg else v)

def wert(v):
    if isinstance(v, (bytes, bytearray)): return {"__dez__": v.hex()}
    if isinstance(v, datetime.datetime): return v.isoformat()
    if isinstance(v, decimal.Decimal): return float(v)
    return v

db = AccessParser("db/database/main.accdb")
TABELLEN = ["Customer", "Product", "Distributor", "Mehrwertsteuer", "DokumentText",
            "DokumentRechnung", "DokumentRechnungPosition", "DokumentAngebot", "DokumentAngebotPosition",
            "DokumentAuftrag", "DokumentAuftragPosition", "DokumentGutschrift", "DokumentGutschriftPosition",
            "Payment", "Eingangsrechnung", "EingangsrechnungZahlung", "EingangsrechnungSkonto",
            "EingangsrechnungRechnungsart", "PayReminderLog", "Setting"]
stat = {}
for name in TABELLEN:
    t = db.parse_table(name)
    keys = list(t.keys()); n = len(t[keys[0]]) if keys else 0
    zeilen = [{k: wert(t[k][i]) for k in keys} for i in range(n)]
    with open(f"json/{name}.json", "w", encoding="utf-8") as f: json.dump(zeilen, f, ensure_ascii=False)
    # Zähler kaputter Zeilen aus dem TableObj holen geht nicht mehr — wir vergleichen mit ID-Lücken später
    stat[name] = n
    print(f"{n:7d}  {name}")
json.dump(stat, open("json/_stat.json", "w"))

# Dezimal-Skala bestimmen: Eingangsrechnung.BetragBrutto gegen Summe der Zahlungen
er = json.load(open("json/Eingangsrechnung.json")); zahl = json.load(open("json/EingangsrechnungZahlung.json"))
summe = {}
for z in zahl:
    b = z["Betrag"]; b = dezimal(bytes.fromhex(b["__dez__"]), 0) if isinstance(b, dict) else b
    summe[z["ID_Eingangsrechnung"]] = summe.get(z["ID_Eingangsrechnung"], 0) + (float(b) if b else 0)
print("\nZahlung.Betrag Typ:", type(zahl[0]["Betrag"]).__name__, zahl[0]["Betrag"])
for scale in (2, 4, 5, 6):
    treffer = 0; probe = 0
    for e in er:
        if e["Bezahlt"] and e["ID"] in summe and isinstance(e["BetragBrutto"], dict):
            probe += 1
            v = dezimal(bytes.fromhex(e["BetragBrutto"]["__dez__"]), scale)
            if abs(v - summe[e["ID"]]) < 0.02: treffer += 1
    print(f"Skala {scale}: {treffer}/{probe} bezahlte Eingangsrechnungen stimmen mit den Zahlungen überein")
