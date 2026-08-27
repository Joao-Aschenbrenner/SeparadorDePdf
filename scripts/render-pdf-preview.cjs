// Renderiza páginas de um PDF escaneado como PNG para inspeção manual.
// Uso: node scripts/render-pdf-preview.cjs <arquivo.pdf> <paginas: 1,2,3>
const { createCanvas, Image, ImageData, DOMMatrix } = require("canvas");
global.Image = Image;
global.HTMLImageElement = Image;
global.HTMLCanvasElement = Object;
global.ImageData = ImageData;
global.DOMMatrix = DOMMatrix;

const fs = require("fs");
const path = require("path");

(async () => {
  const [,, pdfPath, pagesArg = "1,2,3"] = process.argv;
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const data = new Uint8Array(fs.readFileSync(pdfPath));
  const doc = await getDocument({ data, useSystemFonts: true }).promise;
  console.log("paginas:", doc.numPages);
  const pages = pagesArg.split(",").map(Number);
  for (const i of pages) {
    const page = await doc.getPage(i);
    const vp = page.getViewport({ scale: 1.8 });
    const c = createCanvas(vp.width, vp.height);
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, vp.width, vp.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    const out = path.join(process.cwd(), "page" + i + ".png");
    fs.writeFileSync(out, c.toBuffer("image/png"));
    console.log("salvo", out, vp.width + "x" + vp.height);
  }
  doc.destroy();
})().catch((e) => { console.error("ERR", e); process.exit(1); });