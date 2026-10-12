package app.relay.nativeclient

import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.suspendCancellableCoroutine
import okhttp3.*
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import org.json.JSONTokener
import java.io.IOException
import java.util.concurrent.TimeUnit
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

class RelayError(val status: Int, message: String) : IOException(message)
data class StreamFrame(val type: String, val data: String)

/** No automatic redirects, cookie jar, mutation retries, logging or alternate trust manager. */
class RelayClient(val origin: String, savedCookie: String? = null) {
    private val http = OkHttpClient.Builder().followRedirects(false).followSslRedirects(false)
        .retryOnConnectionFailure(false).connectTimeout(12, TimeUnit.SECONDS).readTimeout(25, TimeUnit.SECONDS).build()
    @Volatile private var closed = false
    @Volatile private var cookie: Cookie? = savedCookie?.let { Cookie.parse(origin.toHttpUrl(), it) }?.takeIf { validCookie(it) }
    @Volatile private var csrf: String? = null
    private fun validCookie(value: Cookie) = value.name == "__Host-relay_remote" && value.secure && value.httpOnly && value.hostOnly && value.path == "/" && value.domain == origin.toHttpUrl().host && value.expiresAt > System.currentTimeMillis()
    fun storedCookie(): String = cookie?.toString() ?: throw IOException("The host did not issue a secure LAN session.")
    @Synchronized fun close() { closed = true; http.dispatcher.cancelAll(); http.connectionPool.evictAll(); cookie = null; csrf = null }
    @Synchronized private fun acceptCookie(value: Cookie) { if (!closed && validCookie(value)) cookie = value }
    @Synchronized private fun request(path: String, method: String = "GET", payload: JSONObject? = null): Request {
        if (closed) throw IOException("Session is closed.")
        require(path.startsWith("/api/") && !path.contains("\\") && !path.contains("#"))
        val builder = Request.Builder().url(origin + path).header("Accept", "application/json").header("Origin", origin)
        cookie?.let { builder.header("Cookie", "${it.name}=${it.value}") }
        if (method != "GET") {
            csrf?.let { builder.header("X-Relay-CSRF", it) }
            builder.method(method, (payload ?: JSONObject()).toString().toRequestBody("application/json; charset=utf-8".toMediaType()))
        }
        return builder.build()
    }
    suspend fun session(invitation: String? = null): JSONObject {
        val data = if (invitation != null) json("/api/session/pair", "POST", JSONObject().put("token", invitation)) else json("/api/session")
        val session = data as? JSONObject ?: throw IOException("Invalid session response.")
        if (session.optString("connection") != "lan" || !session.optBoolean("remote")) { close(); throw RelayError(0, "This preview supports the separately configured LAN HTTPS listener. Cloudflare remote login is not yet supported.") }
        val token = session.optString("csrfToken")
        if (!Regex("^[A-Za-z0-9_-]{43}$").matches(token)) throw IOException("Invalid session response.")
        storedCookie()
        synchronized(this) { if (closed) throw IOException("Session is closed."); csrf = token }
        return session
    }
    suspend fun json(path: String, method: String = "GET", payload: JSONObject? = null): Any = suspendCancellableCoroutine { continuation ->
        val call = http.newCall(request(path, method, payload))
        continuation.invokeOnCancellation { call.cancel() }
        call.enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) { if (continuation.isActive) continuation.resumeWithException(e) }
            override fun onResponse(call: Call, response: Response) {
                try {
                    val parsed = response.use {
                        if (closed) throw IOException("Session is closed.")
                        val body = it.body
                        val limit = if (it.isSuccessful) 4L * 1024 * 1024 else 16384L
                        val source = body.source()
                        source.request(limit + 1)
                        if (source.buffer.size > limit) throw IOException("The host response exceeds the app's read limit.")
                        val text = source.readUtf8()
                        if (!it.isSuccessful) throw RelayError(it.code, Protocol.safeError(it.code, text))
                        if (!body.contentType().toString().contains("application/json", true)) throw RelayError(0, "The host returned a login page instead of the LAN API. Cloudflare remote login is not supported yet.")
                        for (header in it.headers("Set-Cookie")) Cookie.parse(origin.toHttpUrl(), header)?.let(::acceptCookie)
                        JSONTokener(text).nextValue()
                    }
                    if (continuation.isActive) continuation.resume(parsed)
                } catch (error: Exception) { if (continuation.isActive) continuation.resumeWithException(error) }
            }
        })
    }
    fun events(after: Long, scope: String?) = callbackFlow {
        val path = "/api/events?after=$after" + (scope?.let { "&scope=$it" } ?: "")
        val call = http.newCall(request(path).newBuilder().header("Accept", "text/event-stream").build())
        call.enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) { close(e) }
            override fun onResponse(call: Call, response: Response) {
                try {
                    response.use {
                        if (!it.isSuccessful) throw RelayError(it.code, Protocol.safeError(it.code, ""))
                        if (it.body.contentType().toString().contains("text/event-stream").not()) throw IOException("Activity stream is unavailable.")
                        val source = it.body.source()
                        val decoder = SseDecoder()
                        while (!call.isCanceled()) {
                            if (source.exhausted()) break
                            val line = source.readUtf8LineStrict(256 * 1024)
                            decoder.line(line)?.let { frame ->
                                if (trySend(frame).isFailure) throw IOException("Activity is arriving too quickly; reconnecting from the last applied event.")
                            }
                        }
                    }
                    close()
                } catch (error: Exception) { close(error) }
            }
        })
        awaitClose { call.cancel() }
    }
}
