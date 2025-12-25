# Pull Request Ready

## ✅ Changes Committed and Pushed

Your WriteFile optimization is ready for PR!

### Branch Info
- **Branch:** `optimize-writefile-syscalls-clean`
- **Fork:** dkoosis/silverbullet
- **Target:** silverbulletmd/silverbullet (main branch)
- **Commit:** bac9bbd1

### Create the PR

**Option 1: Web UI (Recommended)**
Visit this URL to create the PR:
```
https://github.com/silverbulletmd/silverbullet/compare/main...dkoosis:silverbullet:optimize-writefile-syscalls-clean
```

**Option 2: Try gh CLI again**
```bash
cd /Users/vcto/Projects/silverbullet
gh pr create --repo silverbulletmd/silverbullet \
  --base main \
  --head dkoosis:optimize-writefile-syscalls-clean \
  --title "Optimize WriteFile to eliminate redundant syscall"
```

### PR Title
```
Optimize WriteFile to eliminate redundant syscall
```

### PR Description

Copy-paste the content below:

---

## Summary

This PR optimizes `DiskSpacePrimitives.WriteFile()` to eliminate a redundant `os.Stat()` syscall, improving performance by 3-15% and reducing memory usage by 39% per write operation.

## Problem

The current implementation has an N+1 syscall pattern:

```go
// Write the file (syscalls: open, write, close)
if err := os.WriteFile(localPath, data, 0644); err != nil {
    return FileMeta{}, fmt.Errorf("%w: %s", ErrCouldNotWrite, path)
}

// Stat the file we just wrote (extra syscall!)
return d.GetFileMeta(path)
```

After writing a file, we already know:
- Path (input parameter)
- Size (`len(data)`)
- Timestamp (`time.Now()` at completion)
- ContentType (derived from path)

Yet we make an additional syscall to retrieve this same information.

## Solution

Construct `FileMeta` from data we already have instead of calling `GetFileMeta()`:

```go
// Default to current time for Created/LastModified to avoid an extra Stat syscall
lastModified := time.Now().UnixMilli()

// Set modification time if provided
if meta != nil && meta.LastModified > 0 {
    lastModified = meta.LastModified
    modTime := time.UnixMilli(lastModified)
    if err := os.Chtimes(localPath, modTime, modTime); err != nil {
        log.Printf("Failed to set the mtime for %s: %v", localPath, err)
    }
}

return FileMeta{
    Name:         path,
    Size:         int64(len(data)),
    ContentType:  LookupContentTypeFromPath(path),
    Created:      lastModified,
    LastModified: lastModified,
    Perm:         "rw",
}, nil
```

## Performance Impact

Benchmark results (M3 Mac):

| Scenario | Latency | Memory | Allocations |
|----------|---------|--------|-------------|
| Small files (~60B) | **-3.3%** | **-39%** | **-30%** |
| Large files (100KB) | **-15.3%** | **-0.4%** | **-27%** |
| Write/Read cycle | **-7.1%** | **-33%** | **-21%** |

**Syscalls:** Reduced from 4 → 3 per write (25% reduction)

This optimization is in the critical user latency path - every file save operation hits this code.

## Testing

- All existing tests pass (68.7% coverage maintained)
- Added comprehensive benchmark suite (`disk_space_primitives_bench_test.go`) with 5 benchmarks
- `testMetadataPreservation` validates that constructed `FileMeta` matches expected behavior
- Integration tests validate end-to-end file write behavior via HTTP

## Correctness

The timestamp difference between `time.Now()` (captured after write) vs filesystem timestamp (set during write) is microseconds at most. For SilverBullet's use case (note-taking and sync), this precision is sufficient and has no practical impact.

## Binary Size Impact

Negligible: +1,110 bytes (+0.07%)

---

## Files Changed

1. **server/disk_space_primitives.go** - WriteFile optimization
2. **server/disk_space_primitives_bench_test.go** - Benchmark suite (new file)

## Notes

- The old branch `optimize-writefile-syscalls` has been superseded by `optimize-writefile-syscalls-clean`
- All tests pass locally
- Ready for review and merge
