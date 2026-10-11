import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@raisin/ui/dialog';
import { cn } from '@raisin/ui/lib/utils';
import { Search } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';

export type SwitcherProject = {
  id: string;
  name: string;
  host: string;
  latestCrawlId: string | null;
};

/**
 * ⌘K / Ctrl+K: jump to any project, or straight to its latest crawl. Enter opens the latest
 * crawl (the project if it has none); ⌘/Ctrl+Enter opens the project. Built on the dialog
 * primitive as an ARIA combobox, so the list is announced as the filter narrows it.
 */
export function ProjectSwitcher({
  projects,
  open,
  onOpenChange,
}: {
  projects: SwitcherProject[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const navigate = useNavigate();
  const listId = useId();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'k' && (e.metaKey || e.ctrlKey) && !e.altKey) {
        e.preventDefault();
        onOpenChange(!open);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onOpenChange]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return projects;
    return projects.filter(
      (p) => p.name.toLowerCase().includes(q) || p.host.toLowerCase().includes(q),
    );
  }, [projects, query]);

  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    list.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const go = (p: SwitcherProject | undefined, toProject: boolean) => {
    if (!p) return;
    onOpenChange(false);
    setQuery('');
    navigate(
      !toProject && p.latestCrawlId ? `/app/crawls/${p.latestCrawlId}` : `/app/projects/${p.id}`,
    );
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => Math.min(matches.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      go(matches[active], e.metaKey || e.ctrlKey);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) setQuery('');
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="top-[20%] translate-y-0 gap-0 p-0 sm:max-w-lg"
      >
        <DialogTitle className="sr-only">Jump to a project</DialogTitle>
        <DialogDescription className="sr-only">
          Type to filter projects. Enter opens the latest crawl; Command or Control plus Enter opens
          the project.
        </DialogDescription>
        <div className="flex items-center gap-2 border-b px-3">
          <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <input
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={matches[active] ? `${listId}-${active}` : undefined}
            aria-autocomplete="list"
            aria-label="Project name or host"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Jump to a project…"
            className="h-11 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>
        <div
          ref={list}
          id={listId}
          role="listbox"
          aria-label="Projects"
          className="max-h-80 overflow-auto p-1.5"
        >
          {matches.map((p, i) => (
            // biome-ignore lint/a11y/useKeyWithClickEvents: the combobox input owns the keyboard; options are pointer targets.
            <div
              key={p.id}
              id={`${listId}-${i}`}
              role="option"
              tabIndex={-1}
              aria-selected={i === active}
              data-index={i}
              onMouseMove={() => setActive(i)}
              onClick={(e) => go(p, e.metaKey || e.ctrlKey)}
              className={cn(
                'flex cursor-default items-center gap-3 rounded-md px-2.5 py-2 text-sm',
                i === active && 'bg-accent text-accent-foreground',
              )}
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{p.name}</span>
                <span className="block truncate font-mono text-xs text-muted-foreground">
                  {p.host}
                </span>
              </span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {p.latestCrawlId ? 'Latest crawl' : 'Project'}
              </span>
            </div>
          ))}
        </div>
        {matches.length === 0 && (
          <p role="status" className="px-2.5 py-6 text-center text-sm text-muted-foreground">
            {projects.length === 0 ? 'No projects yet.' : `No project matches “${query.trim()}”.`}
          </p>
        )}
        <p className="border-t px-3 py-2 text-xs text-muted-foreground">
          <kbd className="font-mono">↵</kbd> latest crawl · <kbd className="font-mono">⌘↵</kbd>{' '}
          project · <kbd className="font-mono">Esc</kbd> close
        </p>
      </DialogContent>
    </Dialog>
  );
}
