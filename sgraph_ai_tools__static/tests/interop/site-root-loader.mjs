/**
 * ESM resolve hook that maps the site-absolute imports used across this repo
 * ("/core/…", "/components/…") onto the static root on disk, so published
 * modules can be imported in Node exactly as the browser loads them.
 *
 * Register it from a test with:
 *   import { register } from 'node:module';
 *   register('./site-root-loader.mjs', import.meta.url, { data: { staticRoot } });
 */
import { pathToFileURL } from 'node:url';

let staticRoot = process.env.SG_STATIC_ROOT || '';

export function initialize(data) {
    if (data && data.staticRoot) staticRoot = data.staticRoot;
}

export function resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('/core/') || specifier.startsWith('/components/')) {
        return { url: pathToFileURL(staticRoot + specifier).href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
}
