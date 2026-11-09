package app.studiolive.camera

import android.Manifest
import android.content.pm.PackageManager
import android.os.Bundle
import android.view.View
import android.widget.AdapterView
import android.widget.ArrayAdapter
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import app.studiolive.camera.databinding.ActivityMainBinding
import com.journeyapps.barcodescanner.ScanContract
import com.journeyapps.barcodescanner.ScanOptions
import org.webrtc.EglBase

class MainActivity : AppCompatActivity() {
    private lateinit var binding: ActivityMainBinding
    private var eglBase: EglBase? = null
    private var session: StudioSession? = null
    private var endpoint: StudioEndpoint? = null
    private var profile = captureProfiles.first()

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
        binding.preview.setEnableHardwareScaler(true)
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
                binding.recButton.text = "Rec"
                binding.quality.isEnabled = true
            } else if (session == null) {
                connect(binding.urlField.text.toString())
            } else {
                ensureCameraAndStart()
            }
        }

        binding.facingButton.setOnClickListener { session?.switchFacing() }
        binding.facingButton.isEnabled = false
        binding.recButton.isEnabled = false
    }

    private fun connect(raw: String) {
        val parsed = parseStudioUrl(raw)
        if (parsed == null) {
            binding.status.text = "Esa dirección no es un enlace del estudio."
            return
        }
        session?.release()
        endpoint = parsed
        val egl = eglBase ?: return
        session = StudioSession(this, egl, binding.preview, parsed) { text ->
            binding.status.text = text
        }.also {
            it.setProfile(profile)
            it.connectSocket()
        }
        binding.recButton.isEnabled = true
        binding.recButton.text = "Rec"
        binding.facingButton.isEnabled = false
        binding.quality.isEnabled = true
    }

    private fun ensureCameraAndStart() {
        val granted = ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) ==
            PackageManager.PERMISSION_GRANTED
        if (granted) startTransmission() else cameraPermission.launch(Manifest.permission.CAMERA)
    }

    private fun startTransmission() {
        session?.setProfile(profile)
        session?.start {
            binding.recButton.text = "Stop"
            binding.facingButton.isEnabled = true
            binding.quality.isEnabled = false
        }
    }

    override fun onDestroy() {
        session?.release()
        session = null
        binding.preview.release()
        eglBase?.release()
        eglBase = null
        super.onDestroy()
    }
}
