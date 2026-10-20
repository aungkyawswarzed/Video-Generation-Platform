export function normalizeMediaMime(mime: string): string {
  const base = mime.split(';', 1)[0].trim().toLowerCase();
  return base === 'audio/x-m4a' ? 'audio/mp4' : base === 'audio/x-wav' ? 'audio/wav' : base;
}
