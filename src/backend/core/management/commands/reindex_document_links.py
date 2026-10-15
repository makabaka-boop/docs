"""
Backfill the document links (interlinking backlinks) of every document.

The content of the documents lives on the collaboration server: this command
reads each document's current state the same way the "content updated" task
does, and recomputes its outgoing links. It is what makes the "referenced by"
panel find links in documents that are never edited again after the feature
is deployed.

It does not depend on the (optional) full text search service, is idempotent
and safe to run again: each document's links are replaced, never duplicated.
A document whose content cannot be read is skipped.
"""

import logging

from django.core.management.base import BaseCommand

from core import models
from core.services.document_links import reindex_document_links

logger = logging.getLogger("docs.document_links.reindex")


class Command(BaseCommand):
    """Recompute the interlinking links of all documents from their content."""

    help = __doc__

    def add_arguments(self, parser):
        """Limit the reindex to a single document."""
        parser.add_argument(
            "--id",
            action="store",
            dest="document_id",
            default=None,
            help="Reindex only the document with this id",
        )

    def handle(self, *args, **options):
        """Reindex documents one by one, tolerating individual failures."""
        queryset = models.Document.objects.order_by("id")
        document_id = options["document_id"]
        if document_id:
            queryset = queryset.filter(pk=document_id)

        reindexed = 0
        skipped = 0
        for document in queryset.iterator():
            # a single document failing (unreadable content, parse or
            # database error) must not abort the whole backfill
            try:
                result = reindex_document_links(document.id)
            except Exception:  # pylint: disable=broad-except
                logger.exception(
                    "Document links of document %s could not be reindexed",
                    document.id,
                )
                result = None
            if result is None:
                skipped += 1
            else:
                reindexed += 1

        logger.info(
            "Document links reindexing done: %d document(s) reindexed, %d skipped",
            reindexed,
            skipped,
        )
        self.stdout.write(
            f"Document links reindexed: {reindexed} reindexed, {skipped} skipped"
        )
