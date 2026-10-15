# Generated for the "referenced by" (backlinks) feature: one row per
# (source document, target document, source block) interlinking reference.

import uuid

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("core", "0035_mention"),
    ]

    operations = [
        migrations.CreateModel(
            name="DocumentLink",
            fields=[
                (
                    "id",
                    models.UUIDField(
                        default=uuid.uuid4,
                        editable=False,
                        help_text="primary key for the record as UUID",
                        primary_key=True,
                        serialize=False,
                        verbose_name="id",
                    ),
                ),
                (
                    "created_at",
                    models.DateTimeField(
                        auto_now_add=True,
                        help_text="date and time at which a record was created",
                        verbose_name="created on",
                    ),
                ),
                (
                    "updated_at",
                    models.DateTimeField(
                        auto_now=True,
                        help_text="date and time at which a record was last updated",
                        verbose_name="updated on",
                    ),
                ),
                ("source_block_id", models.CharField(max_length=255)),
                (
                    "target_block_id",
                    models.CharField(blank=True, default="", max_length=255),
                ),
                (
                    "excerpt",
                    models.CharField(blank=True, default="", max_length=200),
                ),
                (
                    "source",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="outgoing_links",
                        to="core.document",
                    ),
                ),
                (
                    "target",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="incoming_links",
                        to="core.document",
                    ),
                ),
            ],
            options={
                "verbose_name": "Document link",
                "verbose_name_plural": "Document links",
                "db_table": "impress_document_link",
                "ordering": ("-created_at",),
            },
        ),
        migrations.AddConstraint(
            model_name="documentlink",
            constraint=models.UniqueConstraint(
                fields=("source", "target", "source_block_id"),
                name="unique_document_link_source_target_block",
                violation_error_message=(
                    "This document link already exists for this source block."
                ),
            ),
        ),
        # the "target" foreign key already provides its btree index
    ]
