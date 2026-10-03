package com.arflix.tv.data.repository

import java.net.URI

/** Resolve addon-relative links without launching a download or following redirects. */
internal fun resolveAddonLibraryUrl(raw: String?, addonBaseUrl: String): String? = runCatching {
    val value = raw?.trim()?.takeIf { it.isNotEmpty() } ?: return null
    val candidate = URI(value)
    val resolved = if (candidate.isAbsolute) candidate else URI(addonBaseUrl.trimEnd('/') + "/").resolve(candidate)
    if (resolved.scheme?.lowercase() !in setOf("http", "https") || resolved.host.isNullOrBlank() || resolved.userInfo != null) {
        return null
    }
    resolved.toASCIIString()
}.getOrNull()
