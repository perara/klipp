/**
 * Lowercase JSX tags that are DOM elements: HTML's and SVG's. In react-three-fiber files,
 * lowercase tags are three.js objects too, and only these are stamped as elements there.
 * `path` and `audio`, which react-three-fiber also has, are left out.
 */
export const DOM_TAGS = new Set(
  [
    // HTML
    'a abbr address area article aside b base bdi bdo blockquote body br button canvas caption',
    'cite code col colgroup data datalist dd del details dfn dialog div dl dt em embed fieldset',
    'figcaption figure footer form h1 h2 h3 h4 h5 h6 head header hgroup hr html i iframe img',
    'input ins kbd label legend li link main map mark menu meta meter nav noscript object ol',
    'optgroup option output p picture pre progress q rp rt ruby s samp search section select',
    'slot small source span strong style sub summary sup table tbody td template textarea tfoot',
    'th thead time title tr track u ul var video wbr',
    // SVG
    'svg circle clipPath defs desc ellipse filter foreignObject g image linearGradient marker',
    'mask pattern polygon polyline radialGradient rect stop symbol text textPath tspan use',
  ]
    .join(' ')
    .split(' '),
);
