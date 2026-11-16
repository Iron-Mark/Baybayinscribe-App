import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Calendar } from "../components/ui/calendar";

test("DayPicker v9 renders navigation and styles the selected day cell", () => {
  const html = renderToStaticMarkup(React.createElement(Calendar, {
    mode: "single",
    defaultMonth: new Date(2026, 10, 1),
    selected: new Date(2026, 10, 15),
  }));
  assert.match(html, /lucide-chevron-left/);
  assert.match(html, /lucide-chevron-right/);
  assert.match(html, /November 2026/);
  const selectedCell = html.match(/<td[^>]*data-day="2026-11-15"[^>]*>/)?.[0];
  assert.ok(selectedCell);
  assert.match(selectedCell, /aria-selected="true"/);
  assert.match(selectedCell, /aria-selected:rounded-md/);
  assert.doesNotMatch(html, /:has\(/);
  assert.match(html, /<button[^>]*size-8 p-0 font-normal/);
});

test("DayPicker v9 applies range edge markers and corner styles on cells", () => {
  const html = renderToStaticMarkup(React.createElement(Calendar, {
    mode: "range",
    defaultMonth: new Date(2026, 10, 1),
    selected: { from: new Date(2026, 10, 10), to: new Date(2026, 10, 12) },
  }));
  for (const [day, marker, corner] of [
    ["10", "day-range-start", "rounded-l-md"],
    ["12", "day-range-end", "rounded-r-md"],
  ]) {
    const cell = html.match(new RegExp(`<td[^>]*data-day="2026-11-${day}"[^>]*>`))?.[0];
    assert.ok(cell);
    assert.ok(cell.includes(marker));
    assert.ok(cell.includes(`[&amp;.${marker}]:${corner}`));
    assert.match(cell, /aria-selected="true"/);
  }
});
