# کتابخانه‌ی مطالعه‌ی مکتب‌خونه · Maktabkhooneh Study Library

[دریافت نسخه](https://github.com/GhaffariZ/maktabkhooneh-downloader/releases/latest) · [راهنمای استفاده](docs/getting-started.md) · [Development](docs/development.md)

داشبورد محلی برای مرور دوره‌هایی که در مکتب‌خونه به آن‌ها دسترسی دارید. درس موردنیازتان را آنلاین تماشا کنید، همان درس را برای مطالعه‌ی آفلاین دانلود کنید و بعداً از همان نقطه ادامه دهید.

- **کتابخانه‌ی دوره‌ها** برای مرور سرفصل‌ها، جست‌وجوی درس و افزودن دوره با پیوند.
- **پخش آنلاین و آفلاین** با کنترل‌های فارسی، تنظیم سرعت پخش و نمای تمرکز.
- **دانلود انتخابی** با صف دانلود و امکان توقف، ادامه و لغو هر درس.
- **پیشرفت مطالعه** با نمایش درس‌های مشاهده‌شده، پیشرفت هر دوره و ادامه‌ی پخش از زمان ذخیره‌شده.
- **رابط فارسی و راست‌به‌چپ** با پوسته‌ی روشن و تاریک و چیدمان فشرده یا معمولی.

## شروع سریع

در Windows، macOS یا Linux به **Node.js 22 یا بالاتر** نیاز دارید. فایل Source code را از صفحه‌ی نسخه دانلود و استخراج کنید. سپس از داخل پوشه‌ی آن اجرا کنید.

```sh
npm ci
npm run build
npm start
```

مرورگر در نشانی محلی `http://127.0.0.1:3210/` باز می‌شود. برای امتحان کردن برنامه با دوره‌ها و ویدیوی نمونه، دستور `npm start -- --demo` را اجرا کنید. جزئیات ورود، استفاده‌ی آفلاین و محل ذخیره‌سازی در [راهنمای استفاده](docs/getting-started.md) آمده است.

## English

Maktabkhooneh Study Library is a local, Persian-first dashboard for courses you can access. Browse lessons, stream them, save individual videos for offline study, and resume from your last position. Download the latest source release, then run the commands above using Node.js 22 or later. [Releases](https://github.com/GhaffariZ/maktabkhooneh-downloader/releases) · [Development guide](docs/development.md)

## Credits and license

The project grew out of the [original command-line downloader](https://github.com/NabiKAZ/maktabkhooneh-downloader) by [NabiKAZ](https://github.com/NabiKAZ). The original script is available in [`download.mjs`](download.mjs). The source is distributed under [GNU GPL v3](LICENSE).
