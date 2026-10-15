import { Button, ButtonElement, Loader } from '@gouvfr-lasuite/ui-components';
import { useRouter } from 'next/router';
import { KeyboardEvent, MouseEvent, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { css } from 'styled-components';

import BacklinksIcon from '@/assets/icons/ui-kit/link.svg';
import { Box, ButtonCloseModal, Text } from '@/components';
import { useCunninghamTheme } from '@/cunningham';
import { getEmojiAndTitle, useDocStore } from '@/docs/doc-management';
import { useRightPanelStore } from '@/features/right-panel/stores/useRightPanelStore';
import { useFocusStore } from '@/stores';

import { useBacklinks } from '../api/useBacklinks';
import { BacklinkBlock, BacklinkSource } from '../types';

interface BacklinksSideBarProps {
  docId: string;
  onClose: () => void;
}

const sourceHref = (sourceId: string, blockId: string) =>
  `/docs/${sourceId}/#${blockId}`;

/**
 * Opens the source block: normal click navigates in the current tab, the same
 * modifier keys the editor links honor open a new tab/window.
 */
const openSource = (
  event: MouseEvent<HTMLAnchorElement>,
  routerPush: (href: string) => void,
  href: string,
) => {
  if (event.metaKey || event.ctrlKey || event.shiftKey) {
    window.open(href, '_blank');
    return;
  }
  event.preventDefault();
  routerPush(href);
};

const SourceTitle = ({ source }: { source: BacklinkSource }) => {
  const { t } = useTranslation();
  const { emoji, titleWithoutEmoji } = getEmojiAndTitle(source.title ?? '');

  return (
    <Text
      as="h3"
      $weight="bold"
      $size="14px"
      $margin="0"
      data-testid="backlink-source-title"
    >
      {emoji && (
        <Box $margin={{ right: '4px' }} $display="inline-block">
          {emoji}
        </Box>
      )}
      {titleWithoutEmoji || t('Untitled document')}
    </Text>
  );
};

const linkStyle = css`
  border-radius: 4px;
  text-decoration: none;
  color: inherit;
  cursor: pointer;
  &:hover,
  &:focus-visible {
    background-color: var(--c--contextuals--background--surface--secondary);
  }
`;

const BacklinkEntry = ({
  source,
  link,
}: {
  source: BacklinkSource;
  link: BacklinkBlock;
}) => {
  const { t } = useTranslation();
  const router = useRouter();
  const href = sourceHref(source.id, link.source_block_id);

  const handleKeyDown = (event: KeyboardEvent<HTMLAnchorElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      void router.push(href);
    }
  };

  return (
    <Box
      as="a"
      href={href}
      $display="block"
      $padding={{ vertical: '3xs', horizontal: '2xs' }}
      $css={linkStyle}
      onClick={(event) => openSource(event, router.push.bind(router), href)}
      onAuxClick={(event) => {
        if (event.button === 1) {
          event.preventDefault();
          window.open(href, '_blank');
        }
      }}
      onKeyDown={handleKeyDown}
    >
      {link.excerpt || t('Open the referenced block')}
    </Box>
  );
};

const BacklinkGroup = ({ source }: { source: BacklinkSource }) => {
  return (
    <Box as="li" role="listitem" $padding={{ vertical: '2xs' }}>
      <Box $padding={{ horizontal: '2xs' }}>
        <SourceTitle source={source} />
      </Box>
      <Box
        as="ul"
        role="list"
        $padding={{ left: '2xs' }}
        $css={css`
          list-style: none;
          margin: 0;
        `}
      >
        {source.links.map((link) => (
          <Box as="li" role="listitem" key={link.source_block_id}>
            <BacklinkEntry source={source} link={link} />
          </Box>
        ))}
      </Box>
    </Box>
  );
};

export const BacklinksSideBar = ({ docId, onClose }: BacklinksSideBarProps) => {
  const { t } = useTranslation();
  const { spacingsTokens } = useCunninghamTheme();
  const { data, isLoading, isError } = useBacklinks({ id: docId });

  return (
    <Box $height="inherit">
      <Box
        $padding={{ vertical: 'base', horizontal: 'sm' }}
        $css={css`
          border-bottom: 1px solid
            var(--c--contextuals--border--surface--primary);
        `}
      >
        <Box $direction="row" $align="center" $justify="space-between">
          <Text
            as="h2"
            id="backlinks-heading"
            $weight="bold"
            $size="16px"
            $margin="0"
          >
            {t('Documents referencing this one')}
          </Text>
          <ButtonCloseModal
            aria-label={t('Close the documents referencing this one sidebar')}
            onClick={onClose}
          />
        </Box>
      </Box>

      {isLoading && (
        <Box
          $padding="xl"
          $align="center"
          role="status"
          aria-label={t('Documents referencing this one')}
        >
          <Loader size="small" />
        </Box>
      )}

      {!isLoading && isError && (
        <Box $padding="lg" $gap="xs" $direction="row" $align="center">
          <Text $variation="600" $size="14px">
            {t('The documents referencing this one could not be loaded.')}
          </Text>
        </Box>
      )}

      {!isLoading && !isError && data && data.count === 0 && (
        <Box $padding="lg" $gap="xs">
          <Text $variation="600" $size="14px">
            {t('No document references this one yet.')}
          </Text>
        </Box>
      )}

      {!isLoading && !isError && data && data.count > 0 && (
        <Box
          as="nav"
          aria-labelledby="backlinks-heading"
          $css={css`
            overflow-y: auto;
          `}
        >
          <Box
            as="ul"
            role="list"
            $gap={spacingsTokens['xs']}
            $padding="sm"
            $css={css`
              list-style: none;
              margin: 0;
            `}
            data-testid="backlinks-list"
          >
            {data.results.map((source) => (
              <BacklinkGroup key={source.id} source={source} />
            ))}
          </Box>
        </Box>
      )}
    </Box>
  );
};

export const BacklinksSideBarButton = ({ docId }: { docId: string }) => {
  const { t } = useTranslation();
  const { currentDoc } = useDocStore();
  const isDeleted = !!currentDoc?.deleted_at;
  // The button only carries the visible count: it must not poll nor refetch
  // on focus while the panel is closed, and must not query a trashed document.
  // The panel polls every 30s through its own query observer.
  const { data } = useBacklinks(
    { id: docId },
    {
      refetchInterval: false,
      refetchOnWindowFocus: false,
      enabled: !isDeleted,
    },
  );
  const { isPanelOpen, activePanel, setActivePanel, setIsPanelOpen } =
    useRightPanelStore();
  const buttonRef = useRef<ButtonElement>(null);
  const { addLastFocus } = useFocusStore();

  const isActive = isPanelOpen && activePanel === 'backlinks';
  const count = data?.count ?? 0;
  const ariaLabel = isActive
    ? t('Hide the documents referencing this one sidebar')
    : t('Show the documents referencing this one sidebar');

  if (isDeleted) {
    return null;
  }

  return (
    <Button
      ref={buttonRef}
      size="small"
      onClick={() => {
        if (isActive) {
          setIsPanelOpen(false);
        } else {
          setActivePanel('backlinks');
          addLastFocus(buttonRef.current);
        }
      }}
      aria-label={ariaLabel}
      aria-expanded={isActive}
      color="neutral"
      variant={isActive ? 'secondary' : 'tertiary'}
      icon={<BacklinksIcon width={24} height={24} aria-hidden="true" />}
    >
      {count > 0 && (
        <Box
          as="span"
          aria-label={t('{{count}} documents reference this one', { count })}
          data-testid="backlinks-count"
          $padding={{ horizontal: '3xs' }}
          $css={css`
            font-size: 11px;
            font-weight: 700;
          `}
        >
          {count}
        </Box>
      )}
    </Button>
  );
};
