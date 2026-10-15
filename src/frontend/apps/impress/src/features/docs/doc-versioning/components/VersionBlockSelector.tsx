import { Button } from '@gouvfr-lasuite/ui-components';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { createGlobalStyle, css } from 'styled-components';

import { Box, Text } from '@/components';
import type { DocsBlockNoteEditor } from '@/docs/doc-editor/index';

import {
  BLOCK_CONTAINER_SELECTOR,
  findBlockContainer,
  getTopLevelBlockId,
} from '../utils';

const SELECTOR_CLASS = '--docs--version-block-selector';

/**
 * Selection states painted on the preview's block containers. The preview is
 * a static, read-only document, so the attributes only have to be re-applied
 * when blocks are selected or the preview editor is replaced.
 */
const VersionSelectorStyle = createGlobalStyle`
  .${SELECTOR_CLASS} {
    user-select: none;
    -webkit-user-select: none;
  }

  .${SELECTOR_CLASS} ${BLOCK_CONTAINER_SELECTOR} {
    cursor: pointer;
    border-radius: 4px;
  }

  .${SELECTOR_CLASS} ${BLOCK_CONTAINER_SELECTOR}[data-version-selected="true"] {
    outline: 2px solid
      var(--c--contextuals--border--semantic--brand--primary);
    outline-offset: -2px;
    background-color:
      var(--c--contextuals--background--semantic--overlay--primary);
  }

  .${SELECTOR_CLASS} ${BLOCK_CONTAINER_SELECTOR}[data-version-cursor="true"] {
    outline: 2px dashed
      var(--c--contextuals--border--semantic--brand--primary);
    outline-offset: -2px;
  }
`;

interface VersionBlockSelectorProps {
  editor: DocsBlockNoteEditor;
  selectedIds: string[];
  onChangeSelectedIds: (ids: string[]) => void;
  onConfirm: () => void;
}

/**
 * Turns the read-only preview of a past version into a multi-select list of
 * complete top-level blocks.
 *
 * Mouse and the keyboard do the same thing: click / Space toggles the block
 * under the cursor, arrows move between blocks (Shift extends the range),
 * Enter confirms and Escape clears. Nested blocks are never selected on
 * their own — a hit inside a child selects its outermost ancestor, so what
 * moves is always a complete top-level block with its children.
 */
export const VersionBlockSelector = ({
  editor,
  selectedIds,
  onChangeSelectedIds,
  onConfirm,
}: VersionBlockSelectorProps) => {
  const { t } = useTranslation();

  // The historical document never changes, but recompute on editor changes
  // anyway: the editor is replaced whenever another version is picked.
  const [, setTick] = useState(0);
  useEffect(() => {
    return editor.onChange(() => setTick((value) => value + 1));
  }, [editor]);

  const topLevelIds = editor.document.map((block) => block.id);
  const topLevelKey = topLevelIds.join('|');

  // A block removed from the preview (another version was loaded) cannot
  // stay selected.
  useEffect(() => {
    const existing = new Set(topLevelIds);
    const pruned = selectedIds.filter((id) => existing.has(id));

    if (pruned.length !== selectedIds.length) {
      onChangeSelectedIds(pruned);
    }
    // topLevelKey stands in for the recomputed topLevelIds
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topLevelKey]);

  const [cursorId, setCursorId] = useState<string | undefined>(() =>
    topLevelIds.includes(selectedIds[selectedIds.length - 1] ?? '')
      ? selectedIds[selectedIds.length - 1]
      : topLevelIds[0],
  );

  // The cursor always points at an existing block, including after the editor
  // is replaced.
  useEffect(() => {
    if (!cursorId || !topLevelIds.includes(cursorId)) {
      setCursorId(topLevelIds[0]);
    }
  }, [topLevelIds, cursorId]);

  // The read-only editor's DOM only exists once BlockNoteView has mounted it,
  // which can be a frame after this component renders.
  const [root, setRoot] = useState<HTMLElement | null>(null);

  const selectBetween = useCallback(
    (anchorId: string | undefined, targetId: string, next: boolean) => {
      if (!anchorId) {
        onChangeSelectedIds(
          next ? Array.from(new Set([...selectedIds, targetId])) : [targetId],
        );
        return;
      }

      const anchorIndex = topLevelIds.indexOf(anchorId);
      const targetIndex = topLevelIds.indexOf(targetId);
      const range = topLevelIds.slice(
        Math.min(anchorIndex, targetIndex),
        Math.max(anchorIndex, targetIndex) + 1,
      );

      onChangeSelectedIds(
        next ? Array.from(new Set([...selectedIds, ...range])) : range,
      );
    },
    [onChangeSelectedIds, selectedIds, topLevelIds],
  );

  const toggleBlock = useCallback(
    (id: string, extend: boolean) => {
      if (extend) {
        const anchor = selectedIds[selectedIds.length - 1];
        selectBetween(anchor, id, !selectedIds.includes(id));
        setCursorId(id);
        return;
      }

      onChangeSelectedIds(
        selectedIds.includes(id)
          ? selectedIds.filter((selected) => selected !== id)
          : [...selectedIds, id],
      );
      setCursorId(id);
    },
    [onChangeSelectedIds, selectBetween, selectedIds],
  );

  const moveCursor = useCallback(
    (delta: number) => {
      if (topLevelIds.length === 0) {
        return;
      }

      const currentIndex = cursorId ? topLevelIds.indexOf(cursorId) : -1;
      const nextIndex =
        currentIndex === -1
          ? delta > 0
            ? 0
            : topLevelIds.length - 1
          : Math.min(topLevelIds.length - 1, Math.max(0, currentIndex + delta));

      setCursorId(topLevelIds[nextIndex]);
    },
    [cursorId, topLevelIds],
  );

  // Paint selection / cursor state and listbox semantics on the editor DOM.
  // BlockNote owns this DOM, which is why attributes are set imperatively and
  // restored on cleanup.
  const rootRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    let frame: number | undefined;

    const apply = () => {
      const rootElement = editor.domElement;
      if (!rootElement) {
        frame = requestAnimationFrame(apply);
        return;
      }

      rootRef.current = rootElement;
      setRoot(rootElement);
      rootElement.classList.add(SELECTOR_CLASS);
      rootElement.setAttribute('role', 'listbox');
      rootElement.setAttribute('aria-multiselectable', 'true');
      rootElement.setAttribute('aria-label', t('Blocks of the selected version'));
      rootElement.setAttribute('tabindex', '0');

      topLevelIds.forEach((id) => {
        const element = findBlockContainer(rootElement, id);
        if (!element) {
          return;
        }

        element.setAttribute('role', 'option');
        element.setAttribute(
          'aria-selected',
          selectedIds.includes(id) ? 'true' : 'false',
        );
        element.setAttribute('tabindex', cursorId === id ? '0' : '-1');
        element.dataset.versionSelected = selectedIds.includes(id)
          ? 'true'
          : 'false';
        if (cursorId === id) {
          element.dataset.versionCursor = 'true';
        } else {
          delete element.dataset.versionCursor;
        }
      });
    };

    frame = requestAnimationFrame(apply);

    return () => {
      if (frame) {
        cancelAnimationFrame(frame);
      }

      const rootElement = rootRef.current;
      rootElement?.classList.remove(SELECTOR_CLASS);
      rootElement?.removeAttribute('role');
      rootElement?.removeAttribute('aria-multiselectable');
      rootElement?.removeAttribute('aria-label');
      rootElement?.removeAttribute('tabindex');
      rootElement
        ?.querySelectorAll(`[data-node-type="blockContainer"]`)
        .forEach((element) => {
          element.removeAttribute('role');
          element.removeAttribute('aria-selected');
          element.removeAttribute('tabindex');
          delete (element as HTMLElement).dataset.versionSelected;
          delete (element as HTMLElement).dataset.versionCursor;
        });
    };
  }, [editor, topLevelIds, selectedIds, cursorId, t]);

  // Keep focus on the cursor option while moving with the keyboard.
  useEffect(() => {
    if (!root || !cursorId) {
      return;
    }

    const element = findBlockContainer(root, cursorId);
    element?.focus({ preventScroll: true });
    element?.scrollIntoView({ block: 'nearest' });
  }, [root, cursorId]);

  // Mouse selection.
  useEffect(() => {
    if (!root) {
      return;
    }

    const onPointerDown = (event: PointerEvent) => {
      const id = getTopLevelBlockId(editor, event.target as Element | null);
      if (id) {
        // the preview is not editable; stop the native text selection
        event.preventDefault();
      }
    };

    const onClick = (event: MouseEvent) => {
      const id = getTopLevelBlockId(editor, event.target as Element | null);
      if (!id) {
        return;
      }

      toggleBlock(id, event.shiftKey);
    };

    root.addEventListener('pointerdown', onPointerDown);
    root.addEventListener('click', onClick);

    return () => {
      root.removeEventListener('pointerdown', onPointerDown);
      root.removeEventListener('click', onClick);
    };
  }, [root, editor, toggleBlock]);

  // Keyboard selection. Listener lives on the listbox root and catches the
  // roving-focus options too.
  useEffect(() => {
    if (!root) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      switch (event.key) {
        case 'ArrowDown':
          event.preventDefault();
          moveCursor(1);
          break;
        case 'ArrowUp':
          event.preventDefault();
          moveCursor(-1);
          break;
        case 'Home':
          event.preventDefault();
          setCursorId(topLevelIds[0]);
          break;
        case 'End':
          event.preventDefault();
          setCursorId(topLevelIds[topLevelIds.length - 1]);
          break;
        case ' ':
        case 'Enter': {
          if (!cursorId) {
            return;
          }
          event.preventDefault();
          if (event.key === 'Enter' && selectedIds.length > 0) {
            onConfirm();
            return;
          }
          toggleBlock(cursorId, event.shiftKey);
          break;
        }
        case 'Escape':
          event.preventDefault();
          onChangeSelectedIds([]);
          break;
        default:
      }
    };

    root.addEventListener('keydown', onKeyDown);

    return () => root.removeEventListener('keydown', onKeyDown);
  }, [
    root,
    editor,
    moveCursor,
    cursorId,
    topLevelIds,
    toggleBlock,
    selectedIds.length,
    onConfirm,
    onChangeSelectedIds,
  ]);

  const selectedCount = selectedIds.length;

  return (
    <Box
      className="--docs--version-block-selector-bar"
      $direction="row"
      $align="center"
      $gap="xs"
      $padding="xs"
      $css={css`
        border-bottom: 1px solid var(--c--contextuals--border--surface--primary);
        flex-wrap: wrap;
      `}
    >
      <VersionSelectorStyle />
      <Box $direction="column" $gap="2px" $css="flex: 1; min-width: 12rem;">
        <Text $size="sm" $weight="bold">
          {t('Retrieve blocks from this version')}
        </Text>
        <Text $size="xs" $variation="secondary">
          {t(
            'Click blocks to select them, or use the arrow keys and Space. Enter retrieves, Escape clears.',
          )}
        </Text>
      </Box>
      <Text className="sr-only" aria-live="polite">
        {t('{{count}} blocks selected', { count: selectedCount })}
      </Text>
      <Button
        variant="secondary"
        size="small"
        disabled={selectedCount === 0}
        aria-label={t('Clear the block selection')}
        onClick={() => onChangeSelectedIds([])}
      >
        {t('Clear')}
      </Button>
      <Button
        size="small"
        disabled={selectedCount === 0}
        onClick={onConfirm}
      >
        {t('Retrieve selected blocks')}
      </Button>
    </Box>
  );
};
