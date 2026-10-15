"""
Tests for the backlinks API endpoint: the documents referencing a document
through editor document links (interlinking), with visibility filtering.
"""

import uuid

from django.utils import timezone

import pytest
from rest_framework.test import APIClient

from core import factories, models
from core.services.document_links import get_document_backlinks

pytestmark = pytest.mark.django_db


def backlinks_url(document):
    return f"/api/v1.0/documents/{document.id!s}/backlinks/"


# --- access ---------------------------------------------------------------


def test_backlinks_anonymous():
    """Anonymous users are not authenticated, even on a public document."""
    document = factories.DocumentFactory(link_reach="public")

    response = APIClient().get(backlinks_url(document))

    assert response.status_code == 401


def test_backlinks_forbidden_for_non_member():
    """An authenticated user who cannot read the document gets a 403."""
    user = factories.UserFactory()
    document = factories.DocumentFactory(
        link_reach="restricted", users=[factories.UserFactory()]
    )

    client = APIClient()
    client.force_login(user)
    response = client.get(backlinks_url(document))

    assert response.status_code == 403


def test_backlinks_unknown_document_is_404():
    """A document that does not exist answers 404, like retrieve."""
    user = factories.UserFactory()
    client = APIClient()
    client.force_login(user)

    response = client.get(f"/api/v1.0/documents/{uuid.uuid4()!s}/backlinks/")

    assert response.status_code == 404


def test_backlinks_reader_direct_member():
    """A reader with a direct access gets the list."""
    user = factories.UserFactory()
    document = factories.DocumentFactory(users=[(user, "reader")])

    client = APIClient()
    client.force_login(user)
    response = client.get(backlinks_url(document))

    assert response.status_code == 200
    assert response.json() == {"count": 0, "results": []}


def test_backlinks_reader_with_inherited_access():
    """An access on an ancestor grants access to the targeted document."""
    user = factories.UserFactory()
    parent = factories.DocumentFactory(users=[(user, "reader")])
    document = factories.DocumentFactory(parent=parent)

    client = APIClient()
    client.force_login(user)
    response = client.get(backlinks_url(document))

    assert response.status_code == 200


# --- visibility and non-leakage ------------------------------------------


def test_backlinks_only_member_sources_and_no_leak():
    """
    Only sources the user is a member of (directly or by inheritance) and
    that are not trashed are returned. Nothing of the other sources leaks:
    not their id, title, excerpt, nor their count.
    """
    user = factories.UserFactory()
    target = factories.DocumentFactory(users=[(user, "owner")])

    # S1: direct member access
    s1 = factories.DocumentFactory(title="Visible direct", users=[(user, "reader")])
    # S2: access only on an ancestor of the source
    s2_ancestor = factories.DocumentFactory(users=[(user, "reader")])
    s2 = factories.DocumentFactory(parent=s2_ancestor, title="Visible inherited")
    # S3: readable through its public link and a link trace, but no membership
    s3 = factories.DocumentFactory(
        title="Public only secret",
        link_reach="public",
        link_traces=[user],
    )
    # S4: member, but trashed
    s4 = factories.DocumentFactory(title="Trashed secret", users=[(user, "reader")])
    s4.soft_delete()
    # S5: member but carried to the trash by a deleted ancestor
    s5_ancestor = factories.DocumentFactory(users=[(user, "reader")])
    s5 = factories.DocumentFactory(parent=s5_ancestor, title="Ancestor trashed")
    s5_ancestor.soft_delete()

    factories.DocumentLinkFactory(
        source=s1, target=target, source_block_id="block-1", excerpt="excerpt one"
    )
    factories.DocumentLinkFactory(
        source=s2, target=target, source_block_id="block-2", excerpt="excerpt two"
    )
    factories.DocumentLinkFactory(
        source=s3, target=target, source_block_id="block-3", excerpt="excerpt three"
    )
    factories.DocumentLinkFactory(
        source=s4, target=target, source_block_id="block-4", excerpt="excerpt four"
    )
    factories.DocumentLinkFactory(
        source=s5, target=target, source_block_id="block-5", excerpt="excerpt five"
    )

    client = APIClient()
    client.force_login(user)
    response = client.get(backlinks_url(target))

    assert response.status_code == 200
    data = response.json()
    assert data["count"] == 2
    visible_ids = {source["id"] for source in data["results"]}
    assert visible_ids == {str(s1.id), str(s2.id)}

    raw = response.content.decode()
    for hidden in (s3, s4, s5):
        assert str(hidden.id) not in raw
        assert hidden.title not in raw
    assert "excerpt three" not in raw
    assert "excerpt four" not in raw
    assert "excerpt five" not in raw


def test_backlinks_inherited_source_access_revoked():
    """Removing the ancestor access hides the source on the next request."""
    user = factories.UserFactory()
    target = factories.DocumentFactory(users=[(user, "owner")])
    ancestor = factories.DocumentFactory(users=[(user, "reader")])
    source = factories.DocumentFactory(parent=ancestor, title="Inherited")
    factories.DocumentLinkFactory(source=source, target=target)

    client = APIClient()
    client.force_login(user)
    assert client.get(backlinks_url(target)).json()["count"] == 1

    models.DocumentAccess.objects.filter(document=ancestor, user=user).delete()

    response = client.get(backlinks_url(target))
    assert response.json() == {"count": 0, "results": []}


# --- live consistency -----------------------------------------------------


def test_backlinks_rename_is_immediate():
    """The source title is read live, a rename needs no reindexing."""
    user = factories.UserFactory()
    target = factories.DocumentFactory(users=[(user, "owner")])
    source = factories.DocumentFactory(title="Old title", users=[(user, "reader")])
    factories.DocumentLinkFactory(source=source, target=target)

    source.title = "New title"
    source.save()

    client = APIClient()
    client.force_login(user)
    response = client.get(backlinks_url(target))

    result = response.json()["results"][0]
    assert result["id"] == str(source.id)
    assert result["title"] == "New title"


def test_backlinks_soft_delete_and_restore_source():
    """A trashed source disappears and comes back on restore, unedited."""
    user = factories.UserFactory()
    target = factories.DocumentFactory(users=[(user, "owner")])
    source = factories.DocumentFactory(users=[(user, "owner")])
    factories.DocumentLinkFactory(source=source, target=target)

    client = APIClient()
    client.force_login(user)
    assert client.get(backlinks_url(target)).json()["count"] == 1

    source.soft_delete()
    assert client.get(backlinks_url(target)).json()["count"] == 0

    source.restore()
    assert client.get(backlinks_url(target)).json()["count"] == 1


def test_backlinks_hard_delete_source_cascades():
    """Deleting the source for good removes its links."""
    user = factories.UserFactory()
    target = factories.DocumentFactory(users=[(user, "owner")])
    source = factories.DocumentFactory(users=[(user, "owner")])
    factories.DocumentLinkFactory(source=source, target=target)

    source.delete()

    assert not models.DocumentLink.objects.exists()
    client = APIClient()
    client.force_login(user)
    assert client.get(backlinks_url(target)).json()["count"] == 0


def test_backlinks_groups_links_per_source_with_fields():
    """Several blocks of a source are grouped under it, deduped per block."""
    user = factories.UserFactory()
    target = factories.DocumentFactory(users=[(user, "owner")])
    source = factories.DocumentFactory(title="Source", users=[(user, "reader")])
    factories.DocumentLinkFactory(
        source=source,
        target=target,
        source_block_id="block-a",
        target_block_id="",
        excerpt="first block",
    )
    factories.DocumentLinkFactory(
        source=source,
        target=target,
        source_block_id="block-b",
        target_block_id="target-block",
        excerpt="second block",
    )

    client = APIClient()
    client.force_login(user)
    result = client.get(backlinks_url(target)).json()

    assert result["count"] == 1
    group = result["results"][0]
    assert group["id"] == str(source.id)
    assert group["title"] == "Source"
    # newest references first
    assert [link["source_block_id"] for link in group["links"]] == [
        "block-b",
        "block-a",
    ]
    block_b = next(
        link for link in group["links"] if link["source_block_id"] == "block-b"
    )
    assert block_b == {
        "source_block_id": "block-b",
        "target_block_id": "target-block",
        "excerpt": "second block",
    }


def test_backlinks_team_member_source(monkeypatch):
    """A team access, directly or inherited, makes the source visible."""
    user = factories.UserFactory()
    target = factories.DocumentFactory(users=[(user, "owner")])

    ancestor = factories.DocumentFactory()
    source = factories.DocumentFactory(parent=ancestor, title="Team source")
    factories.TeamDocumentAccessFactory(document=ancestor, team="team-a")
    factories.DocumentLinkFactory(source=source, target=target)

    monkeypatch.setattr(models.User, "teams", property(lambda self: ["team-a"]))

    client = APIClient()
    client.force_login(user)
    data = client.get(backlinks_url(target)).json()

    assert data["count"] == 1
    assert data["results"][0]["id"] == str(source.id)


def test_backlinks_group_order_is_stable_for_equal_dates():
    """Equal link dates fall back to ordering by source title, then id."""
    user = factories.UserFactory()
    target = factories.DocumentFactory(users=[(user, "owner")])
    source_b = factories.DocumentFactory(title="Source B", users=[(user, "reader")])
    source_a = factories.DocumentFactory(title="Source A", users=[(user, "reader")])
    factories.DocumentLinkFactory(source=source_b, target=target)
    factories.DocumentLinkFactory(source=source_a, target=target)
    models.DocumentLink.objects.update(created_at=timezone.now())

    client = APIClient()
    client.force_login(user)
    data = client.get(backlinks_url(target)).json()

    assert [group["title"] for group in data["results"]] == [
        "Source A",
        "Source B",
    ]


def test_backlinks_source_cap():
    """The service caps source groups without exposing a global total."""
    user = factories.UserFactory()
    target = factories.DocumentFactory(users=[(user, "owner")])
    for _ in range(3):
        source = factories.DocumentFactory(users=[(user, "reader")])
        factories.DocumentLinkFactory(source=source, target=target)

    groups = get_document_backlinks(target, user, limit=2)

    assert len(groups) == 2
    assert all("total" not in group for group in groups)
