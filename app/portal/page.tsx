import PortalClient from './PortalClient';

// Keep the authenticated portal shell out of long-lived CDN/Hostinger HTML
// caches. This prevents stale HTML from pointing at chunks removed by a later
// deployment and eliminates the first-load/reload race on mobile.
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default function PortalPage() {
  return <PortalClient />;
}
