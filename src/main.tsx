import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
// Muss so früh wie möglich laufen: erfasst das 'beforeinstallprompt'-Event,
// damit die Ein-Klick-Installation (Windows/Mac/Android) zuverlässig klappt.
import "./lib/pwaInstall";
// Hält die installierte App aktuell: prüft jede Minute und beim Zurückkehren
// in die App auf eine neue Fassung und lädt sie automatisch.
import "./lib/pwaUpdate";

createRoot(document.getElementById("root")!).render(<App />);
