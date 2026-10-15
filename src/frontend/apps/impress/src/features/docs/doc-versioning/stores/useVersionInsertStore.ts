import { create } from 'zustand';

import type { ReinsertBlock } from '../utils';

/**
 * What the history modal hands over once the user has confirmed *which*
 * blocks to retrieve: copies detached from the historical document (ids
 * already stripped), tagged with the document and version they came from.
 *
 * From this point the modal is closed and the live document is in charge of
 * asking *where* to insert them. Nothing here touches the live document
 * yet — insertion goes through the live editor like any other edit, so it
 * is synced to collaborators by the normal collaboration channel.
 */
export interface PendingVersionInsert {
  docId: string;
  versionId: string;
  blocks: ReinsertBlock[];
}

interface VersionInsertStore {
  pending: PendingVersionInsert | undefined;
  startReinsert: (pending: PendingVersionInsert) => void;
  cancelReinsert: () => void;
}

export const useVersionInsertStore = create<VersionInsertStore>((set) => ({
  pending: undefined,
  startReinsert: (pending) => set({ pending }),
  cancelReinsert: () => set({ pending: undefined }),
}));
