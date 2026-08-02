/** @type {import('next').NextConfig} */
const isOneDriveWorkspace =
  process.platform === "win32" && /\\OneDrive(?: - [^\\]+)?\\/i.test(process.cwd());

const nextConfig = {
  // OneDrive marks synced output files as reparse points. Next's file tracing can
  // then fail with EINVAL/readlink while compiling its fallback error components.
  // A separate generated directory avoids the stale, synced .next tree.
  distDir: process.env.NEXT_DIST_DIR || (isOneDriveWorkspace ? "next-local-cache" : ".next"),
  reactStrictMode: true,
  experimental: {
    cpus: 1
  }
};

export default nextConfig;
