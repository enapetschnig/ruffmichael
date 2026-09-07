import { Link, useLocation } from "react-router-dom";
import { useEffect } from "react";

const NotFound = () => {
  const location = useLocation();

  useEffect(() => {
    console.error("404 Error: User attempted to access non-existent route:", location.pathname);
  }, [location.pathname]);

  return (
    <div className="kb-page flex min-h-screen items-center justify-center p-4">
      <div className="kb-panel p-8 text-center">
        <h1 className="mb-4 text-4xl font-bold">404</h1>
        <p className="mb-4 text-lg text-muted-foreground">Diese Seite wurde nicht gefunden.</p>
        <Link to="/" className="kb-btn justify-center">Zum Hauptmenü</Link>
      </div>
    </div>
  );
};

export default NotFound;
