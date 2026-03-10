Headers (lines starting with `#`, `##` etc.) are indexed as well and queryable via the `header` tag.

### Test header

${query[[from index.tag "header" where page == _CTX.currentPage.name limit 3]]}
