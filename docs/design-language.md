# Study Library UI v3

The interface follows a personal study desk. Course content, the next study action, and actual progress form the visual hierarchy. Persian is the primary language, with mixed-language course titles and LTR media controls.

## Color and type

The shared theme lives in client/styles/ui-v3.css and loads after the foundation stylesheet.

| Role | Light | Dark |
| --- | --- | --- |
| Canvas | #f4f6f9 | #131922 |
| Surface | #ffffff | #1b2430 |
| Primary text | #172638 | #e8edf5 |
| Secondary text | #506178 | #bac6d6 |
| Action | #2859b9 | #9bbcff |
| Divider | #dce3ec | #334255 |

Vazirmatn is bundled locally. Page headings use a fluid 24–34px scale, course titles use 15px with generous line height, and metadata stays secondary. Status labels carry meaning alongside color. The study feature uses a slate-blue surface with a typographic book composition.

## Components and layout

The desktop navigation occupies 220px. Main content is fluid, with a resume/start feature, progress summary, filter tabs, search and sorting controls, and course cards. Card covers use actual course thumbnails when available and a title-based fallback otherwise.

Controls use 8px corners, cards 12px, and major surfaces 16px. Navigation, dialogs, download tables, notes, and the Video.js skin share the theme tokens. Interactive states include visible focus rings and pressed state indicators.

At 1100px the overview becomes a single column. At 768px navigation becomes a header and bottom dock. At 480px controls stack and the decorative book is hidden. Logical spacing properties support RTL. Mobile controls have 44px targets and safe-area spacing. Card content uses container queries. Reduced-motion preference disables animation and transitions.

## Study features

- Bookmarks persist in local browser storage, separated between demo and real sessions.
- Library filters show started, bookmarked, downloaded, or completed courses.
- Sorting supports recent study, title, and completion percentage.
- Grid and list views use the same course actions.
- Search normalizes Arabic and Persian letter variants and joining spaces.
- Summary counts come from course metadata and recorded lesson progress.
- Lesson notes save in local browser storage, separated by session scope, course, and lesson. Notes can be exported as text files. A storage error is shown if saving fails.
- Download search and status filters narrow the existing queue.

Notes and bookmarks belong to this browser origin. They do not sync between devices or ports. Note fields accept up to 50,000 characters.

## Verification

Run npm run typecheck, npm test, npm run build, and git diff --check. The library-view regression tests cover Persian search normalization and course-specific completion counts, including unknown totals.

Use demo mode for visual checks. Check both themes, phone and desktop layouts, keyboard focus, long course names, bookmarks, notes, playback, and queue actions. Physical phone testing and real-account playback require separate verification.

The design work used the installed Responsive Design skill and the current official Anthropic Frontend Design skill. Skill availability is refreshed on the next Codex turn.
