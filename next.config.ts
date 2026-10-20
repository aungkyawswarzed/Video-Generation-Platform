import type { NextConfig } from 'next';
const config: NextConfig = {
  distDir: process.env.STUDIO_DIST_DIR || '.next',
  output: process.env.FRAME_DESKTOP_BUILD === '1' ? 'standalone' : undefined,
  outputFileTracingExcludes: {
    '/*': [
      'data/**/*',
      '.frame-e2e-data/**/*',
      '.desktop-test-data/**/*',
      '.desktop-build-cache/**/*',
      'test-results/**/*',
      'release/**/*',
      'desktop-staging/**/*',
      'node_modules/ffmpeg-static/ffmpeg.exe',
      '.env',
      '.env.*',
    ],
  },
  serverExternalPackages: ['ffmpeg-static'],
  experimental: { serverActions: { bodySizeLimit: '50mb' } },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'same-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};
export default config;
