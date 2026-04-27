package cli

import (
	"encoding/json"
	"fmt"
	"os"
	"regexp"
	"strings"

	"github.com/spf13/cobra"
)

// Types for describe output, matching the Lua script return shapes.

type TagProperty struct {
	Name     string   `json:"name"`
	Type     string   `json:"type"`
	ReadOnly bool     `json:"readOnly"`
	Nullable bool     `json:"nullable,omitempty"`
	Enum     []string `json:"enum,omitempty"`
}

type TagInfo struct {
	Name                 string        `json:"name"`
	Properties           []TagProperty `json:"properties"`
	HasSchema            bool          `json:"hasSchema"`
	AdditionalProperties bool          `json:"additionalProperties,omitempty"`
}

type DescribeAllResult struct {
	Tags   []TagInfo `json:"tags"`
	Syntax string    `json:"syntax"`
}

// Shared Lua helper for extracting schema properties from a tag definition.
// Used by both describeAllScript and describeTagScript to keep extraction consistent.
const luaExtractProps = `
function extractProps(def)
  local props = {}
  if def.schema and def.schema.properties then
    for pname, pdef in pairs(def.schema.properties) do
      local typ = pdef.type or "any"
      if type(typ) == "table" then typ = "mixed" end
      local info = {
        name = pname,
        type = typ,
        readOnly = pdef.readOnly or false,
        nullable = pdef.nullable or false,
      }
      if pdef.enum then info.enum = pdef.enum end
      table.insert(props, info)
    end
    table.sort(props, function(a, b) return a.name < b.name end)
  end
  return props
end
`

const describeAllScript = luaExtractProps + `
local tags = config.get("tags", {})
local result = {}
for name, def in pairs(tags) do
  table.insert(result, {
    name = name,
    properties = extractProps(def),
    hasSchema = def.schema ~= nil,
  })
end
table.sort(result, function(a, b) return a.name < b.name end)

local page = space.readPage("Library/Std/Docs/SLIQ Reference")
local parsed = index.extractFrontmatter(page, {removeFrontMatterSection = true})

return { tags = result, syntax = parsed.text }
`

const describeTagScript = luaExtractProps + `
local tagName = "%s"
local tags = config.get("tags", {})
local def = tags[tagName]
if not def then
  error("Unknown tag: " .. tagName)
end
return {
  name = tagName,
  properties = extractProps(def),
  hasSchema = def.schema ~= nil,
  additionalProperties = def.schema and def.schema.additionalProperties or false,
}
`

var validTagName = regexp.MustCompile(`^[a-zA-Z_][a-zA-Z0-9_-]*$`)

// parseResult round-trips an any value through JSON into a typed struct.
// Needed because the runtime API returns untyped any from Lua evaluation.
func parseResult[T any](result any) (*T, error) {
	b, err := json.Marshal(result)
	if err != nil {
		return nil, err
	}
	var v T
	if err := json.Unmarshal(b, &v); err != nil {
		return nil, err
	}
	return &v, nil
}

func DescribeCommand() *cobra.Command {
	return &cobra.Command{
		Use:   "describe [type]",
		Short: "Show available object types and query syntax",
		Long:  "With no arguments, lists all queryable types and query syntax.\nWith a type name, shows its full schema.",
		Args:  cobra.MaximumNArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			conn, err := connFromFlags(cmd)
			if err != nil {
				return err
			}
			mode := OutputModeFromCmd(cmd)

			if len(args) == 1 {
				return describeTag(conn, args[0], mode)
			}
			return describeAll(conn, mode)
		},
	}
}

func describeAll(conn *SpaceConnection, mode OutputMode) error {
	raw, err := conn.EvalLuaScript(describeAllScript)
	if err != nil {
		return fmt.Errorf("fetching tag definitions: %w", err)
	}

	if mode == OutputJSON {
		return FormatOutput(os.Stdout, raw, OutputJSON)
	}

	result, err := parseResult[DescribeAllResult](raw)
	if err != nil {
		return fmt.Errorf("parsing describe result: %w", err)
	}

	fmt.Println("SilverBullet Query Reference")
	fmt.Println()
	fmt.Println("Available object types:")

	for _, tag := range result.Tags {
		props := summarizeProps(tag)
		fmt.Printf("  %-18s %s\n", tag.Name, props)
	}

	fmt.Println()
	fmt.Printf("Run 'sb describe <type>' for full schema.\n")

	if result.Syntax != "" {
		fmt.Println()
		fmt.Print(strings.TrimSpace(result.Syntax))
		fmt.Println()
	}

	return nil
}

func describeTag(conn *SpaceConnection, tagName string, mode OutputMode) error {
	if !validTagName.MatchString(tagName) {
		return fmt.Errorf("invalid tag name: %q", tagName)
	}
	script := fmt.Sprintf(describeTagScript, tagName)

	raw, err := conn.EvalLuaScript(script)
	if err != nil {
		return err
	}

	if mode == OutputJSON {
		return FormatOutput(os.Stdout, raw, OutputJSON)
	}

	tag, err := parseResult[TagInfo](raw)
	if err != nil {
		return fmt.Errorf("parsing tag info: %w", err)
	}

	fmt.Printf("Type: %s\n", tag.Name)
	if tag.AdditionalProperties {
		fmt.Println("Accepts additional properties (e.g. frontmatter fields)")
	}
	fmt.Println()

	if len(tag.Properties) == 0 {
		fmt.Println("No schema defined.")
		return nil
	}

	fmt.Println("Properties:")
	for _, prop := range tag.Properties {
		var flags []string
		if prop.ReadOnly {
			flags = append(flags, "read-only")
		}
		if prop.Nullable {
			flags = append(flags, "nullable")
		}
		if len(prop.Enum) > 0 {
			flags = append(flags, "enum: "+strings.Join(prop.Enum, "|"))
		}
		flagStr := ""
		if len(flags) > 0 {
			flagStr = "  (" + strings.Join(flags, ", ") + ")"
		}
		fmt.Printf("  %-20s %-10s%s\n", prop.Name, prop.Type, flagStr)
	}
	return nil
}

// summarizeProps returns a short description of a tag's key properties.
func summarizeProps(tag TagInfo) string {
	if len(tag.Properties) == 0 {
		if !tag.HasSchema {
			return "(no schema)"
		}
		return ""
	}
	names := make([]string, len(tag.Properties))
	for i, p := range tag.Properties {
		names[i] = p.Name
	}
	if len(names) > 5 {
		return strings.Join(names[:5], ", ") + ", ..."
	}
	return strings.Join(names, ", ")
}
