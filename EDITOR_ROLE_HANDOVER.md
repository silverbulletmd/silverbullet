# Editor role handover

State: 2026-11-08. Server implementation on `feat/editor-role-capabilities`, based on `01d6b0e76`. This branch is ready for further evaluation; it is not a proof of complete isolation against malicious code. No Desktop implementation is included.

## Behavior implemented

| Role | Wire value | Ordinary content | Library and configuration | Privileged runtime |
| --- | --- | --- | --- | --- |
| Reader | `read` | Read | Read | No |
| Editor | `edit` | Read and write | Read | No |
| Builder | `write` | Read and write | Read and write | Yes |

Executable Space Lua and Space Style load only from `Library/` and root `CONFIG`. The protected filesystem paths are `Library/` and `CONFIG.md`. Blocks elsewhere are ignored and linted. Loading checks actual indexed object provenance, not just a forged reference. Old indexed records and bootstrap loading are checked too. Plugs must live in Library.

Ordinary inline expressions and Page Lua use restricted evaluation for every viewer, including Builders. This prevents an Editor-authored expression from gaining authority when a Builder opens it. Server authorization independently rejects protected writes and privileged endpoints. The UI exposes Editor role assignment, protects configuration and library editing, and preserves Workbench query browsing.

## Trust boundary

All installed Space Lua in the protected locations is trusted. Builders can expose reviewed global Lua functions using `--- @capabilities space:read`, `widget:render`, or both. An annotation grants access to the function; it does not sandbox the function implementation. Its author must validate untrusted arguments and ensure that privileged behavior is intentional.

Restricted callers pass plain data, cannot pass executable callbacks or browser objects, and receive detached data or opaque widget values. They cannot reach JavaScript globals, arbitrary native functions, write syscalls, or the DOM through returned widget values. Installed code-widget renderers also run as trusted entry points and must validate their block text.

## Examples

Put this in a `space-lua` block in `Library/Custom/Cards`, then reload scripts:

```lua
cards = {}

--- @capabilities space:read
function cards.title(name)
  return space.getPageMeta(name).name
end

--- @capabilities widget:render
function cards.badge(label)
  return widget.html(dom.span { __rawText = "Card: " .. label })
end
```

An ordinary page can use:

```markdown
${cards.title("index")}
${cards.badge("Ready")}
${query[[from p = index.pages("book") where p.status == "unread" order by p.name select { Title = p.name }]]}
```

`${widgets.commandButton("Navigate: Tag Picker")}` is deliberately unavailable. Known unexposed Lua functions and syscalls now report that the API is unavailable in restricted expressions and ask a Builder to expose a reviewed helper in Library or CONFIG. Unknown names still produce ordinary Lua errors. Denial placeholders never invoke the original function.

## Available API scope

The initial inventory is 58 builtins, `template.new`, 21 read syscalls, and seven bundled trusted exports, plus reviewed functions installed by a Builder.

- Globals: `assert`, `type`, `tostring`, `tonumber`, `select`, `next`, `pairs`, `ipairs`, `error`, `pcall`, `xpcall`, `setmetatable`, `getmetatable`, `rawlen`, `rawset`, `rawget`, `rawequal`.
- `math`: `abs`, `ceil`, `floor`, `max`, `min`, `sqrt`, `sin`, `cos`, `log`, `exp`, `fmod`, `modf`, `tointeger`, `type`, `ult`.
- `string`: `len`, `lower`, `upper`, `sub`, `reverse`, `byte`, `char`, `find`, `match`, `gsub`, `gmatch`, `format`, `rep`, `startsWith`.
- `table`: `insert`, `remove`, `sort`, `concat`, `unpack`, `pack`, `move`, `includes`, `find`, `select`.
- Other helpers: `os.date`, `spacelua.interpolate`, `template.new`.
- `space`: `listPages`, `readPage`, `readPageWithMeta`, `getPageMeta`, `listDocuments`.
- `index`: `tag`, `objects`, `pages`, `subPages`, `documents`, `links`, `relations`, `contentPages`, `metaPages`, `tasks`, `headers`, `items`, `paragraphs`, `tables`.
- `pageVars.get`, `markdown.link`.
- `templates`: `pageItem`, `fullPageItem`, `taskItem`, `itemItem`, `paragraphItem`, `tagItem`.
- `widgets.subPages`.

SLIQ query operations remain available. Query sources materialize at most 10,000 rows and throw above that limit; a later `where` or `limit` does not avoid it. Raw and metatable operations apply to Lua tables, not host objects. Generic HTML/DOM/button constructors and `tags.*` shorthand are not exposed.

## Code map

- `server/src/auth/access.rs`: access levels, protected path authorization, aliases and symlinks.
- `server/src/multi/`: membership configuration, public access and live policy.
- `server/src/router.rs`, `server/src/handlers/`: endpoint enforcement, file writes and `canBuild` configuration.
- `server/src/ssr.rs`: raw HTML and unsafe URL handling.
- `client/space_lua/restricted_env.ts`: builtin allowlist and denial messages.
- `client/space_lua/restricted_context.ts`: annotated syscall and installed function adapters, detached arguments/results and query limits.
- `client/space_lua/restricted_render.ts`: render result validation and opaque widget tokens.
- `client/space_lua/runtime.ts`, `eval.ts`: native-call and host-object enforcement, policy propagation and original Lua callback tracking.
- `client/space_lua/page_scope.ts`, `render_thread.ts`, `render_widget.ts`: page/assignment rendering, per-render context and trusted widget entry points.
- `plug-api/lib/trusted_script_source.ts`, `plugs/index/`: source provenance, indexing and linting.
- `client/dashboard/`, `client/workbench/`, `client/spaces/checked_space_primitives.ts`: role UI and client write protections.
- `docs/Space Lua/Capabilities.md`, `docs/Security.md`: user-facing contract and migration guidance.
- `e2e/flows/editor_role.test.ts` and adjacent unit tests: role, restricted evaluation and bypass regression coverage.

## Evaluation and known limits

Regression coverage includes host/native escapes, policy loss through callbacks, forged widget output, assignment render bypasses, concurrent render state, forged indexed script records, protected path aliases, direct HTTP permission enforcement and trusted widget rendering. Existing browser fixtures were migrated to trusted Library definitions without weakening their assertions.

This is not an absolute abuse guarantee. The evaluator shares the browser process and uses cooperative budgets; large allocations and non-yielding native work still need stronger resource isolation. Trusted helpers can perform destructive actions if their author exposes them incorrectly. The server filesystem boundary and trusted-code boundary are separate protections.

Editor mutations scan Library for reverse symlink aliases. Broken or unreadable links fail closed; large libraries may need performance work. Executable HTML/CSS/JS outside Library are served as downloads with octet-stream and nosniff. SSR escapes raw HTML and neutralizes unsafe URLs. Markdown HTML `data-onclick` is stripped, including library-generated Markdown; trusted DOM widgets can still install event listeners. These are intentional compatibility changes needing release review.

Before production rollout: perform an independent security review, evaluate process-level execution limits, exercise large Library trees and symlink layouts, and review migration UX and the initial API allowlist. Extend the allowlist only with audited APIs and boundary regression tests.

## Validation

Final verification on 2026-11-08:

- `make fmt`: passed.
- `make check`: passed (TypeScript, lint, formatting and Rust clippy).
- `NODE_OPTIONS=--localstorage-file=/private/tmp/editor-role-storage make test`: passed; 5,289 TypeScript tests and 2,596 Rust tests, with eight Rust tests ignored. Runtime browser integration tests ran with the Playwright browser.
- `make test-e2e E2E_ARGS=--workers=4`: all 177 browser tests passed in 3.1 minutes on the final full run.
- `git diff --check`: passed.

The first sandboxed test attempt could not bind local networking and failed with `Operation not permitted`; the suite was rerun with the required permissions. An earlier browser run had two timing/layout failures in navigation and setup; both passed on targeted rerun without code changes. Desktop checks are excluded from this Server-only evaluation at the user's request.

Local verification logs: `/private/tmp/editor-push-{fmt,check,test,e2e}.log`. These logs are not committed.

## Local evaluation environment

The working checkout is `/private/tmp/silverbullet-lua-safe-mode-prototype`. A local demo was started at `http://127.0.0.1:3097/demo/`, with data in `/private/tmp/silverbullet-editor-demo.j9X2Os`. It includes query, widget, blocked-expression and ignored-script examples, plus Reader/Editor/Builder demo accounts. Temporary demo data and verification scripts are not part of this commit. Preserve any user edits in that space; do not reseed it blindly. Temporary paths and the running process are not durable deployment artifacts.

For future runs, build the Server normally, create a multi-space setup with the three roles, and set `SB_DISABLE_SERVICE_WORKER=1` while testing. See the role browser test for reproducible fixtures. The main Server submodule checkout and Desktop implementation were left unchanged.
