package app.studiolive.camera

import android.annotation.SuppressLint
import java.security.SecureRandom
import java.security.cert.X509Certificate
import javax.net.ssl.SSLContext
import javax.net.ssl.SSLSocketFactory
import javax.net.ssl.TrustManager
import javax.net.ssl.X509TrustManager

/**
 * El estudio usa un certificado de la red local, el mismo que el navegador pide aceptar.
 * Este cliente solo se usa contra el host del QR que la persona acaba de escanear.
 */
@SuppressLint("CustomX509TrustManager", "TrustAllX509TrustManager")
fun studioTrust(): Pair<SSLSocketFactory, X509TrustManager> {
    val trust = object : X509TrustManager {
        override fun checkClientTrusted(chain: Array<out X509Certificate>?, authType: String?) {}
        override fun checkServerTrusted(chain: Array<out X509Certificate>?, authType: String?) {}
        override fun getAcceptedIssuers(): Array<X509Certificate> = emptyArray()
    }
    val context = SSLContext.getInstance("TLS")
    context.init(null, arrayOf<TrustManager>(trust), SecureRandom())
    return context.socketFactory to trust
}
