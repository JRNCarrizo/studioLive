package app.studiolive.camera

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Matrix
import android.graphics.Rect
import android.graphics.SurfaceTexture
import android.hardware.camera2.CameraCaptureSession
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraDevice
import android.hardware.camera2.CameraManager
import android.hardware.camera2.CaptureRequest
import android.os.Handler
import android.os.HandlerThread
import android.util.Range
import android.util.Size
import android.view.Surface
import android.view.WindowManager
import org.webrtc.CapturerObserver
import org.webrtc.SurfaceTextureHelper
import org.webrtc.TextureBufferImpl
import org.webrtc.VideoCapturer
import org.webrtc.VideoFrame
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlin.math.abs

/**
 * Cámara del teléfono con zoom y luz sobre la misma captura que sale al estudio.
 * La oferta de WebRTC no se toca acá.
 */
class StudioCapturer(
    context: Context,
    private val onReady: (front: Boolean, torchAvailable: Boolean, zoomMax: Float) -> Unit,
    private val onError: (String) -> Unit
) : VideoCapturer {
    private val appContext = context.applicationContext
    private val rotationContext = context
    private val cameraThread = HandlerThread("studio-cam").apply { start() }
    private val cameraHandler = Handler(cameraThread.looper)
    private val main = Handler(android.os.Looper.getMainLooper())
    private val manager = appContext.getSystemService(Context.CAMERA_SERVICE) as CameraManager

    private var helper: SurfaceTextureHelper? = null
    private var observer: CapturerObserver? = null
    private var device: CameraDevice? = null
    private var session: CameraCaptureSession? = null
    private var builder: CaptureRequest.Builder? = null
    private var previewSurface: Surface? = null
    private var characteristics: CameraCharacteristics? = null
    private var generation = 0

    private var wantFront = false
    private var zoom = 1f
    private var torch = false
    private var captureWidth = 1280
    private var captureHeight = 720
    private var captureFps = 30
    private var running = false

    override fun initialize(helper: SurfaceTextureHelper, context: Context, observer: CapturerObserver) {
        this.helper = helper
        this.observer = observer
    }

    override fun startCapture(width: Int, height: Int, framerate: Int) {
        cameraHandler.post {
            captureWidth = width
            captureHeight = height
            captureFps = framerate
            running = true
            openLocked()
        }
    }

    override fun stopCapture() {
        val latch = CountDownLatch(1)
        cameraHandler.post {
            running = false
            generation += 1
            closeLocked()
            observer?.onCapturerStopped()
            latch.countDown()
        }
        latch.await(2, TimeUnit.SECONDS)
    }

    override fun changeCaptureFormat(width: Int, height: Int, framerate: Int) {
        cameraHandler.post {
            captureWidth = width
            captureHeight = height
            captureFps = framerate
            if (running) openLocked()
        }
    }

    override fun dispose() {
        stopCapture()
        cameraThread.quitSafely()
    }

    override fun isScreencast(): Boolean = false

    fun switchFacing(front: Boolean) {
        cameraHandler.post {
            if (wantFront == front && device != null) {
                publishReady()
                return@post
            }
            wantFront = front
            torch = false
            zoom = 1f
            if (running) openLocked()
        }
    }

    fun setTorch(on: Boolean) {
        cameraHandler.post {
            if (on && !torchAvailableLocked()) {
                torch = false
                applyRepeatingLocked()
                onError(if (wantFront) "La luz va en la cámara trasera." else "Esta cámara no tiene luz.")
                return@post
            }
            torch = on
            applyRepeatingLocked()
        }
    }

    fun setZoom(value: Float) {
        cameraHandler.post {
            zoom = value.coerceIn(1f, zoomMaxLocked())
            applyRepeatingLocked()
        }
    }

    fun noteOrientation() {
        cameraHandler.post {
            helper?.setFrameRotation(frameOrientation())
        }
    }

    @SuppressLint("MissingPermission")
    private fun openLocked() {
        val ticket = ++generation
        closeLocked()
        val textureHelper = helper ?: return
        val id = pickCameraId()
        if (id == null) {
            observer?.onCapturerStarted(false)
            onError("Este teléfono no expone una cámara.")
            return
        }
        val chars = try {
            manager.getCameraCharacteristics(id)
        } catch (error: Exception) {
            onError("No se pudo leer la cámara: ${error.message}")
            return
        }
        characteristics = chars
        val size = chooseSize(chars)
        val texture = textureHelper.surfaceTexture
        texture.setDefaultBufferSize(size.width, size.height)
        textureHelper.setTextureSize(size.width, size.height)
        val surface = Surface(texture)
        previewSurface = surface
        try {
            manager.openCamera(id, object : CameraDevice.StateCallback() {
                override fun onOpened(camera: CameraDevice) {
                    if (ticket != generation) {
                        camera.close()
                        return
                    }
                    device = camera
                    startSessionLocked(camera, surface, chars, ticket)
                }

                override fun onDisconnected(camera: CameraDevice) {
                    camera.close()
                    if (device == camera) device = null
                    if (ticket == generation) onError("La cámara se desconectó.")
                }

                override fun onError(camera: CameraDevice, error: Int) {
                    camera.close()
                    if (device == camera) device = null
                    if (ticket == generation) onError("Error de cámara ($error).")
                }
            }, cameraHandler)
        } catch (error: SecurityException) {
            onError("Hace falta permiso de cámara.")
        } catch (error: Exception) {
            onError("No se pudo abrir la cámara: ${error.message}")
        }
    }

    private fun startSessionLocked(
        camera: CameraDevice,
        surface: Surface,
        chars: CameraCharacteristics,
        ticket: Int
    ) {
        try {
            camera.createCaptureSession(listOf(surface), object : CameraCaptureSession.StateCallback() {
                override fun onConfigured(captureSession: CameraCaptureSession) {
                    if (ticket != generation) {
                        captureSession.close()
                        return
                    }
                    session = captureSession
                    val request = camera.createCaptureRequest(CameraDevice.TEMPLATE_RECORD)
                    request.addTarget(surface)
                    request.set(CaptureRequest.CONTROL_MODE, CaptureRequest.CONTROL_MODE_AUTO)
                    request.set(CaptureRequest.CONTROL_AF_MODE, CaptureRequest.CONTROL_AF_MODE_CONTINUOUS_VIDEO)
                    request.set(CaptureRequest.CONTROL_AE_MODE, CaptureRequest.CONTROL_AE_MODE_ON)
                    fpsRange(chars)?.let { request.set(CaptureRequest.CONTROL_AE_TARGET_FPS_RANGE, it) }
                    enableStabilization(chars, request)
                    builder = request
                    applyZoomTorchLocked(request)
                    try {
                        captureSession.setRepeatingRequest(request.build(), null, cameraHandler)
                    } catch (error: Exception) {
                        onError("No entra la imagen: ${error.message}")
                        return
                    }
                    val textureHelper = helper
                    textureHelper?.stopListening()
                    textureHelper?.startListening { frame -> deliverFrame(frame) }
                    observer?.onCapturerStarted(true)
                    publishReady()
                }

                override fun onConfigureFailed(captureSession: CameraCaptureSession) {
                    if (ticket == generation) {
                        observer?.onCapturerStarted(false)
                        onError("No se pudo abrir la cámara.")
                    }
                }
            }, cameraHandler)
        } catch (error: Exception) {
            onError("No se pudo abrir la cámara: ${error.message}")
        }
    }

    private fun closeLocked() {
        helper?.stopListening()
        try {
            session?.close()
        } catch (_: Exception) {
        }
        session = null
        builder = null
        try {
            device?.close()
        } catch (_: Exception) {
        }
        device = null
        try {
            previewSurface?.release()
        } catch (_: Exception) {
        }
        previewSurface = null
    }

    private fun pickCameraId(): String? {
        val ids = try {
            manager.cameraIdList
        } catch (_: Exception) {
            return null
        }
        val wanted = if (wantFront) {
            CameraCharacteristics.LENS_FACING_FRONT
        } else {
            CameraCharacteristics.LENS_FACING_BACK
        }
        return ids.firstOrNull { id ->
            manager.getCameraCharacteristics(id).get(CameraCharacteristics.LENS_FACING) == wanted
        } ?: ids.firstOrNull()
    }

    private fun chooseSize(chars: CameraCharacteristics): Size {
        val map = chars.get(CameraCharacteristics.SCALER_STREAM_CONFIGURATION_MAP)
        val sizes = map?.getOutputSizes(SurfaceTexture::class.java)
        if (sizes.isNullOrEmpty()) return Size(captureWidth, captureHeight)
        val frameNs = 1_000_000_000L / captureFps.coerceAtLeast(1)
        val capable = if (map == null) sizes.toList() else sizes.filter { size ->
            val min = map.getOutputMinFrameDuration(SurfaceTexture::class.java, size)
            min == 0L || min <= frameNs + 1_000_000L
        }
        val pool = if (capable.isNotEmpty()) capable else sizes.toList()
        val targetAspect = captureWidth.toFloat() / captureHeight.toFloat()
        return pool.minBy { size ->
            val diff = abs(size.width - captureWidth) + abs(size.height - captureHeight)
            val aspect = abs(size.width.toFloat() / size.height.toFloat() - targetAspect)
            diff + (aspect * 4000f).toInt()
        }
    }

    private fun fpsRange(chars: CameraCharacteristics): Range<Int>? {
        val ranges = chars.get(CameraCharacteristics.CONTROL_AE_AVAILABLE_TARGET_FPS_RANGES)
        if (ranges.isNullOrEmpty()) return null
        val factor = if (ranges.any { it.upper >= 1000 }) 1000 else 1
        val want = captureFps * factor
        val fixed = ranges.filter { it.lower == it.upper }
        fixed.firstOrNull { it.upper == want }?.let { return it }
        fixed.filter { it.upper in (24 * factor)..want }.maxByOrNull { it.upper }?.let { return it }
        return ranges.minWith(
            compareBy<Range<Int>> { abs(it.upper - it.lower) }.thenBy { abs(it.upper - want) }
        )
    }

    private fun enableStabilization(chars: CameraCharacteristics, request: CaptureRequest.Builder) {
        request.set(
            CaptureRequest.CONTROL_VIDEO_STABILIZATION_MODE,
            CaptureRequest.CONTROL_VIDEO_STABILIZATION_MODE_OFF
        )
        request.set(CaptureRequest.NOISE_REDUCTION_MODE, CaptureRequest.NOISE_REDUCTION_MODE_FAST)
        request.set(CaptureRequest.EDGE_MODE, CaptureRequest.EDGE_MODE_FAST)
        val optical = chars.get(CameraCharacteristics.LENS_INFO_AVAILABLE_OPTICAL_STABILIZATION)
        if (optical != null && optical.contains(CameraCharacteristics.LENS_OPTICAL_STABILIZATION_MODE_ON)) {
            request.set(
                CaptureRequest.LENS_OPTICAL_STABILIZATION_MODE,
                CaptureRequest.LENS_OPTICAL_STABILIZATION_MODE_ON
            )
        }
    }

    private fun zoomMaxLocked(): Float {
        val max = characteristics?.get(CameraCharacteristics.SCALER_AVAILABLE_MAX_DIGITAL_ZOOM) ?: 1f
        return if (max < 1.05f) 1f else max
    }

    private fun torchAvailableLocked(): Boolean {
        if (wantFront) return false
        return characteristics?.get(CameraCharacteristics.FLASH_INFO_AVAILABLE) == true
    }

    private fun applyZoomTorchLocked(request: CaptureRequest.Builder) {
        val sensor = characteristics?.get(CameraCharacteristics.SENSOR_INFO_ACTIVE_ARRAY_SIZE)
        if (sensor != null && zoomMaxLocked() > 1f) {
            val z = zoom.coerceIn(1f, zoomMaxLocked())
            val cropW = (sensor.width() / z).toInt().coerceAtLeast(2)
            val cropH = (sensor.height() / z).toInt().coerceAtLeast(2)
            val left = (sensor.centerX() - cropW / 2).coerceAtLeast(sensor.left)
            val top = (sensor.centerY() - cropH / 2).coerceAtLeast(sensor.top)
            val right = (left + cropW).coerceAtMost(sensor.right)
            val bottom = (top + cropH).coerceAtMost(sensor.bottom)
            request.set(CaptureRequest.SCALER_CROP_REGION, Rect(left, top, right, bottom))
        }
        val mode = if (torch && torchAvailableLocked()) {
            CaptureRequest.FLASH_MODE_TORCH
        } else {
            CaptureRequest.FLASH_MODE_OFF
        }
        request.set(CaptureRequest.FLASH_MODE, mode)
    }

    private fun applyRepeatingLocked() {
        val request = builder ?: return
        val capture = session ?: return
        applyZoomTorchLocked(request)
        try {
            capture.setRepeatingRequest(request.build(), null, cameraHandler)
        } catch (_: Exception) {
        }
    }

    private fun deliverFrame(frame: VideoFrame) {
        val buffer = frame.buffer
        if (buffer !is TextureBufferImpl) {
            observer?.onFrameCaptured(frame)
            return
        }
        val sensor = characteristics?.get(CameraCharacteristics.SENSOR_ORIENTATION) ?: 0
        val adjustedBuffer = undoSensorTransform(buffer, isFrontFacing(), -sensor)
        val adjusted = VideoFrame(adjustedBuffer, frameOrientation(), frame.timestampNs)
        observer?.onFrameCaptured(adjusted)
        adjusted.release()
    }

    private fun undoSensorTransform(buffer: TextureBufferImpl, mirror: Boolean, rotation: Int): TextureBufferImpl {
        val matrix = Matrix()
        matrix.preTranslate(0.5f, 0.5f)
        if (mirror) matrix.preScale(-1f, 1f)
        matrix.preRotate(rotation.toFloat())
        matrix.preTranslate(-0.5f, -0.5f)
        return buffer.applyTransformMatrix(matrix, buffer.width, buffer.height)
    }

    private fun isFrontFacing(): Boolean {
        return characteristics?.get(CameraCharacteristics.LENS_FACING) ==
            CameraCharacteristics.LENS_FACING_FRONT
    }

    private fun frameOrientation(): Int {
        val sensor = characteristics?.get(CameraCharacteristics.SENSOR_ORIENTATION) ?: 0
        val wm = rotationContext.getSystemService(Context.WINDOW_SERVICE) as WindowManager
        @Suppress("DEPRECATION")
        val device = when (wm.defaultDisplay.rotation) {
            Surface.ROTATION_90 -> 90
            Surface.ROTATION_180 -> 180
            Surface.ROTATION_270 -> 270
            else -> 0
        }
        val rotation = if (isFrontFacing()) device else (360 - device)
        return (sensor + rotation) % 360
    }

    private fun publishReady() {
        val front = wantFront
        val torchOk = torchAvailableLocked()
        val maxZoom = zoomMaxLocked()
        main.post { onReady(front, torchOk, maxZoom) }
    }
}
