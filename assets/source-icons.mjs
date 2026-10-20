const icons = {
  azureBlob: { icon: '/assets/blob.svg', label: 'Blob', access: 'Indexed' },
  searchIndex: { icon: '/assets/search.svg', label: 'Search index', access: 'Indexed' },
  web: { icon: '/assets/web.svg', label: 'Web', access: 'Remote' },
  fabricDataAgent: { icon: '/assets/fabric.svg', label: 'Fabric data agent', access: 'Remote' },
  remoteSharePoint: { icon: '/assets/sharepoint.svg', label: 'SharePoint', access: 'Remote' },
};

// Gallery IDs describe source families, not unverified REST enum spellings.
export const sourceFamilies = Object.freeze([
  { id: 'search-index', label: 'Search index', icon: '/assets/search.svg', access: 'Indexed' },
  { id: 'blob', label: 'Azure Blob / ADLS Gen2', icon: '/assets/blob.svg', access: 'Indexed' },
  { id: 'sql', label: 'Azure SQL', icon: '/assets/sql.svg', access: 'Indexed', preview: true },
  { id: 'file', label: 'File', icon: '/assets/file.svg', access: 'Indexed', preview: true },
  { id: 'onelake', label: 'OneLake', icon: '/assets/fabric.svg', access: 'Indexed' },
  { id: 'sharepoint-indexed', label: 'Indexed SharePoint', icon: '/assets/sharepoint.svg', access: 'Indexed', preview: true },
  { id: 'sharepoint-remote', label: 'Remote SharePoint', icon: '/assets/sharepoint.svg', access: 'Remote', preview: true },
  { id: 'fabric-agent', label: 'Fabric data agent', icon: '/assets/fabric.svg', access: 'Remote', preview: true },
  { id: 'fabric-ontology', label: 'Fabric ontology', icon: '/assets/fabric.svg', access: 'Remote', preview: true },
  { id: 'mcp', label: 'MCP server', icon: '/assets/mcp.svg', access: 'Remote', preview: true },
  { id: 'workiq', label: 'Work IQ', icon: '/assets/workiq.svg', access: 'Remote', preview: true },
  { id: 'web', label: 'Web', icon: '/assets/web.svg', access: 'Remote' },
]);

export function sourceIcon(kind) {
  return Object.hasOwn(icons, kind) ? icons[kind] : { icon: '/assets/source.svg', label: kind || 'Source', access: 'Unclassified' };
}
