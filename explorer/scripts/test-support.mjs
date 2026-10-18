import { Readable } from 'node:stream';
import { randomUUID } from 'node:crypto';
import { emptyQuotaState } from '../dist/server/lib/quota.mjs';

const conflict = (code, statusCode = 409) => Object.assign(new Error(code), { code, statusCode });

// In-process Storage protocol double: independent coordinators share only this
// blob's lease, ETag and bytes. It is not an alternative production quota store.
export class FakeBlob {
  constructor() {
    this.state = { ...emptyQuotaState(), enabled: true };
    this.now = Date.parse('2026-10-18T10:00:00Z');
    this.version = 0;
    this.lease = null;
    this.available = true;
    this.failWrite = false;
    this.failRelease = false;
  }

  assertAvailable() {
    if (!this.available) throw conflict('ServiceUnavailable', 503);
  }

  getBlobLeaseClient(id = randomUUID()) {
    return {
      leaseId: id,
      acquireLease: async seconds => {
        this.assertAvailable();
        if (this.lease && this.lease.expiresAt > this.now) throw conflict('LeaseAlreadyPresent');
        this.lease = { id, expiresAt: this.now + seconds * 1000 };
      },
      releaseLease: async () => {
        this.assertAvailable();
        if (this.failRelease) throw conflict('ServiceUnavailable', 503);
        if (this.lease?.id !== id) throw conflict('LeaseIdMismatchWithLeaseOperation');
        this.lease = null;
      },
    };
  }

  checkLease(options) {
    this.assertAvailable();
    if (options.conditions.leaseId !== this.lease?.id || this.lease.expiresAt <= this.now) throw conflict('LeaseIdMismatchWithBlobOperation', 412);
  }

  async download(_offset, _count, options) {
    this.checkLease(options);
    const text = JSON.stringify(this.state);
    return {
      date: new Date(this.now),
      etag: String(this.version),
      contentLength: Buffer.byteLength(text),
      readableStreamBody: Readable.from([Buffer.from(text)]),
    };
  }

  async upload(text, length, options) {
    this.checkLease(options);
    if (this.failWrite) throw conflict('ConditionNotMet', 412);
    if (options.conditions.ifMatch !== String(this.version)) throw conflict('ConditionNotMet', 412);
    if (length !== Buffer.byteLength(text)) throw new Error('Incorrect byte length');
    this.state = JSON.parse(text);
    this.version++;
  }
}
