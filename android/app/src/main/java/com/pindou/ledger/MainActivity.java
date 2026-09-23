package com.pindou.ledger;

import android.app.Activity;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.WindowInsets;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.window.OnBackInvokedDispatcher;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.util.Map;
import java.util.HashMap;
import java.util.Collections;

public final class MainActivity extends Activity {
    private static final String ORIGIN = "https://pindou.invalid";
    private WebView web;
    private AndroidBridge bridge;

    @Override public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(0xfff7f3ea);
        web = new WebView(this);
        root.addView(web, new FrameLayout.LayoutParams(-1, -1));
        if (Build.VERSION.SDK_INT >= 30) getWindow().setDecorFitsSystemWindows(false);
        root.setOnApplyWindowInsetsListener((view, insets) -> {
            if (Build.VERSION.SDK_INT >= 30) {
                android.graphics.Insets padding = insets.getInsets(WindowInsets.Type.systemBars()
                    | WindowInsets.Type.displayCutout() | WindowInsets.Type.ime());
                view.setPadding(padding.left, padding.top, padding.right, padding.bottom);
            } else {
                view.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(),
                    insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
            }
            return insets;
        });
        setContentView(root);
        WebView.setWebContentsDebuggingEnabled((getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0);
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setAllowFileAccessFromFileURLs(false);
        settings.setAllowUniversalAccessFromFileURLs(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        web.setWebChromeClient(new WebChromeClient());
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                // Only the bundled document and its hash routes can navigate this bridge-enabled view.
                return !localDocument(request.getUrl());
            }
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return asset(request.getUrl(), request.getMethod());
            }
        });
        bridge = new AndroidBridge(this, web);
        web.addJavascriptInterface(bridge, "PindouAndroid");
        if (Build.VERSION.SDK_INT >= 33) {
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(OnBackInvokedDispatcher.PRIORITY_DEFAULT, this::goBack);
        }
        web.loadUrl(ORIGIN + "/index.html");
    }

    private boolean localDocument(Uri uri) {
        return "https".equals(uri.getScheme()) && "pindou.invalid".equals(uri.getHost())
            && uri.getPort() == -1 && "/index.html".equals(uri.getPath());
    }

    private WebResourceResponse asset(Uri uri, String method) {
        String path = uri.getPath();
        if (!"GET".equals(method) || !"https".equals(uri.getScheme()) || !"pindou.invalid".equals(uri.getHost())
            || uri.getPort() != -1 || path == null || path.contains("..") || path.contains("\\")) return missing();
        String mime = path.endsWith(".html") ? "text/html" : path.endsWith(".js") || path.endsWith(".mjs")
            ? "text/javascript" : path.endsWith(".css") ? "text/css" : path.endsWith(".json")
            ? "application/json" : path.endsWith(".png") ? "image/png" : path.endsWith(".svg")
            ? "image/svg+xml" : path.endsWith(".wasm") ? "application/wasm" : "application/octet-stream";
        try {
            return new WebResourceResponse(mime, "UTF-8", 200, "OK", headers("default-src 'self'; script-src 'self' blob: 'wasm-unsafe-eval'; "
                    + "style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; "
                    + "connect-src 'self' blob: data:; worker-src 'self' blob:; frame-src 'none'; object-src 'none'; base-uri 'self'"), getAssets().open(path.substring(1)));
        } catch (IOException error) { return missing(); }
    }

    private Map<String, String> headers(String policy) {
        Map<String, String> headers = new HashMap<>();
        headers.put("Content-Security-Policy", policy);
        headers.put("X-Content-Type-Options", "nosniff");
        return headers;
    }

    private WebResourceResponse missing() {
        return new WebResourceResponse("text/plain", "UTF-8", 404, "Not Found", Collections.emptyMap(), new ByteArrayInputStream(new byte[0]));
    }

    @Override protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        bridge.onActivityResult(requestCode, resultCode, data);
    }

    @Override public void onBackPressed() {
        goBack();
    }

    private void goBack() {
        if (web.canGoBack()) web.goBack(); else moveTaskToBack(true);
    }

    @Override protected void onDestroy() {
        web.removeJavascriptInterface("PindouAndroid");
        web.destroy();
        bridge.close();
        super.onDestroy();
    }
}
