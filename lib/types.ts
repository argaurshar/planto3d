// Shared types used across client and server.

/** A base64-encoded image plus its mime type (no data: URL prefix). */
export interface InlineImage {
  /** Raw base64 (no `data:<mime>;base64,` prefix). */
  data: string;
  mimeType: string;
}

/** Response shape returned by the /api/overview and /api/room routes. */
export interface GenerateImageResponse {
  /**
   * Generated image. With the kie.ai backend this is a hosted URL
   * (e.g. https://tempfile.redpandaai.co/...), ready to drop into <img src>.
   */
  image: string;
  mimeType: string;
}

export interface ApiError {
  error: string;
}
