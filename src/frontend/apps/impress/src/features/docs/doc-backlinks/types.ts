export interface BacklinkBlock {
  /** id of the block in the source document containing the link */
  source_block_id: string;
  /** id of the targeted block in the current document, "" for a document link */
  target_block_id: string;
  /** plain text excerpt of the source block */
  excerpt: string;
}

export interface BacklinkSource {
  /** source document id */
  id: string;
  /** source document title as read live on the backend (may be null/empty) */
  title: string | null;
  links: BacklinkBlock[];
}

export interface BacklinksResponse {
  /** number of visible source groups (never a global total) */
  count: number;
  results: BacklinkSource[];
}
