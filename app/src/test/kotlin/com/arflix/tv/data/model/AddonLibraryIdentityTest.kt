package com.arflix.tv.data.model

import com.google.gson.Gson
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class AddonLibraryIdentityTest {
    @Test
    fun `native identity survives serialization without TMDB`() {
        val item = MediaItem(
            id = -1, title = "personal-file.mkv",
            addonLibraryItemId = "torbox:torrents-123",
            addonLibraryAddonId = "configured-addon",
            showPlaybackProgress = false
        )
        val gson = Gson()
        val restored = gson.fromJson(gson.toJson(item), MediaItem::class.java)
        assertEquals(item, restored)
    }

    @Test
    fun `ordinary media has no native addon identity`() {
        val item = MediaItem(id = 123, title = "Movie")
        assertNull(item.addonLibraryItemId)
        assertNull(item.addonLibraryAddonId)
    }
}
