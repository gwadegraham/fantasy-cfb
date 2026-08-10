// Jest transform for the ES-module bundles under public/.
//
// Those files are real ES modules — standings.js and friends are loaded with
// <script type="module"> and import each other by name — but this suite runs on
// CommonJS Jest, so `require()` can't read them. This rewrites the `export`
// keywords into a CommonJS `module.exports` so a spec can require the file
// directly (see StandingsInsights.spec.js), leaving the source untouched.
//
// The rewrite is deliberately dumb because that's all these files need: named
// imports, and named function/const exports — no default exports, no re-exports,
// no namespace imports. Anything fancier should fail loudly rather than be
// half-supported, so it's simply not matched here. The result is handed to
// babel-jest so coverage instrumentation still runs — a hand-rolled loader would
// leave the file reported at 0%.

const babelJest = require('babel-jest').default;

const babelTransformer = babelJest.createTransformer({ babelrc: false, configFile: false });

const EXPORTED = /^export\s+(?:async\s+)?(?:function|class|const|let|var)\s+([A-Za-z0-9_$]+)/gm;
const EXPORT_KEYWORD = /^export\s+(?=(?:async\s+)?(?:function|class|const|let|var)\s)/gm;
// import { a, b } from './x.js'  ->  const { a, b } = require('./x.js')
const NAMED_IMPORT = /^import\s+(\{[^}]*\})\s+from\s+(['"][^'"]+['"]);?/gm;
// import './x.js'  ->  require('./x.js')
const BARE_IMPORT = /^import\s+(['"][^'"]+['"]);?/gm;

function toCommonJs(src) {
    let out = src
        .replace(NAMED_IMPORT, 'const $1 = require($2);')
        .replace(BARE_IMPORT, 'require($1);')
        .replace(EXPORT_KEYWORD, '');

    const names = [];
    let match;
    EXPORTED.lastIndex = 0;
    while ((match = EXPORTED.exec(src)) !== null) names.push(match[1]);
    if (names.length) out += `\nmodule.exports = { ${names.join(', ')} };\n`;
    return out;
}

module.exports = {
    canInstrument: true,
    getCacheKey(sourceText, sourcePath, options) {
        return babelTransformer.getCacheKey(toCommonJs(sourceText), sourcePath, options);
    },
    process(sourceText, sourcePath, options) {
        return babelTransformer.process(toCommonJs(sourceText), sourcePath, options);
    }
};
