import { createHash } from 'node:crypto';
import { ManagedIdentityCredential } from '@azure/identity';
import { BlobServiceClient } from '@azure/storage-blob';
import { HttpError } from './protocol.mjs';

export const REPORT = Object.freeze({
  version: '93f9a0202726d904',
  sha256: '93f9a0202726d90446ac4954339ba529e446a88de40e338aeb68db0a0298c739',
  pageCount: 244,
  sourceName: 'zava-state-of-ai-report-source',
});
export const MAX_PAGE_BYTES = 2 * 1024 * 1024;
const storage = 'https://stfoundryiqcustomerdemos.blob.core.windows.net';
const signature = Buffer.from('89504e470d0a1a0a', 'hex');

export function reportPageNumber(path) {
  const match = new RegExp(`^/api/report-pages/${REPORT.version}/([1-9][0-9]{0,2})\\.png$`).exec(path);
  const page = match ? Number(match[1]) : 0;
  return page >= 1 && page <= REPORT.pageCount ? page : null;
}

export function reportPageForReference(reference) {
  if (reference.kind !== 'azureBlob' || (reference.sourceName && reference.sourceName !== REPORT.sourceName)) return null;
  const annotation = reference.annotation || {};
  const data = annotation.sourceData || {};
  const pages = new Set();
  for (const candidate of [annotation.blobUrl, data.blob_url, data.metadata_storage_path, data.url, data.document_url, annotation.url]) {
    try {
      const url = new URL(candidate);
      if (url.origin !== storage || url.username || url.password || url.search || url.hash) continue;
      const match = new RegExp(`^/demo-content/zava/report-text/${REPORT.version}/page-([0-9]{3})\\.txt$`).exec(url.pathname);
      const page = match ? Number(match[1]) : 0;
      if (page >= 1 && page <= REPORT.pageCount) pages.add(page);
    } catch {
      // Missing or non-URL annotations are not page provenance.
    }
  }
  return pages.size === 1 ? [...pages][0] : null;
}

export function createReportPageReader({ containerClient, timeoutMs = 10000 } = {}) {
  let container = containerClient;
  let active = 0;
  return async function readReportPage(page, requestSignal) {
    if (!Number.isInteger(page) || page < 1 || page > REPORT.pageCount) throw new HttpError(404, 'report_page_not_found', 'Unknown original PDF page.');
    if (active >= 4) throw new HttpError(429, 'report_pages_busy', 'Page previews are busy. Try again shortly.', { retryAfter: 2 });
    active++;
    const deadline = AbortSignal.timeout(timeoutMs);
    const signal = requestSignal ? AbortSignal.any([requestSignal, deadline]) : deadline;
    let stream;
    const cancel = () => stream?.destroy(signal.reason);
    signal.addEventListener('abort', cancel, { once: true });
    try {
      signal.throwIfAborted();
      container ||= new BlobServiceClient(storage, new ManagedIdentityCredential(), {
        retryOptions: { maxTries: 1 },
      }).getContainerClient('zava-report-pages');
      const blob = container.getBlobClient(`${REPORT.version}/page-${String(page).padStart(3, '0')}.png`);
      const response = await blob.download(0, MAX_PAGE_BYTES + 1, { abortSignal: signal, maxRetryRequests: 0 });
      stream = response.readableStreamBody;
      const metadata = response.metadata || {};
      if (!stream || response.contentType !== 'image/png' || !Number.isInteger(response.contentLength)
        || response.contentLength < 33 || response.contentLength > MAX_PAGE_BYTES
        || metadata.owner !== 'foundryiq-zava-20261020' || metadata.reportsha256 !== REPORT.sha256
        || metadata.originalpage !== String(page) || !/^[a-f0-9]{64}$/.test(metadata.contentsha256 || '')) {
        throw new HttpError(502, 'invalid_report_page', 'The original page failed its type, size or provenance checks.');
      }
      const chunks = [];
      let size = 0;
      for await (const chunk of stream) {
        signal.throwIfAborted();
        size += chunk.length;
        if (size > MAX_PAGE_BYTES) throw new HttpError(502, 'invalid_report_page', 'The original page exceeded its byte limit.');
        chunks.push(chunk);
      }
      signal.throwIfAborted();
      const bytes = Buffer.concat(chunks, size);
      if (size !== response.contentLength || !bytes.subarray(0, 8).equals(signature)
        || bytes.toString('ascii', 12, 16) !== 'IHDR' || bytes.readUInt32BE(8) !== 13
        || bytes.readUInt32BE(16) < 1 || bytes.readUInt32BE(16) > 1600
        || bytes.readUInt32BE(20) < 1 || bytes.readUInt32BE(20) > 1600
        || createHash('sha256').update(bytes).digest('hex') !== metadata.contentsha256) {
        throw new HttpError(502, 'invalid_report_page', 'The original page failed its image or content-integrity checks.');
      }
      return bytes;
    } catch (error) {
      if (error instanceof HttpError) throw error;
      if (requestSignal?.aborted) throw new HttpError(499, 'request_cancelled', 'Page preview cancelled.');
      if (deadline.aborted) throw new HttpError(504, 'report_page_timeout', 'The original page could not be loaded within its time limit.');
      throw new HttpError(error?.statusCode === 404 ? 404 : 503, 'report_page_unavailable', 'The original page is unavailable. No replacement image was generated.');
    } finally {
      signal.removeEventListener('abort', cancel);
      stream?.destroy();
      active--;
    }
  };
}
