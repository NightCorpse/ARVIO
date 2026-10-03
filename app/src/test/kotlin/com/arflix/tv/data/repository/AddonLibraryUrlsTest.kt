package com.arflix.tv.data.repository

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class AddonLibraryUrlsTest {
    private val base = "https://example.com/config"

    @Test fun `direct URLs remain unchanged`() {
        assertEquals("https://files.example/video?token=abc", resolveAddonLibraryUrl("https://files.example/video?token=abc", base))
    }

    @Test fun `relative paths resolve against configured addon base`() {
        assertEquals("https://example.com/config/file/1", resolveAddonLibraryUrl("file/1", base))
        assertEquals("https://example.com/file/1", resolveAddonLibraryUrl("/file/1", base))
    }

    @Test fun `non HTTP malformed and missing links are rejected`() {
        listOf(null, "", "magnet:?xt=urn:btih:123", "file:///sdcard/video", "https://", "bad url", "https://user:pass@example.com/video")
            .forEach { assertNull(resolveAddonLibraryUrl(it, base)) }
    }
}
