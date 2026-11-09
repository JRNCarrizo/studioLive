package app.studiolive.camera

data class CaptureProfile(
    val width: Int,
    val height: Int,
    val fps: Int,
    val label: String
) {
    val maxBitrateBps: Int
        get() = if (fps >= 60) 8_000_000 else 4_000_000
}

val captureProfiles = listOf(
    CaptureProfile(1920, 1080, 60, "1080p · 60 fps"),
    CaptureProfile(1920, 1080, 30, "1080p · 30 fps"),
    CaptureProfile(1280, 720, 60, "720p · 60 fps"),
    CaptureProfile(1280, 720, 30, "720p · 30 fps")
)
