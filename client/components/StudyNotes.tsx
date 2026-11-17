import { useState } from "react";
import { Download, NotebookPen } from "lucide-react";

export function StudyNotes({
  courseId,
  lessonId,
  title,
  scope,
}: {
  courseId: string;
  lessonId: string;
  title: string;
  scope: "demo" | "real";
}) {
  const key = "mk_notes_v3_" + JSON.stringify([scope, courseId, lessonId]);
  const [text, setText] = useState(() => {
    try {
      return localStorage.getItem(key) || "";
    } catch {
      return "";
    }
  });
  const [error, setError] = useState(false);
  const save = (value: string) => {
    setText(value);
    try {
      localStorage.setItem(key, value);
      setError(false);
    } catch {
      setError(true);
    }
  };
  const exportNote = () => {
    const blob = new Blob([title + "\n\n" + text], {
      type: "text/plain;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "study-note.txt";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <section className="study-notes">
      <h2>
        <NotebookPen size={18} aria-hidden="true" /> یادداشت این درس
      </h2>
      <p>{title}</p>
      <textarea
        aria-label="یادداشت این درس"
        placeholder="نکته‌ای که می‌خواهی یادت بماند…"
        value={text}
        onChange={(event) => save(event.target.value)}
        maxLength={50000}
      />
      <div className="notes-footer">
        <span role="status">
          {error
            ? "ذخیره نشد؛ برای نگهداری یادداشت، فایل آن را دریافت کن."
            : "ذخیره خودکار در همین مرورگر"}{" "}
          · {text.length.toLocaleString("fa")} / ۵۰٬۰۰۰
        </span>
        <button
          className="btn btn-ghost btn-sm"
          onClick={exportNote}
          disabled={!text}
        >
          <Download size={15} />
          دریافت یادداشت
        </button>
      </div>
    </section>
  );
}
