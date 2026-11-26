// The words an edition uses for the same idea, so screens never type
// "Class" or "Programme" themselves.
export type EditionWords = {
  group: string;        // what students are taught in: Section / Class section
  groupParent: string;  // Class / Programme
  period: string;       // Term / Semester
  leadTeacher: string;  // Class teacher / Mentor
  teacher: string;      // Teacher / Faculty
  reportCard: string;   // Report card / Grade card
  mainUser: string;     // Parent / Student
};
