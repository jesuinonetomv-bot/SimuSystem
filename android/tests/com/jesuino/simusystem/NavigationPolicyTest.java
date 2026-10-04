package com.jesuino.simusystem;

public final class NavigationPolicyTest {
    public static void main(String[] args) {
        String[] internal = {NavigationPolicy.HOME, NavigationPolicy.HOME + "index.html?v=38#stage",
            "https://jesuinonetomv-bot.github.io:443/SimuSystem/"};
        String[] blocked = {null, "", "javascript:alert(1)", "file:///etc/passwd", "content://settings",
            "http://jesuinonetomv-bot.github.io/SimuSystem/", "https://evil.test/SimuSystem/",
            "https://jesuinonetomv-bot.github.io.evil.test/SimuSystem/",
            "https://jesuinonetomv-bot.github.io@evil.test/SimuSystem/",
            "https://evil@jesuinonetomv-bot.github.io/SimuSystem/",
            "https://jesuinonetomv-bot.github.io:8443/SimuSystem/",
            "https://jesuinonetomv-bot.github.io/SimuSystem-other/",
            "https://jesuinonetomv-bot.github.io/SimuSystem/../other/",
            "https://jesuinonetomv-bot.github.io/SimuSystem/%2e%2e/other/",
            "https://jesuinonetomv-bot.github.io/SimuSystem/%2fother/"};
        for (String url : internal) if (!NavigationPolicy.isInternal(url)) throw new AssertionError("Allowed URL rejected: " + url);
        for (String url : blocked) if (NavigationPolicy.isInternal(url)) throw new AssertionError("Unsafe URL accepted: " + url);
        for (String url : new String[]{"javascript:alert(1)", "intent://settings", "file:///etc/passwd", "content://settings", "data:text/html,hello"}) {
            if (NavigationPolicy.canOpenExternally(url)) throw new AssertionError("Unsafe external URL: " + url);
        }
        if (!NavigationPolicy.canOpenExternally("https://developer.android.com/")) throw new AssertionError("External HTTPS link rejected");
        System.out.println("Navigation policy: 24 security cases passed.");
    }
}
