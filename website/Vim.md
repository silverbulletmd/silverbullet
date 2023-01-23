SilverBullet has a basic Vim mode. You can toggle it using the {[Editor: Toggle Vim Mode]} command.

In addition, it supports various ex commands that you can run as you would expect, for instance: `:imap jj <Esc>`.

## VIMRC
SilverBullet also has the ability to load a set of these ex command on boot. To use this functionality, create a page in your space named [[VIMRC]] and put a fenced code block in it (similar to how this is done in [[SETTINGS]]) with one ex command per line, for example:

    ```
    imap jj <Esc>
    ```

To manually reload your [[VIMRC]] you can use the {[Editor: Vim: Load VIMRC]} command.