package app.relay.nativeclient

import kotlinx.coroutines.*
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import okhttp3.Call
import okhttp3.EventListener
import okhttp3.OkHttpClient
import okhttp3.Response
import okhttp3.tls.HandshakeCertificates
import okhttp3.tls.HeldCertificate
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.*
import org.junit.Test
import java.io.IOException
import java.net.InetAddress
import java.util.concurrent.CountDownLatch
import java.util.concurrent.AbstractExecutorService
import java.util.concurrent.ConcurrentLinkedQueue
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import javax.net.ssl.SSLException

/** Test-only HTTPS peers. No host service, OS trust-store edits or production injection hook. */
class HttpsTransportTest {
    private val authority = HeldCertificate.Builder().certificateAuthority(0).build()
    private val servers = mutableListOf<MockWebServer>()
    private val clients = mutableListOf<RelayClient>()
    private val cookie = "__Host-relay_remote=test-session; Path=/; Secure; HttpOnly"
    private val csrf = "a".repeat(43)

    @After fun cleanup() {
        clients.forEach { it.close() }
        servers.forEach { it.close() }
    }

    private fun server(ca: HeldCertificate = authority, host: String = "relay.test"): MockWebServer {
        val certificate = HeldCertificate.Builder().addSubjectAlternativeName(host).signedBy(ca).build()
        val certificates = HandshakeCertificates.Builder().heldCertificate(certificate).build()
        return MockWebServer().also {
            it.useHttps(certificates.sslSocketFactory())
            it.start(InetAddress.getLoopbackAddress(), 0)
            servers += it
        }
    }
    private fun origin(server: MockWebServer) = "https://relay.test:${server.port}"

    private fun client(server: MockWebServer, saved: String? = null, listener: EventListener = EventListener.NONE, executor: ExecutorService? = null): RelayClient {
        val client = RelayClient(Protocol.origin(origin(server)), saved)
        // Keep the real transport's redirect/retry/timeouts/hostname verifier. Reflection is
        // confined to src/test so production has no configurable trust or network bypass.
        val field = RelayClient::class.java.getDeclaredField("http").apply { isAccessible = true }
        val original = field.get(client) as OkHttpClient
        val trust = HandshakeCertificates.Builder().addTrustedCertificate(authority.certificate).build()
        field.set(client, original.newBuilder()
            .sslSocketFactory(trust.sslSocketFactory(), trust.trustManager)
            .dns { hostname ->
                require(hostname == "relay.test") { "Test transport may contact only its loopback peer" }
                listOf(InetAddress.getLoopbackAddress())
            }.eventListener(listener).apply { if (executor != null) dispatcher(okhttp3.Dispatcher(executor)) }.build())
        clients += client
        return client
    }
    private fun json(body: String = "{}", status: Int = 200) = MockResponse.Builder()
        .code(status).addHeader("Content-Type", "application/json").body(body)

    private suspend fun failure(block: suspend () -> Unit): IOException {
        try { block() } catch (e: IOException) { return e }
        throw AssertionError("Request unexpectedly succeeded")
    }

    @Test fun trustedTlsSessionSendsExactOriginCookieAndFreshCsrf() = runBlocking {
        val server = server()
        server.enqueue(json("""{"connection":"lan","remote":true,"csrfToken":"$csrf"}""").addHeader("Set-Cookie", cookie).build())
        server.enqueue(json().build())
        val client = client(server)
        client.session("i".repeat(43))
        client.json("/api/tasks/task/cancel", "POST", JSONObject())
        val login = server.takeRequest(2, TimeUnit.SECONDS)!!
        assertEquals("/api/session/pair", login.url.encodedPath)
        assertEquals(origin(server), login.headers["Origin"])
        assertNull(login.headers["Cookie"])
        assertNull(login.headers["X-Relay-CSRF"])
        assertNotNull(login.handshake)
        val mutation = server.takeRequest(2, TimeUnit.SECONDS)!!
        assertEquals("POST", mutation.method)
        assertEquals(origin(server), mutation.headers["Origin"])
        assertEquals("__Host-relay_remote=test-session", mutation.headers["Cookie"])
        assertEquals(csrf, mutation.headers["X-Relay-CSRF"])
        assertNull(mutation.headers["Authorization"])
    }

    @Test fun untrustedCertificateCannotReceiveSessionHeaders() = runBlocking {
        val unrelatedCa = HeldCertificate.Builder().certificateAuthority(0).build()
        val server = server(unrelatedCa)
        server.enqueue(json().build())
        assertTrue(failure { client(server, cookie).json("/api/session") } is SSLException)
        assertEquals(0, server.requestCount)
    }

    @Test fun trustedCertificateForWrongHostnameIsRefused() = runBlocking {
        val server = server(host = "different.test")
        server.enqueue(json().build())
        assertTrue(failure { client(server, cookie).json("/api/session") } is SSLException)
        assertEquals(0, server.requestCount)
    }

    @Test fun redirectsNeverForwardSessionToAnotherOriginOrAcceptRedirectCookies() = runBlocking {
        val server = server()
        val destination = server()
        destination.enqueue(json().build())
        val client = client(server, cookie)
        for (status in listOf(302, 307)) {
            server.enqueue(json(status = status).addHeader("Location", "${origin(destination)}/api/session")
                .addHeader("Set-Cookie", cookie.replace("test-session", "redirect-session")).build())
            val error = failure { client.json("/api/session") }
            assertEquals(status, (error as RelayError).status)
        }
        assertEquals(2, server.requestCount)
        assertEquals(0, destination.requestCount)
        assertTrue(client.storedCookie().contains("test-session"))
        assertFalse(client.storedCookie().contains("redirect-session"))
    }

    @Test fun oversizedSuccessAndErrorAreBoundedBeforeCookieAcceptance() = runBlocking {
        val server = server()
        val client = client(server, cookie)
        for ((status, size) in listOf(200 to (4 * 1024 * 1024 + 1), 500 to 16385)) {
            server.enqueue(json("x".repeat(size), status).addHeader("Set-Cookie", cookie.replace("test-session", "oversized-session")).build())
            assertEquals("The host response exceeds the app's read limit.", failure { client.json("/api/session") }.message)
        }
        assertEquals(2, server.requestCount)
        assertTrue(client.storedCookie().contains("test-session"))
    }

    private class Progress : EventListener() {
        val headers = CountDownLatch(1)
        val bodyStarted = CountDownLatch(1)
        val failed = CountDownLatch(1)
        override fun responseHeadersEnd(call: Call, response: Response) { headers.countDown() }
        override fun responseBodyStart(call: Call) { bodyStarted.countDown() }
        override fun callFailed(call: Call, ioe: IOException) { failed.countDown() }
    }

    private class GatedExecutor : AbstractExecutorService() {
        private val delegate = Executors.newCachedThreadPool()
        val queued = ConcurrentLinkedQueue<Runnable>()
        @Volatile var hold = false
        @Volatile var cleanupThread: Thread? = null
        val finished = CountDownLatch(1)
        override fun execute(command: Runnable) { if (hold) queued.add(command) else delegate.execute(command) }
        fun releaseCleanup() { delegate.execute { try { cleanupThread = Thread.currentThread(); queued.remove().run() } finally { finished.countDown() } } }
        override fun shutdown() = delegate.shutdown()
        override fun shutdownNow(): MutableList<Runnable> = delegate.shutdownNow()
        override fun isShutdown() = delegate.isShutdown
        override fun isTerminated() = delegate.isTerminated
        override fun awaitTermination(timeout: Long, unit: TimeUnit) = delegate.awaitTermination(timeout, unit)
    }

    @Test fun closingIdleTlsPoolErasesSessionBeforeDisposingSocketOffCallerThread() = runBlocking {
        val server = server()
        server.enqueue(json().build())
        var socket: java.net.Socket? = null
        val executor = GatedExecutor()
        val listener = object : EventListener() {
            override fun connectionAcquired(call: Call, connection: okhttp3.Connection) { socket = connection.socket() }
        }
        val client = client(server, cookie, listener, executor)
        try {
            client.json("/api/session")
            assertNotNull("real TLS connection established", socket)
            val establishedSocket = requireNotNull(socket)
            assertFalse("connection remains pooled", establishedSocket.isClosed)
            executor.hold = true
            val caller = Thread.currentThread()
            client.close()
            assertThrows(IOException::class.java) { client.storedCookie() }
            assertEquals("Session is closed.", failure { client.json("/api/session") }.message)
            assertEquals("cleanup queued independently of caller lifecycle", 1, executor.queued.size)
            assertFalse("no socket disposal on calling thread", establishedSocket.isClosed)
            client.close()
            assertEquals("close is idempotent", 1, executor.queued.size)
            executor.releaseCleanup()
            assertTrue("cleanup completes", executor.finished.await(3, TimeUnit.SECONDS))
            assertNotSame("cleanup uses another thread", caller, executor.cleanupThread)
            assertTrue("actual idle TLS socket disposed", establishedSocket.isClosed)
        } finally {
            executor.hold = false
            client.close()
            executor.shutdown()
        }
    }

    @Test fun cancellingCoroutineCancelsInFlightTlsBodyAndRejectsLateCookie() = runBlocking {
        val server = server()
        server.enqueue(json().addHeader("Set-Cookie", cookie.replace("test-session", "late-session"))
            .bodyDelay(1, TimeUnit.DAYS).build())
        val progress = Progress()
        val client = client(server, cookie, progress)
        val request = launch(Dispatchers.Default) { client.json("/api/session") }
        assertTrue("response headers received", progress.headers.await(5, TimeUnit.SECONDS))
        withTimeout(3000) { request.cancelAndJoin() }
        assertTrue("socket call cancelled", progress.failed.await(3, TimeUnit.SECONDS))
        assertTrue(client.storedCookie().contains("test-session"))
        assertEquals(1, server.requestCount)
    }

    @Test fun closingDuringTlsResponseCannotRestoreCookieOrPermitAnotherRequest() = runBlocking {
        val server = server()
        server.enqueue(json().addHeader("Set-Cookie", cookie.replace("test-session", "late-session"))
            .throttleBody(1, 1, TimeUnit.DAYS).build())
        val progress = Progress()
        val client = client(server, cookie, progress)
        val request = async(Dispatchers.Default) { failure { client.json("/api/session") } }
        assertTrue("response headers received", progress.headers.await(5, TimeUnit.SECONDS))
        assertTrue("response body reading began before close", progress.bodyStarted.await(5, TimeUnit.SECONDS))
        client.close()
        withTimeout(3000) { request.await() }
        assertTrue("socket call cancelled", progress.failed.await(3, TimeUnit.SECONDS))
        assertThrows(IOException::class.java) { client.storedCookie() }
        assertEquals("Session is closed.", failure { client.json("/api/session") }.message)
        assertEquals(1, server.requestCount)
    }
}
