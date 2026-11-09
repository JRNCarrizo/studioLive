package app.studiolive.camera

import android.net.Uri

data class StudioEndpoint(
    val socketUrl: String,
    val workspace: String
)

fun parseStudioUrl(raw: String): StudioEndpoint? {
    val trimmed = raw.trim()
    if (trimmed.isEmpty()) return null
    val uri = Uri.parse(trimmed)
    val host = uri.host ?: return null
    val port = if (uri.port > 0) uri.port else if (uri.scheme == "http" || uri.scheme == "ws") 80 else 443
    val scheme = if (uri.scheme == "http" || uri.scheme == "ws") "ws" else "wss"
    val workspace = if (uri.getQueryParameter("studioWorkspace") == "liveFusion") "liveFusion" else "live"
    return StudioEndpoint("$scheme://$host:$port/", workspace)
}
