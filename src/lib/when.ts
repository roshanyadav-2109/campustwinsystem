// India time, short: "28 Nov, 10:30 am". Plain module: used by server pages and browser components alike.
export const when = (s: string) => new Date(s).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
