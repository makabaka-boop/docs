"""Task recomputing the interlinking links a document contains."""

from logging import getLogger

from impress.celery_app import app

logger = getLogger(__name__)


@app.task
def index_document_links_task(document_id):
    """
    Recompute the interlinking links a document contains from its content on
    the collaboration server.

    Scheduled on every "content updated" notification (the collaboration
    server compacts new content) and whenever a document is created with its
    content written straight to yhub (duplicate, import, onboarding sandbox).
    The service already leaves the previous rows untouched when the content
    could not be read; the catch below is the second fence, this task must
    never be what fails the request that scheduled it.
    """

    # imported here and not at module level: models schedule the task by name
    # (send_task), and a top-level import would cycle models -> this task ->
    # document_links service -> models
    from core.services.document_links import (  # noqa: PLC0415  # pylint: disable=import-outside-toplevel
        reindex_document_links,
    )

    try:
        return reindex_document_links(document_id)
    except Exception:  # pylint: disable=broad-except
        logger.exception(
            "Failed to reindex the document links of document %s", document_id
        )
        return None
