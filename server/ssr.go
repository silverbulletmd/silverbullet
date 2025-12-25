package server

import (
	"fmt"
	"html/template"
	"log"
	"net/http"
	pathLib "path"
	"regexp"
	"strings"

	"github.com/gomarkdown/markdown"
	"github.com/gomarkdown/markdown/html"
	"github.com/gomarkdown/markdown/parser"
)

// This implements very crude server-side rendered markdown using a Go markdown library
// Note: this not even nearly supports all SilverBullet markdown features. It's best effort.
// The ONLY use case of this is search engine indexing
// It is only activated when the space is both read-only and has no authentication, so basically the silverbullet.md scenario.

var (
	// Compiled once at package init for performance
	wikiLinkRegex = regexp.MustCompile(`\[\[([^\]]+)\]\]`)
)

// Very crude markdown link replacement
func convertWikiLinksToMarkdown(input string) string {
	// Replace all matches with [text](text) format
	result := wikiLinkRegex.ReplaceAllStringFunc(input, func(match string) string {
		// Extract the text between [[ and ]]
		text := strings.TrimPrefix(match, "[[")
		text = strings.TrimSuffix(text, "]]")

		return fmt.Sprintf("[%s](%s)", text, text)
	})

	return result
}

// initSSRTemplate parses and caches the SSR template once at startup
func initSSRTemplate(config *ServerConfig) error {
	// Fetch the index.html template
	indexHtmlBuf, _, err := config.ClientBundle.ReadFile(indexHtmlPath)
	if err != nil {
		return fmt.Errorf("failed to read index.html: %w", err)
	}

	// Create template with markdown rendering function
	tpl := template.New("index_html")
	tpl.Funcs(template.FuncMap{
		"markdown": func(text string) template.HTML {
			if text == "" {
				return ""
			}

			// Setup markdown renderer (parser/renderer are cheap to create)
			markdownParser := parser.NewWithExtensions(parser.CommonExtensions)
			markdownRenderer := html.NewRenderer(html.RendererOptions{})
			text = convertWikiLinksToMarkdown(text)
			doc := markdownParser.Parse([]byte(text))
			return template.HTML(markdown.Render(doc, markdownRenderer))
		},
	})

	// Parse and cache the template
	config.ssrTemplate, err = tpl.Parse(string(indexHtmlBuf))
	if err != nil {
		return fmt.Errorf("failed to parse SSR template: %w", err)
	}

	return nil
}

func ServerSideRender(config *ServerConfig, spaceConfig *SpaceConfig, pageName string, w http.ResponseWriter, r *http.Request) {
	if pageName == "" {
		pageName = spaceConfig.IndexPage
	}

	templateData := struct {
		HostPrefix         string
		Title              string
		Description        string
		Content            string
		AdditionalHeadHTML template.HTML
	}{
		Title:              "SilverBullet",
		HostPrefix:         config.HostURLPrefix,
		AdditionalHeadHTML: spaceConfig.AdditionalHeadHTML,
	}

	if spaceConfig.ReadOnlyMode && spaceConfig.Auth == nil {
		// Read only and without out, let's do some server side rendering
		templateData.Title = pathLib.Base(pageName)

		// Read page content
		pageData, _, err := spaceConfig.SpacePrimitives.ReadFile(fmt.Sprintf("%s.md", pageName))
		if err != nil {
			log.Printf("Could not read content for page %s", pageName)
		} else {
			templateData.Content = string(pageData)
		}
	}

	w.Header().Set("Content-type", "text/html")
	w.WriteHeader(http.StatusOK)
	if err := config.ssrTemplate.Execute(w, templateData); err != nil {
		log.Printf("SSR error for %s: %v", pageName, err)
		w.Write([]byte("Server error"))
	}
}
