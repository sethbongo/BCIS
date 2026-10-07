import type { FileUploadInput } from '@bcis/shared';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { config } from '../config';
import { AppError, invalid, notFound } from './errors';

export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;

/** Allowed proof types, identified by the file's real leading bytes rather than its name or declared type. */
const SIGNATURES: { mime: string; ext: string; test: (b: Buffer) => boolean }[] = [
  { mime: 'image/png', ext: 'png', test: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { mime: 'image/jpeg', ext: 'jpg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: 'image/webp', ext: 'webp', test: (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP' },
  { mime: 'application/pdf', ext: 'pdf', test: (b) => b.subarray(0, 5).toString('latin1') === '%PDF-' },
];

const STORED_NAME = /^\d{4}-\d{2}\/[0-9a-f-]{36}\.(png|jpg|webp|pdf)$/;

export interface StoredAttachment {
  storedName: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  sha256: string;
}

/**
 * Validates and stores an uploaded proof. The file is saved under a server-generated
 * name inside the attachments folder; the client's file name is kept only as a label.
 */
export async function saveAttachment(upload: FileUploadInput): Promise<StoredAttachment> {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(upload.dataBase64)) throw invalid('The uploaded file is not valid.', { file: 'Invalid file data' });
  const data = Buffer.from(upload.dataBase64, 'base64');
  if (data.length === 0) throw invalid('The uploaded file is empty.', { file: 'File is empty' });
  if (data.length > MAX_ATTACHMENT_BYTES) throw new AppError(413, 'FILE_TOO_LARGE', 'The proof file is larger than 5 MB.', { file: 'Maximum size is 5 MB' });
  const type = SIGNATURES.find((s) => s.test(data));
  if (!type) throw invalid('Only PNG, JPEG, WEBP or PDF files are accepted as payment proof.', { file: 'Unsupported file type' });

  const storedName = `${new Date().toISOString().slice(0, 7)}/${randomUUID()}.${type.ext}`;
  const target = attachmentPath(storedName);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, data, { flag: 'wx' });
  return {
    storedName,
    fileName: upload.fileName.replace(/[^\w. ()-]/g, '_').slice(0, 200),
    mimeType: type.mime,
    fileSize: data.length,
    sha256: createHash('sha256').update(data).digest('hex'),
  };
}

/** Resolves a stored name to a path that is guaranteed to stay inside the attachments folder. */
function attachmentPath(storedName: string): string {
  if (!STORED_NAME.test(storedName)) throw notFound('Attachment');
  const root = resolve(config.attachmentsDir);
  const target = resolve(root, storedName);
  if (!target.startsWith(root + sep)) throw notFound('Attachment');
  return target;
}

export async function readAttachment(storedName: string): Promise<Buffer> {
  try {
    return await readFile(attachmentPath(storedName));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') throw notFound('Attachment file');
    throw err;
  }
}

export async function removeAttachment(storedName: string): Promise<void> {
  await rm(join(config.attachmentsDir, storedName), { force: true });
}
