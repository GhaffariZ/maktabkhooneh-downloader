/**
 * Explicit Demo Mode Fixtures.
 * Exposes honest sample courses and chapters for browser QA without account credentials.
 * Real media is explicitly marked unavailable in demo mode (DEMO_MEDIA_UNAVAILABLE).
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'node:url';
import { Course, Chapter, Quality } from '../../shared/types.js';

export function getDemoSamplePath(): string {
  const candidates = [
    fileURLToPath(new URL('./sample.mp4', import.meta.url)),
    path.resolve(process.cwd(), 'server/demo/sample.mp4'),
    path.resolve(process.cwd(), 'dist/server/demo/sample.mp4'),
    path.resolve(process.cwd(), 'dist/server/server/demo/sample.mp4'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return candidates[0];
}

export const DEMO_COURSES: Course[] = [
  {
    id: 'demo-python',
    title: '[داده نمایشی] مبانی برنامه‌نویسی پایتون و هوش مصنوعی',
    slug: 'demo-python-programming-mk90001',
    thumbnail: undefined,
    instructor: 'دکتر علیرضا رضایی (مدرس نمونه)',
    lessonCount: 4,
    downloadedCount: 0,
  },
  {
    id: 'demo-web-dev',
    title: '[داده نمایشی] توسعه وب پیشرفته با ری‌اکت و تایپ‌اسکریپت',
    slug: 'demo-modern-web-development-mk90002',
    thumbnail: undefined,
    instructor: 'مهندس مریم حسینی (مدرس نمونه)',
    lessonCount: 3,
    downloadedCount: 0,
  },
];

export const DEMO_CHAPTERS: Record<string, Chapter[]> = {
  'demo-python': [
    {
      id: 'demo-ch-1',
      title: 'فصل اول: آشنایی با ساختار پایتون و متغیرها',
      lessons: [
        {
          id: 'demo-unit-101',
          title: 'درس ۱: معرفی دوره و نصب محیط اجرا',
          duration: 340,
          accessible: true,
        },
        {
          id: 'demo-unit-102',
          title: 'درس ۲: انواع داده‌ها و عملگرهای محاسباتی',
          duration: 720,
          accessible: true,
        },
      ],
    },
    {
      id: 'demo-ch-2',
      title: 'فصل دوم: ساختارهای کنترلی و توابع',
      lessons: [
        {
          id: 'demo-unit-201',
          title: 'درس ۳: دستورات شرطی و حلقه‌های تکرار',
          duration: 850,
          accessible: true,
        },
        {
          id: 'demo-unit-202',
          title: 'درس ۴: تعریف توابع و پیمانه‌بندی کد',
          duration: 610,
          accessible: true,
        },
      ],
    },
  ],
  'demo-web-dev': [
    {
      id: 'demo-web-ch-1',
      title: 'فصل اول: اصول کامپوننت‌ها و تایپ‌اسکریپت',
      lessons: [
        {
          id: 'demo-web-unit-101',
          title: 'درس ۱: پیکربندی Vite و معماری پروژه',
          duration: 480,
          accessible: true,
        },
        {
          id: 'demo-web-unit-102',
          title: 'درس ۲: هوک‌های وضعیت و جریان یک‌طرفه داده‌ها',
          duration: 920,
          accessible: true,
        },
        {
          id: 'demo-web-unit-103',
          title: 'درس ۳: دسترس‌پذیری و پشتیبانی از راست‌به‌چپ (RTL)',
          duration: 540,
          accessible: true,
        },
      ],
    },
  ],
};

export const DEMO_QUALITIES: Quality[] = [
  {
    id: 'demo-720p',
    label: 'کیفیت آزمایشی (H.264)',
    bytes: 6754,
  },
];
