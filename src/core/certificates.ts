// Certificates (transfer, bonafide, character) are made by the office outside
// CampusTwin and uploaded as files against each student, or recorded from the
// school's old register. Every edition shares this.
export type CertificateKind = "transfer" | "bonafide" | "character";

export const KIND_LABEL: Record<CertificateKind, string> = {
  transfer: "Transfer certificate", bonafide: "Bonafide certificate", character: "Character certificate",
};
