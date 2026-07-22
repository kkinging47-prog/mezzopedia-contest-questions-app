import type { Metadata, Viewport } from 'next';
import './globals.css';
import { APP_NAME } from '@/lib/constants';
import AdminQuickLinks from '@/components/AdminQuickLinks';
import CursorSymbolInsertGuard from '@/components/CursorSymbolInsertGuard';
import TestSubmitGuard from '@/components/TestSubmitGuard';

export const metadata: Metadata = {
  title: APP_NAME,
  description: 'Secure national mathematics contest web application for Mezzopedia.'
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  viewportFit: 'cover'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <AdminQuickLinks />
        <CursorSymbolInsertGuard />
        <TestSubmitGuard />
      </body>
    </html>
  );
}
