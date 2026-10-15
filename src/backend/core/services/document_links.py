"""
Services maintaining the document links (interlinking) a document contains.

The content of a document lives on the collaboration server: what a document
links to is computed from its current Yjs state, read back the same way the
search indexer reads it. Links of a document are replaced wholesale so that
adding or removing a link in the editor is reflected, and the table is
populated for documents that are never edited again through the reindex
management command (backfill).

Visibility of a link to a given reader is decided at read time, by the API,
never here: this module stores every link it finds regardless of who may see
the source.
"""

import logging

from django.db import transaction
from django.db.models import Q

from core import models
from core.services.yhub_services import YHubError, YHubService
from core.utils.yjs import extract_interlinking_links

logger = logging.getLogger(__name__)

# Maximum number of source documents one backlinks response groups. The
# response carries no total beyond the visible groups: revealing how many
# references exist in total would leak the existence of unreadable sources.
BACKLINKS_MAX_SOURCES = 100


def reindex_document_links(document_id, update=None):
    """
    Replace the outgoing document links of a document with its current content.

    Extracts the interlinking links from the current Yjs state and swaps the
    stored rows in one transaction. The state is either passed in by a caller
    that already holds the raw update (a duplicate or an import, which seed
    yhub straight away without any "content updated" notification following)
    or, when omitted, read back from the collaboration server (the content
    update task and the reindex management command).

    Returns the number of stored links, or None when nothing was done: the
    document does not exist anymore, or its content could not be read. A read
    failure never clears the rows already stored: a transient outage of the
    collaboration server must not look like every link was removed.
    """

    try:
        document = models.Document.objects.get(pk=document_id)
    except (models.Document.DoesNotExist, ValueError) as exc:
        logger.info(
            "Links not reindexed, document %s does not exist: %s", document_id, exc
        )
        return None

    if update is None:
        try:
            update = YHubService().get_ydoc(document)
        except YHubError:
            logger.exception(
                "Links of document %s were not reindexed, its content could "
                "not be read from the collaboration server",
                document_id,
            )
            return None

    extracted = extract_interlinking_links(update) if update else []

    source_id = str(document.pk)
    target_ids = {link["target_id"] for link in extracted}
    # A link only counts when its target still exists as a document. Links to
    # deleted or nonexistent documents cannot appear in any panel anyway.
    existing_target_ids = {
        str(pk)
        for pk in models.Document.objects.filter(id__in=target_ids).values_list(
            "id", flat=True
        )
    }

    new_links = [
        models.DocumentLink(
            source=document,
            target_id=link["target_id"],
            source_block_id=link["source_block_id"],
            target_block_id=link["target_block_id"],
            excerpt=link["excerpt"],
        )
        for link in extracted
        # A document linking itself is not a backlink source for itself.
        if link["target_id"] in existing_target_ids and link["target_id"] != source_id
    ]

    with transaction.atomic():
        document.outgoing_links.all().delete()
        models.DocumentLink.objects.bulk_create(new_links)

    logger.info(
        "Reindexed %d document link(s) for document %s", len(new_links), document_id
    )
    return len(new_links)


def get_document_backlinks(document, user, limit=BACKLINKS_MAX_SOURCES):
    """
    Return the references to `document`, grouped by their source document,
    for the sources the given user may see.

    A source is visible only when the user is a member of it through an access
    on the source itself or on one of its ancestors (document link reach does
    not count), and when it is not in the trash bin. Both checks are done at
    read time, so a rename, a restored document or a revoked access are all
    reflected on the next request without any reindexing.

    Returns a list of {"id", "title", "links": [{"source_block_id",
    "target_block_id", "excerpt"}]} ordered by the most recent reference,
    capped at `limit` source documents. It never carries a global total, so the
    number of unreadable sources cannot leak.
    """

    if not user.is_authenticated:
        return []

    # The materialized paths the user is a member of: an access on an ancestor
    # grants member access to every document below it.
    access_paths = set(
        models.DocumentAccess.objects.filter(
            Q(user=user) | Q(team__in=user.teams)
        ).values_list("document__path", flat=True)
    )
    if not access_paths:
        return []

    member_of = Q()
    for path in access_paths:
        member_of |= Q(path__startswith=path)

    links = (
        document.incoming_links.filter(
            source__deleted_at__isnull=True,
            source__ancestors_deleted_at__isnull=True,
        )
        .filter(source__in=models.Document.objects.filter(member_of))
        .select_related("source")
        .order_by("-created_at", "source_block_id")
    )

    groups = {}
    for link in links:
        group = groups.get(link.source_id)
        if group is None:
            if len(groups) >= limit:
                # More sources than the cap: the remaining ones are not
                # returned, but no total is exposed either.
                continue
            group = {
                "id": link.source_id,
                "title": link.source.title,
                "latest": link.created_at,
                "links": [],
            }
            groups[link.source_id] = group
        group["links"].append(
            {
                "source_block_id": link.source_block_id,
                "target_block_id": link.target_block_id,
                "excerpt": link.excerpt,
            }
        )

    # Most recently referenced source first; ties fall back to the title and
    # then the id, so the order is stable when links were created in bulk.
    ordered = sorted(
        groups.values(),
        key=lambda group: (
            -group["latest"].timestamp(),
            (group["title"] or "").casefold(),
            str(group["id"]),
        ),
    )
    for group in ordered:
        group.pop("latest")
    return ordered
