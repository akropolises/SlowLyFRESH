// 振り返りキャンバスの1滴の形。アプリの描画(app.js)とSVG書き出し(scripts/export-artwork.js)で共有する。
// ブラウザでは window.MicroSlowArtwork、Node.jsでは require() で使う。
(function (root) {
  // 出口で選べる感覚色と、キャンバスの滲み描画に使う実際のRGB値の対応表
  const senseColorHex = {
    green: "#6f9f89",
    gold: "#d7a447",
    blue: "#668ca8",
    rose: "#c96f61",
  };

  function pseudoRandom(seed) {
    const value = Math.sin(seed) * 43758.5453;
    return value - Math.floor(value);
  }

  // 1滴の絵の具を、水面に垂らしたインクのように「にじんで歪んだ」見た目にするため、
  // 中心をわずかにずらした半透明の円4枚を重ねる(React版ArtworkCanvasと同じロジック)。
  // 奥(大きく薄い円)から手前の順に、円の中心・半径・色・不透明度を返す。
  // drop.x / drop.y はキャンバスに対する0〜1の位置、drop.size は360px四方のキャンバスでの直径
  function inkBlotLayers(drop, canvasSize) {
    const color = senseColorHex[drop.color] || "#999999";
    const seed = drop.x * 97.13 + drop.y * 57.31 + drop.size * 13.7;
    const size = drop.size * (canvasSize / 360);
    const cx = drop.x * canvasSize;
    const cy = drop.y * canvasSize;
    const layers = [];

    for (let i = 3; i >= 0; i -= 1) {
      const s = seed + i * 19.7;
      const offsetX = (pseudoRandom(s + 1) - 0.5) * size * 0.3;
      const offsetY = (pseudoRandom(s + 2) - 0.5) * size * 0.3;
      const scale = 1 + i * (0.22 + pseudoRandom(s + 3) * 0.12);
      const opacity = Math.max(0.32 - i * 0.06 + pseudoRandom(s + 5) * 0.05, 0.05);
      layers.push({ cx: cx + offsetX, cy: cy + offsetY, r: (size * scale) / 2, color, opacity });
    }
    return layers;
  }

  const api = { senseColorHex, inkBlotLayers };
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    root.MicroSlowArtwork = api;
  }
})(this);
