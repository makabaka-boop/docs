import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { APIError } from '@/api';
import { AppWrapper } from '@/tests/utils';

import { BACKLINKS_POLL_INTERVAL, useBacklinks } from '../useBacklinks';

const mockFetchAPI = vi.fn();

vi.mock('@/api', async () => {
  const actual = await vi.importActual<typeof import('@/api')>('@/api');
  return {
    ...actual,
    fetchAPI: (...args: Parameters<typeof actual.fetchAPI>) =>
      mockFetchAPI(...args),
  };
});

const DOC_ID = 'a1b2c3d4-e5f6-4789-a123-1234567890ab';

const backlinksPayload = {
  count: 1,
  results: [
    {
      id: '11111111-1111-1111-1111-111111111111',
      title: 'Source doc',
      links: [
        {
          source_block_id: 'block-1',
          target_block_id: '',
          excerpt: 'see this',
        },
      ],
    },
  ],
};

describe('useBacklinks', () => {
  beforeEach(() => {
    mockFetchAPI.mockReset();
  });

  it('fetches and maps the backlinks of the document', async () => {
    mockFetchAPI.mockResolvedValue({
      ok: true,
      json: async () => backlinksPayload,
    });

    const { result } = renderHook(() => useBacklinks({ id: DOC_ID }), {
      wrapper: AppWrapper,
    });

    expect(mockFetchAPI).toHaveBeenCalledWith(`documents/${DOC_ID}/backlinks/`);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(backlinksPayload);
  });

  it('does not request when no document id is provided', () => {
    renderHook(() => useBacklinks(undefined), { wrapper: AppWrapper });

    expect(mockFetchAPI).not.toHaveBeenCalled();
  });

  it('can be disabled (panel closed)', () => {
    renderHook(() => useBacklinks({ id: DOC_ID }, { enabled: false }), {
      wrapper: AppWrapper,
    });

    expect(mockFetchAPI).not.toHaveBeenCalled();
  });

  it('turns an API error into an APIError', async () => {
    mockFetchAPI.mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ detail: 'Forbidden' }),
    });

    const { result } = renderHook(() => useBacklinks({ id: DOC_ID }), {
      wrapper: AppWrapper,
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(APIError);
    expect(result.current.error?.status).toBe(403);
  });

  it('polls every 30 seconds while enabled', () => {
    expect(BACKLINKS_POLL_INTERVAL).toBe(30_000);
  });
});
