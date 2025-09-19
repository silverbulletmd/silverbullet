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

// Very crude markdown link replacement
func convertWikiLinksToMarkdown(input string) string {
	// Regular expression to match [[text]] patterns
	re := regexp.MustCompile(`\[\[([^\]]+)\]\]`)

	// Replace all matches with [text](text) format
	result := re.ReplaceAllStringFunc(input, func(match string) string {
		// Extract the text between [[ and ]]
		text := strings.TrimPrefix(match, "[[")
		text = strings.TrimSuffix(text, "]]")

		return fmt.Sprintf("[%s](%s)", text, text)
	})

	return result
}

func ServerSideRender(config *ServerConfig, spaceConfig *SpaceConfig, pageName string, w http.ResponseWriter, r *http.Request) {
	// Let's fetch the index.html text
	indexHtmlBuf, _, _ := config.ClientBundle.ReadFile(indexHtmlPath)

	if pageName == "" {
		pageName = spaceConfig.IndexPage
	}

	tpl := template.New("index_html")
	tpl.Funcs(template.FuncMap{
		"markdown": func(text string) template.HTML {
			if text == "" {
				// Let's not even bother doing anything
				return ""
			}

			// Setup markdown renderer
			var markdownParser = parser.NewWithExtensions(parser.CommonExtensions)
			var markdownRenderer = html.NewRenderer(html.RendererOptions{})
			text = convertWikiLinksToMarkdown(text)
			doc := markdownParser.Parse([]byte(text))
			return template.HTML(markdown.Render(doc, markdownRenderer))
		},
	})
	tpl = template.Must(tpl.Parse(string(indexHtmlBuf)))

	templateData := struct {
		HostPrefix  string
		Title       string
		Description string
		Content     string
	}{
		Title:      "SilverBullet",
		HostPrefix: config.HostURLPrefix,
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
	if err := tpl.Execute(w, templateData); err != nil {
		log.Printf("SSR error for %s: %v", pageName, err)
		w.Write([]byte("Server error"))
	}
}
