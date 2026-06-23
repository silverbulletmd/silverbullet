Every non-page file in your space (images, PDFs, attachments, etc.) is available via the `document` tag, they’re indexed purely from filesystem metadata.

The `document` tag exposes the following attributes:

| Attribute | Description |
|---|---|
| `name` | Full path of the document (also used as `ref`) |
| `contentType` | MIME type of the document |
| `size` | File size in bytes |
| `extension` | File extension (without the leading dot) |
| `created` | Creation timestamp (string) |
| `lastModified` | Last-modified timestamp (string) |
| `perm` | `ro` or `rw` |


Example query:

${query[[from index.documents() limit 3]]}
