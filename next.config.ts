import type { NextConfig } from 'next';

// Strict transport and content controls apply to production builds only.
// Development/Turbopack needs eval and websockets for hot reload, and the
// temporary Arena preview iframe must not be constrained by frame-ancestors.
const isProduction = process.env.NODE_ENV === 'production';

const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
  { key: 'Referrer-Policy', value: 'same-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' }
];

if (isProduction) {
  securityHeaders.push(
    // Defense-in-depth content policy: application scripts/styles are local
    // (Next.js hydration uses inline bootstrap scripts, hence unsafe-inline
    // for script/src and style/src), document previews use blob/data URLs,
    // and the pdf.js worker loads from same-origin assets.
    { key: 'Content-Security-Policy', value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "connect-src 'self'",
      "worker-src 'self' blob:",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'self'"
    ].join('; ') },
    { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' }
  );
}

const nextConfig: NextConfig = {
  allowedDevOrigins: ['*.e2b.app'],
  // tesseract.js must run from node_modules at runtime: it locates its worker
  // script and WASM core relative to its own __dirname.
  serverExternalPackages: ['@electric-sql/pglite', 'tesseract.js'],
  async headers() {
    return [
      { source: '/(.*)', headers: securityHeaders },
      { source: '/api/:path*', headers: [{ key: 'Cache-Control', value: 'private, no-store, max-age=0' }] }
    ];
  }
};

export default nextConfig;
