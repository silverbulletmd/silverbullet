Headers (lines starting with `#`, `##` etc.) are indexed as well and queryable via the `header` tag.

${query[[from index.tag "header" where page == _CTX.currentPage.name limit 3]]}
