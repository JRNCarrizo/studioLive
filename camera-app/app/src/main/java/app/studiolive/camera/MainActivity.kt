package app.studiolive.camera

import android.Manifest
import android.content.pm.PackageManager
import android.content.res.Configuration
import android.os.Bundle
import android.view.View
import android.widget.AdapterView
import android.widget.ArrayAdapter
import android.widget.LinearLayout
import android.widget.SeekBar
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import app.studiolive.camera.databinding.ActivityMainBinding
import com.journeyapps.barcodescanner.ScanContract
import com.journeyapps.barcodescanner.ScanOptions
import org.webrtc.EglBase
import org.webrtc.RendererCommon
import java.util.Locale

class MainActivity : AppCompatActivity() {
    private lateinit var binding: ActivityMainBinding
    private var eglBase: EglBase? = null
    private var session: StudioSession? = null
    private var profile = captureProfiles.first()
    private var torchOn = false
    private var hudShown = true

    private val cameraPermission = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted ->
        if (granted) startTransmission() else binding.status.text = "Hace falta permiso de cámara."
    }

    private val scanner = registerForActivityResult(ScanContract()) { result ->
        val text = result.contents ?: return@registerForActivityResult
        binding.urlField.setText(text)
        connect(text)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        eglBase = EglBase.create()
        binding.preview.init(eglBase!!.eglBaseContext, null)
        binding.preview.setScalingType(RendererCommon.ScalingType.SCALE_ASPECT_FIT)
        binding.preview.setEnableHardwareScaler(false)
        binding.preview.setMirror(false)

        val labels = captureProfiles.map { it.label }
        binding.quality.adapter = ArrayAdapter(this, android.R.layout.simple_spinner_dropdown_item, labels)
        binding.quality.onItemSelectedListener = object : AdapterView.OnItemSelectedListener {
            override fun onItemSelected(parent: AdapterView<*>?, view: View?, position: Int, id: Long) {
                profile = captureProfiles[position]
                session?.setProfile(profile)
            }
            override fun onNothingSelected(parent: AdapterView<*>?) {}
        }

        listOf(
            binding.camBack,
            binding.camFront,
            binding.torchKey,
            binding.recButton,
            binding.visorButton,
            binding.scanButton
        ).forEach {
            it.isClickable = true
            it.isFocusable = true
        }

        binding.scanButton.setOnClickListener {
            val options = ScanOptions()
            options.setDesiredBarcodeFormats(ScanOptions.QR_CODE)
            options.setPrompt("QR de Studio Live")
            options.setBeepEnabled(false)
            options.setOrientationLocked(false)
            scanner.launch(options)
        }

        binding.urlField.setOnEditorActionListener { _, _, _ ->
            connect(binding.urlField.text.toString())
            true
        }

        binding.recButton.setOnClickListener {
            val live = session?.isTransmitting == true
            if (live) {
                session?.stop()
                binding.recLabel.text = "Rec"
                binding.quality.isEnabled = true
                torchOn = false
                setLiveControls(false)
                paintCamera(front = false, torchOk = false, zoomMax = 1f)
            } else if (session == null) {
                connect(binding.urlField.text.toString())
            } else {
                ensureCameraAndStart()
            }
        }

        binding.camBack.setOnClickListener {
            if (session?.isTransmitting == true) session?.switchTo(false)
        }
        binding.camFront.setOnClickListener {
            if (session?.isTransmitting == true) session?.switchTo(true)
        }
        binding.torchKey.setOnClickListener {
            if (session?.isTransmitting != true) return@setOnClickListener
            torchOn = !torchOn
            session?.setTorch(torchOn)
            paintKey(binding.torchKey, binding.torchLed, torchOn)
        }

        binding.zoomSlider.setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
            override fun onProgressChanged(seekBar: SeekBar?, progress: Int, fromUser: Boolean) {
                val value = 1f + progress / 100f
                binding.zoomReadout.text = String.format(Locale.US, "%.2f×", value)
                if (fromUser) session?.setZoom(value)
            }
            override fun onStartTrackingTouch(seekBar: SeekBar?) {}
            override fun onStopTrackingTouch(seekBar: SeekBar?) {}
        })

        binding.visorButton.setOnClickListener { showHud(false) }
        binding.preview.setOnClickListener { if (!hudShown) showHud(true) }
        binding.tally.setOnClickListener { if (!hudShown) showHud(true) }

        applyHud(resources.configuration.orientation == Configuration.ORIENTATION_LANDSCAPE)
        setLiveControls(false)
        paintTally("sync")
    }

    override fun onConfigurationChanged(newConfig: Configuration) {
        super.onConfigurationChanged(newConfig)
        applyHud(newConfig.orientation == Configuration.ORIENTATION_LANDSCAPE)
        session?.noteOrientation()
    }

    private fun connect(raw: String) {
        val parsed = parseStudioUrl(raw)
        if (parsed == null) {
            binding.status.text = "Esa dirección no es un enlace del estudio."
            return
        }
        session?.release()
        val egl = eglBase ?: return
        session = StudioSession(
            this,
            egl,
            binding.preview,
            parsed,
            onStatus = { text ->
                binding.status.text = text
                if (text.contains("luz", ignoreCase = true)) {
                    torchOn = false
                    paintKey(binding.torchKey, binding.torchLed, false)
                }
            },
            onTally = { paintTally(it) },
            onCameraReady = { front, torchOk, zoomMax -> paintCamera(front, torchOk, zoomMax) }
        ).also {
            it.setProfile(profile)
            it.connectSocket()
        }
        binding.recLabel.text = "Rec"
        binding.quality.isEnabled = true
        torchOn = false
        setLiveControls(false)
        paintTally("sync")
    }

    private fun ensureCameraAndStart() {
        val granted = ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) ==
            PackageManager.PERMISSION_GRANTED
        if (granted) startTransmission() else cameraPermission.launch(Manifest.permission.CAMERA)
    }

    private fun startTransmission() {
        session?.setProfile(profile)
        session?.start {
            binding.recLabel.text = "Stop"
            binding.quality.isEnabled = false
            setLiveControls(true)
        }
    }

    private fun setLiveControls(enabled: Boolean) {
        listOf(binding.camBack, binding.camFront, binding.torchKey, binding.zoomSlider).forEach {
            it.isEnabled = enabled
            it.alpha = if (enabled) 1f else 0.45f
        }
    }

    private fun paintTally(state: String) {
        val live = state == "air"
        binding.tallyText.text = when (state) {
            "air" -> "Aire"
            "stby" -> "Stby"
            else -> "Sync"
        }
        binding.tallyLed.setBackgroundResource(
            when (state) {
                "air" -> R.drawable.led_live
                "stby" -> R.drawable.led_on
                else -> R.drawable.led_off
            }
        )
        binding.recButton.setBackgroundResource(if (live) R.drawable.rec_bg_live else R.drawable.rec_bg)
    }

    private fun paintCamera(front: Boolean, torchOk: Boolean, zoomMax: Float) {
        paintKey(binding.camBack, binding.camBackLed, !front)
        paintKey(binding.camFront, binding.camFrontLed, front)
        if (!torchOk) torchOn = false
        paintKey(binding.torchKey, binding.torchLed, torchOn && torchOk)
        val steps = ((zoomMax - 1f) * 100f).toInt().coerceAtLeast(0)
        binding.zoomSlider.isEnabled = steps > 0 && session?.isTransmitting == true
        binding.zoomSlider.max = steps.coerceAtLeast(1)
        binding.zoomSlider.progress = 0
        binding.zoomReadout.text = "1.00×"
        binding.zoomSlider.alpha = if (binding.zoomSlider.isEnabled) 1f else 0.45f
    }

    private fun paintKey(row: View, led: View, on: Boolean) {
        row.setBackgroundResource(if (on) R.drawable.key_bg_on else R.drawable.key_bg)
        led.setBackgroundResource(if (on) R.drawable.led_on else R.drawable.led_off)
    }

    private fun showHud(show: Boolean) {
        hudShown = show
        binding.hud.visibility = if (show) View.VISIBLE else View.GONE
    }

    private fun applyHud(landscape: Boolean) {
        val sideBySide = landscape && resources.displayMetrics.widthPixels / resources.displayMetrics.density >= 560f
        binding.hud.orientation = if (sideBySide) LinearLayout.HORIZONTAL else LinearLayout.VERTICAL
        val keys = binding.keyRow.layoutParams as LinearLayout.LayoutParams
        keys.width = if (sideBySide) LinearLayout.LayoutParams.WRAP_CONTENT else LinearLayout.LayoutParams.MATCH_PARENT
        keys.weight = 0f
        binding.keyRow.layoutParams = keys
        listOf(binding.camBack, binding.camFront, binding.torchKey).forEachIndexed { index, key ->
            val params = key.layoutParams as LinearLayout.LayoutParams
            params.width = if (sideBySide) LinearLayout.LayoutParams.WRAP_CONTENT else 0
            params.weight = if (sideBySide) 0f else 1f
            params.marginStart = if (index == 0) 0 else dp(6)
            key.layoutParams = params
            key.minimumWidth = if (sideBySide) dp(72) else 0
        }
        val zoom = binding.zoomRow.layoutParams as LinearLayout.LayoutParams
        zoom.width = if (sideBySide) 0 else LinearLayout.LayoutParams.MATCH_PARENT
        zoom.weight = if (sideBySide) 1f else 0f
        zoom.topMargin = if (sideBySide) 0 else dp(6)
        zoom.marginStart = if (sideBySide) dp(6) else 0
        binding.zoomRow.layoutParams = zoom
        val rec = binding.recRow.layoutParams as LinearLayout.LayoutParams
        rec.width = if (sideBySide) LinearLayout.LayoutParams.WRAP_CONTENT else LinearLayout.LayoutParams.MATCH_PARENT
        rec.topMargin = if (sideBySide) 0 else dp(6)
        rec.marginStart = if (sideBySide) dp(6) else 0
        binding.recRow.layoutParams = rec
    }

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()

    override fun onDestroy() {
        session?.release()
        session = null
        binding.preview.release()
        eglBase?.release()
        eglBase = null
        super.onDestroy()
    }
}
