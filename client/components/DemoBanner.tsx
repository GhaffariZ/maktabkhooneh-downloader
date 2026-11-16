import React from 'react';
import { AlertCircle } from 'lucide-react';

interface DemoBannerProps {
  isDemo: boolean;
}

export const DemoBanner: React.FC<DemoBannerProps> = ({ isDemo }) => {
  if (!isDemo) return null;

  return (
    <div className="demo-banner" role="status" aria-live="polite">
      <AlertCircle size={18} aria-hidden="true" />
      <span>
        <strong>حالت نمایشی فعال است:</strong> اطلاعات نمایش داده شده صرفاً نمونه‌های تستی هستند و اطلاعات واقعی حساب یا ویدیوهای دوره بارگیری نمی‌شوند.
      </span>
    </div>
  );
};
