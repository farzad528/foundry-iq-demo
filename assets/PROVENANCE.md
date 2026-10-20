# Source icon provenance

## User-supplied product artwork

On 2026-10-19, the user supplied `knowledge-source-icons.zip` and explicitly
requested these icons in the demo and its existing pull request. The following
SVGs are imported unchanged apart from their local filenames:

| Local asset | Entry under `knowledge-source-icons/svg/` | Source kind |
| --- | --- | --- |
| `blob.svg` | `azure-blob-storage.svg` | `azureBlob` |
| `search.svg` | `azure-ai-search-index.svg` | `searchIndex` |
| `web.svg` | `web.svg` | `web` |
| `fabric.svg` | `fabric-iq-onelake-catalog.svg` | Fabric / OneLake source-family gallery |
| `sharepoint.svg` | `sharepoint-remote.svg` | Indexed / remote SharePoint source-family gallery |
| `sql.svg` | `azure-sql.svg` | Azure SQL source-family gallery |
| `file.svg` | `file.svg` | File source-family gallery |
| `mcp.svg` | `mcp-server.svg` | MCP server source-family gallery |
| `workiq.svg` | `work-iq.svg` | Work IQ source-family gallery |

Supplied ZIP SHA-256:
`da1dd5f28ddf0ce5ec881aa0ff0421bd6f97a556a4da5f723878c787440e402f`.
Unused icons, PNG copies and dark variants are not redistributed.
The archive did not include a license or upstream provenance manifest; this
records the supplied input and requested use, not independent verification that
every SVG came from an official Microsoft distribution.

Product artwork and trademarks are **not relicensed under this repository's
MIT license**. They identify knowledge-source products in this educational
integration demo, not the Explorer's own brand or an endorsement. Preserve
their shapes, aspect ratios and colors. Microsoft reserves rights in its
product icons; its published terms permit use in architecture diagrams,
training materials and documentation:

- [Azure icon guidelines and terms](https://learn.microsoft.com/azure/architecture/icons/)
- [Microsoft Fabric icon guidelines and terms](https://learn.microsoft.com/fabric/fundamentals/icons)
- [Microsoft 365 icon terms](https://learn.microsoft.com/previous-versions/microsoft-365/solutions/architecture-icons-templates)

Review the applicable rights and permitted use before reusing product artwork
outside this descriptive demo. No broader license grant is asserted here.

## Original fallback and presentation

`source.svg` remains the original neutral document drawing authored for this
Explorer application under its MIT license. Unknown source kinds use this
fallback, not a product logo.

The local registry supplies source-name and Indexed/Remote text labels. Images
are decorative (`alt=""`); labels remain available to assistive technology.
No font, CDN or remote image is loaded. All bundled SVGs are self-contained,
with no scripts, external resources or embedded HTML. Product-icon mappings do
not enable new live connectors. All four Zava KBs use real Blob-backed sources;
the on-demand gallery describes twelve supported source families, not twelve
provisioned integrations or fabricated query activities. Related Fabric and
SharePoint families reuse their supplied family artwork without alteration.
