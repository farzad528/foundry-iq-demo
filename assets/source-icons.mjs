const icons = {
  azureBlob: { icon: '/assets/blob.svg', label: 'Blob', access: 'Indexed' },
  searchIndex: { icon: '/assets/search.svg', label: 'Search index', access: 'Indexed' },
  web: { icon: '/assets/web.svg', label: 'Web', access: 'Remote' },
};

export function sourceIcon(kind) {
  return icons[kind] || { icon: '/assets/source.svg', label: kind || 'Source', access: 'Unclassified' };
}
