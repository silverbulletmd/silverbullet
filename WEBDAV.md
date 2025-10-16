# WebDAV Support in SilverBullet

This document describes the WebDAV (Web Distributed Authoring and Versioning) implementation in SilverBullet, which allows you to access and edit your notes using standard WebDAV clients.

## Overview

SilverBullet now includes comprehensive WebDAV support, enabling you to:

- Mount your SilverBullet space as a network drive
- Edit files using any text editor or IDE
- Sync files with WebDAV-compatible applications
- Use file managers that support WebDAV

## Supported WebDAV Methods

The implementation supports all core WebDAV methods:

### Standard HTTP Methods
- **GET** - Download files and retrieve directory listings
- **PUT** - Upload and update files
- **DELETE** - Remove files and directories
- **OPTIONS** - Discover supported methods and capabilities
- **HEAD** - Get file metadata without content

### WebDAV Extension Methods
- **PROPFIND** - Retrieve properties and directory listings
- **PROPPATCH** - Modify resource properties (read-only in current implementation)
- **MKCOL** - Create directories/collections
- **COPY** - Copy files and directories
- **MOVE** - Move/rename files and directories
- **LOCK** - Lock resources (basic implementation)
- **UNLOCK** - Unlock resources

## WebDAV Client Compatibility

The implementation follows RFC 4918 (WebDAV specification) and has been tested with various WebDAV clients:

### Supported Features
- Directory browsing and creation
- File upload/download
- File and directory operations (copy, move, rename, delete)
- Property queries (file size, modification time, content type)
- Basic locking support
- Proper HTTP status codes (including 207 Multi-Status)
- XML responses for PROPFIND operations

### Headers Supported
- `Depth` - Controls recursion depth for PROPFIND operations
- `Destination` - Target location for COPY/MOVE operations
- `Overwrite` - Controls overwrite behavior (T/F)
- `Lock-Token` - Lock token for LOCK/UNLOCK operations
- `DAV` - WebDAV compliance level advertisement

## Usage Examples

### Mounting as Network Drive

#### macOS Finder
1. Open Finder
2. Go to "Go" → "Connect to Server" (⌘K)
3. Enter: `http://your-silverbullet-server:port/fs/`
4. Click "Connect"

#### Windows Explorer
1. Open File Explorer
2. Right-click "This PC" → "Map network drive"
3. Enter: `http://your-silverbullet-server:port/fs/`
4. Check "Connect using different credentials" if needed

#### Linux (using davfs2)
```bash
# Install davfs2
sudo apt-get install davfs2

# Create mount point
sudo mkdir /mnt/silverbullet

# Mount the WebDAV share
sudo mount -t davfs http://your-server:port/fs/ /mnt/silverbullet
```

### Command Line Tools

#### Using curl
```bash
# List directory contents
curl -X PROPFIND -H "Depth: 1" http://your-server:port/fs/

# Upload a file
curl -X PUT -T "local-file.md" http://your-server:port/fs/remote-file.md

# Download a file
curl -X GET http://your-server:port/fs/some-file.md

# Create a directory
curl -X MKCOL http://your-server:port/fs/new-directory/

# Copy a file
curl -X COPY -H "Destination: http://your-server:port/fs/copy.md" \
     http://your-server:port/fs/original.md

# Move/rename a file
curl -X MOVE -H "Destination: http://your-server:port/fs/new-name.md" \
     http://your-server:port/fs/old-name.md

# Delete a file
curl -X DELETE http://your-server:port/fs/file-to-delete.md
```

#### Using cadaver (WebDAV client)
```bash
# Connect to the server
cadaver http://your-server:port/fs/

# Once connected, you can use standard commands:
ls                    # list files
cd directory/         # change directory
get file.md          # download file
put local.md         # upload file
mkdir new-dir        # create directory
copy file1.md file2.md  # copy file
move old.md new.md   # move/rename file
delete file.md       # delete file
```

## Technical Implementation Details

### Architecture
The WebDAV implementation extends the existing filesystem API (`/fs/*`) with support for WebDAV methods. It integrates with the existing `SpacePrimitives` interface, ensuring compatibility with all storage backends.

### Key Components
- **Method Registration**: Uses `chi.RegisterMethod()` to support custom HTTP methods
- **XML Processing**: Handles WebDAV XML requests and responses using Go's `encoding/xml`
- **Property System**: Implements DAV properties like `getcontentlength`, `getlastmodified`, `resourcetype`
- **Collection Support**: Proper handling of directories as WebDAV collections
- **Multi-Status Responses**: Returns appropriate 207 Multi-Status responses for PROPFIND operations
- **Directory Filtering**: Uses `FetchFileList()` with path filtering to efficiently generate directory listings
- **Directory Inference**: Automatically detects directories by analyzing file paths and creates synthetic directory entries

### Storage Backend Integration
The implementation works with all existing SilverBullet storage backends:
- **DiskSpacePrimitives** - Local filesystem storage
- **ReadOnlySpacePrimitives** - Read-only wrapper
- **ReadOnlyFallthroughSpacePrimitives** - Embedded file fallback

### Extended Interface
The `SpacePrimitives` interface has been extended with one new method:
- `CreateDirectory(path string) error` - Create directories

Directory listings are handled by filtering the results from the existing `FetchFileList()` method, which returns all files in the space. The WebDAV implementation filters these results to show only the relevant files for each directory.

**Important**: Directories do not exist as stored entities in SilverBullet's internal file system. They are purely WebDAV synthetic entities that are inferred from file paths during PROPFIND operations. The internal `FileMeta` structure only represents actual files - directories are never stored or tracked internally.

The WebDAV layer automatically infers directories from file paths during client requests. For example, if there's a file at `notes/meeting.md`, the WebDAV handler creates a temporary synthetic directory entry for `notes/` and presents it as a proper WebDAV collection with appropriate properties, but this directory doesn't exist in the internal file system.

The system handles complex nested structures intelligently. Even if a directory contains only other directories (no direct files), it will still be detected and presented correctly during WebDAV operations. For instance, with files at `project/src/components/Button.md` and `project/docs/api/readme.md`, the WebDAV layer will show:
- `project/` directory (contains only subdirectories)
- `project/src/` directory (when browsing into project)
- `project/docs/` directory (when browsing into project)

### File Metadata
The `FileMeta` structure represents actual files only and includes:
- Enhanced content type detection for real files
- Proper creation and modification timestamps
- No directory-related fields (directories are WebDAV-only synthetic entities)

## Configuration

### Server Headers
The WebDAV endpoint advertises the following capabilities:
- `DAV: 1, 2` - WebDAV compliance levels
- `MS-Author-Via: DAV` - Microsoft WebDAV compatibility
- Appropriate `Allow` headers for supported methods

### CORS and Security
The implementation respects existing SilverBullet authentication and authorization mechanisms. WebDAV requests go through the same middleware stack as regular HTTP requests.

## Limitations and Known Issues

### Current Limitations
1. **Locking**: Basic lock implementation - tokens are generated but not persisted
2. **Properties**: Most properties are read-only (PROPPATCH operations return 403)
3. **Namespace Operations**: Copy/Move operations work within the same space only
4. **Versioning**: No DeltaV (versioning) support
5. **Advanced Features**: No support for WebDAV extensions like CalDAV or CardDAV

### File System Considerations
- Hidden files (starting with `.`) are filtered out by default
- Files without extensions are excluded from listings (following SilverBullet conventions)
- GitIgnore patterns are respected
- **Directories are WebDAV-only**: Directories do not exist in the internal file system and are never stored as `FileMeta` entries
- **Directory inference**: Directories are inferred from file paths only during WebDAV PROPFIND operations
- **Synthetic directory properties**: Directory timestamps, sizes, and metadata are generated on-the-fly during WebDAV requests
- **Nested directory detection**: Intermediate directories without direct files are properly detected (e.g., if only `project/src/components/file.md` exists, both `project/` and `project/src/` directories will be shown to WebDAV clients)
- **Empty directories**: Empty directories (with no files anywhere in their tree) will not appear in listings until they contain files

## Troubleshooting

### Common Issues

#### Authentication Problems
- Ensure your WebDAV client supports the same authentication method as your SilverBullet server
- Some clients may require explicit credentials even for public servers

#### Path Issues
- Always use `/fs/` as the base path for WebDAV operations
- Ensure proper URL encoding for special characters in file names

#### Client Compatibility
- Some older WebDAV clients may not support all features
- Try different clients if you encounter compatibility issues

### Debugging
Enable HTTP logging in SilverBullet to see WebDAV requests:
```bash
silverbullet --http-log serve your-space/
```

### Testing WebDAV Functionality
The implementation includes comprehensive tests in `webdav_test.go` covering:
- Method support verification
- PROPFIND operations
- Collection creation
- File operations (copy, move, delete)
- Basic locking

## Future Enhancements

### Planned Features
- Persistent locking with lock database
- Enhanced property support
- WebDAV versioning integration
- Performance optimizations for large directories
- Advanced WebDAV extensions

### Contributing
To contribute to the WebDAV implementation:
1. Review the existing code in `server/fs.go`
2. Add tests for new functionality in `server/webdav_test.go`
3. Ensure compatibility with existing storage backends
4. Follow WebDAV standards (RFC 4918)

## References

- [RFC 4918 - HTTP Extensions for WebDAV](https://tools.ietf.org/html/rfc4918)
- [WebDAV Resources](http://www.webdav.org/)
- [SilverBullet Documentation](https://silverbullet.md/)
