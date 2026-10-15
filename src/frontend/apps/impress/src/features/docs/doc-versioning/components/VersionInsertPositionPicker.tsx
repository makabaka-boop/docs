import {
  Button,
  type ButtonElement,
  VariantType,
  useToastProvider,
} from '@gouvfr-lasuite/ui-components';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { createGlobalStyle, css } from 'styled-components';

import { Box, Card, Text } from '@/components';
import { useEditorStore } from '@/docs/doc-editor';

import { useVersionInsertStore } from '../stores/useVersionInsertStore';
import {
  BLOCK_CONTAINER_SELECTOR,
  findBlockContainer,
  getTopLevelBlockId,
} from '../utils';

const PICKER_CLASS = '--docs--insert-position-picker';
const BANNER_CLASS = '--docs--insert-position-banner';
const POPOVER_CLASS = '--docs--insert-position-popover';

const PickerStyle = createGlobalStyle`
  /* While choosing where the blocks go, the document must not be editable by
     accident: no side menu, no drag handles, no text selection. */
  .${PICKER_CLASS} .bn-side-menu,
  .${PICKER_CLASS} .bn-table-handles {
    display: none !important;
  }

  .${PICKER_CLASS} .ProseMirror {
    user-select: none;
    -webkit-user-select: none;
  }

  .${PICKER_CLASS} ${BLOCK_CONTAINER_SELECTOR}[data-insert-target="true"] {
    cursor: pointer;
    border-radius: 4px;
  }

  .${PICKER_CLASS} ${BLOCK_CONTAINER_SELECTOR}[data-insert-target="true"]:hover,
  .${PICKER_CLASS} ${BLOCK_CONTAINER_SELECTOR}[data-insert-cursor="true"] {
    outline: 2px dashed
      var(--c--contextuals--border--semantic--brand--primary);
    outline-offset: -2px;
  }

  .${PICKER_CLASS} ${BLOCK_CONTAINER_SELECTOR}[data-insert-reference="true"] {
    outline: 2px solid
      var(--c--contextuals--border--semantic--brand--primary);
    outline-offset: -2px;
    background-color:
      var(--c--contextuals--background--semantic--overlay--primary);
  }

  .${BANNER_CLASS} {
    position: fixed;
    bottom: 1.5rem;
    left: 50%;
    transform: translateX(-50%);
    z-index: 1600;
    width: min(720px, 92vw);
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15);
  }

  .${POPOVER_CLASS} {
    position: fixed;
    z-index: 1700;
  }
`;

type InsertKind = 'start' | 'end' | 'before' | 'after';

interface PopoverPosition {
  top: number;
  left: number;
}

interface VersionInsertPositionPickerProps {
  docId: string;
}

/**
 * Second step of retrieving blocks from a past version: the history modal is
 * closed and this asks where the copies go in the *live* document — at the
 * start, at the end, or before / after a chosen block.
 *
 * The live document stays editable by collaborators the whole time, so the
 * block picked as an anchor can disappear before confirmation. That is
 * checked at confirmation time (and on every remote change): if it is gone,
 * nothing is inserted and the user is asked to pick another position.
 *
 * Insertion itself is a plain `editor.insertBlocks`, i.e. one more
 * collaborative edit: it reaches every other open editor through the normal
 * channel and never replaces anything.
 */
export const VersionInsertPositionPicker = ({
  docId,
}: VersionInsertPositionPickerProps) => {
  const { t } = useTranslation();
  const { toast } = useToastProvider();
  const pending = useVersionInsertStore((state) => state.pending);
  const cancelReinsert = useVersionInsertStore((state) => state.cancelReinsert);
  const editor = useEditorStore((state) => state.editor);

  const active = !!pending && pending.docId === docId;

  const [tick, setTick] = useState(0);
  const [cursorId, setCursorId] = useState<string | undefined>(undefined);
  const [referenceId, setReferenceId] = useState<string | null>(null);
  const [position, setPosition] = useState<PopoverPosition | undefined>(
    undefined,
  );
  const [error, setError] = useState<string | undefined>(undefined);
  const [shouldFocusPopover, setShouldFocusPopover] = useState(false);

  const beforeButtonRef = useRef<ButtonElement>(null);
  const pendingRef = useRef(pending);
  pendingRef.current = pending;
  const editorRef = useRef(editor);
  editorRef.current = editor;

  // Switching documents discards an unconfirmed retrieval from another one.
  useEffect(() => {
    if (pending && pending.docId !== docId) {
      cancelReinsert();
    }
  }, [pending, docId, cancelReinsert]);

  // Leaving the page discards it as well — but only if it concerns this doc.
  useEffect(() => {
    return () => {
      if (pendingRef.current?.docId === docId) {
        cancelReinsert();
      }
    };
  }, [docId, cancelReinsert]);

  // When the flow starts, move focus into the document itself: picking a
  // position is the main path, and the banner's start/end/cancel actions are
  // one Tab away. Wait for the editor's DOM if it is still mounting.
  useEffect(() => {
    if (!active || !editor) {
      return;
    }

    let frame: number | undefined;

    const focusWhenReady = () => {
      const root = editor.domElement;
      if (root) {
        root.focus();
        return;
      }

      frame = requestAnimationFrame(focusWhenReady);
    };

    frame = requestAnimationFrame(focusWhenReady);

    return () => {
      if (frame) {
        cancelAnimationFrame(frame);
      }
    };
  }, [active, editor]);

  const moveCursor = useCallback((delta: number) => {
    const currentEditor = editorRef.current;
    if (!currentEditor) {
      return;
    }

    const ids = currentEditor.document.map((block) => block.id);
    if (ids.length === 0) {
      return;
    }

    setCursorId((previous) => {
      const currentIndex = previous ? ids.indexOf(previous) : -1;
      const nextIndex =
        currentIndex === -1
          ? delta > 0
            ? 0
            : ids.length - 1
          : Math.min(ids.length - 1, Math.max(0, currentIndex + delta));

      return ids[nextIndex];
    });
  }, []);

  const openReference = useCallback((id: string, focusPopover: boolean) => {
    setError(undefined);
    setCursorId(id);
    setReferenceId(id);
    setShouldFocusPopover(focusPopover);
  }, []);

  const closeReference = useCallback((focusEditor: boolean) => {
    setReferenceId(null);
    setShouldFocusPopover(false);
    setPosition(undefined);

    if (focusEditor) {
      requestAnimationFrame(() => {
        const currentEditor = editorRef.current;
        const root = currentEditor?.domElement;
        if (!root) {
          return;
        }
        root.focus();
      });
    }
  }, []);

  /**
   * The one mutation of the live document. Validates the anchor immediately
   * before inserting: a collaborator may have deleted it since it was
   * picked.
   */
  const applyInsert = useCallback(
    (kind: InsertKind) => {
      const currentPending = pendingRef.current;
      const currentEditor = editorRef.current;

      if (!currentPending || currentPending.docId !== docId) {
        return;
      }

      if (!currentEditor || !currentEditor.isEditable) {
        // Permissions changed while the modal was open: do not even try.
        toast(
          t(
            'You can no longer edit this document, so the blocks were not retrieved.',
          ),
          VariantType.ERROR,
        );
        cancelReinsert();
        return;
      }

      let reference: string | undefined;
      let placement: 'before' | 'after';

      if (kind === 'start') {
        reference = currentEditor.document[0]?.id;
        placement = 'before';
      } else if (kind === 'end') {
        reference =
          currentEditor.document[currentEditor.document.length - 1]?.id;
        placement = 'after';
      } else {
        reference = referenceId ?? undefined;
        placement = kind;
      }

      const missingBlockMessage = t(
        'The block you selected no longer exists. Choose another position in the document.',
      );

      if (!reference || !currentEditor.getBlock(reference)) {
        setError(missingBlockMessage);
        closeReference(false);
        return;
      }

      let inserted: { id: string }[];
      try {
        inserted = currentEditor.insertBlocks(
          currentPending.blocks,
          reference,
          placement,
        );
      } catch {
        // Race with a deletion: the anchor existed at the check but not at
        // the edit.
        setError(missingBlockMessage);
        closeReference(false);
        return;
      }

      currentEditor.focus();
      const firstInserted = inserted[0];
      if (firstInserted) {
        try {
          currentEditor.setTextCursorPosition(firstInserted.id, 'start');
        } catch {
          // the inserted block should be reachable; nothing else to do if not
        }
      }

      toast(
        t('The blocks were retrieved from the version history'),
        VariantType.SUCCESS,
      );
      cancelReinsert();
    },
    [docId, referenceId, t, toast, cancelReinsert, closeReference],
  );

  // Follow live changes: repaint options, and notice it when a collaborator
  // deletes the picked anchor.
  useEffect(() => {
    if (!active || !editor) {
      return;
    }

    return editor.onChange(() => {
      setTick((value) => value + 1);

      setReferenceId((previous) => {
        if (previous && !editor.getBlock(previous)) {
          setError(
            t(
              'The block you selected no longer exists. Choose another position in the document.',
            ),
          );
          setPosition(undefined);
          return null;
        }

        return previous;
      });

      setCursorId((previous) =>
        previous && !editor.getBlock(previous)
          ? (editor.document[0]?.id ?? undefined)
          : previous,
      );
    });
  }, [active, editor, t]);

  // Paint the picker affordances on the live editor DOM.
  useEffect(() => {
    if (!active || !editor) {
      return;
    }

    const root = editor.domElement;
    const wrapper = root?.parentElement;
    if (!root || !wrapper) {
      return;
    }

    wrapper.classList.add(PICKER_CLASS);
    root.setAttribute('role', 'listbox');
    root.setAttribute('aria-label', t('Choose where to retrieve the blocks'));
    root.setAttribute('tabindex', '0');

    editor.document.forEach((block) => {
      const element = findBlockContainer(root, block.id);
      if (!element) {
        return;
      }

      element.dataset.insertTarget = 'true';
      element.setAttribute('role', 'option');
      element.setAttribute(
        'aria-selected',
        referenceId === block.id ? 'true' : 'false',
      );
      element.setAttribute('tabindex', cursorId === block.id ? '0' : '-1');
      if (referenceId === block.id) {
        element.dataset.insertReference = 'true';
      } else {
        delete element.dataset.insertReference;
      }
      if (cursorId === block.id) {
        element.dataset.insertCursor = 'true';
      } else {
        delete element.dataset.insertCursor;
      }
    });

    return () => {
      wrapper.classList.remove(PICKER_CLASS);
      root.removeAttribute('role');
      root.removeAttribute('aria-label');
      root.removeAttribute('tabindex');
      root.querySelectorAll('[data-insert-target]').forEach((element) => {
        element.removeAttribute('role');
        element.removeAttribute('aria-selected');
        element.removeAttribute('tabindex');
        delete (element as HTMLElement).dataset.insertTarget;
        delete (element as HTMLElement).dataset.insertReference;
        delete (element as HTMLElement).dataset.insertCursor;
      });
    };
  }, [active, editor, cursorId, referenceId, tick, t]);

  // Keep the keyboard cursor in view.
  useEffect(() => {
    if (!active || !editor || !cursorId) {
      return;
    }

    const root = editor.domElement;
    if (!root) {
      return;
    }

    const element = findBlockContainer(root, cursorId);
    element?.focus({ preventScroll: true });
    element?.scrollIntoView({ block: 'nearest' });
  }, [active, editor, cursorId]);

  // Mouse + keyboard on the live editor.
  useEffect(() => {
    if (!active || !editor) {
      return;
    }

    const root = editor.domElement;
    const wrapper = root?.parentElement;
    if (!root || !wrapper) {
      return;
    }

    // Freeze ordinary editing while choosing: no caret placement, no
    // trailing-block creation, no drag or table handles.
    const onPointerDown = (event: PointerEvent) => {
      // stopImmediatePropagation, not just preventDefault: ProseMirror
      // applies its own handling inside its pointerdown listener, so the
      // event must not reach it at all.
      event.preventDefault();
      event.stopImmediatePropagation();
    };

    const onPaste = (event: Event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
    };

    const onClick = (event: MouseEvent) => {
      // capture, before ProseMirror's click handler places the caret
      event.preventDefault();
      event.stopImmediatePropagation();

      const id = getTopLevelBlockId(editor, event.target as Element | null);
      if (id) {
        openReference(id, false);
      }
    };

    const PASS_KEYS = new Set([
      'Tab',
      'Shift',
      'Alt',
      'Control',
      'Meta',
      'Escape',
    ]);

    // Capture phase, before ProseMirror's own keydown listener: it edits in
    // the listener itself, so a later preventDefault would come too late.
    const onKeyDown = (event: KeyboardEvent) => {
      let handled = true;
      switch (event.key) {
        case 'ArrowDown':
          moveCursor(1);
          break;
        case 'ArrowUp':
          moveCursor(-1);
          break;
        case 'Home':
          setCursorId(editor.document[0]?.id);
          break;
        case 'End':
          setCursorId(editor.document[editor.document.length - 1]?.id);
          break;
        case 'Enter':
        case ' ': {
          const id = cursorId ?? editor.document[0]?.id;
          if (id) {
            openReference(id, true);
          }
          break;
        }
        default:
          handled = false;
      }

      const letsThrough =
        PASS_KEYS.has(event.key) ||
        event.key.startsWith('F') ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey;

      if (handled || !letsThrough) {
        // never let the editor see typing or our navigation keys
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    };

    wrapper.addEventListener('pointerdown', onPointerDown, { capture: true });
    wrapper.addEventListener('click', onClick, { capture: true });
    wrapper.addEventListener('paste', onPaste, { capture: true });
    wrapper.addEventListener('drop', onPaste, { capture: true });
    wrapper.addEventListener('keydown', onKeyDown, { capture: true });

    return () => {
      wrapper.removeEventListener('pointerdown', onPointerDown, {
        capture: true,
      });
      wrapper.removeEventListener('click', onClick, { capture: true });
      wrapper.removeEventListener('paste', onPaste, { capture: true });
      wrapper.removeEventListener('drop', onPaste, { capture: true });
      wrapper.removeEventListener('keydown', onKeyDown, { capture: true });
    };
  }, [active, editor, moveCursor, openReference, cursorId]);

  // Escape: closes the before/after choice first, then cancels the flow.
  useEffect(() => {
    if (!active) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      if (referenceId) {
        closeReference(true);
      } else {
        cancelReinsert();
      }
    };

    document.addEventListener('keydown', onKeyDown, { capture: true });

    return () =>
      document.removeEventListener('keydown', onKeyDown, { capture: true });
  }, [active, referenceId, closeReference, cancelReinsert]);

  // Position the before/after popover against the picked block and keep it
  // there while scrolling.
  useEffect(() => {
    if (!active || !editor || !referenceId) {
      setPosition(undefined);
      return;
    }

    const root = editor.domElement;
    const element = root ? findBlockContainer(root, referenceId) : undefined;
    if (!element) {
      return;
    }

    const POPOVER_HEIGHT = 52;
    const POPOVER_WIDTH = 248;

    const compute = () => {
      const rect = element.getBoundingClientRect();
      const above = rect.bottom + POPOVER_HEIGHT > window.innerHeight;
      setPosition({
        top: above
          ? Math.max(8, rect.top - POPOVER_HEIGHT + 8)
          : rect.bottom + 6,
        left: Math.max(
          8,
          Math.min(rect.left, window.innerWidth - POPOVER_WIDTH - 8),
        ),
      });
    };

    compute();
    window.addEventListener('scroll', compute, true);
    window.addEventListener('resize', compute);

    return () => {
      window.removeEventListener('scroll', compute, true);
      window.removeEventListener('resize', compute);
    };
    // tick: a collaborator inserting content above the anchor moves it; the
    // effect re-runs and the popover is repositioned
  }, [active, editor, referenceId, tick]);

  // Keyboard-opened popover moves focus to its first action.
  useEffect(() => {
    if (referenceId && shouldFocusPopover) {
      beforeButtonRef.current?.focus();
      setShouldFocusPopover(false);
    }
  }, [referenceId, shouldFocusPopover]);

  if (!active || !pending) {
    return null;
  }

  const count = pending.blocks.length;

  return (
    <>
      <PickerStyle />
      <Card
        role="region"
        aria-label={t('Retrieve blocks from a past version')}
        className={BANNER_CLASS}
        $direction="column"
        $gap="xs"
        $padding="sm"
      >
        <Box $direction="row" $align="center" $gap="xs">
          <Text $size="sm" $weight="bold" $css="flex: 1;">
            {t('Retrieve blocks from a past version')}
          </Text>
          <Button size="small" variant="secondary" onClick={cancelReinsert}>
            {t('Cancel')}
          </Button>
        </Box>
        <Text $size="xs" $variation="secondary">
          {t(
            '{{count}} selected block(s) will be inserted where you choose. Click a block to insert before or after it, or insert directly at the start or end.',
            { count },
          )}
        </Text>
        <Box $direction="row" $gap="xs" $css="flex-wrap: wrap;">
          <Button size="small" onClick={() => applyInsert('start')}>
            {t('Insert at the start')}
          </Button>
          <Button size="small" onClick={() => applyInsert('end')}>
            {t('Insert at the end')}
          </Button>
        </Box>
        {error && (
          <Text $size="xs" $theme="danger" role="alert">
            {error}
          </Text>
        )}
      </Card>

      {referenceId &&
        position &&
        createPortal(
          <Card
            className={POPOVER_CLASS}
            role="dialog"
            aria-label={t('Insert before or after the selected block')}
            $direction="row"
            $gap="xs"
            $padding="xs"
            $css={css`
              top: ${position.top}px;
              left: ${position.left}px;
            `}
          >
            <Button
              ref={beforeButtonRef}
              size="small"
              onClick={() => applyInsert('before')}
            >
              {t('Insert before')}
            </Button>
            <Button size="small" onClick={() => applyInsert('after')}>
              {t('Insert after')}
            </Button>
          </Card>,
          document.body,
        )}
    </>
  );
};
