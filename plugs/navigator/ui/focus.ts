/**
 * In Firefox, a `focus()` call made from inside an iframe that isn't yet the
 * host document's `activeElement` spends itself entirely on raising the
 * iframe's browsing context -- the element never becomes the inner
 * document's own `activeElement`. A second call, now that the context is
 * raised, lands normally. A no-op everywhere else: the first call already
 * succeeded, so the guard never fires.
 */
export function takeFocus(el: HTMLElement | null | undefined) {
  if (!el) return;
  el.focus();
  if (document.activeElement !== el) el.focus();
}
