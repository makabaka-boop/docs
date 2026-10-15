"""Tests for the `reindex_document_links` management command."""

import uuid
from io import StringIO
from unittest import mock

from django.core.management import call_command

import pycrdt
import pytest

from core import factories, models
from core.services.yhub_services import ServiceUnavailableError, YHubService

pytestmark = pytest.mark.django_db


def update_linking(target_id):
    """Build a yjs update containing one interlinking node to the target."""

    ydoc = pycrdt.Doc()
    ydoc["document-store"] = pycrdt.XmlFragment(
        [
            pycrdt.XmlElement(
                "blockGroup",
                {},
                [
                    pycrdt.XmlElement(
                        "blockContainer",
                        {"id": "backfill-block"},
                        [
                            pycrdt.XmlElement(
                                "paragraph",
                                {},
                                [
                                    pycrdt.XmlElement(
                                        "interlinkingLinkInline",
                                        {
                                            "docId": str(target_id),
                                            "blockId": "",
                                            "disabled": False,
                                            "trigger": "/",
                                        },
                                    )
                                ],
                            )
                        ],
                    )
                ],
            )
        ]
    )
    return ydoc.get_update()


def test_command_backlinks_backfill_is_idempotent():
    """Existing documents are indexed without any edit, and rerun adds nothing."""
    source = factories.DocumentFactory()
    target = factories.DocumentFactory()

    def get_ydoc(document):
        return update_linking(target.id) if document.id == source.id else None

    with mock.patch.object(YHubService, "get_ydoc", side_effect=get_ydoc):
        out = StringIO()
        call_command("reindex_document_links", stdout=out)

    link = models.DocumentLink.objects.get()
    assert (link.source_id, link.target_id) == (source.id, target.id)
    assert link.source_block_id == "backfill-block"
    assert "2 reindexed, 0 skipped" in out.getvalue()

    # a second run replaces rather than duplicates
    with mock.patch.object(YHubService, "get_ydoc", side_effect=get_ydoc):
        call_command("reindex_document_links")

    assert models.DocumentLink.objects.count() == 1


def test_command_reindex_single_document():
    """--id limits the reindex to the given document."""
    source = factories.DocumentFactory()
    target = factories.DocumentFactory()
    factories.DocumentFactory()  # another document, not reindexed

    with mock.patch.object(
        YHubService, "get_ydoc", return_value=update_linking(target.id)
    ) as mock_get:
        call_command("reindex_document_links", "--id", str(source.id))

    mock_get.assert_called_once()
    assert models.DocumentLink.objects.filter(source=source).count() == 1


def test_command_skips_documents_whose_content_cannot_be_read():
    """A failing document is skipped and counted, others still get indexed."""
    unreadable = factories.DocumentFactory()
    readable = factories.DocumentFactory()
    target = factories.DocumentFactory()
    factories.DocumentLinkFactory(source=unreadable)

    def get_ydoc(document):
        if document.id == unreadable.id:
            raise ServiceUnavailableError("down")
        return update_linking(target.id) if document.id == readable.id else None

    out = StringIO()
    with mock.patch.object(YHubService, "get_ydoc", side_effect=get_ydoc):
        call_command("reindex_document_links", stdout=out)

    # the unreadable document kept its previous links
    assert models.DocumentLink.objects.filter(source=unreadable).count() == 1
    # the readable one got indexed
    assert models.DocumentLink.objects.filter(source=readable, target=target).exists()
    assert "3 reindexed, 1 skipped" in out.getvalue()


def test_command_continues_after_an_unexpected_error():
    """A non-yhub error on one document is skipped, not fatal for the run."""
    factories.DocumentFactory()
    factories.DocumentFactory()

    out = StringIO()
    with mock.patch(
        "core.management.commands.reindex_document_links.reindex_document_links",
        side_effect=[RuntimeError("boom"), 0],
    ) as mocked:
        call_command("reindex_document_links", stdout=out)

    assert mocked.call_count == 2
    assert "1 reindexed, 1 skipped" in out.getvalue()
