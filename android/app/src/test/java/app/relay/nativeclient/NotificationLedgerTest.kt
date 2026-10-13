package app.relay.nativeclient

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class NotificationLedgerTest {
    private fun task(id: String, status: String) = JSONObject().put("task", JSONObject().put("id", id).put("status", status))
    @Test fun `terminal outcome cannot regress to a delayed pending approval`() {
        val ledger = NotificationLedger("scope")
        ledger.watch(task("task-1", "running"), 1)
        assertEquals("completed", ledger.observe(task("task-1", "completed"), 2)?.kind)
        val stale = task("task-1", "running").put("approvals", org.json.JSONArray("[{\"id\":\"old\",\"status\":\"pending\"}]"))
        assertNull(ledger.observe(stale, 3))
        assertTrue(ledger.activeIds(4).isEmpty())
    }

    @Test fun `only watched transitions notify and repeated reads deduplicate`() {
        val ledger = NotificationLedger("scope", "generation")
        assertNull(ledger.observe(task("unwatched", "completed"), 1))
        assertFalse(ledger.watch(task("old", "completed"), 1))
        assertTrue(ledger.watch(task("task-1", "running"), 1))
        assertNull(ledger.observe(task("task-1", "running"), 2))
        assertEquals("completed", ledger.observe(task("task-1", "completed"), 3)?.kind)
        assertNull(ledger.observe(task("task-1", "completed"), 4))
        assertEquals("task-1", ledger.resolve(ledger.watches.single().token, 5))
    }

    @Test fun `distinct pending approvals notify but resolved and stale approvals do not`() {
        val ledger = NotificationLedger("scope", "generation")
        val detail = task("task-1", "running")
        ledger.watch(detail, 1)
        detail.put("approvals", org.json.JSONArray("[{\"id\":\"a\",\"status\":\"pending\"}]"))
        assertEquals("approval", ledger.observe(detail, 2)?.kind)
        assertNull(ledger.observe(detail, 3))
        detail.put("approvals", org.json.JSONArray("[{\"id\":\"b\",\"status\":\"pending\"}]"))
        assertEquals("approval", ledger.observe(detail, 4)?.kind)
        detail.getJSONObject("task").put("status", "cancelled")
        assertEquals("clear", ledger.observe(detail, 5)?.kind)
    }

    @Test fun `ledger is bounded expires and rejects altered scope`() {
        val ledger = NotificationLedger("scope", "generation")
        repeat(25) { ledger.watch(task("task-$it", "running"), it.toLong()) }
        assertEquals(20, ledger.watches.size)
        assertNull(ledger.resolve("unknown", 30))
        val restored = NotificationLedger.decode(ledger.encode(), "scope")!!
        assertEquals(20, restored.watches.size)
        assertNull(NotificationLedger.decode(ledger.encode(), "another-session"))
        assertTrue(restored.activeIds(NotificationLedger.TTL + 30).isEmpty())
        assertNull(restored.resolve(ledger.watches.last().token, NotificationLedger.TTL + 30))
    }

    @Test fun `unsafe task identifiers never become request paths`() {
        val ledger = NotificationLedger("scope", "generation")
        listOf("../session", "a?x=b", "a/b", "", "x".repeat(161)).forEach { assertFalse(ledger.watch(task(it, "running"), 1)) }
    }
}
