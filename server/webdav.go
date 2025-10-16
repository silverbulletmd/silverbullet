package server

import (
	"encoding/xml"
	"fmt"
	"io"
	"log"
	"net/http"
	"path"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/render"
)

// WebDAV XML namespace constants
const (
	DAVNamespace         = "DAV:"
	DAVFolderContentType = "httpd/unix-directory"
)

// WebDAV XML structures
type DAVMultistatus struct {
	XMLName   xml.Name      `xml:"DAV: multistatus"`
	Responses []DAVResponse `xml:"response"`
}

type DAVResponse struct {
	XMLName  xml.Name      `xml:"response"`
	Href     string        `xml:"href"`
	Propstat []DAVPropstat `xml:"propstat"`
}

type DAVPropstat struct {
	XMLName xml.Name `xml:"propstat"`
	Prop    DAVProp  `xml:"prop"`
	Status  string   `xml:"status"`
}

type DAVResourceType struct {
	XMLName    xml.Name  `xml:"resourcetype"`
	Collection *struct{} `xml:"collection,omitempty"`
}

type DAVPropPatch struct {
	XMLName xml.Name    `xml:"propertyupdate"`
	Set     []DAVSet    `xml:"set"`
	Remove  []DAVRemove `xml:"remove"`
}

type DAVSet struct {
	XMLName xml.Name `xml:"set"`
	Prop    DAVProp  `xml:"prop"`
}

type DAVRemove struct {
	XMLName xml.Name `xml:"remove"`
	Prop    DAVProp  `xml:"prop"`
}

// Lock-related XML structures for mock implementation
type DAVLockInfo struct {
	XMLName   xml.Name      `xml:"DAV: lockinfo"`
	LockScope DAVLockScope  `xml:"lockscope"`
	LockType  DAVLockType   `xml:"locktype"`
	Owner     *DAVLockOwner `xml:"owner,omitempty"`
}

type DAVLockScope struct {
	XMLName   xml.Name  `xml:"lockscope"`
	Exclusive *struct{} `xml:"exclusive,omitempty"`
	Shared    *struct{} `xml:"shared,omitempty"`
}

type DAVLockType struct {
	XMLName xml.Name  `xml:"locktype"`
	Write   *struct{} `xml:"write,omitempty"`
}

type DAVLockOwner struct {
	XMLName xml.Name `xml:"owner"`
	Href    string   `xml:"href,omitempty"`
	Value   string   `xml:",chardata"`
}

type DAVProp struct {
	XMLName       xml.Name          `xml:"prop"`
	DisplayName   string            `xml:"displayname,omitempty"`
	ContentLength int64             `xml:"getcontentlength,omitempty"`
	ContentType   string            `xml:"getcontenttype,omitempty"`
	LastModified  string            `xml:"getlastmodified,omitempty"`
	CreationDate  string            `xml:"creationdate,omitempty"`
	ResourceType  *DAVResourceType  `xml:"resourcetype,omitempty"`
	LockDiscovery *DAVLockDiscovery `xml:"lockdiscovery,omitempty"`
	SupportedLock *DAVSupportedLock `xml:"supportedlock,omitempty"`
}

type DAVLockDiscovery struct {
	XMLName    xml.Name        `xml:"lockdiscovery"`
	ActiveLock []DAVActiveLock `xml:"activelock"`
}

type DAVActiveLock struct {
	XMLName   xml.Name      `xml:"activelock"`
	LockType  DAVLockType   `xml:"locktype"`
	LockScope DAVLockScope  `xml:"lockscope"`
	Depth     string        `xml:"depth"`
	Owner     *DAVLockOwner `xml:"owner,omitempty"`
	Timeout   string        `xml:"timeout"`
	LockToken DAVLockToken  `xml:"locktoken"`
}

type DAVSupportedLock struct {
	XMLName   xml.Name       `xml:"supportedlock"`
	LockEntry []DAVLockEntry `xml:"lockentry"`
}

type DAVLockEntry struct {
	XMLName   xml.Name     `xml:"lockentry"`
	LockScope DAVLockScope `xml:"lockscope"`
	LockType  DAVLockType  `xml:"locktype"`
}

type DAVLockToken struct {
	XMLName xml.Name `xml:"locktoken"`
	Href    string   `xml:"href"`
}

func init() {
	// Register additional WebDAV methods with chi
	chi.RegisterMethod("PROPFIND")
	chi.RegisterMethod("PROPPATCH")
	chi.RegisterMethod("MKCOL")
	chi.RegisterMethod("COPY")
	chi.RegisterMethod("MOVE")
	chi.RegisterMethod("LOCK")
	chi.RegisterMethod("UNLOCK")
}

// buildWebDAVRoutes adds WebDAV-specific routes to the filesystem router
func buildWebDAVRoutes(fsRouter chi.Router) {
	// WebDAV method routes
	fsRouter.Method("PROPFIND", "/", http.HandlerFunc(handlePropFind))
	fsRouter.Method("PROPFIND", "/*", http.HandlerFunc(handlePropFind))
	fsRouter.Method("PROPPATCH", "/*", http.HandlerFunc(handlePropPatch))
	fsRouter.Method("MKCOL", "/", http.HandlerFunc(handleMkCol))
	fsRouter.Method("MKCOL", "/*", http.HandlerFunc(handleMkCol))
	fsRouter.Method("COPY", "/*", http.HandlerFunc(handleCopy))
	fsRouter.Method("MOVE", "/*", http.HandlerFunc(handleMove))
	fsRouter.Method("LOCK", "/*", http.HandlerFunc(handleLock))
	fsRouter.Method("UNLOCK", "/*", http.HandlerFunc(handleUnlock))
	fsRouter.Options("/", handleWebDAVOptions)
	fsRouter.Options("/*", handleWebDAVOptions)
}

func handleWebDAVOptions(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Allow", "GET, PUT, DELETE, PROPFIND, PROPPATCH, MKCOL, COPY, MOVE, LOCK, UNLOCK, OPTIONS")
	w.Header().Set("DAV", "1, 2")
	w.Header().Set("MS-Author-Via", "DAV")
	w.WriteHeader(http.StatusOK)
}

// handlePropFind handles PROPFIND requests for WebDAV
func handlePropFind(w http.ResponseWriter, r *http.Request) {
	spaceConfig := spaceConfigFromContext(r.Context())
	requestPath, err := getPath(w, r)
	if err != nil {
		return
	}
	requestPath = strings.TrimRight(requestPath, "/")

	// Get depth header (default is infinity)
	depth := r.Header.Get("Depth")
	if depth == "" {
		depth = "infinity"
	}

	var responses []DAVResponse

	log.Printf("Got request for depth %s: %s", depth, requestPath)

	// Check if this is an individual file
	meta, err := spaceConfig.SpacePrimitives.GetFileMeta(requestPath)
	if err == nil {
		log.Println("It's a file!")
		// It exists, let's just return the meta data for it then
		responses = append(responses, createFileResponse(r, meta))
	} else if spaceConfig.SpacePrimitives.IsDirectory(requestPath) {
		log.Println("It's a folder!")
		// Always include the root
		responses = append(responses, createRootCollectionResponse(r, requestPath))
		// And files and folders underneath if depth > 0
		if depth != "0" {
			allFiles, err := spaceConfig.SpacePrimitives.FetchFileList()
			if err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}

			// Filter for root level filteredFiles/directories only
			filteredFiles := extractDirectFilesAndFolders(allFiles, requestPath)

			for _, file := range filteredFiles {
				responses = append(responses, createFileResponse(r, file))
			}
		}
		log.Printf("File listing: %+v", responses)
	} else {
		// 404
		log.Println("Not Found")
		http.Error(w, "Not Found", http.StatusNotFound)
	}

	multistatus := DAVMultistatus{
		Responses: responses,
	}

	w.WriteHeader(http.StatusMultiStatus)
	render.XML(w, r, multistatus)
}

func createRootCollectionResponse(r *http.Request, rootPath string) DAVResponse {
	href := getBaseURL(r) + "/" + rootPath
	now := time.Now().Format(time.RFC1123)

	return DAVResponse{
		Href: href,
		Propstat: []DAVPropstat{
			{
				Prop: DAVProp{
					DisplayName:  path.Base(rootPath),
					ResourceType: &DAVResourceType{Collection: &struct{}{}},
					LastModified: now,
					CreationDate: now,
					SupportedLock: &DAVSupportedLock{
						LockEntry: []DAVLockEntry{
							{
								LockScope: DAVLockScope{Exclusive: &struct{}{}},
								LockType:  DAVLockType{Write: &struct{}{}},
							},
							{
								LockScope: DAVLockScope{Shared: &struct{}{}},
								LockType:  DAVLockType{Write: &struct{}{}},
							},
						},
					},
				},
				Status: "HTTP/1.1 200 OK",
			},
		},
	}
}

func createFileResponse(r *http.Request, meta FileMeta) DAVResponse {
	href := getBaseURL(r) + "/" + meta.Name

	var resourceType *DAVResourceType
	if meta.ContentType == DAVFolderContentType {
		resourceType = &DAVResourceType{Collection: &struct{}{}}
	}

	return DAVResponse{
		Href: href,
		Propstat: []DAVPropstat{
			{
				Prop: DAVProp{
					DisplayName:   path.Base(meta.Name),
					ContentLength: meta.Size,
					ContentType:   meta.ContentType,
					LastModified:  time.UnixMilli(meta.LastModified).Format(time.RFC1123),
					CreationDate:  time.UnixMilli(meta.Created).Format(time.RFC3339),
					ResourceType:  resourceType,
					SupportedLock: &DAVSupportedLock{
						LockEntry: []DAVLockEntry{
							{
								LockScope: DAVLockScope{Exclusive: &struct{}{}},
								LockType:  DAVLockType{Write: &struct{}{}},
							},
							{
								LockScope: DAVLockScope{Shared: &struct{}{}},
								LockType:  DAVLockType{Write: &struct{}{}},
							},
						},
					},
				},
				Status: "HTTP/1.1 200 OK",
			},
		},
	}
}

// handlePropPatch handles PROPPATCH requests
func handlePropPatch(w http.ResponseWriter, r *http.Request) {
	requestPath, err := getPath(w, r)
	if err != nil {
		return
	}

	// Create response - properties are read-only in this implementation
	response := DAVResponse{
		Href: getBaseURL(r) + "/" + requestPath,
		Propstat: []DAVPropstat{
			{
				Prop:   DAVProp{},
				Status: "HTTP/1.1 403 Forbidden", // Properties are read-only
			},
		},
	}

	multistatus := DAVMultistatus{
		Responses: []DAVResponse{response},
	}

	w.WriteHeader(http.StatusMultiStatus)
	render.XML(w, r, multistatus)
}

// handleMkCol handles MKCOL requests for creating collections (directories)
func handleMkCol(w http.ResponseWriter, r *http.Request) {
	spaceConfig := spaceConfigFromContext(r.Context())

	requestPath, err := getPath(w, r)
	if err != nil {
		return
	}

	if requestPath == "" {
		http.Error(w, "Cannot create collection at root", http.StatusForbidden)
		return
	}

	// Check if resource already exists
	_, err = spaceConfig.SpacePrimitives.GetFileMeta(requestPath)
	if err == nil {
		http.Error(w, "Resource already exists", http.StatusMethodNotAllowed)
		return
	}

	// Create the directory using the new CreateDirectory method
	err = spaceConfig.SpacePrimitives.CreateDirectory(requestPath)
	if err != nil {
		log.Printf("MKCOL failed: %v\n", err)
		if strings.Contains(err.Error(), "already exists") {
			http.Error(w, "Resource already exists", http.StatusMethodNotAllowed)
		} else {
			http.Error(w, "Failed to create collection", http.StatusInternalServerError)
		}
		return
	}

	w.WriteHeader(http.StatusCreated)
}

// handleCopy handles COPY requests
func handleCopy(w http.ResponseWriter, r *http.Request) {
	spaceConfig := spaceConfigFromContext(r.Context())

	sourcePath, err := getPath(w, r)
	if err != nil {
		http.Error(w, "Failed to get source path", http.StatusInternalServerError)
		return
	}

	destination := r.Header.Get("Destination")
	if destination == "" {
		http.Error(w, "Missing Destination header", http.StatusBadRequest)
		return
	}

	// Parse destination URL to get path
	destPath := extractPath(destination)
	overwrite := r.Header.Get("Overwrite") != "F"

	// Read source file
	data, meta, err := spaceConfig.SpacePrimitives.ReadFile(sourcePath)
	if err != nil {
		if err == ErrNotFound {
			http.NotFound(w, r)
		} else {
			http.Error(w, err.Error(), http.StatusInternalServerError)
		}
		return
	}

	// Check if destination exists
	_, err = spaceConfig.SpacePrimitives.GetFileMeta(destPath)
	destExists := err == nil

	if destExists && !overwrite {
		http.Error(w, "Destination exists and overwrite is false", http.StatusPreconditionFailed)
		return
	}

	// Write to destination
	_, err = spaceConfig.SpacePrimitives.WriteFile(destPath, data, &meta)
	if err != nil {
		log.Printf("COPY failed: %v\n", err)
		http.Error(w, "Failed to copy resource", http.StatusInternalServerError)
		return
	}

	if destExists {
		w.WriteHeader(http.StatusNoContent)
	} else {
		w.WriteHeader(http.StatusCreated)
	}
}

// handleMove handles MOVE requests
func handleMove(w http.ResponseWriter, r *http.Request) {
	spaceConfig := spaceConfigFromContext(r.Context())

	sourcePath, err := getPath(w, r)
	if err != nil {
		return
	}

	destination := r.Header.Get("Destination")
	if destination == "" {
		http.Error(w, "Missing Destination header", http.StatusBadRequest)
		return
	}

	destPath := extractPath(destination)
	overwrite := r.Header.Get("Overwrite") != "F"

	// Read source file
	data, meta, err := spaceConfig.SpacePrimitives.ReadFile(sourcePath)
	if err != nil {
		if err == ErrNotFound {
			http.NotFound(w, r)
		} else {
			http.Error(w, err.Error(), http.StatusInternalServerError)
		}
		return
	}

	// Check if destination exists
	_, err = spaceConfig.SpacePrimitives.GetFileMeta(destPath)
	destExists := err == nil

	if destExists && !overwrite {
		http.Error(w, "Destination exists and overwrite is false", http.StatusPreconditionFailed)
		return
	}

	// Write to destination
	_, err = spaceConfig.SpacePrimitives.WriteFile(destPath, data, &meta)
	if err != nil {
		log.Printf("MOVE write failed: %v\n", err)
		http.Error(w, "Failed to move resource", http.StatusInternalServerError)
		return
	}

	// Delete source
	err = spaceConfig.SpacePrimitives.DeleteFile(sourcePath)
	if err != nil {
		log.Printf("MOVE delete failed: %v\n", err)
		// Try to clean up destination
		spaceConfig.SpacePrimitives.DeleteFile(destPath)
		http.Error(w, "Failed to move resource", http.StatusInternalServerError)
		return
	}

	if destExists {
		w.WriteHeader(http.StatusNoContent)
	} else {
		w.WriteHeader(http.StatusCreated)
	}
}

// handleLock handles LOCK requests - mock implementation for macOS compatibility
func handleLock(w http.ResponseWriter, r *http.Request) {
	requestPath, err := getPath(w, r)
	if err != nil {
		return
	}

	// Generate a mock lock token
	lockToken := fmt.Sprintf("opaquelocktoken:%d-%d", time.Now().UnixNano(), len(requestPath))

	// Create a mock lock response
	activeLock := DAVActiveLock{
		LockType:  DAVLockType{Write: &struct{}{}},
		LockScope: DAVLockScope{Exclusive: &struct{}{}},
		Depth:     "0",
		Timeout:   "Second-3600", // 1 hour timeout (not enforced)
		LockToken: DAVLockToken{Href: lockToken},
	}

	// Check if we have an owner in the request
	if r.ContentLength > 0 {
		body, err := io.ReadAll(r.Body)
		if err == nil {
			var lockInfo DAVLockInfo
			if xml.Unmarshal(body, &lockInfo) == nil && lockInfo.Owner != nil {
				activeLock.Owner = lockInfo.Owner
			}
		}
	}

	lockDiscovery := DAVLockDiscovery{
		ActiveLock: []DAVActiveLock{activeLock},
	}

	response := DAVResponse{
		Href: getBaseURL(r) + "/" + requestPath,
		Propstat: []DAVPropstat{
			{
				Prop: DAVProp{
					LockDiscovery: &lockDiscovery,
				},
				Status: "HTTP/1.1 200 OK",
			},
		},
	}

	multistatus := DAVMultistatus{
		Responses: []DAVResponse{response},
	}

	// Set the lock token header for the client
	w.Header().Set("Lock-Token", "<"+lockToken+">")
	w.WriteHeader(http.StatusOK)
	render.XML(w, r, multistatus)
}

// handleUnlock handles UNLOCK requests - mock implementation
func handleUnlock(w http.ResponseWriter, r *http.Request) {
	w.WriteHeader(http.StatusNoContent)
}

func getBaseURL(r *http.Request) string {
	serverCtx := serverConfigFromContext(r.Context())
	scheme := "http"
	if r.TLS != nil {
		scheme = "https"
	}
	host := r.Host
	if host == "" {
		host = r.Header.Get("Host")
	}
	return fmt.Sprintf("%s://%s%s/.fs", scheme, host, serverCtx.HostURLPrefix)
}

// extractDirectFilesAndFolders filters files from FetchFileList to show only direct children of a path
// This function also infers directories from file paths and creates synthetic directory entries
func extractDirectFilesAndFolders(allFiles []FileMeta, rootPath string) []FileMeta {
	var files []FileMeta
	directories := make(map[string]bool)
	if rootPath != "" {
		rootPath = rootPath + "/"
	}

	for _, file := range allFiles {
		// Skip files not in the rootPath
		if !strings.HasPrefix(file.Name, rootPath) {
			continue
		}
		relativePath := strings.TrimPrefix(file.Name, rootPath)
		if !strings.Contains(relativePath, "/") {
			files = append(files, file)
		} else {
			// Nested file, let's extract the folder and create a synthetic entry for it
			parts := strings.Split(relativePath, "/")
			if len(parts) > 1 {
				dirName := parts[0]
				if !directories[dirName] {
					// No syntetic folder created just yet
					files = append(files, FileMeta{
						Name:        path.Join(rootPath, dirName),
						ContentType: DAVFolderContentType,
						Size:        0,
						// These shouldn't matter, let's just copy them from whatever first file we encounter
						Created:      file.Created,
						LastModified: file.LastModified,
						Perm:         file.Perm,
					})
					// Let's avoid duplicates
					directories[dirName] = true
				}
			}
		}
	}

	return files
}

func extractPath(url string) string {
	parts := strings.Split(url, "/.fs/")
	if len(parts) != 2 {
		log.Printf("Could not parse URL path: %s", url)
		return ""
	}
	return parts[1]
}
