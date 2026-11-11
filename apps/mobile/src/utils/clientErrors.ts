export const CLIENT_ERROR_MESSAGES = {
  INVALID_PHOTO: "This file doesn't look like a photo file. It may be corrupt or renamed.",
  PHOTO_TOO_LARGE: "That photo is still too large after preparing. Try a smaller image or re-save it as JPEG.",
  CAMERA_UNAVAILABLE: "Camera busy or unavailable. Try again.",
  PUBLISH_FAILED: "Could not publish. Please try again.",
} as const;

export type ClientErrorCode = keyof typeof CLIENT_ERROR_MESSAGES;

export class ClientError extends Error {
  constructor(readonly clientCode: ClientErrorCode) {
    super(CLIENT_ERROR_MESSAGES[clientCode]);
    this.name = "ClientError";
  }
}

export class PhotoImportError extends Error {
  constructor(message: string, readonly clientCode?: "INVALID_PHOTO" | "PHOTO_TOO_LARGE") {
    super(message);
    this.name = "PhotoImportError";
  }
}
