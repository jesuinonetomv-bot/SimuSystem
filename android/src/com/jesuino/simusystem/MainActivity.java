package com.jesuino.simusystem;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Insets;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.JsPromptResult;
import android.webkit.JsResult;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;
import android.window.OnBackInvokedDispatcher;

public final class MainActivity extends Activity {
    private static final int CHOOSE_FILE = 10;
    private FrameLayout root;
    private WebView webView;
    private ProgressBar progress;
    private LinearLayout connectionError;
    private View fullScreenView;
    private WebChromeClient.CustomViewCallback fullScreenCallback;
    private ValueCallback<Uri[]> fileCallback;

    @Override public void onCreate(Bundle savedState) {
        super.onCreate(savedState);
        getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);
        root = new FrameLayout(this);
        root.setBackgroundColor(Color.rgb(38, 51, 61));
        root.setOnApplyWindowInsetsListener((view, insets) -> {
            if (Build.VERSION.SDK_INT >= 30) {
                Insets safe = insets.getInsets(WindowInsets.Type.systemBars()
                    | WindowInsets.Type.displayCutout() | WindowInsets.Type.ime());
                view.setPadding(safe.left, safe.top, safe.right, safe.bottom);
            } else {
                view.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(),
                    insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
            }
            return insets;
        });
        setContentView(root);

        webView = new WebView(this);
        webView.setBackgroundColor(Color.rgb(217, 217, 217));
        root.addView(webView, new FrameLayout.LayoutParams(-1, -1));
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setUseWideViewPort(true);
        settings.setLoadWithOverviewMode(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        if (Build.VERSION.SDK_INT >= 33) settings.setAlgorithmicDarkeningAllowed(false);
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, false);
        WebView.setWebContentsDebuggingEnabled(false);

        progress = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        progress.setContentDescription(getString(R.string.loading));
        root.addView(progress, new FrameLayout.LayoutParams(-1, dp(3), Gravity.TOP));
        buildConnectionMessage();
        webView.setWebViewClient(new SimuWebClient());
        webView.setWebChromeClient(new SimuChromeClient());
        webView.setDownloadListener((url, agent, disposition, mime, size) -> openExternal(url));

        if (savedState == null || webView.restoreState(savedState) == null
            || !NavigationPolicy.isInternal(webView.getUrl())) {
            webView.loadUrl(NavigationPolicy.HOME);
        }
        if (Build.VERSION.SDK_INT >= 33) {
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(
                OnBackInvokedDispatcher.PRIORITY_DEFAULT, this::handleBack);
        }
        root.requestApplyInsets();
    }

    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }

    private void buildConnectionMessage() {
        connectionError = new LinearLayout(this);
        connectionError.setOrientation(LinearLayout.VERTICAL);
        connectionError.setGravity(Gravity.CENTER);
        connectionError.setPadding(dp(28), dp(28), dp(28), dp(28));
        connectionError.setBackgroundColor(Color.rgb(245, 245, 245));
        TextView title = new TextView(this);
        title.setText(R.string.connection_title);
        title.setTextSize(22);
        title.setGravity(Gravity.CENTER);
        connectionError.addView(title);
        TextView body = new TextView(this);
        body.setText(R.string.connection_body);
        body.setTextSize(16);
        body.setGravity(Gravity.CENTER);
        body.setPadding(0, dp(16), 0, dp(20));
        connectionError.addView(body);
        Button retry = new Button(this);
        retry.setText(R.string.retry);
        retry.setOnClickListener(v -> {
            connectionError.setVisibility(View.GONE);
            webView.loadUrl(NavigationPolicy.HOME);
        });
        connectionError.addView(retry);
        connectionError.setVisibility(View.GONE);
        root.addView(connectionError, new FrameLayout.LayoutParams(-1, -1));
    }

    private void showConnectionError() {
        progress.setVisibility(View.GONE);
        connectionError.setVisibility(View.VISIBLE);
    }

    private void openExternal(String address) {
        if (!NavigationPolicy.canOpenExternally(address)) return;
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(address)));
        } catch (ActivityNotFoundException e) {
            Toast.makeText(this, R.string.open_link_error, Toast.LENGTH_SHORT).show();
        }
    }

    private final class SimuWebClient extends WebViewClient {
        @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            String address = request.getUrl().toString();
            if (NavigationPolicy.isInternal(address)) return false;
            if (request.isForMainFrame()) openExternal(address);
            return true;
        }
        @Override public void onPageStarted(WebView view, String url, android.graphics.Bitmap icon) {
            connectionError.setVisibility(View.GONE);
            progress.setVisibility(View.VISIBLE);
        }
        @Override public void onPageFinished(WebView view, String url) { progress.setVisibility(View.GONE); }
        @Override public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
            if (request.isForMainFrame()) showConnectionError();
        }
        @Override public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse response) {
            if (request.isForMainFrame()) showConnectionError();
        }
    }

    private final class SimuChromeClient extends WebChromeClient {
        @Override public void onProgressChanged(WebView view, int value) { progress.setProgress(value); }

        @Override public boolean onJsAlert(WebView view, String url, String message, JsResult result) {
            new AlertDialog.Builder(MainActivity.this).setTitle(R.string.app_name).setMessage(message)
                .setPositiveButton(android.R.string.ok, (dialog, which) -> result.confirm())
                .setOnCancelListener(dialog -> result.cancel()).show();
            return true;
        }
        @Override public boolean onJsConfirm(WebView view, String url, String message, JsResult result) {
            new AlertDialog.Builder(MainActivity.this).setTitle(R.string.app_name).setMessage(message)
                .setPositiveButton(R.string.confirm, (dialog, which) -> result.confirm())
                .setNegativeButton(R.string.cancel, (dialog, which) -> result.cancel())
                .setOnCancelListener(dialog -> result.cancel()).show();
            return true;
        }
        @Override public boolean onJsPrompt(WebView view, String url, String message, String value, JsPromptResult result) {
            EditText input = new EditText(MainActivity.this);
            input.setText(value);
            new AlertDialog.Builder(MainActivity.this).setTitle(R.string.app_name).setMessage(message).setView(input)
                .setPositiveButton(R.string.confirm, (dialog, which) -> result.confirm(input.getText().toString()))
                .setNegativeButton(R.string.cancel, (dialog, which) -> result.cancel())
                .setOnCancelListener(dialog -> result.cancel()).show();
            return true;
        }
        @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
            if (fileCallback != null) fileCallback.onReceiveValue(null);
            fileCallback = callback;
            try {
                startActivityForResult(params.createIntent(), CHOOSE_FILE);
            } catch (ActivityNotFoundException e) {
                fileCallback.onReceiveValue(null);
                fileCallback = null;
            }
            return true;
        }
        @Override public void onShowCustomView(View view, CustomViewCallback callback) {
            if (fullScreenView != null) { callback.onCustomViewHidden(); return; }
            fullScreenView = view;
            fullScreenCallback = callback;
            root.addView(view, new FrameLayout.LayoutParams(-1, -1));
            webView.setVisibility(View.GONE);
            if (Build.VERSION.SDK_INT >= 30) {
                WindowInsetsController controller = getWindow().getInsetsController();
                if (controller != null) {
                    controller.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
                    controller.hide(WindowInsets.Type.systemBars());
                }
            } else {
                root.setSystemUiVisibility(View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                    | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
            }
        }
        @Override public void onHideCustomView() { closeFullScreen(); }
    }

    private void closeFullScreen() {
        if (fullScreenView == null) return;
        root.removeView(fullScreenView);
        fullScreenView = null;
        webView.setVisibility(View.VISIBLE);
        if (Build.VERSION.SDK_INT >= 30) {
            WindowInsetsController controller = getWindow().getInsetsController();
            if (controller != null) controller.show(WindowInsets.Type.systemBars());
        } else root.setSystemUiVisibility(View.SYSTEM_UI_FLAG_VISIBLE);
        WebChromeClient.CustomViewCallback callback = fullScreenCallback;
        fullScreenCallback = null;
        if (callback != null) callback.onCustomViewHidden();
    }

    private void handleBack() {
        if (fullScreenView != null) closeFullScreen();
        else if (webView.canGoBack()) webView.goBack();
        else moveTaskToBack(true);
    }

    @Override public void onBackPressed() { handleBack(); }

    @Override protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == CHOOSE_FILE && fileCallback != null) {
            fileCallback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data));
            fileCallback = null;
        }
    }
    @Override protected void onSaveInstanceState(Bundle state) {
        webView.saveState(state);
        super.onSaveInstanceState(state);
    }
    @Override protected void onPause() {
        webView.onPause();
        CookieManager.getInstance().flush();
        super.onPause();
    }
    @Override protected void onResume() { super.onResume(); if (webView != null) webView.onResume(); }
    @Override protected void onDestroy() {
        closeFullScreen();
        if (fileCallback != null) fileCallback.onReceiveValue(null);
        root.removeView(webView);
        webView.destroy();
        super.onDestroy();
    }
}
