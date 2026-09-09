import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Exploding Kittens',
  description: 'Online Exploding Kittens card game',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-[#1a1a2e] text-gray-100 antialiased">
        {children}
      </body>
    </html>
  );
}
