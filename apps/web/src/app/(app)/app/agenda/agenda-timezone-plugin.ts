import { createPlugin } from "@fullcalendar/core";
import { NamedTimeZoneImpl } from "@fullcalendar/core/internal";
import { formatDateKey, zonedLocalToIso, zonedParts } from "./agenda-time";

/** Resolve FullCalendar's named zone with the same Intl boundary as the forms. */
export class AgendaTimeZone extends NamedTimeZoneImpl {
  timestampToArray(ms: number): number[] {
    const parts = zonedParts(new Date(ms), this.timeZoneName);
    const instant = new Date(ms);
    return [
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      instant.getUTCSeconds(),
      instant.getUTCMilliseconds(),
    ];
  }

  offsetForArray(parts: number[]): number {
    const [year, month, day, hour = 0, minute = 0] = parts;
    const wall = Date.UTC(year, month, day, hour, minute);
    const iso = zonedLocalToIso(
      formatDateKey(year, month + 1, day),
      hour * 60 + minute,
      this.timeZoneName
    );
    return (wall - Date.parse(iso)) / 60000;
  }
}

export default createPlugin({
  name: "agenda-intl-timezone",
  namedTimeZonedImpl: AgendaTimeZone,
});
