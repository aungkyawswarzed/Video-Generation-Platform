import type { Metadata } from 'next';
import './globals.css';
import './studio-modes.css';
export const metadata: Metadata = {
  title: 'Frame — AI film studio',
  description: 'Your story. Every scene. An OpenRouter-powered video production studio.',
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
