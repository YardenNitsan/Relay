package app.relay.nativeclient

import kotlinx.coroutines.*
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.onEach
import okhttp3.OkHttpClient
import okhttp3.tls.HandshakeCertificates
import okhttp3.tls.HeldCertificate
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test
import java.io.File
import java.net.InetAddress
import java.util.UUID
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/** Opt-in real Relay API integration; requires repository npm dependencies and Node24+. */
class LanIntegrationTest {
    @Test fun realLanEnrollmentHistoryTasksReplayFilesAndRevocation() = runBlocking {
        assumeTrue("Set RELAY_NATIVE_INTEGRATION=1 for the isolated real host test", System.getenv("RELAY_NATIVE_INTEGRATION") == "1")
        Fixture().use { fixture ->
            val client = fixture.client()
            expectStatus(401) { client.json("/api/conversations") }
            val session = client.session(fixture.ready.getString("invitation"))
            assertEquals("lan", session.getString("connection"))
            assertEquals(fixture.ready.getString("userId"), session.getJSONObject("user").getString("id"))
            val replay = fixture.client()
            expectStatus(401) { replay.session(fixture.ready.getString("invitation")) }
            replay.close()

            // No fresh CSRF after a restored cookie: reads work, mutations must fail.
            val restored = fixture.client(client.storedCookie())
            expectStatus(403) { restored.json("/api/conversations", "POST", JSONObject().put("title", "must not be created")) }
            restored.session()
            assertEquals(0, (restored.json("/api/conversations") as JSONArray).length())
            expectStatus(404) { restored.json("/api/conversations/${fixture.ready.getString("privateConversationId")}") }
            expectStatus(403) { restored.json("/api/admin/users") }
            expectStatus(403) { restored.json("/api/workspaces/${fixture.ready.getString("privateWorkspaceId")}/files") }

            val workspace = restored.json("/api/workspaces", "POST", JSONObject().put("name", "Native integration files")) as JSONObject
            val workspaceId = workspace.getString("id")
            restored.json("/api/workspaces/$workspaceId/files", "POST", JSONObject().put("path", "hello.txt").put("content", "Native account fixture\n"))
            val files = restored.json("/api/workspaces/$workspaceId/files") as JSONObject
            assertEquals("hello.txt", files.getJSONArray("files").getString(0))
            val file = restored.json("/api/workspaces/$workspaceId/file?path=hello.txt") as JSONObject
            assertEquals("Native account fixture\n", file.getString("content"))
            assertTrue(file.getString("sha256").matches(Regex("[a-f0-9]{64}")))
            assertEquals(1, (restored.json("/api/workspaces") as JSONArray).length())

            val requestId = UUID.randomUUID().toString()
            val options = JSONObject("""{"depth":"balanced","modelId":null,"modelSelection":"preferred","access":"read_only","workspaceId":"$workspaceId","contextTokens":8192,"cloudPolicy":"local_only","budget":{"maxCalls":8,"maxSeconds":300,"maxIterations":8,"maxCostUsd":0,"localOnly":true}}""")
            val payload = JSONObject().put("requestId", requestId).put("content", "Native integration task").put("options", options)
            val admitted = restored.json("/api/conversations/start", "POST", payload) as JSONObject
            val task = admitted.getJSONObject("task")
            val taskId = task.getString("id")
            assertEquals(requestId, task.getString("conversationId"))
            val retry = restored.json("/api/conversations/start", "POST", payload) as JSONObject
            assertEquals(taskId, retry.getJSONObject("task").getString("id"))
            val history = restored.json("/api/conversations/$requestId") as JSONObject
            assertEquals("Native integration task", history.getJSONArray("messages").getJSONObject(0).getString("content"))
            assertEquals(1, (restored.json("/api/conversations") as JSONArray).length())
            assertEquals(taskId, (restored.json("/api/tasks/$taskId") as JSONObject).getJSONObject("task").getString("id"))

            var replayScope = ""
            val first = withTimeout(10000) {
                restored.events(9000000, "0".repeat(64)).onEach { frame ->
                    assertFalse(frame.data.contains("Owner-private integration marker"))
                    if (frame.type == "replay") {
                        val control = JSONObject(frame.data)
                        assertEquals(0, control.getLong("after"))
                        replayScope = control.getString("scope")
                    }
                }.first { it.type == "activity" && JSONObject(it.data).optString("taskId") == taskId }
            }
            val after = JSONObject(first.data).getLong("id")
            assertTrue(replayScope.matches(Regex("[a-f0-9]{64}")))
            val cancelled = restored.json("/api/tasks/$taskId/cancel", "POST") as JSONObject
            assertEquals("cancelled", cancelled.getString("status"))
            withTimeout(10000) {
                restored.events(after, replayScope).onEach { frame ->
                    if (frame.type == "replay") assertEquals(after, JSONObject(frame.data).getLong("after"))
                    if (frame.type == "activity") assertTrue(JSONObject(frame.data).getLong("id") > after)
                }.first { it.type == "activity" && JSONObject(it.data).optString("type") == "TASK_CANCELLED" && JSONObject(it.data).optString("taskId") == taskId }
            }
            val followup = restored.json("/api/conversations/$requestId/messages", "POST", JSONObject().put("content", "Native follow-up").put("options", options)) as JSONObject
            restored.json("/api/tasks/${followup.getJSONObject("task").getString("id")}/cancel", "POST")
            assertEquals(2, (restored.json("/api/conversations/$requestId") as JSONObject).getJSONArray("messages").length())

            // Logout invalidates this session at the real host, including a copied cookie.
            val stale = fixture.client(restored.storedCookie())
            restored.json("/api/session/logout", "POST")
            expectStatus(401) { stale.json("/api/conversations") }
            stale.close(); restored.close(); client.close()

            val enrolled = fixture.client()
            enrolled.session(fixture.command("invite").getString("token"))
            val streamReady = CompletableDeferred<Unit>()
            val activeStream = launch {
                enrolled.events(0, null).collect { if (it.type == "replay") streamReady.complete(Unit) }
            }
            withTimeout(10000) { streamReady.await() }
            assertTrue(fixture.command("revoke").getBoolean("revoked"))
            withTimeout(5000) { activeStream.join() }
            expectStatus(401) { enrolled.json("/api/conversations") }
            enrolled.close()

            val expired = fixture.client()
            expired.session(fixture.command("invite").getString("token"))
            assertTrue(fixture.command("expire").getBoolean("expired"))
            expectStatus(401) { expired.session() }
            expired.close()
        }
    }

    private suspend fun expectStatus(status: Int, operation: suspend () -> Unit) {
        try { operation() } catch (error: RelayError) { assertEquals(status, error.status); return }
        fail("Expected HTTP $status")
    }

    private class Fixture : AutoCloseable {
        private val authority = HeldCertificate.Builder().certificateAuthority(0).build()
        private val certificate = HeldCertificate.Builder().addSubjectAlternativeName("relay.test").signedBy(authority).build()
        private val root = generateSequence(File(requireNotNull(System.getProperty("user.dir")))) { it.parentFile }
            .first { File(it, "scripts/native-lan-fixture.ts").isFile }
        private val process = ProcessBuilder("node", "--import", "tsx", "scripts/native-lan-fixture.ts", "--private-native-test")
            .directory(root).redirectError(File(if (System.getProperty("os.name").orEmpty().startsWith("Windows")) "NUL" else "/dev/null")).start()
        private val writer = process.outputStream.bufferedWriter()
        private val reader = process.inputStream.bufferedReader()
        private val io = Executors.newSingleThreadExecutor()
        private val clients = mutableListOf<RelayClient>()
        private var initialized = false
        val ready: JSONObject
        init {
            writer.write(JSONObject().put("certificate", certificate.certificatePem()).put("key", certificate.privateKeyPkcs8Pem()).toString())
            writer.newLine(); writer.flush()
            try { ready = response(); initialized = true } catch (e: Exception) { close(); throw e }
        }
        private fun response(): JSONObject = io.submit<JSONObject> {
            val line = reader.readLine() ?: throw AssertionError("Isolated native fixture stopped before responding")
            require(line.length < 32768) { "Fixture response too large" }
            val value = JSONObject(line)
            check(!value.optBoolean("fixtureError")) { "Isolated native fixture control failed" }
            value
        }.get(30, TimeUnit.SECONDS)
        fun command(op: String): JSONObject {
            writer.write(JSONObject().put("op", op).toString()); writer.newLine(); writer.flush()
            return response()
        }
        fun client(cookie: String? = null): RelayClient {
            val client = RelayClient(Protocol.origin(ready.getString("origin")), cookie)
            val field = RelayClient::class.java.getDeclaredField("http").apply { isAccessible = true }
            val actual = field.get(client) as OkHttpClient
            val trust = HandshakeCertificates.Builder().addTrustedCertificate(authority.certificate).build()
            field.set(client, actual.newBuilder().sslSocketFactory(trust.sslSocketFactory(), trust.trustManager)
                .dns { host -> require(host == "relay.test"); listOf(InetAddress.getByName("127.0.0.1")) }.build())
            clients += client
            return client
        }
        override fun close() {
            clients.forEach { it.close() }
            var clean = false
            try { if (process.isAlive) clean = command("shutdown").optBoolean("closed") } catch (_: Exception) { }
            runCatching { writer.close() }
            val exited = process.waitFor(5, TimeUnit.SECONDS)
            if (!exited) process.destroyForcibly()
            reader.close(); io.shutdownNow()
            if (initialized) {
                assertTrue("Fixture confirmed cleanup and shutdown", clean && exited)
                assertEquals("Fixture exit code", 0, process.exitValue())
            }
        }
    }
}
