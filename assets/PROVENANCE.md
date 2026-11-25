# Artwork and asset provenance

## Microsoft Foundry selector icon

`foundry.svg` is the unchanged Microsoft Foundry product icon from Microsoft's
[Azure architecture icon collection](https://learn.microsoft.com/azure/architecture/icons/),
downloaded on 2026-11-23 from `Azure_Public_Service_Icons_V25.zip`, entry
`Azure_Public_Service_Icons/Icons/ai + machine learning/035746832-icon-service-AI-Foundry.svg`.
SHA-256: `fab039a771f72780ae34e59065d61c66a02d3c347d50923ef2956f34912ea02c`.
It identifies the product being demonstrated beside the Foundry IQ Demos selector,
not an original application trademark. The product icon is subject to Microsoft's
artwork terms, not the application's MIT license; shapes and colors are unchanged.

## Original synthetic image corpus

The three `zava-*.png` sample images are deterministically generated at build
time by `illustrationPng()` in `scripts/generate-studio.mjs`: blue/red geometric
hats and a blue geometric bowl. They are original MIT-licensed illustrations,
not photographs or product artwork. The live Vision corpus encodes these exact
PNG bytes; the served originals and encoder manifest hashes therefore agree.
No paid image generation or external image download is used.

## Localized original synthetic PDFs

`samples/zava-manual-{fr,es,ja,de}.pdf` contain original fictional Zava text,
tables and vector rules, generated with ReportLab. French, Spanish and German
use locally installed Arial; Japanese uses MS Gothic. The PDFs embed TrueType
font subsets, not rasterized pages or standalone font files. Both source fonts
declare editable embedding permitted (`OS/2.fsType=8`). Microsoft font rights
remain separate from the application's MIT license; no font relicensing is
asserted. Regeneration requires those locally installed fonts. Actual native
Content Understanding Read/Layout outputs were ingested separately; no provider
captures or operational evidence are distributed in this repository.

## Derived favicons

`favicon.ico` (16/32/48 px), `favicon-32.png` and `apple-touch-icon.png` (180 px, white padding) were rendered on 2026-11-24 from the unchanged `foundry.svg` above, without editing its shapes, colors or aspect ratio. The deployed `/favicon.svg` is a byte-identical copy of `foundry.svg`. They remain subject to the same Microsoft artwork terms, not the MIT license.

Microsoft reserves rights in its product icons: [Azure icon guidelines and terms](https://learn.microsoft.com/azure/architecture/icons/).
Review the applicable rights before reusing product artwork outside this descriptive demo.
