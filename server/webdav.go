package server

import (
	"encoding/xml"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"path"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
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

type DAVProp struct {
	XMLName       xml.Name         `xml:"prop"`
	DisplayName   string           `xml:"displayname,omitempty"`
	ContentLength int64            `xml:"getcontentlength,omitempty"`
	ContentType   string           `xml:"getcontenttype,omitempty"`
	LastModified  string           `xml:"getlastmodified,omitempty"`
	CreationDate  string           `xml:"creationdate,omitempty"`
	ResourceType  *DAVResourceType `xml:"resourcetype,omitempty"`
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

func init() {
	// Register additional WebDAV methods with chi
	chi.RegisterMethod("PROPFIND")
	chi.RegisterMethod("PROPPATCH")
	chi.RegisterMethod("MKCOL")
	chi.RegisterMethod("COPY")
	chi.RegisterMethod("MOVE")
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
	fsRouter.Options("/", handleWebDAVOptions)
	fsRouter.Options("/*", handleWebDAVOptions)
}

func handleWebDAVOptions(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Allow", "GET, PUT, DELETE, PROPFIND, PROPPATCH, MKCOL, COPY, MOVE, OPTIONS")
	w.Header().Set("DAV", "1")
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

	// Get depth header (default is infinity)
	depth := r.Header.Get("Depth")
	if depth == "" {
		depth = "infinity"
	}

	var responses []DAVResponse

	log.Printf("Got request for depth %s: %s", depth, requestPath)

	// Always include the root
	responses = append(responses, createRootCollectionResponse(r))
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

	multistatus := DAVMultistatus{
		Responses: responses,
	}

	w.Header().Set("Content-Type", "application/xml; charset=utf-8")
	w.WriteHeader(http.StatusMultiStatus)

	xmlData, err := xml.MarshalIndent(multistatus, "", "  ")
	if err != nil {
		http.Error(w, "Failed to generate XML response", http.StatusInternalServerError)
		return
	}

	w.Write([]byte(xml.Header))
	w.Write(xmlData)
}

func createRootCollectionResponse(r *http.Request) DAVResponse {
	href := getBaseURL(r) + "/"
	now := time.Now().Format(time.RFC1123)

	return DAVResponse{
		Href: href,
		Propstat: []DAVPropstat{
			{
				Prop: DAVProp{
					DisplayName:  "Root",
					ResourceType: &DAVResourceType{Collection: &struct{}{}},
					LastModified: now,
					CreationDate: now,
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

	w.Header().Set("Content-Type", "application/xml; charset=utf-8")
	w.WriteHeader(http.StatusMultiStatus)

	xmlData, err := xml.MarshalIndent(multistatus, "", "  ")
	if err != nil {
		http.Error(w, "Failed to generate XML response", http.StatusInternalServerError)
		return
	}

	w.Write([]byte(xml.Header))
	w.Write(xmlData)
}

// handleMkCol handles MKCOL requests for creating collections (directories)
func handleMkCol(w http.ResponseWriter, r *http.Request) {
	requestPath, err := getPath(w, r)
	if err != nil {
		return
	}

	if requestPath == "" {
		http.Error(w, "Cannot create collection at root", http.StatusForbidden)
		return
	}

	spaceConfig := spaceConfigFromContext(r.Context())

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
	sourcePath, err := getPath(w, r)
	if err != nil {
		return
	}

	destination := r.Header.Get("Destination")
	if destination == "" {
		http.Error(w, "Missing Destination header", http.StatusBadRequest)
		return
	}

	// Parse destination URL to get path
	destURL, err := url.Parse(destination)
	if err != nil {
		http.Error(w, "Invalid destination URL", http.StatusBadRequest)
		return
	}

	destPath := strings.TrimPrefix(destURL.Path, "/fs/")
	if destPath == destURL.Path {
		// Try without /fs/ prefix
		destPath = strings.TrimPrefix(destURL.Path, "/")
	}

	overwrite := r.Header.Get("Overwrite") != "F"

	spaceConfig := spaceConfigFromContext(r.Context())

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
	sourcePath, err := getPath(w, r)
	if err != nil {
		return
	}

	destination := r.Header.Get("Destination")
	if destination == "" {
		http.Error(w, "Missing Destination header", http.StatusBadRequest)
		return
	}

	// Parse destination URL to get path
	destURL, err := url.Parse(destination)
	if err != nil {
		http.Error(w, "Invalid destination URL", http.StatusBadRequest)
		return
	}

	destPath := strings.TrimPrefix(destURL.Path, "/fs/")
	if destPath == destURL.Path {
		// Try without /fs/ prefix
		destPath = strings.TrimPrefix(destURL.Path, "/")
	}

	overwrite := r.Header.Get("Overwrite") != "F"

	spaceConfig := spaceConfigFromContext(r.Context())

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

// LOCK and UNLOCK handlers removed since locking is not supported
// Most WebDAV clients work fine without locking functionality

// Helper functions
func stringPtr(s string) *string {
	return &s
}

func int64Ptr(i int64) *int64 {
	return &i
}

func getBaseURL(r *http.Request) string {
	scheme := "http"
	if r.TLS != nil {
		scheme = "https"
	}
	host := r.Host
	if host == "" {
		host = r.Header.Get("Host")
	}
	return fmt.Sprintf("%s://%s/fs", scheme, host)
}

// extractDirectFilesAndFolders filters files from FetchFileList to show only direct children of a path
// This function also infers directories from file paths and creates synthetic directory entries
func extractDirectFilesAndFolders(allFiles []FileMeta, rootPath string) []FileMeta {
	var files []FileMeta
	directories := make(map[string]bool)

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
