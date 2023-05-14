// Imports
import {setEditorMode as setEditorMode} from "file:///Users/zhemel/git/silverbullet/plugs/core/editor.ts";
import {toggleDarkMode as toggleDarkMode} from "file:///Users/zhemel/git/silverbullet/plugs/core/editor.ts";
import {clearPageIndex as clearPageIndex} from "file:///Users/zhemel/git/silverbullet/plugs/core/page.ts";
import {pageQueryProvider as pageQueryProvider} from "file:///Users/zhemel/git/silverbullet/plugs/core/page.ts";
import {parseIndexTextRepublish as parseIndexTextRepublish} from "file:///Users/zhemel/git/silverbullet/plugs/core/page.ts";
import {reindexCommand as reindexSpaceCommand} from "file:///Users/zhemel/git/silverbullet/plugs/core/page.ts";
import {reindexSpace as reindexSpace} from "file:///Users/zhemel/git/silverbullet/plugs/core/page.ts";
import {deletePage as deletePage} from "file:///Users/zhemel/git/silverbullet/plugs/core/page.ts";
import {attachmentQueryProvider as attachmentQueryProvider} from "file:///Users/zhemel/git/silverbullet/plugs/core/attachment.ts";
import {indexLinks as indexLinks} from "file:///Users/zhemel/git/silverbullet/plugs/core/page.ts";
import {linkQueryProvider as linkQueryProvider} from "file:///Users/zhemel/git/silverbullet/plugs/core/page.ts";
import {renamePage as renamePage} from "file:///Users/zhemel/git/silverbullet/plugs/core/page.ts";
import {pageComplete as pageComplete} from "file:///Users/zhemel/git/silverbullet/plugs/core/page.ts";
import {commandComplete as commandComplete} from "file:///Users/zhemel/git/silverbullet/plugs/core/command.ts";
import {indexItems as indexItem} from "file:///Users/zhemel/git/silverbullet/plugs/core/item.ts";
import {queryProvider as itemQueryProvider} from "file:///Users/zhemel/git/silverbullet/plugs/core/item.ts";
import {linkNavigate as linkNavigate} from "file:///Users/zhemel/git/silverbullet/plugs/core/navigate.ts";
import {clickNavigate as clickNavigate} from "file:///Users/zhemel/git/silverbullet/plugs/core/navigate.ts";
import {navigateCommand as navigateHome} from "file:///Users/zhemel/git/silverbullet/plugs/core/navigate.ts";
import {indexTags as indexTags} from "file:///Users/zhemel/git/silverbullet/plugs/core/tags.ts";
import {tagComplete as tagComplete} from "file:///Users/zhemel/git/silverbullet/plugs/core/tags.ts";
import {tagProvider as tagProvider} from "file:///Users/zhemel/git/silverbullet/plugs/core/tags.ts";
import {indexAnchors as indexAnchors} from "file:///Users/zhemel/git/silverbullet/plugs/core/anchor.ts";
import {anchorComplete as anchorComplete} from "file:///Users/zhemel/git/silverbullet/plugs/core/anchor.ts";
import {insertTemplateText as insertTemplateText} from "file:///Users/zhemel/git/silverbullet/plugs/core/template.ts";
import {applyLineReplace as applyLineReplace} from "file:///Users/zhemel/git/silverbullet/plugs/core/template.ts";
import {newPageCommand as newPage} from "file:///Users/zhemel/git/silverbullet/plugs/core/page.ts";
import {quickNoteCommand as quickNoteCommand} from "file:///Users/zhemel/git/silverbullet/plugs/core/template.ts";
import {dailyNoteCommand as dailyNoteCommand} from "file:///Users/zhemel/git/silverbullet/plugs/core/template.ts";
import {weeklyNoteCommand as weeklyNoteCommand} from "file:///Users/zhemel/git/silverbullet/plugs/core/template.ts";
import {instantiateTemplateCommand as instantiateTemplateCommand} from "file:///Users/zhemel/git/silverbullet/plugs/core/template.ts";
import {insertSnippet as insertSnippet} from "file:///Users/zhemel/git/silverbullet/plugs/core/template.ts";
import {insertTemplateText as insertTodayCommand} from "file:///Users/zhemel/git/silverbullet/plugs/core/template.ts";
import {insertTemplateText as insertTomorrowCommand} from "file:///Users/zhemel/git/silverbullet/plugs/core/template.ts";
import {quoteSelection as quoteSelectionCommand} from "file:///Users/zhemel/git/silverbullet/plugs/core/text.ts";
import {listifySelection as listifySelection} from "file:///Users/zhemel/git/silverbullet/plugs/core/text.ts";
import {numberListifySelection as numberListifySelection} from "file:///Users/zhemel/git/silverbullet/plugs/core/text.ts";
import {linkSelection as linkSelection} from "file:///Users/zhemel/git/silverbullet/plugs/core/text.ts";
import {wrapSelection as bold} from "file:///Users/zhemel/git/silverbullet/plugs/core/text.ts";
import {wrapSelection as italic} from "file:///Users/zhemel/git/silverbullet/plugs/core/text.ts";
import {wrapSelection as strikethrough} from "file:///Users/zhemel/git/silverbullet/plugs/core/text.ts";
import {wrapSelection as marker} from "file:///Users/zhemel/git/silverbullet/plugs/core/text.ts";
import {extractToPage as extractToPageCommand} from "file:///Users/zhemel/git/silverbullet/plugs/core/refactor.ts";
import {updatePlugsCommand as updatePlugsCommand} from "file:///Users/zhemel/git/silverbullet/plugs/core/plugmanager.ts";
import {getPlugHTTPS as getPlugHTTPS} from "file:///Users/zhemel/git/silverbullet/plugs/core/plugmanager.ts";
import {getPlugGithub as getPlugGithub} from "file:///Users/zhemel/git/silverbullet/plugs/core/plugmanager.ts";
import {getPlugGithubRelease as getPlugGithubRelease} from "file:///Users/zhemel/git/silverbullet/plugs/core/plugmanager.ts";
import {addPlugCommand as addPlugCommand} from "file:///Users/zhemel/git/silverbullet/plugs/core/plugmanager.ts";
import {parsePageCommand as parseCommand} from "file:///Users/zhemel/git/silverbullet/plugs/core/debug.ts";
import {showLogsCommand as showLogsCommand} from "file:///Users/zhemel/git/silverbullet/plugs/core/debug.ts";
import {hideBhsCommand as hideBhsCommand} from "file:///Users/zhemel/git/silverbullet/plugs/core/debug.ts";
import {unfurlCommand as unfurlLink} from "file:///Users/zhemel/git/silverbullet/plugs/core/link.ts";
import {unfurlExec as unfurlExec} from "file:///Users/zhemel/git/silverbullet/plugs/core/link.ts";
import {titleUnfurlOptions as titleUnfurlOptions} from "file:///Users/zhemel/git/silverbullet/plugs/core/link.ts";
import {titleUnfurl as titleUnfurl} from "file:///Users/zhemel/git/silverbullet/plugs/core/link.ts";
import {embedWidget as embedWidget} from "file:///Users/zhemel/git/silverbullet/plugs/core/embed.ts";
import {statsCommand as statsCommand} from "file:///Users/zhemel/git/silverbullet/plugs/core/stats.ts";
import {readFileCloud as readPageCloud} from "file:///Users/zhemel/git/silverbullet/plugs/core/cloud.ts";
import {writeFileCloud as writePageCloud} from "file:///Users/zhemel/git/silverbullet/plugs/core/cloud.ts";
import {getFileMetaCloud as getPageMetaCloud} from "file:///Users/zhemel/git/silverbullet/plugs/core/cloud.ts";
import {toggleVimMode as toggleVimMode} from "file:///Users/zhemel/git/silverbullet/plugs/core/vim.ts";
import {loadVimRc as loadVimRc} from "file:///Users/zhemel/git/silverbullet/plugs/core/vim.ts";


// Function mapping
export const functionMapping = {
  setEditorMode: setEditorMode,
  toggleDarkMode: toggleDarkMode,
  clearPageIndex: clearPageIndex,
  pageQueryProvider: pageQueryProvider,
  parseIndexTextRepublish: parseIndexTextRepublish,
  reindexSpaceCommand: reindexSpaceCommand,
  reindexSpace: reindexSpace,
  deletePage: deletePage,
  attachmentQueryProvider: attachmentQueryProvider,
  indexLinks: indexLinks,
  linkQueryProvider: linkQueryProvider,
  renamePage: renamePage,
  pageComplete: pageComplete,
  commandComplete: commandComplete,
  indexItem: indexItem,
  itemQueryProvider: itemQueryProvider,
  linkNavigate: linkNavigate,
  clickNavigate: clickNavigate,
  navigateHome: navigateHome,
  indexTags: indexTags,
  tagComplete: tagComplete,
  tagProvider: tagProvider,
  indexAnchors: indexAnchors,
  anchorComplete: anchorComplete,
  insertTemplateText: insertTemplateText,
  applyLineReplace: applyLineReplace,
  newPage: newPage,
  quickNoteCommand: quickNoteCommand,
  dailyNoteCommand: dailyNoteCommand,
  weeklyNoteCommand: weeklyNoteCommand,
  instantiateTemplateCommand: instantiateTemplateCommand,
  insertSnippet: insertSnippet,
  insertTodayCommand: insertTodayCommand,
  insertTomorrowCommand: insertTomorrowCommand,
  quoteSelectionCommand: quoteSelectionCommand,
  listifySelection: listifySelection,
  numberListifySelection: numberListifySelection,
  linkSelection: linkSelection,
  bold: bold,
  italic: italic,
  strikethrough: strikethrough,
  marker: marker,
  extractToPageCommand: extractToPageCommand,
  updatePlugsCommand: updatePlugsCommand,
  getPlugHTTPS: getPlugHTTPS,
  getPlugGithub: getPlugGithub,
  getPlugGithubRelease: getPlugGithubRelease,
  addPlugCommand: addPlugCommand,
  parseCommand: parseCommand,
  showLogsCommand: showLogsCommand,
  hideBhsCommand: hideBhsCommand,
  unfurlLink: unfurlLink,
  unfurlExec: unfurlExec,
  titleUnfurlOptions: titleUnfurlOptions,
  titleUnfurl: titleUnfurl,
  embedWidget: embedWidget,
  statsCommand: statsCommand,
  readPageCloud: readPageCloud,
  writePageCloud: writePageCloud,
  getPageMetaCloud: getPageMetaCloud,
  toggleVimMode: toggleVimMode,
  loadVimRc: loadVimRc,

};

const manifest = {
  "name": "core",
  "imports": [
    "https://get.silverbullet.md/global.plug.json"
  ],
  "syntax": {
    "Hashtag": {
      "firstCharacters": [
        "#"
      ],
      "regex": "#[^#\\d\\s\\[\\]]+\\w+",
      "className": "sb-hashtag"
    },
    "NakedURL": {
      "firstCharacters": [
        "h"
      ],
      "regex": "https?:\\/\\/[-a-zA-Z0-9@:%._\\+~#=]{1,256}([-a-zA-Z0-9()@:%_\\+.~#?&=\\/]*)",
      "className": "sb-naked-url"
    },
    "NamedAnchor": {
      "firstCharacters": [
        "$"
      ],
      "regex": "\\$[a-zA-Z\\.\\-\\/]+[\\w\\.\\-\\/]*",
      "className": "sb-named-anchor"
    }
  },
  "functions": {
    "setEditorMode": {
      "path": "./editor.ts:setEditorMode",
      "events": [
        "editor:init"
      ]
    },
    "toggleDarkMode": {
      "path": "./editor.ts:toggleDarkMode",
      "command": {
        "name": "Editor: Toggle Dark Mode"
      }
    },
    "clearPageIndex": {
      "path": "./page.ts:clearPageIndex",
      "env": "server",
      "events": [
        "page:saved",
        "page:deleted"
      ]
    },
    "pageQueryProvider": {
      "path": "./page.ts:pageQueryProvider",
      "events": [
        "query:page"
      ]
    },
    "parseIndexTextRepublish": {
      "path": "./page.ts:parseIndexTextRepublish",
      "events": [
        "page:index_text"
      ]
    },
    "reindexSpaceCommand": {
      "path": "./page.ts:reindexCommand",
      "command": {
        "name": "Space: Reindex"
      }
    },
    "reindexSpace": {
      "path": "./page.ts:reindexSpace",
      "env": "server"
    },
    "deletePage": {
      "path": "./page.ts:deletePage",
      "command": {
        "name": "Page: Delete"
      }
    },
    "attachmentQueryProvider": {
      "path": "./attachment.ts:attachmentQueryProvider",
      "events": [
        "query:attachment"
      ]
    },
    "indexLinks": {
      "path": "./page.ts:indexLinks",
      "events": [
        "page:index"
      ]
    },
    "linkQueryProvider": {
      "path": "./page.ts:linkQueryProvider",
      "events": [
        "query:link"
      ]
    },
    "renamePage": {
      "path": "./page.ts:renamePage",
      "command": {
        "name": "Page: Rename",
        "mac": "Cmd-Alt-r",
        "key": "Ctrl-Alt-r",
        "page": ""
      }
    },
    "pageComplete": {
      "path": "./page.ts:pageComplete",
      "events": [
        "editor:complete"
      ]
    },
    "commandComplete": {
      "path": "./command.ts:commandComplete",
      "events": [
        "editor:complete"
      ]
    },
    "indexItem": {
      "path": "./item.ts:indexItems",
      "events": [
        "page:index"
      ]
    },
    "itemQueryProvider": {
      "path": "./item.ts:queryProvider",
      "events": [
        "query:item"
      ]
    },
    "linkNavigate": {
      "path": "./navigate.ts:linkNavigate",
      "command": {
        "name": "Navigate To page",
        "key": "Ctrl-Enter",
        "mac": "Cmd-Enter"
      }
    },
    "clickNavigate": {
      "path": "./navigate.ts:clickNavigate",
      "events": [
        "page:click"
      ]
    },
    "navigateHome": {
      "path": "./navigate.ts:navigateCommand",
      "command": {
        "name": "Navigate: Home",
        "key": "Alt-h",
        "page": ""
      }
    },
    "indexTags": {
      "path": "./tags.ts:indexTags",
      "events": [
        "page:index"
      ]
    },
    "tagComplete": {
      "path": "./tags.ts:tagComplete",
      "events": [
        "editor:complete"
      ]
    },
    "tagProvider": {
      "path": "./tags.ts:tagProvider",
      "events": [
        "query:tag"
      ]
    },
    "indexAnchors": {
      "path": "./anchor.ts:indexAnchors",
      "events": [
        "page:index"
      ]
    },
    "anchorComplete": {
      "path": "./anchor.ts:anchorComplete",
      "events": [
        "editor:complete"
      ]
    },
    "insertTemplateText": {
      "path": "./template.ts:insertTemplateText"
    },
    "applyLineReplace": {
      "path": "./template.ts:applyLineReplace"
    },
    "insertFrontMatter": {
      "redirect": "insertTemplateText",
      "slashCommand": {
        "name": "front-matter",
        "description": "Insert page front matter",
        "value": "---\n|^|\n---\n"
      }
    },
    "makeH1": {
      "redirect": "applyLineReplace",
      "slashCommand": {
        "name": "h1",
        "description": "Turn line into h1 header",
        "match": "^#*\\s*",
        "replace": "# "
      }
    },
    "makeH2": {
      "redirect": "applyLineReplace",
      "slashCommand": {
        "name": "h2",
        "description": "Turn line into h2 header",
        "match": "^#*\\s*",
        "replace": "## "
      }
    },
    "makeH3": {
      "redirect": "applyLineReplace",
      "slashCommand": {
        "name": "h3",
        "description": "Turn line into h3 header",
        "match": "^#*\\s*",
        "replace": "### "
      }
    },
    "makeH4": {
      "redirect": "applyLineReplace",
      "slashCommand": {
        "name": "h4",
        "description": "Turn line into h4 header",
        "match": "^#*\\s*",
        "replace": "#### "
      }
    },
    "newPage": {
      "path": "./page.ts:newPageCommand",
      "command": {
        "name": "Page: New",
        "key": "Alt-Shift-n"
      }
    },
    "insertHRTemplate": {
      "redirect": "insertTemplateText",
      "slashCommand": {
        "name": "hr",
        "description": "Insert a horizontal rule",
        "value": "---"
      }
    },
    "insertTable": {
      "redirect": "insertTemplateText",
      "slashCommand": {
        "name": "table",
        "description": "Insert a table",
        "boost": -1,
        "value": "| Header A | Header B |\n|----------|----------|\n| Cell A|^| | Cell B |\n"
      }
    },
    "quickNoteCommand": {
      "path": "./template.ts:quickNoteCommand",
      "command": {
        "name": "Quick Note",
        "key": "Alt-Shift-n",
        "priority": 1
      }
    },
    "dailyNoteCommand": {
      "path": "./template.ts:dailyNoteCommand",
      "command": {
        "name": "Open Daily Note",
        "key": "Alt-Shift-d"
      }
    },
    "weeklyNoteCommand": {
      "path": "./template.ts:weeklyNoteCommand",
      "command": {
        "name": "Open Weekly Note",
        "key": "Alt-Shift-w"
      }
    },
    "instantiateTemplateCommand": {
      "path": "./template.ts:instantiateTemplateCommand",
      "command": {
        "name": "Template: Instantiate Page"
      }
    },
    "insertSnippet": {
      "path": "./template.ts:insertSnippet",
      "command": {
        "name": "Template: Insert Snippet"
      },
      "slashCommand": {
        "name": "snippet",
        "description": "Insert a snippet"
      }
    },
    "insertTodayCommand": {
      "path": "./template.ts:insertTemplateText",
      "slashCommand": {
        "name": "today",
        "description": "Insert today's date",
        "value": "{{today}}"
      }
    },
    "insertTomorrowCommand": {
      "path": "./template.ts:insertTemplateText",
      "slashCommand": {
        "name": "tomorrow",
        "description": "Insert tomorrow's date",
        "value": "{{tomorrow}}"
      }
    },
    "quoteSelectionCommand": {
      "path": "./text.ts:quoteSelection",
      "command": {
        "name": "Text: Quote Selection",
        "key": "Ctrl-Shift-.",
        "mac": "Cmd-Shift-."
      }
    },
    "listifySelection": {
      "path": "./text.ts:listifySelection",
      "command": {
        "name": "Text: Listify Selection",
        "key": "Ctrl-Shift-8",
        "mac": "Cmd-Shift-8"
      }
    },
    "numberListifySelection": {
      "path": "./text.ts:numberListifySelection",
      "command": {
        "name": "Text: Number Listify Selection"
      }
    },
    "linkSelection": {
      "path": "./text.ts:linkSelection",
      "command": {
        "name": "Text: Link Selection",
        "key": "Ctrl-Shift-k",
        "mac": "Cmd-Shift-k"
      }
    },
    "bold": {
      "path": "./text.ts:wrapSelection",
      "command": {
        "name": "Text: Bold",
        "key": "Ctrl-b",
        "mac": "Cmd-b",
        "wrapper": "**"
      }
    },
    "italic": {
      "path": "./text.ts:wrapSelection",
      "command": {
        "name": "Text: Italic",
        "key": "Ctrl-i",
        "mac": "Cmd-i",
        "wrapper": "_"
      }
    },
    "strikethrough": {
      "path": "./text.ts:wrapSelection",
      "command": {
        "name": "Text: Strikethrough",
        "key": "Ctrl-Shift-s",
        "mac": "Cmd-Shift-s",
        "wrapper": "~~"
      }
    },
    "marker": {
      "path": "./text.ts:wrapSelection",
      "command": {
        "name": "Text: Marker",
        "key": "Alt-m",
        "wrapper": "=="
      }
    },
    "extractToPageCommand": {
      "path": "./refactor.ts:extractToPage",
      "command": {
        "name": "Extract text to new page"
      }
    },
    "updatePlugsCommand": {
      "path": "./plugmanager.ts:updatePlugsCommand",
      "command": {
        "name": "Plugs: Update",
        "key": "Ctrl-Shift-p",
        "mac": "Cmd-Shift-p"
      }
    },
    "getPlugHTTPS": {
      "path": "./plugmanager.ts:getPlugHTTPS",
      "events": [
        "get-plug:https"
      ]
    },
    "getPlugGithub": {
      "path": "./plugmanager.ts:getPlugGithub",
      "events": [
        "get-plug:github"
      ]
    },
    "getPlugGithubRelease": {
      "path": "./plugmanager.ts:getPlugGithubRelease",
      "events": [
        "get-plug:ghr"
      ]
    },
    "addPlugCommand": {
      "path": "./plugmanager.ts:addPlugCommand",
      "command": {
        "name": "Plugs: Add"
      }
    },
    "parseCommand": {
      "path": "./debug.ts:parsePageCommand",
      "command": {
        "name": "Debug: Parse Document"
      }
    },
    "showLogsCommand": {
      "path": "./debug.ts:showLogsCommand",
      "command": {
        "name": "Show Logs",
        "key": "Ctrl-Alt-l",
        "mac": "Cmd-Alt-l"
      }
    },
    "hideBhsCommand": {
      "path": "./debug.ts:hideBhsCommand",
      "command": {
        "name": "UI: Hide BHS",
        "key": "Ctrl-Alt-b",
        "mac": "Cmd-Alt-b"
      },
      "events": [
        "log:hide"
      ]
    },
    "unfurlLink": {
      "path": "./link.ts:unfurlCommand",
      "command": {
        "name": "Link: Unfurl",
        "key": "Ctrl-Shift-u",
        "mac": "Cmd-Shift-u",
        "contexts": [
          "NakedURL"
        ]
      }
    },
    "unfurlExec": {
      "env": "server",
      "path": "./link.ts:unfurlExec"
    },
    "titleUnfurlOptions": {
      "path": "./link.ts:titleUnfurlOptions",
      "events": [
        "unfurl:options"
      ]
    },
    "titleUnfurl": {
      "path": "./link.ts:titleUnfurl",
      "events": [
        "unfurl:title-unfurl"
      ]
    },
    "embedWidget": {
      "path": "./embed.ts:embedWidget",
      "codeWidget": "embed"
    },
    "statsCommand": {
      "path": "./stats.ts:statsCommand",
      "command": {
        "name": "Stats: Show"
      }
    },
    "readPageCloud": {
      "path": "./cloud.ts:readFileCloud",
      "env": "server",
      "pageNamespace": {
        "pattern": "💭 .+",
        "operation": "readFile"
      }
    },
    "writePageCloud": {
      "path": "./cloud.ts:writeFileCloud",
      "env": "server",
      "pageNamespace": {
        "pattern": "💭 .+",
        "operation": "writeFile"
      }
    },
    "getPageMetaCloud": {
      "path": "./cloud.ts:getFileMetaCloud",
      "env": "server",
      "pageNamespace": {
        "pattern": "💭 .+",
        "operation": "getFileMeta"
      }
    },
    "toggleVimMode": {
      "path": "./vim.ts:toggleVimMode",
      "command": {
        "name": "Editor: Toggle Vim Mode"
      }
    },
    "loadVimRc": {
      "path": "./vim.ts:loadVimRc",
      "command": {
        "name": "Editor: Vim: Load VIMRC"
      },
      "events": [
        "editor:modeswitch"
      ]
    }
  },
  "assets": {}
};
