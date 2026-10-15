import { fireEvent, render, screen } from '@testing-library/react';
import { useRouter } from 'next/router';
import { Mock, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppWrapper } from '@/tests/utils';

import { BacklinksResponse } from '../../types';
import { BacklinksSideBar, BacklinksSideBarButton } from '../BacklinksSideBar';

const DOC_ID = 'a1b2c3d4-e5f6-4789-a123-1234567890ab';
const SOURCE_ID = 'b1b2c3d4-e5f6-4789-a123-1234567890cd';

const payload: BacklinksResponse = {
  count: 1,
  results: [
    {
      id: SOURCE_ID,
      title: '📄 Source document',
      links: [
        {
          source_block_id: 'block-1',
          target_block_id: '',
          excerpt: 'see this document',
        },
      ],
    },
  ],
};

let mockedState: {
  data?: BacklinksResponse;
  isLoading: boolean;
  isError: boolean;
} = {
  data: undefined,
  isLoading: true,
  isError: false,
};

vi.mock('../../api/useBacklinks', () => ({
  useBacklinks: vi.fn(() => mockedState),
}));

vi.mock('next/router', () => ({
  useRouter: vi.fn(),
}));

let mockCurrentDoc: { id: string; deleted_at: string | null } = {
  id: DOC_ID,
  deleted_at: null,
};

vi.mock('@/docs/doc-management', async () => {
  const actual = await vi.importActual('@/docs/doc-management');
  return {
    ...actual,
    useDocStore: () => ({
      currentDoc: mockCurrentDoc,
    }),
  };
});

describe('BacklinksSideBar', () => {
  const push = vi.fn();
  const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);

  beforeEach(() => {
    push.mockReset();
    openSpy.mockReset();
    mockedState = { data: undefined, isLoading: true, isError: false };
    mockCurrentDoc = { id: DOC_ID, deleted_at: null };
    (useRouter as Mock).mockReturnValue({ push });
  });

  it('renders a loader while loading', () => {
    render(<BacklinksSideBar docId={DOC_ID} onClose={vi.fn()} />, {
      wrapper: AppWrapper,
    });

    expect(document.querySelector('.c__loader')).not.toBeNull();
  });

  it('renders an empty state when there is no reference', () => {
    mockedState = {
      data: { count: 0, results: [] },
      isLoading: false,
      isError: false,
    };

    render(<BacklinksSideBar docId={DOC_ID} onClose={vi.fn()} />, {
      wrapper: AppWrapper,
    });

    expect(
      screen.getByText('No document references this one yet.'),
    ).toBeInTheDocument();
  });

  it('renders an error state when loading fails', () => {
    mockedState = { data: undefined, isLoading: false, isError: true };

    render(<BacklinksSideBar docId={DOC_ID} onClose={vi.fn()} />, {
      wrapper: AppWrapper,
    });

    expect(
      screen.getByText(
        'The documents referencing this one could not be loaded.',
      ),
    ).toBeInTheDocument();
  });

  it('groups references by source and shows title and excerpt', () => {
    mockedState = { data: payload, isLoading: false, isError: false };

    render(<BacklinksSideBar docId={DOC_ID} onClose={vi.fn()} />, {
      wrapper: AppWrapper,
    });

    expect(screen.getByText('Source document')).toBeInTheDocument();
    expect(screen.getByText('see this document')).toBeInTheDocument();
    expect(screen.getByTestId('backlinks-list')).toBeInTheDocument();
  });

  it('shows the source title once for several blocks and links each block', () => {
    const twoBlocks: BacklinksResponse = {
      count: 1,
      results: [
        {
          id: SOURCE_ID,
          title: 'Source document',
          links: [
            {
              source_block_id: 'block-1',
              target_block_id: '',
              excerpt: 'first',
            },
            {
              source_block_id: 'block-2',
              target_block_id: '',
              excerpt: 'second',
            },
          ],
        },
      ],
    };
    mockedState = { data: twoBlocks, isLoading: false, isError: false };

    render(<BacklinksSideBar docId={DOC_ID} onClose={vi.fn()} />, {
      wrapper: AppWrapper,
    });

    expect(screen.getAllByText('Source document')).toHaveLength(1);
    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(2);

    fireEvent.click(screen.getByText('second'));
    expect(push).toHaveBeenCalledWith(`/docs/${SOURCE_ID}/#block-2`);
  });

  it('falls back to the untitled label when the source title is empty', () => {
    mockedState = {
      data: {
        count: 1,
        results: [
          { id: SOURCE_ID, title: '', links: payload.results[0].links },
        ],
      },
      isLoading: false,
      isError: false,
    };

    render(<BacklinksSideBar docId={DOC_ID} onClose={vi.fn()} />, {
      wrapper: AppWrapper,
    });

    expect(screen.getByText('Untitled document')).toBeInTheDocument();
  });

  it('navigates to the source block on click', () => {
    mockedState = { data: payload, isLoading: false, isError: false };

    render(<BacklinksSideBar docId={DOC_ID} onClose={vi.fn()} />, {
      wrapper: AppWrapper,
    });

    fireEvent.click(screen.getByRole('link'));

    expect(push).toHaveBeenCalledWith(`/docs/${SOURCE_ID}/#block-1`);
    expect(openSpy).not.toHaveBeenCalled();
  });

  it.each([{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }])(
    'opens the source in a new tab on %o click',
    (modifier) => {
      mockedState = { data: payload, isLoading: false, isError: false };

      render(<BacklinksSideBar docId={DOC_ID} onClose={vi.fn()} />, {
        wrapper: AppWrapper,
      });

      fireEvent.click(screen.getByRole('link'), modifier);

      expect(openSpy).toHaveBeenCalledWith(
        `/docs/${SOURCE_ID}/#block-1`,
        '_blank',
      );
      expect(push).not.toHaveBeenCalled();
    },
  );

  it('opens the source in a new tab on middle click', () => {
    mockedState = { data: payload, isLoading: false, isError: false };

    render(<BacklinksSideBar docId={DOC_ID} onClose={vi.fn()} />, {
      wrapper: AppWrapper,
    });

    fireEvent(
      screen.getByRole('link'),
      new MouseEvent('auxclick', {
        bubbles: true,
        button: 1,
        cancelable: true,
      }),
    );

    expect(openSpy).toHaveBeenCalledWith(
      `/docs/${SOURCE_ID}/#block-1`,
      '_blank',
    );
  });

  it('calls onClose through the close button', () => {
    const onClose = vi.fn();
    render(<BacklinksSideBar docId={DOC_ID} onClose={onClose} />, {
      wrapper: AppWrapper,
    });

    fireEvent.click(
      screen.getByLabelText('Close the documents referencing this one sidebar'),
    );

    expect(onClose).toHaveBeenCalledOnce();
  });
});

describe('BacklinksSideBarButton', () => {
  beforeEach(() => {
    mockedState = {
      data: { count: 0, results: [] },
      isLoading: false,
      isError: false,
    };
    mockCurrentDoc = { id: DOC_ID, deleted_at: null };
  });

  it('opens the backlinks panel and reflects its state', () => {
    render(<BacklinksSideBarButton docId={DOC_ID} />, {
      wrapper: AppWrapper,
    });

    const button = screen.getByRole('button', {
      name: 'Show the documents referencing this one sidebar',
    });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByTestId('backlinks-count')).not.toBeInTheDocument();

    fireEvent.click(button);
    expect(
      screen.getByRole('button', {
        name: 'Hide the documents referencing this one sidebar',
      }),
    ).toHaveAttribute('aria-expanded', 'true');
  });

  it('shows the number of visible referencing documents', () => {
    mockedState = { data: payload, isLoading: false, isError: false };

    render(<BacklinksSideBarButton docId={DOC_ID} />, {
      wrapper: AppWrapper,
    });

    const badge = screen.getByTestId('backlinks-count');
    expect(badge).toHaveTextContent('1');
  });

  it('renders nothing for a trashed document', () => {
    mockCurrentDoc = {
      id: DOC_ID,
      deleted_at: '2026-01-01T00:00:00Z',
    };
    mockedState = { data: payload, isLoading: false, isError: false };

    render(<BacklinksSideBarButton docId={DOC_ID} />, {
      wrapper: AppWrapper,
    });

    expect(
      screen.queryByRole('button', {
        name: 'Show the documents referencing this one sidebar',
      }),
    ).not.toBeInTheDocument();
  });
});
