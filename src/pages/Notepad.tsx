import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

export default function Notepad() {
  const navigate = useNavigate();

  useEffect(() => {
    // Redirect to projects page with info that notizzettel is now in projects
    navigate("/projects", { replace: true });
  }, [navigate]);

  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <p>Weiterleitung zu Projekten...</p>
    </div>
  );
}
