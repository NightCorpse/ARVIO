package com.arflix.tv.data.model

/** Sort other sources normally, but retain each Torrentio instance's response order. */
internal fun List<StreamSource>.sortedPreservingTorrentioOrder(
    comparator: Comparator<StreamSource>
): List<StreamSource> {
    fun torrentioKey(stream: StreamSource): String? =
        if (stream.addonName.contains("torrentio", ignoreCase = true) ||
            stream.addonId.contains("torrentio", ignoreCase = true)
        ) stream.addonId.ifBlank { stream.addonName } else null

    val original = groupBy(::torrentioKey)
    val positions = mutableMapOf<String, Int>()
    return sortedWith(comparator).map { stream ->
        val key = torrentioKey(stream)
        if (key == null) stream else {
            val index = positions.getOrDefault(key, 0)
            positions[key] = index + 1
            original.getValue(key)[index]
        }
    }
}
