import { describe, expect, it } from "vitest";
import { Calendar } from "@fullcalendar/core";
import timeGridPlugin from "@fullcalendar/timegrid";
import agendaTimeZonePlugin, { AgendaTimeZone } from "./agenda-timezone-plugin";

describe("agenda named timezone", () => {
  it("renders the clinic hour while preserving the event's UTC instant", () => {
    const root = document.createElement("div");
    document.body.append(root);
    const calendar = new Calendar(root, {
      plugins: [timeGridPlugin, agendaTimeZonePlugin],
      initialView: "timeGridDay",
      initialDate: "2026-10-28",
      timeZone: "America/Asuncion",
      eventTimeFormat: { hour: "2-digit", minute: "2-digit", hour12: false },
      events: [{ id: "synthetic", start: "2026-10-28T19:00:00Z", end: "2026-10-28T19:30:00Z" }],
    });
    try {
      calendar.render();
      expect(root.querySelector(".fc-event-time")?.textContent).toContain("16:00");
      expect(calendar.getEventById("synthetic")?.start?.toISOString()).toBe(
        "2026-10-28T19:00:00.000Z"
      );
      calendar.getEventById("synthetic")?.setDates("2026-10-28T17:00:00", "2026-10-28T17:30:00");
      expect(calendar.getEventById("synthetic")?.start?.toISOString()).toBe(
        "2026-10-28T20:00:00.000Z"
      );
    } finally {
      calendar.destroy();
      root.remove();
    }
  });

  it("uses historical timezone data and keeps seconds and milliseconds", () => {
    const zone = new AgendaTimeZone("America/Asuncion");
    expect(zone.offsetForArray([2024, 6, 1, 12, 0])).toBe(-240);
    expect(zone.offsetForArray([2026, 9, 28, 16, 0])).toBe(-180);
    expect(zone.timestampToArray(Date.parse("2026-10-28T19:00:12.345Z"))).toEqual([
      2026, 9, 28, 16, 0, 12, 345,
    ]);
  });
});
