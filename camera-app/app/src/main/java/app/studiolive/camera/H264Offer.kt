package app.studiolive.camera

/**
 * Deja H.264 (y su RTX) al frente de la oferta. El hardware del teléfono lo codifica
 * mejor que VP8 por software. Si no hay H.264, la oferta original sigue.
 */
fun preferH264Offer(sdp: String): String {
    val newline = if (sdp.contains("\r\n")) "\r\n" else "\n"
    val lines = sdp.split(Regex("\r?\n")).toMutableList()
    val videoIndex = lines.indexOfFirst { it.startsWith("m=video ") }
    if (videoIndex < 0) return sdp

    val videoPts = lines[videoIndex].trim().split(Regex("\\s+")).drop(3)
    val rtpmap = mutableMapOf<String, String>()
    val aptOf = mutableMapOf<String, String>()
    for (line in lines) {
        val map = Regex("""^a=rtpmap:(\d+)\s+([^/\s]+)""").find(line) ?: continue
        rtpmap[map.groupValues[1]] = map.groupValues[2].lowercase()
    }
    for (line in lines) {
        val fmtp = Regex("""^a=fmtp:(\d+)\s+.*\bapt=(\d+)""").find(line) ?: continue
        aptOf[fmtp.groupValues[1]] = fmtp.groupValues[2]
    }

    val h264 = rtpmap.filter { it.value == "h264" }.keys
    if (h264.isEmpty()) return sdp
    val keep = h264.toMutableSet()
    aptOf.forEach { (rtx, primary) ->
        if (primary in keep) keep.add(rtx)
    }
    val ordered = videoPts.filter { it in keep }
    if (ordered.isEmpty()) return sdp

    val head = lines[videoIndex].trim().split(Regex("\\s+")).take(3)
    lines[videoIndex] = (head + ordered).joinToString(" ")

    val drop = videoPts.filter { it !in keep }.toSet()
    val keptLines = lines.filter { line ->
        val id = Regex("""^a=(?:rtpmap|fmtp|rtcp-fb):(\d+)""").find(line)?.groupValues?.get(1)
        id == null || id !in drop
    }
    return keptLines.joinToString(newline).let { text ->
        if (sdp.endsWith(newline)) text + newline else text
    }
}
