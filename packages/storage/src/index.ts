/**
 * Neon Object Storage (S3-compatible, branches with the database).
 * Credentials come from `neon deploy` / `neon env pull`:
 *   AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_ENDPOINT_URL_S3, AWS_REGION
 * The AWS SDK reads those env vars itself; Neon requires path-style addressing.
 */
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

/** Bucket declared in neon.ts (`buckets.assets`, private). */
export const ARTIFACTS_BUCKET = "assets";

export interface ArtifactStore {
  put(key: string, body: Uint8Array | string, contentType: string): Promise<{ key: string; size: number }>;
  get(key: string): Promise<Uint8Array>;
  exists(key: string): Promise<boolean>;
  delete(key: string): Promise<void>;
  /** Time-limited download URL for the dashboard (private bucket). */
  signedUrl(key: string, expiresInSeconds?: number): Promise<string>;
}

export function createArtifactStore(opts: { client?: S3Client; bucket?: string } = {}): ArtifactStore {
  const s3 = opts.client ?? new S3Client({ forcePathStyle: true });
  const Bucket = opts.bucket ?? ARTIFACTS_BUCKET;
  return {
    async put(key, body, contentType) {
      const bytes = typeof body === "string" ? new TextEncoder().encode(body) : body;
      await s3.send(new PutObjectCommand({ Bucket, Key: key, Body: bytes, ContentType: contentType }));
      return { key, size: bytes.byteLength };
    },
    async get(key) {
      const res = await s3.send(new GetObjectCommand({ Bucket, Key: key }));
      if (!res.Body) throw new Error(`empty object body for ${key}`);
      return res.Body.transformToByteArray();
    },
    async exists(key) {
      try {
        await s3.send(new HeadObjectCommand({ Bucket, Key: key }));
        return true;
      } catch (e) {
        const status = (e as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
        if (status === 404) return false;
        throw e;
      }
    },
    async delete(key) {
      await s3.send(new DeleteObjectCommand({ Bucket, Key: key }));
    },
    signedUrl(key, expiresInSeconds = 3600) {
      return getSignedUrl(s3, new GetObjectCommand({ Bucket, Key: key }), { expiresIn: expiresInSeconds });
    },
  };
}

/** Deterministic artifact key layout: tasks/<taskId>/<filename>. */
export const artifactKey = (taskId: string, filename: string) =>
  `tasks/${taskId}/${filename.replace(/[^A-Za-z0-9._-]/g, "_")}`;
