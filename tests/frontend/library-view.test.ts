import { test } from "node:test";
import assert from "node:assert/strict";
import { courseActivity, searchText } from "../../client/utils/libraryView";
test("Persian course search normalizes Arabic characters and joining spaces", () => {
  assert.equal(searchText("  ري‌اكت  "), searchText("ری اکت"));
  assert.equal(searchText("كتاب"), searchText("کتاب"));
});
test("course summaries isolate courses and keep unknown totals unknown", () => {
  const progress = {
    a: {
      courseId: "a",
      lessonId: "one",
      lessonTitle: "One",
      position: 40,
      completed: true,
      updatedAt: 10,
    },
    b: {
      courseId: "b",
      lessonId: "two",
      lessonTitle: "Two",
      position: 80,
      completed: true,
      updatedAt: 30,
    },
  };
  assert.deepEqual(
    courseActivity(
      { id: "a", title: "A", slug: "a", lessonCount: 2 },
      progress,
    ),
    {
      watched: 1,
      started: true,
      completed: false,
      updatedAt: 10,
      percent: 50,
    },
  );
  assert.equal(
    courseActivity({ id: "a", title: "A", slug: "a" }, progress).percent,
    null,
  );
  assert.equal(
    courseActivity({ id: "a", title: "A", slug: "a", lessonCount: 1 }, progress)
      .completed,
    true,
  );
});
