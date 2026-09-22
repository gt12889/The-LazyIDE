/**
 * captureAuthor.test.ts
 *
 * Tests for the author cache lifecycle (Forge: single local profile):
 *   1. resolveCaptureIdentity returns the local profile author.
 *   2. After invalidateCaptureAuthor, the next call re-reads (cache cleared).
 *   3. withCaptureAuthor stamps both author and authorId.
 */

import { describe, it, expect, beforeEach } from 'vitest';

import {
  resolveCaptureIdentity,
  resolveCaptureAuthor,
  resolveCaptureAuthorId,
  invalidateCaptureAuthor,
  withCaptureAuthor,
  enrichCaptureAuthor,
  setLocalAuthor,
} from '../lib/brain/captureAuthor.js';
import type { CaptureEvent } from '../lib/platform/types.js';

beforeEach(() => {
  localStorage.clear();
  invalidateCaptureAuthor();
  setLocalAuthor('Alice');
});

describe('resolveCaptureIdentity', () => {
  it('returns the local profile author', async () => {
    const identity = await resolveCaptureIdentity();

    expect(identity.author).toBe('Alice');
    expect(identity.authorId).toBeUndefined();
  });

  it('caches the result — a second call does not re-read after clearing storage', async () => {
    await resolveCaptureIdentity();
    localStorage.clear();
    const identity = await resolveCaptureIdentity();
    expect(identity.author).toBe('Alice');
  });
});

describe('invalidateCaptureAuthor', () => {
  it('clears the cache so the next call re-reads', async () => {
    await resolveCaptureIdentity();

    invalidateCaptureAuthor();
    setLocalAuthor('Bob');

    const identity = await resolveCaptureIdentity();
    expect(identity.author).toBe('Bob');
  });

  it('clears the cache for resolveCaptureAuthor and resolveCaptureAuthorId too', async () => {
    await resolveCaptureAuthor();
    await resolveCaptureAuthorId();

    invalidateCaptureAuthor();
    setLocalAuthor('Carol');

    await expect(resolveCaptureAuthor()).resolves.toBe('Carol');
  });
});

describe('withCaptureAuthor', () => {
  function makeEvent(overrides: Partial<CaptureEvent> = {}): CaptureEvent {
    return {
      kind: 'episodic',
      title: 'Test',
      text: 'content',
      source: 'test',
      ...overrides,
    };
  }

  it('stamps both author and authorId when neither is already set', () => {
    const event = makeEvent();
    const stamped = withCaptureAuthor(event, 'Alice', 'user-uuid-abc');

    expect(stamped.author).toBe('Alice');
    expect(stamped.authorId).toBe('user-uuid-abc');
  });

  it('does not overwrite an existing author but still stamps authorId', () => {
    const event = makeEvent({ author: 'Bob' });
    const stamped = withCaptureAuthor(event, 'Alice', 'user-uuid-abc');

    expect(stamped.author).toBe('Bob');
    expect(stamped.authorId).toBe('user-uuid-abc');
  });

  it('stamps author even when authorId is absent', () => {
    const event = makeEvent();
    const stamped = withCaptureAuthor(event, 'Alice');

    expect(stamped.author).toBe('Alice');
    expect(stamped.authorId).toBeUndefined();
  });

  it('returns the event unchanged when author is empty', () => {
    const event = makeEvent();
    const stamped = withCaptureAuthor(event, '', 'user-uuid-abc');

    expect(stamped).toBe(event);
  });
});

describe('local author enrichment', () => {
  it('enrichCaptureAuthor stamps the local author when the event has none', async () => {
    const event: CaptureEvent = {
      kind: 'episodic',
      title: 'Test',
      text: 'content',
      source: 'test',
    };
    const stamped = await enrichCaptureAuthor(event);
    expect(stamped.author).toBe('Alice');
  });

  it('does not overwrite an event that already carries an author', async () => {
    const event: CaptureEvent = {
      kind: 'episodic',
      title: 'Test',
      text: 'content',
      source: 'test',
      author: 'Bob',
    };
    const stamped = await enrichCaptureAuthor(event);
    expect(stamped.author).toBe('Bob');
  });
});
