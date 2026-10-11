import { index, layout, type RouteConfig, route } from '@react-router/dev/routes';

export default [
  index('routes/home.tsx'),
  route('bot', 'routes/bot.tsx'),
  route('login', 'routes/login.tsx'),
  route('signup', 'routes/signup.tsx'),
  route('logout', 'routes/logout.tsx'),
  route('invite/:invitationId', 'routes/invite.tsx'),
  route('app/switch-org', 'routes/switch-org.ts'),
  route('app/billing', 'routes/billing.ts'),
  layout('routes/app-layout.tsx', [
    route('app', 'routes/app-index.tsx'),
    route('app/projects/new', 'routes/project-new.tsx'),
    route('app/projects/:projectId', 'routes/project.tsx'),
    route('app/crawls/:crawlId', 'routes/crawl.tsx'),
    route('app/settings', 'routes/settings.tsx'),
  ]),
  // Resource routes used by the crawl view.
  route('app/crawls/:crawlId/url/:urlId', 'routes/crawl-url.ts'),
  route('app/crawls/:crawlId/export', 'routes/crawl-export.ts'),
  route('app/crawls/:crawlId/object', 'routes/crawl-object.ts'),
  route('app/crawls/:crawlId/suggest', 'routes/crawl-suggest.ts'),
] satisfies RouteConfig;
