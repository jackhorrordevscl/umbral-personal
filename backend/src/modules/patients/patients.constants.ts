// Date (America/Santiago calendar day) from which a minor's treatment consent
// must have been granted by a legal guardian. Until then a consent granted by
// the patient (legacy) is still honoured on read, and `minorStatus` flags it as
// LEGACY_CONSENT so the therapist can regularize it. Kept in code, not in an
// environment variable, so it does not touch render.yaml.
export const MINOR_GUARDIAN_ENFORCEMENT_DATE = '2026-12-01';

// A patient can have at most two legal guardians (e.g. both parents).
export const MAX_GUARDIANS_PER_PATIENT = 2;
