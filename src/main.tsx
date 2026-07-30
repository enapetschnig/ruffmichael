import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
// Muss so früh wie möglich laufen: erfasst das 'beforeinstallprompt'-Event,
// damit die Ein-Klick-Installation (Windows/Mac/Android) zuverlässig klappt.
import "./lib/pwaInstall";

createRoot(document.getElementById("root")!).render(<App />);
