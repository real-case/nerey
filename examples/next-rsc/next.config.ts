import type { NextConfig } from 'next';

/**
 * Deliberately empty of Nerey. No `transpilePackages`, no CSS Modules rule for node_modules, no
 * alias: the packages are consumed exactly as published (AC-2, AC-15), and a setting added here to
 * make them work would be a packaging bug hidden in an example.
 */
const config: NextConfig = {};

export default config;
