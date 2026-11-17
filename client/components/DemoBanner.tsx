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
        <strong>نسخه نمایشی</strong> — دوره‌ها و ویدیوهای این صفحه نمونه‌اند؛ اطلاعات حساب واقعی استفاده نمی‌شود.
      </span>
    </div>
  );
};
