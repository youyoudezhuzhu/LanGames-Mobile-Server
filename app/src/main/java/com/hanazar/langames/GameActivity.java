package com.hanazar.langames;

import android.app.Activity;
import android.content.Context;
import android.content.pm.ActivityInfo;
import android.net.ConnectivityManager;
import android.net.LinkAddress;
import android.net.LinkProperties;
import android.net.Network;
import android.os.Bundle;
import android.view.View;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.NetworkInterface;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * 内嵌 WebView：加载本机 node 服务器，让开服务器的手机也能直接玩。
 * 支持页面内 Fullscreen API（onShowCustomView），配合前端全屏按钮使用。
 */
public class GameActivity extends Activity {

    /** 供 WebView 调用的 IP 桥：枚举系统所有网卡（WiFi/热点/流量）的 IPv4 */
    public class AndroidBridge {
        private final Context context;

        public AndroidBridge(Context context) {
            this.context = context;
        }

        @JavascriptInterface
        public String getIpAddresses() {
            List<String> ips = new ArrayList<>();
            // 方式一：NetworkInterface 全量枚举（wlan0 / ap0 / rmnet_data0 等）
            try {
                for (NetworkInterface nif : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                    if (nif == null || !nif.isUp() || nif.isLoopback()) continue;
                    for (InetAddress addr : Collections.list(nif.getInetAddresses())) {
                        if (addr instanceof Inet4Address && !addr.isLoopbackAddress() && !addr.isLinkLocalAddress()) {
                            String ip = addr.getHostAddress();
                            if (ip != null && !ips.contains(ip)) ips.add(ip);
                        }
                    }
                }
            } catch (Exception ignored) { }
            // 方式二：ConnectivityManager 补充（可能拿到 LinkProperties 里的完整地址）
            try {
                ConnectivityManager cm = (ConnectivityManager) context.getSystemService(Context.CONNECTIVITY_SERVICE);
                if (cm != null) {
                    for (Network network : cm.getAllNetworks()) {
                        LinkProperties lp = cm.getLinkProperties(network);
                        if (lp == null) continue;
                        for (LinkAddress la : lp.getLinkAddresses()) {
                            InetAddress addr = la.getAddress();
                            if (addr instanceof Inet4Address && !addr.isLoopbackAddress() && !addr.isLinkLocalAddress()) {
                                String ip = addr.getHostAddress();
                                if (ip != null && !ips.contains(ip)) ips.add(ip);
                            }
                        }
                    }
                }
            } catch (Exception ignored) { }
            return String.join(",", ips);
        }
    }

    private WebView webView;
    private FrameLayout fullscreenContainer;
    private View customView;
    private WebChromeClient.CustomViewCallback customViewCallback;

    /**
     * 手机横屏适配层：自动读取 devicePixelRatio / 视口 / 方向，注入：
     *  - :root CSS 变量 --dpr / --vw / --vh / --aspect（页面可据此做弹性布局）
     *  - <html data-orientation="landscape|portrait"> 方向类
     *  - 以 360 CSS 宽为基准的弹性 rem（--mobile-font-size），供 rem/em 排版随物理 DPI 缩放
     * 仅设变量与类，不强制改布局，避免破坏各游戏原有排版。
     */
    private static final String MOBILE_FIT_JS =
        "(function(){" +
        "  function fit(){" +
        "    var dpr = window.devicePixelRatio || 1;" +
        "    var vv = window.visualViewport;" +
        "    var w = vv ? vv.width : window.innerWidth;" +
        "    var h = vv ? vv.height : window.innerHeight;" +
        "    var orient = (w >= h) ? 'landscape' : 'portrait';" +
        "    var doc = document.documentElement;" +
        "    doc.style.setProperty('--dpr', String(dpr));" +
        "    doc.style.setProperty('--vw', w + 'px');" +
        "    doc.style.setProperty('--vh', h + 'px');" +
        "    doc.style.setProperty('--aspect', String((Math.min(w,h) / Math.max(w,h)).toFixed(4)));" +
        "    doc.setAttribute('data-orientation', orient);" +
        "    doc.style.setProperty('--mobile-font-size', Math.round((Math.max(w,h) / 360) * 100) / 100 + 'px');" +
        "    if(!document.getElementById('mobile-fit-meta')){var m=document.createElement('style');m.id='mobile-fit-meta';m.textContent='html[data-orientation=landscape]{height:100%;}';" +
        "      (document.head||document.documentElement).appendChild(m);}" +
        "  }" +
        "  fit();" +
        "  window.addEventListener('resize', fit);" +
        "  window.addEventListener('orientationchange', function(){ setTimeout(fit, 80); });" +
        "})();";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // 强制横屏全屏（游戏手机端适配）
        setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE);
        getWindow().getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                        | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_LAYOUT_STABLE);

        FrameLayout root = new FrameLayout(this);
        setContentView(root);

        fullscreenContainer = new FrameLayout(this);
        root.addView(fullscreenContainer, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));

        webView = new WebView(this);
        fullscreenContainer.addView(webView, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        // 视口：遵循 viewport meta 的 width=device-width，用真实 CSS 视口渲染
        settings.setUseWideViewPort(true);
        // 不要"总览缩放"（否则高分辨率手机上页面被缩小、布局错位）
        settings.setLoadWithOverviewMode(false);
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setTextZoom(100);
        settings.setCacheMode(WebSettings.LOAD_NO_CACHE);

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(android.webkit.WebView view, String url) {
                super.onPageFinished(view, url);
                view.evaluateJavascript(MOBILE_FIT_JS, null);
            }
        });
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onShowCustomView(View view, CustomViewCallback callback) {
                if (customView != null) {
                    callback.onCustomViewHidden();
                    return;
                }
                customView = view;
                customViewCallback = callback;
                fullscreenContainer.addView(customView, new FrameLayout.LayoutParams(
                        FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
                webView.setVisibility(View.GONE);
                hideSystemUi(true);
            }

            @Override
            public void onHideCustomView() {
                exitCustomView();
            }
        });

        // 原生 IP 桥：让前端能拿到所有网卡（WiFi/热点/流量）地址
        webView.addJavascriptInterface(new AndroidBridge(this), "AndroidBridge");

        // 加载启动页选中的游戏；若未传 URL，则回落到目录接口
        String url = getIntent().getStringExtra("url");
        if (url == null || url.isEmpty()) {
            url = "http://127.0.0.1:" + NodeService.CATALOG_PORT + "/api/catalog";
        }
        webView.loadUrl(url);
    }

    private void hideSystemUi(boolean immersive) {
        if (immersive) {
            getWindow().getDecorView().setSystemUiVisibility(
                    View.SYSTEM_UI_FLAG_FULLSCREEN
                            | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                            | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                            | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                            | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                            | View.SYSTEM_UI_FLAG_LAYOUT_STABLE);
        } else {
            getWindow().getDecorView().setSystemUiVisibility(
                    View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                            | View.SYSTEM_UI_FLAG_LAYOUT_STABLE);
        }
    }

    @Override
    public void onBackPressed() {
        if (customView != null) {
            // 全屏状态下优先退出全屏
            if (webView != null) {
                webView.evaluateJavascript("if (document.exitFullscreen) { document.exitFullscreen(); } else if (document.webkitExitFullscreen) { document.webkitExitFullscreen(); }", null);
            }
            exitCustomView();
            return;
        }
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }

    /** 移除全屏视图并恢复 WebView（等价于 onHideCustomView 的清理逻辑） */
    private void exitCustomView() {
        if (customView == null) return;
        fullscreenContainer.removeView(customView);
        customView = null;
        if (customViewCallback != null) {
            customViewCallback.onCustomViewHidden();
            customViewCallback = null;
        }
        webView.setVisibility(View.VISIBLE);
        hideSystemUi(false);
    }

    @Override
    protected void onPause() {
        if (webView != null) webView.onPause();
        super.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (webView != null) webView.onResume();
    }

    @Override
    protected void onDestroy() {
        if (webView != null) webView.destroy();
        super.onDestroy();
    }
}
