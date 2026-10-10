// Regression test for the "Save failed" bug: a failed draft save used to
// always surface the literal string "Save failed" regardless of what the
// server actually said, because the catch handler checked `err instanceof
// Error` on a thrown Response (which is never an Error) and fell through to
// a hardcoded fallback. describeSaveError is the extracted, pure replacement
// — these pin that it reads the server's real validation message instead.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeSaveError } from './useAutosave.ts';

test('describeSaveError: surfaces the server\'s validation issue, not a generic message', () => {
  const body = { error: { code: 'validation', message: 'The story could not be saved.', issues: [{ path: 'body.content.0.attrs.url', message: 'Embeds must be https URLs.' }] } };
  assert.equal(describeSaveError(422, body), 'Embeds must be https URLs.');
});

test('describeSaveError: joins multiple issues into one readable message', () => {
  const body = { error: { issues: [{ path: 'title', message: 'A title is required to publish.' }, { path: 'body', message: 'The story has no content.' }] } };
  assert.equal(describeSaveError(422, body), 'A title is required to publish. The story has no content.');
});

test('describeSaveError: falls back to the error message when there are no itemized issues', () => {
  assert.equal(describeSaveError(500, { error: { message: 'Something went wrong.' } }), 'Something went wrong.');
});

test('describeSaveError: falls back to a status-coded message when the body is unreadable', () => {
  assert.equal(describeSaveError(500, null), 'Save failed (500).');
  assert.equal(describeSaveError(413, {}), 'Save failed (413).');
});
