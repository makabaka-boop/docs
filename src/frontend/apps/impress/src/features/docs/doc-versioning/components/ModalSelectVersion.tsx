import {
  Button,
  Modal,
  ModalSize,
  useModal,
} from '@gouvfr-lasuite/ui-components';
import dynamic from 'next/dynamic';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { createGlobalStyle, css } from 'styled-components';

import { Box, ButtonCloseModal, Text } from '@/components';
import type { DocsBlockNoteEditor } from '@/docs/doc-editor/index';
import { Doc } from '@/docs/doc-management';

import { useVersionInsertStore } from '../stores/useVersionInsertStore';
import type { DocVersion } from '../types';
import {
  cloneBlocksForReinsert,
  pickBlocksInDocumentOrder,
} from '../utils';

import { DocVersionEditor } from './DocVersionEditor';
import { VersionBlockSelector } from './VersionBlockSelector';
import { VersionList } from './VersionList';

const ModalConfirmationVersion = dynamic(
  () =>
    import('./ModalConfirmationVersion').then((mod) => ({
      default: mod.ModalConfirmationVersion,
    })),
  { ssr: false },
);

const NoPaddingStyle = createGlobalStyle`
  .c__modal__scroller:has(.noPadding) {
    padding: 0 !important;

    .c__modal__close .c__button {
    right: 0;
      top: 7px;
      padding: 1rem 0.5rem;
    }
  }
`;

type ModalSelectVersionProps = {
  doc: Doc;
  onClose: () => void;
};

export const ModalSelectVersion = ({
  onClose,
  doc,
}: ModalSelectVersionProps) => {
  const { t } = useTranslation();
  const [selectedVersionId, setSelectedVersionId] =
    useState<DocVersion['id']>();
  const [selectedBlockIds, setSelectedBlockIds] = useState<string[]>([]);
  const [versionEditor, setVersionEditor] = useState<DocsBlockNoteEditor>();
  const canRestore = doc.abilities.partial_update;
  const restoreModal = useModal();
  const startReinsert = useVersionInsertStore(
    (state) => state.startReinsert,
  );

  const handleSelectVersion = useCallback(
    (versionId: DocVersion['id']) => {
      // switching versions discards the unconfirmed block choice
      setSelectedBlockIds([]);
      setSelectedVersionId(versionId);
    },
    [],
  );

  const handleEditorReady = useCallback((editor: DocsBlockNoteEditor) => {
    setVersionEditor(editor);
  }, []);

  /**
   * Partial retrieval: snapshot the selected top-level blocks (with their
   * children), detached from the historical document and with fresh ids, then
   * close the modal so the live document can ask where to insert them. The
   * current document is never replaced, so every edit made since this
   * version — including ones made while this modal was open — stays.
   */
  const handleReinsert = useCallback(() => {
    if (!selectedVersionId || !versionEditor) {
      return;
    }

    const blocks = pickBlocksInDocumentOrder(
      versionEditor.document,
      selectedBlockIds,
    );

    if (blocks.length === 0) {
      return;
    }

    startReinsert({
      docId: doc.id,
      versionId: selectedVersionId,
      blocks: cloneBlocksForReinsert(blocks),
    });
    onClose();
  }, [
    doc.id,
    onClose,
    selectedBlockIds,
    selectedVersionId,
    startReinsert,
    versionEditor,
  ]);

  return (
    <>
      <Modal
        isOpen
        hideCloseButton
        closeOnClickOutside={true}
        size={ModalSize.EXTRA_LARGE}
        onClose={onClose}
        aria-label={t('Version history')}
      >
        <NoPaddingStyle />
        <Box
          className="--docs--modal-select-version noPadding"
          $direction="row"
          $height="100%"
          $maxHeight="calc(100vh - 2em - 12px)"
          $overflow="hidden"
        >
          <Text
            as="h1"
            $margin="0"
            id="modal-select-version-title"
            className="sr-only"
          >
            {t('Version history')}
          </Text>
          <Box
            $direction="column"
            $css={css`
              flex: 1;
              overflow: hidden;
              min-width: 0;
            `}
          >
            {canRestore && selectedVersionId && versionEditor && (
              <VersionBlockSelector
                key={selectedVersionId}
                editor={versionEditor}
                selectedIds={selectedBlockIds}
                onChangeSelectedIds={setSelectedBlockIds}
                onConfirm={handleReinsert}
              />
            )}
            <Box
              $css={css`
                display: flex;
                flex-direction: row;
                justify-content: center;
                overflow-y: auto;
                flex: 1;
                min-height: 0;
              `}
            >
              <Box
                $width="100%"
                $padding={{ horizontal: 'base', vertical: 'xl' }}
                $align="center"
              >
                {selectedVersionId && (
                  <DocVersionEditor
                    docId={doc.id}
                    versionId={selectedVersionId}
                    onEditorReady={handleEditorReady}
                  />
                )}
                {!selectedVersionId && (
                  <Box $align="center" $justify="center" $height="100%">
                    <Text $size="h6" $weight="bold">
                      {t('Select a version on the right to restore')}
                    </Text>
                  </Box>
                )}
              </Box>
            </Box>
          </Box>
          <Box
            $direction="column"
            $justify="space-between"
            $width="250px"
            $height="calc(100vh - 2em - 12px)"
            $css={css`
              overflow-y: hidden;
              border-left: 1px solid
                var(--c--contextuals--border--surface--primary);
            `}
          >
            <Box
              aria-label={t('Version list')}
              $css={css`
                overflow-y: auto;
                flex: 1;
              `}
            >
              <Box
                $width="100%"
                $justify="space-between"
                $direction="row"
                $align="center"
                $css={css`
                  border-bottom: 1px solid
                    var(--c--contextuals--border--surface--primary);
                `}
                $padding="sm"
              >
                <Text $size="h6" $weight="bold">
                  {t('History')}
                </Text>
                <ButtonCloseModal
                  aria-label={t('Close the version history modal')}
                  autoFocus
                  onClick={onClose}
                  size="nano"
                />
              </Box>

              <VersionList
                doc={doc}
                onSelectVersion={handleSelectVersion}
                selectedVersionId={selectedVersionId}
              />
            </Box>
            {canRestore && (
              <Box
                $padding="xs"
                $css={css`
                  border-top: 1px solid
                    var(--c--contextuals--border--surface--primary);
                `}
              >
                <Button
                  fullWidth
                  disabled={!selectedVersionId}
                  onClick={restoreModal.open}
                >
                  {t('Restore')}
                </Button>
              </Box>
            )}
          </Box>
        </Box>
      </Modal>
      {restoreModal.isOpen && selectedVersionId && (
        <ModalConfirmationVersion
          onClose={() => {
            restoreModal.close();
          }}
          onSuccess={() => {
            restoreModal.close();
            onClose();
            setSelectedVersionId(undefined);
          }}
          docId={doc.id}
          versionId={selectedVersionId}
        />
      )}
    </>
  );
};
