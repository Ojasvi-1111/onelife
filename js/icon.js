// Inline SVG icons, so nothing is loaded from outside the app.
const PATHS = {
  plus: '<path d="M12 5v14M5 12h14"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  trophy: '<path d="M8 4h8v5a4 4 0 0 1-8 0V4z"/><path d="M8 6H5a3 3 0 0 0 3 4"/><path d="M16 6h3a3 3 0 0 1-3 4"/><path d="M12 13v4M8.5 20h7M10 17h4"/>',
  settings: '<path d="M4 7h9M19 7h1M4 17h3M13 17h7"/><circle cx="16" cy="7" r="3"/><circle cx="10" cy="17" r="3"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  makeup: '<path d="M8 6l-4 4 4 4"/><path d="M4 10h9a5 5 0 0 1 0 10h-2"/>',
  steps: '<path d="M4 7l2 2 3-4M4 16l2 2 3-4M13 7h7M13 17h7"/>',
  plusone: '<text x="12" y="16.5" text-anchor="middle" font-size="12" font-weight="700" fill="currentColor" stroke="none">+1</text>',
  chevron: '<path d="M9 5l7 7-7 7"/>',
  trash: '<path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13"/>',
  edit: '<path d="M4 20h4l10-10-4-4L4 16v4zM13 7l4 4"/>',
  skip: '<path d="M5 6l7 6-7 6V6zM13 6l7 6-7 6V6z"/>',
  up: '<path d="M6 15l6-6 6 6"/>',
  down: '<path d="M6 9l6 6 6-6"/>'
};

export function icon(name, cls = 'icon') {
  return '<svg class="' + cls + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    (PATHS[name] || '') + '</svg>';
}
