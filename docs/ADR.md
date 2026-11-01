Important [[Architecture]] decisions for SilverBullet are captured as [Architecture Decision Records](https://adr.github.io/) (template: [[^Library/Page Templates/ADR]]).

# Stats
* accepted: 9
* deprecated: 1
* superseded: 1

# Active decisions
* [[ADR/011 Link Resolution by Name|011 Link Resolution by Name]] — accepted; 2026-08-24; Owner: [[Zef Hemel]]
* [[ADR/010 Rust Backend|010 Rust Backend]] — accepted; 2026-06-16; Owner: [[Zef Hemel]]
* [[ADR/009 Client Build Toolchain|009 Client Build Toolchain]] — accepted; 2026-03-10; Owner: [[Zef Hemel]]
* [[ADR/007 Core Application Logic on the Client|007 Core Application Logic on the Client]] — accepted; 2025-08-29; Owner: [[Zef Hemel]]
* [[ADR/006 Space Lua Integrated Query|006 Space Lua Integrated Query]] — accepted; 2025-01-13; Owner: [[Zef Hemel]]
* [[ADR/005 Space Lua|005 Space Lua]] — accepted; 2024-10-03; Owner: [[Zef Hemel]]
* [[ADR/001 Offline-First PWA|001 Offline-First PWA]] — accepted; 2022-04-06; Owner: [[Zef Hemel]]
* [[ADR/002 Sync Engine|002 Sync Engine]] — accepted; 2022-04-06; Owner: [[Zef Hemel]]
* [[ADR/003 Indexed Object Graph|003 Indexed Object Graph]] — accepted; 2022-04-06; Owner: [[Zef Hemel]]

# Superseded & deprecated
* [[ADR/004 Federation|004 Federation]] — deprecated; 2023-07-04; Owner: [[Zef Hemel]]
* [[ADR/008 Go Backend|008 Go Backend]] — superseded; 2025-09-19; Owner: [[Zef Hemel]]; Superseded by: [[ADR/010 Rust Backend]]

# Connections
Dynamically generated from ADR defined relationships. Dotted edges mark supersession. Click a node to open the ADR.

${mermaid.diagram(mermaid.relationGraph {
  pages = query[[from index.pages("adr")]],
  direction = "TD",
})}

# Decision history
${mermaid.diagram(mermaid.timeline{
  pages = query[[from index.pages("adr")]],
  title = "ADR decision history"
})}

# By status
${mermaid.diagram(mermaid.distribution{
  pages = query[[from index.pages("adr")]],
  by = "status",
  title = "ADRs by status"
})}
