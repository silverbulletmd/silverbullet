import type { Context } from "hono";
import type { SpacePrimitives } from "../lib/spaces/space_primitives.ts";

export type McpServerOptions = {
  enabled: boolean;
  authMode: "inherit" | "separate" | "none";
  authToken?: string;
};

interface NoteInfo {
  name: string;
  perm: "rw" | "ro";
  lastModified: number;
  size: number;
}

interface Tool {
  name: string;
  description: string;
  inputSchema: {
    type: string;
    properties: Record<string, any>;
    required: string[];
  };
}

interface Resource {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
}

interface McpRequest {
  jsonrpc: string;
  id: number | string;
  method: string;
  params?: any;
}

interface McpResponse {
  jsonrpc: string;
  id: number | string;
  result?: any;
  error?: {
    code: number;
    message: string;
    data?: any;
  };
}

export class McpServerManager {
  private spacePrimitives: SpacePrimitives;
  private options: McpServerOptions;

  constructor(spacePrimitives: SpacePrimitives, options: McpServerOptions) {
    this.spacePrimitives = spacePrimitives;
    this.options = options;
  }

  async handleMcpRequest(c: Context): Promise<Response> {
    if (!this.options.enabled) {
      return c.text("MCP server is disabled", 404);
    }

    if (c.req.method !== "POST") {
      return c.text("Method not allowed", 405);
    }

    try {
      const request: McpRequest = await c.req.json();
      const response = await this.processRequest(request);
      
      return c.json(response, 200, {
        "Content-Type": "application/json",
      });
    } catch (error) {
      console.error(`[MCP] Error handling request:`, error);
      
      const errorResponse: McpResponse = {
        jsonrpc: "2.0",
        id: 0,
        error: {
          code: -32603,
          message: "Internal server error",
          data: error instanceof Error ? error.message : String(error),
        },
      };
      
      return c.json(errorResponse, 500);
    }
  }

  private async processRequest(request: McpRequest): Promise<McpResponse> {
    const { jsonrpc, id, method, params } = request;

    try {
      let result: any;

      switch (method) {
        case "initialize":
          result = await this.handleInitialize(params);
          break;
        case "initialized":
          result = {};
          break;
        case "tools/list":
          result = await this.handleToolsList();
          break;
        case "tools/call":
          result = await this.handleToolCall(params);
          break;
        case "resources/list":
          result = await this.handleResourcesList();
          break;
        case "resources/read":
          result = await this.handleResourceRead(params);
          break;
        default:
          throw new Error(`Unknown method: ${method}`);
      }

      return {
        jsonrpc,
        id,
        result,
      };
    } catch (error) {
      return {
        jsonrpc,
        id,
        error: {
          code: -32602,
          message: error instanceof Error ? error.message : "Unknown error",
        },
      };
    }
  }

  private handleInitialize(_params: any): Promise<any> {
    return Promise.resolve({
      protocolVersion: "2024-11-05",
      capabilities: {
        tools: {},
        resources: {},
      },
      serverInfo: {
        name: "SilverBullet MCP",
        version: "2.0.0",
      },
    });
  }

  private handleToolsList(): Promise<{ tools: Tool[] }> {
    const tools: Tool[] = [
      {
        name: "read-note",
        description: "Read a single note",
        inputSchema: {
          type: "object",
          properties: {
            filename: {
              type: "string",
              description: "The filename of the note to read",
            },
            suggestSimilar: {
              type: "boolean",
              description: "Whether to suggest similar note names if the note is not found",
              default: true,
            },
          },
          required: ["filename"],
        },
      },
      {
        name: "create-note",
        description: "Create a new note",
        inputSchema: {
          type: "object",
          properties: {
            filename: {
              type: "string",
              description: "The filename for the new note (should end with .md)",
            },
            content: {
              type: "string",
              description: "The content for the new note",
            },
            overwrite: {
              type: "boolean",
              description: "Whether to overwrite existing note if it exists",
              default: false,
            },
          },
          required: ["filename", "content"],
        },
      },
      {
        name: "delete-note",
        description: "Delete a note",
        inputSchema: {
          type: "object",
          properties: {
            filename: {
              type: "string",
              description: "The filename of the note to delete (should end with .md)",
            },
          },
          required: ["filename"],
        },
      },
      {
        name: "list-notes",
        description: "List all notes with optional filtering",
        inputSchema: {
          type: "object",
          properties: {
            namePattern: {
              type: "string",
              description: "Optional regex pattern to filter note names",
            },
            permission: {
              type: "string",
              enum: ["rw", "ro"],
              description: "Filter by permission: 'rw' for read-write, 'ro' for read-only",
            },
          },
          required: [],
        },
      },
      {
        name: "search-notes",
        description: "Full-text search across notes",
        inputSchema: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "Search query (supports regex patterns)",
            },
            searchType: {
              type: "string",
              enum: ["content", "title", "both"],
              description: "Where to search: content, title (filename), or both",
              default: "both",
            },
            caseSensitive: {
              type: "boolean",
              description: "Whether search should be case-sensitive",
              default: false,
            },
            maxResults: {
              type: "number",
              description: "Maximum number of results to return",
              default: 10,
            },
          },
          required: ["query"],
        },
      },
    ];

    return Promise.resolve({ tools });
  }

  private async handleToolCall(params: any): Promise<any> {
    const { name, arguments: args } = params;

    switch (name) {
      case "read-note":
        return await this.toolReadNote(args);
      case "create-note":
        return await this.toolCreateNote(args);
      case "delete-note":
        return await this.toolDeleteNote(args);
      case "list-notes":
        return await this.toolListNotes(args);
      case "search-notes":
        return await this.toolSearchNotes(args);
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  }

  private async handleResourcesList(): Promise<{ resources: Resource[] }> {
    const notes = await this.listNotes();
    const resources: Resource[] = notes.map((note) => ({
      uri: `sb-note://${encodeURIComponent(note.name)}`,
      name: note.name,
      description: `Note: ${note.name}`,
      mimeType: "text/markdown",
    }));

    return { resources };
  }

  private async handleResourceRead(params: any): Promise<any> {
    const { uri } = params;
    
    if (!uri.startsWith("sb-note://")) {
      throw new Error("Invalid resource URI");
    }

    const filename = decodeURIComponent(uri.slice("sb-note://".length));
    const content = await this.readNote(filename);

    return {
      contents: [
        {
          uri,
          mimeType: "text/markdown",
          text: content,
        },
      ],
    };
  }

  private async toolReadNote(args: any): Promise<any> {
    const { filename, suggestSimilar = true } = args;

    try {
      const content = await this.readNote(filename);
      return {
        content: [
          {
            type: "text",
            text: content,
          },
        ],
      };
    } catch (error) {
      if (suggestSimilar && this.isNotFoundError(error)) {
        try {
          const availableNotes = await this.listNotes();
          const suggestions = this.findSimilarNoteNames(filename, availableNotes);
          
          if (suggestions.length > 0) {
            const suggestionText = suggestions.map(note => `  • ${note}`).join('\n');
            return {
              content: [
                {
                  type: "text",
                  text: `Note "${filename}" not found. Did you mean one of these?\n\n${suggestionText}`,
                },
              ],
            };
          }
        } catch (searchError) {
          console.error(`[MCP Tool: read-note] Error during similarity search:`, searchError);
        }
      }
      
      throw error;
    }
  }

  private async toolCreateNote(args: any): Promise<any> {
    const { filename, content, overwrite = false } = args;

    if (!filename.endsWith('.md')) {
      throw new Error("Filename must end with .md extension");
    }

    if (!overwrite) {
      try {
        await this.readNote(filename);
        throw new Error(`Note ${filename} already exists. Use overwrite=true to replace it.`);
      } catch (error) {
        // Note doesn't exist, which is what we want for creating
        if (!this.isNotFoundError(error)) {
          throw error;
        }
      }
    }

    await this.writeNote(filename, content);
    
    const action = overwrite ? "created/updated" : "created";
    return {
      content: [
        {
          type: "text",
          text: `Successfully ${action} note: ${filename}`,
        },
      ],
    };
  }

  private async toolDeleteNote(args: any): Promise<any> {
    const { filename } = args;

    if (!filename.endsWith('.md')) {
      throw new Error("Filename must end with .md extension");
    }
    
    await this.deleteNote(filename);
    return {
      content: [
        {
          type: "text",
          text: `Successfully deleted note: ${filename}`,
        },
      ],
    };
  }

  private async toolListNotes(args: any): Promise<any> {
    const { namePattern, permission } = args;
    
    let notes = await this.listNotes();
    
    if (namePattern) {
      const regex = new RegExp(namePattern, 'i');
      notes = notes.filter((note) => regex.test(note.name));
    }

    if (permission) {
      notes = notes.filter((note) => note.perm === permission);
    }
    
    const notesList = notes
      .map((note) => `- ${note.name} (${note.perm === 'rw' ? 'read-write' : 'read-only'})`)
      .join('\n');

    const filterSummary: string[] = [];
    if (namePattern) filterSummary.push(`name pattern: "${namePattern}"`);
    if (permission) filterSummary.push(`permission: ${permission}`);
    
    const headerText = filterSummary.length > 0
      ? `Notes matching filters (${filterSummary.join(', ')}):`
      : 'Available notes:';

    return {
      content: [
        {
          type: "text",
          text: `${headerText}\n${notesList || 'No notes found matching the specified criteria.'}`,
        },
      ],
    };
  }

  private async toolSearchNotes(args: any): Promise<any> {
    const { query, searchType = "both", caseSensitive = false, maxResults = 10 } = args;
    
    const notes = await this.listNotes();
    const searchResults: Array<{
      filename: string;
      permission: "rw" | "ro";
      matches: Array<{
        type: "title" | "content";
        line: number;
        content: string;
        matchCount: number;
      }>;
      score: number;
    }> = [];
    
    const flags = caseSensitive ? 'g' : 'gi';
    let searchRegex: RegExp;

    try {
      searchRegex = new RegExp(query, flags);
    } catch (_error) {
      const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      searchRegex = new RegExp(escapedQuery, flags);
    }

    for (const note of notes) {
      const noteResult = {
        filename: note.name,
        permission: note.perm,
        matches: [] as Array<{
          type: "title" | "content";
          line: number;
          content: string;
          matchCount: number;
        }>,
        score: 0,
      };

      if (searchType === 'title' || searchType === 'both') {
        const titleMatches = Array.from(note.name.matchAll(searchRegex));
        if (titleMatches.length > 0) {
          noteResult.matches.push({
            type: 'title',
            line: 0,
            content: note.name,
            matchCount: titleMatches.length,
          });
        }
      }

      if (searchType === 'content' || searchType === 'both') {
        try {
          const content = await this.readNote(note.name);
          const lines = content.split('\n');

          lines.forEach((line, lineIndex) => {
            const lineMatches = Array.from(line.matchAll(searchRegex));
            if (lineMatches.length > 0) {
              noteResult.matches.push({
                type: 'content',
                line: lineIndex + 1,
                content: line.trim(),
                matchCount: lineMatches.length,
              });
            }
          });
        } catch (error) {
          console.error(`[MCP Tool: search-notes] Failed to read note ${note.name}:`, error);
        }
      }

      if (noteResult.matches.length > 0) {
        noteResult.score = noteResult.matches.reduce((sum, match) => sum + match.matchCount, 0);
        searchResults.push(noteResult);
      }
    }

    searchResults.sort((a, b) => b.score - a.score);
    const limitedResults = searchResults.slice(0, maxResults);

    if (searchResults.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: `No matches found for "${query}" in ${searchType === 'both' ? 'titles or content' : searchType}.`,
          },
        ],
      };
    }

    const totalMatches = searchResults.reduce((sum, result) => sum + result.score, 0);
    let output = `Found ${totalMatches} matches in ${searchResults.length} notes:\n\n`;

    limitedResults.forEach((result, index) => {
      const totalNoteMatches = result.matches.reduce((sum, match) => sum + match.matchCount, 0);
      output += `${index + 1}. ${result.filename} (${totalNoteMatches} matches)\n`;

      result.matches.slice(0, 3).forEach((match) => {
        if (match.type === 'title') {
          output += `  • Title match\n`;
        } else {
          const truncatedContent = match.content.length > 100
            ? match.content.substring(0, 97) + '...'
            : match.content;
          output += `  • L${match.line}: ${truncatedContent}\n`;
        }
      });

      if (result.matches.length > 3) {
        output += `  • ... ${result.matches.length - 3} more matches\n`;
      }
      output += '\n';
    });

    if (searchResults.length > maxResults) {
      output += `Showing first ${maxResults} of ${searchResults.length} matching notes.`;
    }

    return {
      content: [
        {
          type: "text",
          text: output,
        },
      ],
    };
  }

  async shutdown(): Promise<void> {
    // No cleanup needed for native implementation
  }

  private async listNotes(): Promise<NoteInfo[]> {
    const files = await this.spacePrimitives.fetchFileList();
    return files
      .filter(file => file.name.endsWith('.md'))
      .map(file => ({
        name: file.name,
        perm: file.perm,
        lastModified: file.lastModified,
        size: file.size,
      }));
  }

  private async readNote(filename: string): Promise<string> {
    const fileData = await this.spacePrimitives.readFile(filename);
    return new TextDecoder().decode(fileData.data);
  }

  private async writeNote(filename: string, content: string): Promise<void> {
    const data = new TextEncoder().encode(content);
    await this.spacePrimitives.writeFile(filename, data);
  }

  private async deleteNote(filename: string): Promise<void> {
    await this.spacePrimitives.deleteFile(filename);
  }

  private isNotFoundError(error: any): boolean {
    return error instanceof Error && error.message.includes("Not found");
  }

  private findSimilarNoteNames(targetName: string, availableNotes: NoteInfo[]): string[] {
    const target = targetName.toLowerCase();
    const suggestions: Array<{ name: string; score: number }> = [];

    for (const note of availableNotes) {
      const noteName = note.name.toLowerCase();
      let score = 0;

      if (noteName.includes(target)) {
        score += 10;
      }

      if (target.includes(noteName.replace('.md', ''))) {
        score += 8;
      }

      const targetParts = target.split(/[^a-z0-9]/);
      for (const part of targetParts) {
        if (part.length > 2 && noteName.includes(part)) {
          score += 3;
        }
      }

      if (score > 0) {
        suggestions.push({ name: note.name, score });
      }
    }

    return suggestions
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
      .map(s => s.name);
  }
}