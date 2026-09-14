package com.hyeni.calendar;

import android.content.Context;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.text.DateFormat;
import java.text.NumberFormat;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** 표시 문구만 변환한다. 세션·라우트·TTL·채널·ACK 정책은 호출 경로에서 그대로 판정한다. */
final class NotificationCopyLocalizer {
    private static final String PREFS = "hyeni_notification_locale";
    private static final Pattern SLOT = Pattern.compile("\\{([a-zA-Z]+)\\}");
    private static volatile JSONObject catalog;

    static boolean supports(String locale) {
        if (locale == null) return false;
        switch (locale) {
            case "ko": case "en": case "ja": case "zh-CN": case "zh-TW":
            case "vi": case "th": case "id": case "ms": case "fil": return true;
            default: return false;
        }
    }

    static boolean saveLocale(Context context, String locale) {
        if (!supports(locale)) return false;
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString("locale", locale).apply();
        return true;
    }

    static String[] localize(Context context, Object copy, String title, String body) {
        if (copy == null || copy == JSONObject.NULL) return new String[]{title, body};
        try {
            String locale = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString("locale", null);
            if (!supports(locale)) {
                Locale system = context.getResources().getConfiguration().getLocales().get(0);
                locale = system.getLanguage();
                if ("zh".equals(locale)) locale = "Hant".equals(system.getScript()) || "TW".equals(system.getCountry())
                        || "HK".equals(system.getCountry()) || "MO".equals(system.getCountry()) ? "zh-TW" : "zh-CN";
                if ("in".equals(locale)) locale = "id";
                if ("tl".equals(locale)) locale = "fil";
            }
            if ("ko".equals(locale)) return new String[]{title, body};
            JSONObject messages = catalog;
            if (messages == null) {
                try (InputStream stream = context.getAssets().open("notification-messages.json");
                     ByteArrayOutputStream output = new ByteArrayOutputStream()) {
                    byte[] buffer = new byte[4096];
                    int count;
                    while ((count = stream.read(buffer)) != -1) output.write(buffer, 0, count);
                    messages = new JSONObject(output.toString(StandardCharsets.UTF_8.name()));
                    catalog = messages;
                }
            }
            return render(messages, locale, copy, title, body);
        } catch (Exception ignored) {
            // 표시 보완 오류 때문에 원본 안전 알림을 누락시키지 않는다. 원문·개인정보는 로깅하지 않는다.
            return new String[]{title, body};
        }
    }

    static String[] render(JSONObject catalog, String language, Object raw, String title, String body) {
        String[] fallback = new String[]{title, body};
        if ("ko".equals(language)) return fallback;
        try {
            if (raw instanceof String && ((String) raw).length() > 2200) return fallback;
            JSONObject copy = raw instanceof String ? new JSONObject((String) raw) : (JSONObject) raw;
            if (!(copy.opt("v") instanceof Number) || ((Number) copy.get("v")).doubleValue() != 1) return fallback;
            if (!(copy.opt("id") instanceof String)) return fallback;
            JSONArray definition = catalog.getJSONObject("definitions").optJSONArray(copy.getString("id"));
            if (definition == null) return fallback;
            String languageTag = supports(language) ? language : "en";
            Locale locale = Locale.forLanguageTag(languageTag);
            JSONObject messages = catalog.getJSONObject("locales").getJSONObject(languageTag);
            JSONObject source = copy.optJSONObject("args");
            JSONObject args = new JSONObject();
            for (int i = 1; i < definition.length(); i++) {
                String key = definition.getString(i);
                Object value = source == null ? null : source.opt(key);
                if ("minutes".equals(key) || "hours".equals(key)) {
                    if (!(value instanceof Number)) return fallback;
                    double number = ((Number) value).doubleValue();
                    if (!Double.isFinite(number) || number < 0 || number > 525600) return fallback;
                    args.put(key, NumberFormat.getInstance(locale).format(Math.round(number)));
                } else {
                    String text = value instanceof String ? ((String) value).replaceAll("[\\x00-\\x1f\\x7f\\u202a-\\u202e\\u2066-\\u2069]", "").trim() : "";
                    args.put(key, text.substring(0, Math.min(200, text.length())));
                }
            }
            Matcher matcher = SLOT.matcher(messages.getString(copy.getString("id")));
            StringBuffer result = new StringBuffer();
            while (matcher.find()) {
                String key = matcher.group(1);
                String value = args.optString(key, "");
                if (value.isEmpty()) value = messages.optString("default." + ("from".equals(key) ? "place" : key), "");
                matcher.appendReplacement(result, Matcher.quoteReplacement(value));
            }
            matcher.appendTail(result);
            String occurredAt = copy.optString("occurredAt", "");
            String zoneId = copy.optString("timeZone", "");
            if (!occurredAt.isEmpty() && NotificationQuietHoursStore.isValidTimeZone(zoneId)) {
                try {
                    SimpleDateFormat parser = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.ROOT);
                    parser.setLenient(false);
                    parser.setTimeZone(TimeZone.getTimeZone("UTC"));
                    Date date = parser.parse(occurredAt);
                    if (date != null) {
                        TimeZone zone = TimeZone.getTimeZone(zoneId);
                        DateFormat formatter = DateFormat.getDateTimeInstance(DateFormat.MEDIUM, DateFormat.SHORT, locale);
                        formatter.setTimeZone(zone);
                        result.append('\n').append(formatter.format(date)).append(' ')
                                .append(zone.getDisplayName(zone.inDaylightTime(date), TimeZone.SHORT, locale));
                    }
                } catch (Exception ignored) { /* 잘못된 시각은 원문 대신 추측해 표시하지 않는다. */ }
            }
            if (Boolean.TRUE.equals(copy.opt("delayed"))) result.append('\n').append(messages.getString("delayed"));
            return new String[]{messages.getString("title." + definition.getString(0)), result.toString()};
        } catch (Exception ignored) {
            return fallback;
        }
    }
}
