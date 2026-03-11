let vimModule: typeof import("@replit/codemirror-vim") | null = null;

export async function loadVim() {
  if (!vimModule) {
    vimModule = await import("@replit/codemirror-vim");
  }
  return vimModule;
}

export function getVimModule() {
  return vimModule;
}
