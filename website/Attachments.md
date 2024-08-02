While SilverBullet for sure is aimed at primarily text-based content, life can not fully be represented in text always. Therefore, SilverBullet supports attachments. Attachments, like [[Pages]] ultimately are — once again — just files on disk.

# Uploading
To create an attachment, you have a few options:

* Use the {[Upload: File]} command (especially useful on mobile devices)
* Drag & drop files or images onto a page
* Copy & paste files or images onto a page

All options will prompt you for a file name to use to store the attachment, and then include the attachment as an embedded image (if it was an image) or link to the file.

# Linking
Attachments can be linked to in two ways:
* Via the regular link syntax: `[link text](attachment.pdf)`. URLs here are relative to the page, so on a page named `MyFolder/Hello`, `[link text](attachment.pdf)` would refer to an attachment stored in `MyFolder/attachment.pdf`.
* Via the wiki link syntax: `[[attachment.pdf]]`. These paths are absolute and relative to your space’s root, just like regular page links. That is: on a page `MyFolder/Hello` an attachment link `[[attachment.pdf]]` would link to the file `attachment.pdf` in the space’s root folder.

# Embedding
Media can also be embedded using the [[#Linking]] syntax, but prefixed with an `!`:
Images, videos, audio and PDFs are currently supported.

* `![alternate text](image.png)`
* `![[image.png]]`

These follow the same relative/absolute path rules as links described before.

## Media resizing

In addition, media can be _sized_ using the following syntax:
* Specifying only a width: `![Alt text|300](image.png)` or `![[image.png|300]]`
* Specifying only a height: `![Alt text|x300](image.png)` or `![[image.png|x300]]`
* Specifying both width and height: `![Hello|300x300](image.png)` or `![[image.png|300x300]]`

# Management
SilverBullet [does not currently support](https://github.com/silverbulletmd/silverbullet/issues/72) any operations like renaming or deleting of attachments. You’ll have to do this outside of SilverBullet somehow.