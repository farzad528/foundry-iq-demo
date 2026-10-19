const icons = {
  azureBlob: { icon: '/assets/blob.svg', label: 'Blob', access: 'Indexed' },
  searchIndex: { icon: '/assets/search.svg', label: 'Search index', access: 'Indexed' },
  web: { icon: '/assets/web.svg', label: 'Web', access: 'Remote' },
  fabricDataAgent: { icon: '/assets/fabric.svg', label: 'Fabric data agent', access: 'Remote' },
  remoteSharePoint: { icon: '/assets/sharepoint.svg', label: 'SharePoint', access: 'Remote' },
};

export function sourceIcon(kind) {
  return Object.hasOwn(icons, kind) ? icons[kind] : { icon: '/assets/source.svg', label: kind || 'Source', access: 'Unclassified' };
}
