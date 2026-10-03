package com.arflix.tv.network

import android.os.Build
import okhttp3.OkHttpClient
import org.conscrypt.Conscrypt
import java.security.KeyStore
import javax.net.ssl.SSLContext
import javax.net.ssl.TrustManagerFactory
import javax.net.ssl.X509TrustManager

/** For services requiring TLS 1.3, unavailable in the platform before Android 10. */
internal fun tls13CompatibleClient(client: OkHttpClient): OkHttpClient {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) return client

    // Keep platform certificate trust and hostname verification. Do not install
    // the provider globally: other API and playback clients remain unchanged.
    val trustManagers = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm())
        .apply { init(null as KeyStore?) }
        .trustManagers
    val trustManager = trustManagers.filterIsInstance<X509TrustManager>().single()
    val context = SSLContext.getInstance("TLS", Conscrypt.newProvider()).apply {
        init(null, arrayOf(trustManager), null)
    }
    return client.newBuilder()
        .sslSocketFactory(context.socketFactory, trustManager)
        .build()
}
