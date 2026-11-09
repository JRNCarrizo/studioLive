package app.studiolive.camera

data class CaptureProfile(
    val width: Int,
    val height: Int,
    val fps: Int,
    val label: String
) {
    val maxBitrateBps: Int
        get() = when {
            width >= 1920 && fps >= 60 -> 14_000_000
            fps >= 60 -> 10_000_000
            width >= 1920 -> 8_000_000
            else -> 5_000_000
        }
}

val captureProfiles = listOf(
    CaptureProfile(1920, 1080, 60, "1080p · 60 fps"),
    CaptureProfile(1920, 1080, 30, "1080p · 30 fps"),
    CaptureProfile(1280, 720, 60, "720p · 60 fps"),
    CaptureProfile(1280, 720, 30, "720p · 30 fps")
)
