package app.studiolive.camera

import android.content.Context
import android.os.Handler
import android.os.HandlerThread
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONObject
import org.webrtc.Camera2Enumerator
import org.webrtc.CameraVideoCapturer
import org.webrtc.DefaultVideoDecoderFactory
import org.webrtc.DefaultVideoEncoderFactory
import org.webrtc.EglBase
import org.webrtc.IceCandidate
import org.webrtc.MediaConstraints
import org.webrtc.PeerConnection
import org.webrtc.PeerConnectionFactory
import org.webrtc.RtpParameters
import org.webrtc.RtpSender
import org.webrtc.SdpObserver
import org.webrtc.SessionDescription
import org.webrtc.SurfaceTextureHelper
import org.webrtc.SurfaceViewRenderer
import org.webrtc.VideoSource
import org.webrtc.VideoTrack
import java.util.concurrent.TimeUnit

class StudioSession(
    context: Context,
    private val eglBase: EglBase,
    private val preview: SurfaceViewRenderer,
    private val endpoint: StudioEndpoint,
    private val onStatus: (String) -> Unit
) {
    private val appContext = context.applicationContext
    private val thread = HandlerThread("studio-rtc").apply { start() }
    private val handler = Handler(thread.looper)
    private val main = Handler(android.os.Looper.getMainLooper())

    private val pendingIce = mutableListOf<IceCandidate>()
    private var socket: WebSocket? = null
    private var factory: PeerConnectionFactory? = null
    private var peer: PeerConnection? = null
    private var capturer: CameraVideoCapturer? = null
    private var textureHelper: SurfaceTextureHelper? = null
    private var videoSource: VideoSource? = null
    private var videoTrack: VideoTrack? = null
    private var videoSender: RtpSender? = null
    private var cameraName: String? = null
    private var useFront = false
    private var cameraId: String? = null
    private var profile = captureProfiles.first()
    @Volatile private var transmitting = false
    private var pendingOffer: String? = null

    val isTransmitting: Boolean
        get() = transmitting

    fun connectSocket() {
        val (ssl, trust) = studioTrust()
        val client = OkHttpClient.Builder()
            .sslSocketFactory(ssl, trust)
            .hostnameVerifier { _, _ -> true }
            .pingInterval(15, TimeUnit.SECONDS)
            .build()
        val request = Request.Builder().url(endpoint.socketUrl).build()
        socket = client.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                val hello = JSONObject()
                    .put("type", "register")
                    .put("role", "camera")
                    .put("name", "Studio Live Cámara")
                    .put("workspace", endpoint.workspace)
                webSocket.send(hello.toString())
                status("Conectado al estudio. Tocá Rec.")
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                handler.post { onSignal(text) }
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                status("No llega al estudio: ${t.message ?: "red"}")
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                status("Señal cerrada.")
            }
        })
    }

    fun setProfile(next: CaptureProfile) {
        if (transmitting) return
        profile = next
    }

    fun start(onReady: () -> Unit) {
        handler.post {
            try {
                openCamera()
                openPeer()
                transmitting = true
                createOffer(restartIce = false)
                main.post(onReady)
                status("Saliendo al aire…")
            } catch (error: Exception) {
                status("No se pudo abrir la cámara: ${error.message}")
                stopCapture()
            }
        }
    }

    fun stop() {
        handler.post {
            transmitting = false
            closePeer()
            stopCapture()
            status("Detenido. Tocá Rec para volver.")
        }
    }

    fun switchFacing() {
        handler.post {
            val current = capturer ?: return@post
            val enumerator = Camera2Enumerator(appContext)
            useFront = !useFront
            val next = pickCamera(enumerator, useFront) ?: return@post
            cameraName = next
            current.switchCamera(object : CameraVideoCapturer.CameraSwitchHandler {
                override fun onCameraSwitchDone(isFront: Boolean) {
                    main.post { preview.setMirror(isFront) }
                }

                override fun onCameraSwitchError(error: String?) {
                    status("No se pudo cambiar de cámara.")
                }
            }, next)
        }
    }

    fun release() {
        handler.post {
            transmitting = false
            closePeer()
            stopCapture()
            factory?.dispose()
            factory = null
            socket?.close(1000, "bye")
            socket = null
            thread.quitSafely()
        }
    }

    private fun onSignal(text: String) {
        val msg = JSONObject(text)
        when (msg.optString("type")) {
            "registered" -> {
                cameraId = msg.optString("cameraId")
                val waiting = pendingOffer
                pendingOffer = null
                if (waiting != null) sendOffer(waiting)
            }
            "answer" -> {
                val pc = peer ?: return
                val sdp = msg.optString("sdp")
                pc.setRemoteDescription(simpleObserver {
                    flushIce()
                }, SessionDescription(SessionDescription.Type.ANSWER, sdp))
            }
            "ice" -> {
                val payload = msg.optJSONObject("candidate") ?: return
                val line = payload.optString("candidate")
                if (line.isBlank()) return
                val ice = IceCandidate(
                    payload.optString("sdpMid"),
                    payload.optInt("sdpMLineIndex"),
                    line
                )
                val pc = peer
                if (pc?.remoteDescription == null) pendingIce.add(ice) else pc.addIceCandidate(ice)
            }
            "host-ready" -> {
                val state = peer?.connectionState()
                if (state == PeerConnection.PeerConnectionState.CONNECTED ||
                    state == PeerConnection.PeerConnectionState.CONNECTING
                ) {
                    return
                }
                if (transmitting) createOffer(restartIce = true)
            }
            "keyframe" -> nudgeKeyframe()
        }
    }

    private fun ensureFactory() {
        if (factory != null) return
        PeerConnectionFactory.initialize(
            PeerConnectionFactory.InitializationOptions.builder(appContext).createInitializationOptions()
        )
        factory = PeerConnectionFactory.builder()
            .setVideoEncoderFactory(DefaultVideoEncoderFactory(eglBase.eglBaseContext, true, true))
            .setVideoDecoderFactory(DefaultVideoDecoderFactory(eglBase.eglBaseContext))
            .createPeerConnectionFactory()
    }

    private fun openCamera() {
        ensureFactory()
        val enumerator = Camera2Enumerator(appContext)
        val name = pickCamera(enumerator, useFront) ?: error("Este teléfono no expone una cámara.")
        cameraName = name
        val events = object : CameraVideoCapturer.CameraEventsHandler {
            override fun onCameraError(errorDescription: String?) {
                status("Cámara: ${errorDescription ?: "error"}")
            }
            override fun onCameraDisconnected() {}
            override fun onCameraFreezed(errorDescription: String?) {}
            override fun onCameraOpening(cameraName: String?) {}
            override fun onFirstFrameAvailable() {}
            override fun onCameraClosed() {}
        }
        val nextCapturer = enumerator.createCapturer(name, events)
        val helper = SurfaceTextureHelper.create("studio-capture", eglBase.eglBaseContext)
        val source = factory!!.createVideoSource(nextCapturer.isScreencast)
        nextCapturer.initialize(helper, appContext, source.capturerObserver)
        nextCapturer.startCapture(profile.width, profile.height, profile.fps)
        val track = factory!!.createVideoTrack("studio-video", source)
        track.addSink(preview)
        main.post { preview.setMirror(useFront) }
        capturer = nextCapturer
        textureHelper = helper
        videoSource = source
        videoTrack = track
    }

    private fun openPeer() {
        val config = PeerConnection.RTCConfiguration(emptyList()).apply {
            sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN
        }
        peer = factory!!.createPeerConnection(config, object : PeerConnection.Observer {
            override fun onIceCandidate(candidate: IceCandidate) {
                sendIce(candidate)
            }
            override fun onSignalingChange(state: PeerConnection.SignalingState?) {}
            override fun onIceConnectionChange(state: PeerConnection.IceConnectionState?) {
                if (state == PeerConnection.IceConnectionState.CONNECTED) status("Al aire.")
            }
            override fun onStandardizedIceConnectionChange(state: PeerConnection.IceConnectionState?) {}
            override fun onIceConnectionReceivingChange(receiving: Boolean) {}
            override fun onIceGatheringChange(state: PeerConnection.IceGatheringState?) {}
            override fun onIceCandidatesRemoved(candidates: Array<out IceCandidate>?) {}
            override fun onSelectedCandidatePairChanged(event: org.webrtc.CandidatePairChangeEvent?) {}
            override fun onAddStream(stream: org.webrtc.MediaStream?) {}
            override fun onAddTrack(
                receiver: org.webrtc.RtpReceiver?,
                mediaStreams: Array<out org.webrtc.MediaStream>?
            ) {}
            override fun onRemoveStream(stream: org.webrtc.MediaStream?) {}
            override fun onDataChannel(channel: org.webrtc.DataChannel?) {}
            override fun onRenegotiationNeeded() {}
            override fun onConnectionChange(newState: PeerConnection.PeerConnectionState?) {}
        })
        videoSender = peer?.addTrack(videoTrack, listOf("studio"))
    }

    private fun createOffer(restartIce: Boolean) {
        val pc = peer ?: return
        val constraints = MediaConstraints()
        if (restartIce) {
            constraints.mandatory.add(MediaConstraints.KeyValuePair("IceRestart", "true"))
        }
        pc.createOffer(object : SdpObserver {
            override fun onCreateSuccess(description: SessionDescription) {
                val munged = preferH264Offer(description.description)
                val offer = SessionDescription(SessionDescription.Type.OFFER, munged)
                pc.setLocalDescription(object : SdpObserver {
                    override fun onSetSuccess() {
                        tuneSender()
                        sendOffer(munged)
                    }
                    override fun onSetFailure(error: String?) {
                        status("Oferta local: ${error ?: "falló"}")
                    }
                    override fun onCreateSuccess(description: SessionDescription?) {}
                    override fun onCreateFailure(error: String?) {}
                }, offer)
            }
            override fun onCreateFailure(error: String?) {
                status("No se armó la oferta: ${error ?: "falló"}")
            }
            override fun onSetSuccess() {}
            override fun onSetFailure(error: String?) {}
        }, constraints)
    }

    private fun tuneSender() {
        val sender = videoSender ?: return
        val params = sender.parameters
        val encoding = params.encodings.firstOrNull() ?: return
        encoding.maxBitrateBps = profile.maxBitrateBps
        encoding.maxFramerate = profile.fps
        params.degradationPreference = RtpParameters.DegradationPreference.MAINTAIN_FRAMERATE
        sender.parameters = params
    }

    private fun nudgeKeyframe() {
        val sender = videoSender ?: return
        val params = sender.parameters
        val encoding = params.encodings.firstOrNull() ?: return
        val previous = encoding.scaleResolutionDownBy ?: 1.0
        encoding.scaleResolutionDownBy = if (previous == 1.0) 1.01 else 1.0
        sender.parameters = params
        encoding.scaleResolutionDownBy = previous
        sender.parameters = params
    }

    private fun flushIce() {
        val pc = peer ?: return
        pendingIce.forEach { pc.addIceCandidate(it) }
        pendingIce.clear()
    }

    private fun sendOffer(sdp: String) {
        val id = cameraId
        if (id.isNullOrBlank()) {
            pendingOffer = sdp
            return
        }
        val payload = JSONObject()
            .put("type", "offer")
            .put("cameraId", id)
            .put("sdp", sdp)
        socket?.send(payload.toString())
    }

    private fun sendIce(candidate: IceCandidate) {
        val id = cameraId ?: return
        val body = JSONObject()
            .put("candidate", candidate.sdp)
            .put("sdpMid", candidate.sdpMid)
            .put("sdpMLineIndex", candidate.sdpMLineIndex)
        val payload = JSONObject()
            .put("type", "ice")
            .put("cameraId", id)
            .put("candidate", body)
        socket?.send(payload.toString())
    }

    private fun pickCamera(enumerator: Camera2Enumerator, front: Boolean): String? {
        val names = enumerator.deviceNames
        val match = names.firstOrNull { name ->
            if (front) enumerator.isFrontFacing(name) else enumerator.isBackFacing(name)
        }
        return match ?: names.firstOrNull()
    }

    private fun stopCapture() {
        videoTrack?.removeSink(preview)
        videoTrack?.dispose()
        videoTrack = null
        try {
            capturer?.stopCapture()
        } catch (_: Exception) {
        }
        capturer?.dispose()
        capturer = null
        videoSource?.dispose()
        videoSource = null
        textureHelper?.dispose()
        textureHelper = null
    }

    private fun closePeer() {
        pendingIce.clear()
        videoSender = null
        peer?.close()
        peer?.dispose()
        peer = null
    }

    private fun status(text: String) {
        main.post { onStatus(text) }
    }

    private fun simpleObserver(onOk: () -> Unit) = object : SdpObserver {
        override fun onSetSuccess() = onOk()
        override fun onSetFailure(error: String?) {
            status("Respuesta de la PC: ${error ?: "falló"}")
        }
        override fun onCreateSuccess(description: SessionDescription?) {}
        override fun onCreateFailure(error: String?) {}
    }
}
