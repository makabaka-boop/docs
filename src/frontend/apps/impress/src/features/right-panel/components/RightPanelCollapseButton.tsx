import { useEffect, useState } from 'react';

import { BacklinksSideBarButton } from '@/docs/doc-backlinks';
import { CommentSideBarButton } from '@/docs/doc-comments/components/CommentSideBar';
import { useThreadStore } from '@/docs/doc-comments/stores/useThreadStore';
import { useHeadingStore } from '@/docs/doc-editor/stores/useHeadingStore';
import { useDocStore } from '@/docs/doc-management';
import { TableContentSideBarButton } from '@/docs/doc-table-content/components/TableContentSideBar';

export const RightPanelCollapseButton = () => {
  const { threadStore } = useThreadStore();
  const [hasThreads, setHasThreads] = useState(
    !!threadStore?.getThreads().size,
  );
  const { headings } = useHeadingStore();
  const hasHeadings = headings.length > 0;
  const { currentDoc } = useDocStore();

  useEffect(() => {
    if (!threadStore) {
      setHasThreads(false);
      return;
    }
    return threadStore.subscribe((threads) => {
      setHasThreads(threads.size > 0);
    });
  }, [threadStore]);

  if (!currentDoc) {
    return null;
  }

  return (
    <>
      {/* Always available: it opens on documents without headings or comments too */}
      <BacklinksSideBarButton docId={currentDoc.id} />
      {hasHeadings && <TableContentSideBarButton />}
      {hasThreads && <CommentSideBarButton />}
    </>
  );
};
