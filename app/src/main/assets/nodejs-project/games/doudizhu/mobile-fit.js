/* mobile-fit — 手机横屏适配层（随网页下发，任何设备/浏览器都生效）
 * 自动读取 devicePixelRatio / visualViewport / 方向，注入：
 *   :root CSS 变量   --dpr --vw --vh --aspect --fit-rem
 *   <html data-orientation="landscape|portrait">
 *   弹性根字号（以横屏较长边为基准，360 CSS 宽 => 1rem）
 * 可选贴合缩放：若 <html data-mobile-fit="fit">，则当内容超出视口时用
 *   CSS zoom 缩小到贴合（只缩不放，保持比例）。
 */
(function () {
  function readViewport() {
    var dpr = window.devicePixelRatio || 1;
    var vv = window.visualViewport;
    var w = vv ? vv.width : window.innerWidth;
    var h = vv ? vv.height : window.innerHeight;
    if (!w || !h) { w = window.innerWidth; h = window.innerHeight; }
    return {
      dpr: dpr,
      w: w,
      h: h,
      orient: w >= h ? "landscape" : "portrait",
      aspect: (Math.min(w, h) / Math.max(w, h)).toFixed(4)
    };
  }

  function injectStyle() {
    if (document.getElementById("mobile-fit-style")) return;
    var s = document.createElement("style");
    s.id = "mobile-fit-style";
    s.textContent =
      ":root{--dpr:1;--vw:100vw;--vh:100vh;--aspect:1;--fit-rem:1rem;}" +
      "html,body{width:100%;height:100%;margin:0;padding:0;}" +
      "html[data-orientation=landscape]{height:100%;}";
    (document.head || document.documentElement).appendChild(s);
  }

  function fit() {
    var d = readViewport();
    var doc = document.documentElement;
    injectStyle();
    doc.style.setProperty("--dpr", String(d.dpr));
    doc.style.setProperty("--vw", d.w + "px");
    doc.style.setProperty("--vh", d.h + "px");
    doc.style.setProperty("--aspect", d.aspect);
    doc.setAttribute("data-orientation", d.orient);

    // 只在内容超出视口时用 zoom 缩放到贴合（只缩不放、保持比例），避免把 rem/em 游戏放大
    if (doc.getAttribute("data-mobile-fit") === "fit") {
      var nw = Math.max(doc.scrollWidth, document.body ? document.body.scrollWidth : 0);
      var nh = Math.max(doc.scrollHeight, document.body ? document.body.scrollHeight : 0);
      var scale = Math.min(1, Math.min(d.w / (nw || d.w), d.h / (nh || d.h)));
      doc.style.zoom = scale.toFixed(4);
      if (document.body) document.body.style.margin = "0 auto";
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", fit);
  } else {
    fit();
  }
  window.addEventListener("resize", fit);
  window.addEventListener("orientationchange", function () { setTimeout(fit, 100); });
})();
