import { crawls, projects } from '@raisin/db';
import { Button } from '@raisin/ui/button';
import { cn } from '@raisin/ui/lib/utils';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@raisin/ui/tooltip';
import { desc, eq } from 'drizzle-orm';
import {
  FolderKanban,
  LogOut,
  type LucideIcon,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Settings,
} from 'lucide-react';
import { type ReactElement, useState } from 'react';
import { Form, Link, Outlet, useLocation, useSubmit } from 'react-router';
import { Logo } from '~/components/common';
import { ProjectSwitcher } from '~/components/project-switcher';
import { db } from '~/lib/env.server';
import { getPlan } from '~/lib/plans.server';
import { requireMember } from '~/lib/session.server';
import { PREFS, readPref, writePref } from '~/lib/ui-prefs';
import type { Route } from './+types/app-layout';

export async function loader({ request }: Route.LoaderArgs) {
  const m = await requireMember(request);
  const database = db();
  const [plan, projectRows, recent] = await Promise.all([
    getPlan(m.orgId),
    database
      .select({ id: projects.id, name: projects.name, host: projects.host })
      .from(projects)
      .where(eq(projects.organizationId, m.orgId))
      .orderBy(projects.name),
    database
      .select({ id: crawls.id, projectId: crawls.projectId })
      .from(crawls)
      .where(eq(crawls.organizationId, m.orgId))
      .orderBy(desc(crawls.createdAt))
      .limit(500),
  ]);
  const latest = new Map<string, string>();
  for (const c of recent) if (!latest.has(c.projectId)) latest.set(c.projectId, c.id);
  return {
    user: { name: m.user.name, email: m.user.email },
    orgId: m.orgId,
    orgName: m.orgName,
    orgs: m.orgs,
    plan: plan.name,
    collapsed: readPref(request, PREFS.sidebar) === 'collapsed',
    switcher: projectRows.map((p) => ({ ...p, latestCrawlId: latest.get(p.id) ?? null })),
  };
}

const NAV = [
  { to: '/app', label: 'Projects', icon: FolderKanban },
  { to: '/app/settings', label: 'Settings', icon: Settings },
];

/**
 * The sidebar is a 224px column, or a 56px icon rail when collapsed. Below `md` it is always the
 * rail, so the crawl grid keeps its width on small screens. Labels stay in the accessibility
 * tree either way.
 */
export default function AppLayout({ loaderData }: Route.ComponentProps) {
  const { pathname } = useLocation();
  const submit = useSubmit();
  const [collapsed, setCollapsed] = useState(loaderData.collapsed);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  // Projects, project pages and crawl pages all live under Projects.
  const section = pathname.startsWith('/app/settings') ? '/app/settings' : '/app';
  const toggle = () => {
    writePref(PREFS.sidebar, collapsed ? 'expanded' : 'collapsed');
    setCollapsed(!collapsed);
  };
  // Hidden when collapsed, and below `md` where the rail is forced.
  const label = cn(collapsed ? 'sr-only' : 'max-md:sr-only');

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex h-dvh">
        <aside
          className={cn(
            'flex shrink-0 flex-col border-r bg-card transition-[width] duration-200',
            collapsed ? 'w-14' : 'w-14 md:w-56',
          )}
        >
          <div className="flex h-14 items-center px-4">
            <Link to="/app" aria-label="Raisin projects" className="rounded-md">
              <Logo className={cn(collapsed ? '[&>span]:sr-only' : 'max-md:[&>span]:sr-only')} />
            </Link>
          </div>
          <div className={cn('mx-3 mb-2', collapsed ? 'hidden' : 'max-md:hidden')}>
            {loaderData.orgs.length > 1 ? (
              <Form
                method="post"
                action="/app/switch-org"
                onChange={(e) => submit(e.currentTarget)}
                className="rounded-md border px-3 py-2 focus-within:ring-[3px] focus-within:ring-ring"
              >
                <label htmlFor="org" className="sr-only">
                  Organization
                </label>
                <select
                  id="org"
                  name="orgId"
                  defaultValue={loaderData.orgId}
                  className="w-full truncate bg-transparent text-sm font-medium outline-none"
                >
                  {loaderData.orgs.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-muted-foreground">{loaderData.plan} plan</p>
              </Form>
            ) : (
              <div className="px-2.5 py-1">
                <p className="truncate text-sm font-medium">{loaderData.orgName}</p>
                <p className="text-xs text-muted-foreground">{loaderData.plan} plan</p>
              </div>
            )}
          </div>
          <nav aria-label="Main" className="mt-2 grid gap-0.5 px-2">
            <RailTip label="Jump to project (⌘K)" enabled={collapsed}>
              <button
                type="button"
                onClick={() => setSwitcherOpen(true)}
                aria-keyshortcuts="Meta+K Control+K"
                className="mb-1 flex h-8 items-center gap-2 rounded-md border px-2.5 text-sm text-muted-foreground outline-none hover:bg-accent hover:text-accent-foreground focus-visible:ring-[3px] focus-visible:ring-ring max-md:border-transparent"
              >
                <NavIcon icon={Search} />
                <span className={cn(label, 'flex-1 text-left')}>Jump to project</span>
                <kbd className={cn(label, 'font-mono text-xs')}>⌘K</kbd>
              </button>
            </RailTip>
            {NAV.map(({ to, label: text, icon }) => (
              <RailTip key={to} label={text} enabled={collapsed}>
                <Link
                  to={to}
                  aria-current={section === to ? 'page' : undefined}
                  className={cn(
                    'flex h-8 items-center gap-2 rounded-md px-2.5 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                    section === to && 'bg-accent font-medium text-accent-foreground',
                  )}
                >
                  <NavIcon icon={icon} />
                  <span className={label}>{text}</span>
                </Link>
              </RailTip>
            ))}
          </nav>
          <div className="mt-auto grid gap-1 border-t p-2">
            <div className={cn('px-1.5 pt-1', collapsed ? 'hidden' : 'max-md:hidden')}>
              <p className="truncate text-sm font-medium">{loaderData.user.name}</p>
              <p className="truncate text-xs text-muted-foreground">{loaderData.user.email}</p>
            </div>
            <Form method="post" action="/logout">
              <RailTip label="Sign out" enabled={collapsed}>
                <Button
                  type="submit"
                  variant="ghost"
                  size="sm"
                  className="w-full justify-start px-2.5"
                >
                  <LogOut />
                  <span className={label}>Sign out</span>
                </Button>
              </RailTip>
            </Form>
            <RailTip label="Expand sidebar" enabled={collapsed}>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={toggle}
                aria-expanded={!collapsed}
                className="w-full justify-start px-2.5 text-muted-foreground max-md:hidden"
              >
                {collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
                <span className={label}>{collapsed ? 'Expand sidebar' : 'Collapse sidebar'}</span>
              </Button>
            </RailTip>
          </div>
        </aside>
        <main className="min-w-0 flex-1 overflow-auto">
          <Outlet />
        </main>
        <ProjectSwitcher
          projects={loaderData.switcher}
          open={switcherOpen}
          onOpenChange={setSwitcherOpen}
        />
      </div>
    </TooltipProvider>
  );
}

function NavIcon({ icon: Icon }: { icon: LucideIcon }) {
  return <Icon className="size-4 shrink-0" aria-hidden />;
}

/** On the collapsed rail, names each icon in a tooltip; otherwise renders the child as is. */
function RailTip({
  label,
  enabled,
  children,
}: {
  label: string;
  enabled: boolean;
  children: ReactElement;
}) {
  if (!enabled) return children;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}
