export interface MediaJob {
  jobId: string;
  photoId: string;
  eventId: string;
  originalKey: string;
  /** Approved at dispatch: write renditions to public/ (else private/). */
  visible: boolean;
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
