"""Tests for the document links (interlinking backlinks) indexing service."""

import uuid
from unittest.mock import patch

import pycrdt
import pytest

from core import factories, models
from core.services.document_links import reindex_document_links
from core.services.yhub_services import ServiceUnavailableError, YHubError, YHubService

pytestmark = pytest.mark.django_db


def interlink_node(doc_id, block_id="", disabled=False):
    """Build an interlinking inline node like the editor saves it."""

    return pycrdt.XmlElement(
        "interlinkingLinkInline",
        {
            "docId": str(doc_id),
            "blockId": str(block_id),
            "disabled": disabled,
            "trigger": "/",
        },
    )


def make_update(*items):
    """
    Build a yjs update containing paragraphs with interlinking nodes.

    Each item is (target_id, target_block_id) and becomes its own block.
    """

    blocks = []
    for target_id, target_block_id in items:
        blocks.append(
            pycrdt.XmlElement(
                "blockContainer",
                {"id": str(uuid.uuid4())},
                [
                    pycrdt.XmlElement(
                        "paragraph",
                        {},
                        [interlink_node(target_id, target_block_id)],
                    )
                ],
            )
        )

    ydoc = pycrdt.Doc()
    ydoc["document-store"] = pycrdt.XmlFragment(
        [pycrdt.XmlElement("blockGroup", {}, blocks)]
    )
    return ydoc.get_update()


def patch_get_ydoc(update):
    """Patch what the collaboration server answers with a single update."""

    return patch.object(YHubService, "get_ydoc", return_value=update)


def stored_links(source):
    """Return the stored outgoing links of a document as a set."""

    return set(source.outgoing_links.values_list("target_id", "source_block_id"))


def test_reindex_document_links_stores_links_to_existing_documents():
    """Valid links to existing documents are stored."""

    source = factories.DocumentFactory()
    target = factories.DocumentFactory()
    target_block = uuid.uuid4()
    update = make_update((target.id, target_block))

    with patch_get_ydoc(update):
        count = reindex_document_links(source.id)

    assert count == 1
    link = source.outgoing_links.get()
    assert link.target_id == target.id
    assert link.target_block_id == str(target_block)


def test_reindex_document_links_ignores_self_and_missing_targets():
    """Self links and links to nonexistent documents are not stored."""

    source = factories.DocumentFactory()
    missing = uuid.uuid4()
    update = make_update((source.id, ""), (missing, ""))

    with patch_get_ydoc(update):
        count = reindex_document_links(source.id)

    assert count == 0
    assert source.outgoing_links.count() == 0


def test_reindex_document_links_replaces_previous_set():
    """Reindexing replaces the outgoing links, removing what disappeared."""

    source = factories.DocumentFactory()
    target_a = factories.DocumentFactory()
    target_b = factories.DocumentFactory()

    with patch_get_ydoc(make_update((target_a.id, ""), (target_b.id, ""))):
        assert reindex_document_links(source.id) == 2

    # Target B is no longer linked in the new content: its row must go.
    with patch_get_ydoc(make_update((target_a.id, ""))):
        assert reindex_document_links(source.id) == 1

    targets = set(source.outgoing_links.values_list("target_id", flat=True))
    assert targets == {target_a.id}


def test_reindex_document_links_empty_content_clears_links():
    """A document the collaboration server holds nothing for has no links."""

    source = factories.DocumentFactory()
    factories.DocumentLinkFactory(source=source)

    with patch_get_ydoc(None):
        count = reindex_document_links(source.id)

    assert count == 0
    assert source.outgoing_links.count() == 0


def test_reindex_document_links_missing_document():
    """A document deleted before the task runs is a no-op."""

    source = factories.DocumentFactory()
    source_id = source.id
    source.delete()

    with patch_get_ydoc(None):
        assert reindex_document_links(source_id) is None


def test_reindex_document_links_yhub_failure_keeps_previous_links():
    """A collaboration server failure must not erase the stored links."""

    source = factories.DocumentFactory()
    target = factories.DocumentFactory()
    factories.DocumentLinkFactory(source=source, target=target)

    with patch.object(
        YHubService, "get_ydoc", side_effect=ServiceUnavailableError("down")
    ):
        result = reindex_document_links(source.id)

    assert result is None
    assert source.outgoing_links.count() == 1
    assert source.outgoing_links.get().target_id == target.id


def test_reindex_document_links_deduplicates_same_block_and_target():
    """Two links to the same document in one block store a single row."""

    source = factories.DocumentFactory()
    target = factories.DocumentFactory()
    block_id = str(uuid.uuid4())

    ydoc = pycrdt.Doc()
    ydoc["document-store"] = pycrdt.XmlFragment(
        [
            pycrdt.XmlElement(
                "blockGroup",
                {},
                [
                    pycrdt.XmlElement(
                        "blockContainer",
                        {"id": block_id},
                        [
                            pycrdt.XmlElement(
                                "paragraph",
                                {},
                                [
                                    interlink_node(target.id),
                                    interlink_node(target.id, uuid.uuid4()),
                                ],
                            )
                        ],
                    )
                ],
            )
        ]
    )

    with patch_get_ydoc(ydoc.get_update()):
        count = reindex_document_links(source.id)

    assert count == 1
    assert stored_links(source) == {(target.id, block_id)}


def test_document_link_cascade_on_document_deletion():
    """Deleting the source or the target removes the link rows."""

    target = factories.DocumentFactory()
    link = factories.DocumentLinkFactory(target=target)
    source = link.source

    assert models.DocumentLink.objects.count() == 1
    source_id, target_id = source.id, target.id

    target.delete()
    assert not models.DocumentLink.objects.filter(target_id=target_id).exists()

    link2 = factories.DocumentLinkFactory(source=source)
    second_target = link2.target
    source.delete()
    assert not models.DocumentLink.objects.filter(source_id=source_id).exists()
    # deleting a source removes its link rows but leaves the targeted documents
    assert models.Document.objects.filter(id=second_target.id).exists()


def test_reindex_document_links_yhub_error_base_class_caught():
    """Any YHubError subclass is handled without raising."""

    source = factories.DocumentFactory()

    with patch.object(YHubService, "get_ydoc", side_effect=YHubError("boom")):
        assert reindex_document_links(source.id) is None
