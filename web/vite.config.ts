import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

/**
 * Start on the database, and on the page, while the script is still downloading.
 *
 * Every page's first read goes to Supabase, and the browser did not learn that
 * host existed until the whole bundle had arrived and run -- only then did it
 * look the name up, connect and negotiate TLS, with the page waiting behind
 * all three. Three things are written into index.html to use that time:
 *
 *   1. A preconnect. crossorigin, because supabase-js reads with fetch and
 *      sends no cookies; the browser keeps such connections apart, and a
 *      preconnect without the attribute opens one the reads then cannot use.
 *
 *   2. The division summary, asked for outright. It is the slowest read the
 *      public site makes -- 1.6 to 7.7 seconds on 10 October 2026 -- and seven
 *      pages draw it, so every millisecond it starts earlier comes straight
 *      off those pages. A few lines of inline script fetch it and leave the
 *      promise on window.__echoEarly, where src/lib/data.ts picks it up.
 *      It asks only on the pages that show the summary, and only when the copy
 *      kept from the last visit is missing or more than ten minutes old -- the
 *      same rule data.ts applies, so nothing is ever asked twice.
 *
 *   3. A modulepreload for the page in the address bar; see the note beside
 *      it below.
 *
 * The publishable key appears in the HTML as a result. It was already in the
 * script next to it, and is meant to be public: see src/lib/supabase.ts.
 *
 * Nothing is added when the build has no VITE_SUPABASE_URL: that build shows
 * the NotConfigured panel and has nothing to connect to. And the early read
 * respects the maintenance lock in src/lib/site.ts, which promises that
 * nothing behind it fetches anything.
 */
function earlyStart(mode: string, base: string): Plugin {
  const here = fileURLToPath(new URL('.', import.meta.url))
  const env = loadEnv(mode, here, 'VITE_')
  const url = (env.VITE_SUPABASE_URL ?? '').trim().replace(/\/+$/, '')
  const key = (env.VITE_SUPABASE_ANON_KEY ?? '').trim()

  // The lock's timestamp, read out of the source rather than imported: this
  // file runs in Node before any of src/ is compiled.
  const site = readFileSync(new URL('./src/lib/site.ts', import.meta.url), 'utf8')
  const lock = /MAINTENANCE_LOCK_UNTIL[^=\n]*=\s*'([^']+)'/.exec(site)?.[1] ?? null
  const lockedUntil = lock ? new Date(lock).getTime() : 0

  // Keep in step with src/lib/cache.ts (PREFIX, the stored shape) and
  // src/lib/data.ts (the key, the ten minutes, the query, the pages).
  const earlyRead = `if(p===''||p==='divisions'||p==='network'||p==='about'||p==='airlines'){
if(Date.now()>=${lockedUntil}){
var c=null;try{c=JSON.parse(localStorage.getItem('echo:1:divisions')||'null')}catch(e){}
if(!(c&&Date.now()-c.at<6e5)){
var k=${JSON.stringify(key)};
var r=fetch(${JSON.stringify(url + '/rest/v1/v_division_summary?select=*&order=sort_order.asc')},{headers:{apikey:k,Authorization:'Bearer '+k}}).then(function(x){if(!x.ok)throw new Error('early read '+x.status);return x.json()});
r.catch(function(){});
window.__echoEarly={divisions:r};
}}}`

  // Which file under src/pages each address opens. Keep in step with
  // pageFor() in src/pages/index.ts.
  const PAGE_OF: Record<string, string> = {
    about: 'About',
    activities: 'Activities',
    divisions: 'Divisions',
    airlines: 'Directory',
    airports: 'Airport',
    network: 'Network',
    search: 'SearchResults',
    book: 'Book',
    trips: 'Trips',
    resonance: 'Resonance',
    news: 'News',
    rtw: 'RoundTheWorld',
    terms: 'Policy',
    conduct: 'Policy',
    privacy: 'Policy',
  }

  return {
    name: 'echo-early-start',
    transformIndexHtml(html, ctx) {
      // The built file for each page, by the name of its source. Only a build
      // has a bundle to look in; the dev server serves modules as they are.
      const files: Record<string, string> = {}
      for (const chunk of Object.values(ctx.bundle ?? {})) {
        if (chunk.type !== 'chunk' || !chunk.facadeModuleId) continue
        const name = /[\\/]src[\\/]pages[\\/](\w+)\.tsx$/.exec(chunk.facadeModuleId)?.[1]
        if (name) files[name] = base + chunk.fileName
      }
      const routes: Record<string, string> = {}
      for (const [route, name] of Object.entries(PAGE_OF)) {
        if (files[name]) routes[route] = files[name]
      }
      const carrier = files.Airline ?? ''
      const division = files.Division ?? ''

      // 3. The page the address bar names. Home is in the main script; every
      //    other page is a file of its own (src/pages/index.ts), which the
      //    main script would only ask for once it had arrived and run. A
      //    modulepreload written here fetches the two side by side.
      const pagePreload = `var f=${JSON.stringify(routes)}[p]||(p==='d'?(h.length>=3?${JSON.stringify(carrier)}:h.length===2?${JSON.stringify(division)}:''):'');
if(typeof f==='string'&&f){var l=document.createElement('link');l.rel='modulepreload';l.crossOrigin='';l.href=f;document.head.appendChild(l)}`

      const parts = [Object.keys(files).length > 0 ? pagePreload : '', url && key ? earlyRead : '']
      if (parts.every((part) => part === '')) return html
      const script = `(function(){try{
var h=location.hash.replace(/^#\\/?/,'').split('?')[0].split('/').filter(Boolean);
var p=h[0]||'';
${parts.filter(Boolean).join('\n')}
}catch(e){}})();`

      // Straight after the viewport tag: below the charset, which has to stay
      // in the first kilobyte of the file, and above every stylesheet. An
      // inline script placed after a stylesheet waits for that stylesheet, and
      // the first one here is Google Fonts on another host -- the read would
      // start late for no reason.
      const tags =
        (url && key ? `<link rel="preconnect" href="${url}" crossorigin />\n    ` : '') +
        `<script>${script}</script>`
      const anchor = /<meta name="viewport"[^>]*>/
      if (!anchor.test(html)) throw new Error('index.html has no viewport meta to put the early start after')
      return html.replace(anchor, (meta) => `${meta}\n    ${tags}`)
    },
  }
}

// GitHub Pages serves a project site from /<repo>/, so the base path has to
// match. Set VITE_BASE in the workflow; it defaults to '/' for local dev and
// for a user/organisation page served from the domain root.
const BASE = process.env.VITE_BASE ?? '/'

export default defineConfig(({ mode }) => ({
  base: BASE,
  plugins: [react(), tailwindcss(), earlyStart(mode, BASE)],
  build: {
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        // The libraries in files of their own. They change when a dependency
        // is upgraded, which is rarely; the site's own code changes with every
        // weekly scrape. Apart, a returning visitor's browser keeps the larger
        // half and fetches only the half that moved.
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined
          if (/[\\/]node_modules[\\/](react|react-dom|scheduler|react-router|react-router-dom)[\\/]/.test(id)) {
            return 'react'
          }
          if (/[\\/]node_modules[\\/]@supabase[\\/]/.test(id)) return 'supabase'
          return undefined
        },
      },
    },
  },
}))
