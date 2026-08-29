import { redirect } from 'next/navigation';
import PortalClient from './PortalClient';
import { currentUser } from '@/lib/auth';

// Keep the authenticated portal shell out of long-lived CDN/Hostinger HTML
// caches. This prevents stale HTML from pointing at chunks removed by a later
// deployment and eliminates the first-load/reload race on mobile.
export const dynamic = 'force-dynamic';
export const revalidate = 0;

type PortalPageProps = {
  searchParams: Promise<{ auth?: string | string[] | undefined }>;
};

export default async function PortalPage({ searchParams }: PortalPageProps) {
  const params = await searchParams;
  const previewToken = typeof params.auth === 'string' ? params.auth : null;
  const user = await currentUser(previewToken);

  // Never render the private workspace before a real session has been
  // verified. In the past /portal rendered first and only then showed a
  // confusing "Session could not be verified" toast, which made it look as
  // though the site had opened without login.
  if (!user) redirect('/');

  return <PortalClient />;
}
