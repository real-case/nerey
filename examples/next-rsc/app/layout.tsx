import type { ReactElement, ReactNode } from 'react';

// AC-15 — the theme is two static stylesheets. No CSS Modules configuration, no transpilePackages:
// Next handles a plain `.css` import from node_modules out of the box, and that is all these are.
import '@nerey/theme/tokens.css';
import '@nerey/theme/theme.css';
import './example.css';

export const metadata = {
  title: 'Nerey — Next.js RSC example',
  description: 'The registry described on the server, widgets rendered on the client.',
};

export default function RootLayout({ children }: { children: ReactNode }): ReactElement {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
