import type { Metadata, Viewport } from 'next';
import './globals.css';
import { APP_NAME } from '@/lib/constants';
import AdminQuickLinks from '@/components/AdminQuickLinks';
import AssignPaidStageOneQuickAction from '@/components/AssignPaidStageOneQuickAction';
import AutoRefreshOnUpdate from '@/components/AutoRefreshOnUpdate';
import CursorSymbolInsertGuard from '@/components/CursorSymbolInsertGuard';
import RobustTestSubmitGuard from '@/components/RobustTestSubmitGuard';
import TimedOutFinalSubmitGuard from '@/components/TimedOutFinalSubmitGuard';
import MobileProctoringStartGuard from '@/components/MobileProctoringStartGuard';
import ResultsPromotionBanner from '@/components/ResultsPromotionBanner';
import LiveFinalsVisibilityControl from '@/components/LiveFinalsVisibilityControl';

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
        <AssignPaidStageOneQuickAction />
        <AutoRefreshOnUpdate />
        <CursorSymbolInsertGuard />
        <RobustTestSubmitGuard />
        <TimedOutFinalSubmitGuard />
        <MobileProctoringStartGuard />
        <ResultsPromotionBanner />
        <LiveFinalsVisibilityControl />
      </body>
    </html>
  );
}
