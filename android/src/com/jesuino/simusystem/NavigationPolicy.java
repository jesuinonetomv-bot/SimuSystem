package com.jesuino.simusystem;

import java.net.URI;
import java.net.URISyntaxException;

final class NavigationPolicy {
    static final String HOME = "https://jesuinonetomv-bot.github.io/SimuSystem/";

    private NavigationPolicy() {}

    static boolean isInternal(String address) {
        try {
            URI uri = new URI(address);
            String path = uri.normalize().getPath();
            return "https".equalsIgnoreCase(uri.getScheme())
                && "jesuinonetomv-bot.github.io".equalsIgnoreCase(uri.getHost())
                && uri.getUserInfo() == null
                && (uri.getPort() == -1 || uri.getPort() == 443)
                && path != null
                && (path.equals("/SimuSystem") || path.startsWith("/SimuSystem/"))
                && uri.getRawPath().indexOf('%') < 0
                && path.indexOf('\\') < 0;
        } catch (URISyntaxException | NullPointerException e) {
            return false;
        }
    }

    static boolean canOpenExternally(String address) {
        try {
            URI uri = new URI(address);
            String scheme = uri.getScheme();
            return "https".equalsIgnoreCase(scheme) || "http".equalsIgnoreCase(scheme)
                || "mailto".equalsIgnoreCase(scheme) || "tel".equalsIgnoreCase(scheme);
        } catch (URISyntaxException | NullPointerException e) {
            return false;
        }
    }
}
