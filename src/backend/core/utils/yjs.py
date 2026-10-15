"""Yjs document conversion utilities."""

import base64
import re
import uuid

import pycrdt
from bs4 import BeautifulSoup

from core import enums

# Name of the inline content node holding a link to another Docs document
# (see the Interlinking inline content spec in the frontend editor).
INTERLINKING_INLINE_TYPE = "interlinkingLinkInline"
# BlockNote wraps every block in a blockContainer element carrying its id.
BLOCK_CONTAINER_TAG = "blockContainer"
# The nested blocks (list children, table cells, columns...) hang under a
# blockGroup element: the text of a block is everything but that group.
BLOCK_GROUP_TAG = "blockGroup"
# Maximum length of the excerpt kept for the "referenced by" panel.
LINK_EXCERPT_MAX_LENGTH = 200


def yjs_to_xml(update):
    """Extract xml from a raw yjs update."""

    doc = pycrdt.Doc()
    doc.apply_update(update)
    return str(doc.get("document-store", type=pycrdt.XmlFragment))


def base64_yjs_to_xml(base64_string):
    """Extract xml from base64 yjs document."""

    return yjs_to_xml(base64.b64decode(base64_string))


def yjs_to_text(update):
    """Extract text from a raw yjs update."""

    soup = BeautifulSoup(yjs_to_xml(update), "lxml-xml")
    return soup.get_text(separator=" ", strip=True)


def base64_yjs_to_text(base64_string):
    """Extract text from base64 yjs document."""

    return yjs_to_text(base64.b64decode(base64_string))


def extract_attachments(content):
    """Helper method to extract media paths from a document's content."""
    if not content:
        return []

    xml_content = base64_yjs_to_xml(content)
    return re.findall(enums.MEDIA_STORAGE_URL_EXTRACT, xml_content)


def extract_attachments_from_update(update):
    """Helper method to extract media paths from a document's content."""
    if not update:
        return []

    return re.findall(enums.MEDIA_STORAGE_URL_EXTRACT, yjs_to_xml(update))


def _is_disabled_interlink(node):
    """Tell whether an interlinking node was disabled on the editor side."""

    return str(node.get("disabled", "")).lower() == "true"


def _block_excerpt(container):
    """
    Return the plain text of a block container, without its nested blocks.

    A blockContainer holds the element of the block (paragraph, heading...)
    and, when it has children, a blockGroup element. Only the block's own
    element is the excerpt: the text of a list item should not carry the
    whole text of its children. Links inside a table cell live in their own
    blockContainer, so their excerpt is the text of that cell block.
    """

    parts = []
    for child in container.find_all(recursive=False):
        if child.name == BLOCK_GROUP_TAG:
            continue
        text = child.get_text(separator=" ", strip=True)
        if text:
            parts.append(text)
    return " ".join(parts)


def extract_interlinking_links(update):
    """
    Extract the document links (interlinking inline content) from a raw yjs
    update, as the editor saved them.

    Only the editor's document links are considered: plain hyperlinks are
    text marks and never produce an interlinking node. A link is ignored when
    it has no target, an invalid one, is disabled, or cannot be attached to a
    block. Several links to the same document in the same block collapse to a
    single result (the first block anchor wins).

    Returns a list of dictionaries with the keys:
        source_block_id: id of the block containing the link
        target_id: id of the targeted document
        target_block_id: id of the targeted block, "" for a document link
        excerpt: plain text of the source block, truncated
    """

    if not update:
        return []

    soup = BeautifulSoup(yjs_to_xml(update), "lxml-xml")

    links = []
    seen = set()
    for node in soup.find_all(INTERLINKING_INLINE_TYPE):
        target_id = (node.get("docId") or "").strip()
        if not target_id:
            continue
        try:
            uuid.UUID(target_id)
        except ValueError:
            continue
        if _is_disabled_interlink(node):
            continue

        container = node.find_parent(BLOCK_CONTAINER_TAG)
        if container is None or not container.get("id"):
            continue

        source_block_id = container["id"].strip()
        dedupe_key = (source_block_id, target_id)
        if dedupe_key in seen:
            continue
        seen.add(dedupe_key)

        links.append(
            {
                "source_block_id": source_block_id,
                "target_id": target_id,
                "target_block_id": (node.get("blockId") or "").strip(),
                "excerpt": _block_excerpt(container)[:LINK_EXCERPT_MAX_LENGTH],
            }
        )

    return links
