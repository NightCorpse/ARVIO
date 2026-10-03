package com.arflix.tv.ui.screens.watchlist

import androidx.compose.runtime.Composable
import com.arflix.tv.data.api.StremioLibraryVideo
import com.arflix.tv.data.model.MediaItem
import com.arflix.tv.data.model.StreamSource
import com.arflix.tv.ui.components.StreamSelector

data class AddonLibraryFilesState(
    val item: MediaItem? = null,
    val isLoading: Boolean = false,
    val files: List<StremioLibraryVideo> = emptyList(),
    val error: String? = null
)

/** Library files use the same source selector as ordinary playback. */
@Composable
internal fun AddonLibraryFilesDialog(
    state: AddonLibraryFilesState,
    onDismiss: () -> Unit,
    onSelect: (StreamSource) -> Unit
) {
    val item = state.item ?: return
    val entries = state.files.map { file ->
        val stream = file.streams.orEmpty().firstOrNull { !it.url.isNullOrBlank() }
        file to StreamSource(
            source = file.title.orEmpty().ifBlank { file.id.orEmpty() },
            addonName = "Library",
            addonId = item.addonLibraryAddonId.orEmpty(),
            quality = "",
            size = "",
            url = stream?.url,
            infoHash = stream?.infoHash,
            fileIdx = stream?.fileIdx
        )
    }
    androidx.compose.ui.window.Dialog(
        onDismissRequest = onDismiss,
        properties = androidx.compose.ui.window.DialogProperties(usePlatformDefaultWidth = false)
    ) {
    StreamSelector(
        isVisible = true,
        streams = entries.map { it.second },
        selectedStream = null,
        isLoading = state.isLoading,
        title = item.title,
        subtitle = state.error.orEmpty(),
        onSelect = onSelect,
        onClose = onDismiss
    )
    }
}
