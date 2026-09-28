export type CaptureFile = {
  handle: string;
  name: string;
  type: string;
  size: number;
};

export type CaptureDraft = {
  id: string;
  ownerId: string;
  receivedAt: number;
  title: string;
  text: string;
  url: string;
  files: CaptureFile[];
};

export type CaptureRecord = CaptureDraft & {
  blobs: Record<string, Blob | ArrayBuffer>;
};

export type CaptureActionData = Omit<CaptureDraft, "ownerId">;
