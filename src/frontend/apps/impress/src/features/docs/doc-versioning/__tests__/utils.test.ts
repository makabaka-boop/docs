import type { Block } from '@blocknote/core';

import type {
  DocsBlockSchema,
  DocsInlineContentSchema,
  DocsStyleSchema,
} from '@/docs/doc-editor';

import { ActivityEntry } from '../types';
import {
  VERSION_GRANULARITY_MS_FALLBACK as G,
  cloneBlocksForReinsert,
  mergeActivityEntries,
  pickBlocksInDocumentOrder,
} from '../utils';

type AnyBlock = Block<DocsBlockSchema, DocsInlineContentSchema, DocsStyleSchema>;

const paragraph = (
  id: string,
  text: string,
  children: AnyBlock[] = [],
  props: Record<string, unknown> = {},
): AnyBlock =>
  ({
    id,
    type: 'paragraph',
    props: {
      backgroundColor: 'default',
      textAlignment: 'left',
      textColor: 'default',
      ...props,
    },
    content: [{ type: 'text', text, styles: { bold: true } }],
    children,
  }) as unknown as AnyBlock;

describe('partial retrieval helpers', () => {
  it('keeps the historical order, not the click order', () => {
    const documentBlocks = [
      paragraph('a', 'A'),
      paragraph('b', 'B'),
      paragraph('c', 'C'),
    ];

    const picked = pickBlocksInDocumentOrder(documentBlocks, ['c', 'a']);

    expect(picked.map((block) => block.id)).toEqual(['a', 'c']);
  });

  it('ignores ids that are not top-level blocks', () => {
    const documentBlocks = [paragraph('a', 'A')];

    expect(
      pickBlocksInDocumentOrder(documentBlocks, ['nope', 'a']).map(
        (block) => block.id,
      ),
    ).toEqual(['a']);
  });

  it('drops ids at every level so the copies are new blocks', () => {
    const blocks = [
      paragraph('a', 'A', [paragraph('a-child', 'Nested')]),
      paragraph('b', 'B'),
    ];

    const copies = cloneBlocksForReinsert(blocks);

    expect(copies[0].id).toBeUndefined();
    expect(copies[1].id).toBeUndefined();
    expect(copies[0].children?.[0].id).toBeUndefined();
    // originals are untouched
    expect(blocks[0].id).toBe('a');
    expect(blocks[0].children[0].id).toBe('a-child');
  });

  it('preserves type, text styles, props and the nested structure', () => {
    const blocks = [
      paragraph('a', 'A', [paragraph('child', 'Nested')], { level: 2 }),
    ];

    const [copy] = cloneBlocksForReinsert(blocks);

    expect(copy.type).toBe('paragraph');
    expect(copy.props).toMatchObject({ level: 2 });
    expect(copy.content).toEqual([
      { type: 'text', text: 'A', styles: { bold: true } },
    ]);
    expect(copy.children).toHaveLength(1);
    expect(copy.children?.[0].content).toEqual([
      { type: 'text', text: 'Nested', styles: { bold: true } },
    ]);
  });

  it('carries table data over unchanged', () => {
    const table = {
      id: 't',
      type: 'table',
      props: { textColor: 'default' },
      content: {
        type: 'tableContent',
        columnWidths: [undefined, undefined],
        rows: [
          {
            cells: [
              [{ type: 'text', text: 'one', styles: {} }],
              [{ type: 'text', text: 'two', styles: {} }],
            ],
          },
        ],
      },
      children: [],
    };

    const [copy] = cloneBlocksForReinsert([table as unknown as AnyBlock]);

    expect(copy.id).toBeUndefined();
    expect(copy.content).toEqual(table.content);
  });

  it('returns detached copies', () => {
    const blocks = [paragraph('a', 'A')];

    const [copy] = cloneBlocksForReinsert(blocks);
    const copiedContent = copy.content as unknown as Array<{ text: string }>;
    copiedContent[0].text = 'changed';

    const originalContent = blocks[0].content as unknown as Array<{
      text: string;
    }>;
    expect(originalContent[0].text).toBe('A');
  });
});


/**
 * `mergeActivityEntries` is the only part of the history policy that lives in
 * the client, and it decides what a "version" is. The cases below are the ones
 * it can plausibly get wrong: the two bounds, each of which is a strict
 * comparison, and the author test that this deliberately does *not* apply.
 */
const entry = (from: number, to: number, by: string | null): ActivityEntry => ({
  from,
  to,
  by,
});

describe('mergeActivityEntries', () => {
  it('has nothing to say about an empty timeline', () => {
    expect(mergeActivityEntries([])).toEqual([]);
  });

  it('merges changes closer together than the granularity', () => {
    const versions = mergeActivityEntries([
      entry(0, 0, 'alice'),
      entry(1_000, 1_000, 'alice'),
    ]);

    expect(versions).toEqual([
      { id: '1000', from: 0, to: 1_000, by: ['alice'] },
    ]);
  });

  it('merges across authors, which the server will not do', () => {
    // the reason this function exists: the collaboration server breaks a run
    // wherever the author changes, and a version is a moment in the document
    // rather than a moment in one person's editing
    const versions = mergeActivityEntries([
      entry(0, 0, 'alice'),
      entry(1_000, 1_000, 'bob'),
      entry(2_000, 2_000, 'alice'),
    ]);

    expect(versions).toHaveLength(1);
    expect(versions[0]).toMatchObject({ from: 0, to: 2_000 });
    expect(versions[0].by.sort()).toEqual(['alice', 'bob']);
  });

  it('starts a new version after a gap of exactly the granularity', () => {
    // `<`, not `<=` — the same comparison the server makes, so the two halves
    // of the grouping cannot disagree at the boundary
    expect(
      mergeActivityEntries([entry(0, 0, 'a'), entry(G, G, 'a')]),
    ).toHaveLength(2);
    expect(
      mergeActivityEntries([entry(0, 0, 'a'), entry(G - 1, G - 1, 'a')]),
    ).toHaveLength(1);
  });

  it('never lets one version span more than the granularity', () => {
    // unbroken typing: every change is a millisecond after the last, so no gap
    // ever ends a version and only the span bound can
    const timeline = Array.from({ length: 5 }, (_, i) =>
      entry(i * (G / 2), i * (G / 2), 'alice'),
    );

    const versions = mergeActivityEntries(timeline);

    expect(versions.length).toBeGreaterThan(1);
    versions.forEach((version) => {
      expect(version.to - version.from).toBeLessThan(G);
    });
  });

  it('identifies a version by the moment it ends', () => {
    // that id is what the preview and the restore are asked for, so it has to
    // survive merging rather than being the first entry's timestamp
    const [version] = mergeActivityEntries([
      entry(0, 0, 'alice'),
      entry(500, 900, 'alice'),
    ]);

    expect(version.id).toBe('900');
    expect(version.to).toBe(900);
  });

  it('keeps a migrated history intact, save by save', () => {
    /**
     * The case `UNGROUPED_AUTHORS` exists for. The backend used to save the
     * whole document every 60s, each save becoming one version of the legacy
     * file, and the migration replays them at their original timestamps, all
     * attributed to `system` — so an imported history is a chain of entries
     * spaced almost exactly the granularity apart, with nothing to tell them
     * apart by author.
     *
     * Jitter is applied in both directions on purpose: it is the negative side
     * that would merge, and a perfectly fixed interval would pass either way.
     */
    let t = 0;
    const legacy: ActivityEntry[] = [];
    [0, -900, 700, -1500, 400, -300, 1200, -80].forEach((jitter) => {
      legacy.push(entry(t, t, 'system'));
      t += 60_000 + jitter;
    });

    expect(mergeActivityEntries(legacy)).toHaveLength(legacy.length);
  });

  it('never folds an edit into the imported history beside it', () => {
    // stricter than the collaboration server's own test, which would have
    // refused this on the author comparison it makes and this one does not: a
    // document edited moments after it was migrated must not absorb the
    // migration entry, nor be absorbed by it
    const versions = mergeActivityEntries([
      entry(0, 0, 'system'),
      entry(500, 500, 'alice'),
      entry(1_000, 1_000, 'system'),
    ]);

    expect(versions).toHaveLength(3);
    expect(versions.map((v) => v.by)).toEqual([
      ['system'],
      ['alice'],
      ['system'],
    ]);
  });

  it('never returns two versions with the same id', () => {
    // the id is the moment a version ends, and the preview and the restore are
    // asked for nothing else: two entries ending together are one version of
    // the document. Kept apart they would both look selected and share a list
    // key. An imported save and an edit ending together cannot merge...
    const adjacent = mergeActivityEntries([
      entry(0, 5_000, 'system'),
      entry(100, 5_000, 'alice'),
    ]);

    expect(adjacent).toHaveLength(1);
    expect(adjacent[0]).toMatchObject({ id: '5000', from: 0, to: 5_000 });
    expect(adjacent[0].by.sort()).toEqual(['alice', 'system']);

    // ...and neither can a later one that ends where an earlier one did, with
    // a different version in between
    const apart = mergeActivityEntries([
      entry(0, 5_000, 'system'),
      entry(100, 300, 'alice'),
      entry(400, 5_000, 'system'),
    ]);

    expect(apart.map((v) => v.id)).toEqual(['5000', '300']);
    expect(apart[0]).toMatchObject({ from: 0, by: ['system'] });
  });

  it('keeps an unattributed change without inventing an author', () => {
    const [version] = mergeActivityEntries([entry(0, 0, null)]);

    expect(version.by).toEqual([]);
  });
});
