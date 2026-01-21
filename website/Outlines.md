While SilverBullet is not a “proper” outliner like e.g. [LogSeq](https://logseq.com), it does offer a useful commands to manage outlines.

An outline is simply a (nested) bulleted list, for instance:

* Introduction
  * Context
  * Problem space
  * Solution space
* Problem statement
  * Problem A
    * Sub problem 1
    * Sub problem 2
  * Problem B
  * Problem C
* Related work
  * Area A
  * Area B
  * Area C
* Solution
* Conclusion

# Commands
SilverBullet offers a number of `Outline` commands to make manipulating such outlines easier, they are (note that on Mac `Mod` binds to `Cmd`, on Linux and Windows it’s `Ctrl`):

* `Outline: Move Up` (`Alt-ArrowUp`): moves the current item and its children up
* `Outline: Move Down` (`Alt-ArrowDown`): moves the current item and its children down
* `Outline: Move Right` (`Mod-. l`): indents the current item and its children one level deeper
* `Outline: Move Left` (`Mod-. h`): outdents the current item and its children one level higher


And for folding outlines:

* `Outline: Fold`: folds the current item’s children
* `Outline: Unfold`: unfolds the current item’s children
* `Outline: Toggle Fold` (`Mod-. Mod-.`): toggles the current item’s fold state
* `Outline: Fold All`: folds all sections in the entire page
* `Outline: Unfold All`: unfolds all sections in the entire page
