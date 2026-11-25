if (process.env.VERCEL_ENV === 'production' || process.env.VERCEL_GIT_COMMIT_REF === 'main') {
  throw new Error('The isolated receiving review branch must never be deployed to production.');
}
module.exports = {
  reactStrictMode: true,
  async headers() {
    return [{ source: '/:path*', headers: [
      { key: 'Content-Security-Policy', value: "connect-src 'self' blob:; form-action 'self'; object-src 'none'; frame-src 'self' blob:; base-uri 'self'" },
      { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
    ] }];
  },
};
