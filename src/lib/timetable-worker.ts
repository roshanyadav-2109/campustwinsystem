// Runs the timetable solver off the main thread, so the page stays responsive on a big school.
import { solveTimetable, type SolverInput } from "./timetable-solver";

self.onmessage = (e: MessageEvent<SolverInput>) => {
  const result = solveTimetable(e.data);
  (self as unknown as { postMessage: (m: unknown) => void }).postMessage(result);
};
