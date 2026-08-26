import LoginClient from './LoginClient';

// The login shell should always receive the current deployment's asset manifest.
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default function LoginPage() {
  return <LoginClient />;
}
