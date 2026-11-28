import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickIntro } from './intro.ts';

const p = (text: string, extra: Record<string, unknown> = {}) => ({ type: 'p', text, ...extra });
const body = [p('Late summer.'), p('A heading', { subhead: true }), p('First paragraph.'), p('Second.')];

test('pickIntro: an admin story with an empty Subtitle box keeps its first paragraph in the body', () => {
  const r = pickIntro('cms', '', body, 'Late summer.');
  assert.equal(r.intro, '');
  assert.deepEqual(r.blocks, body);
  assert.equal(r.firstParagraph, 'First paragraph.');
});

test('pickIntro: whitespace-only subtitle counts as empty', () => {
  assert.equal(pickIntro('cms', '   ', body, 'Late summer.').intro, '');
});

test('pickIntro: a written subtitle is the intro and nothing leaves the body', () => {
  for (const source of ['cms', 'legacy'] as const) {
    const r = pickIntro(source, '  A subtitle ', body, 'Late summer.');
    assert.equal(r.intro, 'A subtitle');
    assert.deepEqual(r.blocks, body);
  }
});

test('pickIntro: archived articles still use their first plain paragraph (skipping dateline and subheads)', () => {
  const r = pickIntro('legacy', '', body, 'Late summer.');
  assert.equal(r.intro, 'First paragraph.');
  assert.deepEqual(r.blocks.map((b) => b.text), ['Late summer.', 'A heading', 'Second.']);
});

test('pickIntro: no paragraphs at all', () => {
  const r = pickIntro('legacy', '', [{ type: 'img' }], '');
  assert.equal(r.intro, '');
  assert.equal(r.blocks.length, 1);
});
