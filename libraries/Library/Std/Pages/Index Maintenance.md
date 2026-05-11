#meta

Use this page to inspect planner-visible index statistics and run common recovery actions:

- ${widgets.commandButton('Space: Reindex')} or
- ${widgets.commandButton('Client: Wipe')} (in rare cases).

# Weak stats

Shows tags whose planner-visible source stats are not fully trusted or do not currently advertise bitmap-capable pushdown. If this section is empty, no weak source stats were found.

${query [[
  from
    s = index.stats()
  where
    s.column == nil and
    s.statsSource ~= 'augmenter' and
    (
      s.statsSource ~= 'persisted-complete' or
      s.predicatePushdown == 'none'
    )
  select
    tag = s.tag,
    rowCount = s.rowCount,
    avgColumnCount = s.avgColumnCount,
    statsSource = s.statsSource,
    predicatePushdown = s.predicatePushdown,
    scanKind = s.scanKind
  order by
    s.rowCount desc,
    s.tag
]]}

# Large tags without pushdown

Shows larger tags that currently do not advertise bitmap-capable pushdown. These are good candidates for reindexing or further inspection. If this section is empty, no large tags without bitmap pushdown were found.

${query [[
  from
    s = index.stats()
  where
    s.column == nil and
    s.statsSource ~= 'augmenter' and
    s.rowCount >= 100 and
    s.predicatePushdown == 'none'
  select
    tag = s.tag,
    rowCount = s.rowCount,
    avgColumnCount = s.avgColumnCount,
    statsSource = s.statsSource,
    predicatePushdown = s.predicatePushdown
  order by
    s.rowCount desc
]]}

# Highly selective indexed columns

Shows indexed columns whose NDV is close to row count. These columns may be expensive to index unless intentionally forced. If this section is empty, no highly selective indexed columns were found.

${query [[
  from
    s = index.stats()
  where
    s.column ~= nil and
    s.indexed == true and
    s.rowCount >= 20 and
    s.ndv ~= nil and
    (s.ndv / s.rowCount) > 0.8
  select
    tag = s.tag,
    column = s.column,
    rowCount = s.rowCount,
    ndv = s.ndv,
    ndvRatio = s.rowCount > 0 and (s.ndv / s.rowCount) or 0,
    trackedMcvValues = s.trackedMcvValues
  order by
    ndvRatio desc,
    s.rowCount desc
]]}

# Indexed columns with zero NDV

Shows indexed columns that report zero distinct values despite having rows. Common for consistently empty columns (e.g. `tags` on `table` objects with no `#hashtags`). It is a bookkeeping issue only if values were expected but not indexed. If this section is empty, no indexed columns with zero NDV were found.

${query [[
  from
    s = index.stats()
  where
    s.column ~= nil and
    s.indexed == true and
    s.rowCount > 0 and
    s.ndv == 0
  select
    tag = s.tag,
    column = s.column,
    rowCount = s.rowCount,
    ndv = s.ndv,
    indexed = s.indexed,
    trackedMcvValues = s.trackedMcvValues
  order by
    s.rowCount desc,
    s.tag,
    s.column
]]}

# Wide tags

Shows tags with many average columns and enough rows to matter operationally. Wide tags may be more expensive to scan and join. If this section is empty, no wide tags were found.

${query [[
  from
    s = index.stats()
  where
    s.column == nil and
    s.statsSource ~= 'augmenter' and
    s.rowCount >= 20 and
    s.avgColumnCount >= 15
  select
    tag = s.tag,
    rowCount = s.rowCount,
    avgColumnCount = s.avgColumnCount,
    statsSource = s.statsSource
  order by
    s.avgColumnCount desc,
    s.rowCount desc
]]}

# Always-indexed columns

Shows columns that are force-indexed regardless of selectivity. By default this is `page` and `tag`. Custom additions here may be expensive if their NDV is high. If this section is empty, no always-indexed columns beyond the defaults were found.

${query [[
  from
    s = index.stats()
  where
    s.column ~= nil and
    s.alwaysIndexed == true and
    s.column ~= 'page' and
    s.column ~= 'tag'
  select
    tag = s.tag,
    column = s.column,
    rowCount = s.rowCount,
    ndv = s.ndv,
    ndvRatio = s.rowCount > 0 and (s.ndv / s.rowCount) or 0
  order by
    ndvRatio desc,
    s.rowCount desc,
    s.tag,
    s.column
]]}

# Empty or incomplete tags

Shows tags that look empty or whose base source stats are incomplete. If this section is empty, no empty or incomplete tags were found.

${query [[
  from
    s = index.stats()
  where
    s.column == nil and
    (
      s.statsSource == 'computed-empty' or
      s.statsSource == 'persisted-partial' or
      s.rowCount == 0
    )
  select
    tag = s.tag,
    rowCount = s.rowCount,
    statsSource = s.statsSource,
    predicatePushdown = s.predicatePushdown
  order by
    s.tag
]]}

# Overhead ratio

Shows tags where the index structure occupies more space than the stored objects themselves. A high ratio can mean many small objects or a large dictionary. If this section is empty, no high-overhead tags were found.

${query [[
  from
    st = index.storageStats()
  where
    st.scope == 'tag' and
    st.objectBytes > 0 and
    st.rowCount >= 10 and
    (st.indexBytes / st.objectBytes) > 1
  select
    tag = st.tag,
    rowCount = st.rowCount,
    objectBytes = st.objectBytes,
    indexBytes = st.indexBytes,
    overheadRatio = st.indexBytes / st.objectBytes
  order by
    overheadRatio desc,
    st.totalBytes desc
]]}

# Augmenter coverage gap

Shows augmenter-provided columns whose cache coverage is far below the tag's bitmap row count. Low coverage means the virtual overlay is missing most objects. If this section is empty, no augmenter coverage gaps were found.

${query [[
  from
    s = index.stats(),
    t = index.stats()
  where
    s.statsSource == 'augmenter' and
    t.tag == s.tag and
    t.column == nil and
    t.rowCount > 0 and
    s.rowCount < t.rowCount * 0.5
  select
    tag = s.tag,
    column = s.column,
    cacheRows = s.rowCount,
    totalRows = t.rowCount,
    coverage = s.rowCount / t.rowCount
  order by
    coverage,
    t.rowCount desc,
    s.column
]]}

# Summary

Shows the main issues worth acting on first. If this section is empty, no summary issues were found.

${query [[
  from
    s = index.stats()
  where
    s.column == nil and
    s.statsSource ~= 'augmenter' and
    (
      s.statsSource ~= 'persisted-complete' or
      (s.rowCount >= 100 and s.predicatePushdown == 'none')
    )
  select
    tag = s.tag,
    rowCount = s.rowCount,
    avgColumnCount = s.avgColumnCount,
    statsSource = s.statsSource,
    predicatePushdown = s.predicatePushdown,
    warning =
      s.statsSource ~= 'persisted-complete' and
        'reindex recommended' or
      (s.rowCount >= 100 and s.predicatePushdown == 'none') and
        'large tag without bitmap pushdown' or
      nil
  order by
    s.rowCount desc,
    s.tag
]]}
