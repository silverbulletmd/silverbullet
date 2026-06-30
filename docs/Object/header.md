---
references:
- plugs/index/header.ts
---
Headers (lines starting with `#`, `##` etc.) are indexed as well and queryable via the `header` tag.

### Test header

${query[[from index.headers() where page == _CTX.currentPage.name limit 3]]}
