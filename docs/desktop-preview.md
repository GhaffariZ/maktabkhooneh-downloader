# راه‌اندازی نسخه‌ی آزمایشی دسکتاپ · Desktop preview

## ویندوز

۱. فایل ZIP را کامل استخراج کنید.

۲. در پوشه‌ی استخراج‌شده، روی **Maktabkhooneh Study Library.exe** دوبار کلیک کنید. داشبورد در مرورگر پیش‌فرض باز می‌شود.

۳. پنجره‌ی کوچک برنامه را باز یا کوچک‌شده نگه دارید. دکمه‌ی **Quit** سرور محلی را متوقف می‌کند.

## اوبونتو و دبیان

فایل `.deb` را با نصب‌کننده‌ی بسته‌ی سیستم باز کنید. سپس **Maktabkhooneh Study Library** را از فهرست برنامه‌ها اجرا کنید. برای خروج، در پنجره‌ی وضعیت روی **Quit** بزنید.

## مک

فایل ZIP را استخراج کنید و **Maktabkhooneh Study Library.app** را باز کنید. بسته‌ی آزمایشی مک به امضا و تأیید اپل برای انتشار عمومی نیاز دارد.

بسته‌ها Node.js را همراه خود دارند. اگر قبلاً داشبورد را روی پورت ۳۲۱۰ اجرا کرده‌اید، ابتدا اجرای قبلی را متوقف کنید.

## English

- **Windows x64:** Extract the whole ZIP and double-click **Maktabkhooneh Study Library.exe**.
- **Ubuntu or Debian:** Open the `.deb` in your package installer, then launch **Maktabkhooneh Study Library** from the app menu. The package installer handles `zenity` and `xdg-utils`.
- **macOS:** Extract the ZIP and open **Maktabkhooneh Study Library.app**. The preview needs signing and notarization for general distribution.

The launcher starts the local server and opens the dashboard in your default browser. Keep the status window open or minimized while studying and click **Quit** when you're done. Close any previous dashboard on port 3210 before opening the preview. Sign in in the preview to load your course library.

The session and download list are stored under `Maktabkhooneh Study Library/data` in your platform’s user data directory. Windows uses `%LOCALAPPDATA%`, macOS uses `~/Library/Application Support`, and Linux uses `$XDG_DATA_HOME` or `~/.local/share`.
