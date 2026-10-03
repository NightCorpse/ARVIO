package com.arflix.tv.data.model

import com.arflix.tv.data.api.StremioMetaResponse
import com.google.gson.Gson
import org.junit.Assert.assertEquals
import org.junit.Test

class AddonLibraryFilesTest {
    @Test
    fun `metadata preserves file identities and embedded streams`() {
        val response = Gson().fromJson("""{"meta":{"id":"torbox:torrents-1","type":"other","videos":[
            {"id":"torbox:1:2","title":"first.mkv","streams":[{"url":"https://example.com/video"}]},
            {"id":"torbox:1:3","title":"second.mkv","streams":[]}
        ]}}""", StremioMetaResponse::class.java)
        val files = requireNotNull(response.meta?.videos)
        assertEquals(2, files.size)
        assertEquals("torbox:1:2", files.first().id)
        assertEquals("https://example.com/video", files.first().streams?.first()?.url)
    }
}
