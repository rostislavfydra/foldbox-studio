const fs=require('node:fs');
const path=require('node:path');
const esbuild=require('esbuild');
const root=path.resolve(__dirname,'..');
const dist=path.join(root,'dist');
const pdfDir=path.dirname(require.resolve('pdfjs-dist/package.json'));
const pdfOut=path.join(dist,'pdf');
const nodePaths=(process.env.NODE_PATH || '').split(path.delimiter).filter(Boolean).map(p=>path.resolve(p));
const common={bundle:true,minify:true,legalComments:'inline',platform:'browser',logLevel:'warning',nodePaths};

async function build() {
  fs.mkdirSync(pdfOut,{recursive:true});
  await esbuild.build({...common,entryPoints:[path.join(root,'src/main.js')],outfile:path.join(dist,'studio.js'),
    loader:{'.webp':'dataurl','.svg':'dataurl','.pdf':'dataurl'},target:'es2020',
    assetNames:'a4/[name]-[hash]',
    plugins:[{name:'a4-print-textures',setup(build) {
      build.onLoad({filter:/[/\\]a4-designs[/\\].+-(inside|outside)\.webp$/},async ({path:file})=>
        ({contents:await fs.promises.readFile(file),loader:'file'}));
    }}]});
  await esbuild.build({...common,entryPoints:[path.join(root,'src/pdf-renderer.js')],outfile:path.join(dist,'booklet-pdf.js'),
    format:'iife',globalName:'FoldboxPdf',target:'es2022',
    alias:{'pdfjs-dist/legacy/build/pdf.mjs':path.join(pdfDir,'legacy/build/pdf.mjs')},
    define:{'import.meta.url':'document.baseURI'}});
  fs.copyFileSync(path.join(pdfDir,'legacy/build/pdf.worker.min.mjs'),path.join(pdfOut,'worker.mjs'));
  fs.copyFileSync(path.join(pdfDir,'LICENSE'),path.join(pdfOut,'LICENSE.txt'));
  for(const folder of ['cmaps','standard_fonts','wasm','iccs']) {
    fs.cpSync(path.join(pdfDir,folder),path.join(pdfOut,folder),{recursive:true});
  }
}
build().catch(error=>{console.error(error);process.exitCode=1;});
