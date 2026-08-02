import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Search, Settings, PlusCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { LoginArea } from '@/components/auth/LoginArea';
import { SubmitToIndex } from '@/components/SubmitToIndex';
import { cn } from '@/lib/utils';

interface LayoutProps {
  children: React.ReactNode;
  /** When true, the layout uses a minimal header (for the home search page). */
  minimal?: boolean;
}

export function Layout({ children, minimal = false }: LayoutProps) {
  const location = useLocation();
  const isHome = location.pathname === '/';
  const [submitOpen, setSubmitOpen] = useState(false);

  return (
    <div className="min-h-screen flex flex-col bg-background">
      {/* Header */}
      <header className={cn(
        'sticky top-0 z-40 border-b border-border/50 backdrop-blur-xl bg-background/80',
        minimal && 'border-transparent bg-transparent backdrop-blur-none',
      )}>
        <div className="container flex items-center justify-between h-14 gap-4">
          <Link to="/" className="flex items-center gap-2.5 shrink-0 group">
            <div className="relative flex items-center justify-center w-8 h-8 rounded-lg bg-primary/10 border border-primary/20 group-hover:border-primary/40 transition-colors">
              <Search className="w-4 h-4 text-primary" />
            </div>
            <span className="font-semibold text-lg tracking-tight">
              <span className="text-primary font-mono">0x</span>
              <span className="text-foreground">Searchstr</span>
            </span>
          </Link>

          <nav className="flex items-center gap-1">
            {!isHome && (
              <Button variant="ghost" size="sm" asChild className="text-muted-foreground hover:text-foreground">
                <Link to="/">
                  <Search className="w-4 h-4 mr-1.5" />
                  Search
                </Link>
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSubmitOpen(true)}
              className="text-muted-foreground hover:text-foreground"
              aria-label="Submit a link to the community index"
            >
              <PlusCircle className="w-4 h-4 sm:mr-1.5" />
              <span className="hidden sm:inline">Submit</span>
            </Button>
            <Button
              variant="ghost"
              size="icon"
              asChild
              className="h-8 w-8 text-muted-foreground hover:text-foreground"
            >
              <Link to="/settings" aria-label="Settings">
                <Settings className="w-4 h-4" />
              </Link>
            </Button>

            <LoginArea className="max-w-48" />
          </nav>
        </div>
      </header>

      {/* Main content */}
      <main className="flex-1">
        {children}
      </main>

      {/* Footer */}
      <footer className="border-t border-border/50 py-6">
        <div className="container flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-muted-foreground">
          <div className="flex items-center gap-2">
            <span className="font-mono text-primary/70">0x</span>
            <span>Searchstr</span>
            <span className="text-border">|</span>
            <span>Decentralized search aggregator</span>
          </div>
          <div className="flex items-center gap-4">
            <Link to="/explore" className="hover:text-foreground transition-colors">Explore</Link>
            <Link to="/policy" className="hover:text-foreground transition-colors">Content Policy</Link>
            <Link to="/about" className="hover:text-foreground transition-colors">About</Link>
            <a
              href="https://shakespeare.diy"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-foreground transition-colors"
            >
              Vibed with Shakespeare
            </a>
          </div>
        </div>
      </footer>

      {/* Community index submission dialog */}
      <SubmitToIndex open={submitOpen} onOpenChange={setSubmitOpen} />
    </div>
  );
}
