package app.relay.nativeclient

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.async
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.yield
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class NotificationMonitorTest {
    @Test fun `revocation is checked after all watched tasks settle`() = runBlocking {
        var revoked = false
        runNotificationMonitor("account-a", emptyList(), { true }, { throw RelayError(401, "revoked") },
            { fail("no active tasks"); JSONObject() }, { fail("must not publish") }, {}, { revoked = true })
        assertTrue(revoked)
    }
    @Test fun `task reads publish in fetch order across foreground and worker`() = runBlocking {
        val reads = SerializedTaskReads()
        val started = CompletableDeferred<Unit>(); val release = CompletableDeferred<Unit>()
        val order = mutableListOf<String>()
        val first = async { reads.read({ order.add("first read"); started.complete(Unit); release.await(); "first" }, { order.add("$it publish") }) }
        started.await()
        val second = async { reads.read({ order.add("second read"); "second" }, { order.add("$it publish") }) }
        yield()
        assertEquals(listOf("first read"), order)
        release.complete(Unit); first.await(); second.await()
        assertEquals(listOf("first read", "first publish", "second read", "second publish"), order)
    }
    @Test fun `authenticated account mismatch clears monitoring without reading tasks`() = runBlocking {
        var reads = 0; var revoked = false
        runNotificationMonitor("account-a", listOf("task"), { true }, { "account-b" },
            { reads++; JSONObject() }, { fail("must not publish") }, {}, { revoked = true })
        assertEquals(0, reads); assertTrue(revoked)
    }
    @Test fun `logout while request is in flight prevents stale notification and invalidation`() = runBlocking {
        var current = true; var published = false; var revoked = false
        val started = CompletableDeferred<Unit>(); val release = CompletableDeferred<Unit>()
        val job = async {
            runNotificationMonitor("account-a", listOf("task"), { current }, { "account-a" },
                { started.complete(Unit); release.await(); JSONObject() }, { published = true }, {}, { revoked = true })
        }
        started.await(); current = false; release.complete(Unit); job.await()
        assertFalse(published); assertFalse(revoked)
    }
    @Test fun `transient host failure is quiet but session revocation clears`() = runBlocking {
        var revoked = 0
        for (status in listOf(503, 401)) {
            runNotificationMonitor("account-a", listOf("task"), { true }, { throw RelayError(status, "private error") },
                { fail("must not read"); JSONObject() }, { fail("must not publish") }, {}, { revoked++ })
        }
        assertEquals(1, revoked)
    }
    @Test fun `inaccessible task is removed while accessible watched task is inspected`() = runBlocking {
        val removed = mutableListOf<String>(); var published = 0
        runNotificationMonitor("account-a", listOf("denied", "allowed"), { true }, { "account-a" },
            { if (it == "denied") throw RelayError(403, "private"); JSONObject() }, { published++ }, removed::add, {})
        assertEquals(listOf("denied"), removed); assertEquals(1, published)
    }
}
