import { ArrowLeft } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";

interface PageHeaderProps {
  title?: string;
  showBackButton?: boolean;
  backPath?: string;
}

export function PageHeader({ title, showBackButton = true, backPath }: PageHeaderProps) {
  const navigate = useNavigate();

  const handleBack = () => {
    if (backPath) {
      navigate(backPath);
    } else {
      navigate(-1);
    }
  };

  return (
    <header className="border-b bg-card sticky top-0 z-50 shadow-sm">
      <div className="container mx-auto px-3 sm:px-4 lg:px-6 py-3 sm:py-4">
        <div className="flex items-center gap-2 sm:gap-4">
          {showBackButton && (
            <Button variant="ghost" size="sm" onClick={handleBack}>
              <ArrowLeft className="h-4 w-4 sm:mr-2" />
              <span className="hidden sm:inline">Zurück</span>
            </Button>
          )}
          <img 
            src="/ruff-logo.png"
            alt="Ruff Michael Logo"
            className="h-8 w-8 sm:h-10 sm:w-10 cursor-pointer hover:opacity-80 transition-opacity object-contain" 
            onClick={() => navigate("/")}
          />
          {title && (
            <h1 className="text-lg sm:text-2xl font-bold truncate">{title}</h1>
          )}
        </div>
      </div>
    </header>
  );
}
