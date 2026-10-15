import { UseQueryOptions, useQuery } from '@tanstack/react-query';

import { APIError, errorCauses, fetchAPI } from '@/api';

import { BacklinksResponse } from '../types';

export type BacklinksParams = {
  id: string;
};

/** How often the panel refreshes while it is open. */
export const BACKLINKS_POLL_INTERVAL = 30_000;

export const getBacklinks = async ({
  id,
}: BacklinksParams): Promise<BacklinksResponse> => {
  const response = await fetchAPI(`documents/${id}/backlinks/`);

  if (!response.ok) {
    throw new APIError(
      'Failed to get the documents referencing this document',
      await errorCauses(response),
    );
  }

  return response.json() as Promise<BacklinksResponse>;
};

export const KEY_BACKLINKS = 'backlinks';

/**
 * Documents referencing the current one, filtered by the backend for what the
 * current user may see. Enabled only when the panel needs it so the polling
 * does not run for users who never open it.
 */
export function useBacklinks(
  param: BacklinksParams | undefined,
  queryConfig?: Partial<UseQueryOptions<BacklinksResponse, APIError>>,
) {
  const id = param?.id;

  return useQuery<BacklinksResponse, APIError>({
    queryKey: [KEY_BACKLINKS, id],
    queryFn: () => {
      if (!id) {
        throw new Error(
          'The backlinks query was enabled without a document id.',
        );
      }
      return getBacklinks({ id });
    },
    enabled: !!id,
    refetchOnWindowFocus: true,
    refetchInterval: BACKLINKS_POLL_INTERVAL,
    ...queryConfig,
  });
}
