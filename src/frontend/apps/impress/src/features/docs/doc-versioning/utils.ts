import type { Block, PartialBlock } from '@blocknote/core';

import type {
  DocsBlockNoteEditor,
  DocsBlockSchema,
  DocsInlineContentSchema,
  DocsStyleSchema,
} from '@/docs/doc-editor';

import { ActivityEntry, DocVersion } from './types';

/**
 * Selector for the DOM element BlockNote renders for every block: the
 * `blockContainer` node carries the block id in `data-id`.
 */
export const BLOCK_CONTAINER_SELECTOR = '[data-node-type="blockContainer"]';

/**
 * The blocks "Retrieve from history" inserts in the live document. Partial on
 * purpose: their ids are stripped so the editor mints fresh ones.
 */
export type ReinsertBlock = PartialBlock<
  DocsBlockSchema,
  DocsInlineContentSchema,
  DocsStyleSchema
>;

/**
 * Find a block's container element by id, without building a CSS selector
 * from the id (ids may contain characters that need escaping).
 */
export const findBlockContainer = (
  root: ParentNode,
  id: string,
): HTMLElement | null => {
  const elements =
    root.querySelectorAll<HTMLElement>(BLOCK_CONTAINER_SELECTOR);

  return (
    Array.from(elements).find((element) => element.dataset.id === id) ?? null
  );
};

/**
 * Resolve the top-level block an element belongs to.
 *
 * Retrieval always moves *complete* top-level blocks together with their
 * children, so a click anywhere inside a nested block (or a column) selects
 * the outermost block rather than the nested one. Returns `null` outside any
 * block.
 */
export const getTopLevelBlockId = (
  editor: DocsBlockNoteEditor,
  element: Element | null,
): string | null => {
  const container = element?.closest?.<HTMLElement>(BLOCK_CONTAINER_SELECTOR);
  let id = container?.dataset.id;

  if (!id) {
    return null;
  }

  let parent = editor.getParentBlock(id);
  while (parent) {
    id = parent.id;
    parent = editor.getParentBlock(id);
  }

  return id;
};

/**
 * Pick blocks out of a document snapshot in document order.
 *
 * The source of truth for the order is the historical document, not the
 * order the user happened to click blocks in: retrieved blocks must land in
 * the order they had in the version.
 */
export const pickBlocksInDocumentOrder = (
  documentBlocks: Block<DocsBlockSchema, DocsInlineContentSchema, DocsStyleSchema>[],
  ids: Iterable<string>,
): Block<DocsBlockSchema, DocsInlineContentSchema, DocsStyleSchema>[] => {
  const wanted = new Set(ids);

  return documentBlocks.filter((block) => wanted.has(block.id));
};

/**
 * Turn snapshots read from a past version into brand-new blocks the live
 * document can adopt.
 *
 * Two things make the copies new:
 * - the id is dropped at every nesting level, so BlockNote mints fresh ids.
 *   A block that survived untouched since that version still carries the
 *   very same id, and inserting a second block with that id would give the
 *   document two answers to "which block is this one" — anchors, comments
 *   and every `getBlock` call rely on id uniqueness;
 * - a structural clone detaches the snapshots from the historical Yjs
 *   document, so inserting them mutates only the live one.
 *
 * Types, text styles, nesting and table data come across untouched. Comment
 * marks need no surgery: they are tagged `blocknoteIgnore` by the comments
 * extension and never appear in the Block JSON an editor snapshots, so the
 * copies carry no thread ids and no historical comment is re-attached.
 */
export const cloneBlocksForReinsert = (
  blocks: Block<DocsBlockSchema, DocsInlineContentSchema, DocsStyleSchema>[],
): ReinsertBlock[] =>
  blocks.map((block) => {
    const { id: _id, children, ...rest } = block;

    return {
      ...structuredClone(rest),
      children: cloneBlocksForReinsert(children ?? []),
    };
  });

/**
 * How coarse the version history is: neighbouring changes closer together than
 * this become one version, and no version spans more than this.
 *
 * A minute is a deliberate choice about what a "version" means here. The
 * collaboration server records an activity entry per stretch of editing, which
 * at typing speed is far finer than anything worth listing — a history of every
 * few keystrokes is not a history.
 */
export const VERSION_GRANULARITY_MS_FALLBACK = 60_000;

/**
 * Authors whose changes are never merged into a version with anything else.
 *
 * `system` is not a person who edited for a long time; it is what a document's
 * imported past is attributed to. The backend used to save the whole document
 * once a minute, each save becoming one version of the legacy file, and the
 * migration replays those saves at their original timestamps — so an imported
 * history arrives as a chain of `system` entries spaced almost exactly the
 * granularity apart. Grouped like ordinary editing, whether two of those
 * versions survive as two would come down to how fast the network was on the
 * day they were written, and about a third of the chain would collapse.
 *
 * Grouping is a judgement about someone's editing, and there was no editing
 * here: these entries are the record of saves that already happened, and the
 * only honest thing to do with them is to show them one for one.
 */
export const UNGROUPED_AUTHORS = ['system'];

/**
 * Merge an ascending activity timeline into the versions the panel lists.
 *
 * The collaboration server already groups with the same two bounds (a gap and a
 * maximum span, both a minute), but it will only ever merge changes by the
 * *same* author: it breaks a run whenever the author changes. Two people typing
 * in the same paragraph at the same time would otherwise produce two interleaved
 * columns of entries, which is not what a version is — a version is a moment in
 * the document, not a moment in someone's editing.
 *
 * So this applies the server's own rule again, minus the author test, and keeps
 * the authors instead of discarding them. Because the server sorts by `from` and
 * breaks a run only where the author changes, re-merging those adjacent runs
 * yields exactly what one pass over the whole timeline would have produced.
 *
 * Both comparisons are `<`, matching the server's, so entries exactly a minute
 * apart start a new version rather than joining the old one.
 *
 * `UNGROUPED_AUTHORS` is honoured on both sides, which is stricter than the
 * server's own test and has to be: the server only refuses to merge an excluded
 * entry into the one before it, because it would have refused anyway on the
 * author test it makes and this does not. Here an excluded entry both starts a
 * version and closes it, so an edit made moments after a document was migrated
 * cannot be folded into the imported history it happens to sit next to.
 */
export const mergeActivityEntries = (
  activity: ActivityEntry[],
  granularityMs: number = VERSION_GRANULARITY_MS_FALLBACK,
): DocVersion[] => {
  const versions: DocVersion[] = [];
  const authors: Set<string>[] = [];
  const isUngrouped = (by: string | null) =>
    by !== null && UNGROUPED_AUTHORS.includes(by);

  activity.forEach((entry) => {
    const last = versions[versions.length - 1];
    const lastAuthors = authors[authors.length - 1];

    if (
      last &&
      !isUngrouped(entry.by) &&
      !Array.from(lastAuthors ?? []).some(isUngrouped) &&
      entry.from - last.to < granularityMs &&
      entry.to - last.from < granularityMs
    ) {
      last.to = entry.to;
      last.id = String(entry.to);
    } else {
      versions.push({
        id: String(entry.to),
        from: entry.from,
        to: entry.to,
        by: [],
      });
      authors.push(new Set());
    }

    if (entry.by) {
      authors[authors.length - 1].add(entry.by);
    }
  });

  /**
   * Versions ending at the same moment are the same document but share an `id`
   * (double selection, key clash): fold them, keeping every author.
   */
  const unique = new Map<string, DocVersion>();
  versions.forEach((version, index) => {
    const known = unique.get(version.id);
    if (known) {
      known.from = Math.min(known.from, version.from);
      authors[index].forEach((author) => known.by.push(author));
      known.by = Array.from(new Set(known.by));
      return;
    }

    unique.set(version.id, { ...version, by: Array.from(authors[index]) });
  });

  return Array.from(unique.values());
};
