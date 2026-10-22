// Date formats used in the transcript: "Tue 20.10.2026", "20.10.2026" and "14:03".
//
// Copyright (C) 2026 Filip Tomasovych
// SPDX-License-Identifier: GPL-3.0-or-later

export class DateFormat {
  #date: Intl.DateTimeFormat;
  #time: Intl.DateTimeFormat;

  constructor(timeZone: string) {
    this.#date = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      weekday: "short",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
    this.#time = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
  }

  day(date: Date): string {
    return `${this.#part(date, "weekday")} ${this.date(date)}`;
  }

  date(date: Date): string {
    return `${this.#part(date, "day")}.${this.#part(date, "month")}.${this.#part(date, "year")}`;
  }

  time(date: Date): string {
    return this.#time.format(date);
  }

  dateTime(date: Date): string {
    return `${this.date(date)} ${this.time(date)}`;
  }

  #part(date: Date, type: Intl.DateTimeFormatPartTypes): string {
    return this.#date.formatToParts(date).find((part) => part.type === type)?.value ?? "";
  }
}
