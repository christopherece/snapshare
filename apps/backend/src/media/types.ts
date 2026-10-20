export interface MediaJob {
  jobId: string;
  photoId: string;
  eventId: string;
  originalKey: string;
}

export type MediaJobResult =
  | {
      jobId: string;
      ok: true;
      thumbKey: string;
      displayKey: string;
      width: number;
      height: number;
      takenAt: string | null;
      exif: Record<string, unknown> | null;
    }
  | { jobId: string; ok: false; error: string };
